import Foundation

public enum ExportFormat: String, CaseIterable, Sendable {
    case jpeg = "JPEG"
    case tiff = "TIFF"

    public var fileExtension: String { self == .jpeg ? "jpg" : "tif" }
    public var uti: String { self == .jpeg ? "public.jpeg" : "public.tiff" }
}

/**
 * JPEG encoders. system is iOS's (ImageIO, 8-bit input).
 * jpegli is Google's jpegli: 4:4:4, 16-bit input, adaptive quantisation; slower, better per byte.
 */
public enum JpegEncoder: String, Sendable { case system, jpegli }

public struct ExportSettings: Equatable, Sendable {
    public var format: ExportFormat = .jpeg
    public var jpegQuality: Int = 92  // 1..100
    public var tiffBits: Int = 16  // 8 or 16
    public var jpegEncoder: JpegEncoder = .system
    /** Long side of the saved image in pixels, area-downscaled from full resolution; nil = full size. */
    public var maxLongSide: Int?
    /** Light sharpening after the downscale (0 = none, ~0.5 subtle); only when maxLongSide makes the image smaller. */
    public var downscaleSharpen: Float = 0
    /**
     * Optional film-style date stamp (e.g. `'26 11 13`) imprinted in the bottom-right corner of the exported image.
     * Empty string = no date stamp.
     */
    public var dateStamp: String = ""
    /** Visual style for [dateStamp] (`Classic` yellow-orange Digital-7 or `Red LED` rounded segments). */
    public var dateStampStyle: DateStampStyle = .classic
    /**
     * Optional Pentax 645N-style black film rebate with dot-matrix shoot info along the top edge.
     * Mutually exclusive with dateStamp; when non-nil, pentax645 takes precedence.
     */
    public var pentax645: Pentax645Info?
    /** When true (B&W mode), both dateStamp and pentax645 render in neutral black-and-white. */
    public var monochromeImprint: Bool = false

    public init(format: ExportFormat = .jpeg, jpegQuality: Int = 92, tiffBits: Int = 16,
                jpegEncoder: JpegEncoder = .system, maxLongSide: Int? = nil, downscaleSharpen: Float = 0,
                dateStamp: String = "", dateStampStyle: DateStampStyle = .classic,
                pentax645: Pentax645Info? = nil, monochromeImprint: Bool = false) {
        self.format = format
        self.jpegQuality = jpegQuality
        self.tiffBits = tiffBits
        self.jpegEncoder = jpegEncoder
        self.maxLongSide = maxLongSide
        self.downscaleSharpen = downscaleSharpen
        self.dateStamp = dateStamp
        self.dateStampStyle = dateStampStyle
        self.pentax645 = pentax645
        self.monochromeImprint = monochromeImprint
    }
}

/** Display order for the film data-back date stamp (`DD MM 'YY` by default) and Pentax 645 date imprint. */
public enum DateStampFormat: String, CaseIterable, Sendable {
    case dmy = "DMY"
    case ymd = "YMD"
    case mdy = "MDY"
    case mmmYy = "MMM_YY"

    public var label: String {
        switch self {
        case .dmy: "DD MM 'YY"
        case .ymd: "'YY MM DD"
        case .mdy: "MM DD 'YY"
        case .mmmYy: "jan 26"
        }
    }
}

/** Visual style for the 35mm film data-back date stamp (`Classic` by default, or `Red LED`). */
public enum DateStampStyle: String, CaseIterable, Sendable {
    case classic = "CLASSIC"
    case redLed = "RED_LED"

    public var label: String {
        switch self {
        case .classic: "Classic"
        case .redLed: "Red LED"
        }
    }
}

/** Time format for the Pentax 645 shoot-info imprint (`24h` by default, or `12h (am/pm)`). */
public enum TimeStampFormat: String, CaseIterable, Sendable {
    case h24 = "H24"
    case h12 = "H12"

    public var label: String {
        switch self {
        case .h24: "24h"
        case .h12: "12h (am/pm)"
        }
    }
}

/**
 * Imprints a 35mm film data-back date (`DD MM 'YY`, `'YY MM DD`, or `MM DD 'YY`) in the bottom-right corner of an
 * exported image, using a Digital-7 style chamfered 7-segment clock geometry rendered the way a quartz date back exposes
 * film: orange LED segments shining through the film base onto the emulsion. So the digits are light added to the
 * picture (they show on dark areas and fade into bright ones), slightly soft-edged, with a hot yellow core that falls
 * off to red-orange at the fringes, a subtle reddish halation glow, slightly uneven segment brightness and grain. Same
 * output as engine's DateStamp.kt.
 */
public enum DateStamp {
    /** Formats [date] in classic film date-back order (defaults to `DD MM 'YY`, e.g. `13 11 '26`). */
    public static func format(_ date: Date = Date(), format: DateStampFormat = .dmy,
                              calendar: Calendar = .current) -> String {
        let comps = calendar.dateComponents([.year, .month, .day], from: date)
        let year = (comps.year ?? 0) % 100
        let month = comps.month ?? 1
        let day = comps.day ?? 1
        switch format {
        case .dmy: return String(format: "%02d %02d '%02d", day, month, year)
        case .ymd: return String(format: "'%02d %02d %02d", year, month, day)
        case .mdy: return String(format: "%02d %02d '%02d", month, day, year)
        case .mmmYy: return String(format: "%02d %02d '%02d", day, month, year)
        }
    }

    /** The LED's light per film layer, for the response `1 - exp(-gain * E * c)`: red saturates first (yellow core). */
    private static let ledR: Float = 1.0
    private static let ledG: Float = 0.42
    private static let ledB: Float = 0.035
    private static let gain: Float = 3
    private static let invSqrt2: Float = 0.70710678
    /** How much the stamp still darkens blue where the picture is already bright, so it reads (faintly) on a sky. */
    private static let blueAbsorb: Float = 0.55

