import Foundation

/** Which edges of the frame the crop may reach past (Extend canvas, chosen per side). */
public struct ExtendSides: Equatable, Sendable {
    public var left: Bool
    public var top: Bool
    public var right: Bool
    public var bottom: Bool

    public init(left: Bool = false, top: Bool = false, right: Bool = false, bottom: Bool = false) {
        self.left = left
        self.top = top
        self.right = right
        self.bottom = bottom
    }

    public static let off = ExtendSides()
    public static let all = ExtendSides(left: true, top: true, right: true, bottom: true)

    public var any: Bool { left || top || right || bottom }

    public func union(_ o: ExtendSides) -> ExtendSides {
        ExtendSides(left: left || o.left, top: top || o.top, right: right || o.right, bottom: bottom || o.bottom)
    }
}

/**
 * How far the crop's edges are drawn to the photo's own edges while dragging (Extend canvas): `photo` is the photo's
 * rectangle in the same fractions as the crop, `tolX` / `tolY` the pull in those fractions (a few screen points).
 */
public struct CropSnap: Sendable {
    public var photo: CropRect
    public var tolX: Float
    public var tolY: Float

    public init(photo: CropRect, tolX: Float, tolY: Float) {
        self.photo = photo
        self.tolX = tolX
        self.tolY = tolY
    }
}

/**
 * User crop: edges as fractions (0..1) of the rotated + straightened frame, i.e. the whole picture the
 * Crop & rotate tool shows. The crop is the last geometry step and never changes lens correction or the
 * straighten auto crop, which always work on the full frame.
 */
public struct CropRect: Equatable, Sendable {
    public var left: Float
    public var top: Float
    public var right: Float
    public var bottom: Float

    public init(_ left: Float, _ top: Float, _ right: Float, _ bottom: Float) {
        self.left = left
        self.top = top
        self.right = right
        self.bottom = bottom
    }

    public var width: Float { right - left }
    public var height: Float { bottom - top }
    public var isFull: Bool { left == 0 && top == 0 && right == 1 && bottom == 1 }

    /** True when the crop reaches past the frame, so part of the output is canvas to fill. */
    public var extendsFrame: Bool { left < 0 || top < 0 || right > 1 || bottom > 1 }

    /** The sides the crop reaches past the frame. */
    public var sides: ExtendSides { ExtendSides(left: left < 0, top: top < 0, right: right > 1, bottom: bottom > 1) }
}

public extension DevelopParams {
    var crop: CropRect { CropRect(cropLeft, cropTop, cropRight, cropBottom) }

    func withCrop(_ r: CropRect) -> DevelopParams {
        var p = self
        p.cropLeft = r.left
        p.cropTop = r.top
        p.cropRight = r.right
        p.cropBottom = r.bottom
        return p
    }

    /** The same edit on the whole frame: what the Crop & rotate tool shows while it is open. */
    func withoutCrop() -> DevelopParams { withCrop(CropMath.full) }
}

/** Crop aspect ratios offered by the tool, as long side : short side (orientation is chosen separately). */
public enum CropAspect: CaseIterable, Sendable {
    case free, original, square, r5x4, r4x3, r3x2, r16x9, r2x1, r239x1

    private var sides: (long: Double, short: Double, longLabel: String, shortLabel: String) {
        switch self {
        case .free, .original: (0, 0, "", "")
        case .square: (1, 1, "1", "1")
        case .r5x4: (5, 4, "5", "4")
        case .r4x3: (4, 3, "4", "3")
        case .r3x2: (3, 2, "3", "2")
        case .r16x9: (16, 9, "16", "9")
        case .r2x1: (2, 1, "2", "1")
        case .r239x1: (2.39, 1, "2.39", "1")
        }
    }

    public func label(portrait: Bool) -> String {
        switch self {
        case .free: "Free"
        case .original: "Original"
        case .square: "1:1"
        default: portrait ? "\(sides.shortLabel):\(sides.longLabel)" : "\(sides.longLabel):\(sides.shortLabel)"
        }
    }

