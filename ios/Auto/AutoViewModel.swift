import CoreGraphics
import Foundation
import RawBoyEngine
import UIKit

/** Where a photo is in the batch. */
enum PhotoStatus { case queued, analyzing, ready, failed, exporting, exported }

/** Which strip the Look tab shows: the LUT looks ([Looks]) or film stocks rendered as negative + print ([FilmLooks]). */
enum LookMode: String { case looks, film }

/**
 * One photo of the batch. Only small whole-image copies are kept (about 3 MB);
 * the full-resolution raw is decoded again for the detail view and for export.
 * [url] is the app's own copy of the file (see Imports).
 */
struct AutoPhoto: Identifiable {
    let url: URL
    let name: String
    var status: PhotoStatus = .queued
    var error: String?
    var analysis: Analysis?
    var look: Look = Looks.natural
    var suggested: Look = Looks.natural
    /** The look applied: [look] in Looks mode, [filmLook] in Film mode; each mode keeps its own pick. */
    var mode: LookMode = .looks
    var filmLook: Look = FilmLooks.portra400
    var suggestedFilm: Look = FilmLooks.portra400
    var strength: Float = LookApplier.defaultStrength
    var adjust: Adjustments = .none
    /** A RawBoy preset developing the photo in place of its look (see LookApplier.applyPreset), or nil. */
    var preset: Preset?
    /** True once "Apply to all" gave the photo its looks: its analysis then keeps them instead of the suggestions. */
    var looksApplied = false
    var thumbnail: CGImage?

    var id: String { url.path }

    var activeLook: Look { mode == .film ? filmLook : look }

    /** What develops the photo, for labels: the preset's name, else the active look's. */
    var lookName: String { preset?.name ?? activeLook.name }

    /** The develop settings for the current look (or preset) and controls (nil until analysed). */
    var params: DevelopParams? {
        guard let a = analysis else { return nil }
        if let preset { return LookApplier.applyPreset(a.autoBase, preset: preset, adjust: adjust) }
        return LookApplier.apply(a.autoBase, look: activeLook, strength: strength, adjust: adjust, hasFace: a.stats.hasFace)
    }
}

/** A photo's edits, as Undo and Redo bring them back. */
private struct Develop {
    var look: Look
    var mode: LookMode
    var filmLook: Look
    var strength: Float
    var adjust: Adjustments
    var preset: Preset?
    var looksApplied: Bool
}

private extension AutoPhoto {
    var develop: Develop {
        get { Develop(look: look, mode: mode, filmLook: filmLook, strength: strength, adjust: adjust, preset: preset, looksApplied: looksApplied) }
        set {
            look = newValue.look
            mode = newValue.mode
            filmLook = newValue.filmLook
            strength = newValue.strength
            adjust = newValue.adjust
            preset = newValue.preset
            looksApplied = newValue.looksApplied
        }
    }
}

/** Progress of "Export all". */
struct BatchExport: Equatable {
    var done: Int
    var total: Int
    var failed: Int
    var current: Float = 0
}

@MainActor
final class AutoViewModel: ObservableObject {
    static let naming = OutputNaming(folder: "RawBoy Auto", suffix: "auto")
    /** Defaults of exportSettings (JPEG 92 with jpegli, 16-bit TIFF, full size). */
    static let settings = ExportSettings(format: .jpeg, jpegQuality: 92, tiffBits: 16, jpegEncoder: .jpegli)
    /** Export sizes offered (long side in pixels; nil = full resolution). */
    static let exportSizes: [Int?] = [nil, 4096, 2048, 1080]
    static let gridThumbnail = 512
    static let lookThumbnail = 192