    /**
     * Red LED data back (Red LED style), matched to a real scan: hot core about (255, 115, 80), fringe about
     * (205, 55, 45) fading to a dark red glow. Blue is barely held back: the out-of-focus LED floods the dark around
     * it with a faint pink-red bloom rather than tinting it yellow.
     */
    private static let redLedR: Float = 1.0
    private static let redLedG: Float = 0.13
    private static let redLedB: Float = 0.05
    private static let redBlueAbsorb: Float = 0.12
    private static let redGain: Float = 4

    /**
     * Burns [text] into the 16-bit interleaved RGB [band] covering rows `[bandY, bandY + bandRows)` of an image of
     * size [width] x [height]. Bands outside the bottom-right stamp box return immediately.
     * Red LED draws fat, short, blobby capsule segments with wide gaps, each brightest in its middle like a defocused
     * LED, with a wide red bloom, uneven segment brightness and coarse grain.
     */
    public static func imprint(band: UnsafeMutablePointer<UInt16>, width: Int, height: Int,
                               bandY: Int, bandRows: Int, text: String, monochrome: Bool = false,
                               style: DateStampStyle = .classic) {
        guard !text.isEmpty, width > 0, height > 0, bandRows > 0 else { return }

        let redLed = style == .redLed
        let shortSide = Float(min(width, height))
        let charH = max(14 as Float, shortSide * (redLed ? 0.036 : 0.028))
        let charW = charH * (redLed ? 0.60 : 0.52)
        let thick = charH * (redLed ? 0.19 : 0.115)
        let gap = charH * (redLed ? 0.26 : 0.22)
        let tickAdv = charW * 0.35

        let chars = Array(text)
        let count = chars.count
        var cellX = [Float](repeating: 0, count: count)
        var cellW = [Float](repeating: 0, count: count)
        var masks = [Int](repeating: 0, count: count)
        var isTick = [Bool](repeating: false, count: count)
        var cursorX: Float = 0
        for i in 0..<count {
            let ch = chars[i]
            let adv = ch == "'" ? tickAdv : charW
            cellX[i] = cursorX
            cellW[i] = adv
            isTick[i] = ch == "'"
            masks[i] = segmentMask(ch)
            cursorX += adv + (i + 1 < count ? gap : 0)
        }
        let totalW = cursorX

        let x0 = Float(width) - shortSide * 0.055 - totalW
        let y0 = Float(height) - shortSide * 0.050 - charH
        let reach = thick * (redLed ? 2.6 : 2.2)  // the halation's extent
        let slant: Float = redLed ? 0 : 0.14
        let slantMaxShift = charH * 0.5 * slant

        let minY = max(0, Int(y0 - reach))
        let maxY = min(height - 1, Int(y0 + charH + reach))
        if bandY + bandRows <= minY || bandY > maxY { return }
        let minX = max(0, Int(x0 - reach - slantMaxShift))
        let maxX = min(width - 1, Int(x0 + totalW + reach + slantMaxShift))
        if minX > maxX { return }

        let halfH = charH * 0.5
        let halfThick = thick * 0.5
        let segGap = thick * (redLed ? 0.30 : 0.22)
        // Out-of-focus LED: soft segment edge with halation glow (blurrier and wider for Red LED).
        let soft = redLed ? max(thick * 0.55, 1.0) : max(thick * 0.45, 0.8)
        let haloAmp: Float = redLed ? 0.22 : 0.175
        let haloInv = 1 / (thick * (redLed ? 1.1 : 0.9))
        let grainCell = max(1, thick * (redLed ? 0.3 : 0.22))
        let grainBase: Float = redLed ? 0.78 : 0.9
        let grainAmp: Float = redLed ? 0.44 : 0.2
        let curLedR = redLed ? redLedR : ledR
        let curLedG = redLed ? redLedG : ledG
        let curLedB = redLed ? redLedB : ledB
        let curBlueAbsorb = redLed ? redBlueAbsorb : blueAbsorb
        let curGain = redLed ? redGain : gain

        let rowStart = max(bandY, minY)
        let rowEnd = min(bandY + bandRows - 1, maxY)
        for py in rowStart...rowEnd {
            let vy = (Float(py) + 0.5) - y0
            let slantOffset = (halfH - vy) * slant
            let rowOffset = (py - bandY) * width
            for px in minX...maxX {
                let ux = (Float(px) + 0.5) - x0 - slantOffset
                var core: Float = 0
                var minDist = Float.greatestFiniteMagnitude
                for i in 0..<count {
                    let m = masks[i]
                    let tick = isTick[i]
                    if m == 0 && !tick { continue }
                    let cx = cellX[i]
                    let cw = cellW[i]
                    if ux < cx - reach || ux > cx + cw + reach { continue }
                    let lx = ux - cx
                    if tick {
                        let d = redLed
                            ? distRoundVBar(lx, vy, cw * 0.5, charH * 0.21, charH * 0.17, halfThick)
                            : distVBar(lx, vy, cw * 0.5, charH * 0.21, charH * 0.17, halfThick)
                        if d < minDist { minDist = d }
                        let lum = redLed ? redLedBrightness(i, 7) : ledBrightness(i, 7)
                        core = max(core, lum * edge(d, soft))
                        continue
                    }
                    for s in 0..<7 where (m >> s) & 1 != 0 {
                        let d = distToDigitSegment(s, lx, vy, cw, charH, halfH, halfThick, segGap, rounded: redLed)
                        if d < minDist { minDist = d }
                        let lum: Float
                        if redLed {
                            // A defocused LED is brightest in its middle and dims toward the segment's ends.
                            let a = segmentAlong(s, lx, vy, cw, charH, halfH, halfThick, segGap)
                            lum = redLedBrightness(i, s) * (1 - 0.35 * a * a)
                        } else {
                            lum = ledBrightness(i, s)
                        }
                        core = max(core, lum * edge(d, soft))
                    }
                }
                let excess = max(minDist, 0) * haloInv
                let halo = haloAmp * exp(-excess * excess)
                if core <= 0.002 && halo < 0.004 { continue }

                // Grain: the exposure varies from clump to clump, as it does in the emulsion.
                let grain = grainBase + grainAmp * hash(Int(Float(px) / grainCell), Int(Float(py) / grainCell))
                let e = (core + halo * (1 - core)) * grain

                let lr: Float
                let lg: Float
                let lb: Float
                let absorb: Float
                if monochrome {
                    let l = 1 - exp(-gain * e * 0.85)
                    lr = l
                    lg = l
                    lb = l
                    absorb = 0
                } else {
                    lr = 1 - exp(-curGain * e * curLedR)
                    lg = 1 - exp(-curGain * e * curLedG)
                    lb = 1 - exp(-curGain * e * curLedB)
                    absorb = curBlueAbsorb
                }

                let idx = (rowOffset + px) * 3
                let r = Float(band[idx]) / 65535
                let g = Float(band[idx + 1]) / 65535
                let b = Float(band[idx + 2]) / 65535
                // Light adds to the picture (screen); blue is held back where the LED is strong (color mode only).
                band[idx] = toU16(1 - (1 - r) * (1 - lr))
                band[idx + 1] = toU16(1 - (1 - g) * (1 - lg))
                band[idx + 2] = toU16((1 - (1 - b) * (1 - lb)) * (1 - absorb * lr))
            }
        }
    }