    /** Width / height in pixels, or nil for free. */
    public func ratio(frameWidth: Int, frameHeight: Int, portrait: Bool) -> Double? {
        switch self {
        case .free:
            return nil
        case .original:
            let a = Double(frameWidth) / Double(frameHeight)
            return portrait ? min(a, 1 / a) : max(a, 1 / a)
        default:
            return portrait ? sides.short / sides.long : sides.long / sides.short
        }
    }
}

/** Pure crop geometry shared by the Pro UI (mirrored in Android's CropMath.kt and web's CropMath.ts). */
public enum CropMath {
    public static let full = CropRect(0, 0, 1, 1)

    /** How far a crop may reach past each edge of the frame (fraction of that side); the canvas there is filled. */
    public static let maxExtend: Float = 0.3

    /** Screen points the crop sticks to a photo edge. */
    public static let snapPoints: CGFloat = 8

    /**
     * The canvas the crop tool shows while extending: the frame plus `maxExtend` past each chosen edge, as a crop of
     * the frame. `toView` / `fromView` map a crop to and from fractions of that canvas, so the tool's frame, grid and
     * drags work as on the plain frame, and a side that is not extended ends at the photo's edge.
     */
    public static func extendedView(_ s: ExtendSides) -> CropRect {
        CropRect(s.left ? -maxExtend : 0, s.top ? -maxExtend : 0,
                 1 + (s.right ? maxExtend : 0), 1 + (s.bottom ? maxExtend : 0))
    }

    public static func toView(_ r: CropRect, _ s: ExtendSides = .all) -> CropRect {
        let v = extendedView(s)
        return CropRect((r.left - v.left) / v.width, (r.top - v.top) / v.height,
                        (r.right - v.left) / v.width, (r.bottom - v.top) / v.height)
    }

    public static func fromView(_ c: CropRect, _ s: ExtendSides = .all) -> CropRect {
        let v = extendedView(s)
        return CropRect(c.left * v.width + v.left, c.top * v.height + v.top,
                        c.right * v.width + v.left, c.bottom * v.height + v.top)
    }

    /** [r] with each edge held to the canvas of [s]: the frame, plus `maxExtend` past the chosen sides (turning a side off). */
    public static func within(_ r: CropRect, _ s: ExtendSides) -> CropRect {
        let v = extendedView(s)
        return CropRect(r.left.clamped(v.left, v.right), r.top.clamped(v.top, v.bottom),
                        r.right.clamped(v.left, v.right), r.bottom.clamped(v.top, v.bottom))
    }

    /** [r] pulled back inside the frame (turning Extend off). */
    public static func insideFrame(_ r: CropRect) -> CropRect { within(r, .off) }

    /** Smallest crop side in frame pixels. */
    public static let minPixels = 64

    public enum Handle: Sendable { case move, left, top, right, bottom, topLeft, topRight, bottomLeft, bottomRight }

    /** The crop after turning the picture by [quarterTurns] clockwise quarter turns. */
    public static func rotate(_ r: CropRect, quarterTurns: Int) -> CropRect {
        var c = r
        for _ in 0..<(((quarterTurns % 4) + 4) % 4) {
            // Clockwise: frame point (x, y) moves to (1 - y, x).
            c = CropRect(1 - c.bottom, c.left, 1 - c.top, c.right)
        }
        return c
    }

    /**
     * [p]'s perspective sliders after turning the picture by [quarterTurns] clockwise quarter turns, so the keystone
     * stays on the same edges of the picture: clockwise, the vertical tilt becomes the horizontal one and the
     * horizontal the vertical (exact for one slider; with both set the two tilts apply in the other order).
     */
    public static func rotatePerspective(_ p: DevelopParams, quarterTurns: Int) -> DevelopParams {
        var r = p
        for _ in 0..<(((quarterTurns % 4) + 4) % 4) {
            let v = r.perspectiveVertical
            r.perspectiveVertical = r.perspectiveHorizontal
            r.perspectiveHorizontal = v == 0 ? 0 : -v
        }
        return r
    }