    @Published private(set) var photos: [AutoPhoto] = []
    @Published private(set) var export: BatchExport?
    @Published var message: String?
    /** Photo shown in the detail view, or nil for the grid. */
    @Published private(set) var selected: String?
    /** Id of the photo [session] holds, once it has loaded. */
    @Published private(set) var sessionReady: String?
    /** The mode photos are added in (Looks or Film), chosen in the grid before importing; remembered. */
    @Published private(set) var importMode: LookMode =
        UserDefaults.standard.string(forKey: importModeKey).flatMap(LookMode.init(rawValue:)) ?? .looks
    private static let importModeKey = "auto.importMode"
    /** Format, JPEG quality, TIFF bit depth and size of exports, chosen in the grid; remembered. */
    @Published private(set) var exportSettings: ExportSettings = {
        var s = AutoViewModel.settings
        s.format = UserDefaults.standard.string(forKey: AutoViewModel.exportFormatKey)
            .flatMap(ExportFormat.init(rawValue:)) ?? s.format
        let defaults = UserDefaults.standard
        let size = defaults.integer(forKey: AutoViewModel.exportSizeKey)
        s.maxLongSide = AutoViewModel.exportSizes.contains(size) ? size : nil
        if let q = defaults.object(forKey: AutoViewModel.exportQualityKey) as? Int { s.jpegQuality = q.clamped(1, 100) }
        if defaults.integer(forKey: AutoViewModel.exportBitsKey) == 8 { s.tiffBits = 8 }
        return s
    }()
    private static let exportFormatKey = "auto.exportFormat"
    private static let exportSizeKey = "auto.exportMaxLongSide"
    private static let exportQualityKey = "auto.exportJpegQuality"
    private static let exportBitsKey = "auto.exportTiffBits"
    /** Frame around the photo in the detail view's fit view (as RawBoy's); tap outside the photo to cycle it. Remembered. */
    @Published private(set) var frameColor: FrameColor =
        FrameColor.allCases.first { "\($0)" == UserDefaults.standard.string(forKey: frameKey) } ?? .grey
    private static let frameKey = "auto.frame"

    /** Single tap in the detail preview: outside the photo (fit view, [frameWidth] in pixels) cycles the frame colour. */
    func onPreviewTap(_ x: Float, _ y: Float, frameWidth: Int) {
        if session.zoomCenter != nil || !session.hasImage { return }
        if session.fitToImage(x, y, frameWidth: frameWidth) != nil { return }
        frameColor = frameColor.next()
        UserDefaults.standard.set("\(frameColor)", forKey: Self.frameKey)
    }

    /** The RawBoy preset applied to the whole batch, which photos added later get too; nil = looks. */
    @Published private(set) var preset: Preset?
    /** Presets of an opened file that held several, to pick one from; empty when no choice is pending. */
    @Published var presetChoices: [Preset] = []
    /** The photos [presetChoices] are for: nil = the whole batch. */
    private var presetTarget: Set<String>?

    /** The detail view's photo, decoded at full resolution (preview, 100% view, single export). */
    private(set) var session: PhotoSession!

    private let thumbnails = ThumbnailRenderer()
    /**
     * Look-strip thumbnails: the latest one per photo and look, with the adjustments it was
     * rendered at (slider drags would otherwise pile up one image per value).
     */
    private var lookThumbs: [String: (adjust: Adjustments, image: CGImage)] = [:]
    /** Every bundled look's LUT stays loaded once used: about 3 MB each. */
    private var luts: [String: LutData] = [:]
    /** Film stocks likewise (two 33^3 LUTs each, under 1 MB). */
    private var films: [String: FilmData] = [:]
    /**
     * Full-resolution decodes (analysis, detail view, export) take hundreds of MB each; one at a
     * time keeps a batch from stacking them up.
     */
    private let decodeLock = AsyncLock()
    private var analysisTask: Task<Void, Never>?
    private var thumbTasks: [String: Task<Void, Never>] = [:]
    /** Each photo's edits, for Undo and Redo in the photo view. */
    private var histories: [String: EditHistory<Develop>] = [:]

    init() {
        session = PhotoSession(lutLoader: { [unowned self] in try await self.loadLut($0) },
                               filmLoader: { [unowned self] in try await self.loadFilm($0) },
                               onMessage: { [unowned self] in self.message = $0 })
    }

