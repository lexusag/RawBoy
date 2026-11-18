#if DEBUG
import AppKit
import RawBoyEngine
import ViewerImaging
import ViewerUI
import enum RawBoyBrowseKit.AutoImport
import enum RawBoyBrowseKit.XmpSidecar
import struct RawBoyBrowseKit.PhotoSidecar

/**
 * RAWBOY_BROWSE_PROBE=1 with `--browse <folder of copies>` (debug builds): Browse mode's keys, ratings and hand-offs
 * without a person at the keyboard. Select all and rate 3 stars by calling ViewerUI directly (no synthetic key events), read the
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
            try? await Task.sleep(for: .seconds(3))
            guard let folder = model.browse.folder else { return log("no folder") }
            // RAWBOY_BROWSE_PROBE=immersive: the screen-filling viewer opens, hands a photo to Pro on E and restores the screen.
            if ProcessInfo.processInfo.environment["RAWBOY_BROWSE_PROBE"] == "immersive" {
                @MainActor func windows() -> String { NSApp.windows.filter(\.isVisible).map { String(describing: type(of: $0)) }.joined(separator: ",") }
                @MainActor func presentation(_ when: String) {
                    log("\(when): presentation options \(NSApp.presentationOptions.rawValue), key window \(NSApp.keyWindow.map { String(describing: type(of: $0)) } ?? "none") (first responder \(NSApp.keyWindow?.firstResponder.map { String(describing: type(of: $0)) } ?? "none")), windows [\(windows())], mode \(model.mode.rawValue)")
                }
                model.immersiveViewer = true
                presentation("before")
                model.browse.openSelectedInViewer()
                for ms in [0, 100, 400, 1500] {
                    try? await Task.sleep(for: .milliseconds(ms))
                    log("+\(ms) ms viewer first responder: \(model.browse.debugViewerFirstResponder), key window \(NSApp.keyWindow.map { String(describing: type(of: $0)) } ?? "none")")
                }
                presentation("immersive viewer open")
                for delay in [0.0, 1.0] {
                    try? await Task.sleep(for: .seconds(delay))
                    log("viewer first responder: \(model.browse.debugViewerFirstResponder)")
                }
                model.browse.debugPressEditorKey()  // the E key's command: open in Pro
                try? await Task.sleep(for: .seconds(4))
                presentation("after E")
                log("Pro has \(model.vm.currentURL?.lastPathComponent ?? "nothing")")
                // Leaving Browse with a window of its own open closes it and restores the screen.
                model.mode = .browse
                try? await Task.sleep(for: .seconds(1))
                model.browse.openSelectedInViewer()
                try? await Task.sleep(for: .seconds(2))
                presentation("immersive viewer open again")
                model.mode = .auto
                try? await Task.sleep(for: .seconds(1))
                presentation("after switching to Auto")
                // The default, in this window: nothing hides.
                model.immersiveViewer = false
                model.mode = .browse
                try? await Task.sleep(for: .seconds(1))
                model.browse.openSelectedInViewer()
                try? await Task.sleep(for: .seconds(2))
                presentation("viewer in this window")
                model.mode = .pro
                presentation("end")
                model.immersiveViewer = false
                return NSApp.terminate(nil)
            }
            // RAWBOY_BROWSE_PROBE=preview: the real preview the viewer's image store gets from the host is the engine's.
            if ProcessInfo.processInfo.environment["RAWBOY_BROWSE_PROBE"] == "preview" {
                log("host real preview provider: \(type(of: ViewerHost.realPreview))")
                let store = ImageStore(realPreview: ViewerHost.realPreview)
                for name in ((try? FileManager.default.contentsOfDirectory(atPath: folder.path)) ?? []).sorted() where name.lowercased().hasSuffix(".dng") {
                    let start = Date()
                    let image = await store.image(folder.appendingPathComponent(name), .developed, orientation: nil)
                    log("\(name): \(image.map { "\($0.cgImage.width)x\($0.cgImage.height) of \($0.fullSize.width)x\($0.fullSize.height), \($0.cgImage.colorSpace?.name as String? ?? "?")" } ?? "nil") in \(String(format: "%.2f", Date().timeIntervalSince(start))) s")
                }
                return NSApp.terminate(nil)
            }
            log("mode \(model.mode.rawValue), folder \(folder.lastPathComponent)")
            model.browse.debugSelectAll()
            model.browse.debugRateSelection(stars: 3)
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
