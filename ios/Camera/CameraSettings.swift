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

/** Video recording quality (bitrate), as Android's VideoQuality: Low, Optimal (the default) or High. */
enum VideoQuality: String, CaseIterable {
    case low, optimal, high

    var label: String {
        switch self {
        case .low: "Low"
        case .optimal: "Optimal"
        case .high: "High"
        }
    }

    /** HEVC bit rate at 1080p30, bit/s. */
    var bitrate: Int {
        switch self {
        case .low: 8_000_000
        case .optimal: 16_000_000
        case .high: 24_000_000
        }
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
    /** Last enabled frame / stamp option, restored when toggling frames back on from the top bar. */
    var lastPhotoFrame = PhotoFrame.pentax645
    /** Date order for PhotoFrame.dateStamp and Pentax645Field.date: DD MM 'YY by default. */
    var dateStampFormat = DateStampFormat.dmy
    /** Visual style for PhotoFrame.dateStamp: Classic (yellow-orange Digital-7) or Red LED. */
    var dateStampStyle = DateStampStyle.classic
    /** Time format for Pentax645Field.time: 24h by default. */
    var timeStampFormat = TimeStampFormat.h24
    /** Shoot-info items imprinted on the PhotoFrame.pentax645 rebate (all on by default). */
    var pentax645Fields: Set<Pentax645Field> = Pentax645Field.defaultSet
    /** Display order of shoot-info items on the PhotoFrame.pentax645 rebate. */
    var pentax645Order: [Pentax645Field] = Pentax645Field.defaultOrder
    /** Rotate the PhotoFrame.pentax645 / contax645 shoot-info LED text 180° upside down (like on real film). */
    var pentax645Flip = false
    /** LED imprint color for PhotoFrame.pentax645 and PhotoFrame.contax645 (Amber, Slide, or Red). */
    var frameColor = FilmFrameColor.amber
    /** Play the camera shutter click on each shot. Where the law requires it, iOS plays it regardless. */
    var shutterSound = false
    /** Video recording quality (bitrate); fixed when a recording starts. */
    var videoQuality = VideoQuality.optimal
    /** The camera's own video stabilization in video mode (it crops the picture a little and delays it slightly). */
    var videoStabilization = true
    /** Look for QR codes in the viewfinder and offer to open them, as the system camera does. */
    var scanQr = true
    /** Film grain on the viewfinder and the saved photos; off = a clean picture (no look's grain, Film's included). */
    var grain = true
    /** Add one random procedural film light leak (edge burn, blob, sprocket holes, rebate glow, flare, start of roll) to saved JPEGs. */
    var randomLightLeak = false
    /** How many photos in each `lightLeakSequenceSize`-photo sequence get a leak (1...5; 5 = every shot), at shuffled positions. */
    var randomLightLeakRate = CameraSettings.lightLeakSequenceSize
    /** Also allow sprocket holes on the short edges (off: long edges only). */
    var shortSideSprockets = false
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
        var p = developLook(base, hasFace: hasFace)
        if !grain {
            p.grain = 0
            p.filmGrain = 0
        }
        return p
    }