    /** Adds imported files; already listed ones are skipped. */
    func add(_ urls: [URL]) {
        let known = Set(photos.map(\.id))
        let fresh = urls.filter { !known.contains($0.path) }.map {
            AutoPhoto(url: $0, name: Imports.displayName($0), mode: importMode, preset: preset)
        }
        if fresh.isEmpty { return }
        photos += fresh
        if let note = Self.nonRawNote(fresh.map(\.name)) { message = note }
        processQueue()
    }

    /** File types Auto opens besides raws: already processed by the camera, so they give lower-quality results. */
    private static let nonRawExtensions: Set<String> = ["jpg", "jpeg", "heic", "heif", "png", "tif", "tiff"]

    /** The note shown when an import includes non-raw photos, or nil. */
    static func nonRawNote(_ names: [String]) -> String? {
        let n = names.filter { nonRawExtensions.contains(($0 as NSString).pathExtension.lowercased()) }.count
        if n == 0 { return nil }
        let which = n == 1 ? "1 photo isn't RAW" : "\(n) photos aren't RAW"
        return "\(which): JPEG, HEIC, PNG and TIFF are already processed by the camera, "
            + "so results are lower quality than from RAW"
    }

    /** Mode for photos added from now on; photos already in the batch keep theirs. */
    func setImportMode(_ mode: LookMode) {
        importMode = mode
        UserDefaults.standard.set(mode.rawValue, forKey: Self.importModeKey)
    }

    /**
     * Reads a RawBoy preset file (.rawboy.json, as RawBoy exports or shares it, also from Android or RawBoy Web) and
     * applies it to the batch, or to the photos in [ids] (the grid's selection) when given; a file with several presets
     * asks which one ([presetChoices]).
     */
    func openPresetFile(_ url: URL, ids: Set<String>? = nil) {
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        guard let data = try? Data(contentsOf: url), let text = String(data: data, encoding: .utf8),
              let presets = try? Presets.decode(text), let first = presets.first else {
            message = "Not a RawBoy preset file"
            return
        }
        if presets.count == 1 {
            applyPreset(first, target: ids)
        } else {
            presetTarget = ids
            presetChoices = presets
        }
    }

    /** RawBoy's "Send to Auto" link: rawboy-auto://preset?json=<the preset file, base64url>. */
    func openPresetLink(_ url: URL) {
        let json = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.first { $0.name == "json" }?.value
        guard let json, let data = Data(base64URLEncoded: json), let text = String(data: data, encoding: .utf8),
              let presets = try? Presets.decode(text), let first = presets.first else {
            message = "Not a RawBoy preset"
            return
        }
        if presets.count == 1 {
            applyPresetToAll(first)
        } else {
            presetTarget = nil
            presetChoices = presets
        }
    }

    /** Applies one of [presetChoices] to the photos they were opened for. */
    func choosePreset(_ preset: Preset) {
        let ids = presetTarget
        presetTarget = nil
        applyPreset(preset, target: ids)
    }

    private func applyPreset(_ preset: Preset, target ids: Set<String>?) {
        if let ids { applyPreset(preset, to: ids) } else { applyPresetToAll(preset) }
    }

    /**
     * Develops every photo, and those added later, with [preset] in place of its look: all the preset holds, lens
     * corrections included, on top of each photo's auto develop. Each photo keeps its look for when the preset is removed.
     */
    func applyPresetToAll(_ preset: Preset) {
        presetChoices = []
        if export != nil { return }
        self.preset = preset
        for p in photos { changeDevelop(p.id, force: true) { $0.preset = preset } }
        message = "\(preset.name) applied to all photos"
    }

    /**
     * Develops only the photos in [ids] (the grid's selection, e.g. one scene) with [preset], so one batch can hold a
     * preset per scene. The batch preset, which photos added later get, stays as it is.
     */
    func applyPreset(_ preset: Preset, to ids: Set<String>) {
        presetChoices = []
        if export != nil { return }
        let chosen = photos.filter { ids.contains($0.id) }
        for p in chosen { changeDevelop(p.id, force: true) { $0.preset = preset } }
        message = "\(preset.name) applied to \(chosen.count == 1 ? "1 photo" : "\(chosen.count) photos")"
    }