    /** Soft segment edge: 1 inside (`d <= -soft/2`), easing to 0 across [soft] pixels around the boundary (`d == 0`). */
    private static func edge(_ d: Float, _ soft: Float) -> Float {
        let t = min(max((soft * 0.5 - d) / soft, 0), 1)
        return t * t * (3 - 2 * t)
    }

    /** Each LED segment is a little brighter or dimmer than the others (90-100%), the same for every photo. */
    private static func ledBrightness(_ char: Int, _ segment: Int) -> Float { 0.9 + 0.1 * hash(char * 8 + segment, 911) }

    /** Red LED segments vary more (78-100%), like the uneven LEDs of a cheap data back. */
    private static func redLedBrightness(_ char: Int, _ segment: Int) -> Float { 0.78 + 0.22 * hash(char * 8 + segment, 911) }

    /** 0 at the middle of rounded segment [s], 1 at its ends (same geometry as distToDigitSegment rounded). */
    private static func segmentAlong(_ s: Int, _ x: Float, _ y: Float, _ w: Float, _ h: Float,
                                     _ halfH: Float, _ ht: Float, _ segGap: Float) -> Float {
        let hx = w * 0.5 - segGap * 1.4
        let hy = (halfH - ht) * 0.5 - segGap
        let a: Float
        switch s {
        case 0, 3, 6: a = abs(x - w * 0.5) / hx
        case 1, 5: a = abs(y - (ht + halfH) * 0.5) / hy
        default: a = abs(y - (halfH + h - ht) * 0.5) / hy
        }
        return min(max(a, 0), 1)
    }

    private static func segmentMask(_ ch: Character) -> Int {
        switch ch {
        case "0": 0x3F
        case "1": 0x06
        case "2": 0x5B
        case "3": 0x4F
        case "4": 0x66
        case "5": 0x6D
        case "6": 0x7D
        case "7": 0x07
        case "8": 0x7F
        case "9": 0x6F
        case "-": 0x40
        default: 0
        }
    }

    /** Signed distance to segment [s] (a..g = 0..6) of a digit cell [w] x [h], chamfered or rounded-capsule. */
    private static func distToDigitSegment(_ s: Int, _ x: Float, _ y: Float, _ w: Float, _ h: Float,
                                           _ halfH: Float, _ ht: Float, _ segGap: Float,
                                           rounded: Bool = false) -> Float {
        let hx = w * 0.5 - (rounded ? segGap * 1.4 : segGap)
        let hy = (halfH - ht) * 0.5 - segGap
        if rounded {
            switch s {
            case 0: return distRoundHBar(x, y, w * 0.5, ht, hx, ht)
            case 1: return distRoundVBar(x, y, w - ht, (ht + halfH) * 0.5, hy, ht)
            case 2: return distRoundVBar(x, y, w - ht, (halfH + h - ht) * 0.5, hy, ht)
            case 3: return distRoundHBar(x, y, w * 0.5, h - ht, hx, ht)
            case 4: return distRoundVBar(x, y, ht, (halfH + h - ht) * 0.5, hy, ht)
            case 5: return distRoundVBar(x, y, ht, (ht + halfH) * 0.5, hy, ht)
            default: return distRoundHBar(x, y, w * 0.5, halfH, hx, ht)
            }
        }
        switch s {
        case 0: return distHBar(x, y, w * 0.5, ht, hx, ht)
        case 1: return distVBar(x, y, w - ht, (ht + halfH) * 0.5, hy, ht)
        case 2: return distVBar(x, y, w - ht, (halfH + h - ht) * 0.5, hy, ht)
        case 3: return distHBar(x, y, w * 0.5, h - ht, hx, ht)
        case 4: return distVBar(x, y, ht, (halfH + h - ht) * 0.5, hy, ht)
        case 5: return distVBar(x, y, ht, (ht + halfH) * 0.5, hy, ht)
        default: return distHBar(x, y, w * 0.5, halfH, hx, ht)
        }
    }

    /** Signed distance to a 45°-chamfered horizontal 7-segment bar centered at ([cx], [cy]). */
    private static func distHBar(_ x: Float, _ y: Float, _ cx: Float, _ cy: Float, _ hx: Float, _ ht: Float) -> Float {
        let dx = abs(x - cx)
        let dy = abs(y - cy)
        return max(dy - ht, (dx + dy - hx) * invSqrt2)
    }

    /** Signed distance to a 45°-chamfered vertical 7-segment bar centered at ([cx], [cy]). */
    private static func distVBar(_ x: Float, _ y: Float, _ cx: Float, _ cy: Float, _ hy: Float, _ ht: Float) -> Float {
        let dx = abs(x - cx)
        let dy = abs(y - cy)
        return max(dx - ht, (dx + dy - hy) * invSqrt2)
    }

