import Combine
import CoreGraphics
import Foundation
import RawBoyEngine
import SwiftUI
import enum RawBoyBrowseKit.PhotoOrder
import enum RawBoyBrowseKit.PhotoSort
#if canImport(UIKit)
import UIKit
#endif

/** Where a photo is in the batch. */
enum PhotoStatus { case queued, analyzing, ready, failed, exporting, exported }

/** How photos are added: in a look mode, or "As is" (web's plain): no auto develop and no look, only what is applied. */
enum ImportMode: String, CaseIterable {
    case looks, film, plain

    var lookMode: LookMode { self == .film ? .film : .looks }
    var label: String { self == .plain ? "As is" : self == .film ? "Film" : "Looks" }
}

/** The grid's metadata filter (web's AutoFilter); nil fields don't filter. */
struct AutoFilter: Equatable {
    var camera: String?
    var lens: String?
    var isoMin: Int?
    var isoMax: Int?
    var focalMin: Int?
    var focalMax: Int?
    /** Shoot day, yyyy-mm-dd. */
    var date: String?
    /** Only photos still "As is" (see AutoPhoto.isUnedited). */
    var unedited = false

    var isActive: Bool { self != AutoFilter() }

    func matches(_ p: AutoPhoto) -> Bool {
        if unedited && !p.isUnedited { return false }
        if let camera, p.cameraLabel != camera { return false }
        if let lens, p.lensLabel != lens { return false }
        let iso = p.isoValue
        if let isoMin, (iso ?? -1) < isoMin { return false }
        if let isoMax, iso.map({ $0 > isoMax }) ?? true { return false }
        let focal = p.focalLengthValue
        if let focalMin, (focal ?? -1) < focalMin { return false }
        if let focalMax, focal.map({ $0 > focalMax }) ?? true { return false }
        if let date, p.day != date { return false }
        return true
    }
}

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

    /** Web-only parts of a photo's `rawboy:Auto` sidecar: kept and written back as they were. */
    var kept: SavedAuto?
    /** The camera, from the file's EXIF (CaptureDate.camera), for the Camera filter; nil if it names none. */
    var camera: String?
    /**
     * Added "As is" (web's plain): its analysis skips the auto develop, so the photo starts as the file itself, Natural
     * with nothing added; a preset, look or slider is all it gets.
     */
    var plain = false
    /**
     * Auto denoise on a photo added "As is": it gets the denoise, colour denoise and sharpening measured on it
     * (Analysis.measured) under its look or preset. Raws added "As is" start with it; ignored for other photos.
     */
    var autoDenoise = false
    /**
     * The develop the photo came back with from Pro ("Back to Auto", web's `edits`), in place of its look or preset, with
     * the adjustments on top (LookApplier.applyEditsDevelop); nil = none. The look and preset stay for when it's removed.
     */
    var edits: DevelopParams?
    /** Edits fields this engine doesn't know (written by the web), kept for the sidecar. */
    var editsExtras = EditsExtras()

    var id: String { url.path }

    /** What the sidecar keeps of this photo. */
    var saved: SavedAuto {
        var s = kept ?? SavedAuto()
        s.mode = mode
        s.look = look
        s.filmLook = filmLook
        s.strength = strength
        s.adjust = adjust
        s.preset = preset
        s.lensChoice = lensChoice
        s.lensPreset = lensChoice == nil || lensChoice == Presets.noLensPreset ? nil : lensPreset
        s.plain = plain
        s.autoDenoise = autoDenoise
        // Against the global defaults, as the web keeps them, so reading them back needs no analysis.
        s.edits = edits.flatMap { Edits.encode($0, defaults: DevelopParams(), keepEmpty: true, extras: editsExtras.values) }
            .flatMap { try? JSONSerialization.jsonObject(with: Data($0.utf8)) as? [String: Any] }
        return s
    }

    var activeLook: Look { mode == .film ? filmLook : look }

    /** What develops the photo, for labels: RawBoy edits, the preset's name, else the active look's. */
    var lookName: String {
        if edits != nil { return AutoPhoto.editsName }
        if let preset { return preset.name }
        return plain && activeLook.id == Looks.natural.id ? AutoPhoto.asIsName : activeLook.name
    }

    /** Label of a photo added "As is" while nothing is applied to it (web's AS_IS_NAME). */
    static let asIsName = "As is"

    /**
     * Still "As is" (web's isUnedited): added As is, the Natural look and nothing on top (no preset, lens preset, RawBoy
     * edits or slider). Photos added in a look mode always have the auto develop, so they never count. Auto denoise,
     * which raws added As is start with, doesn't count either.
     */
    var isUnedited: Bool {
        plain && activeLook.id == Looks.natural.id && preset == nil && lensPreset == nil && edits == nil && adjust == .none
    }

    /** The filters' values (web's photoCamera, photoLens, photoIso, photoFocalLength, photoDate); nil until known. */
    var cameraLabel: String? { analysis == nil ? nil : camera ?? "Unknown camera" }
    var lensLabel: String? {
        guard let a = analysis else { return nil }
        let l = a.lens.lensName.trimmingCharacters(in: .whitespaces)
        return l.isEmpty ? "Unknown lens" : l
    }
    var isoValue: Int? {
        guard let iso = analysis?.stats.iso, iso > 0 else { return nil }
        return Int(iso.rounded())
    }
    /** "ISO 6400" from the photo's EXIF, to judge its noise without zooming in (web's isoLabel); nil until analysed or unknown. */
    var isoLabel: String? { isoValue.map { "ISO \($0)" } }
    var focalLengthValue: Int? {
        guard let fl = analysis?.focalLength, fl > 0 else { return nil }
        return Int(fl.rounded())
    }
    var day: String? {
        guard let d = date?.trimmingCharacters(in: .whitespaces), d.count >= 10 else { return nil }
        return String(d.prefix(10)).replacingOccurrences(of: ":", with: "-")
    }

    /** The auto develop under the look or preset: the analysis's, with the measured denoise on an As is photo given Auto denoise. */
    private func autoBase(_ a: Analysis) -> DevelopParams {
        guard plain && autoDenoise else { return a.autoBase }
        var b = a.autoBase
        b.denoise = a.measured.denoise
        b.colorDenoise = a.measured.colorDenoise
        b.sharpening = a.measured.sharpening
        return b
    }

    /** Label of [edits] in place of a look (web's EDITS_NAME). */
    static let editsName = "RawBoy edits"

    /** The develop settings for the current look (or preset) and controls (nil until analysed). */
    var params: DevelopParams? {
        guard let a = analysis else { return nil }
        if var e = edits {
            // Edits read back from a sidecar don't know these as-shot facts about the file; the analysis does.
            e.displaySource = a.defaults.displaySource
            e.clipLevel = a.defaults.clipLevel
            return LookApplier.applyEditsDevelop(e, adjust: adjust)
        }
        return LookApplier.develop(autoBase(a), look: activeLook, strength: strength, adjust: adjust, hasFace: a.stats.hasFace,
                                   preset: preset, lensPreset: lensPreset)
    }
}

/** JSON values of RawBoy edits this engine doesn't know (Edits.Decoded.extras), carried as they came. */
struct EditsExtras: @unchecked Sendable {
    var values: [String: Any] = [:]
}

