import RawBoyEngine
import SwiftUI
#if canImport(UIKit)
import UIKit
#else
import AppKit
#endif

enum MaskTool { case move, brush, erase }

/** Points per drawn line or ellipse (they bend with the lens correction, as in the shader). */
private let steps = 48
/** Rotation knob distance beyond the ellipse, as a fraction of its vertical radius. */
private let knob: CGFloat = 1.3
/** Curvature handle on a linear mask's centre line: this fraction of the long side from the middle. */
private let curveHandle: CGFloat = 0.22
/** A new stroke point after the finger moved this fraction of the brush radius. */
private let pointStep: CGFloat = 0.15
/** A second finger this soon after the first turns the touch into a pan and drops the stroke just started. */
private let panGrace: TimeInterval = 0.15

enum MaskHandle: Equatable { case move, start, end, rx, ry, rotate, curve, bend, pin
    /** A glow leak's outline point (which of the 8). */
    case outline(Int)
}

/** A light leak's form, for a radial shape that is one (rx, ry = its length and width radii). */
struct LeakForm: Equatable {
    let kind: LeakKind
    let bend: Float
    let taper: Float
    /** A glow's 8 outline radii (LightLeaks' radii); all 1: an ellipse, but still with its outline points. */
    var radii: [Float] = LightLeaks.roundRadii
}

/**
 * Where masks sit on screen: image pixels (display orientation, full resolution) <-> preview pixels, through the
 * lens transform and the fit or 100% placement the renderer uses. Port of Android's / web's MaskOverlay geometry.
 * Screen positions are in view pixels (points × scale), like the renderer's.
 */
struct MaskGeometry {
    let lens: LensTransform
    let viewW: CGFloat
    let viewH: CGFloat
    let r: [CGFloat]
    let w: CGFloat
    let h: CGFloat
    let long: CGFloat

    /**
     * [frame]: the fit view's frame plus margin; [zoomFrame]: the frame the zoomed view keeps, [zoomScale] its view
     * pixels per image pixel (as the renderer's).
     */
    init(lens: LensTransform, viewW: Int, viewH: Int, frame: Int, zoomCenter: (Float, Float)?, zoomScale: Float = 1,
         zoomFrame: Int = 0) {
        self.lens = lens
        self.viewW = CGFloat(viewW)
        self.viewH = CGFloat(viewH)
        let rect = zoomCenter.map {
            ZoomMath.zoomedRect(cx: $0.0, cy: $0.1, viewW: viewW, viewH: viewH, imgW: lens.outputWidth,
                                imgH: lens.outputHeight, scale: zoomScale, frame: zoomFrame)
        } ?? ZoomMath.fitRect(viewW: viewW, viewH: viewH, imgW: lens.outputWidth, imgH: lens.outputHeight, frame: frame)
        r = rect.map { CGFloat($0) }
        w = CGFloat(lens.width)
        h = CGFloat(lens.height)
        long = max(w, h)
    }

    func toScreen(_ x: CGFloat, _ y: CGFloat) -> CGPoint {
        let o = lens.output(Double(x), Double(y))
        return CGPoint(x: r[0] + CGFloat(o[0]) / CGFloat(lens.outputWidth) * r[2],
                       y: r[1] + CGFloat(o[1]) / CGFloat(lens.outputHeight) * r[3])
    }

    func toImage(_ p: CGPoint) -> CGPoint {
        let s = lens.source(Double((p.x - r[0]) / r[2] * CGFloat(lens.outputWidth)),
                            Double((p.y - r[1]) / r[3] * CGFloat(lens.outputHeight)))
        return CGPoint(x: s[0], y: s[1])
    }

    struct Axes {
        let p0: CGPoint, mid: CGPoint, dir: CGPoint, perp: CGPoint
        let len: CGFloat
    }

    func axes(_ x0: Float, _ y0: Float, _ x1: Float, _ y1: Float) -> Axes {
        let dx = CGFloat(x1 - x0) * w
        let dy = CGFloat(y1 - y0) * h
        let len = max(hypot(dx, dy), 1e-6)
        return Axes(p0: CGPoint(x: CGFloat(x0) * w, y: CGFloat(y0) * h),
                    mid: CGPoint(x: CGFloat(x0 + x1) / 2 * w, y: CGFloat(y0 + y1) / 2 * h),
                    dir: CGPoint(x: dx / len, y: dy / len), perp: CGPoint(x: -dy / len, y: dx / len), len: len)
    }

    /** Image-pixel corners of the whole preview (photo, frame and the space around), without lens distortion. */
    private func viewCorners() -> [CGPoint] {
        let m = lens.outToImage
        return [CGPoint(x: 0, y: 0), CGPoint(x: viewW, y: 0), CGPoint(x: 0, y: viewH), CGPoint(x: viewW, y: viewH)].map {
            let ox = Double(($0.x - r[0]) / r[2] * CGFloat(lens.outputWidth))
            let oy = Double(($0.y - r[1]) / r[3] * CGFloat(lens.outputHeight))
            // Projective with a perspective correction; past its horizon (w <= 0) clamp w, which only widens the extent.
            let w = max(m[6] * ox + m[7] * oy + m[8], 0.05)
            return CGPoint(x: (m[0] * ox + m[1] * oy + m[2]) / w, y: (m[3] * ox + m[4] * oy + m[5]) / w)
        }
    }

    enum Shape {
        case linear(start: [CGPoint], centre: [CGPoint], end: [CGPoint], pin: CGPoint, curve: CGPoint)
        /** [bend]: a light leak's bend square, nil for a mask. */
        case radial(outer: [CGPoint], inner: [CGPoint], pin: CGPoint, rx: [CGPoint], ry: [CGPoint], knob: CGPoint,
                    knobBase: CGPoint, bend: CGPoint?, outline: [CGPoint])
        case brush(pin: CGPoint?)

        var pin: CGPoint? {
            switch self {
            case let .linear(_, _, _, pin, _): pin
            case let .radial(_, _, pin, _, _, _, _, _, _): pin
            case let .brush(pin): pin
            }
        }
    }

