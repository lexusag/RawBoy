import Foundation
import RawBoyEngine

/** Which raw the camera records (both at 12 MP). */
enum RawFormat: String, CaseIterable {
    /** The sensor's own Bayer data: one exposure, like a camera's raw; noisy in low light on the small lenses. */
    case bayer
    /**
     * Apple ProRAW: several frames merged by the camera, demosaiced and linear. Much cleaner in low light (tested on
     * the iPhone 17 Pro Max), so the default. 12 MP like Bayer; 48 MP costs 4x the decode and memory for photos
     * saved at 3000 px by default.
     */
    case proRaw
}

enum FlashMode: String { case off, on }

/** Mutually exclusive film frame / stamp imprint options in the Frames settings submenu. */
enum PhotoFrame: String, CaseIterable, Sendable {
    case none = "NONE"
    case dateStamp = "DATE_STAMP"
    case pentax645 = "PENTAX_645"

    var label: String {
        switch self {
        case .none: return "Off"
        case .dateStamp: return "Date stamp"
        case .pentax645: return "Pentax 645"
        }
    }
}

/** Individual shoot-info items that can be toggled on the PhotoFrame.pentax645 top rebate. */
enum Pentax645Field: String, CaseIterable, Sendable {
    case frameNumber = "frame"
    case mode = "mode"
    case shutter = "shutter"
    case aperture = "aperture"
    case exposureComp = "ev"
    case metering = "metering"
    case focalLength = "focal"
    case iso = "iso"
    case dateTime = "datetime"

    var label: String {
        switch self {
        case .frameNumber: return "Frame #"
        case .mode: return "Mode"
        case .shutter: return "Shutter"
        case .aperture: return "Aperture"
        case .exposureComp: return "EV"
        case .metering: return "Metering"
        case .focalLength: return "Focal length"
        case .iso: return "ISO"
        case .dateTime: return "Date & time"
        }
    }

    static let defaultSet: Set<Pentax645Field> = Set(allCases)

    static func parseSet(_ raw: String?) -> Set<Pentax645Field> {
        guard let raw else { return defaultSet }
        if raw.trimmingCharacters(in: .whitespaces).isEmpty { return [] }
        return Set(raw.split(separator: ",").compactMap { Pentax645Field(rawValue: $0.trimmingCharacters(in: .whitespaces)) })
    }

    static func serialize(_ fields: Set<Pentax645Field>) -> String {
        allCases.filter { fields.contains($0) }.map(\.rawValue).joined(separator: ",")
    }
}

/** The look controls, camera choice and output settings. */
struct CameraSettings: Equatable {
    var lookId = Edition.defaultLookId
    var strength: Float = LookApplier.defaultStrength
    var brightness: Float = 0
    var warmth: Float = 0
    /**
     * B&W mode (Edition.monoLooks): the photo is black and white, on monoLookId's stock seen through
     * filter, whether Film is on or not (only black and white looks in B&W: owner's choice, 2026-10-31). Colour mode
     * keeps lookId and warmth, so switching back and forth keeps each mode's picks.
     */
    var mono = false
    var monoLookId = Edition.defaultMonoLookId
    /**
     * Film mode (the Film toggle, Edition.filmLooks): colour photos on filmLookId's film stock instead of
     * lookId's LUT look. Each mode keeps its own pick; Strength, Brightness and Warmth are shared. B&W mode wins over
     * it, but leaves it on, so leaving B&W comes back to it.
     * On by default (owner's choice, 2026-10-31).
     */
    var film = true
    var filmLookId = Edition.defaultFilmLookId
    /** B&W mode's colour filter; Yellow, the classic default (it also keeps the noisy blue channel out of night shots). */
    var filter = BwFilter.yellow
    /** JPEG quality, minQuality...100. */
    var jpegQuality = 95
    /** Keep the raw as DNG in Photos › RawBoy Camera RAW. */
    var keepDng = false
    /** Save photos at smallLongSide px on the long side instead of full size. */
    var smallExport = true
    /**
     * Keep the camera (facing, lens), look and sliders between launches. Off: each launch starts on the back
     * W lens with the default look and sliders. Output settings and calibration are always kept.
     */
    var rememberLast = false
    /** A live RGB histogram in a corner of the viewfinder. */
    var showHistogram = false
    /** A 3 x 3 grid over the viewfinder (rule of thirds). Off by default. */
    var showGrid = false
    /** A level line over the viewfinder that turns yellow when the phone is straight. Off by default. */
    var showLevel = false
    /** Save where each photo was taken (GPS tags in the JPEG and DNG). Location access is asked for when turned on. */
    var geotag = false
    /** Frame / stamp option: Off by default, or Date stamp / Pentax 645 (mutually exclusive). */
    var photoFrame = PhotoFrame.none
    /** Date order for PhotoFrame.dateStamp and Pentax645Field.dateTime: DD MM 'YY by default. */
    var dateStampFormat = DateStampFormat.dmy
    /** Shoot-info items imprinted on the PhotoFrame.pentax645 rebate (all on by default). */
    var pentax645Fields: Set<Pentax645Field> = Pentax645Field.defaultSet
    /** Play the camera shutter click on each shot. Where the law requires it, iOS plays it regardless. */
    var shutterSound = false
    /** Look for QR codes in the viewfinder and offer to open them, as the system camera does. */
    var scanQr = true
    /** After a tap, keep focus on what was tapped as it moves (CameraViewModel's tracker); off = the focus stays put. */
    var trackFocus = false
    /**
     * Per camera (lensKey): gain from the linearised preview to raw units (1.0 = sensor clip), learned
     * from each shot (raw key / viewfinder key), so the viewfinder's auto exposure matches the final.
     */
    var previewScales: [String: Float] = [:]
    /** Selfie camera instead of the back cameras. */
    var front = false
    /** Lens label within the current side: UW, W, T. */
    var lens = "W"
    var flash = FlashMode.off
    var rawFormat = RawFormat.proRaw