    /**
     * [p] with the picture as shown mirrored left-right ([vertical] false) or top-bottom. The flips are stored on the
     * unturned photo, so a sideways turn swaps the axis; the straighten angle and the crop mirror with the picture.
     */
    public static func flip(_ p: DevelopParams, vertical: Bool) -> DevelopParams {
        var f = p
        if vertical != (p.rotation % 2 != 0) { f.flipVertical.toggle() } else { f.flipHorizontal.toggle() }
        f.straighten = p.straighten == 0 ? 0 : -p.straighten
        // The keystone mirrors too: a left-right mirror turns the horizontal tilt the other way, top-bottom the vertical one.
        if vertical {
            f.perspectiveVertical = p.perspectiveVertical == 0 ? 0 : -p.perspectiveVertical
        } else {
            f.perspectiveHorizontal = p.perspectiveHorizontal == 0 ? 0 : -p.perspectiveHorizontal
        }
        let r = p.crop
        return f.withCrop(vertical ? CropRect(r.left, 1 - r.bottom, r.right, 1 - r.top) : CropRect(1 - r.right, r.top, 1 - r.left, r.bottom))
    }

    /**
     * [r] reshaped to [ratio] (width / height in pixels) with about the same area, around the same
     * centre, inside the frame. Nil ratio = free: [r] unchanged.
     */
    public static func withAspect(_ r: CropRect, ratio: Double?, frameWidth: Int, frameHeight: Int,
                                  sides: ExtendSides = .off) -> CropRect {
        guard let ratio else { return r }
        let fw = Double(frameWidth)
        let fh = Double(frameHeight)
        let area = Double(r.width) * fw * Double(r.height) * fh
        var w = (area * ratio).squareRoot()
        var h = w / ratio
        let v = extendedView(sides)
        let fit = min(1.0, min(Double(v.width) * fw / w, Double(v.height) * fh / h))
        w *= fit
        h *= fit
        let cx = (Double(r.left + r.right) / 2 * fw).clamped(Double(v.left) * fw + w / 2, Double(v.right) * fw - w / 2)
        let cy = (Double(r.top + r.bottom) / 2 * fh).clamped(Double(v.top) * fh + h / 2, Double(v.bottom) * fh - h / 2)
        return fromPixels(cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2, fw, fh, sides: sides)
    }