    /**
     * [leak]: a radial shape drawn as that light leak's outline (glow, streak or triangle, bent and tapered like the
     * shader). [stripe]: it is a stripe mask, whose ends fade over the same distance as its sides.
     */
    func shape(_ l: MaskLayer, leak: LeakForm? = nil, stripe: Bool = false) -> Shape {
        switch l.shape {
        case let .stripe(cx, cy, rx, ry, angle, feather, bend, taper):
            // Drawn, hit and dragged as a radial shape with a light leak streak's form.
            var radial = l
            radial.shape = .radial(cx: cx, cy: cy, rx: rx, ry: ry, angle: angle, feather: feather)
            return shape(radial, leak: LeakForm(kind: .streak, bend: bend, taper: taper), stripe: true)
        case .brush:
            if let p = l.strokes.first?.points, p.count >= 2 { return .brush(pin: toScreen(CGFloat(p[0]) * w, CGFloat(p[1]) * h)) }
            return .brush(pin: nil)
        case let .linear(x0, y0, x1, y1, curve):
            let a = axes(x0, y0, x1, y1)
            func at(_ along: CGFloat, _ across: CGFloat) -> CGPoint {
                let t = along - CGFloat(Masks.curveOffset(curve: curve, s: Float(across), long: Float(long)))
                return toScreen(a.p0.x + a.dir.x * t + a.perp.x * across, a.p0.y + a.dir.y * t + a.perp.y * across)
            }
            // Across the whole preview: the perpendicular extent of its corners.
            let across = viewCorners().map { ($0.x - a.p0.x) * a.perp.x + ($0.y - a.p0.y) * a.perp.y }
            let lo = across.min()!
            let hi = across.max()!
            let n = steps * 2
            func line(_ along: CGFloat) -> [CGPoint] { (0...n).map { at(along, lo + (hi - lo) * CGFloat($0) / CGFloat(n)) } }
            return .linear(start: line(0), centre: line(a.len / 2), end: line(a.len), pin: toScreen(a.mid.x, a.mid.y),
                           curve: at(a.len / 2, curveHandle * long))
        case let .radial(scx, scy, srx, sry, angle, feather):
            let ang = Double(angle) * .pi / 180
            let c = CGFloat(cos(ang))
            let sn = CGFloat(sin(ang))
            let rx = CGFloat(srx) * long
            let ry = CGFloat(sry) * long
            let cx = CGFloat(scx) * w
            let cy = CGFloat(scy) * h
            func at(_ u: CGFloat, _ v: CGFloat) -> CGPoint { toScreen(cx + c * u - sn * v, cy + sn * u + c * v) }
            let k = leak.map { CGFloat(LightLeaks.bendCurvature($0.bend, rxPx: Float(rx))) } ?? 0
            let radii: [Float]? = leak?.kind == .glow ? leak?.radii : nil
            /// A glow's outline radius at angle [t] of its own frame (1 for other shapes).
            func radiusAt(_ t: CGFloat) -> CGFloat { radii.map { CGFloat(LightLeaks.radius($0, Float(t))) } ?? 1 }
            // A point in the leak's own frame (q: 1 = its radii) through its taper and bend, like the shader.
            func atQ(_ qx: CGFloat, _ qy: CGFloat) -> CGPoint {
                let u = qx * rx
                let taper = leak.map { CGFloat(LightLeaks.taperWidth($0.taper, qx: Float(qx))) } ?? 1
                return at(u, qy * ry * taper + k * u * u)
            }
            func polygon(_ corners: [(CGFloat, CGFloat)], _ n: Int) -> [CGPoint] {
                corners.indices.flatMap { i -> [CGPoint] in
                    let (ax, ay) = corners[i]
                    let (bx, by) = corners[(i + 1) % corners.count]
                    return (0..<n).map { j in atQ(ax + (bx - ax) * CGFloat(j) / CGFloat(n), ay + (by - ay) * CGFloat(j) / CGFloat(n)) }
                }
            }
            func outline(_ sc: CGFloat) -> [CGPoint] {
                switch leak?.kind {
                case .some(.streak):
                    // Edges at sc x the half width; a stripe mask's ends fade over the same distance as its sides.
                    let ex = stripe ? max(0, 1 - (1 - sc) * ry / rx) : 1
                    return polygon([(ex, sc), (-ex, sc), (-ex, -sc), (ex, -sc)], steps)
                case .some(.triangle): return polygon([(sc, 0), (-sc, sc), (-sc, -sc)], steps)
                default:
                    return (0..<steps).map {
                        let t = CGFloat($0) / CGFloat(steps) * 2 * .pi
                        let rr = radiusAt(t)
                        // The shader's edge is (|q| - r) / sqrt(r): the inner line sits (1 - sc) sqrt(r) inside the outline.
                        let len = radii != nil ? max(0.01, rr - (1 - sc) * rr.squareRoot()) : sc
                        return atQ(len * cos(t), len * sin(t))
                    }
                }
            }
            // A thin leak's knob keeps clear of its width handles.
            let knobAt = leak != nil ? max(ry * knob, ry + 0.06 * long) : ry * knob
            return .radial(outer: outline(1), inner: outline(1 - min(max(CGFloat(feather) / 100, 0.01), 0.95)), pin: at(0, 0),
                           rx: [atQ(radiusAt(0), 0), atQ(-radiusAt(.pi), 0)],
                           // A triangle's width handles: its base corners; a reshaped glow's sit on its outline.
                           ry: leak?.kind == .triangle ? [atQ(-1, 1), atQ(-1, -1)]
                               : radii != nil ? [atQ(0, radiusAt(.pi / 2)), atQ(0, -radiusAt(-.pi / 2))] : [at(0, ry), at(0, -ry)],
                           knob: at(0, -knobAt), knobBase: at(0, -ry), bend: leak != nil ? atQ(0.5, 0) : nil,
                           // A glow leak's outline points (hollow dots), between the size dots.
                           outline: radii.map { rs in rs.indices.map { i in
                               let t = CGFloat(LightLeaks.radiusAngle(i))
                               return atQ(CGFloat(rs[i]) * cos(t), CGFloat(rs[i]) * sin(t))
                           } } ?? [])
        }
    }

    /** The bend (-100..100) that puts a leak's axis through image point [to], or nil too near its middle. */
    func bendAt(_ shape: MaskShape, _ to: CGPoint) -> Float? {
        let axis: (Float, Float, Float, Float)
        switch shape {
        case let .radial(x, y, r, _, a, _), let .stripe(x, y, r, _, a, _, _, _): axis = (x, y, r, a)
        default: return nil
        }
        let (cx, cy, rx, angle) = axis
        let a = Double(angle) * .pi / 180
        let dx = Double(to.x - CGFloat(cx) * w)
        let dy = Double(to.y - CGFloat(cy) * h)
        let rxPx = Double(CGFloat(rx) * long)
        let u = cos(a) * dx + sin(a) * dy
        let v = -sin(a) * dx + cos(a) * dy
        if abs(u) < rxPx * 0.15 { return nil }
        // v = k u², k = bend / 100 / rx.
        return Float((min(max(100 * v * rxPx / (u * u), -100), 100) * 10).rounded() / 10)
    }

