import RawBoyEngine
import SwiftUI
import UIKit

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

enum MaskHandle { case move, start, end, rx, ry, rotate, curve, pin }

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

    init(lens: LensTransform, viewW: Int, viewH: Int, frame: Int, zoomCenter: (Float, Float)?) {
        self.lens = lens
        self.viewW = CGFloat(viewW)
        self.viewH = CGFloat(viewH)
        let rect = zoomCenter.map {
            ZoomMath.zoomedRect(cx: $0.0, cy: $0.1, viewW: viewW, viewH: viewH, imgW: lens.outputWidth, imgH: lens.outputHeight)
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
            return CGPoint(x: m[0] * ox + m[1] * oy + m[2], y: m[3] * ox + m[4] * oy + m[5])
        }
    }

    enum Shape {
        case linear(start: [CGPoint], centre: [CGPoint], end: [CGPoint], pin: CGPoint, curve: CGPoint)
        case radial(outer: [CGPoint], inner: [CGPoint], pin: CGPoint, rx: [CGPoint], ry: [CGPoint], knob: CGPoint,
                    knobBase: CGPoint)
        case brush(pin: CGPoint?)

        var pin: CGPoint? {
            switch self {
            case let .linear(_, _, _, pin, _): pin
            case let .radial(_, _, pin, _, _, _, _): pin
            case let .brush(pin): pin
            }
        }
    }

    func shape(_ l: MaskLayer) -> Shape {
        switch l.shape {
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
            func ellipse(_ k: CGFloat) -> [CGPoint] {
                (0..<steps).map {
                    let t = CGFloat($0) / CGFloat(steps) * 2 * .pi
                    return at(k * rx * cos(t), k * ry * sin(t))
                }
            }
            return .radial(outer: ellipse(1), inner: ellipse(1 - max(CGFloat(feather) / 100, 0.01)), pin: at(0, 0),
                           rx: [at(rx, 0), at(-rx, 0)], ry: [at(0, ry), at(0, -ry)], knob: at(0, -ry * knob),
                           knobBase: at(0, -ry))
        }
    }

    /** The shape after dragging [handle] from image point [from] to [to]. */
    func drag(_ s: MaskShape, _ handle: MaskHandle, _ from: CGPoint, _ to: CGPoint) -> MaskShape {
        let dx = Float((to.x - from.x) / w)
        let dy = Float((to.y - from.y) / h)
        switch s {
        case .brush:
            return s
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
            // Radius along the ellipse's own (rotated) axis.
            let u = Float(abs(cos(a) * vx + sin(a) * vy))
            let v = Float(abs(-sin(a) * vx + cos(a) * vy))
            return handle == .rx
                ? .radial(cx: cx, cy: cy, rx: max(0.01, u / Float(long)), ry: ry, angle: angle, feather: feather)
                : .radial(cx: cx, cy: cy, rx: rx, ry: max(0.01, v / Float(long)), angle: angle, feather: feather)
        }
    }

    /** Brush radius on screen: one radius along x from the image point under [p]. */
    func brushRadiusOnScreen(_ p: CGPoint, _ radius: Float) -> CGFloat {
        let c = toImage(p)
        let e = toScreen(c.x + CGFloat(radius) * long, c.y)
        return max(2, hypot(e.x - p.x, e.y - p.y))
    }

    func hit(_ layers: [MaskLayer], _ selectedId: String?, _ p: CGPoint, _ grab: CGFloat) -> (String, MaskHandle)? {
        func near(_ q: CGPoint, _ d: CGFloat) -> Bool { hypot(p.x - q.x, p.y - q.y) < d }
        func nearLine(_ line: [CGPoint]) -> Bool { (1..<line.count).contains { dist2(p, line[$0 - 1], line[$0]) < grab * grab } }
        if let selected = layers.first(where: { $0.id == selectedId }) {
            switch shape(selected) {
            case let .radial(_, _, pin, rx, ry, k, _):
                if near(k, grab) { return (selected.id, .rotate) }
                if rx.contains(where: { near($0, grab) }) { return (selected.id, .rx) }
                if ry.contains(where: { near($0, grab) }) { return (selected.id, .ry) }
                if near(pin, grab * 1.5) { return (selected.id, .move) }
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
            if let pin = shape(l).pin, near(pin, grab) { return (l.id, .pin) }
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
}

/** Everything the touch layer needs, read fresh for every touch. */
struct MaskInputs {
    var lens: LensTransform
    var layers: [MaskLayer]
    var selectedId: String?
    var frame: Int
    var zoomCenter: (Float, Float)?
    var tool: MaskTool
    var brush: BrushSettings
    var actions: MaskActions
    var onPaintAt: (CGPoint?) -> Void
}

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

    private var scale: CGFloat { window?.screen.scale ?? traitCollection.displayScale }

    private func makeGeometry(_ inp: MaskInputs) -> MaskGeometry {
        MaskGeometry(lens: inp.lens, viewW: Int(bounds.width * scale), viewH: Int(bounds.height * scale), frame: inp.frame,
                     zoomCenter: inp.zoomCenter)
    }

    private func px(_ p: CGPoint) -> CGPoint { CGPoint(x: p.x * scale, y: p.y * scale) }

    /** Move tool: only handles are ours; every other touch goes to the preview underneath. */
    override func hitTest(_ point: CGPoint, with event: UIEvent?) -> UIView? {
        guard let inp = inputs, bounds.contains(point) else { return nil }
        if inp.tool != .move { return inp.layers.contains { $0.id == inp.selectedId } ? self : nil }
        return makeGeometry(inp).hit(inp.layers, inp.selectedId, px(point), Self.grab * scale) != nil ? self : nil
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
            guard let (id, handle) = g.hit(inp.layers, inp.selectedId, p, Self.grab * scale) else { return }
            if handle == .pin {
                inp.actions.onSelect(id)
                return
            }
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
            if active.count >= 2, let prev = lastCentroid {
                inp.actions.onPan(Float((c.x - prev.x) * scale), Float((c.y - prev.y) * scale))
            }
            lastCentroid = c
            return
        }
        guard let t = touches.first else { return }
        let p = px(t.location(in: self))
        if let id = dragLayer, let handle = dragHandle, let start = dragStart {
            inp.actions.onChange(id, g.drag(start, handle, dragFrom, g.toImage(p)))
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
    }
}

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
    let tool: MaskTool
    let brush: BrushSettings
    /** Finger position in points, while painting. */
    let paintAt: CGPoint?
    let sizeRing: Bool

    @Environment(\.displayScale) private var scale

    var body: some View {
        Canvas { ctx, size in
            let g = MaskGeometry(lens: lens, viewW: Int(size.width * scale), viewH: Int(size.height * scale), frame: frame,
                                 zoomCenter: zoomCenter)
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
            let dim: Double = tool == .move ? 1 : 0.4
            for l in layers {
                let s = g.shape(l)
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
                    let c = pt(curve)
                    let sq = CGRect(x: c.x - 6, y: c.y - 6, width: 12, height: 12)
                    ctx.fill(Path(sq), with: .color(.black.opacity(0.35 * dim)))
                    ctx.stroke(Path(sq), with: .color(.white.opacity(dim)), lineWidth: 1.5)
                case let .radial(outer, inner, pin, rx, ry, k, knobBase):
                    line(outer, 2, dim, closed: true)
                    line(inner, 1.2, dim, dashed: true, closed: true)
                    line([knobBase, k], 1.2, dim)
                    dot(k, 7, filled: false, dim)
                    for p in rx + ry { dot(p, 6, filled: true, dim) }
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
