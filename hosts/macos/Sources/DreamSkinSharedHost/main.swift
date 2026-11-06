import AppKit
import WebKit

final class AppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate, WKScriptMessageHandler, WKNavigationDelegate, WKUIDelegate {
    private var window: NSWindow!, web: WKWebView!, backend: NativeBackend?, media: MediaResources!
    private var nativeFiles: NativeFiles?
    private var page: URL!, root: URL!, temporary: URL!, session: String?
    private var eventSequence: Double = 0
    private let desktop = NativeDesktop()
    private var statusItem: NSStatusItem?
    private var power: PowerState?
    private var screenAwake = true, observationActive: Bool?
    func applicationDidFinishLaunching(_ notification: Notification) {
        do {
            if let identifier = Bundle.main.bundleIdentifier, let existing = NSRunningApplication.runningApplications(withBundleIdentifier: identifier).first(where: { $0.processIdentifier != ProcessInfo.processInfo.processIdentifier }) {
                existing.activate(options: [.activateIgnoringOtherApps]); NSApp.terminate(nil); return
            }
            let arguments = Array(CommandLine.arguments.dropFirst())
            if arguments.isEmpty, let bundled = Bundle.main.resourceURL { root = bundled.standardizedFileURL }
            else if arguments.count == 2, arguments[0] == "--application-root", arguments[1].hasPrefix("/") { root = URL(fileURLWithPath: arguments[1]).standardizedFileURL }
            else { throw HostError.invalidResource }
            page = root.appendingPathComponent("ui/manager/index.html"); try safeFile(page, within: root)
            temporary = try canonicalFileURL(FileManager.default.temporaryDirectory).appendingPathComponent("DreamSkin-manager-" + UUID().uuidString, isDirectory: true)
            let directory = temporary.appendingPathComponent("media", isDirectory: true)
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
            media = MediaResources(directory: directory)
            let config = WKWebViewConfiguration(); config.setURLSchemeHandler(media, forURLScheme: "dreamskin-media")
            config.websiteDataStore = .nonPersistent()
            config.userContentController.add(self, name: "manager")
            // Block every network scheme even if a compromised page tries to fetch one.
            let rules = "[{\"trigger\":{\"url-filter\":\"^https?://\"},\"action\":{\"type\":\"block\"}}]"
            WKContentRuleListStore.default().compileContentRuleList(forIdentifier: "dreamskin-offline", encodedContentRuleList: rules) { [weak self] list, error in
                guard let self else { return }
                guard error == nil, let list else { self.fail(); return }
                config.userContentController.add(list)
                self.open(config: config, directory: directory)
            }
        } catch { fail() }
    }
    private func open(config: WKWebViewConfiguration, directory: URL) {
        do {
            web = WKWebView(frame: .zero, configuration: config); web.navigationDelegate = self; web.uiDelegate = self
            window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1220, height: 820), styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
            window.title = "Codex Dream Skin"; window.minSize = NSSize(width: 820, height: 600); window.contentView = web
            window.delegate = self; window.center(); window.makeKeyAndOrderFront(nil)
            try startBackend()
            power = PowerState { [weak self] awake in
                self?.screenAwake = awake; self?.syncObservation()
            }
            power?.start()
            desktop.navigate = { [weak self] page, section in self?.route(page, section: section) }
            desktop.languageChanged = { [weak self] in self?.buildMenus() }
            buildMenus()
            web.loadFileURL(page, allowingReadAccessTo: root.appendingPathComponent("ui/manager"))
            NSApp.activate(ignoringOtherApps: true)
        } catch { fail() }
    }
    private func startBackend() throws {
        let previous = backend; backend = nil
        nativeFiles?.close(); previous?.stop(); media.clear(); session = nil; eventSequence = 0; observationActive = nil
        let directory = temporary.appendingPathComponent("media", isDirectory: true)
        let value = try NativeBackend(root: root, resources: directory); backend = value
        nativeFiles = NativeFiles(backend: value, directory: directory, desktop: desktop, post: { [weak self, weak value] response in
            guard let self, let value, self.backend === value else { return }; self.post(response)
        })
        value.onMessage = { [weak self, weak value] message in
            guard let self, let value, self.backend === value else { return }; self.receive(message)
        }
        value.onDisconnected = { [weak self, weak value] in
            guard let self, let value, self.backend === value else { return }; self.disconnect()
        }
        try value.start()
    }
    private func disconnect() {
        let previous = backend; backend = nil
        previous?.stop(); nativeFiles?.close(); media.clear(); session = nil; eventSequence = 0
        post(["protocol": managerProtocol, "kind": "host.disconnected"])
    }
    private func fail() {
        backend?.stop()
        let alert = NSAlert(); alert.messageText = "无法打开共享管理器"; alert.informativeText = "请检查完整资源包和包内 Node。"; alert.runModal(); NSApp.terminate(nil)
    }
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.frameInfo.isMainFrame, message.frameInfo.request.url?.standardizedFileURL == page,
              let request = message.body as? [String: Any] else { return }
        if request["protocol"] as? String == managerProtocol, request["kind"] as? String == "host.reconnect" {
            do { try startBackend(); web.reload() } catch { disconnect() }; return
        }
        guard backend != nil, session != nil || request["method"] as? String == "system.hello" else { return }
        do { if nativeFiles?.handle(request) != true { try backend?.send(request) } }
        catch HostError.busy {
            if let id = request["requestId"] as? String {
                post(["protocol": managerProtocol, "kind": "response", "requestId": id, "ok": false,
                      "error": ["code": "BUSY", "message": "Manager write queue is busy; try again shortly.", "retryable": true]])
            }
        } catch { disconnect() }
    }
    private func receive(_ message: [String: Any]) {
        do {
            if nativeFiles?.receive(message) == true { return }
            if message["kind"] as? String == "resource.release" { try media.release(message, session: session); return }
            if message["kind"] as? String == "resource.register" { try media.register(message, session: session); return }
            if message["kind"] as? String == "event" {
                guard let session, message["backendSessionId"] as? String == session,
                      let sequence = message["sequence"] as? NSNumber, String(cString: sequence.objCType) != "c",
                      sequence.doubleValue > eventSequence, sequence.doubleValue <= 9007199254740991,
                      sequence.doubleValue.rounded() == sequence.doubleValue else { return }
                guard let name = message["event"] as? String, ["status.changed", "operation.changed", "status.invalidated", "session.closing"].contains(name) else { throw HostError.invalidMessage }
                if name == "status.changed" { guard let snapshot = message["snapshot"] as? [String: Any], snapshot["backendSessionId"] as? String == session else { throw HostError.invalidMessage } }
                if name == "operation.changed" { guard message["operation"] is [String: Any] else { throw HostError.invalidMessage } }
                eventSequence = sequence.doubleValue; post(message); return
            }
            guard message["kind"] as? String == "response" else { throw HostError.invalidMessage }
            if let result = message["result"] as? [String: Any], let current = result["backendSessionId"] as? String {
                if let session, session != current { media.clear() }; session = current
                syncObservation()
            }
            post(message)
        } catch { disconnect() }
    }
    private func post(_ message: [String: Any]) {
        guard let data = try? JSONSerialization.data(withJSONObject: message), data.count <= maximumMessageBytes else { return }
        let encoded = data.base64EncodedString()
        web?.evaluateJavaScript("window.dispatchEvent(new CustomEvent('dreamskin-message',{detail:JSON.parse(new TextDecoder().decode(Uint8Array.from(atob('\(encoded)'),c=>c.charCodeAt(0))))}));", completionHandler: nil)
    }
    private func syncObservation() {
        guard session != nil, let window, let backend else { return }
        let active = screenAwake && window.isVisible && !window.isMiniaturized && window.occlusionState.contains(.visible)
        guard observationActive != active else { return }
        do {
            try backend.sendNative(["protocol": managerProtocol, "kind": "native.request", "requestId": "native:" + UUID().uuidString.lowercased(),
                                    "method": "session.observe", "params": ["active": active]])
            observationActive = active
        } catch { disconnect() }
    }
    func windowDidChangeOcclusionState(_ notification: Notification) { syncObservation() }
    func windowDidMiniaturize(_ notification: Notification) { syncObservation() }
    func windowDidDeminiaturize(_ notification: Notification) { syncObservation() }
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        decisionHandler(navigationAction.targetFrame?.isMainFrame == true && navigationAction.request.url?.standardizedFileURL == page ? .allow : .cancel)
    }
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? { nil }
    private func route(_ page: String, section: String = "none") { desktop.enqueue(page, section: section); window?.makeKeyAndOrderFront(nil); NSApp.activate(ignoringOtherApps: true) }
    private func buildMenus() {
        let main = NSMenu(); let appItem = NSMenuItem(); main.addItem(appItem)
        let menu = NSMenu(); appItem.submenu = menu
        for (title, destination) in [(desktop.text("控制台", "Console"), "console"), (desktop.text("导入", "Import"), "import"), (desktop.text("设置", "Settings"), "settings"), (desktop.text("检查更新", "Updates"), "updates"), (desktop.text("维护", "Maintenance"), "maintenance")] {
            let item = NSMenuItem(title: title, action: #selector(menuRoute(_:)), keyEquivalent: ""); item.target = self; item.representedObject = destination; menu.addItem(item)
        }
        menu.addItem(.separator()); let quit = NSMenuItem(title: desktop.text("退出", "Quit"), action: #selector(quitManager), keyEquivalent: "q"); quit.target = self; menu.addItem(quit)
        NSApp.mainMenu = main
        let edit = NSMenuItem(title: desktop.text("编辑", "Edit"), action: nil, keyEquivalent: ""); let editing = NSMenu(title: edit.title); edit.submenu = editing
        for (title, action, key) in [(desktop.text("复制", "Copy"), Selector(("copy:")), "c"), (desktop.text("粘贴", "Paste"), Selector(("paste:")), "v"), (desktop.text("剪切", "Cut"), Selector(("cut:")), "x"), (desktop.text("全选", "Select All"), Selector(("selectAll:")), "a")] { editing.addItem(NSMenuItem(title: title, action: action, keyEquivalent: key)) }
        main.addItem(edit)
        if statusItem == nil { statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength) }
        statusItem?.button?.image = NSImage(systemSymbolName: "paintpalette", accessibilityDescription: "Dream Skin"); statusItem?.menu = menu.copy() as? NSMenu
    }
    @objc private func menuRoute(_ sender: NSMenuItem) { guard let target = sender.representedObject as? String else { return }; if target == "updates" || target == "maintenance" { route("settings", section: target) } else { route(target) } }
    @objc private func quitManager() { NSApp.terminate(nil) }
    func application(_ application: NSApplication, open urls: [URL]) {
        for url in urls.prefix(8) { if let link = try? NativeDesktop.communityLink(url.absoluteString) { desktop.enqueue("import", link: link) } }
        window?.makeKeyAndOrderFront(nil); NSApp.activate(ignoringOtherApps: true)
    }
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        if backend == nil, web != nil { do { try startBackend(); web.reload() } catch { disconnect() } }
        window?.makeKeyAndOrderFront(nil); return true
    }
    func windowShouldClose(_ sender: NSWindow) -> Bool { sender.orderOut(nil); syncObservation(); return false }
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }
    func applicationWillTerminate(_ notification: Notification) {
        nativeFiles?.close(); backend?.stop(); media?.clear(); web?.configuration.userContentController.removeScriptMessageHandler(forName: "manager")
        // Remove only regular files inside this process's private, randomly allocated directory.
        if let temporary {
            let directory = temporary.appendingPathComponent("media")
            if let files = try? FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil) {
                for file in files { if (try? safeFile(file, within: directory)) != nil { try? FileManager.default.removeItem(at: file) } }
            }
            try? FileManager.default.removeItem(at: directory)
            try? FileManager.default.removeItem(at: temporary)
        }
    }
}

if CommandLine.arguments.count == 2, CommandLine.arguments[1] == "--observe-power" {
    let power = PowerState { awake in
        guard let bytes = try? JSONSerialization.data(withJSONObject: ["screenAwake": awake]) else { return }
        do { try FileHandle.standardOutput.write(contentsOf: bytes + Data([10])) } catch { exit(0) }
    }
    // Closing the watcher's input pipe also closes this observer after a crash.
    DispatchQueue.global(qos: .utility).async {
        while !FileHandle.standardInput.availableData.isEmpty { }
        exit(0)
    }
    power.start()
    withExtendedLifetime(power) { RunLoop.main.run() }
    exit(0)
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
