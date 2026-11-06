import AppKit
import CoreGraphics

// Native screen/session facts only; input inactivity never suspends rendering.
final class PowerState {
    private var screenSleeping = CGDisplayIsAsleep(CGMainDisplayID()) != 0
    private var systemSleeping = false, sessionActive = true, screenLocked = false
    private var observers: [(NotificationCenter, NSObjectProtocol)] = []
    private let changed: (Bool) -> Void

    init(changed: @escaping (Bool) -> Void) {
        self.changed = changed
        let session = CGSessionCopyCurrentDictionary() as? [String: Any]
        sessionActive = session?[kCGSessionOnConsoleKey as String] as? Bool ?? true
        screenLocked = session?["CGSSessionScreenIsLocked"] as? Bool ?? false
    }
    func start() {
        let workspace = NSWorkspace.shared.notificationCenter
        func observe(_ center: NotificationCenter, _ name: Notification.Name, _ update: @escaping () -> Void) {
            let token = center.addObserver(forName: name, object: nil, queue: .main) { [weak self] _ in
                update(); self?.sample()
            }
            observers.append((center, token))
        }
        observe(workspace, NSWorkspace.screensDidSleepNotification) { [weak self] in self?.screenSleeping = true }
        observe(workspace, NSWorkspace.screensDidWakeNotification) { [weak self] in self?.screenSleeping = false }
        observe(workspace, NSWorkspace.willSleepNotification) { [weak self] in self?.systemSleeping = true }
        observe(workspace, NSWorkspace.didWakeNotification) { [weak self] in self?.systemSleeping = false }
        observe(workspace, NSWorkspace.sessionDidResignActiveNotification) { [weak self] in self?.sessionActive = false }
        observe(workspace, NSWorkspace.sessionDidBecomeActiveNotification) { [weak self] in self?.sessionActive = true }
        observe(DistributedNotificationCenter.default(), Notification.Name("com.apple.screenIsLocked")) { [weak self] in self?.screenLocked = true }
        observe(DistributedNotificationCenter.default(), Notification.Name("com.apple.screenIsUnlocked")) { [weak self] in self?.screenLocked = false }
        sample()
    }
    private func sample() {
        changed(!screenSleeping && !systemSleeping && sessionActive && !screenLocked)
    }
    deinit {
        for (center, observer) in observers { center.removeObserver(observer) }
    }
}