    /** Signed distance to a rounded-capsule horizontal 7-segment bar centered at ([cx], [cy]). */
    private static func distRoundHBar(_ x: Float, _ y: Float, _ cx: Float, _ cy: Float, _ hx: Float, _ ht: Float) -> Float {
        let dx = max(0, abs(x - cx) - max(0, hx - ht))
        let dy = abs(y - cy)
        return hypot(dx, dy) - ht
    }

    /** Signed distance to a rounded-capsule vertical 7-segment bar centered at ([cx], [cy]). */
    private static func distRoundVBar(_ x: Float, _ y: Float, _ cx: Float, _ cy: Float, _ hy: Float, _ ht: Float) -> Float {
        let dx = abs(x - cx)
        let dy = max(0, abs(y - cy) - max(0, hy - ht))
        return hypot(dx, dy) - ht
    }

    /** Deterministic 0..1 hash of an integer pair (matches the Kotlin version bit for bit). */
    private static func hash(_ x: Int, _ y: Int) -> Float {
        var h = UInt32(truncatingIfNeeded: x) &* 374761393 &+ UInt32(truncatingIfNeeded: y) &* 668265263
        h = (h ^ (h >> 13)) &* 1274126177
        h ^= h >> 16
        return Float(h & 0xFFFFFF) / 16777215
    }

    private static func toU16(_ v: Float) -> UInt16 { UInt16((min(max(v, 0), 1) * 65535).rounded()) }
}

/**
 * Shoot metadata imprinted into the top film rebate of a Pentax 645-style frame.
 * Matches `Pentax645Info` / `Pentax645Frame` in engine `Pentax645Frame.kt`.
 */
public struct Pentax645Info: Equatable, Sendable {
    public let frameNumber: Int?
    public let mode: String?
    public let exposureTime: Double?
    public let fNumber: Double?
    public let compensationEv: Float?
    public let spotMetered: Bool?
    public let focalLengthMm: Double?
    public let iso: Double?
    public let date: String?
    public let time: String?
    public let dateTime: String?
    public let flipped: Bool
    public let fieldOrder: [String]?

    public init(frameNumber: Int? = nil, mode: String? = nil, exposureTime: Double? = nil, fNumber: Double? = nil,
                compensationEv: Float? = nil, spotMetered: Bool? = nil, focalLengthMm: Double? = nil,
                iso: Double? = nil, date: String? = nil, time: String? = nil, dateTime: String? = nil,
                flipped: Bool = false, fieldOrder: [String]? = nil) {
        self.frameNumber = frameNumber
        self.mode = mode
        self.exposureTime = exposureTime
        self.fNumber = fNumber
        self.compensationEv = compensationEv
        self.spotMetered = spotMetered
        self.focalLengthMm = focalLengthMm
        self.iso = iso
        self.date = date
        self.time = time
        self.dateTime = dateTime
        self.flipped = flipped
        self.fieldOrder = fieldOrder
    }
}

public enum Pentax645Frame {
    public struct Layout: Equatable, Sendable {
        public let photoWidth: Int
        public let photoHeight: Int
        public let border: Int
        public let infoBar: Int
        public var infoOnLeft: Bool { photoWidth > photoHeight }
        public var topPad: Int { border }
        public var bottomPad: Int { border }
        public var leftPad: Int { border }
        public var rightPad: Int { border }
        public var outWidth: Int { photoWidth + leftPad + rightPad }
        public var outHeight: Int { photoHeight + topPad + bottomPad }
        public var topBar: Int { infoBar }
    }

    public static func layout(photoWidth: Int, photoHeight: Int) -> Layout {
        let shortSide = Float(min(photoWidth, photoHeight))
        let border = max(3, Int((shortSide * 0.005).rounded()))
        let infoBar = max(28, Int((shortSide * 0.036).rounded()))
        return Layout(photoWidth: photoWidth, photoHeight: photoHeight, border: border, infoBar: infoBar)
    }

    public static func formatFrameNumber(_ frameNumber: Int) -> String {
        frameNumber > 0 ? "#\(frameNumber)" : "#--"
    }

    public static func formatShutter(_ t: Double) -> String {
        guard t.isFinite && t > 0 else { return "---" }
        return t >= 0.95 ? "\(trimOneDecimal(t))s" : "1/\(Int((1.0 / t).rounded()))"
    }

    public static func formatAperture(_ f: Double) -> String {
        guard f.isFinite && f > 0 else { return "F--" }
        let rounded = Int(f.rounded())
        return abs(f - Double(rounded)) < 0.05 && rounded < 10 ? "F \(rounded)" : "F\(trimOneDecimal(f))"
    }

    public static func formatEv(_ ev: Float) -> String {
        guard ev.isFinite && abs(ev) >= 0.05 else { return "±0.0EV" }
        let sign = ev > 0 ? "+" : "-"
        return String(format: "%@%.1fEV", sign, abs(ev))
    }

    public static func formatFocalLength(_ mm: Double) -> String {
        guard mm.isFinite && mm > 0 else { return "--mm" }
        return "\(Int(mm.rounded()))mm"
    }

    public static func formatIso(_ iso: Double) -> String {
        guard iso.isFinite && iso > 0 else { return "ISO---" }
        return "ISO\(Int(iso.rounded()))"
    }

    private static let monthAbbr = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"]
    private static let defaultFieldOrder = ["frame", "mode", "shutter", "aperture", "ev", "metering", "focal", "iso", "date", "time"]

    public static func formatDate(_ date: Date = Date(), format: DateStampFormat = .dmy,
                                  calendar: Calendar = .current) -> String {
        let comps = calendar.dateComponents([.year, .month, .day], from: date)
        let year = (comps.year ?? 0) % 100
        let monthIdx = min(max((comps.month ?? 1) - 1, 0), 11)
        let month = monthIdx + 1
        let day = comps.day ?? 1
        switch format {
        case .dmy: return String(format: "%02d.%02d.%02d", day, month, year)
        case .ymd: return String(format: "%02d.%02d.%02d", year, month, day)
        case .mdy: return String(format: "%02d.%02d.%02d", month, day, year)
        case .mmmYy: return String(format: "%@ %02d", monthAbbr[monthIdx], year)
        }
    }

