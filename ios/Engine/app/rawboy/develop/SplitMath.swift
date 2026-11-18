import CoreGraphics

/**
 * Before/after split (Pro's compare slider, RawBoy Desktop): the divider sits at a fraction of the picture's width, the
 * as-shot render on its left and the edit on its right. Pure maths, so the drag is testable.
 */
public enum SplitMath {
    /** The divider never reaches the picture's edges, so it can always be grabbed again. */
    public static let margin: CGFloat = 0.02

    /** The divider's fraction after a drag that started at [start] and moved [translation] points over a picture [width] wide. */
    public static func dragged(start: CGFloat, translation: CGFloat, width: CGFloat) -> CGFloat {
        guard width > 0 else { return start }
        return clamp(start + translation / width)
    }

    /** The fraction for a click at [x] (points) on a picture spanning [minX, minX + width]. */
    public static func fraction(at x: CGFloat, minX: CGFloat, width: CGFloat) -> CGFloat {
        width > 0 ? clamp((x - minX) / width) : 0.5
    }

    public static func clamp(_ f: CGFloat) -> CGFloat { min(max(f, margin), 1 - margin) }

    /** The part of the picture that shows the as-shot render, for a divider at [fraction]. */
    public static func originalRect(_ picture: CGRect, fraction: CGFloat) -> CGRect {
        CGRect(x: picture.minX, y: picture.minY, width: picture.width * clamp(fraction), height: picture.height)
    }
}