    /** The lens's key for per-lens values: the label, prefixed with "F" on the front side, "P" for ProRAW. */
    var lensKey: String { Self.lensKey(front, lens, rawFormat) }
    var previewScale: Float { previewScales[lensKey] ?? Self.defaultScale }
    /** B&W mode is on and this edition has one. */
    var monoMode: Bool { mono && !Edition.monoLooks.isEmpty }
    /** Film mode is on (and B&W mode isn't) and this edition has one. */
    var filmMode: Bool { film && !monoMode }
    /** B&W with Film on too: the black and white looks with filmMonoContrast and more grain (see grainStrength). */
    var filmMono: Bool { monoMode && film }
    /** The look in effect: B&W mode's stock, Film mode's stock or the colour look. */
    var look: Look {
        if monoMode { return Edition.monoLook(monoLookId) }
        if filmMode { return Edition.filmLook(filmLookId) }
        return Edition.look(lookId)
    }

    /**
     * base (the auto develop) with the look and the sliders, as the viewfinder shows it and the shot is saved. B&W mode:
     * the filter, then grey (Saturation -100 makes the scene grey before the stock and keeps the stock's output grey, see
     * `applyLut`), so Strength blends the stock's tones with plain AgX grey and the picture stays black and white;
     * Warmth isn't shown there and doesn't apply. With Film on too (filmMono) it has filmMonoContrast more contrast.
     * Mirrors Android's CameraSettings.develop.
     */
    func develop(_ base: DevelopParams, hasFace: Bool) -> DevelopParams {
        let adjust = Adjustments(brightness: brightness, warmth: monoMode ? 0 : warmth,
                                 contrast: filmMono ? Self.filmMonoContrast : 0)
        var p = LookApplier.apply(base, look: look, strength: strength, adjust: adjust, hasFace: hasFace)
        if monoMode {
            p.saturation = -100
            p.bwFilter = filter
            return p
        }
        if look.film != nil { return p }
        // LUT and neutral looks have no film grain and scatter to hide shadow noise, and a LUT steepens the shadows
        // (Redscale ~4x): clean the shadows more than the ISO table does. Mirrors Android CameraSettings.develop.
        let luma = look.experimental ? Self.lutLumaDenoiseExperimental : Self.lutLumaDenoise
        let color = look.experimental ? Self.lutColorDenoiseExperimental : Self.lutColorDenoise
        p.denoise = max(p.denoise, luma)
        p.colorDenoise = max(p.colorDenoise ?? p.denoise, color)
        // Neutral and plain LUT looks start a little punchier than Auto's base; see Android CameraSettings.LOOK_*.
        if !look.experimental {
            p.contrast = min(100, p.contrast + Self.lookContrast)
            p.saturation = min(100, p.saturation + Self.lookSaturation)
        }
        return p
    }