    public static func formatTime(_ date: Date = Date(), format: TimeStampFormat = .h24,
                                  calendar: Calendar = .current) -> String {
        let comps = calendar.dateComponents([.hour, .minute], from: date)
        let hour24 = comps.hour ?? 0
        let minute = comps.minute ?? 0
        switch format {
        case .h24:
            return String(format: "%02d:%02d", hour24, minute)
        case .h12:
            let hour12 = hour24 % 12 == 0 ? 12 : hour24 % 12
            let amPm = hour24 < 12 ? "am" : "pm"
            return String(format: "%d:%02d%@", hour12, minute, amPm)
        }
    }

    public static func formatDateTime(_ date: Date = Date(), format: DateStampFormat = .dmy,
                                      timeFormat: TimeStampFormat = .h24,
                                      calendar: Calendar = .current) -> String {
        "\(formatDate(date, format: format, calendar: calendar)) \(formatTime(date, format: timeFormat, calendar: calendar))"
    }

    private static func trimOneDecimal(_ v: Double) -> String {
        let s = String(format: "%.1f", v)
        return s.hasSuffix(".0") ? String(s.dropLast(2)) : s
    }

    private static let ledR: Float = 1.0
    private static let ledG: Float = 0.44
    private static let ledB: Float = 0.04
    private static let gain: Float = 3.0
    private static let baseR: Float = 0.011
    private static let baseG: Float = 0.010
    private static let baseB: Float = 0.009
    private static let baseMono: Float = 0.010
    private static let ledMono: Float = 0.85

    private enum Token {
        case text(String)
        case metering(spot: Bool)
    }

    private static func charCols(_ ch: Character) -> Int {
        switch ch {
        case ".", ":", "'", " ": return 3
        default: return 5
        }
    }

    private struct StampDots {
        let u0: Float
        let v0: Float
        let totalU: Float
        let charH: Float
        let dotR: Float
        let soft: Float
        let reach: Float
        let haloInv: Float
        let flipped: Bool
        let dotU: [Float]
        let dotV: [Float]
        let dotBright: [Float]
    }

    private static func buildStampDots(layout: Layout, info: Pentax645Info) -> StampDots {
        let barLength = Float(layout.infoOnLeft ? layout.outHeight : layout.outWidth)
        let photoShortSide = Float(min(layout.photoWidth, layout.photoHeight))
        let infoBar = Float(layout.infoBar)

        func tokenForKey(_ key: String) -> Token? {
            switch key {
            case "frame": return info.frameNumber.map { .text(formatFrameNumber($0)) }
            case "mode": return info.mode.flatMap { $0.isEmpty ? nil : .text($0) }
            case "shutter": return info.exposureTime.map { .text(formatShutter($0)) }
            case "aperture": return info.fNumber.map { .text(formatAperture($0)) }
            case "ev": return info.compensationEv.map { .text(formatEv($0)) }
            case "metering": return info.spotMetered.map { .metering(spot: $0) }
            case "focal": return info.focalLengthMm.map { .text(formatFocalLength($0)) }
            case "iso": return info.iso.map { .text(formatIso($0)) }
            case "date":
                let d = info.date ?? info.dateTime
                return d.flatMap { $0.isEmpty ? nil : .text($0) }
            case "time":
                return info.time.flatMap { $0.isEmpty ? nil : .text($0) }
            default: return nil
            }
        }

        let order = info.fieldOrder?.isEmpty == false ? info.fieldOrder! : defaultFieldOrder
        var tokens: [Token] = []
        var seen = Set<String>()
        for key in order where seen.insert(key).inserted {
            if let t = tokenForKey(key) { tokens.append(t) }
        }
        for key in defaultFieldOrder where seen.insert(key).inserted {
            if let t = tokenForKey(key) { tokens.append(t) }
        }

        var charH = infoBar * 0.56
        var dotPitch = charH / 7
        var charGap = dotPitch * 1.15
        var minGroupGap = dotPitch * 5.0

        func tokenWidth(_ t: Token) -> Float {
            switch t {
            case .text(let s):
                if s.isEmpty { return 0 }
                let cols = s.reduce(0) { $0 + charCols($1) }
                return Float(cols) * dotPitch + Float(s.count - 1) * charGap
            case .metering:
                return 7 * dotPitch
            }
        }

        var sumTokensW = tokens.reduce(Float(0)) { $0 + tokenWidth($1) }
        let maxContentW = photoShortSide * 0.92
        let minTotalW = tokens.isEmpty ? 0 : sumTokensW + Float(tokens.count - 1) * minGroupGap
        if minTotalW > maxContentW && minTotalW > 0 {
            let scale = maxContentW / minTotalW
            charH *= scale
            dotPitch *= scale
            charGap *= scale
            minGroupGap *= scale
            sumTokensW = tokens.reduce(Float(0)) { $0 + tokenWidth($1) }
        }

        let groupGap: Float
        if tokens.count <= 1 {
            groupGap = 0
        } else {
            let targetSpan = min(photoShortSide * 0.86, maxContentW)
            let idealGap = (targetSpan - sumTokensW) / Float(tokens.count - 1)
            groupGap = min(max(idealGap, minGroupGap), dotPitch * 14)
        }

        let totalU = tokens.isEmpty ? 0 : sumTokensW + Float(tokens.count - 1) * groupGap
        let u0 = (barLength - totalU) * 0.5
        let v0 = Float(layout.border) + (infoBar - charH) * 0.5

        let dotR = dotPitch * 0.36
        let soft = max(dotPitch * 0.36, 0.8)
        let reach = dotPitch * 1.8
        let haloInv = 1 / (dotPitch * 0.85)

        var dotU: [Float] = []
        var dotV: [Float] = []
        var dotBright: [Float] = []
        dotU.reserveCapacity(256)
        dotV.reserveCapacity(256)
        dotBright.reserveCapacity(256)

        var cursorU: Float = 0
        var glyphIdx = 0
        for (ti, token) in tokens.enumerated() {
            switch token {
            case .text(let s):
                let chars = Array(s)
                for (ci, ch) in chars.enumerated() {
                    let cols = charCols(ch)
                    if let rows = glyph5x7(ch) {
                        let colShift = (5 - cols) / 2
                        for r in 0..<7 {
                            let bits = rows[r]
                            for c in 0..<cols {
                                let srcCol = c + colShift
                                if srcCol >= 0 && srcCol <= 4 && ((bits >> (4 - srcCol)) & 1) != 0 {
                                    dotU.append(cursorU + (Float(c) + 0.5) * dotPitch)
                                    dotV.append((Float(r) + 0.5) * dotPitch)
                                    dotBright.append(0.90 + 0.10 * hash(glyphIdx * 64 + r * 8 + c, 733))
                                }
                            }
                        }
                    }
                    cursorU += Float(cols) * dotPitch + (ci + 1 < chars.count ? charGap : 0)
                    glyphIdx += 1
                }
            case .metering(let spot):
                let rows = spot ? spotMeter7x7 : autoMeter7x7
                for r in 0..<7 {
                    let bits = rows[r]
                    for c in 0..<7 where ((bits >> (6 - c)) & 1) != 0 {
                        dotU.append(cursorU + (Float(c) + 0.5) * dotPitch)
                        dotV.append((Float(r) + 0.5) * dotPitch)
                        dotBright.append(0.92 + 0.08 * hash(glyphIdx * 64 + r * 8 + c, 733))
                    }
                }
                cursorU += 7 * dotPitch
                glyphIdx += 1
            }
            if ti + 1 < tokens.count { cursorU += groupGap }
        }

        return StampDots(
            u0: u0, v0: v0, totalU: totalU, charH: charH,
            dotR: dotR, soft: soft, reach: reach, haloInv: haloInv,
            flipped: info.flipped,
            dotU: dotU, dotV: dotV, dotBright: dotBright
        )
    }

