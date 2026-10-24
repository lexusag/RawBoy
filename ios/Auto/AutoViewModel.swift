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
    /** When it was shot, else the file's date, as an EXIF date ([CaptureDate]); nil if unknown. Orders the batch. */
    var date: String?
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
    /** Which lens preset the photo gets (see Presets.chosenLensPreset): nil = by its lens, else a pick. */
    var lensChoice: String?
    /** The lens preset [lensChoice] gives, on top of the look or preset; nil = none. */
    var lensPreset: Preset?
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
        return LookApplier.develop(a.autoBase, look: activeLook, strength: strength, adjust: adjust, hasFace: a.stats.hasFace,
                                   preset: preset, lensPreset: lensPreset)
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

    /**
     * The look (or preset), strength, warmth, tint, contrast, saturation and grain of [source] ("Apply to all", "Copy previous");
     * brightness, denoise and rotation stay (they follow this photo's exposure, noise and framing).
     */
    mutating func takeLook(of source: AutoPhoto) {
        let s = source.adjust
        look = source.look
        mode = source.mode
        filmLook = source.filmLook
        strength = source.strength
        preset = source.preset
        looksApplied = true
        adjust.warmth = s.warmth
        adjust.tint = s.tint
        adjust.contrast = s.contrast
        adjust.saturation = s.saturation
        adjust.grain = s.grain
    }
}

/** Progress of "Export all". */
struct BatchExport: Equatable {
    var done: Int
    var total: Int
    var failed: Int
    var current: Float = 0
    /// Stop was pressed: the photo being exported finishes, the rest are left as they are.
    var stopping = false
}

@MainActor
final class AutoViewModel: ObservableObject {
    static let naming = OutputNaming(folder: "RawBoy Auto", suffix: "auto")
    /** Defaults of exportSettings (JPEG 92 with jpegli, 16-bit TIFF, full size). */
    static let settings = ExportSettings(format: .jpeg, jpegQuality: 92, tiffBits: 16, jpegEncoder: .jpegli)
    /** Export sizes offered (long side in pixels; nil = full resolution). */
    static let exportSizes: [Int?] = [nil, 5600, 4096, 2048, 1080]
    static let gridThumbnail = 512
    static let lookThumbnail = 192

    @Published private(set) var photos: [AutoPhoto] = []
    @Published private(set) var export: BatchExport?
    @Published var message: String?
    /** Photo shown in the detail view, or nil for the grid. */
    @Published private(set) var selected: String?
    /** A waiting photo tapped in the grid: analysed next, ahead of the rest, then opened (nil: none). */
    @Published private(set) var opening: String?
    /** Id of the photo [session] holds, once it has loaded. */
    @Published private(set) var sessionReady: String?
    /** The selected photo's cached preview while [session] is still decoding it; else nil. */
    @Published private(set) var cachedPreview: (id: String, image: PreviewImage)?
    /** Each analysed photo's detail preview, so a photo shows at once while [session] decodes it. */
    private let previews = PreviewCache(dir: FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
        .appendingPathComponent("auto-previews"))
    /** The mode photos are added in (Looks or Film), chosen in the grid before importing; remembered. */
    @Published private(set) var importMode: LookMode =
        UserDefaults.standard.string(forKey: importModeKey).flatMap(LookMode.init(rawValue:)) ?? .looks
    private static let importModeKey = "auto.importMode"
    /** How the batch is ordered: by shoot date (the default) or file name; remembered. */
    @Published private(set) var sort: PhotoSort =
        UserDefaults.standard.string(forKey: sortKey).flatMap(PhotoSort.init(rawValue:)) ?? .date
    private static let sortKey = "auto.sort"
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
    /**
     * Lens presets (Preset.isLensPreset) from RawBoy: each photo taken with a preset's lens gets its lens corrections on
     * top of its look or preset. Kept for later batches ([LensPresetStore]).
     */
    @Published private(set) var lensPresets: [Preset] = LensPresetStore.load()
    /** The lens preset choice for the whole batch, which photos added later get too (nil = by lens). */
    @Published private(set) var lensChoice: String?
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
    private var lookThumbs: [String: (adjust: Adjustments, lensPreset: Preset?, image: CGImage)] = [:]
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

    private func sorted(_ list: [AutoPhoto]) -> [AutoPhoto] {
        list.sorted { PhotoOrder.inOrder(sort, ($0.date, $0.name), ($1.date, $1.name)) }
    }

    /** Orders the batch by [sort] from now on. */
    func setSort(_ sort: PhotoSort) {
        self.sort = sort
        UserDefaults.standard.set(sort.rawValue, forKey: Self.sortKey)
        photos = sorted(photos)
    }

