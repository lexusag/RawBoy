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
 * Imprints a classic 35mm film data-back date stamp (`'YY MM DD`) in the bottom-right corner of an exported image,
 * using a slanted 7-segment clock font in yellowy-orange with a subtle warm orange halo.
 */
public enum DateStamp {
    /** Formats [date] in classic film date-back order: `'YY MM DD` (for example `'26 11 13`). */
    public static func format(_ date: Date = Date(), calendar: Calendar = .current) -> String {
        let comps = calendar.dateComponents([.year, .month, .day], from: date)
        let year = (comps.year ?? 0) % 100
        let month = comps.month ?? 1
        let day = comps.day ?? 1
        return String(format: "'%02d %02d %02d", year, month, day)
    }

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
        let thick = charH * 0.13
        let gap = charH * 0.24
        let tickAdv = charW * 0.35
        let digitAdv = charW

        let chars = Array(text)
        let count = chars.count
        var cellX = [Float](repeating: 0, count: count)
        var cellW = [Float](repeating: 0, count: count)
        var masks = [Int](repeating: 0, count: count)
        var isTick = [Bool](repeating: false, count: count)

        var cursorX: Float = 0
        for i in 0..<count {
            let ch = chars[i]
            let adv = ch == "'" ? tickAdv : digitAdv
            cellX[i] = cursorX
            cellW[i] = adv
            isTick[i] = ch == "'"
            masks[i] = segmentMask(ch)
            cursorX += adv + (i + 1 < count ? gap : 0)
        }
        let totalW = cursorX

        let marginRight = shortSide * 0.055
        let marginBottom = shortSide * 0.050
        let x0 = Float(width) - marginRight - totalW
        let y0 = Float(height) - marginBottom - charH
        let glowRadius = thick * 1.6
        let slant: Float = 0.14
        let slantMaxShift = charH * 0.5 * slant

        let minY = max(0, Int(y0 - glowRadius))
        let maxY = min(height - 1, Int(y0 + charH + glowRadius))
        if bandY + bandRows <= minY || bandY > maxY { return }

        let minX = max(0, Int(x0 - glowRadius - slantMaxShift))
        let maxX = min(width - 1, Int(x0 + totalW + glowRadius + slantMaxShift))
        if minX > maxX { return }

        let rowStart = max(bandY, minY)
        let rowEnd = min(bandY + bandRows - 1, maxY)
        let segGap = thick * 0.58
        let halfH = charH * 0.5
        let halfThick = thick * 0.5
        let aa: Float = 1.2
        let glowInvSigma: Float = 1 / (thick * 0.65)
        let cullDistance = halfThick + aa * 0.5 + glowRadius

        for py in rowStart...rowEnd {
            let vy = (Float(py) + 0.5) - y0
            let slantOffset = (halfH - vy) * slant
            let rowOffset = (py - bandY) * width
            for px in minX...maxX {
                let ux = (Float(px) + 0.5) - x0 - slantOffset
                var minDist = Float.greatestFiniteMagnitude
                for i in 0..<count {
                    let m = masks[i]
                    let tick = isTick[i]
                    if m == 0 && !tick { continue }
                    let cx = cellX[i]
                    let cw = cellW[i]
                    if ux < cx - cullDistance || ux > cx + cw + cullDistance { continue }
                    let lx = ux - cx
                    let d = tick
                        ? distToSegment(lx, vy, cw * 0.5, charH * 0.04, cw * 0.5, charH * 0.38)
                        : distToDigitSegments(lx, vy, cw, charH, halfH, segGap, m)
                    if d < minDist { minDist = d }
                }

                let tCore = min(max((halfThick + aa * 0.5 - minDist) / aa, 0), 1)
                let core = tCore * tCore * (3 - 2 * tCore)
                let excess = max(minDist - halfThick, 0)
                let tGlow = excess * glowInvSigma
                let glow = 0.38 * exp(-tGlow * tGlow)
                if core <= 0 && glow < 0.005 { continue }

                let idx = (rowOffset + px) * 3
                let r = Float(band[idx]) / 65535
                let g = Float(band[idx + 1]) / 65535
                let b = Float(band[idx + 2]) / 65535

                // Warm orange halo screen-blended on red/green with subtle blue absorption so it reads on bright areas too.
                let r1 = 1 - (1 - r) * (1 - glow)
                let g1 = 1 - (1 - g) * (1 - glow * 0.45)
                let b1 = b * (1 - glow * 0.40) + 0.02 * glow

                let alpha = core * 0.94
                let rOut = r1 + (1.00 - r1) * alpha
                let gOut = g1 + (0.72 - g1) * alpha
                let bOut = b1 + (0.10 - b1) * alpha

                band[idx] = toU16(rOut)
                band[idx + 1] = toU16(gOut)
                band[idx + 2] = toU16(bOut)
            }
        }
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

    private static func distToDigitSegments(_ x: Float, _ y: Float, _ w: Float, _ h: Float,
                                            _ halfH: Float, _ segGap: Float, _ mask: Int) -> Float {
        var minD = Float.greatestFiniteMagnitude
        if (mask & 0x01) != 0 { minD = min(minD, distToSegment(x, y, segGap, 0, w - segGap, 0)) }
        if (mask & 0x02) != 0 { minD = min(minD, distToSegment(x, y, w, segGap, w, halfH - segGap * 0.5)) }
        if (mask & 0x04) != 0 { minD = min(minD, distToSegment(x, y, w, halfH + segGap * 0.5, w, h - segGap)) }
        if (mask & 0x08) != 0 { minD = min(minD, distToSegment(x, y, segGap, h, w - segGap, h)) }
        if (mask & 0x10) != 0 { minD = min(minD, distToSegment(x, y, 0, halfH + segGap * 0.5, 0, h - segGap)) }
        if (mask & 0x20) != 0 { minD = min(minD, distToSegment(x, y, 0, segGap, 0, halfH - segGap * 0.5)) }
        if (mask & 0x40) != 0 { minD = min(minD, distToSegment(x, y, segGap, halfH, w - segGap, halfH)) }
        return minD
    }

    private static func distToSegment(_ px: Float, _ py: Float, _ ax: Float, _ ay: Float, _ bx: Float, _ by: Float) -> Float {
        let abx = bx - ax
        let aby = by - ay
        let lenSq = abx * abx + aby * aby
        if lenSq <= 0 { return hypot(px - ax, py - ay) }
        let t = min(max(((px - ax) * abx + (py - ay) * aby) / lenSq, 0), 1)
        let cx = ax + t * abx
        let cy = ay + t * aby
        return hypot(px - cx, py - cy)
    }

    private static func toU16(_ v: Float) -> UInt16 {
        UInt16(min(max((min(max(v, 0), 1) * 65535).rounded(), 0), 65535))
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
