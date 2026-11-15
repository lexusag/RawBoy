import AppKit
import RawBoyEngine
import SwiftUI

/**
 * Window details SwiftUI has no modifier for: mouse-moved events (the pointer position, Z and the wheel need them) and
 * keeping the window on a screen that exists. SwiftUI saves a window's frame and puts it back at launch; if that display
 * is gone, or one is unplugged or changes resolution while the window is open, the window is moved onto the main screen
 * (`WindowPlacement`). Full screen and Zoom are the system's and follow the window's own screen; the photo's view redraws
 * for the new screen's scale and colour profile by itself (`PreviewView`).
 */
struct WindowSetup: NSViewRepresentable {
    func makeNSView(context: Context) -> NSView { WatchView() }

    func updateNSView(_ view: NSView, context: Context) {}

    @MainActor
    final class WatchView: NSView {
        private var observers: [NSObjectProtocol] = []

        override func viewDidMoveToWindow() {
            super.viewDidMoveToWindow()
            observers.forEach(NotificationCenter.default.removeObserver)
            observers = []
            guard let window else { return }
            window.acceptsMouseMovedEvents = true
            rescue()
            let center = NotificationCenter.default
            observers.append(center.addObserver(forName: NSApplication.didChangeScreenParametersNotification, object: nil, queue: .main) { [weak self] _ in
                MainActor.assumeIsolated { self?.rescue() }
            })
            observers.append(center.addObserver(forName: NSWindow.didChangeScreenNotification, object: window, queue: .main) { [weak self] _ in
                MainActor.assumeIsolated { self?.rescue() }
            })
        }

        deinit { observers.forEach(NotificationCenter.default.removeObserver) }

        /** Moves the window onto the main screen when too little of it is on any screen. */
        func rescue() {
            guard let window, !window.styleMask.contains(.fullScreen) else { return }
            let screens = NSScreen.screens.map(\.visibleFrame)
            if let frame = WindowPlacement.corrected(window.frame, screens: screens, preferred: NSScreen.main?.visibleFrame) {
                window.setFrame(frame, display: true)
            }
        }
    }
}
