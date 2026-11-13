import Foundation
import Darwin

enum HostError: Error { case invalidResource, disconnected, invalidMessage, busy }
let managerProtocol = "dreamskin.manager/1"
let maximumMessageBytes = 1024 * 1024

func canonicalFileURL(_ file: URL) throws -> URL {
    guard let resolved = realpath(file.path, nil) else { throw HostError.invalidResource }
    defer { free(resolved) }
    // Foundation strips /private from macOS temporary paths; Node does not.
    return URL(fileURLWithPath: String(cString: resolved))
}

func safeFile(_ file: URL, within root: URL) throws {
    let prefix = root.path + "/"
    guard file.path.hasPrefix(prefix), try canonicalFileURL(file).path == file.path else { throw HostError.invalidResource }
    let values = try file.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey])
    guard values.isRegularFile == true, values.isSymbolicLink != true else { throw HostError.invalidResource }
}
func matches(_ value: String, _ pattern: String) -> Bool { value.range(of: pattern, options: .regularExpression) != nil }

func backendMode(environment: [String: String]) -> String {
    guard environment["DREAMSKIN_PREVIEW"] != "1",
          let directory = getpwuid(getuid())?.pointee.pw_dir else { return "read" }
    let home = String(cString: directory)
    guard home.hasPrefix("/"),
          let accountHome = try? canonicalFileURL(URL(fileURLWithPath: home)) else { return "read" }
    // An isolated home must not gain control of the real desktop application.
    for key in ["HOME", "CFFIXED_USER_HOME"] {
        guard let value = environment[key] else { continue }
        guard value.hasPrefix("/"),
              let candidate = try? canonicalFileURL(URL(fileURLWithPath: value)),
              candidate == accountHome else { return "read" }
    }
    return "manager"
}

final class NativeBackend {
    let readOnly: Bool
    private let process = Process(), input = Pipe(), output = Pipe(), errors = Pipe()
    private let writes = DispatchQueue(label: "dreamskin.manager.input")
    private let lock = NSLock()
    private var closed = false, queued = 0
    var onMessage: (([String: Any]) -> Void)?
    var onDisconnected: (() -> Void)?

    init(root: URL, resources: URL) throws {
        let node = root.appendingPathComponent("runtime/node/node"), entry = root.appendingPathComponent("shared/core/main.mjs")
        try safeFile(node, within: root); try safeFile(entry, within: root)
        let environment = ProcessInfo.processInfo.environment
        let mode = backendMode(environment: environment)
        readOnly = mode == "read"
        var backendEnvironment = environment
        if mode == "read" { backendEnvironment["DREAMSKIN_PREVIEW"] = "1" }
        process.executableURL = node
        process.arguments = [entry.path, "--application-root", root.path, "--resource-directory", resources.path, "--media-origin", "dreamskin-media://resource", "--mode", mode]
        process.environment = backendEnvironment
        process.currentDirectoryURL = root
        process.standardInput = input; process.standardOutput = output; process.standardError = errors
    }
    func start() throws {
        try process.run()
        // On macOS, read(upToCount:) can wait for a live pipe to fill the
        // requested size. Read available bytes so short NDJSON replies are
        // delivered without waiting for more output or the backend to exit.
        DispatchQueue.global(qos: .utility).async { [self] in
            while !errors.fileHandleForReading.availableData.isEmpty { }
        }
        DispatchQueue.global(qos: .userInitiated).async { [self] in
            do {
                var pending = Data()
                while true {
                    let bytes = output.fileHandleForReading.availableData
                    if bytes.isEmpty { break }
                    for byte in bytes {
                        if byte == 10 {
                            guard String(data: pending, encoding: .utf8) != nil,
                                  let message = try JSONSerialization.jsonObject(with: pending) as? [String: Any],
                                  message["protocol"] as? String == managerProtocol else { throw HostError.invalidMessage }
                            pending.removeAll(keepingCapacity: true)
                            DispatchQueue.main.async { [weak self] in self?.onMessage?(message) }
                        } else {
                            guard pending.count < maximumMessageBytes else { throw HostError.invalidMessage }
                            pending.append(byte)
                        }
                    }
                }
                if !pending.isEmpty { throw HostError.invalidMessage }
            } catch { }
            self.disconnect()
        }
    }
    func send(_ message: [String: Any]) throws {
        let methods = ["system.hello", "status.get", "claude.status", "dsh.status", "dsh-next.status", "themes.list", "themes.get", "themes.active", "media.activePreview", "media.resolve", "media.release", "skin.apply", "skin.pause", "skin.resume", "skin.reset", "skin.restore", "runtime.repair", "runtime.upgrade", "events.subscribe", "events.unsubscribe", "session.close", "operations.list", "operations.get", "operations.confirm", "themes.update", "themes.copy", "sources.preview", "sources.release", "themes.create", "packages.inspect", "packages.preview", "packages.release", "themes.importPackage", "community.list", "community.local", "community.preview", "community.inspect", "community.download", "community.import", "updates.check", "updates.install", "updates.get", "maintenance.inspect", "maintenance.prepare", "maintenance.execute", "maintenance.get", "startup.get", "startup.update", "themes.delete", "library.recovery.list", "library.recover"]
        guard message["protocol"] as? String == managerProtocol, message["kind"] as? String == "request",
              let id = message["requestId"] as? String, matches(id, "\\A[A-Za-z0-9:_-]{1,128}\\z"), !id.hasPrefix("native:"),
              let method = message["method"] as? String, methods.contains(method), message["params"] is [String: Any],
              Set(message.keys) == Set(["protocol", "kind", "requestId", "method", "params"]) else { throw HostError.invalidMessage }
        try write(message)
    }
    func sendNative(_ message: [String: Any]) throws {
        guard message["protocol"] as? String == managerProtocol, message["kind"] as? String == "native.request",
              let method = message["method"] as? String, ["sources.register", "media.original", "files.release", "packages.register", "packages.export", "updates.authorizeOpen", "updates.authorizeQuit", "desktop.authorize", "session.observe"].contains(method) else { throw HostError.invalidMessage }
        try write(message)
    }
    private func write(_ message: [String: Any]) throws {
        var data = try JSONSerialization.data(withJSONObject: message)
        guard data.count <= maximumMessageBytes else { throw HostError.invalidMessage }; data.append(10)
        lock.lock()
        if closed { lock.unlock(); throw HostError.disconnected }
        // Match the shared manager's 32 pending requests, including 20 thumbnail warmups.
        if queued >= 32 { lock.unlock(); throw HostError.busy }
        queued += 1; lock.unlock()
        writes.async { [self, data] in
            do { try input.fileHandleForWriting.write(contentsOf: data) } catch { disconnect() }
            lock.lock(); queued -= 1; lock.unlock()
        }
    }
    private func disconnect() {
        lock.lock(); let notify = !closed; closed = true; lock.unlock()
        if notify {
            try? input.fileHandleForWriting.close()
            // EOF lets Node drain a transaction; never terminate an accepted write.
            DispatchQueue.main.async { [weak self] in self?.onDisconnected?() }
        }
    }
    func stop() { disconnect() }
}