    /**
     * Takes the batch preset off the photos it develops (and photos added later): each goes back to its look. Photos
     * given another preset on a selection keep theirs.
     */
    func removePreset() {
        guard export == nil, let batch = preset else { return }
        preset = nil
        for p in photos where p.preset == batch { changeDevelop(p.id, force: true) { $0.preset = nil } }
    }

    /** Takes the preset off one photo, back to its look; the batch preset stays for photos added later. */
    func removePhotoPreset(_ id: String) { changeDevelop(id, force: true) { $0.preset = nil } }

    /** Format, quality, bit depth and size for the next exports (maxLongSide nil = full resolution). */
    func setExportSettings(_ settings: ExportSettings) {
        exportSettings = settings
        let defaults = UserDefaults.standard
        defaults.set(settings.format.rawValue, forKey: Self.exportFormatKey)
        defaults.set(settings.jpegQuality, forKey: Self.exportQualityKey)
        defaults.set(settings.tiffBits, forKey: Self.exportBitsKey)
        defaults.set(settings.maxLongSide ?? 0, forKey: Self.exportSizeKey)
    }

    /**
     * Takes photos out of the batch (not while exporting) and deletes the app's copies; the originals stay where they
     * were. A photo that is being analysed finishes in the background and is then dropped.
     */
    func remove(_ ids: Set<String>) {
        if ids.isEmpty || export != nil { return }
        if let s = selected, ids.contains(s) { closeDetail() }
        if let r = sessionReady, ids.contains(r) {
            session.close()  // frees the full-resolution image
            sessionReady = nil
        }
        for p in photos where ids.contains(p.id) { Imports.delete(p.url) }
        photos.removeAll { ids.contains($0.id) }
        for id in ids {
            thumbTasks.removeValue(forKey: id)?.cancel()
            histories.removeValue(forKey: id)
        }
        lookThumbs = lookThumbs.filter { key, _ in !ids.contains(where: { key.hasPrefix($0 + "|") }) }
    }

    /** Analyses queued photos one at a time (each decode needs the full raw in memory). */
    private func processQueue() {
        if analysisTask != nil { return }
        analysisTask = Task {
            while let next = photos.first(where: { $0.status == .queued }) {
                updatePhoto(next.id) { $0.status = .analyzing }
                do {
                    let analysis = try await decodeLock.run {
                        try await Task.detached(priority: .userInitiated) { try AutoAnalysis.analyze(next.url) }.value
                    }
                    let look = LookSuggester.suggest(analysis.stats, asShotKelvin: analysis.defaults.temperature)
                    let film = LookSuggester.suggestFilm(analysis.stats, asShotKelvin: analysis.defaults.temperature)
                    updatePhoto(next.id) {
                        $0.status = .ready
                        $0.analysis = analysis
                        $0.suggested = look
                        $0.suggestedFilm = film
                        if !$0.looksApplied {
                            $0.look = look
                            $0.filmLook = film
                        }
                    }
                    refreshThumbnail(next.id, immediate: true)
                } catch {
                    // Mark this photo and go on with the rest.
                    updatePhoto(next.id) {
                        $0.status = .failed
                        $0.error = error.localizedDescription
                    }
                }
            }
            analysisTask = nil
        }
    }

    private func updatePhoto(_ id: String, _ change: (inout AutoPhoto) -> Void) {
        guard let i = photos.firstIndex(where: { $0.id == id }) else { return }
        change(&photos[i])
    }

    func photo(_ id: String) -> AutoPhoto? { photos.first { $0.id == id } }

    // MARK: - Look and controls

    /** Sets the look of the photo's current mode (a film look in Film mode, a LUT look otherwise). */
    func setLook(_ id: String, _ look: Look) {
        changeDevelop(id, force: true) { if $0.mode == .film { $0.filmLook = look } else { $0.look = look } }
    }

    func setMode(_ id: String, _ mode: LookMode) { changeDevelop(id, force: true) { $0.mode = mode } }