    /**
     * [start] after dragging [handle] by ([dx], [dy]) in frame fractions, kept inside the frame, at least
     * [minPixels] wide and high, and at [ratio] (width / height in pixels) when not nil. With [snap], an edge that
     * comes within its pull of the photo's edge lands on it (dragging on past the pull lets go).
     */
    public static func drag(_ start: CropRect, handle: Handle, dx: Float, dy: Float, ratio: Double?,
                            frameWidth: Int, frameHeight: Int, extend: Bool = false, snap: CropSnap? = nil) -> CropRect {
        let fw = Double(frameWidth)
        let fh = Double(frameHeight)
        // Bounds of the canvas the crop may use: the frame, plus maxExtend past each edge when extending.
        let ex = extend ? Double(maxExtend) : 0
        let x0 = -ex * fw
        let x1 = (1 + ex) * fw
        let y0 = -ex * fh
        let y1 = (1 + ex) * fh
        let minW = min(Double(minPixels), fw)
        let minH = min(Double(minPixels), fh)
        let l = Double(start.left) * fw
        let t = Double(start.top) * fh
        let r = Double(start.right) * fw
        let b = Double(start.bottom) * fh
        var mx = Double(dx) * fw
        var my = Double(dy) * fh

        if let snap {
            let all = handle == .move
            var xs: [Double] = []
            var ys: [Double] = []
            if all || handle == .left || handle == .topLeft || handle == .bottomLeft { xs.append(Double(snap.photo.left) * fw - l) }
            if all || handle == .right || handle == .topRight || handle == .bottomRight { xs.append(Double(snap.photo.right) * fw - r) }
            if all || handle == .top || handle == .topLeft || handle == .topRight { ys.append(Double(snap.photo.top) * fh - t) }
            if all || handle == .bottom || handle == .bottomLeft || handle == .bottomRight { ys.append(Double(snap.photo.bottom) * fh - b) }
            mx = pull(mx, xs, Double(snap.tolX) * fw)
            my = pull(my, ys, Double(snap.tolY) * fh)
        }

        if handle == .move {
            let ox = mx.clamped(x0 - l, x1 - r)
            let oy = my.clamped(y0 - t, y1 - b)
            return fromPixels(l + ox, t + oy, r + ox, b + oy, fw, fh, sides: extend ? .all : .off)
        }

        let movesLeft = handle == .left || handle == .topLeft || handle == .bottomLeft
        let movesRight = handle == .right || handle == .topRight || handle == .bottomRight
        let movesTop = handle == .top || handle == .topLeft || handle == .topRight
        let movesBottom = handle == .bottom || handle == .bottomLeft || handle == .bottomRight

        guard let ratio else {
            let nl = movesLeft ? (l + mx).clamped(x0, r - minW) : l
            let nr = movesRight ? (r + mx).clamped(l + minW, x1) : r
            let nt = movesTop ? (t + my).clamped(y0, b - minH) : t
            let nb = movesBottom ? (b + my).clamped(t + minH, y1) : b
            return fromPixels(nl, nt, nr, nb, fw, fh, sides: extend ? .all : .off)
        }

        let horizontal = movesLeft || movesRight
        let vertical = movesTop || movesBottom
        // Anchor: the opposite edge (or corner); a single edge keeps the other axis centred.
        let ax = movesLeft ? r : movesRight ? l : (l + r) / 2
        let ay = movesTop ? b : movesBottom ? t : (t + b) / 2
        let wantW = horizontal ? abs((movesLeft ? l + mx : r + mx) - ax) : 0
        let wantH = vertical ? abs((movesTop ? t + my : b + my) - ay) : 0
        var w = max(wantW, wantH * ratio)
        // Room around the anchor, per axis (both halves when that axis stays centred).
        let roomW = movesLeft ? ax - x0 : movesRight ? x1 - ax : 2 * min(ax - x0, x1 - ax)
        let roomH = movesTop ? ay - y0 : movesBottom ? y1 - ay : 2 * min(ay - y0, y1 - ay)
        w = min(w, min(roomW, roomH * ratio))
        w = min(max(w, max(minW, minH * ratio)), min(roomW, roomH * ratio))
        let h = w / ratio
        let nl = movesLeft ? ax - w : movesRight ? ax : ax - w / 2
        let nt = movesTop ? ay - h : movesBottom ? ay : ay - h / 2
        return fromPixels(nl, nt, nl + w, nt + h, fw, fh, sides: extend ? .all : .off)
    }

    /**
     * The handle under frame point ([x], [y]) (fractions), with grab distances [tolX], [tolY] in fractions:
     * corners first, then edges, then inside = move. Nil outside the crop.
     */
    public static func handleAt(_ r: CropRect, x: Float, y: Float, tolX: Float, tolY: Float) -> Handle? {
        let nearL = abs(x - r.left) <= tolX
        let nearR = abs(x - r.right) <= tolX
        let nearT = abs(y - r.top) <= tolY
        let nearB = abs(y - r.bottom) <= tolY
        let inX = x >= r.left - tolX && x <= r.right + tolX
        let inY = y >= r.top - tolY && y <= r.bottom + tolY
        if !inX || !inY { return nil }
        if nearT && nearL { return .topLeft }
        if nearT && nearR { return .topRight }
        if nearB && nearL { return .bottomLeft }
        if nearB && nearR { return .bottomRight }
        if nearL { return .left }
        if nearR { return .right }
        if nearT { return .top }
        if nearB { return .bottom }
        return .move
    }

    /** The offset among [offsets] that puts an edge on the photo's edge, when [want] is within [tol] of one; else [want]. */
    private static func pull(_ want: Double, _ offsets: [Double], _ tol: Double) -> Double {
        var best = want
        var gap = tol
        for o in offsets where abs(o - want) <= gap {
            best = o
            gap = abs(o - want)
        }
        return best
    }

    private static func fromPixels(_ l: Double, _ t: Double, _ r: Double, _ b: Double, _ fw: Double,
                                   _ fh: Double, sides: ExtendSides = .off) -> CropRect {
        let v = extendedView(sides)
        return CropRect(Float(l / fw).clamped(v.left, v.right), Float(t / fh).clamped(v.top, v.bottom),
                        Float(r / fw).clamped(v.left, v.right), Float(b / fh).clamped(v.top, v.bottom))
    }
}
