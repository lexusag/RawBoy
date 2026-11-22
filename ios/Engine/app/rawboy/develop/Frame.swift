import Foundation

/**
 * The frame overlay (`uFrame`, shaders/develop.glsl `applyFrame`): a plain solid border drawn inside the output
 * picture, so the export keeps its size. DevelopParams.frame is its thickness in % of the short side (0 = off),
 * DevelopParams.frameColor its colour as `#rrggbb` (display sRGB). Port of Frame.kt / Frame.ts.
 */
public enum Frame {
    public static let max: Float = 20
    public static let defaultColor = "#000000"

    /** The colours the pickers offer; any `#rrggbb` in a preset or edit works too. */
    public static let colors: [(label: String, hex: String)] = [
        ("Black", "#000000"), ("White", "#ffffff"), ("Cream", "#f1ead8"), ("Grey", "#808080"),
    ]

    /** `#rrggbb` (or `rrggbb`) as 0..1 sRGB, or black for anything else. */
    public static func rgb(_ hex: String) -> [Float] {
        guard let n = normalize(hex), let v = Int(n.dropFirst(), radix: 16) else { return [0, 0, 0] }
        return [Float((v >> 16) & 255) / 255, Float((v >> 8) & 255) / 255, Float(v & 255) / 255]
    }

    /** [hex] when it is a valid `#rrggbb`, lower case, else nil. */
    public static func normalize(_ hex: String?) -> String? {
        guard var h = hex?.trimmingCharacters(in: .whitespaces) else { return nil }
        if h.hasPrefix("#") { h.removeFirst() }
        guard h.count == 6, h.allSatisfy({ $0.isHexDigit }) else { return nil }
        return "#" + h.lowercased()
    }
}