    func setStrength(_ id: String, _ strength: Float) { changeDevelop(id) { $0.strength = strength } }

    /** Sliders (a drag is one undo step). */
    func setAdjust(_ id: String, _ change: (inout Adjustments) -> Void) { changeDevelop(id) { change(&$0.adjust) } }

    func canUndo(_ id: String) -> Bool { histories[id]?.canUndo ?? false }
    func canRedo(_ id: String) -> Bool { histories[id]?.canRedo ?? false }

    /** Takes photo [id]'s last edit back (not while exporting). */
    func undo(_ id: String) { restore(id) { h, d in h.undo(d) } }
    func redo(_ id: String) { restore(id) { h, d in h.redo(d) } }

    private func restore(_ id: String, _ step: (inout EditHistory<Develop>, Develop) -> Develop?) {
        guard export == nil, let p = photo(id), var h = histories[id], let d = step(&h, p.develop) else { return }
        histories[id] = h
        changeDevelop(id, force: nil) { $0.develop = d }
    }

    /** Turns the analysed photos among [ids] by [quarterTurns] clockwise quarter turns (negative = left); not while exporting. */
    func rotate(_ ids: Set<String>, by quarterTurns: Int) {
        if export != nil { return }
        for p in photos where ids.contains(p.id) && p.analysis != nil {
            changeDevelop(p.id, force: true) { $0.adjust.rotation = (($0.adjust.rotation + quarterTurns) % 4 + 4) % 4 }
        }
    }

    /**
     * Gives every photo of the batch the look (or preset), strength, warmth, tint, contrast, saturation and grain of [id], including
     * photos still being analysed (they keep it rather than their suggestion); brightness and denoise stay per photo (they follow
     * each photo's exposure and noise). Not while exporting.
     */
    func applyLookToAll(_ id: String) {
        if export != nil { return }
        guard let source = photo(id) else { return }
        let s = source.adjust
        for p in photos where p.id != id {
            changeDevelop(p.id, force: true) {
                $0.look = source.look
                $0.mode = source.mode
                $0.filmLook = source.filmLook
                $0.strength = source.strength
                $0.preset = source.preset
                $0.looksApplied = true
                $0.adjust.warmth = s.warmth
                $0.adjust.tint = s.tint
                $0.adjust.contrast = s.contrast
                $0.adjust.saturation = s.saturation
                $0.adjust.grain = s.grain
            }
        }
        message = "\(source.lookName) applied to all photos"
    }

    /** [force]: its own undo step (false: a slider, coalesced; nil: Undo or Redo itself, not recorded). */
    private func changeDevelop(_ id: String, force: Bool? = false, _ change: (inout AutoPhoto) -> Void) {
        let old = photo(id)
        let before = old?.params
        if let old, let force { histories[id, default: EditHistory()].record(old.develop, force: force) }
        updatePhoto(id, change)
        guard let p = photo(id) else { return }
        if sessionReady == id, let params = p.params {
            session.setParams(params)
            // Only a look change (or Strength reaching 0) changes the LUT or stock; slider drags must not reload them.
            if params.lut != before?.lut { session.selectLut(params.lut) { [weak self] in self?.message = $0 } }
            if params.film != before?.film { session.selectFilm(params.film) { [weak self] in self?.message = $0 } }
        }
        refreshThumbnail(id, immediate: false)
    }

    /** Re-renders the grid thumbnail; slider drags are debounced. */
    private func refreshThumbnail(_ id: String, immediate: Bool) {
        thumbTasks[id]?.cancel()
        thumbTasks[id] = Task {
            if !immediate { try? await Task.sleep(nanoseconds: 250_000_000) }
            guard !Task.isCancelled, let p = photo(id), let params = p.params,
                  let image = try? await render(p, params, Self.gridThumbnail), !Task.isCancelled else { return }
            updatePhoto(id) { $0.thumbnail = image }
        }
    }