/** A photo's edits, as Undo and Redo bring them back. */
private struct Develop {
    var look: Look
    var mode: LookMode
    var filmLook: Look
    var strength: Float
    var adjust: Adjustments
    var preset: Preset?
    var edits: DevelopParams?
    var looksApplied: Bool
    var autoDenoise: Bool
}

private extension AutoPhoto {
    var develop: Develop {
        get {
            Develop(look: look, mode: mode, filmLook: filmLook, strength: strength, adjust: adjust, preset: preset, edits: edits,
                    looksApplied: looksApplied, autoDenoise: autoDenoise)
        }
        set {
            look = newValue.look
            mode = newValue.mode
            filmLook = newValue.filmLook
            strength = newValue.strength
            adjust = newValue.adjust
            preset = newValue.preset
            edits = newValue.edits
            looksApplied = newValue.looksApplied
            autoDenoise = newValue.autoDenoise
        }
    }

    /** "Reset all photos": see AutoReset. The photo keeps what it was given instead of its suggestion (looksApplied). */
    mutating func reset(to target: AutoReset.Target) {
        AutoReset.apply(target, look: &look, mode: &mode, filmLook: &filmLook, strength: &strength, adjust: &adjust, preset: &preset)
        edits = nil
        looksApplied = true
    }

    /**
     * The look (or preset), strength, warmth, tint, contrast, luma contrast, saturation, grain and retouch of [source] ("Apply to all", "Copy previous");
     * brightness, denoise and rotation stay (they follow this photo's exposure, noise and framing). RawBoy edits are dropped.
     */
    mutating func takeLook(of source: AutoPhoto) {
        let s = source.adjust
        look = source.look
        mode = source.mode
        filmLook = source.filmLook
        strength = source.strength
        preset = source.preset
        // RawBoy edits aren't copied (they hold the source's crop and masks); this photo's own give way to the look.
        edits = nil
        looksApplied = true
        adjust.warmth = s.warmth
        adjust.tint = s.tint
        adjust.contrast = s.contrast
        adjust.lumaContrast = s.lumaContrast
        adjust.saturation = s.saturation
        adjust.grain = s.grain
        adjust.retouch = s.retouch
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
    /// "Export all": the photos not yet done, the one being exported included. The grid shows them desaturated, so the
    /// batch can be followed as each turns to colour once saved.
    var waiting: Set<String> = []
    /// When it started, for the elapsed time and the estimate of the time left (BatchTime).
    var startedAt = Date()
}

/**
 * Keeps each photo's Auto settings with the photo (RawBoy Desktop: its `rawboy:Auto` sidecar). `restore` runs off the main
 * actor while photos are added; `changed` after every edit.
 */
protocol AutoPersistence: AnyObject, Sendable {
    func restore(_ url: URL) -> SavedAuto?
    @MainActor func changed(_ photo: AutoPhoto)
    /**
     * The photo's RawBoy edits kept beside it (RawBoy Desktop: `rawboy:Develop` and the Viewer's turn), read now (off the
     * main actor) and worked out against the as-shot defaults once the analysis has them; nil if it has none.
     */
    func sidecarEdits(_ url: URL) -> SidecarDevelop?
}

extension AutoPersistence {
    func sidecarEdits(_ url: URL) -> SidecarDevelop? { nil }
}

/** RawBoy edits read from a photo's sidecar: given its as-shot defaults (Analysis.defaults), the develop and unknown fields, or nil. */
typealias SidecarDevelop = @Sendable (DevelopParams) -> (params: DevelopParams, extras: EditsExtras)?

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
    /** Crop & rotate is open on the selected photo: it shows whole with a crop frame. */
    @Published var cropping = false
    /** Crop & rotate's shape: Original until changed, then the last one chosen, for this run of the app (not saved). */
    @Published var cropAspect = CropAspect.original
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
    /** How photos are added (Looks, Film or As is), chosen in the grid before importing; remembered. */
    @Published private(set) var importMode: ImportMode =
        UserDefaults.standard.string(forKey: importModeKey).flatMap(ImportMode.init(rawValue:)) ?? .looks
    /** The grid's metadata filter; navigation in the photo view and Export all follow the photos it shows. */
    @Published var filter = AutoFilter()

    /** The photos the filter lets through, in batch order. */
    var shown: [AutoPhoto] { filter.isActive ? photos.filter(filter.matches) : photos }
    private static let importModeKey = "auto.importMode"
    /** How the batch is ordered: by shoot date (the default) or file name; remembered. */
    @Published private(set) var sort: PhotoSort =
        UserDefaults.standard.string(forKey: sortKey).flatMap(PhotoSort.init(rawValue:)) ?? .date
    private static let sortKey = "auto.sort"
    /** Format, JPEG quality, TIFF bit depth, size and frame of exports, chosen in the grid; remembered. */
    @Published private(set) var exportSettings: ExportSettings = {
        var s = AutoViewModel.settings
        let defaults = UserDefaults.standard
        s.format = defaults.string(forKey: AutoViewModel.exportFormatKey)
            .flatMap(ExportFormat.init(rawValue:)) ?? s.format
        let size = defaults.integer(forKey: AutoViewModel.exportSizeKey)
        s.maxLongSide = AutoViewModel.exportSizes.contains(size) ? size : nil
        if let q = defaults.object(forKey: AutoViewModel.exportQualityKey) as? Int { s.jpegQuality = q.clamped(1, 100) }
        if defaults.integer(forKey: AutoViewModel.exportBitsKey) == 8 { s.tiffBits = 8 }
        s.photoFrame = defaults.string(forKey: AutoViewModel.exportPhotoFrameKey)
            .flatMap(PhotoFrame.init(rawValue:)) ?? s.photoFrame
        s.filmScan = defaults.bool(forKey: AutoViewModel.exportScanKey)
        s.dateStampFormat = defaults.string(forKey: AutoViewModel.exportDateStampFormatKey)
            .flatMap(DateStampFormat.init(rawValue:)) ?? s.dateStampFormat
        s.dateStampStyle = defaults.string(forKey: AutoViewModel.exportDateStampStyleKey)
            .flatMap(DateStampStyle.init(rawValue:)) ?? s.dateStampStyle
        s.timeStampFormat = defaults.string(forKey: AutoViewModel.exportTimeStampFormatKey)
            .flatMap(TimeStampFormat.init(rawValue:)) ?? s.timeStampFormat
        s.pentax645Fields = Pentax645Field.parseExportFields(defaults.string(forKey: AutoViewModel.exportPentax645FieldsKey))
        s.pentax645Order = Pentax645Field.parseExportOrder(defaults.string(forKey: AutoViewModel.exportPentax645OrderKey))
        if let flip = defaults.object(forKey: AutoViewModel.exportPentax645FlipKey) as? Bool { s.pentax645Flip = flip }
        s.frameColor = defaults.string(forKey: AutoViewModel.exportFrameColorKey)
            .flatMap(FilmFrameColor.init(rawValue:)) ?? s.frameColor
        return s
    }()
    private static let exportFormatKey = "auto.exportFormat"
    private static let exportSizeKey = "auto.exportMaxLongSide"
    private static let exportQualityKey = "auto.exportJpegQuality"
    private static let exportBitsKey = "auto.exportTiffBits"
    private static let exportScanKey = "auto.exportFilmScan"
    private static let exportPhotoFrameKey = "auto.exportPhotoFrame"
    private static let exportDateStampFormatKey = "auto.exportDateStampFormat"
    private static let exportDateStampStyleKey = "auto.exportDateStampStyle"
    private static let exportTimeStampFormatKey = "auto.exportTimeStampFormat"
    private static let exportPentax645FieldsKey = "auto.exportPentax645Fields"
    private static let exportPentax645OrderKey = "auto.exportPentax645Order"
    private static let exportPentax645FlipKey = "auto.exportPentax645Flip"
    private static let exportFrameColorKey = "auto.exportFrameColor"
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