    private static func sampleRebatePixel(
        px: Int, py: Int, u: Float, v: Float, dots: StampDots?,
        grainCell: Float, monochrome: Bool,
        out: UnsafeMutablePointer<UInt16>, idx: Int
    ) {
        let grain = 0.90 + 0.20 * hash(Int(Float(px) / grainCell), Int(Float(py) / grainCell))
        var r = (monochrome ? baseMono : baseR) * grain
        var g = (monochrome ? baseMono : baseG) * grain
        var b = (monochrome ? baseMono : baseB) * grain

        if let dots, !dots.dotU.isEmpty {
            let rawLu = u - dots.u0
            let rawLv = v - dots.v0
            let lu = dots.flipped ? (dots.totalU - rawLu) : rawLu
            let lv = dots.flipped ? (dots.charH - rawLv) : rawLv
            let reach = dots.reach
            if lu >= -reach && lu <= dots.totalU + reach && lv >= -reach && lv <= dots.charH + reach {
                var core: Float = 0
                var minDist = Float.greatestFiniteMagnitude
                let dotCount = dots.dotU.count
                for k in 0..<dotCount {
                    let du = abs(lu - dots.dotU[k])
                    if du > reach { continue }
                    let dv = abs(lv - dots.dotV[k])
                    if dv > reach { continue }
                    let d = sqrt(du * du + dv * dv) - dots.dotR
                    if d < minDist { minDist = d }
                    if d < dots.soft * 0.5 {
                        let e = dots.dotBright[k] * edge(d, dots.soft)
                        if e > core { core = e }
                    }
                }
                let excess = max(0, minDist) * dots.haloInv
                let halo = 0.16 * exp(-excess * excess)
                if core > 0.002 || halo >= 0.004 {
                    let e = (core + halo * (1 - core)) * grain
                    if monochrome {
                        let l = 1 - exp(-gain * e * ledMono)
                        r = 1 - (1 - r) * (1 - l)
                        g = 1 - (1 - g) * (1 - l)
                        b = 1 - (1 - b) * (1 - l)
                    } else {
                        let lr = 1 - exp(-gain * e * ledR)
                        let lg = 1 - exp(-gain * e * ledG)
                        let lb = 1 - exp(-gain * e * ledB)
                        r = 1 - (1 - r) * (1 - lr)
                        g = 1 - (1 - g) * (1 - lg)
                        b = 1 - (1 - b) * (1 - lb)
                    }
                }
            }
        }

        out[idx] = toU16(r)
        out[idx + 1] = toU16(g)
        out[idx + 2] = toU16(b)
    }

    public static func renderTopBarBand(band: UnsafeMutablePointer<UInt16>, layout: Layout,
                                          bandY: Int, bandRows: Int, info: Pentax645Info,
                                          monochrome: Bool = false) {
        renderBorderBand(band: band, layout: layout, bandY: bandY, bandRows: bandRows, monochrome: monochrome)
    }

    public static func renderBorderBand(band: UnsafeMutablePointer<UInt16>, layout: Layout,
                                        bandY: Int, bandRows: Int, monochrome: Bool = false,
                                        info: Pentax645Info? = nil) {
        let outW = layout.outWidth
        let grainCell = max(1, Float(layout.infoBar) * 0.03)
        for py in bandY..<(bandY + bandRows) {
            let rowOffset = (py - bandY) * outW
            for px in 0..<outW {
                let idx = (rowOffset + px) * 3
                sampleRebatePixel(px: px, py: py, u: 0, v: 0, dots: nil, grainCell: grainCell, monochrome: monochrome, out: band, idx: idx)
            }
        }
    }