    /** Preview point [p] lies inside a radial shape's outer ellipse (a leak: its outline). */
    func inside(_ l: MaskLayer, _ p: CGPoint, _ leak: LeakForm?) -> Bool {
        if case let .stripe(cx, cy, rx, ry, angle, feather, bend, taper) = l.shape {
            var radial = l
            radial.shape = .radial(cx: cx, cy: cy, rx: rx, ry: ry, angle: angle, feather: feather)
            return inside(radial, p, LeakForm(kind: .streak, bend: bend, taper: taper))
        }
        guard case let .radial(cx, cy, srx, sry, angle, _) = l.shape else { return false }
        let q = toImage(p)
        let a = Double(angle) * .pi / 180
        let dx = Double(q.x - CGFloat(cx) * w)
        let dy = Double(q.y - CGFloat(cy) * h)
        let rx = Float(CGFloat(srx) * long)
        let ry = Float(CGFloat(sry) * long)
        let pu = Float(cos(a) * dx + sin(a) * dy)
        var pv = Float(-sin(a) * dx + cos(a) * dy)
        guard let leak else { return (pu / rx) * (pu / rx) + (pv / ry) * (pv / ry) < 1 }
        pv -= LightLeaks.bendCurvature(leak.bend, rxPx: rx) * pu * pu
        let qx = pu / rx
        let qy = pv / (ry * LightLeaks.taperWidth(leak.taper, qx: qx))
        return LightLeaks.edge(leak.kind, qx: qx, qy: qy, radii: leak.radii) < 0 && (leak.kind != .streak || abs(qx) < 1)
    }

    /** Image point [to] in a leak's own frame (q: 1 = its radii), through its bend and taper, like the shader. */
    func toQ(_ s: MaskShape, _ leak: LeakForm, _ to: CGPoint) -> (Float, Float) {
        let axis: (Float, Float, Float, Float, Float)
        switch s {
        case let .radial(x, y, rx, ry, a, _), let .stripe(x, y, rx, ry, a, _, _, _): axis = (x, y, rx, ry, a)
        default: return (0, 0)
        }
        let (cx, cy, srx, sry, angle) = axis
        let a = Double(angle) * .pi / 180
        let dx = Double(to.x - CGFloat(cx) * w)
        let dy = Double(to.y - CGFloat(cy) * h)
        let rx = Float(CGFloat(srx) * long)
        let pu = Float(cos(a) * dx + sin(a) * dy)
        let pv = Float(-sin(a) * dx + cos(a) * dy) - LightLeaks.bendCurvature(leak.bend, rxPx: rx) * pu * pu
        let qx = pu / rx
        return (qx, pv / (Float(CGFloat(sry) * long) * LightLeaks.taperWidth(leak.taper, qx: qx)))
    }

    /**
     * A glow's 8 outline radii after its outline point [index] is dragged to image point [to]: the point follows the pointer
     * along its own direction from the centre, within LightLeaks' radius limits.
     */
    func reshape(_ s: MaskShape, _ leak: LeakForm, index: Int, to: CGPoint) -> [Float] {
        let (qx, qy) = toQ(s, leak, to)
        let t = LightLeaks.radiusAngle(index)
        let rr = (qx * cosf(t) + qy * sinf(t)).clamped(LightLeaks.radiusMin, LightLeaks.radiusMax)
        var radii = leak.radii
        radii[index] = (rr * 1000).rounded() / 1000
        return radii
    }

    /** The shape after dragging [handle] from image point [from] to [to]; [radii]: a reshaped glow's, whose size dots sit on its outline. */
    func drag(_ s: MaskShape, _ handle: MaskHandle, _ from: CGPoint, _ to: CGPoint, radii: [Float]? = nil) -> MaskShape {
        let dx = Float((to.x - from.x) / w)
        let dy = Float((to.y - from.y) / h)
        switch s {
        case .brush:
            return s
        case let .stripe(cx, cy, rx, ry, angle, feather, bend, taper):
            guard case let .radial(ncx, ncy, nrx, nry, nangle, _) =
                    drag(.radial(cx: cx, cy: cy, rx: rx, ry: ry, angle: angle, feather: feather), handle, from, to, radii: radii) else { return s }
            return .stripe(cx: ncx, cy: ncy, rx: nrx, ry: nry, angle: nangle, feather: feather, bend: bend, taper: taper)
        case let .linear(x0, y0, x1, y1, curve):
            switch handle {
            case .curve:
                // The bend that puts the centre line through the finger.
                let a = axes(x0, y0, x1, y1)
                let vx = to.x - a.mid.x
                let vy = to.y - a.mid.y
                let across = vx * a.perp.x + vy * a.perp.y
                if abs(across) < long * 0.02 { return s }
                let along = vx * a.dir.x + vy * a.dir.y
                let c = -along * long * 100 / (CGFloat(Masks.curveScale) * 4 * across * across)
                return .linear(x0: x0, y0: y0, x1: x1, y1: y1, curve: Float((min(max(c, -100), 100) * 10).rounded()) / 10)
            case .start: return .linear(x0: x0 + dx, y0: y0 + dy, x1: x1, y1: y1, curve: curve)
            case .end: return .linear(x0: x0, y0: y0, x1: x1 + dx, y1: y1 + dy, curve: curve)
            default: return .linear(x0: x0 + dx, y0: y0 + dy, x1: x1 + dx, y1: y1 + dy, curve: curve)
            }
        case let .radial(cx, cy, rx, ry, angle, feather):
            if handle == .move { return .radial(cx: cx + dx, cy: cy + dy, rx: rx, ry: ry, angle: angle, feather: feather) }
            let vx = Double(to.x - CGFloat(cx) * w)
            let vy = Double(to.y - CGFloat(cy) * h)
            let a = Double(angle) * .pi / 180
            if handle == .rotate {
                var deg = atan2(vy, vx) * 180 / .pi + 90
                if deg > 180 { deg -= 360 }
                return .radial(cx: cx, cy: cy, rx: rx, ry: ry, angle: Float((deg * 10).rounded()) / 10, feather: feather)
            }
            // Radius along the ellipse's own (rotated) axis; a reshaped glow's dot sits on its outline, [radii] times out.
            let su = Float(cos(a) * vx + sin(a) * vy)
            let sv = Float(-sin(a) * vx + cos(a) * vy)
            let r: Float = radii.map { handle == .rx ? LightLeaks.radius($0, su >= 0 ? 0 : .pi) : LightLeaks.radius($0, sv >= 0 ? .pi / 2 : -.pi / 2) } ?? 1
            return handle == .rx
                ? .radial(cx: cx, cy: cy, rx: max(0.01, abs(su) / r / Float(long)), ry: ry, angle: angle, feather: feather)
                : .radial(cx: cx, cy: cy, rx: rx, ry: max(0.01, abs(sv) / r / Float(long)), angle: angle, feather: feather)
        }
    }

    /** Brush radius on screen: one radius along x from the image point under [p]. */
    func brushRadiusOnScreen(_ p: CGPoint, _ radius: Float) -> CGFloat {
        let c = toImage(p)
        let e = toScreen(c.x + CGFloat(radius) * long, c.y)
        return max(2, hypot(e.x - p.x, e.y - p.y))
    }