    /** Photos' settings kept beside them (RawBoy Desktop's sidecars); nil on iOS. */
    var persistence: AutoPersistence?
    /**
     * Where exports go: the photo library's RawBoy Auto album on iOS; RawBoy Desktop sets a folder. [saveExported] gets the
     * file the exporter wrote (in the temporary folder, already named by the name template: move it) and the photo's file,
     * and returns the name the file got there (a name already taken gets -001, -002...).
     * [destinationView] is the export sheet's choice of destination, where there is one to make.
     */
    #if canImport(UIKit)
    var saveExported: (URL, URL) async throws -> String = { file, _ in
        let name = file.lastPathComponent
        try await PhotoLibraryOutput.save(file, naming: AutoViewModel.naming)
        return name
    }
    var destinationLabel = "Photos › \(AutoViewModel.naming.folder)"
    #else
    var saveExported: (URL, URL) async throws -> String = { file, _ in file.lastPathComponent }
    var destinationLabel = "the export folder"
    #endif
    var destinationView: AnyView?

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
    /** How many analyses run side by side: [lanes] (RawBoy Desktop's cores and memory allow more than one). */
    private var analysisLanes = 0
    /** RawBoy Desktop: each photo's analysis kept on disk by path, size and modified time (nil: none). */
    var analysisCache: AnalysisCache?
    /**
     * Analysis lanes: the first goes through [decodeLock] (one full decode at a time, with the detail view and export); the
     * others only run on the Mac, a third of its cores (at most 3) and one per 6 GB of memory, as the web does (`analysisLanes`).
     */
    static let lanes: Int = {
        #if os(macOS)
        let info = ProcessInfo.processInfo
        return max(1, min(3, info.activeProcessorCount / 3, Int(info.physicalMemory >> 30) / 6))
        #else
        return 1
        #endif
    }()
    private var thumbTasks: [String: Task<Void, Never>] = [:]
    /** Each photo's edits, for Undo and Redo in the photo view. */
    private var histories: [String: EditHistory<Develop>] = [:]

    init() {
        session = PhotoSession(lutLoader: { [unowned self] in try await self.loadLut($0) },
                               filmLoader: { [unowned self] in try await self.loadFilm($0) },
                               onMessage: { [unowned self] in self.message = $0 })
        #if os(macOS)
        // RawBoy Desktop: a lens preset saved, renamed or deleted in Pro's presets reaches the batch at once.
        presetsWatch = NotificationCenter.default.publisher(for: PresetStore.changed).sink { [weak self] _ in
            MainActor.assumeIsolated {
                guard let self else { return }
                let list = LensPresetStore.load()
                if list != self.lensPresets { self.useLensPresets(list) }
            }
        }
        #endif
    }
    #if os(macOS)
    private var presetsWatch: AnyCancellable?
    #endif

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
     *
     * [sidecarOnly] (RawBoy Desktop's Browse, Send to Auto › As is): the photos get only what their sidecars hold, nothing
     * added. A photo's `rawboy:Auto` comes back as it was left; else its RawBoy edits (`rawboy:Develop`, the Viewer's crop
     * and turn) develop it once analysed; else it stays the file as it is, without the measured denoise, and the batch's
     * preset and lens preset choice aren't applied either.
     */
    func add(_ urls: [URL], as how: ImportMode? = nil, sidecarOnly: Bool = false) {
        let known = Set(photos.map(\.id))
        let wanted = urls.filter { !known.contains($0.path) }
        if wanted.isEmpty { return }
        let importMode: ImportMode = sidecarOnly ? .plain : how ?? self.importMode
        let (preset, lensChoice): (Preset?, String?) = sidecarOnly ? (nil, Presets.noLensPreset) : (self.preset, self.lensChoice)
        let (mode, plain) = (importMode.lookMode, importMode == .plain)
        Task {
            let read = await Task.detached(priority: .userInitiated) { wanted.map { (CaptureDate.read($0), CaptureDate.camera($0)) } }.value
            let dates = read.map(\.0)
            let now = Set(photos.map(\.id))
            let persistence = persistence
            let restored = await Task.detached(priority: .userInitiated) {
                wanted.map { url in
                    let saved = persistence?.restore(url)
                    return (saved, saved == nil && sidecarOnly ? persistence?.sidecarEdits(url) : nil)
                }
            }.value
            let fresh: [AutoPhoto] = zip(zip(wanted, dates), restored).filter { !now.contains($0.0.0.path) }.map { pair, sidecar in
                let (saved, develop) = sidecar
                var p = AutoPhoto(url: pair.0, name: Imports.displayName(pair.0), date: pair.1, mode: mode, preset: preset, lensChoice: lensChoice)
                p.camera = read[wanted.firstIndex(of: pair.0) ?? 0].1
                // "As is": the file as it is; a raw gets its measured denoise (Auto denoise), a finished file nothing.
                // From Browse it gets nothing at all.
                p.plain = plain
                p.autoDenoise = plain && !sidecarOnly && Self.isRaw(p.name)
                if let saved { takeSaved(saved, into: &p) }
                if let develop {
                    pendingSidecarEdits[pair.0.path] = develop
                    p.looksApplied = true
                }
                if let e = pendingEdits.removeValue(forKey: pair.0.path) {
                    p.edits = e
                    p.adjust = .none
                    p.looksApplied = true
                }
                return p
            }
            if fresh.isEmpty { return }
            photos = sorted(photos + fresh)
            // "As is" is for finished files: no note that they aren't raws.
            if !plain, let note = Self.nonRawNote(fresh.map(\.name)) { message = note }
            processQueue()
        }
    }

    /** A photo's settings from its sidecar: it comes back as it was left (and keeps them instead of a suggestion). */
    private func takeSaved(_ s: SavedAuto, into p: inout AutoPhoto) {
        p.mode = s.mode
        p.look = s.look
        p.filmLook = s.filmLook
        p.strength = s.strength
        p.adjust = s.adjust
        p.preset = s.preset
        p.looksApplied = true
        p.kept = s
        p.plain = s.plain
        p.autoDenoise = s.autoDenoise
        if let e = s.edits, let data = try? JSONSerialization.data(withJSONObject: e),
           let decoded = Edits.decodeAll(String(decoding: data, as: UTF8.self), defaults: DevelopParams()) {
            p.edits = decoded.params
            p.editsExtras = EditsExtras(values: decoded.extras)
        }
        p.lensChoice = s.lensChoice
        if let picked = s.lensPreset {
            // The picked lens preset travels with the photo; the one in the list for that lens (if any) stands in for it.
            if let known = lensPresets.first(where: { Self.sameLens($0, picked) }) {
                p.lensChoice = known.id
            } else {
                setLensPresets(Presets.putLensPreset(lensPresets, picked))
                p.lensChoice = picked.id
            }
        }
    }

