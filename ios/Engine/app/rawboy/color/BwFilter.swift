import Foundation

/**
 * A colour filter for black and white (RawBoy Film's B&W mode; port of color/BwFilter.kt): like a glass filter on the
 * lens, it passes its own colour and holds back the others, so they print lighter or darker once the picture is grey.
 * Gains on linear Rec.2020 after white balance (rough Wratten 8 / 21 / 25 / 11 transmissions), divided by their
 * luminance so middle grey keeps its exposure.
 */
public enum BwFilter: String, CaseIterable, Sendable {
    /** No filter (key "none"; not `.none`, which reads as Optional's). */
    case off = "none"
    case yellow, orange, red, green

    /** Stored key (as BwFilter.kt / BwFilter.ts). */
    public var key: String { rawValue }

    public var label: String {
        switch self {
        case .off: "None"
        case .yellow: "Yellow"
        case .orange: "Orange"
        case .red: "Red"
        case .green: "Green"
        }
    }

    private var gains: (Double, Double, Double) {
        switch self {
        case .off: (1, 1, 1)
        case .yellow: (1, 0.92, 0.35)
        case .orange: (1, 0.6, 0.12)
        case .red: (1, 0.18, 0.03)
        case .green: (0.4, 1, 0.35)
        }
    }

    /** Row-major diagonal gains, luminance-normalised (Rec.2020, as LUMA_REC2020); identity for `.off`. */
    public func matrix() -> [Double] {
        let (r, g, b) = gains
        let y = 0.2627 * r + 0.6780 * g + 0.0593 * b
        return Mat3.diagonal(r / y, g / y, b / y)
    }

    public static func fromKey(_ key: String?) -> BwFilter? { key.flatMap { BwFilter(rawValue: $0) } }
}