    /**
     * [grabInside]: a touch anywhere inside a radial shape grabs it (light leaks), not only its centre pin. [leaks]: the
     * forms of radial shapes that are light leaks, by id.
     */
    func hit(_ layers: [MaskLayer], _ selectedId: String?, _ p: CGPoint, _ grab: CGFloat, grabInside: Bool = false,
             leaks: [String: LeakForm] = [:]) -> (String, MaskHandle)? {
        func near(_ q: CGPoint, _ d: CGFloat) -> Bool { hypot(p.x - q.x, p.y - q.y) < d }
        func nearLine(_ line: [CGPoint]) -> Bool { (1..<line.count).contains { dist2(p, line[$0 - 1], line[$0]) < grab * grab } }
        if let selected = layers.first(where: { $0.id == selectedId }) {
            switch shape(selected, leak: leaks[selected.id]) {
            case let .radial(_, _, pin, rx, ry, k, _, bend, outline):
                if near(k, grab) { return (selected.id, .rotate) }
                if let bend, near(bend, grab) { return (selected.id, .bend) }
                if let i = outline.firstIndex(where: { near($0, grab) }) { return (selected.id, .outline(i)) }
                if rx.contains(where: { near($0, grab) }) { return (selected.id, .rx) }
                if ry.contains(where: { near($0, grab) }) { return (selected.id, .ry) }
                if near(pin, grab * 1.5) { return (selected.id, .move) }
                if grabInside && inside(selected, p, leaks[selected.id]) { return (selected.id, .move) }
            case let .linear(start, centre, end, _, curve):
                if near(curve, grab) { return (selected.id, .curve) }
                if nearLine(start) { return (selected.id, .start) }
                if nearLine(end) { return (selected.id, .end) }
                if nearLine(centre) { return (selected.id, .move) }
            case .brush:
                break
            }
        }
        for l in layers where l.id != selectedId {
            if let pin = shape(l, leak: leaks[l.id]).pin, near(pin, grab) { return (l.id, .pin) }
        }
        if grabInside, let l = layers.last(where: { $0.id != selectedId && inside($0, p, leaks[$0.id]) }) {
            // Topmost (last drawn in the shader) first; a touch inside another shape selects it and starts moving it.
            return (l.id, .move)
        }
        return nil
    }

    private func dist2(_ p: CGPoint, _ a: CGPoint, _ b: CGPoint) -> CGFloat {
        let dx = b.x - a.x
        let dy = b.y - a.y
        let len2 = dx * dx + dy * dy
        let t = len2 > 0 ? min(max(((p.x - a.x) * dx + (p.y - a.y) * dy) / len2, 0), 1) : 0
        let x = a.x + t * dx - p.x
        let y = a.y + t * dy - p.y
        return x * x + y * y
    }

    /** Image point -> stroke point (image fractions, rounded: strokes stay small in memory). */
    func fraction(_ p: CGPoint) -> [Float] {
        [Float((p.x / w * 1e5).rounded() / 1e5), Float((p.y / h * 1e5).rounded() / 1e5)]
    }
}

/** What the mask gestures report (all on the main thread). */
struct MaskActions {
    let onSelect: (String) -> Void
    let onChange: (String, MaskShape) -> Void
    let onStrokeBegin: (String, BrushStroke) -> Void
    let onStrokeExtend: (String, String, [Float]) -> Void
    /** The stroke just begun turned out to be a two-finger pan: drop it. */
    let onStrokeCancel: (String) -> Void
    let onPan: (Float, Float) -> Void
    /** Two fingers pinched: zoom by the factor around that view point (view pixels). */
    var onZoom: (Float, Float, Float) -> Void = { _, _, _ in }
}

/** Everything the touch layer needs, read fresh for every touch. */
struct MaskInputs {
    var lens: LensTransform
    var layers: [MaskLayer]
    var selectedId: String?
    var frame: Int
    var zoomCenter: (Float, Float)?
    var zoomScale: Float = 1
    /** The frame the zoomed view keeps around the photo (without the fit view's margin). */
    var zoomFrame = 0
    var tool: MaskTool
    var brush: BrushSettings
    var actions: MaskActions
    var onPaintAt: (CGPoint?) -> Void
    /** A finger anywhere inside a radial shape moves it (the light leaks tool, which shows its leaks as radial shapes). */
    var grabInside = false
    /** The light leaks' forms by id. */
    var leaks: [String: LeakForm] = [:]
    /** A leak's bend square was dragged to this bend. */
    var onBend: (String, Float) -> Void = { _, _ in }
    /** A glow leak's outline point was dragged: its new 8 radii. */
    var onReshape: (String, [Float]) -> Void = { _, _ in }
}

#if canImport(UIKit)
/**
 * Mask touches over the preview. Move: a finger on a handle drags it (or on another layer's pin selects it);
 * anywhere else the touch falls through to the preview (double-tap zoom, pan, press-and-hold compare).
 * Brush / Erase: one finger paints, two fingers pan the 100% view. Positions reported to [onPaintAt] are in points.
 */
struct MaskTouchLayer: UIViewRepresentable {
    let inputs: MaskInputs

    func makeUIView(context: Context) -> MaskTouchView {
        let v = MaskTouchView()
        v.isMultipleTouchEnabled = true
        v.backgroundColor = .clear
        return v
    }

    func updateUIView(_ view: MaskTouchView, context: Context) { view.inputs = inputs }
}

final class MaskTouchView: UIView {
    var inputs: MaskInputs?
    private static let grab: CGFloat = 24  // points

    private var geometry: MaskGeometry?
    // Move tool
    private var dragLayer: String?
    private var dragHandle: MaskHandle?
    private var dragStart: MaskShape?
    private var dragFrom: CGPoint = .zero
    // Brush tool
    private var strokeLayer: String?
    private var strokeId: String?
    private var strokeBegan: TimeInterval = 0
    private var last: CGPoint = .zero
    private var panning = false
    private var lastCentroid: CGPoint?
    /** The fingers' mean distance from their centroid at the last move, for a pinch. */
    private var lastSpread: CGFloat?

    private var scale: CGFloat { window?.screen.scale ?? traitCollection.displayScale }

    private func makeGeometry(_ inp: MaskInputs) -> MaskGeometry {
        MaskGeometry(lens: inp.lens, viewW: Int(bounds.width * scale), viewH: Int(bounds.height * scale), frame: inp.frame,
                     zoomCenter: inp.zoomCenter, zoomScale: inp.zoomScale, zoomFrame: inp.zoomFrame)
    }

    private func px(_ p: CGPoint) -> CGPoint { CGPoint(x: p.x * scale, y: p.y * scale) }