    /// Denoise floors for non-Film colour looks (2026-11-07); see Android CameraSettings.LUT_*.
    static let lutLumaDenoise: Float = 12
    static let lutColorDenoise: Float = 70
    static let lutLumaDenoiseExperimental: Float = 22
    static let lutColorDenoiseExperimental: Float = 70
    static let lookContrast: Float = 6
    static let lookSaturation: Float = 8

    /** Exposure compensation (EV) set by the Brightness slider (`brightness` in -100..+100 -> -3.0..+3.0 EV). */
    var exposureCompensationEv: Float { brightness / 100 * LookApplier.brightnessEv }

    /** The long side to save at, or nil for full size. */
    var maxLongSide: Int? { smallExport ? Self.smallLongSide : nil }

    static let minQuality = 70
    static let smallLongSide = 3000
    /** Film + B&W: added to the Contrast slider's value (owner's choice, 2026-10-31: punchier than plain B&W). */
    static let filmMonoContrast: Float = 20
    /** Light sharpening after the downscale to smallLongSide (luma unsharp mask, `band_ops.h`); full size gets none. */
    static let smallSharpen: Float = 0.5
    /** First guess before a lens's first shot: an sRGB preview's middle grey (0.18) at a camera raw's key (~0.06). */
    static let defaultScale: Float = 0.35
    static let minScale: Float = 1.0 / 32
    static let maxScale: Float = 32

    static func lensKey(_ front: Bool, _ lens: String, _ format: RawFormat) -> String {
        (format == .proRaw ? "P" : "") + (front ? "F" : "") + lens
    }
}

enum CameraSettingsStore {
    private static let d = UserDefaults.standard

    static func load() -> CameraSettings {
        let def = CameraSettings()
        var s = CameraSettings()
        s.jpegQuality = min(max(d.object(forKey: "camera.jpegQuality") as? Int ?? def.jpegQuality, CameraSettings.minQuality), 100)
        s.keepDng = d.object(forKey: "camera.keepDng") as? Bool ?? def.keepDng
        s.smallExport = d.object(forKey: "camera.smallExport") as? Bool ?? def.smallExport
        s.rememberLast = d.bool(forKey: "camera.rememberLast")
        s.showHistogram = d.object(forKey: "camera.showHistogram") as? Bool ?? def.showHistogram
        s.showGrid = d.object(forKey: "camera.showGrid") as? Bool ?? def.showGrid
        s.showLevel = d.object(forKey: "camera.showLevel") as? Bool ?? def.showLevel
        s.geotag = d.object(forKey: "camera.geotag") as? Bool ?? def.geotag
        s.photoFrame = d.string(forKey: "camera.photoFrame").flatMap(PhotoFrame.init(rawValue:))
            ?? ((d.object(forKey: "camera.dateStamp") as? Bool ?? false) ? .dateStamp : def.photoFrame)
        s.dateStampFormat = d.string(forKey: "camera.dateStampFormat").flatMap(DateStampFormat.init(rawValue:)) ?? def.dateStampFormat
        s.pentax645Fields = Pentax645Field.parseSet(d.string(forKey: "camera.pentax645Fields"))
        s.shutterSound = d.object(forKey: "camera.shutterSound") as? Bool ?? def.shutterSound
        s.scanQr = d.object(forKey: "camera.scanQr") as? Bool ?? def.scanQr
        s.trackFocus = d.object(forKey: "camera.trackFocus") as? Bool ?? def.trackFocus
        s.previewScales = parseScales(d.string(forKey: "camera.previewScales"))
        s.flash = d.string(forKey: "camera.flash").flatMap(FlashMode.init(rawValue:)) ?? def.flash
        s.rawFormat = d.string(forKey: "camera.rawFormat").flatMap(RawFormat.init(rawValue:)) ?? def.rawFormat
        if !s.rememberLast { return s }
        s.lookId = d.string(forKey: "camera.look") ?? def.lookId
        s.strength = min(max(d.object(forKey: "camera.strength") as? Float ?? def.strength, 0), 100)
        s.brightness = min(max(d.object(forKey: "camera.brightness") as? Float ?? 0, -100), 100)
        s.warmth = min(max(d.object(forKey: "camera.warmth") as? Float ?? 0, -100), 100)
        s.mono = d.bool(forKey: "camera.mono")
        s.monoLookId = d.string(forKey: "camera.monoLook") ?? def.monoLookId
        s.film = d.object(forKey: "camera.film") as? Bool ?? def.film
        s.filmLookId = d.string(forKey: "camera.filmLook") ?? def.filmLookId
        s.filter = BwFilter.fromKey(d.string(forKey: "camera.filter")) ?? def.filter
        s.front = d.bool(forKey: "camera.front")
        s.lens = d.string(forKey: "camera.lens") ?? def.lens
        // A black and white look picked before RawBoy Camera had B&W mode now opens that mode on it.
        if Edition.monoLooks.contains(where: { $0.id == s.lookId }) {
            s.mono = true
            s.monoLookId = s.lookId
            s.lookId = def.lookId
        }
        return s
    }