    private func developLook(_ base: DevelopParams, hasFace: Bool) -> DevelopParams {
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

    /** Resets all user settings to their defaults while keeping learned lens calibration. */
    func resetToDefaults() -> CameraSettings {
        var s = CameraSettings()
        s.previewScales = previewScales
        return s
    }

    /** Length of a random light leak sequence (photos per cycle). */
    static let lightLeakSequenceSize = 5
    static let lightLeakRates = [1, 2, 3, 4, 5]
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
        let savedLastFrame = d.string(forKey: "camera.lastPhotoFrame").flatMap(PhotoFrame.init(rawValue:))
        s.lastPhotoFrame = (savedLastFrame != nil && savedLastFrame != .none) ? savedLastFrame!
            : (s.photoFrame != .none ? s.photoFrame : def.lastPhotoFrame)
        s.dateStampFormat = d.string(forKey: "camera.dateStampFormat").flatMap(DateStampFormat.init(rawValue:)) ?? def.dateStampFormat
        s.dateStampStyle = d.string(forKey: "camera.dateStampStyle").flatMap(DateStampStyle.init(rawValue:)) ?? def.dateStampStyle
        s.timeStampFormat = d.string(forKey: "camera.timeStampFormat").flatMap(TimeStampFormat.init(rawValue:)) ?? def.timeStampFormat
        s.pentax645Fields = Pentax645Field.parseSet(d.string(forKey: "camera.pentax645Fields"))
        s.pentax645Order = Pentax645Field.parseOrder(d.string(forKey: "camera.pentax645Order"))
        s.pentax645Flip = d.object(forKey: "camera.pentax645Flip") as? Bool ?? def.pentax645Flip
        s.frameColor = d.string(forKey: "camera.frameColor").flatMap(FilmFrameColor.init(rawValue:)) ?? def.frameColor
        s.shutterSound = d.object(forKey: "camera.shutterSound") as? Bool ?? def.shutterSound
        s.scanQr = d.object(forKey: "camera.scanQr") as? Bool ?? def.scanQr
        s.videoQuality = d.string(forKey: "camera.videoQuality").flatMap(VideoQuality.init(rawValue:)) ?? def.videoQuality
        s.videoStabilization = d.object(forKey: "camera.videoStabilization") as? Bool ?? def.videoStabilization
        s.grain = d.object(forKey: "camera.grain") as? Bool ?? def.grain
        s.trackFocus = d.object(forKey: "camera.trackFocus") as? Bool ?? def.trackFocus
        s.randomLightLeak = d.object(forKey: "camera.randomLightLeak") as? Bool ?? def.randomLightLeak
        let savedRate = d.object(forKey: "camera.randomLightLeakRate") as? Int ?? def.randomLightLeakRate
        s.randomLightLeakRate = CameraSettings.lightLeakRates.contains(savedRate) ? savedRate : def.randomLightLeakRate
        s.shortSideSprockets = d.object(forKey: "camera.shortSideSprockets") as? Bool ?? def.shortSideSprockets
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
        d.set((s.photoFrame != .none ? s.photoFrame : s.lastPhotoFrame).rawValue, forKey: "camera.lastPhotoFrame")
        d.set(s.photoFrame == .dateStamp, forKey: "camera.dateStamp")
        d.set(s.dateStampFormat.rawValue, forKey: "camera.dateStampFormat")
        d.set(s.dateStampStyle.rawValue, forKey: "camera.dateStampStyle")
        d.set(s.timeStampFormat.rawValue, forKey: "camera.timeStampFormat")
        d.set(Pentax645Field.serialize(s.pentax645Fields), forKey: "camera.pentax645Fields")
        d.set(Pentax645Field.serializeOrder(s.pentax645Order), forKey: "camera.pentax645Order")
        d.set(s.pentax645Flip, forKey: "camera.pentax645Flip")
        d.set(s.frameColor.rawValue, forKey: "camera.frameColor")
        d.set(s.shutterSound, forKey: "camera.shutterSound")
        d.set(s.scanQr, forKey: "camera.scanQr")
        d.set(s.videoQuality.rawValue, forKey: "camera.videoQuality")
        d.set(s.videoStabilization, forKey: "camera.videoStabilization")
        d.set(s.grain, forKey: "camera.grain")
        d.set(s.trackFocus, forKey: "camera.trackFocus")
        d.set(s.randomLightLeak, forKey: "camera.randomLightLeak")
        d.set(s.randomLightLeakRate, forKey: "camera.randomLightLeakRate")
        d.set(s.shortSideSprockets, forKey: "camera.shortSideSprockets")
        d.set(s.front, forKey: "camera.front")
        d.set(s.lens, forKey: "camera.lens")
        d.set(s.flash.rawValue, forKey: "camera.flash")
        d.set(s.rawFormat.rawValue, forKey: "camera.rawFormat")
        d.set(s.previewScales.map { "\($0.key)=\($0.value)" }.joined(separator: ";"), forKey: "camera.previewScales")
    }

    /** Whether the next shot gets a random light leak under `rate` (1...5 of 5 photos); the rest of the shuffled sequence is kept across launches. */
    static func nextLightLeak(rate: Int) -> Bool {
        let (leak, next) = LightLeakSequence.next(state: d.string(forKey: "camera.randomLightLeakSeq"), rate: rate)
        d.set(next, forKey: "camera.randomLightLeakSeq")
        return leak
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

/**
 * Random light leak decisions in shuffled sequences of `CameraSettings.lightLeakSequenceSize` (5) photos: each sequence has
 * exactly `rate` leaks at random positions, so the next one can't be predicted (port of Android's `LightLeakSequence`).
 * State is `"<rate>:<remainingBits>"`, e.g. `"2:0101"`.
 */
enum LightLeakSequence {
    static func next(state: String?, rate: Int, sequenceSize: Int = CameraSettings.lightLeakSequenceSize)
        -> (leak: Bool, state: String)
    {
        var rng = SystemRandomNumberGenerator()
        return next(state: state, rate: rate, sequenceSize: sequenceSize, using: &rng)
    }

    static func next<G: RandomNumberGenerator>(state: String?, rate: Int, sequenceSize: Int = CameraSettings.lightLeakSequenceSize,
                                               using rng: inout G) -> (leak: Bool, state: String) {
        let k = min(max(rate, 1), sequenceSize)
        if k >= sequenceSize { return (true, "") }
        var queue = parseRemaining(state, k, sequenceSize) ?? []
        if queue.isEmpty { queue = deal(k, sequenceSize, &rng) }
        let decision = queue[0] == "1"
        let rest = String(queue.dropFirst())
        return (decision, rest.isEmpty ? "" : "\(k):\(rest)")
    }

    private static func parseRemaining(_ state: String?, _ rate: Int, _ size: Int) -> [Character]? {
        guard let state, let sep = state.firstIndex(of: ":"), sep != state.startIndex else { return nil }
        guard let stored = Int(state[..<sep]), stored == rate else { return nil }
        let bits = Array(state[state.index(after: sep)...])
        guard !bits.isEmpty, bits.count <= size, bits.allSatisfy({ $0 == "0" || $0 == "1" }) else { return nil }
        return bits
    }

    private static func deal<G: RandomNumberGenerator>(_ rate: Int, _ size: Int, _ rng: inout G) -> [Character] {
        var slots: [Character] = (0..<size).map { $0 < rate ? "1" : "0" }
        slots.shuffle(using: &rng)
        return slots
    }
}
