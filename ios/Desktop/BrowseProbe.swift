#if DEBUG
import AppKit
import RawBoyEngine
import ViewerUI
import enum RawBoyBrowseKit.AutoImport
import enum RawBoyBrowseKit.XmpSidecar
import struct RawBoyBrowseKit.PhotoSidecar

/**
 * RAWBOY_BROWSE_PROBE=1 with `--browse <folder of copies>` (debug builds): Browse mode's keys, ratings and hand-offs
 * without a person at the keyboard. Select all (⌘A) and rate 3 stars (3) through ViewerUI's own key monitor, read the
 * sidecars back, then hand one photo to Pro and several to Auto, also while Auto is showing. Writes sidecars: copies only.
 */
enum BrowseProbe {
    @MainActor
    static func runIfRequested(_ model: DesktopModel) {
        guard ProcessInfo.processInfo.environment["RAWBOY_BROWSE_PROBE"] != nil else { return }
        Task { @MainActor in
            func log(_ text: String) {
                print("[browse-probe] \(text)")
                fflush(stdout)
            }
            func key(_ code: UInt16, _ character: String, _ flags: NSEvent.ModifierFlags = []) {
                guard let window = NSApp.keyWindow ?? NSApp.windows.first else { return log("no window") }
                for type in [NSEvent.EventType.keyDown, .keyUp] {
                    if let event = NSEvent.keyEvent(
                        with: type, location: .zero, modifierFlags: flags, timestamp: ProcessInfo.processInfo.systemUptime,
                        windowNumber: window.windowNumber, context: nil, characters: character,
                        charactersIgnoringModifiers: character, isARepeat: false, keyCode: code) {
                        NSApp.sendEvent(event)
                    }
                }
            }
            try? await Task.sleep(for: .seconds(3))
            guard let folder = model.browse.folder else { return log("no folder") }
            log("mode \(model.mode.rawValue), folder \(folder.lastPathComponent)")
            key(0, "a", .command)
            key(20, "3")
            try? await Task.sleep(for: .seconds(2))
            let photos = ((try? FileManager.default.contentsOfDirectory(atPath: folder.path)) ?? []).sorted()
                .filter { $0.lowercased().hasSuffix(".dng") || $0.lowercased().hasSuffix(".jpg") }
            for name in photos {
                let side = PhotoSidecar(photo: folder.appendingPathComponent(name))
                let rating = side.readText().map { XmpSidecar.readRating($0) }
                log("rating \(name): \(rating.map { "\($0.stars) stars" } ?? "no sidecar")")
            }
            let urls = photos.prefix(3).map { folder.appendingPathComponent($0) }
            // One photo to Pro, as the viewer's E key does.
            _ = await ViewerHost.handOff.openInEditor(urls[0])
            try? await Task.sleep(for: .seconds(3))
            log("after one photo to Pro: mode \(model.mode.rawValue), open \(model.vm.currentURL?.lastPathComponent ?? "none")")
            // Several to Auto, as Film.
            model.mode = .browse
            try? await ViewerHost.handOff.sendToAuto(Array(urls), as: .film)
            try? await Task.sleep(for: .seconds(2))
            log("after \(urls.count) to Auto: mode \(model.mode.rawValue), batch \(model.auto.photos.count)")
            // A photo handed over while Auto is showing still opens in the editor.
            _ = await ViewerHost.handOff.openInEditor(urls[1])
            try? await Task.sleep(for: .seconds(3))
            log("Auto showing, one photo to Pro: mode \(model.mode.rawValue), open \(model.vm.currentURL?.lastPathComponent ?? "none"), batch kept \(model.auto.photos.count)")
            NSApp.terminate(nil)
        }
    }
}
#endif