    /** [look] on photo [id] at the default strength with its adjustments, small, for the look strip. */
    func lookThumbnail(_ id: String, _ look: Look) async -> CGImage? {
        guard let p = photo(id), let a = p.analysis else { return nil }
        let key = Self.thumbKey(id, look)
        if let t = lookThumbs[key], t.adjust == p.adjust { return t.image }
        let params = LookApplier.apply(a.autoBase, look: look, strength: LookApplier.defaultStrength, adjust: p.adjust,
                                       hasFace: a.stats.hasFace)
        guard let image = try? await render(p, params, Self.lookThumbnail) else { return nil }
        lookThumbs[key] = (p.adjust, image)
        return image
    }

    /** True when the look-strip thumbnail of [look] on [id] matches the photo's current settings. */
    func hasCurrentLookThumbnail(_ id: String, _ look: Look) -> Bool {
        guard let p = photo(id), let t = lookThumbs[Self.thumbKey(id, look)] else { return false }
        return t.adjust == p.adjust
    }

    /** Film stocks share ids with the LUT looks of the same name (portra400...), so their thumbnails get their own keys. */
    private static func thumbKey(_ id: String, _ look: Look) -> String { id + "|" + (look.film.map { "film:" + $0 } ?? look.id) }

    private func render(_ p: AutoPhoto, _ params: DevelopParams, _ size: Int) async throws -> CGImage {
        guard let a = p.analysis else { throw RawImageError(message: "not analysed") }
        let lut = try await params.lut.asyncMap { try await loadLut($0) }
        let film = try await params.film.asyncMap { try await loadFilm($0) }
        let shader = ShaderParams.from(params, asShot: a.defaults, lut: lut, lens: LensTransform(info: a.lens, params: params),
                                       base: a.base, bloomSources: a.bloom, skinMask: a.skin, film: film)
        return try await thumbnails.render(shader, preview: a.base, maxDimension: size)
    }

    private func loadLut(_ id: String) async throws -> LutData {
        if let l = luts[id] { return l }
        let data = try await Task.detached(priority: .userInitiated) { try LutLoader.load(id) }.value
        luts[id] = data
        return data
    }

    private func loadFilm(_ id: String) async throws -> FilmData {
        if let f = films[id] { return f }
        let data = try await Task.detached(priority: .userInitiated) {
            guard let stock = try FilmStocks.byId(id) else { throw RawImageError(message: "Unknown film stock \(id)") }
            return try FilmStocks.load(stock)
        }.value
        films[id] = data
        return data
    }

    // MARK: - Detail view

    func openDetail(_ id: String) {
        guard let p = photo(id), p.analysis != nil, export == nil else { return }
        selected = id
        if sessionReady == id { return }
        sessionReady = nil
        Task {
            do {
                _ = try await decodeLock.run {
                    try await session.open(p.url) { [weak self] in self?.photo(id)?.params ?? $0 }
                }
                guard selected == id else { return }
                session.selectLut(photo(id)?.params?.lut) { [weak self] in self?.message = $0 }
                session.selectFilm(photo(id)?.params?.film) { [weak self] in self?.message = $0 }
                sessionReady = id
            } catch {
                message = error.localizedDescription
                selected = nil
            }
        }
    }

    func closeDetail() {
        session.exitZoom()
        selected = nil
    }

    // MARK: - Export

    /** Exports the detail view's photo from the already decoded image. */
    func exportSelected() {
        guard let id = sessionReady, let p = photo(id), let a = p.analysis, let params = p.params, export == nil else { return }
        export = BatchExport(done: 0, total: 1, failed: 0)
        let settings = exportSettings
        keepAwake(true)
        Task {
            updatePhoto(id) { $0.status = .exporting }
            var ok = false
            do {
                let file = try await decodeLock.run {
                    try await session.export(params, defaults: a.defaults, sourceName: p.name, settings: settings,
                                             naming: Self.naming) { f in Task { @MainActor in self.export?.current = f } }
                }
                try await PhotoLibraryOutput.save(file, naming: Self.naming)
                message = "Saved \(file.lastPathComponent) to Photos › \(Self.naming.folder)"
                ok = true
            } catch {
                message = "Export failed: \(error.localizedDescription)"
            }
            updatePhoto(id) { $0.status = ok ? .exported : .ready }
            export = nil
            keepAwake(false)
        }
    }

