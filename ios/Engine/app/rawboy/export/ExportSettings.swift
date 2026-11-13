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
     * Optional film-style date stamp (e.g. `'26 11 13`) imprinted in the bottom-right corner of the exported image in a
     * yellow-orange 7-segment clock font. Empty string = no date stamp.
     */
    public var dateStamp: String = ""

    public init(format: ExportFormat = .jpeg, jpegQuality: Int = 92, tiffBits: Int = 16,
                jpegEncoder: JpegEncoder = .system, maxLongSide: Int? = nil, downscaleSharpen: Float = 0,
                dateStamp: String = "") {
        self.format = format
        self.jpegQuality = jpegQuality
        self.tiffBits = tiffBits
        self.jpegEncoder = jpegEncoder
        self.maxLongSide = maxLongSide
        self.downscaleSharpen = downscaleSharpen
        self.dateStamp = dateStamp
    }
}

/**
 * Imprints a 35mm film data-back date (`'YY MM DD`) in the bottom-right corner of an exported image, rendered the way
 * a quartz date back does it: orange LED segments shining through the film base onto the emulsion. So the digits are
 * light added to the picture (they show on dark areas and fade into bright ones), soft-edged (the LEDs sit behind the
 * base, out of focus), with a hot yellow core that falls off to red-orange at the fringes, a reddish halation glow,
 * slightly uneven segment brightness and grain. Same output as engine's DateStamp.kt.
 */
public enum DateStamp {
    /** Formats [date] in classic film date-back order: `'YY MM DD` (for example `'26 11 13`). */
    public static func format(_ date: Date = Date(), calendar: Calendar = .current) -> String {
        let comps = calendar.dateComponents([.year, .month, .day], from: date)
        return String(format: "'%02d %02d %02d", (comps.year ?? 0) % 100, comps.month ?? 1, comps.day ?? 1)
    }

    /** The LED's light per film layer, for the response `1 - exp(-gain * E * c)`: red saturates first (yellow core). */
    private static let ledR: Float = 1.0
    private static let ledG: Float = 0.42
    private static let ledB: Float = 0.035
    private static let gain: Float = 3
    /** How much the stamp still darkens blue where the picture is already bright, so it reads (faintly) on a sky. */
    private static let blueAbsorb: Float = 0.55

    /**
     * Burns [text] into the 16-bit interleaved RGB [band] covering rows `[bandY, bandY + bandRows)` of an image of
     * size [width] x [height]. Bands outside the bottom-right stamp box return immediately.
     */
    public static func imprint(band: UnsafeMutablePointer<UInt16>, width: Int, height: Int,
                               bandY: Int, bandRows: Int, text: String) {
        guard !text.isEmpty, width > 0, height > 0, bandRows > 0 else { return }

        let shortSide = Float(min(width, height))
        let charH = max(14 as Float, shortSide * 0.028)
        let charW = charH * 0.56
        let thick = charH * 0.14
        let gap = charH * 0.24
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
        let reach = thick * 3  // the halation's extent
        let slant: Float = 0.14
        let slantMaxShift = charH * 0.5 * slant

        let minY = max(0, Int(y0 - reach))
        let maxY = min(height - 1, Int(y0 + charH + reach))
        if bandY + bandRows <= minY || bandY > maxY { return }
        let minX = max(0, Int(x0 - reach - slantMaxShift))
        let maxX = min(width - 1, Int(x0 + totalW + reach + slantMaxShift))
        if minX > maxX { return }

        let segGap = thick * 0.6
        let halfH = charH * 0.5
        let halfThick = thick * 0.5
        // Out-of-focus LED: the segment edge is a soft ramp, not a pixel-sharp line.
        let soft = max(thick * 0.6, 1)
        let haloInv = 1 / (thick * 1.3)
        let grainCell = max(1, thick * 0.22)

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
                        let d = distToSegment(lx, vy, cw * 0.5, charH * 0.04, cw * 0.5, charH * 0.38)
                        if d < minDist { minDist = d }
                        core = max(core, ledBrightness(i, 7) * edge(d, halfThick, soft))
                        continue
                    }
                    for s in 0..<7 where (m >> s) & 1 != 0 {
                        let d = distToDigitSegment(s, lx, vy, cw, charH, halfH, segGap)
                        if d < minDist { minDist = d }
                        core = max(core, ledBrightness(i, s) * edge(d, halfThick, soft))
                    }
                }
                let excess = max(minDist - halfThick, 0) * haloInv
                let halo = 0.35 * exp(-excess * excess)
                if core <= 0.002 && halo < 0.004 { continue }

                // Grain: the exposure varies a little from clump to clump, as it does in the emulsion.
                let grain = 0.9 + 0.2 * hash(Int(Float(px) / grainCell), Int(Float(py) / grainCell))
                let e = (core + halo * (1 - core)) * grain

                let lr = 1 - exp(-gain * e * ledR)
                let lg = 1 - exp(-gain * e * ledG)
                let lb = 1 - exp(-gain * e * ledB)

                let idx = (rowOffset + px) * 3
                let r = Float(band[idx]) / 65535
                let g = Float(band[idx + 1]) / 65535
                let b = Float(band[idx + 2]) / 65535
                // Light adds to the picture (screen); blue is held back where the LED is strong.
                band[idx] = toU16(1 - (1 - r) * (1 - lr))
                band[idx + 1] = toU16(1 - (1 - g) * (1 - lg))
                band[idx + 2] = toU16((1 - (1 - b) * (1 - lb)) * (1 - blueAbsorb * lr))
            }
        }
    }

    /** Soft segment edge: 1 inside, easing to 0 across [soft] pixels around the segment's outline. */
    private static func edge(_ d: Float, _ halfThick: Float, _ soft: Float) -> Float {
        let t = min(max((halfThick + soft * 0.5 - d) / soft, 0), 1)
        return t * t * (3 - 2 * t)
    }

    /** Each LED segment is a little brighter or dimmer than the others (90-100%), the same for every photo. */
    private static func ledBrightness(_ char: Int, _ segment: Int) -> Float { 0.9 + 0.1 * hash(char * 8 + segment, 911) }

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

    /** Distance to segment [s] (a..g = 0..6) of a digit cell [w] x [h]. */
    private static func distToDigitSegment(_ s: Int, _ x: Float, _ y: Float, _ w: Float, _ h: Float,
                                           _ halfH: Float, _ segGap: Float) -> Float {
        switch s {
        case 0: distToSegment(x, y, segGap, 0, w - segGap, 0)
        case 1: distToSegment(x, y, w, segGap, w, halfH - segGap * 0.5)
        case 2: distToSegment(x, y, w, halfH + segGap * 0.5, w, h - segGap)
        case 3: distToSegment(x, y, segGap, h, w - segGap, h)
        case 4: distToSegment(x, y, 0, halfH + segGap * 0.5, 0, h - segGap)
        case 5: distToSegment(x, y, 0, segGap, 0, halfH - segGap * 0.5)
        default: distToSegment(x, y, segGap, halfH, w - segGap, halfH)
        }
    }

    private static func distToSegment(_ px: Float, _ py: Float, _ ax: Float, _ ay: Float, _ bx: Float, _ by: Float) -> Float {
        let abx = bx - ax
        let aby = by - ay
        let lenSq = abx * abx + aby * aby
        if lenSq <= 0 { return hypot(px - ax, py - ay) }
        let t = min(max(((px - ax) * abx + (py - ay) * aby) / lenSq, 0), 1)
        return hypot(px - (ax + t * abx), py - (ay + t * aby))
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
