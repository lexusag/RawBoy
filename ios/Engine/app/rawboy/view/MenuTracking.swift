#if os(macOS)
import AppKit

/**
 * Whether a menu (a context menu, a pop-up, a menu bar menu) is open. Local key monitors see a key before the menu
 * that is tracking it does, so a monitor that takes Esc (go back, clear the selection) leaves the menu open: monitors
 * call `isOpen` and let the key through, and Esc closes the menu alone.
 */
@MainActor
public enum MenuTracking {
    public private(set) static var isOpen = false
    private static var observers: [NSObjectProtocol] = []

    /** Starts listening; call once at launch (idempotent). */
    public static func start() {
        guard observers.isEmpty else { return }
        let center = NotificationCenter.default
        observers = [
            center.addObserver(forName: NSMenu.didBeginTrackingNotification, object: nil, queue: .main) { _ in
                MainActor.assumeIsolated { isOpen = true }
            },
            center.addObserver(forName: NSMenu.didEndTrackingNotification, object: nil, queue: .main) { _ in
                MainActor.assumeIsolated { isOpen = false }
            },
        ]
    }
}
#endif