    /** Move tool: only handles are ours; every other touch goes to the preview underneath. */
    override func hitTest(_ point: CGPoint, with event: UIEvent?) -> UIView? {
        guard let inp = inputs, bounds.contains(point) else { return nil }
        if inp.tool != .move { return inp.layers.contains { $0.id == inp.selectedId } ? self : nil }
        return makeGeometry(inp).hit(inp.layers, inp.selectedId, px(point), Self.grab * scale, grabInside: inp.grabInside,
                                     leaks: inp.leaks) != nil ? self : nil
    }

    override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent?) {
        guard let inp = inputs else { return }
        let all = event?.allTouches?.filter { $0.phase != .ended && $0.phase != .cancelled } ?? touches
        if all.count >= 2 || strokeLayer != nil || dragLayer != nil {
            beginPan(inp, all)
            return
        }
        guard let t = touches.first else { return }
        let g = makeGeometry(inp)
        geometry = g
        let p = px(t.location(in: self))
        if inp.tool == .move {
            guard let (id, handle) = g.hit(inp.layers, inp.selectedId, p, Self.grab * scale, grabInside: inp.grabInside,
                                           leaks: inp.leaks) else { return }
            if handle == .pin {
                inp.actions.onSelect(id)
                return
            }
            if id != inp.selectedId { inp.actions.onSelect(id) }
            dragLayer = id
            dragHandle = handle
            dragStart = inp.layers.first { $0.id == id }?.shape
            dragFrom = g.toImage(p)
            return
        }
        guard let layer = inp.layers.first(where: { $0.id == inp.selectedId }) else { return }
        let start = g.toImage(p)
        let stroke = BrushStroke(id: Masks.newId(), erase: inp.tool == .erase, auto: inp.brush.auto, radius: inp.brush.radius,
                                 hardness: inp.brush.hardness, flow: inp.brush.flow, points: g.fraction(start))
        strokeLayer = layer.id
        strokeId = stroke.id
        strokeBegan = t.timestamp
        last = start
        inp.actions.onStrokeBegin(layer.id, stroke)
        inp.onPaintAt(t.location(in: self))
    }

    private func beginPan(_ inp: MaskInputs, _ touches: Set<UITouch>) {
        if !panning {
            panning = true
            inp.onPaintAt(nil)
            if let layer = strokeLayer, let t = touches.first, t.timestamp - strokeBegan < panGrace {
                inp.actions.onStrokeCancel(layer)
            }
            strokeLayer = nil
            dragLayer = nil
        }
        lastCentroid = centroid(touches)
        lastSpread = touches.count >= 2 ? spread(touches, lastCentroid!) : nil
    }

    private func spread(_ touches: Set<UITouch>, _ c: CGPoint) -> CGFloat {
        let pts = touches.map { $0.location(in: self) }
        return pts.map { hypot($0.x - c.x, $0.y - c.y) }.reduce(0, +) / CGFloat(pts.count)
    }

    private func centroid(_ touches: Set<UITouch>) -> CGPoint {
        let pts = touches.map { $0.location(in: self) }
        return CGPoint(x: pts.map(\.x).reduce(0, +) / CGFloat(pts.count), y: pts.map(\.y).reduce(0, +) / CGFloat(pts.count))
    }

    override func touchesMoved(_ touches: Set<UITouch>, with event: UIEvent?) {
        guard let inp = inputs, let g = geometry else { return }
        let active = event?.allTouches?.filter { $0.phase != .ended && $0.phase != .cancelled } ?? touches
        if panning {
            let c = centroid(active)
            let d = active.count >= 2 ? spread(active, c) : nil
            if active.count >= 2, let prev = lastCentroid {
                // Pinch around where the fingers were, then follow them.
                if let d, let before = lastSpread, before > 0, d > 0, abs(d / before - 1) > 0.001 {
                    inp.actions.onZoom(Float(prev.x * scale), Float(prev.y * scale), Float(d / before))
                }
                inp.actions.onPan(Float((c.x - prev.x) * scale), Float((c.y - prev.y) * scale))
            }
            lastCentroid = c
            lastSpread = d
            return
        }
        guard let t = touches.first else { return }
        let p = px(t.location(in: self))
        if let id = dragLayer, let handle = dragHandle, let start = dragStart {
            if handle == .bend {
                guard let bend = g.bendAt(start, g.toImage(p)) else { return }
                if case let .stripe(cx, cy, rx, ry, angle, feather, _, taper) = start {
                    inp.actions.onChange(id, .stripe(cx: cx, cy: cy, rx: rx, ry: ry, angle: angle, feather: feather, bend: bend,
                                                     taper: taper))
                } else {
                    inp.onBend(id, bend)
                }
                return
            }
            if case let .outline(i) = handle {
                // The point follows the pointer along its own direction from the centre.
                guard let leak = inp.leaks[id] else { return }
                inp.onReshape(id, g.reshape(start, leak, index: i, to: g.toImage(p)))
                return
            }
            inp.actions.onChange(id, g.drag(start, handle, dragFrom, g.toImage(p), radii: inp.leaks[id].flatMap { $0.kind == .glow ? $0.radii : nil }))
            return
        }
        guard let layer = strokeLayer, let sid = strokeId else { return }
        inp.onPaintAt(t.location(in: self))
        let img = g.toImage(p)
        if hypot(img.x - last.x, img.y - last.y) < max(0.5, CGFloat(inp.brush.radius) * g.long * pointStep) { return }
        last = img
        inp.actions.onStrokeExtend(layer, sid, g.fraction(img))
    }

    override func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent?) {
        let remaining = event?.allTouches?.filter { $0.phase != .ended && $0.phase != .cancelled } ?? []
        if remaining.isEmpty { finish() }
    }

    override func touchesCancelled(_ touches: Set<UITouch>, with event: UIEvent?) { finish() }

    private func finish() {
        inputs?.onPaintAt(nil)
        dragLayer = nil
        dragHandle = nil
        dragStart = nil
        strokeLayer = nil
        strokeId = nil
        panning = false
        lastCentroid = nil
        lastSpread = nil
    }
}
#endif

#if !canImport(UIKit)
/**
 * macOS: mouse and trackpad on the mask layers, the counterpart of the touch view. Move: a click on a handle drags it
 * (or on another layer's pin selects it); every other click goes to the preview underneath. Brush / Erase: the left
 * button paints; the trackpad's two-finger scroll or the middle button pans the 100% view, pinch or wheel zooms.
 */
struct MaskTouchLayer: NSViewRepresentable {
    let inputs: MaskInputs

    func makeNSView(context: Context) -> MaskTouchView { MaskTouchView() }

    func updateNSView(_ view: MaskTouchView, context: Context) { view.inputs = inputs }
}

final class MaskTouchView: NSView {
    var inputs: MaskInputs?
    private static let grab: CGFloat = 24  // points

    private var geometry: MaskGeometry?
    private var dragLayer: String?
    private var dragHandle: MaskHandle?
    private var dragStart: MaskShape?
    private var dragFrom: CGPoint = .zero
    private var strokeLayer: String?
    private var strokeId: String?
    private var last: CGPoint = .zero
    private var panFrom: CGPoint?