    private static func sameLens(_ a: Preset, _ b: Preset) -> Bool {
        (a.lens ?? "").trimmingCharacters(in: .whitespaces).lowercased() == (b.lens ?? "").trimmingCharacters(in: .whitespaces).lowercased()
            && a.name == b.name
    }

    /** File types Auto opens besides raws: already processed by the camera, so they give lower-quality results. */
    private static let nonRawExtensions: Set<String> = ["jpg", "jpeg", "heic", "heif", "png", "tif", "tiff"]

    /**
     * The lens name a by-lens preset is matched on. A photo added "As is" that isn't a raw (already corrected by whatever
     * made it) is never matched automatically; a preset picked by hand still applies.
     */
    static func matchLensName(_ p: AutoPhoto, _ a: Analysis) -> String {
        p.plain && a.defaults.displaySource ? "" : a.lens.lensName
    }

    /** A raw by its extension (not one of the finished formats Auto also opens). */
    static func isRaw(_ name: String) -> Bool { !nonRawExtensions.contains((name as NSString).pathExtension.lowercased()) }

    /** The note shown when an import includes non-raw photos, or nil. */
    static func nonRawNote(_ names: [String]) -> String? {
        let n = names.filter { nonRawExtensions.contains(($0 as NSString).pathExtension.lowercased()) }.count
        if n == 0 { return nil }
        let which = n == 1 ? "1 photo isn't RAW" : "\(n) photos aren't RAW"
        return "\(which): JPEG, HEIC, PNG and TIFF are already processed by the camera, "
            + "so results are lower quality than from RAW"
    }

    /** Mode for photos added from now on; photos already in the batch keep theirs. */
    func setImportMode(_ mode: ImportMode) {
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

    /** A preset picked from the user's saved ones: for the photos in [ids], or the whole batch (and photos added later) when nil. */
    func applyChosenPreset(_ preset: Preset, to ids: Set<String>?) { applyPreset(preset, target: ids) }

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
            let next = p.analysis.flatMap { Presets.chosenLensPreset(lensPresets, choice: choice, lens: Self.matchLensName(p, $0)) }
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
        if !LensPresetStore.save(list) { message = "Could not save lens presets" }
        useLensPresets(list)
    }