    public static func wrapPhotoBand(src: UnsafePointer<UInt16>, dst: UnsafeMutablePointer<UInt16>,
                                     layout: Layout, photoY: Int, bandRows: Int, monochrome: Bool = false,
                                     info: Pentax645Info? = nil) {
        let pw = layout.photoWidth
        let ph = layout.photoHeight
        let ow = layout.outWidth
        let oh = layout.outHeight
        let leftPad = layout.leftPad
        let onLeft = layout.infoOnLeft
        let infoBar = Float(layout.infoBar)
        let cornerSpan = infoBar * 1.6
        let grainCell = max(1, infoBar * 0.03)
        let dots: StampDots? = info.map { buildStampDots(layout: layout, info: $0) }
        var tmp: [UInt16] = [0, 0, 0]

        for r in 0..<bandRows {
            let y = photoY + r
            let py = layout.topPad + y
            let dstRow = r * ow
            for px in 0..<leftPad {
                sampleRebatePixel(px: px, py: py, u: 0, v: 0, dots: nil, grainCell: grainCell, monochrome: monochrome, out: dst, idx: (dstRow + px) * 3)
            }
            dst.advanced(by: (dstRow + leftPad) * 3).update(from: src.advanced(by: r * pw * 3), count: pw * 3)
            for px in (leftPad + pw)..<ow {
                sampleRebatePixel(px: px, py: py, u: 0, v: 0, dots: nil, grainCell: grainCell, monochrome: monochrome, out: dst, idx: (dstRow + px) * 3)
            }

            if !onLeft {
                if y >= layout.infoBar + 2 { continue }
                let yc = Float(y) + 0.5
                for x in 0..<pw {
                    let xc = Float(x) + 0.5
                    let distFromEnd = min(xc, Float(pw) - xc)
                    let edgeY: Float
                    if distFromEnd < cornerSpan {
                        let t = distFromEnd / cornerSpan
                        edgeY = infoBar * (2 * t - t * t)
                    } else {
                        edgeY = infoBar
                    }
                    let d = yc - edgeY
                    if d >= 0.6 { continue }
                    let u = min(max((0.6 - d) / 1.2, 0), 1)
                    let mask = u * u * (3 - 2 * u)
                    let px = leftPad + x
                    let idx = (dstRow + px) * 3
                    tmp.withUnsafeMutableBufferPointer { buf in
                        sampleRebatePixel(px: px, py: py, u: Float(px) + 0.5, v: Float(py) + 0.5, dots: dots, grainCell: grainCell, monochrome: monochrome, out: buf.baseAddress!, idx: 0)
                    }
                    blendPixel(dst: dst, idx: idx, stripe: tmp, mask: mask)
                }
            } else {
                let yc = Float(y) + 0.5
                let distFromEnd = min(yc, Float(ph) - yc)
                let edgeX: Float
                if distFromEnd < cornerSpan {
                    let t = distFromEnd / cornerSpan
                    edgeX = infoBar * (2 * t - t * t)
                } else {
                    edgeX = infoBar
                }
                let xMax = min(pw, Int(edgeX + 1.5))
                for x in 0..<xMax {
                    let d = (Float(x) + 0.5) - edgeX
                    if d >= 0.6 { continue }
                    let u = min(max((0.6 - d) / 1.2, 0), 1)
                    let mask = u * u * (3 - 2 * u)
                    let px = leftPad + x
                    let idx = (dstRow + px) * 3
                    tmp.withUnsafeMutableBufferPointer { buf in
                        sampleRebatePixel(px: px, py: py, u: Float(oh - 1 - py) + 0.5, v: Float(px) + 0.5, dots: dots, grainCell: grainCell, monochrome: monochrome, out: buf.baseAddress!, idx: 0)
                    }
                    blendPixel(dst: dst, idx: idx, stripe: tmp, mask: mask)
                }
            }
        }
    }

    private static func blendPixel(dst: UnsafeMutablePointer<UInt16>, idx: Int, stripe: [UInt16], mask: Float) {
        if mask >= 0.999 {
            dst[idx] = stripe[0]
            dst[idx + 1] = stripe[1]
            dst[idx + 2] = stripe[2]
            return
        }
        let inv = 1 - mask
        for c in 0..<3 {
            dst[idx + c] = UInt16((Float(dst[idx + c]) * inv + Float(stripe[c]) * mask).rounded())
        }
    }

    private static func edge(_ d: Float, _ soft: Float) -> Float {
        let t = min(max((soft * 0.5 - d) / soft, 0), 1)
        return t * t * (3 - 2 * t)
    }

    private static func hash(_ x: Int, _ y: Int) -> Float {
        var h = UInt32(truncatingIfNeeded: x) &* 374761393 &+ UInt32(truncatingIfNeeded: y) &* 668265263
        h = (h ^ (h >> 13)) &* 1274126177
        h ^= h >> 16
        return Float(h & 0xFFFFFF) / 16777215
    }

    private static func toU16(_ v: Float) -> UInt16 { UInt16((min(max(v, 0), 1) * 65535).rounded()) }

    private static let autoMeter7x7 = [
        0b1111111,
        0b1000001,
        0b1001001,
        0b1011101,
        0b1001001,
        0b1000001,
        0b1111111,
    ]

    private static let spotMeter7x7 = [
        0b0000000,
        0b0000000,
        0b0001000,
        0b0011100,
        0b0001000,
        0b0000000,
        0b0000000,
    ]

