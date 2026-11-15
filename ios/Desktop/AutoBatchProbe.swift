#if DEBUG
import AppKit
import Foundation
import RawBoyEngine

/**
 * Debug builds: runs a batch through Auto without clicking and prints timings, so the whole path (analysis, thumbnails,
 * sidecars, export) can be measured from a script:
 * `RAWBOY_AUTO_PROBE=<file or folder>:<file or folder> "RawBoy Desktop.app/Contents/MacOS/RawBoy Desktop"`.
 * The photos are copied to a scratch folder first (sidecars are written next to them), which also receives the exports.
 */
@MainActor
enum AutoBatchProbe {
    static func runIfRequested(_ model: DesktopModel) {
        guard let list = ProcessInfo.processInfo.environment["RAWBOY_AUTO_PROBE"] else { return }
        Task { await run(model, list.split(separator: ":").map { URL(fileURLWithPath: String($0)) }) }
    }

    /** RAWBOY_AUTO_DETAIL=<n>: opens the n-th analysed photo (1 = the first) once it can be, to look at the photo view. */
    static func openDetailIfRequested(_ model: DesktopModel) {
        guard let n = ProcessInfo.processInfo.environment["RAWBOY_AUTO_DETAIL"].flatMap(Int.init) else { return }
        Task {
            while model.auto.photos.filter({ $0.analysis != nil }).count < n { try? await Task.sleep(for: .milliseconds(200)) }
            model.auto.openDetail(model.auto.photos.filter { $0.analysis != nil }[n - 1].id)
        }
    }

    private static func log(_ s: String) { print("AUTOPROBE \(s)") }

    private static func run(_ model: DesktopModel, _ inputs: [URL]) async {
        let auto = model.auto
        let fm = FileManager.default
        let scratch = fm.temporaryDirectory.appendingPathComponent("rawboy-auto-probe-\(UUID().uuidString.prefix(6))", isDirectory: true)
        let photosDir = scratch.appendingPathComponent("photos", isDirectory: true)
        let exports = scratch.appendingPathComponent("exports", isDirectory: true)
        try? fm.createDirectory(at: photosDir, withIntermediateDirectories: true)
        var copies: [URL] = []
        for f in DesktopModel.photoFiles(in: inputs) {
            let to = photosDir.appendingPathComponent(f.lastPathComponent)
            try? fm.copyItem(at: f, to: to)
            copies.append(to)
        }
        log("scratch \(scratch.path), \(copies.count) photos")
        model.setExportFolder(exports)

        // 1. Analysis of the batch.
        var t = Date()
        model.addToAuto([photosDir])
        var seen: [String: Double] = [:]
        while auto.photos.count < copies.count || auto.photos.contains(where: { $0.status == .queued || $0.status == .analyzing }) {
            for p in auto.photos where p.status == .ready || p.status == .failed { if seen[p.id] == nil { seen[p.id] = Date().timeIntervalSince(t) } }
            try? await Task.sleep(for: .milliseconds(50))
        }
        let analysed = Date().timeIntervalSince(t)
        for p in auto.photos where seen[p.id] == nil { seen[p.id] = analysed }
        var last = 0.0
        for p in auto.photos {
            let done = seen[p.id] ?? 0
            log("analysed \(p.name): \(p.status == .ready ? "ready" : "FAILED \(p.error ?? "")") at +\(String(format: "%.2f", done)) s (took \(String(format: "%.2f", done - last)) s), look \(p.lookName) / \(p.suggestedFilm.name), face \(p.analysis?.stats.hasFace ?? false), skin \(p.analysis?.skin?.hasSkin ?? false)")
            last = done
        }
        log("analysis of \(auto.photos.count) photos: \(String(format: "%.2f", analysed)) s")

        // 2. Edits go to sidecars after 800 ms.
        if let first = auto.photos.first(where: { $0.analysis != nil }) {
            auto.setStrength(first.id, 55)
            auto.setMode(first.id, .film)
            auto.setAdjust(first.id, force: true) { $0.brightness = 12 }
        }
        try? await Task.sleep(for: .milliseconds(1500))
        for url in copies {
            let text = PhotoSidecar(photo: url).readAuto()
            log("sidecar \(url.lastPathComponent): \(text.map { "rawboy:Auto \($0.count) bytes \(AutoSidecar.decode($0).map { "strength \($0.strength) mode \($0.mode) brightness \($0.adjust.brightness)" } ?? "UNREADABLE")" } ?? "none (untouched)")")
        }

        // 3. Back from the sidecars: take the batch out and add it again.
        let before = auto.photos.first { $0.analysis != nil }.map { ($0.id, $0.strength, $0.mode, $0.adjust.brightness) }
        auto.remove(Set(auto.photos.map(\.id)))
        t = Date()
        model.addToAuto([photosDir])
        while auto.photos.count < copies.count || auto.photos.contains(where: { $0.status == .queued || $0.status == .analyzing }) {
            try? await Task.sleep(for: .milliseconds(50))
        }
        if let before, let p = auto.photo(before.0) {
            log("restored from the sidecar: strength \(p.strength) (was \(before.1)), mode \(p.mode) (was \(before.2)), brightness \(p.adjust.brightness) (was \(before.3)) \(p.strength == before.1 && p.mode == before.2 && p.adjust.brightness == before.3 ? "OK" : "MISMATCH")")
        }
        log("re-analysis: \(String(format: "%.2f", Date().timeIntervalSince(t))) s")

        // 4. Export all.
        t = Date()
        auto.exportAll()
        while auto.export != nil { try? await Task.sleep(for: .milliseconds(100)) }
        let took = Date().timeIntervalSince(t)
        let files = (try? fm.contentsOfDirectory(atPath: exports.path)) ?? []
        var bytes = 0
        for f in files { bytes += ((try? fm.attributesOfItem(atPath: exports.appendingPathComponent(f).path)[.size]) as? Int) ?? 0 }
        log("export all: \(String(format: "%.2f", took)) s, \(files.count) files, \(bytes / 1_000_000) MB: \(files.sorted().joined(separator: ", "))")
        log("message: \(auto.message ?? "-")")
        model.autoSidecars.flush()
        log("done")
        NSApp.terminate(nil)
    }
}
#endif
