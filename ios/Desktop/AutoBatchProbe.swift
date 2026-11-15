#if DEBUG
import AppKit
import Foundation
import ImageIO
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

    /**
     * RAWBOY_PROBE_MOUSE="x,y;x,y>x,y;...": events posted into the window's own queue (no accessibility permission needed),
     * points in the window's content area from its top left; "a>b" is a drag from a to b, "a" a click, "a*2" a double click.
     * Prints the open photo's adjustments after each step.
     */
    static func mouseProbeIfRequested(_ model: DesktopModel) {
        guard let script = ProcessInfo.processInfo.environment["RAWBOY_PROBE_MOUSE"] else { return }
        Task {
            if model.mode == .pro {
                while !model.vm.state.hasImage { try? await Task.sleep(for: .milliseconds(300)) }
                // RAWBOY_PROBE_LEAK=<kind>: a leak of that kind is added and the Light tool opened, for the mouse script.
                if let kind = ProcessInfo.processInfo.environment["RAWBOY_PROBE_LEAK"] {
                    _ = model.vm.addLeak(kind == "glow" ? .glow : kind == "triangle" ? .triangle : .streak)
                    model.commands.send(.toggleMode(.leaks))
                    try? await Task.sleep(for: .seconds(2))
                }
            } else {
                while model.auto.selected == nil || model.auto.sessionReady == nil { try? await Task.sleep(for: .milliseconds(300)) }
            }
            try? await Task.sleep(for: .seconds(2))
            guard let window = NSApp.windows.first(where: { $0.isVisible && $0.contentView != nil }), let view = window.contentView else {
                log("no window")
                return
            }
            NSApp.activate(ignoringOtherApps: true)
            window.makeKeyAndOrderFront(nil)
            try? await Task.sleep(for: .milliseconds(500))
            func point(_ s: Substring) -> NSPoint {
                let v = s.split(separator: ",").compactMap { Double($0) }
                return NSPoint(x: v[0], y: view.frame.height - v[1])
            }
            func post(_ type: NSEvent.EventType, _ p: NSPoint, clicks: Int = 1) {
                let e = NSEvent.mouseEvent(with: type, location: p, modifierFlags: [], timestamp: ProcessInfo.processInfo.systemUptime,
                                           windowNumber: window.windowNumber, context: nil, eventNumber: 0, clickCount: clicks, pressure: 1)!
                NSApp.postEvent(e, atStart: false)
            }
            @MainActor func state() -> String {
                if model.mode == .pro {
                    let p = model.vm.state.params
                    if let l = p.leaks.last, ProcessInfo.processInfo.environment["RAWBOY_PROBE_LEAK"] != nil {
                        return "leak \(l.kind) radii \(l.radii) rx \(l.rx) ry \(l.ry) angle \(l.angle) cx \(l.cx) cy \(l.cy)"
                    }
                    return "exposure \(p.exposure) contrast \(p.contrast) highlights \(p.highlights) shadows \(p.shadows) tonemapper \(p.toneMapper) film \(p.film ?? "-")"
                }
                guard let id = model.auto.selected, let p = model.auto.photo(id) else { return "-" }
                return "mode \(p.mode) strength \(p.strength) brightness \(p.adjust.brightness) saturation \(p.adjust.saturation) grain \(p.adjust.grain) warmth \(p.adjust.warmth)"
            }
            log("start: \(state())")
            for step in script.split(separator: ";") {
                let double = step.hasSuffix("*2")
                let body = double ? step.dropLast(2) : step
                let parts = body.split(separator: ">")
                let from = point(parts[0])
                if ProcessInfo.processInfo.environment["RAWBOY_PROBE_HIT"] != nil, let super_ = view.superview {
                    let hit = view.hitTest(view.convert(from, to: super_))
                    log("hit at \(step): \(hit.map { String(describing: type(of: $0)) } ?? "nil"), content \(view.frame.size)")
                }
                post(.mouseMoved, from)
                try? await Task.sleep(for: .milliseconds(50))
                post(.leftMouseDown, from, clicks: double ? 2 : 1)
                // All of a drag's events go in at once: a slider's tracking loop pumps events but not the main queue.
                if parts.count > 1 {
                    let to = point(parts[1])
                    for i in 1...10 {
                        post(.leftMouseDragged, NSPoint(x: from.x + (to.x - from.x) * Double(i) / 10, y: from.y + (to.y - from.y) * Double(i) / 10))
                    }
                    post(.leftMouseUp, to)
                } else {
                    post(.leftMouseUp, from, clicks: double ? 2 : 1)
                }
                try? await Task.sleep(for: .milliseconds(600))
                log("after \(step): \(state())")
            }
        }
    }

    /**
     * RAWBOY_PROBE_SELFTEST=1: the batch's selection, keys, Clear batch, and the moves between Pro and Auto, checked with
     * real key events posted into the window; prints PASS or FAIL per item.
     */
    static func selfTestIfRequested(_ model: DesktopModel) {
        guard ProcessInfo.processInfo.environment["RAWBOY_PROBE_SELFTEST"] != nil else { return }
        Task { await selfTest(model) }
    }

    private static func selfTest(_ model: DesktopModel) async {
        let auto = model.auto
        let fm = FileManager.default
        let dir = fm.temporaryDirectory.appendingPathComponent("rawboy-selftest-\(UUID().uuidString.prefix(6))", isDirectory: true)
        try? fm.createDirectory(at: dir, withIntermediateDirectories: true)
        let sources = DesktopModel.photoFiles(in: [URL(fileURLWithPath: "/Users/oleksiymickevich/_github/RawBoy/.raw")])
        var files: [URL] = []
        for f in sources { let to = dir.appendingPathComponent(f.lastPathComponent); try? fm.copyItem(at: f, to: to); files.append(to) }
        func check(_ name: String, _ ok: Bool, _ detail: String = "") { log("\(ok ? "PASS" : "FAIL") \(name) \(detail)") }
        func waitIdle() async {
            while auto.photos.count < files.count || auto.photos.contains(where: { $0.status == .queued || $0.status == .analyzing }) {
                try? await Task.sleep(for: .milliseconds(100))
            }
        }
        func key(_ code: UInt16, _ flags: NSEvent.ModifierFlags = [], chars: String = "") async {
            guard let window = NSApp.windows.first(where: { $0.isVisible }) else { return }
            NSApp.activate(ignoringOtherApps: true)
            window.makeKeyAndOrderFront(nil)
            try? await Task.sleep(for: .milliseconds(300))
            for type in [NSEvent.EventType.keyDown, .keyUp] {
                let e = NSEvent.keyEvent(with: type, location: .zero, modifierFlags: flags, timestamp: ProcessInfo.processInfo.systemUptime,
                                         windowNumber: window.windowNumber, context: nil, characters: chars, charactersIgnoringModifiers: chars,
                                         isARepeat: false, keyCode: code)!
                NSApp.postEvent(e, atStart: false)
            }
            try? await Task.sleep(for: .milliseconds(300))
        }
        model.mode = .auto
        model.addToAuto([dir])
        await waitIdle()
        let n = auto.photos.count
        check("batch of \(n) photos", n == files.count)

        // Selection: ⌘A, Esc, ⇧-click range, ⌘-click toggle.
        await key(0, .command, chars: "a")
        check("⌘A selects all", auto.selection.count == n, "(\(auto.selection.count) of \(n))")
        await key(53)
        check("Esc clears the selection", auto.selection.isEmpty, "(\(auto.selection.count))")
        auto.selectAll()
        await key(53)
        check("Esc clears a selection too", auto.selection.isEmpty && auto.selected == nil, "(\(auto.selection.count))")
        auto.selectionAnchor = auto.photos[0].id
        auto.selectRange(to: auto.photos[n - 1].id)
        check("⇧-click first to last selects the range", auto.selection.count == n, "(\(auto.selection.count) of \(n))")
        auto.selection = []
        auto.selectionAnchor = auto.photos[1].id
        auto.selectRange(to: auto.photos[3].id)
        check("⇧-click from the anchor", auto.selection == Set(auto.photos[1...3].map(\.id)))
        auto.selection = []

        // Pro <-> Auto.
        let first = auto.photos[0]
        auto.focusedId = first.id
        await key(36, .command, chars: "\r")
        try? await Task.sleep(for: .seconds(4))
        check("⌘↩ edits the focused photo in Pro", model.mode == .pro && model.vm.currentURL?.path == first.url.path, "(\(model.mode), \(model.vm.currentURL?.lastPathComponent ?? "-"))")
        auto.focusedId = nil
        check("the batch is kept while in Pro", auto.photos.count == n)
        model.mode = .auto
        model.open(auto.photos[1].url)
        check("a photo handed over while Auto is active opens in Pro", model.mode == .pro)
        try? await Task.sleep(for: .seconds(3))
        model.sendToAuto()
        check("Send to Auto switches to Auto and focuses the photo", model.mode == .auto && auto.focusedId == auto.photos[1].id && auto.photos.count == n)

        // Clear batch: the confirmation is the root's; clearing keeps the files and sidecars.
        auto.requestClear()
        check("Clear batch asks first (request raised, nothing removed yet)", auto.photos.count == n)
        auto.clearBatch()
        check("clearing the batch empties it", auto.photos.isEmpty)
        check("and leaves the files", files.allSatisfy { fm.fileExists(atPath: $0.path) })
        log("selftest done")
        NSApp.terminate(nil)
    }

    /**
     * RAWBOY_PACK_PROBE=<file or folder>:...: copies them to a scratch folder, opens the Packer window (⇧⌘P), packs them in each
     * format into the scratch folder with the real model, and prints timings and sizes (a screenshot can be taken meanwhile).
     */
    static func packProbeIfRequested(_ model: DesktopModel) {
        guard let list = ProcessInfo.processInfo.environment["RAWBOY_PACK_PROBE"] else { return }
        Task { await packProbe(list.split(separator: ":").map { URL(fileURLWithPath: String($0)) }) }
    }

    private static func packProbe(_ inputs: [URL]) async {
        let fm = FileManager.default
        let scratch = fm.temporaryDirectory.appendingPathComponent("rawboy-pack-probe-\(UUID().uuidString.prefix(6))", isDirectory: true)
        let src = scratch.appendingPathComponent("raws", isDirectory: true)
        try? fm.createDirectory(at: src, withIntermediateDirectories: true)
        for (f, _) in PackerModel.rawFiles(in: inputs) { try? fm.copyItem(at: f, to: src.appendingPathComponent(f.lastPathComponent)) }
        log("pack scratch \(scratch.path)")
        NSApp.activate(ignoringOtherApps: true)
        if let window = NSApp.windows.first(where: { $0.isVisible }) {
            for type in [NSEvent.EventType.keyDown, .keyUp] {
                let e = NSEvent.keyEvent(with: type, location: .zero, modifierFlags: [.command, .shift], timestamp: ProcessInfo.processInfo.systemUptime,
                                         windowNumber: window.windowNumber, context: nil, characters: "P", charactersIgnoringModifiers: "p", isARepeat: false, keyCode: 35)!
                NSApp.postEvent(e, atStart: false)
            }
        }
        try? await Task.sleep(for: .seconds(2))
        log("windows: \(NSApp.windows.filter(\.isVisible).map { $0.title })")
        let model = PackerModel.shared
        model.add([src])
        while model.items.isEmpty || model.items.contains(where: { $0.status == .inspecting }) { try? await Task.sleep(for: .milliseconds(100)) }
        log("listed \(model.items.count) files: \(model.items.map { "\($0.url.lastPathComponent) \($0.status)" })")
        let originals = model.items.map(\.url)
        if ProcessInfo.processInfo.environment["RAWBOY_PACK_HOLD"] != nil { return }  // leave the window open for a screenshot
        for (tag, format) in [("small", PackFormat.small), ("lossless", .losslessJpeg), ("micro", .micro), ("losslessjxl", .losslessJxl)] {
            model.settings.format = format
            model.settings.maxSize = 2048
            model.settings.nameSuffix = true
            let t = Date()
            model.start()
            while model.running { try? await Task.sleep(for: .milliseconds(100)) }
            let done = model.items.filter { $0.status == .done }
            log("\(tag): \(String(format: "%.1f", Date().timeIntervalSince(t))) s, \(done.count) done, \(model.items.filter { $0.status == .failed }.count) failed, \(model.finished?.body ?? "-")")
            for i in done { log("  \(i.url.lastPathComponent) -> \(i.output?.lastPathComponent ?? "-") \(i.size) -> \(i.outputSize)") }
            // A second run gives new names, never overwriting.
            model.clear()
            model.add(originals)
            while model.items.isEmpty || model.items.contains(where: { $0.status == .inspecting }) { try? await Task.sleep(for: .milliseconds(100)) }
        }
        let outputs = ((try? fm.contentsOfDirectory(atPath: src.path)) ?? []).filter { $0.contains("-small") || $0.contains("-lossless") || $0.contains("-micro") }.sorted()
        log("outputs next to the sources: \(outputs)")
        log("pack probe done")
    }

    private static func log(_ s: String) {
        print("AUTOPROBE \(s)")
        fflush(stdout)
    }

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

        // RAWBOY_AUTO_SCAN=1: Film mode and the Film scan export option.
        let scanProbe = ProcessInfo.processInfo.environment["RAWBOY_AUTO_SCAN"] != nil
        if scanProbe {
            auto.setImportMode(.film)
            var settings = auto.exportSettings
            settings.filmScan = true
            auto.setExportSettings(settings)
            log("film scan on: \(auto.exportSettings.filmScan), film photos in the batch (before adding): \(auto.hasFilmPhotos)")
        }

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
        var ru = rusage()
        getrusage(RUSAGE_SELF, &ru)
        log("peak RSS \(ru.ru_maxrss / 1_048_576) MB")

        // 4. Export all.
        t = Date()
        auto.exportAll()
        while auto.export != nil { try? await Task.sleep(for: .milliseconds(100)) }
        let took = Date().timeIntervalSince(t)
        let files = (try? fm.contentsOfDirectory(atPath: exports.path)) ?? []
        var bytes = 0
        for f in files { bytes += ((try? fm.attributesOfItem(atPath: exports.appendingPathComponent(f).path)[.size]) as? Int) ?? 0 }
        log("export all: \(String(format: "%.2f", took)) s, \(files.count) files, \(bytes / 1_000_000) MB: \(files.sorted().joined(separator: ", "))")
        if scanProbe {
            for f in files.sorted() {
                let url = exports.appendingPathComponent(f)
                if let src = CGImageSourceCreateWithURL(url as CFURL, nil), let p = CGImageSourceCopyPropertiesAtIndex(src, 0, nil) as? [CFString: Any] {
                    log("  scan \(f): \(p[kCGImagePropertyPixelWidth] ?? 0) x \(p[kCGImagePropertyPixelHeight] ?? 0)")
                }
            }
        }
        log("message: \(auto.message ?? "-")")
        model.autoSidecars.flush()
        log("done")
        NSApp.terminate(nil)
    }
}
#endif