    private static func glyph5x7(_ ch: Character) -> [Int]? {
        switch ch {
        case "0": return [0b01110, 0b10001, 0b10011, 0b10101, 0b11001, 0b10001, 0b01110]
        case "1": return [0b00100, 0b01100, 0b00100, 0b00100, 0b00100, 0b00100, 0b01110]
        case "2": return [0b01110, 0b10001, 0b00001, 0b00110, 0b01000, 0b10000, 0b11111]
        case "3": return [0b11111, 0b00010, 0b00100, 0b00110, 0b00001, 0b10001, 0b01110]
        case "4": return [0b00010, 0b00110, 0b01010, 0b10010, 0b11111, 0b00010, 0b00010]
        case "5": return [0b11111, 0b10000, 0b11110, 0b00001, 0b00001, 0b10001, 0b01110]
        case "6": return [0b00110, 0b01000, 0b10000, 0b11110, 0b10001, 0b10001, 0b01110]
        case "7": return [0b11111, 0b00001, 0b00010, 0b00100, 0b01000, 0b01000, 0b01000]
        case "8": return [0b01110, 0b10001, 0b10001, 0b01110, 0b10001, 0b10001, 0b01110]
        case "9": return [0b01110, 0b10001, 0b10001, 0b01111, 0b00001, 0b00010, 0b01100]
        case "B": return [0b11110, 0b10001, 0b10001, 0b11110, 0b10001, 0b10001, 0b11110]
        case "E": return [0b11111, 0b10000, 0b10000, 0b11110, 0b10000, 0b10000, 0b11111]
        case "F": return [0b11111, 0b10000, 0b10000, 0b11110, 0b10000, 0b10000, 0b10000]
        case "I": return [0b01110, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b01110]
        case "K": return [0b10001, 0b10010, 0b10100, 0b11000, 0b10100, 0b10010, 0b10001]
        case "L": return [0b10000, 0b10000, 0b10000, 0b10000, 0b10000, 0b10000, 0b11111]
        case "M": return [0b10001, 0b11011, 0b10101, 0b10101, 0b10001, 0b10001, 0b10001]
        case "O": return [0b01110, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01110]
        case "S": return [0b01111, 0b10000, 0b10000, 0b01110, 0b00001, 0b00001, 0b11110]
        case "V": return [0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01010, 0b00100]
        case "W": return [0b10001, 0b10001, 0b10001, 0b10101, 0b10101, 0b11011, 0b10001]
        case "a": return [0b00000, 0b00000, 0b01110, 0b00001, 0b01111, 0b10001, 0b01111]
        case "b": return [0b10000, 0b10000, 0b11110, 0b10001, 0b10001, 0b10001, 0b11110]
        case "c": return [0b00000, 0b00000, 0b01110, 0b10000, 0b10000, 0b10001, 0b01110]
        case "d": return [0b00001, 0b00001, 0b01111, 0b10001, 0b10001, 0b10001, 0b01111]
        case "e": return [0b00000, 0b00000, 0b01110, 0b10001, 0b11111, 0b10000, 0b01110]
        case "f": return [0b00110, 0b01001, 0b01000, 0b11100, 0b01000, 0b01000, 0b01000]
        case "g": return [0b00000, 0b01111, 0b10001, 0b10001, 0b01111, 0b00001, 0b01110]
        case "h": return [0b10000, 0b10000, 0b11110, 0b10001, 0b10001, 0b10001, 0b10001]
        case "i": return [0b00100, 0b00000, 0b01100, 0b00100, 0b00100, 0b00100, 0b01110]
        case "j": return [0b00010, 0b00000, 0b00110, 0b00010, 0b00010, 0b10010, 0b01100]
        case "k": return [0b10000, 0b10000, 0b10010, 0b10100, 0b11000, 0b10100, 0b10010]
        case "l": return [0b01100, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b01110]
        case "m": return [0b00000, 0b00000, 0b11010, 0b10101, 0b10101, 0b10001, 0b10001]
        case "n": return [0b00000, 0b00000, 0b11110, 0b10001, 0b10001, 0b10001, 0b10001]
        case "o": return [0b00000, 0b00000, 0b01110, 0b10001, 0b10001, 0b10001, 0b01110]
        case "p": return [0b00000, 0b11110, 0b10001, 0b10001, 0b11110, 0b10000, 0b10000]
        case "r": return [0b00000, 0b00000, 0b10110, 0b11001, 0b10000, 0b10000, 0b10000]
        case "s": return [0b00000, 0b00000, 0b01111, 0b10000, 0b01110, 0b00001, 0b11110]
        case "t": return [0b01000, 0b01000, 0b11100, 0b01000, 0b01000, 0b01001, 0b00110]
        case "u": return [0b00000, 0b00000, 0b10001, 0b10001, 0b10001, 0b10011, 0b01101]
        case "v": return [0b00000, 0b00000, 0b10001, 0b10001, 0b10001, 0b01010, 0b00100]
        case "y": return [0b00000, 0b10001, 0b10001, 0b10001, 0b01111, 0b00001, 0b01110]
        case "/": return [0b00001, 0b00010, 0b00010, 0b00100, 0b01000, 0b01000, 0b10000]
        case ".": return [0b00000, 0b00000, 0b00000, 0b00000, 0b00000, 0b00100, 0b00100]
        case ":": return [0b00000, 0b00100, 0b00100, 0b00000, 0b00100, 0b00100, 0b00000]
        case "'": return [0b00100, 0b00100, 0b01000, 0b00000, 0b00000, 0b00000, 0b00000]
        case "#": return [0b01010, 0b01010, 0b11111, 0b01010, 0b11111, 0b01010, 0b01010]
        case "+": return [0b00000, 0b00100, 0b00100, 0b11111, 0b00100, 0b00100, 0b00000]
        case "-": return [0b00000, 0b00000, 0b00000, 0b11111, 0b00000, 0b00000, 0b00000]
        case "±": return [0b00100, 0b00100, 0b11111, 0b00100, 0b00100, 0b00000, 0b11111]
        default: return nil
        }
    }
}

public enum ExportSettingsStore {
    private static let defaults = UserDefaults.standard

    public static func load() -> ExportSettings {
        let d = ExportSettings()
        return ExportSettings(
            format: defaults.string(forKey: "export.format").flatMap(ExportFormat.init(rawValue:)) ?? d.format,
            jpegQuality: (defaults.object(forKey: "export.jpegQuality") as? Int ?? d.jpegQuality).clamped(1, 100),
            tiffBits: defaults.integer(forKey: "export.tiffBits") == 8 ? 8 : 16)
    }

    public static func save(_ settings: ExportSettings) {
        defaults.set(settings.format.rawValue, forKey: "export.format")
        defaults.set(settings.jpegQuality, forKey: "export.jpegQuality")
        defaults.set(settings.tiffBits, forKey: "export.tiffBits")
    }
}