    /**
     * Adds imported files; already listed ones are skipped. They join the batch once their dates are read (ImageIO's
     * metadata, off the main actor), so it never reorders under the user's finger.
     */
    func add(_ urls: [URL]) {
        let known = Set(photos.map(\.id))
        let wanted = urls.filter { !known.contains($0.path) }
        if wanted.isEmpty { return }
        let (mode, preset, lensChoice) = (importMode, preset, lensChoice)
        Task {
            let dates = await Task.detached(priority: .userInitiated) { wanted.map(CaptureDate.read) }.value
            let now = Set(photos.map(\.id))
            let fresh = zip(wanted, dates).filter { !now.contains($0.0.path) }.map { url, date in
                AutoPhoto(url: url, name: Imports.displayName(url), date: date, mode: mode, preset: preset, lensChoice: lensChoice)
            }
            if fresh.isEmpty { return }
            photos = sorted(photos + fresh)
            if let note = Self.nonRawNote(fresh.map(\.name)) { message = note }
            processQueue()
        }
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
        if presets.allSatisfy(\.isLensPreset) {
            addLensPresets(presets)
        } else if presets.count == 1 {
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
        if presets.allSatisfy(\.isLensPreset) {
            addLensPresets(presets)
        } else if presets.count == 1 {
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
        if preset.isLensPreset {
            presetChoices = []
            addLensPresets([preset])
        } else if let ids { applyPreset(preset, to: ids) } else { applyPresetToAll(preset) }
    }

    /**
     * Keeps [presets] (lens presets) in place of those for the same lenses; photos taken with those lenses get their lens
     * corrections on top of their look or preset, now and in later batches.
     */
    private func addLensPresets(_ presets: [Preset]) {
        setLensPresets(presets.reduce(lensPresets, Presets.putLensPreset))
        let name = presets.count == 1 ? "Lens preset \(presets[0].name)" : "\(presets.count) lens presets"
        func lensKey(_ p: Preset) -> String? {
            let l = p.lens?.trimmingCharacters(in: .whitespaces).lowercased() ?? ""
            return l.isEmpty ? nil : l
        }
        if presets.allSatisfy({ lensKey($0) == nil }) {
            message = "\(name) saved: pick \(presets.count == 1 ? "it" : "them") under Lens presets"
            return
        }
        let lenses = Set(presets.compactMap(lensKey))
        let matched = photos.filter { p in p.lensPreset.flatMap(lensKey).map(lenses.contains) ?? false }.count
        let here = matched == 1 ? "1 photo" : "\(matched) photos"
        message = "\(name) saved for photos taken with \(presets.count == 1 ? "that lens" : "those lenses") (\(here) here)"
    }

    /** Forgets lens preset [id]; photos that picked it go back to matching by lens. */
    func removeLensPreset(_ id: String) {
        if lensChoice == id { lensChoice = nil }
        for p in photos where p.lensChoice == id { updatePhoto(p.id) { $0.lensChoice = nil } }
        setLensPresets(lensPresets.filter { $0.id != id })
    }

    /**
     * Gives the photos in [ids], or the whole batch and photos added later when nil, the lens preset [choice] (see
     * Presets.chosenLensPreset): manual lenses record no lens name, so their presets are picked by hand.
     */
    func chooseLensPreset(_ choice: String?, ids: Set<String>? = nil) {
        if export != nil { return }
        if ids == nil { lensChoice = choice }
        let targets = photos.filter { ids?.contains($0.id) ?? true }
        for p in targets {
            let next = p.analysis.flatMap { Presets.chosenLensPreset(lensPresets, choice: choice, lens: $0.lens.lensName) }
            changeDevelop(p.id, force: nil) {
                $0.lensChoice = choice
                $0.lensPreset = next
            }
        }
        let what: String
        if let choice {
            if choice == Presets.noLensPreset {
                what = "No lens preset"
            } else {
                guard let p = lensPresets.first(where: { $0.id == choice }) else { return }
                what = p.name
            }
        } else {
            what = "Lens presets by lens"
        }
        message = "\(what) for \(ids == nil ? "all photos" : targets.count == 1 ? "1 photo" : "\(targets.count) photos")"
    }

    private func setLensPresets(_ list: [Preset]) {
        lensPresets = list
        if !LensPresetStore.save(list) { message = "Could not save lens presets" }
        for p in photos {
            guard let lens = p.analysis?.lens.lensName else { continue }
            let next = Presets.chosenLensPreset(list, choice: p.lensChoice, lens: lens)
            if next != p.lensPreset { changeDevelop(p.id, force: nil) { $0.lensPreset = next } }
        }
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
        if let o = opening, ids.contains(o) { opening = nil }
        for id in ids {
            thumbTasks.removeValue(forKey: id)?.cancel()
            histories.removeValue(forKey: id)
            previews.remove(id)
        }
        if let c = cachedPreview, ids.contains(c.id) { cachedPreview = nil }
        lookThumbs = lookThumbs.filter { key, _ in !ids.contains(where: { key.hasPrefix($0 + "|") }) }
    }

    /** Analyses queued photos one at a time (each decode needs the full raw in memory). */
    private func processQueue() {
        if analysisTask != nil { return }
        analysisTask = Task {
            while let next = nextQueued() {
                updatePhoto(next.id) { $0.status = .analyzing }
                do {
                    let previews = previews
                    let analysis = try await decodeLock.run {
                        try await Task.detached(priority: .userInitiated) {
                            try AutoAnalysis.analyze(next.url) { previews.put(next.id, $0) }
                        }.value
                    }
                    if photo(next.id) == nil { previews.remove(next.id) } // removed while it was analysed
                    let look = LookSuggester.suggest(analysis.stats, asShotKelvin: analysis.defaults.temperature)
                    let film = LookSuggester.suggestFilm(analysis.stats, asShotKelvin: analysis.defaults.temperature)
                    updatePhoto(next.id) {
                        $0.status = .ready
                        $0.analysis = analysis
                        $0.suggested = look
                        $0.suggestedFilm = film
                        $0.lensPreset = Presets.chosenLensPreset(self.lensPresets, choice: $0.lensChoice, lens: analysis.lens.lensName)
                        if !$0.looksApplied {
                            $0.look = look
                            $0.filmLook = film
                        }
                    }
                    refreshThumbnail(next.id, immediate: true)
                    await openIfWaiting(next.id)
                } catch {
                    // Mark this photo and go on with the rest.
                    updatePhoto(next.id) {
                        $0.status = .failed
                        $0.error = error.localizedDescription
                    }
                    if opening == next.id { opening = nil }
                }
            }
            analysisTask = nil
        }
    }

    /** The photo to analyse next: the one tapped to open ([opening]) if it's still waiting, else the first waiting. */
    private func nextQueued() -> AutoPhoto? {
        if let id = opening, let p = photo(id), p.status == .queued { return p }
        return photos.first { $0.status == .queued }
    }

    /** Opens photo [id] now that it's analysed, if it was tapped while waiting and the grid is still showing. */
    private func openIfWaiting(_ id: String) async {
        guard opening == id else { return }
        opening = nil
        guard selected == nil else { return }
        openDetail(id)
        await Task.yield() // its decode takes the lock before the next analysis
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
        for p in photos where p.id != id {
            changeDevelop(p.id, force: true) { $0.takeLook(of: source) }
        }
        message = "\(source.lookName) applied to all photos"
    }

    /** The analysed photo before [id] in the batch (the one Swipe goes back to), for "Copy previous". */
    func previousPhoto(_ id: String) -> AutoPhoto? {
        let pages = photos.filter { $0.analysis != nil }
        guard let i = pages.firstIndex(where: { $0.id == id }), i > 0 else { return nil }
        return pages[i - 1]
    }

    /**
     * Gives photo [id] what "Apply to all" copies, from the photo before it ([previousPhoto]): look (or preset), strength,
     * brightness, warmth, tint, contrast, saturation and grain, as one undo step (a neighbouring shot of the same scene usually wants its
     * brightness too, unlike Apply to all); denoise and rotation stay. Not while exporting.
     */
    func copyPrevious(_ id: String) {
        if export != nil { return }
        guard let source = previousPhoto(id) else { return }
        changeDevelop(id, force: true) {
            $0.takeLook(of: source)
            $0.adjust.brightness = source.adjust.brightness
        }
        message = "Copied from \(source.name)"
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
        if let t = lookThumbs[key], t.adjust == p.adjust, t.lensPreset == p.lensPreset { return t.image }
        let params = LookApplier.develop(a.autoBase, look: look, strength: LookApplier.defaultStrength, adjust: p.adjust,
                                         hasFace: a.stats.hasFace, preset: nil, lensPreset: p.lensPreset)
        guard let image = try? await render(p, params, Self.lookThumbnail) else { return nil }
        lookThumbs[key] = (p.adjust, p.lensPreset, image)
        return image
    }

    /** True when the look-strip thumbnail of [look] on [id] matches the photo's current settings. */
    func hasCurrentLookThumbnail(_ id: String, _ look: Look) -> Bool {
        guard let p = photo(id), let t = lookThumbs[Self.thumbKey(id, look)] else { return false }
        return t.adjust == p.adjust && t.lensPreset == p.lensPreset
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

    /**
     * A photo tapped in the grid: opens it if it's analysed; one still waiting (or being analysed) is analysed next,
     * ahead of the rest, and opens when that's done.
     */
    func openFromGrid(_ id: String) {
        guard let p = photo(id), export == nil else { return }
        if p.analysis != nil {
            openDetail(id)
        } else if p.status == .queued || p.status == .analyzing {
            opening = id
        }
    }

    func openDetail(_ id: String) {
        guard let p = photo(id), p.analysis != nil, export == nil else { return }
        selected = id
        if sessionReady == id { return }
        sessionReady = nil
        if cachedPreview?.id != id {
            cachedPreview = nil
            let previews = previews
            Task {
                guard let image = await Task.detached(priority: .userInitiated, operation: { previews.get(id) }).value else { return }
                // Its look's LUT or film stock first, so the cached develop shows the look from the start.
                if let p = photo(id)?.params {
                    _ = try? await p.lut.asyncMap { try await loadLut($0) }
                    _ = try? await p.film.asyncMap { try await loadFilm($0) }
                }
                if selected == id, sessionReady != id { cachedPreview = (id, image) }
            }
        }
        Task {
            do {
                // Photos swiped past while an earlier decode ran are skipped: each decode takes seconds.
                let opened = try await decodeLock.run { () async throws -> Bool in
                    guard selected == id else { return false }
                    _ = try await session.open(p.url) { [weak self] in self?.photo(id)?.params ?? $0 }
                    return true
                }
                guard opened, selected == id else { return }
                session.selectLut(photo(id)?.params?.lut) { [weak self] in self?.message = $0 }
                session.selectFilm(photo(id)?.params?.film) { [weak self] in self?.message = $0 }
                sessionReady = id
                cachedPreview = nil
            } catch {
                message = error.localizedDescription
                selected = nil
            }
        }
    }

    func closeDetail() {
        session.exitZoom()
        selected = nil
        cachedPreview = nil
    }

    /**
     * Uniforms for showing [params] on photo [id]'s cached preview: the analysis's small copies, skin mask and lens
     * stand in for the session's (made from the same decode, so the develop matches). Nil if it isn't analysed. A LUT
     * or film stock not loaded yet is loaded and the view redrawn with it.
     */
    func cachedShaderParams(_ id: String, _ params: DevelopParams) -> ShaderParams? {
        guard let a = photo(id)?.analysis else { return nil }
        let lut = params.lut.flatMap { luts[$0] }
        let film = params.film.flatMap { films[$0] }
        if (params.lut != nil && lut == nil) || (params.film != nil && film == nil) {
            Task {
                _ = try? await params.lut.asyncMap { try await loadLut($0) }
                _ = try? await params.film.asyncMap { try await loadFilm($0) }
                // Only once loaded: a failed load would otherwise redraw and retry forever.
                let loaded = (params.lut.map { luts[$0] != nil } ?? true) && (params.film.map { films[$0] != nil } ?? true)
                if loaded { objectWillChange.send() }
            }
        }
        return ShaderParams.from(params, asShot: a.defaults, lut: lut, lens: LensTransform(info: a.lens, params: params),
                                 base: a.base, bloomSources: a.bloom, skinMask: a.skin, film: film)
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
            var attempted = 0
            var stopped = false
            for (index, item) in todo.enumerated() {
                if export?.stopping == true { stopped = true; break }
                guard let p = photo(item.id) else { continue }  // removed meanwhile
                updatePhoto(p.id) { $0.status = .exporting }
                attempted += 1
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
                export?.done = index + 1
                export?.failed = failed
                export?.current = 0
            }
            let saved = attempted - failed
            // Photos finished before Stop are already in Photos and stay there.
            message = (stopped ? "Stopped · " : "") + "Saved \(saved) \(saved == 1 ? "photo" : "photos") to Photos › \(Self.naming.folder)"
                + (failed > 0 ? " · \(failed) failed" : "")
            export = nil
            keepAwake(false)
        }
    }

    /// Stops "Export all" after the photo being exported; photos already saved stay.
    func stopExport() {
        if let e = export, e.total > 1 { export?.stopping = true }
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

/**
 * The lens presets RawBoy sent or the user opened (Preset.isLensPreset), as one preset file (`lens-presets.json`, the
 * same format as RawBoy's preset files) in app storage, so later batches get them too.
 */
enum LensPresetStore {
    private static var file: URL {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("lens-presets.json")
    }

    static func load() -> [Preset] {
        guard let text = try? String(contentsOf: file, encoding: .utf8) else { return [] }
        return ((try? Presets.decode(text)) ?? []).filter(\.isLensPreset)
    }

    /** Always an array, so one preset doesn't change the file's shape; written whole, then swapped in. */
    static func save(_ presets: [Preset]) -> Bool {
        let text = presets.isEmpty ? "[]" : presets.count == 1 ? "[\(Presets.encode(presets))]" : Presets.encode(presets)
        do {
            try FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
            try text.write(to: file, atomically: true, encoding: .utf8)
            return true
        } catch {
            return false
        }
    }
}