    /** Saves everything, so switching rememberLast on later starts from the current state. */
    static func save(_ s: CameraSettings) {
        d.set(s.lookId, forKey: "camera.look")
        d.set(s.strength, forKey: "camera.strength")
        d.set(s.brightness, forKey: "camera.brightness")
        d.set(s.warmth, forKey: "camera.warmth")
        d.set(s.mono, forKey: "camera.mono")
        d.set(s.monoLookId, forKey: "camera.monoLook")
        d.set(s.film, forKey: "camera.film")
        d.set(s.filmLookId, forKey: "camera.filmLook")
        d.set(s.filter.key, forKey: "camera.filter")
        d.set(s.jpegQuality, forKey: "camera.jpegQuality")
        d.set(s.keepDng, forKey: "camera.keepDng")
        d.set(s.smallExport, forKey: "camera.smallExport")
        d.set(s.rememberLast, forKey: "camera.rememberLast")
        d.set(s.showHistogram, forKey: "camera.showHistogram")
        d.set(s.showGrid, forKey: "camera.showGrid")
        d.set(s.showLevel, forKey: "camera.showLevel")
        d.set(s.geotag, forKey: "camera.geotag")
        d.set(s.photoFrame.rawValue, forKey: "camera.photoFrame")
        d.set(s.photoFrame == .dateStamp, forKey: "camera.dateStamp")
        d.set(s.dateStampFormat.rawValue, forKey: "camera.dateStampFormat")
        d.set(Pentax645Field.serialize(s.pentax645Fields), forKey: "camera.pentax645Fields")
        d.set(s.shutterSound, forKey: "camera.shutterSound")
        d.set(s.scanQr, forKey: "camera.scanQr")
        d.set(s.trackFocus, forKey: "camera.trackFocus")
        d.set(s.front, forKey: "camera.front")
        d.set(s.lens, forKey: "camera.lens")
        d.set(s.flash.rawValue, forKey: "camera.flash")
        d.set(s.rawFormat.rawValue, forKey: "camera.rawFormat")
        d.set(s.previewScales.map { "\($0.key)=\($0.value)" }.joined(separator: ";"), forKey: "camera.previewScales")
    }

    /** Increments and returns today's 1-based frame counter (resetting to 1 at the start of each local calendar day). */
    static func nextFrameNumber(date: Date = Date()) -> Int {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "yyyy-MM-dd"
        let day = f.string(from: date)
        let d = UserDefaults.standard
        let storedDay = d.string(forKey: "camera.frameCountDay")
        let next = storedDay == day ? d.integer(forKey: "camera.frameCount") + 1 : 1
        d.set(day, forKey: "camera.frameCountDay")
        d.set(next, forKey: "camera.frameCount")
        return next
    }

    /** "W=0.4;T=0.5;FW=0.3" -> map; malformed entries are skipped. */
    private static func parseScales(_ text: String?) -> [String: Float] {
        var out: [String: Float] = [:]
        for entry in (text ?? "").split(separator: ";") {
            let parts = entry.split(separator: "=")
            guard parts.count == 2, let v = Float(parts[1]), v > 0 else { continue }
            out[String(parts[0])] = min(max(v, CameraSettings.minScale), CameraSettings.maxScale)
        }
        return out
    }
}