    override var isFlipped: Bool { true }

    // VoiceOver: the handles are for the pointer; the panels' sliders do the same from the keyboard.
    override func isAccessibilityElement() -> Bool { inputs.map { i in i.layers.contains { $0.id == i.selectedId } } ?? false }
    override func accessibilityRole() -> NSAccessibility.Role? { .group }
    override func accessibilityLabel() -> String? { "Handles of the selected shape" }
    override func accessibilityHelp() -> String? { "Drag a handle with the mouse or trackpad. The sliders in the panel change the same values from the keyboard." }

    /** A click that brings the window forward also grabs the handle under it (the system slider does the same). */
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }

    private var scale: CGFloat { window?.backingScaleFactor ?? 2 }

    private func makeGeometry(_ inp: MaskInputs) -> MaskGeometry {
        MaskGeometry(lens: inp.lens, viewW: Int(bounds.width * scale), viewH: Int(bounds.height * scale), frame: inp.frame,
                     zoomCenter: inp.zoomCenter, zoomScale: inp.zoomScale, zoomFrame: inp.zoomFrame)
    }

    private func px(_ p: CGPoint) -> CGPoint { CGPoint(x: p.x * scale, y: p.y * scale) }

    private func local(_ event: NSEvent) -> CGPoint { convert(event.locationInWindow, from: nil) }

    /** Move tool: only handles are ours; other clicks (and the wheel over empty space) go to the preview underneath. */
    override func hitTest(_ point: NSPoint) -> NSView? {
        let p = convert(point, from: superview)
        guard let inp = inputs, bounds.contains(p) else { return nil }
        if inp.tool != .move { return inp.layers.contains { $0.id == inp.selectedId } ? self : nil }
        return makeGeometry(inp).hit(inp.layers, inp.selectedId, px(p), Self.grab * scale, grabInside: inp.grabInside,
                                     leaks: inp.leaks) != nil ? self : nil
    }

    override func mouseDown(with event: NSEvent) {
        guard let inp = inputs else { return }
        if NSEvent.pressedMouseButtons & 0b100 != 0 || event.modifierFlags.contains(.option) {  // middle button: pan
            panFrom = local(event)
            return
        }
        let g = makeGeometry(inp)
        geometry = g
        let at = local(event)
        let p = px(at)
        if inp.tool == .move {
            guard let (id, handle) = g.hit(inp.layers, inp.selectedId, p, Self.grab * scale, grabInside: inp.grabInside,
                                           leaks: inp.leaks) else { return }
            if handle == .pin {
                inp.actions.onSelect(id)
                return
            }
            if id != inp.selectedId { inp.actions.onSelect(id) }
            dragLayer = id
            dragHandle = handle
            dragStart = inp.layers.first { $0.id == id }?.shape
            dragFrom = g.toImage(p)
            return
        }
        guard let layer = inp.layers.first(where: { $0.id == inp.selectedId }) else { return }
        let start = g.toImage(p)
        let stroke = BrushStroke(id: Masks.newId(), erase: inp.tool == .erase || event.modifierFlags.contains(.option),
                                 auto: inp.brush.auto, radius: inp.brush.radius, hardness: inp.brush.hardness,
                                 flow: inp.brush.flow, points: g.fraction(start))
        strokeLayer = layer.id
        strokeId = stroke.id
        last = start
        inp.actions.onStrokeBegin(layer.id, stroke)
        inp.onPaintAt(at)
    }

    override func mouseDragged(with event: NSEvent) {
        guard let inp = inputs, let g = geometry else { return }
        let at = local(event)
        if let from = panFrom {
            inp.actions.onPan(Float((at.x - from.x) * scale), Float((at.y - from.y) * scale))
            panFrom = at
            return
        }
        let p = px(at)
        if let id = dragLayer, let handle = dragHandle, let start = dragStart {
            if handle == .bend {
                guard let bend = g.bendAt(start, g.toImage(p)) else { return }
                if case let .stripe(cx, cy, rx, ry, angle, feather, _, taper) = start {
                    inp.actions.onChange(id, .stripe(cx: cx, cy: cy, rx: rx, ry: ry, angle: angle, feather: feather, bend: bend,
                                                     taper: taper))
                } else {
                    inp.onBend(id, bend)
                }
                return
            }
            if case let .outline(i) = handle {
                // The point follows the pointer along its own direction from the centre.
                guard let leak = inp.leaks[id] else { return }
                inp.onReshape(id, g.reshape(start, leak, index: i, to: g.toImage(p)))
                return
            }
            inp.actions.onChange(id, g.drag(start, handle, dragFrom, g.toImage(p), radii: inp.leaks[id].flatMap { $0.kind == .glow ? $0.radii : nil }))
            return
        }
        guard let layer = strokeLayer, let sid = strokeId else { return }
        inp.onPaintAt(at)
        let img = g.toImage(p)
        if hypot(img.x - last.x, img.y - last.y) < max(0.5, CGFloat(inp.brush.radius) * g.long * pointStep) { return }
        last = img
        inp.actions.onStrokeExtend(layer, sid, g.fraction(img))
    }

    override func mouseMoved(with event: NSEvent) {
        guard let inp = inputs, inp.tool != .move else { return }
        inp.onPaintAt(local(event))
    }

    override func mouseUp(with event: NSEvent) { finish() }

    override func otherMouseDown(with event: NSEvent) { panFrom = local(event) }

    override func otherMouseDragged(with event: NSEvent) {
        guard let inp = inputs, let from = panFrom else { return }
        let at = local(event)
        inp.actions.onPan(Float((at.x - from.x) * scale), Float((at.y - from.y) * scale))
        panFrom = at
    }

    override func otherMouseUp(with event: NSEvent) { panFrom = nil }

    /** Trackpad scroll pans; a wheel (or Cmd + scroll) zooms around the pointer, as over the plain preview. */
    override func scrollWheel(with event: NSEvent) {
        guard let inp = inputs else { return }
        let at = px(local(event))
        if event.hasPreciseScrollingDeltas && !event.modifierFlags.contains(.command) {
            inp.actions.onPan(Float(event.scrollingDeltaX * scale), Float(event.scrollingDeltaY * scale))
        } else {
            let step = event.hasPreciseScrollingDeltas ? event.scrollingDeltaY / 120 : event.scrollingDeltaY / 6
            inp.actions.onZoom(Float(at.x), Float(at.y), Float(exp(step * 0.35)))
        }
    }

    override func magnify(with event: NSEvent) {
        guard let inp = inputs else { return }
        let at = px(local(event))
        inp.actions.onZoom(Float(at.x), Float(at.y), Float(1 + event.magnification))
    }

    override func updateTrackingAreas() {
        super.updateTrackingAreas()
        for a in trackingAreas { removeTrackingArea(a) }
        addTrackingArea(NSTrackingArea(rect: bounds, options: [.mouseMoved, .activeInKeyWindow, .inVisibleRect], owner: self))
    }

    private func finish() {
        inputs?.onPaintAt(nil)
        dragLayer = nil
        dragHandle = nil
        dragStart = nil
        strokeLayer = nil
        strokeId = nil
        panFrom = nil
    }
}
#endif