    /**
     * Exports every analysed photo in turn (only those in [ids] when given: the grid's selection), decoding each again;
     * a failure skips to the next.
     */
    func exportAll(only ids: Set<String>? = nil) {
        guard export == nil else { return }
        let todo = photos.filter { $0.analysis != nil && (ids?.contains($0.id) ?? true) }
        if todo.isEmpty { return }
        closeDetail()
        // The detail view's full-resolution image would double the memory each export needs.
        session.close()
        sessionReady = nil
        export = BatchExport(done: 0, total: todo.count, failed: 0)
        let settings = exportSettings
        keepAwake(true)
        Task {
            var failed = 0
            for (index, item) in todo.enumerated() {
                guard let p = photo(item.id) else { continue }  // removed meanwhile
                updatePhoto(p.id) { $0.status = .exporting }
                var ok = false
                do {
                    let file = try await decodeLock.run { try await exportOne(p, settings) }
                    try await PhotoLibraryOutput.save(file, naming: Self.naming)
                    ok = true
                } catch {
                    failed += 1
                    updatePhoto(p.id) { $0.error = error.localizedDescription }
                }
                updatePhoto(p.id) { $0.status = ok ? .exported : .failed }
                export = BatchExport(done: index + 1, total: todo.count, failed: failed)
            }
            let saved = todo.count - failed
            message = "Saved \(saved) \(saved == 1 ? "photo" : "photos") to Photos › \(Self.naming.folder)"
                + (failed > 0 ? " · \(failed) failed" : "")
            export = nil
            keepAwake(false)
        }
    }

    private func exportOne(_ p: AutoPhoto, _ settings: ExportSettings) async throws -> URL {
        guard let a = p.analysis, let params = p.params else { throw RawImageError(message: "not analysed") }
        let lut = try await params.lut.asyncMap { try await loadLut($0) }
        let film = try await params.film.asyncMap { try await loadFilm($0) }
        return try await Task.detached(priority: .userInitiated) {
            let img = try RawImage.open(url: p.url)
            defer { img.close() }
            // A preset's Blemish removal heals the full-resolution image, as the detail view does.
            if params.blemishRemoval > 0, let skin = a.skin, skin.hasSkin {
                img.healBlemishes(blemishesToHeal(img.detectBlemishes(skin), level: params.blemishRemoval))
            }
            // The stored 512/128 px copies were made from this same file, so they match.
            let shader = ShaderParams.from(params, asShot: a.defaults, lut: lut,
                                           lens: LensTransform(info: img.lens, params: params), base: a.base,
                                           bloomSources: a.bloom, skinMask: a.skin, film: film)
            return try Exporter().export(img, sourceName: p.name, params: shader, settings: settings,
                                         naming: Self.naming) { f in Task { @MainActor in self.export?.current = f } }
        }.value
    }

    /** A batch export can take minutes; don't let the screen sleep and suspend it. */
    private func keepAwake(_ on: Bool) { UIApplication.shared.isIdleTimerDisabled = on }
}

/** One at a time, in order: Swift's counterpart of the Kotlin Mutex around full-resolution decodes. */
actor AsyncLock {
    private var busy = false
    private var waiters: [CheckedContinuation<Void, Never>] = []

    func run<T>(_ body: @MainActor () async throws -> T) async rethrows -> T {
        if busy {
            await withCheckedContinuation { waiters.append($0) }
        } else {
            busy = true
        }
        defer {
            if waiters.isEmpty { busy = false } else { waiters.removeFirst().resume() }
        }
        return try await body()
    }
}

extension Data {
    /** Base64url (RFC 4648 §5: - and _ for + and /, padding optional), as "Send to Auto" links carry presets. */
    init?(base64URLEncoded s: String) {
        var b = s.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        b += String(repeating: "=", count: (4 - b.count % 4) % 4)
        self.init(base64Encoded: b)
    }
}