    /** [list] as the lens presets: a pick that was removed goes back to by lens, and each photo gets what its choice now gives. */
    private func useLensPresets(_ list: [Preset]) {
        lensPresets = list
        let kept: (String?) -> String? = { c in
            c == nil || c == Presets.noLensPreset || list.contains { $0.id == c } ? c : nil
        }
        lensChoice = kept(lensChoice)
        for p in photos where kept(p.lensChoice) != p.lensChoice {
            updatePhoto(p.id) { $0.lensChoice = nil }
            if let q = photo(p.id) { persistence?.changed(q) }
        }
        for p in photos {
            guard let lens = p.analysis.map({ Self.matchLensName(p, $0) }) else { continue }
            let next = Presets.chosenLensPreset(list, choice: p.lensChoice, lens: lens)
            if next != p.lensPreset { changeDevelop(p.id, force: nil, persist: false) { $0.lensPreset = next } }
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
        for p in photos { changeDevelop(p.id, force: true) { $0.preset = preset; $0.edits = nil } }
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
        for p in chosen { changeDevelop(p.id, force: true) { $0.preset = preset; $0.edits = nil } }
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

    /** "Use a look": takes the RawBoy edits off one photo, back to its preset or look. */
    func removeEdits(_ id: String) { changeDevelop(id, force: true) { $0.edits = nil } }

    /** Edits from Pro for photos still joining the batch ([receiveEdits] on a photo that wasn't in it), by path. */
    private var pendingEdits: [String: DevelopParams] = [:]
    /** Sidecar edits of photos sent from Browse ([add] with sidecarOnly), applied when their analysis is in, by path. */
    private var pendingSidecarEdits: [String: SidecarDevelop] = [:]

    /**
     * "Back to Auto" from Pro: develops [url]'s photo with [params] in place of its look or preset, Auto's controls back at
     * zero (the edits already hold what they did), as one undo step, and opens it. A photo not in the batch joins it with
     * them. False while exporting.
     */
    @discardableResult
    func receiveEdits(_ url: URL, _ params: DevelopParams) -> Bool {
        if export != nil { return false }
        guard let p = photo(url.path) else {
            pendingEdits[url.path] = params
            add([url])
            message = "\(Imports.displayName(url)) added to Auto with its RawBoy edits"
            return true
        }
        changeDevelop(p.id, force: true) {
            $0.edits = params
            $0.adjust = .none
            $0.looksApplied = true
        }
        if p.analysis != nil { openDetail(p.id) }
        return true
    }

    /** Template of the exported files' names (see NameTemplate), remembered (web's `rawboy.auto.nameTemplate`). */
    @Published private(set) var nameTemplate: String =
        UserDefaults.standard.string(forKey: AutoViewModel.nameTemplateKey).flatMap { $0.isEmpty ? nil : $0 } ?? NameTemplate.defaultTemplate
    private static let nameTemplateKey = "auto.nameTemplate"

    /** The template of the next exports' file names (an empty one means the default). */
    func setNameTemplate(_ template: String) {
        nameTemplate = template.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? NameTemplate.defaultTemplate : template
        UserDefaults.standard.set(nameTemplate, forKey: Self.nameTemplateKey)
    }

    /** The exported file's name without extension that [template] gives [p], numbered [index] in the export. */
    func nameFor(_ p: AutoPhoto, index: Int = 1, template: String? = nil) -> String {
        let lens = p.analysis?.lens.lensName.trimmingCharacters(in: .whitespaces)
        return NameTemplate.apply(template ?? nameTemplate, NameTemplate.Context(
            fileName: p.name, camera: p.camera?.trimmingCharacters(in: .whitespaces), lens: lens?.isEmpty == false ? lens : nil,
            iso: p.analysis?.stats.iso, look: p.lookName, date: p.date, index: index))
    }

    /**
     * [file] (the exporter's "<name>-auto.<ext>" in its temporary folder) renamed to what the name template gives [p] as
     * photo [index] of this export; the destination then picks a free name from it (NameTemplate.freeName).
     */
    private func named(_ file: URL, _ p: AutoPhoto, index: Int) throws -> URL {
        let fm = FileManager.default
        let dir = file.deletingLastPathComponent()
        let target = dir.appendingPathComponent(NameTemplate.fileName(nameFor(p, index: index), file.pathExtension, 0))
        if target.path == file.path { return file }
        var source = file
        if target.path.lowercased() == file.path.lowercased() {
            // Only the letter case differs: on a case-insensitive disk removing the target would remove the file itself.
            source = dir.appendingPathComponent(UUID().uuidString + "." + file.pathExtension)
            try fm.moveItem(at: file, to: source)
        }
        try? fm.removeItem(at: target)
        try fm.moveItem(at: source, to: target)
        return target
    }

    /** Format, quality, bit depth, size and frame for the next exports (maxLongSide nil = full resolution). */
    func setExportSettings(_ settings: ExportSettings) {
        exportSettings = settings
        let defaults = UserDefaults.standard
        defaults.set(settings.format.rawValue, forKey: Self.exportFormatKey)
        defaults.set(settings.jpegQuality, forKey: Self.exportQualityKey)
        defaults.set(settings.tiffBits, forKey: Self.exportBitsKey)
        defaults.set(settings.maxLongSide ?? 0, forKey: Self.exportSizeKey)
        defaults.set(settings.filmScan, forKey: Self.exportScanKey)
        defaults.set(settings.photoFrame.rawValue, forKey: Self.exportPhotoFrameKey)
        defaults.set(settings.dateStampFormat.rawValue, forKey: Self.exportDateStampFormatKey)
        defaults.set(settings.dateStampStyle.rawValue, forKey: Self.exportDateStampStyleKey)
        defaults.set(settings.timeStampFormat.rawValue, forKey: Self.exportTimeStampFormatKey)
        defaults.set(Pentax645Field.serialize(settings.pentax645Fields), forKey: Self.exportPentax645FieldsKey)
        defaults.set(Pentax645Field.serializeOrder(settings.pentax645Order), forKey: Self.exportPentax645OrderKey)
        defaults.set(settings.pentax645Flip, forKey: Self.exportPentax645FlipKey)
        defaults.set(settings.frameColor.rawValue, forKey: Self.exportFrameColorKey)
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
        for id in ids { warmPreviews.removeValue(forKey: id) }
        if let n = next, ids.contains(n.id) { discardNext() }
        lookThumbs = lookThumbs.filter { key, _ in !ids.contains(where: { key.hasPrefix($0 + "|") }) }
    }

    /** Analyses queued photos, [lanes] at a time (each decode needs the full raw in memory). */
    private func processQueue() {
        while analysisLanes < Self.lanes, nextQueued() != nil {
            let lane = analysisLanes
            analysisLanes += 1
            Task {
                await runLane(lane)
                analysisLanes -= 1
            }
        }
    }

    private func runLane(_ lane: Int) async {
        while let next = nextQueued() {
            updatePhoto(next.id) { $0.status = .analyzing }
            do {
                let previews = previews
                let cache = analysisCache
                let plain = next.plain
                let work: @Sendable () async throws -> Analysis = {
                    try await Task.detached(priority: .userInitiated) {
                        // "As is" skips the skin segmentation (no auto develop to steer), as the web's plain import does.
                        let a = try AutoAnalysis.analyze(next.url, cache: plain ? nil : cache, detectSkin: !plain) { previews.put(next.id, $0) }
                        return plain ? a.asIs() : a
                    }.value
                }
                let analysis = lane == 0 ? try await decodeLock.run(work) : try await work()
                if photo(next.id) == nil { previews.remove(next.id) } // removed while it was analysed
                let look = LookSuggester.suggest(analysis.stats, asShotKelvin: analysis.defaults.temperature)
                let film = LookSuggester.suggestFilm(analysis.stats, asShotKelvin: analysis.defaults.temperature)
                // Sent from Browse: its sidecar's RawBoy edits, against the as-shot defaults the analysis has just found.
                let fromSidecar = pendingSidecarEdits.removeValue(forKey: next.id).flatMap { $0(analysis.defaults) }
                updatePhoto(next.id) {
                    $0.status = .ready
                    if let fromSidecar, $0.edits == nil {
                        $0.edits = fromSidecar.params
                        $0.editsExtras = fromSidecar.extras
                        $0.adjust = .none
                    }
                    $0.analysis = analysis
                    $0.suggested = look
                    $0.suggestedFilm = film
                    $0.lensPreset = Presets.chosenLensPreset(self.lensPresets, choice: $0.lensChoice, lens: Self.matchLensName($0, analysis))
                    // A plain photo stays Natural (nothing added); its film suggestion is there if it switches to Film.
                    if !$0.looksApplied && !$0.plain {
                        $0.look = look
                        $0.filmLook = film
                    } else if !$0.looksApplied {
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
    }

    // MARK: - Keyboard (RawBoy Desktop)

    /** The grid's selection (long-press on iPhone; ⌘-click, ⇧-click and ⌘A on the Mac) and where a ⇧-click range starts. */
    @Published var selection = Set<String>()
    var selectionAnchor: String?
    /** Bumped by the "Clear batch" button and menu item: the root asks for confirmation. */
    @Published private(set) var clearRequest = 0
    /** RawBoy Desktop: opens a photo in the Pro editor / nil on iOS (the buttons then don't show). */
    var editInPro: ((AutoPhoto) -> Void)?

    func requestClear() { if export == nil && !photos.isEmpty { clearRequest += 1 } }

    /** Takes every photo out of the batch (files and sidecars stay where they are). */
    func clearBatch() {
        guard export == nil else { return }
        let n = photos.count
        remove(Set(photos.map(\.id)))
        selection = []
        focusedId = nil
        selectionAnchor = nil
        if n > 0 { message = n == 1 ? "1 photo removed from the batch" : "\(n) photos removed from the batch" }
    }

    /**
     * ⇧-click: the photos from the anchor to [id] join the selection. With nothing selected (after Esc, Cancel or at the
     * start) it selects [id] alone and makes it the anchor, so a fresh range is two ⇧-clicks and never runs on from an
     * earlier one (as on the web).
     */
    func selectRange(to id: String) {
        let photos = shown
        guard let end = photos.firstIndex(where: { $0.id == id }) else { return }
        focusedId = id
        guard !selection.isEmpty, let start = selectionAnchor.flatMap({ a in photos.firstIndex { $0.id == a } }) else {
            selection.insert(id)
            selectionAnchor = id
            return
        }
        for p in photos[min(start, end)...max(start, end)] { selection.insert(p.id) }
    }

    /** Esc in the grid and the selection bar's Cancel: nothing selected and no ⇧-click anchor left over. */
    func clearSelection() {
        selection = []
        selectionAnchor = nil
    }

    func selectAll() { selection = Set(shown.map(\.id)) }

    /** The grid's keyboard focus (arrow keys move it, Return opens it); UI state only. */
    @Published var focusedId: String?
    /** Bumped by the menu and ⌘E: the grid or the photo view opens its export sheet. */
    @Published private(set) var exportRequest = 0
    /** Index of the first photo of each grid row, as the grid last laid them out (for the up and down arrows). */
    var rowStarts: [Int] = []

    func requestExport() { exportRequest += 1 }

    /** Bumped by C in the photo view: it opens Crop & rotate, or puts it down when open (the view knows the frame's shape). */
    @Published private(set) var cropRequest = 0

    func requestCrop() { if selected != nil, export == nil { cropRequest += 1 } }

    /** Moves the grid's focus by [dx] photos and [dy] rows (the first arrow press focuses the first photo). */
    func moveFocus(dx: Int, dy: Int) {
        let photos = shown
        guard !photos.isEmpty else { return }
        guard let id = focusedId, let i = photos.firstIndex(where: { $0.id == id }) else {
            focusedId = photos[0].id
            return
        }
        var target = i + dx
        if dy != 0, !rowStarts.isEmpty {
            let row = rowStarts.lastIndex { $0 <= i } ?? 0
            let next = min(max(row + dy, 0), rowStarts.count - 1)
            let column = i - rowStarts[row]
            let end = next + 1 < rowStarts.count ? rowStarts[next + 1] : photos.count
            target = min(rowStarts[next] + column, end - 1)
        }
        focusedId = photos[min(max(target, 0), photos.count - 1)].id
    }

    /** Return in the grid: opens the focused photo (analysing it first if it still waits). */
    func openFocused() {
        if let id = focusedId { openFromGrid(id) }
    }

    /** Left and right in the photo view: the previous or next analysed photo. */
    func page(_ delta: Int) {
        guard let id = selected, export == nil, !cropping else { return }
        let pages = shown.filter { $0.analysis != nil }
        guard let i = pages.firstIndex(where: { $0.id == id }), pages.indices.contains(i + delta) else { return }
        openDetail(pages[i + delta].id)
    }

    /** Esc: out of Crop & rotate, else from the photo back to the grid, else the selection is cleared. */
    func goBack() {
        if selected == nil, !selection.isEmpty {
            clearSelection()
        } else if cropping {
            cropping = false
        } else if selected != nil {
            focusedId = selected
            closeDetail()
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

    /** Sliders (a drag is one undo step); [force] for a button. */
    func setAdjust(_ id: String, force: Bool = false, _ change: (inout Adjustments) -> Void) {
        changeDevelop(id, force: force) { change(&$0.adjust) }
    }

    /** White balance picker: sets warmth and tint so the tapped spot of the preview (fit or 100% view) renders neutral grey. */
    func pickWhite(_ id: String, _ x: Float, _ y: Float, frameWidth: Int) {
        guard let p = photo(id), let a = p.analysis, export == nil else { return }
        Task {
            guard let pick = await session.pickWhite(x, y, frameWidth: frameWidth, defaults: a.defaults),
                  photo(id)?.id == id else { return }
            switch pick {
            case .clipped:
                message = "That spot is blown out: pick a grey that isn't clipped"
            case .notNeutral:
                message = "No white balance makes that spot grey"
            case .white(let kelvin, let tint):
                guard let current = photo(id), let currentAnalysis = current.analysis else { return }
                let unadjusted = current.edits.map { LookApplier.applyEditsDevelop($0, adjust: .none) }
                    ?? LookApplier.develop(currentAnalysis.autoBase, look: current.activeLook, strength: current.strength,
                                           adjust: Adjustments.none, hasFace: currentAnalysis.stats.hasFace,
                                           preset: current.preset, lensPreset: current.lensPreset)
                let wb = LookApplier.whiteBalanceAdjust(unadjusted, kelvin: kelvin, tint: tint)
                setAdjust(id, force: true) { $0.warmth = wb.warmth; $0.tint = wb.tint }
            }
        }
    }

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
            changeDevelop(p.id, force: true) {
                $0.adjust.rotation = (($0.adjust.rotation + quarterTurns) % 4 + 4) % 4
                // The crop turns with the picture (the straighten angle stays: it is relative to the turned frame).
                $0.adjust.crop = $0.adjust.crop.map { CropMath.rotate($0, quarterTurns: quarterTurns) }
            }
        }
    }

    /** Crop & rotate: crops [id] to [crop] (fractions of the rotated + straightened frame; nil or the whole frame = uncropped). */
    func setCrop(_ id: String, _ crop: CropRect?, force: Bool = false) {
        let kept = crop.flatMap { $0.isFull ? nil : $0 }
        setAdjust(id, force: force) { $0.crop = kept }
    }

    /** Crop & rotate: straightens [id] by [degrees] (-45..45). */
    func setStraighten(_ id: String, _ degrees: Float, force: Bool = false) {
        setAdjust(id, force: force) { $0.straighten = degrees.clamped(-45, 45) }
    }

    /** Crop & rotate's Reset: no crop and a level horizon, one undo step. */
    func resetCrop(_ id: String) {
        setAdjust(id, force: true) { $0.crop = nil; $0.straighten = 0 }
    }

    /**
     * Gives every photo of the batch the look (or preset), lens preset choice, strength, warmth, tint, contrast, luma contrast, saturation, grain and retouch of [id], including
     * photos still being analysed (they keep it rather than their suggestion); brightness and denoise stay per photo (they follow
     * each photo's exposure and noise). Not while exporting.
     */
    func applyLookToAll(_ id: String) {
        if export != nil { return }
        guard let source = photo(id) else { return }
        for p in photos where p.id != id {
            changeDevelop(p.id, force: true) {
                $0.takeLook(of: source)
                takeLensChoice(&$0, of: source)
            }
        }
        message = "\(source.lookName) applied to all photos"
    }

    /** Bumped by the "Reset all photos" button and menu item: the root shows its sheet (count, target, a confirmation). */
    @Published private(set) var resetRequest = 0

    func requestReset() { if export == nil && !photos.isEmpty { resetRequest += 1 } }

    /**
     * Puts every photo of the batch back to [target] (AutoReset: preset, Strength and every adjustment cleared), photos still
     * being analysed included. Each photo gets its own undo step (Undo in its photo view brings its look and adjustments back)
     * and its sidecar is written as for any edit. The file list stays. Not while exporting. Returns how many photos.
     */
    @discardableResult
    func resetAll(to target: AutoReset.Target) -> Int {
        if export != nil { return 0 }
        let ids = photos.map(\.id)
        for id in ids { changeDevelop(id, force: true) { $0.reset(to: target) } }
        let what: String
        switch target {
        case .look(let l): what = l.name
        case .film(let f): what = f.name
        case .asIs: what = "As is"
        }
        message = ids.count == 1 ? "Photo reset to \(what)" : "\(ids.count) photos reset to \(what)"
        return ids.count
    }

    /**
     * [p] given [source]'s lens preset choice (Apply to all, Copy previous): the same pick, or "by lens" / none, worked out
     * for [p]'s own lens (a photo still being analysed gets its preset when the analysis is in).
     */
    private func takeLensChoice(_ p: inout AutoPhoto, of source: AutoPhoto) {
        p.lensChoice = source.lensChoice
        if let a = p.analysis {
            p.lensPreset = Presets.chosenLensPreset(lensPresets, choice: source.lensChoice, lens: Self.matchLensName(p, a))
        }
    }

    /** The analysed photo before [id] in the batch (the one Swipe goes back to), for "Copy previous". */
    func previousPhoto(_ id: String) -> AutoPhoto? {
        let pages = shown.filter { $0.analysis != nil }
        guard let i = pages.firstIndex(where: { $0.id == id }), i > 0 else { return nil }
        return pages[i - 1]
    }

    /**
     * Gives photo [id] what "Apply to all" copies, from the photo before it ([previousPhoto]): look (or preset), lens preset choice, strength,
     * brightness, warmth, tint, contrast, luma contrast, saturation, grain and retouch, as one undo step (a neighbouring shot of the same scene usually wants its
     * brightness too, unlike Apply to all); denoise and rotation stay. Not while exporting.
     */
    func copyPrevious(_ id: String) {
        if export != nil { return }
        guard let source = previousPhoto(id) else { return }
        changeDevelop(id, force: true) {
            $0.takeLook(of: source)
            takeLensChoice(&$0, of: source)
            $0.adjust.brightness = source.adjust.brightness
        }
        message = "Copied from \(source.name)"
    }

    /** [force]: its own undo step (false: a slider, coalesced; nil: Undo or Redo itself, not recorded). */
    private func changeDevelop(_ id: String, force: Bool? = false, persist: Bool = true, _ change: (inout AutoPhoto) -> Void) {
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
        if persist { persistence?.changed(p) }
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

    /**
     * "Auto denoise all", for a batch that's otherwise done: every photo gets the denoise, colour denoise and sharpening
     * the auto develop measured on it, so its Denoise slider goes back to 0 and presets (the batch's too, for photos
     * added later) lose their Denoise & sharpening group (Presets.withoutDenoise); looks, presets, lens corrections and
     * the other sliders stay. One undo step per photo. [ids] (the grid's selection): only those photos, and the batch
     * preset stays as it is. Not while exporting.
     */
    func autoDenoiseAll(_ ids: Set<String>? = nil) {
        guard export == nil else { return }
        if ids == nil, let batch = preset { preset = Presets.withoutDenoise(batch) }
        // A photo added "As is" has no auto develop: it gets the measured denoise from now on (autoDenoise).
        let changed = photos.filter {
            (ids == nil || ids!.contains($0.id))
                && ($0.adjust.denoise != 0 || ($0.plain && !$0.autoDenoise) || ($0.preset?.groups.contains(.denoise) ?? false))
        }
        for p in changed {
            changeDevelop(p.id, force: true) {
                $0.adjust.denoise = 0
                if $0.plain { $0.autoDenoise = true }
                $0.preset = $0.preset.flatMap(Presets.withoutDenoise)
            }
        }
        switch changed.count {
        case 0:
            message = ids == nil ? "Every photo already has its auto denoise"
                : ids!.count == 1 ? "This photo already has its auto denoise" : "These photos already have their auto denoise"
        case 1: message = "Auto denoise on 1 photo"
        default: message = "Auto denoise on \(changed.count) photos"
        }
    }

    /**
     * Takes the detail view's photo [id] out of the batch (nothing is deleted from the library) and opens the next
     * analysed photo, or the one before it at the batch's end; back to the grid when it was the last one.
     */
    func removeOpened(_ id: String) {
        guard let p = photo(id), export == nil else { return }
        let pages = shown.filter { $0.analysis != nil }
        let next: AutoPhoto? = pages.firstIndex { $0.id == id }.flatMap { i in
            i + 1 < pages.count ? pages[i + 1] : i > 0 ? pages[i - 1] : nil
        }
        remove([id])
        if let next { openDetail(next.id) }
        message = "\(p.name) removed from the batch"
    }

    // MARK: - Paging ahead (web's NeighbourPreload and prefetchNext)

    /** How many photos after / before the open one have their cached preview read ahead. */
    static let preloadAhead = 3
    static let preloadBehind = 2

    /**
     * Whether photos around the open one are warmed up: Macs and other machines that analyse in more than one lane (a
     * second full-resolution raw and five previews fit). Phones decode only the photo shown, as before.
     */
    static let pagesAhead = lanes > 1

    /**
     * The ids to warm around [current] in [ids] (the photo view's order): the next [preloadAhead] and the previous
     * [preloadBehind], nearest first, forward before backward at the same distance (people mostly step forward). Empty
     * if [current] isn't in the list.
     */
    static func preloadWindow(_ ids: [String], _ current: String?) -> [String] {
        guard let current, let at = ids.firstIndex(of: current) else { return [] }
        var out: [String] = []
        for d in 1...max(preloadAhead, preloadBehind) {
            if d <= preloadAhead, at + d < ids.count { out.append(ids[at + d]) }
            if d <= preloadBehind, at - d >= 0 { out.append(ids[at - d]) }
        }
        return out
    }

    /** The cached previews of the photos around the open one, read ahead with their LUT or film stock loaded. */
    private var warmPreviews: [String: PreviewImage] = [:]
    /** Bumped when the photo view moves on: a warm-up still running for the old window stops. */
    private var warmRun = 0

    /**
     * The photo after the open one, decoded at full resolution ahead of time ([prefetchNext]); taken by [openDetail] when
     * stepping to it, thrown away when anything else opens.
     */
    private var next: (id: String, task: Task<PhotoSession.Prepared?, Never>)?

    /**
     * Restarts the warm-up around [id] (nil: the photo view closed, everything is dropped): what left the window is
     * dropped, the rest read one at a time, nearest first, once the open photo is decoded (it always goes first).
     */
    private func preloadNeighbours(_ id: String?) {
        warmRun += 1
        let run = warmRun
        guard let id, Self.pagesAhead else {
            warmPreviews = [:]
            discardNext()
            return
        }
        let window = Self.preloadWindow(shown.filter { $0.analysis != nil }.map(\.id), id)
        let keep = Set(window)
        warmPreviews = warmPreviews.filter { keep.contains($0.key) }
        let todo = window.filter { warmPreviews[$0] == nil }
        guard !todo.isEmpty else { return }
        let previews = previews
        Task {
            for nid in todo {
                while warmRun == run, let s = selected, sessionReady != s { try? await Task.sleep(nanoseconds: 200_000_000) }
                guard warmRun == run else { return }
                guard let image = await Task.detached(priority: .utility, operation: { previews.get(nid) }).value else { continue }
                if let params = photo(nid)?.params {
                    _ = try? await params.lut.asyncMap { try await loadLut($0) }
                    _ = try? await params.film.asyncMap { try await loadFilm($0) }
                }
                guard warmRun == run else { return }
                warmPreviews[nid] = image
            }
        }
    }

    /** Frees the photo decoded ahead (once its decode finishes, if it's still running). */
    private func discardNext() {
        guard let n = next else { return }
        next = nil
        n.task.cancel()
        Task { await n.task.value?.image.close() }
    }

    /** Starts decoding the photo after [id], [id] being open: under the decode lock, so it waits for the work before it. */
    private func prefetchNext(_ id: String) {
        guard Self.pagesAhead else { return }
        let pages = shown.filter { $0.analysis != nil }
        guard let i = pages.firstIndex(where: { $0.id == id }), i + 1 < pages.count else { return discardNext() }
        let after = pages[i + 1]
        if next?.id == after.id { return }
        discardNext()
        let url = after.url
        let task = Task { () -> PhotoSession.Prepared? in
            try? await decodeLock.run { () async throws -> PhotoSession.Prepared? in
                // Discarded meanwhile (the user moved elsewhere) or an export started: nothing to decode.
                guard !Task.isCancelled, export == nil else { return nil }
                return try await Task.detached(priority: .utility) { try PhotoSession.prepare(url) }.value
            }
        }
        next = (after.id, task)
    }

    func openDetail(_ id: String) {
        guard let p = photo(id), p.analysis != nil, export == nil else { return }
        if selected != id { cropping = false }
        selected = id
        preloadNeighbours(id)
        if let n = next, n.id != id, sessionReady != id { discardNext() }
        if sessionReady == id { return prefetchNext(id) }
        sessionReady = nil
        // The photo decoded ahead, if this is it: taken now, so nothing else discards it.
        let ahead = next?.id == id ? next : nil
        if ahead != nil { next = nil }
        if cachedPreview?.id != id, let warm = warmPreviews[id] {
            cachedPreview = (id, warm)
        } else if cachedPreview?.id != id {
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
                // Outside the lock: the decode ahead takes the lock itself.
                let prepared = await ahead?.task.value
                // Photos swiped past while an earlier decode ran are skipped: each decode takes seconds.
                let opened = try await decodeLock.run { () async throws -> Bool in
                    guard selected == id else {
                        prepared?.image.close()
                        return false
                    }
                    let initial: (DevelopParams) -> DevelopParams = { [weak self] in self?.photo(id)?.params ?? $0 }
                    if let prepared {
                        _ = session.adopt(prepared, initialParams: initial)
                    } else {
                        _ = try await session.open(p.url, initialParams: initial)
                    }
                    return true
                }
                guard opened, selected == id else { return }
                session.selectLut(photo(id)?.params?.lut) { [weak self] in self?.message = $0 }
                session.selectFilm(photo(id)?.params?.film) { [weak self] in self?.message = $0 }
                sessionReady = id
                cachedPreview = nil
                prefetchNext(id)
            } catch {
                message = error.localizedDescription
                selected = nil
            }
        }
    }

    func closeDetail() {
        cropping = false
        session.exitZoom()
        // The grid comes back scrolled to the photo just viewed (it also carries the keyboard focus).
        if let selected { focusedId = selected }
        selected = nil
        cachedPreview = nil
        preloadNeighbours(nil)
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

    private func clearExported(only ids: Set<String>? = nil) {
        guard photos.contains(where: { $0.status == .exported && (ids?.contains($0.id) ?? true) }) else { return }
        for i in photos.indices where photos[i].status == .exported && (ids?.contains(photos[i].id) ?? true) {
            photos[i].status = .ready
        }
    }

    /** Some photo of the batch is developed as film (Film mode, or a preset with a film stock): the Film scan option applies to it. */
    var hasFilmPhotos: Bool {
        photos.contains { p in p.params.map { $0.film != nil && $0.filmAmount > 0 } ?? false }
    }

    /** Exports the detail view's photo from the already decoded image. */
    func exportSelected() {
        guard let id = sessionReady, let p = photo(id), let a = p.analysis, let params = p.params, export == nil else { return }
        clearExported(only: [id])
        export = BatchExport(done: 0, total: 1, failed: 0)
        let analysed = photos.filter { $0.analysis != nil }
        let frameNum = (analysed.firstIndex { $0.id == id } ?? 0) + 1
        var settings = exportSettings
        settings.frameNumber = frameNum
        settings.captureDate = p.date
        keepAwake(true)
        Task {
            updatePhoto(id) { $0.status = .exporting }
            var ok = false
            do {
                let file = try await decodeLock.run {
                    try await session.export(params, defaults: a.defaults, sourceName: p.name, settings: settings,
                                             naming: Self.naming) { f in Task { @MainActor in self.export?.current = f } }
                }
                let name = try await saveExported(try named(file, p, index: 1), p.url)
                message = "Saved \(name) to \(destinationLabel)"
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
        // Export all takes the photos the filter shows.
        let todo = (ids == nil ? shown : photos).filter { $0.analysis != nil && (ids?.contains($0.id) ?? true) }
        if todo.isEmpty { return }
        closeDetail()
        // The detail view's full-resolution image would double the memory each export needs.
        session.close()
        sessionReady = nil
        clearExported(only: ids)
        export = BatchExport(done: 0, total: todo.count, failed: 0, waiting: Set(todo.map(\.id)))
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
                    var itemSettings = settings
                    itemSettings.frameNumber = index + 1
                    itemSettings.captureDate = p.date
                    let file = try await decodeLock.run { try await exportOne(p, itemSettings) }
                    _ = try await saveExported(try named(file, p, index: index + 1), p.url)
                    ok = true
                } catch {
                    failed += 1
                    updatePhoto(p.id) { $0.error = error.localizedDescription }
                }
                updatePhoto(p.id) { $0.status = ok ? .exported : .failed }
                export?.waiting.remove(p.id)
                export?.done = index + 1
                export?.failed = failed
                export?.current = 0
            }
            let saved = attempted - failed
            // Photos finished before Stop are already in Photos and stay there.
            message = (stopped ? "Stopped · " : "") + "Saved \(saved) \(saved == 1 ? "photo" : "photos") to \(destinationLabel)"
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
        if p.edits != nil || params.portraitRetouch > 0 {
            // RawBoy edits can hold painted masks, lens blur and healing strokes, which the session builds (as Pro's export does).
            // Portrait retouch's map is made by the session too, from its preview and skin mask, as the photo view shows it.
            defer { session.close() }
            _ = try await session.open(p.url) { _ in params }
            await session.healNow()
            return try await session.export(params, defaults: a.defaults, sourceName: p.name, settings: settings,
                                            naming: Self.naming) { f in Task { @MainActor in self.export?.current = f } }
        }
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
    #if canImport(UIKit)
    private func keepAwake(_ on: Bool) { UIApplication.shared.isIdleTimerDisabled = on }
    #else
    private var activity: NSObjectProtocol?
    private func keepAwake(_ on: Bool) {
        if on, activity == nil {
            activity = ProcessInfo.processInfo.beginActivity(options: [.userInitiated, .idleSystemSleepDisabled], reason: "Exporting photos")
        } else if !on, let a = activity {
            ProcessInfo.processInfo.endActivity(a)
            activity = nil
        }
    }
    #endif
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
 * same format as RawBoy's preset files) in app storage, so later batches get them too. RawBoy Desktop keeps them in Pro's
 * presets file instead, as the web's Auto lists the RawBoy tab's lens presets: one saved in Pro's Lens tab is in Auto's
 * list at once, and one Auto keeps (from a sidecar) or removes is so in Pro too.
 */
enum LensPresetStore {
    private static var file: URL {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("lens-presets.json")
    }

    #if os(macOS)
    static func load() -> [Preset] {
        var all = PresetStore.load()
        // Before RawBoy Desktop shared Pro's file, Auto kept the lens presets of sidecars in their own: move them over once.
        if let text = try? String(contentsOf: file, encoding: .utf8) {
            let old = ((try? Presets.decode(text)) ?? []).filter(\.isLensPreset)
            let merged = old.reduce(all, Presets.putLensPreset)
            if merged == all || PresetStore.save(merged) {
                all = merged
                try? FileManager.default.removeItem(at: file)
            }
        }
        return all.filter(\.isLensPreset)
    }

    /** [presets] in place of the file's lens presets: kept ones stay where they were, the other presets are untouched. */
    static func save(_ presets: [Preset]) -> Bool {
        let all = PresetStore.load()
        var out: [Preset] = []
        var kept = Set<String>()
        for p in all {
            if !p.isLensPreset {
                out.append(p)
            } else if let now = presets.first(where: { $0.id == p.id }), !kept.contains(now.id) {
                out.append(now)
                kept.insert(now.id)
            }
        }
        out += presets.filter { !kept.contains($0.id) }
        return out == all || PresetStore.save(out)
    }
    #else
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
    #endif
}