/**
 * Draws the masks over the preview (fit or 100% view), Capture One style. Linear: the full-effect, centre and
 * no-effect lines across the whole preview, the curvature square; radial: the ellipse, its feather ring, centre,
 * radius dots and rotation knob; other layers: a pin. While painting the shapes are dimmed and a circle follows the
 * finger; [sizeRing] shows the brush size in the middle (while its slider moves).
 */
struct MaskOverlay: View {
    let lens: LensTransform
    let layers: [MaskLayer]
    let selectedId: String?
    let frame: Int
    let zoomCenter: (Float, Float)?
    var zoomScale: Float = 1
    /** The frame the zoomed view keeps around the photo (without the fit view's margin). */
    var zoomFrame = 0
    let tool: MaskTool
    let brush: BrushSettings
    /** Finger position in points, while painting. */
    let paintAt: CGPoint?
    let sizeRing: Bool
    /** Forms of radial shapes that are light leaks, by id (drawn as their outlines, with a bend square). */
    var leaks: [String: LeakForm] = [:]

    @Environment(\.displayScale) private var scale

    var body: some View {
        Canvas { ctx, size in
            let g = MaskGeometry(lens: lens, viewW: Int(size.width * scale), viewH: Int(size.height * scale), frame: frame,
                                 zoomCenter: zoomCenter, zoomScale: zoomScale, zoomFrame: zoomFrame)
            func pt(_ p: CGPoint) -> CGPoint { CGPoint(x: p.x / scale, y: p.y / scale) }
            func line(_ pts: [CGPoint], _ width: CGFloat, _ alpha: Double, dashed: Bool = false, closed: Bool = false) {
                guard pts.count >= 2 else { return }
                var path = Path()
                path.addLines(pts.map(pt))
                if closed { path.closeSubpath() }
                let dash: [CGFloat] = dashed ? [6 * width / 1.5, 5 * width / 1.5] : []
                ctx.stroke(path, with: .color(.black.opacity(0.45 * alpha)), style: StrokeStyle(lineWidth: width + 2, dash: dash))
                ctx.stroke(path, with: .color(.white.opacity(alpha)), style: StrokeStyle(lineWidth: width, dash: dash))
            }
            func dot(_ p: CGPoint, _ radius: CGFloat, filled: Bool, _ alpha: Double) {
                let c = pt(p)
                let rect = CGRect(x: c.x - radius, y: c.y - radius, width: 2 * radius, height: 2 * radius)
                ctx.fill(Path(ellipseIn: rect), with: .color(filled ? .white.opacity(alpha) : .black.opacity(0.35 * alpha)))
                ctx.stroke(Path(ellipseIn: rect), with: .color(.white.opacity(alpha)), lineWidth: 1.5)
            }
            func ring(_ c: CGPoint, _ r: CGFloat) {
                let rect = CGRect(x: c.x - r, y: c.y - r, width: 2 * r, height: 2 * r)
                ctx.stroke(Path(ellipseIn: rect), with: .color(.black.opacity(0.5)), lineWidth: 3)
                ctx.stroke(Path(ellipseIn: rect), with: .color(.white), lineWidth: 1.2)
                if brush.hardness > 0 {
                    let ri = r * CGFloat(brush.hardness) / 100 * 0.95
                    ctx.stroke(Path(ellipseIn: CGRect(x: c.x - ri, y: c.y - ri, width: 2 * ri, height: 2 * ri)),
                               with: .color(.white), style: StrokeStyle(lineWidth: 1, dash: [3, 3]))
                }
            }
            func square(_ p: CGPoint, _ alpha: Double) {
                let c = pt(p)
                let sq = CGRect(x: c.x - 6, y: c.y - 6, width: 12, height: 12)
                ctx.fill(Path(sq), with: .color(.black.opacity(0.35 * alpha)))
                ctx.stroke(Path(sq), with: .color(.white.opacity(alpha)), lineWidth: 1.5)
            }
            let dim: Double = tool == .move ? 1 : 0.4
            for l in layers {
                let s = g.shape(l, leak: leaks[l.id])
                if l.id != selectedId {
                    if let pin = s.pin { dot(pin, 6, filled: false, l.enabled ? dim : dim * 0.5) }
                    continue
                }
                switch s {
                case let .linear(start, centre, end, pin, curve):
                    line(start, 1.5, dim)
                    line(centre, 2.5, dim)
                    line(end, 1.5, dim, dashed: true)
                    dot(pin, 6, filled: true, dim)
                    square(curve, dim)
                case let .radial(outer, inner, pin, rx, ry, k, knobBase, bend, outline):
                    line(outer, 2, dim, closed: true)
                    line(inner, 1.2, dim, dashed: true, closed: true)
                    line([knobBase, k], 1.2, dim)
                    dot(k, 7, filled: false, dim)
                    for p in rx + ry { dot(p, 6, filled: true, dim) }
                    for p in outline { dot(p, 4.5, filled: false, dim) }
                    if let bend { square(bend, dim) }
                    dot(pin, 8, filled: true, dim)
                case .brush:
                    break
                }
            }
            if tool != .move {
                if let p = paintAt { ring(p, g.brushRadiusOnScreen(px(p), brush.radius) / scale) }
                if sizeRing {
                    let c = CGPoint(x: size.width / 2, y: size.height / 2)
                    ring(c, g.brushRadiusOnScreen(px(c), brush.radius) / scale)
                }
            }
        }
        .allowsHitTesting(false)
    }

    private func px(_ p: CGPoint) -> CGPoint { CGPoint(x: p.x * scale, y: p.y * scale) }
}

/**
 * Axis-aligned box overlay for generated film leaks (`FilmLeak`): drag inside to move, 8 handles to stretch along X/Y,
 * and a bright source edge showing `turn` (0 left, 1 top, 2 right, 3 bottom). Outside the box/pins, hits pass through.
 */
struct FilmLeakOverlay: View {
    let lens: LensTransform
    let leaks: [FilmLeak]
    let selectedId: String?
    let frame: Int
    let zoomCenter: (Float, Float)?
    let zoomScale: Float
    let zoomFrame: Int
    let onSelect: (String) -> Void
    let onChange: (String, (inout FilmLeak) -> Void) -> Void

    @Environment(\.displayScale) private var scale
    @State private var dragStart: (id: String, cx: Float, cy: Float, w: Float, h: Float)?

