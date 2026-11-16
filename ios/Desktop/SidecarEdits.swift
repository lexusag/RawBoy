import AppKit
import Foundation
import ImageIO
import os
import RawBoyEngine
import struct RawBoyBrowseKit.PhotoSidecar
import enum RawBoyBrowseKit.XmpSidecar
import typealias RawBoyBrowseKit.ExifOrientation

/**
 * RawBoy Desktop's edits live in the photo's XMP sidecar (`rawboy:Develop`, `Edits` JSON; `PhotoSidecar` picks the file
 * and does the atomic in-place write). A photo opens with what its sidecar holds; every change is written 800 ms after
 * it stops, and anything waiting is written when another photo opens, when the app resigns active and on quit.
 *
 * RawBoy Viewer turns photos with `tiff:Orientation` and crops them in `rawboy:Develop`; a photo with no saved turn
 * takes the sidecar's orientation (relative to the file's own) as its starting rotation and flip.
 */
@MainActor
final class SidecarEdits: EditsPersistence {
    private static let log = Logger(subsystem: "app.rawboy", category: "RawBoyDesktop")
    private static let delay: Duration = .milliseconds(800)

    /** Values in the sidecar this engine doesn't know (the web's heal spots...), per photo, written back as they were. */
    private var extras: [String: [String: Any]] = [:]

    private struct Pending {
        let url: URL
        var params: DevelopParams
        var defaults: DevelopParams
    }
    private var pending: Pending?
    private var task: Task<Void, Never>?
    /** Called with a message when a write fails (the app shows it). */
    var onError: (String) -> Void = { _ in }
    /** The last write's time, for the tests and the status line. */
    private(set) var writes = 0
    /** The photo whose last write failed (its latest edits are only in memory); cleared by a later good write. */
    private(set) var unsavedPhoto: URL?

    func restore(_ url: URL, defaults: DevelopParams) -> DevelopParams? {
        let sidecar = PhotoSidecar(photo: url)
        guard let text = sidecar.readText() else { return nil }
        var base = defaults
        let orientation = XmpSidecar.readOrientation(text)
        let develop = XmpSidecar.readDevelop(text)
        let decoded = develop.flatMap { Edits.decodeAll($0, defaults: defaults) }
        // RawBoy's own turn wins; without one, the Viewer's orientation (on top of the file's own) is the turn.
        let hasTurn = decoded.map { d in d.params.rotation != defaults.rotation || d.params.flipHorizontal != defaults.flipHorizontal || d.params.flipVertical != defaults.flipVertical } ?? false
        if let orientation, !hasTurn {
            let delta = ExifOrientation.delta(file: Self.fileOrientation(url), sidecar: orientation)
            base.rotation = delta.quarterTurns
            base.flipHorizontal = delta.mirrored
        }
        if let decoded {
            extras[url.path] = decoded.extras
            var p = Edits.decode(develop!, defaults: base) ?? decoded.params
            if hasTurn { p.rotation = decoded.params.rotation; p.flipHorizontal = decoded.params.flipHorizontal; p.flipVertical = decoded.params.flipVertical }
            return p
        }
        extras[url.path] = nil
        return base == defaults ? nil : base
    }

    func changed(_ url: URL, params: DevelopParams, defaults: DevelopParams) {
        pending = Pending(url: url, params: params, defaults: defaults)
        task?.cancel()
        task = Task { [weak self] in
            try? await Task.sleep(for: Self.delay)
            guard !Task.isCancelled else { return }
            self?.flush()
        }
    }

    func flush() {
        task?.cancel()
        task = nil
        guard let p = pending else { return }
        pending = nil
        let json = Edits.encode(p.params, defaults: p.defaults, extras: extras[p.url.path] ?? [:])
        do {
            try PhotoSidecar(photo: p.url).writeDevelop(json)
            writes += 1
            if unsavedPhoto == p.url { unsavedPhoto = nil }
        } catch {
            unsavedPhoto = p.url
            Self.log.error("sidecar write failed: \(error.localizedDescription)")
            onError("Couldn't save the edits next to \(p.url.lastPathComponent): \(error.localizedDescription)")
        }
    }

    /** The EXIF orientation of the file itself (what the decoder already applied), 1 when unreadable. */
    static func fileOrientation(_ url: URL) -> Int {
        guard let source = CGImageSourceCreateWithURL(url as CFURL, nil),
              let props = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
              let o = (props[kCGImagePropertyOrientation] as? NSNumber)?.intValue else { return 1 }
        return (1...8).contains(o) ? o : 1
    }
}