    private enum Handle: CaseIterable {
        case move, tl, t, tr, r, br, b, bl, l
    }

    var body: some View {
        GeometryReader { geo in
            let g = MaskGeometry(lens: lens, viewW: Int(geo.size.width * scale), viewH: Int(geo.size.height * scale),
                                 frame: frame, zoomCenter: zoomCenter, zoomScale: zoomScale, zoomFrame: zoomFrame)
            let pt = { (x: Float, y: Float) -> CGPoint in
                let p = g.toScreen(CGFloat(x) * g.w, CGFloat(y) * g.h)
                return CGPoint(x: p.x / scale, y: p.y / scale)
            }
            ZStack(alignment: .topLeading) {
                Canvas { ctx, _ in
                    for fl in leaks {
                        let c = pt(fl.cx, fl.cy)
                        if fl.id != selectedId {
                            let r: CGFloat = 6
                            let rect = CGRect(x: c.x - r, y: c.y - r, width: 2 * r, height: 2 * r)
                            ctx.fill(Path(ellipseIn: rect), with: .color(.black.opacity(0.35)))
                            ctx.stroke(Path(ellipseIn: rect), with: .color(.white.opacity(fl.enabled ? 1 : 0.5)), lineWidth: 1.5)
                            continue
                        }
                        let x0 = fl.cx - fl.w / 2, x1 = fl.cx + fl.w / 2
                        let y0 = fl.cy - fl.h / 2, y1 = fl.cy + fl.h / 2
                        let tl = pt(x0, y0), tr = pt(x1, y0), br = pt(x1, y1), bl = pt(x0, y1)
                        let edges: [(CGPoint, CGPoint, Int)] = [(bl, tl, 0), (tl, tr, 1), (tr, br, 2), (br, bl, 3)]
                        for (a, b, side) in edges {
                            var p = Path()
                            p.move(to: a)
                            p.addLine(to: b)
                            let isSource = ((fl.turn % 4) + 4) % 4 == side
                            ctx.stroke(p, with: .color(.black.opacity(0.5)), lineWidth: isSource ? 4.5 : 3)
                            ctx.stroke(p, with: .color(isSource ? .accentColor : .white),
                                       style: StrokeStyle(lineWidth: isSource ? 2.5 : 1.5, dash: isSource ? [] : [5, 4]))
                        }
                        let handles = [tl, pt(fl.cx, y0), tr, pt(x1, fl.cy), br, pt(fl.cx, y1), bl, pt(x0, fl.cy)]
                        for h in handles {
                            let r: CGFloat = 5
                            let rect = CGRect(x: h.x - r, y: h.y - r, width: 2 * r, height: 2 * r)
                            ctx.fill(Path(rect), with: .color(.black.opacity(0.45)))
                            ctx.stroke(Path(rect), with: .color(.white), lineWidth: 1.5)
                        }
                        let pr: CGFloat = 6
                        let pRect = CGRect(x: c.x - pr, y: c.y - pr, width: 2 * pr, height: 2 * pr)
                        ctx.fill(Path(ellipseIn: pRect), with: .color(.white))
                        ctx.stroke(Path(ellipseIn: pRect), with: .color(.black.opacity(0.5)), lineWidth: 1.5)
                    }
                }
                .allowsHitTesting(false)

                ForEach(leaks.filter { $0.id != selectedId }) { fl in
                    let c = pt(fl.cx, fl.cy)
                    Color.clear.frame(width: 28, height: 28)
                        .contentShape(Rectangle())
                        .position(c)
                        .onTapGesture { onSelect(fl.id) }
                }

                if let fl = leaks.first(where: { $0.id == selectedId }) {
                    let x0 = fl.cx - fl.w / 2, x1 = fl.cx + fl.w / 2
                    let y0 = fl.cy - fl.h / 2, y1 = fl.cy + fl.h / 2
                    let tl = pt(x0, y0), br = pt(x1, y1)
                    let boxW = max(24, abs(br.x - tl.x))
                    let boxH = max(24, abs(br.y - tl.y))
                    Color.clear.frame(width: boxW, height: boxH)
                        .contentShape(Rectangle())
                        .position(x: (tl.x + br.x) / 2, y: (tl.y + br.y) / 2)
                        .gesture(dragHandle(.move, for: fl, g: g))

                    let specs: [(Handle, CGPoint)] = [
                        (.tl, tl), (.t, pt(fl.cx, y0)), (.tr, pt(x1, y0)), (.r, pt(x1, fl.cy)),
                        (.br, br), (.b, pt(fl.cx, y1)), (.bl, pt(x0, y1)), (.l, pt(x0, fl.cy)),
                    ]
                    ForEach(specs, id: \.0) { handle, pos in
                        Color.clear.frame(width: 26, height: 26)
                            .contentShape(Rectangle())
                            .position(pos)
                            .gesture(dragHandle(handle, for: fl, g: g))
                    }
                }
            }
            .coordinateSpace(name: "filmLeakBox")
        }
    }

    private func dragHandle(_ handle: Handle, for fl: FilmLeak, g: MaskGeometry) -> some Gesture {
        DragGesture(minimumDistance: 1, coordinateSpace: .named("filmLeakBox"))
            .onChanged { val in
                if dragStart?.id != fl.id {
                    dragStart = (fl.id, fl.cx, fl.cy, fl.w, fl.h)
                }
                guard let s = dragStart else { return }
                let a = g.toImage(CGPoint(x: val.startLocation.x * scale, y: val.startLocation.y * scale))
                let b = g.toImage(CGPoint(x: val.location.x * scale, y: val.location.y * scale))
                let dx = Float((b.x - a.x) / g.w)
                let dy = Float((b.y - a.y) / g.h)
                onChange(fl.id) { l in
                    var left = s.cx - s.w / 2, right = s.cx + s.w / 2
                    var top = s.cy - s.h / 2, bottom = s.cy + s.h / 2
                    switch handle {
                    case .move:
                        l.cx = (s.cx + dx).clamped(-0.5, 1.5)
                        l.cy = (s.cy + dy).clamped(-0.5, 1.5)
                        return
                    case .tl: left += dx; top += dy
                    case .t: top += dy
                    case .tr: right += dx; top += dy
                    case .r: right += dx
                    case .br: right += dx; bottom += dy
                    case .b: bottom += dy
                    case .bl: left += dx; bottom += dy
                    case .l: left += dx
                    }
                    let nw = max(0.02, right - left)
                    let nh = max(0.02, bottom - top)
                    if handle == .tl || handle == .l || handle == .bl { left = right - nw } else { right = left + nw }
                    if handle == .tl || handle == .t || handle == .tr { top = bottom - nh } else { bottom = top + nh }
                    l.cx = (left + right) / 2
                    l.cy = (top + bottom) / 2
                    l.w = nw
                    l.h = nh
                }
            }
            .onEnded { _ in dragStart = nil }
    }
}
