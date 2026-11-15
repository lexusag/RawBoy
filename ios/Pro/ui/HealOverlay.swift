import RawBoyEngine
import SwiftUI

/** A new point on a stroke once the pointer moved this fraction of the brush radius. */
private let healStep: CGFloat = 0.15

/** What the overlay asks of the editor. */
struct HealOverlayActions {
    /** A click or the start of a drag: a new spot at (x, y) image fractions; the id it got, nil when full. */
    let onBegin: (_ x: Float, _ y: Float) -> String?
    /** The stroke grows by flat x, y image fractions. */
    let onExtend: (String, [Float]) -> Void
    let onEnd: () -> Void
    /** The selected stroke's source circle was dragged to (x, y). */
    let onSource: (String, Float, Float) -> Void
    /** A pan (view pixels) while Space is held. */
    let onPan: (Float, Float) -> Void
}

/**
 * The healing brush on the photo (port of web's HealOverlay): outlines every stroke (the selected one brighter, its
 * chosen source as a dashed circle), a ring the size of the brush under the pointer, and paints: a click heals a spot,
 * a drag a stroke. Drag the dashed source circle of the selected stroke to move where its texture comes from.
 */
struct HealOverlay: View {
    let lens: LensTransform
    let spots: [HealSpot]
    let selectedId: String?
    let brush: HealBrush
    let frame: Int
    let zoomCenter: (Float, Float)?
    var zoomScale: Float = 1
    var zoomFrame = 0
    let actions: HealOverlayActions
    /** Space is held: a drag pans the zoomed photo (RawBoy Desktop). */
    var panning: () -> Bool = { false }

    @Environment(\.displayScale) private var scale
    @State private var hover: CGPoint?
    private enum Drag { case paint(String), source(String), pan }
    @State private var drag: Drag?
    @State private var last = CGPoint.zero
    @State private var panLast = CGSize.zero

    private static let grab: CGFloat = 20

    private func geometry(_ size: CGSize) -> MaskGeometry {
        MaskGeometry(lens: lens, viewW: Int(size.width * scale), viewH: Int(size.height * scale), frame: frame,
                     zoomCenter: zoomCenter, zoomScale: zoomScale, zoomFrame: zoomFrame)
    }

    /** A disk's radius on screen (view pixels): the image radius carried through the lens and the view's placement. */
    private func screenRadius(_ g: MaskGeometry, _ x: CGFloat, _ y: CGFloat, _ radius: Float) -> CGFloat {
        let a = g.toScreen(x, y)
        let b = g.toScreen(x + CGFloat(radius) * g.long, y)
        return max(hypot(a.x - b.x, a.y - b.y), 2)
    }

    private func fraction(_ g: MaskGeometry, _ img: CGPoint) -> (Float, Float) {
        (Float(img.x / g.w).clamped(0, 1), Float(img.y / g.h).clamped(0, 1))
    }

    var body: some View {
        GeometryReader { geo in
            Canvas { ctx, size in draw(ctx, geometry(size)) }
                .contentShape(Rectangle())
                .gesture(DragGesture(minimumDistance: 0).onChanged { v in changed(v, geo.size) }.onEnded { _ in ended() })
                .onContinuousHover { phase in
                    switch phase {
                    case let .active(p): hover = p
                    case .ended: hover = nil
                    }
                }
        }
    }

    private func draw(_ ctx: GraphicsContext, _ g: MaskGeometry) {
        func ring(_ c: CGPoint, _ r: CGFloat, width: CGFloat, alpha: Double, dashed: Bool = false) {
            let rect = CGRect(x: c.x / scale - r / scale, y: c.y / scale - r / scale, width: 2 * r / scale, height: 2 * r / scale)
            let dash: [CGFloat] = dashed ? [5, 4] : []
            ctx.stroke(Path(ellipseIn: rect), with: .color(.black.opacity(0.5 * alpha)), style: StrokeStyle(lineWidth: width + 1.5, dash: dash))
            ctx.stroke(Path(ellipseIn: rect), with: .color(.white.opacity(alpha)), style: StrokeStyle(lineWidth: width, dash: dash))
        }
        for s in spots {
            let selected = s.id == selectedId
            let alpha = selected ? 1.0 : 0.55
            var pts = [(CGFloat(s.x) * g.w, CGFloat(s.y) * g.h)]
            var i = 0
            while i + 1 < s.path.count {
                pts.append((CGFloat(s.path[i]) * g.w, CGFloat(s.path[i + 1]) * g.h))
                i += 2
            }
            let r = screenRadius(g, pts[0].0, pts[0].1, s.radius)
            if pts.count > 1 {
                var path = Path()
                path.addLines(pts.map { let p = g.toScreen($0.0, $0.1); return CGPoint(x: p.x / scale, y: p.y / scale) })
                ctx.stroke(path, with: .color(.white.opacity(0.25 * alpha)),
                           style: StrokeStyle(lineWidth: max(1, 2 * r / scale), lineCap: .round, lineJoin: .round))
            }
            for (k, p) in pts.enumerated() where k == 0 || k == pts.count - 1 {
                ring(g.toScreen(p.0, p.1), r, width: selected ? 1.6 : 1, alpha: alpha)
            }
            if selected, let src = s.source {
                let from = g.toScreen(CGFloat(s.x) * g.w, CGFloat(s.y) * g.h)
                let to = g.toScreen(CGFloat(src[0]) * g.w, CGFloat(src[1]) * g.h)
                var link = Path()
                link.move(to: CGPoint(x: from.x / scale, y: from.y / scale))
                link.addLine(to: CGPoint(x: to.x / scale, y: to.y / scale))
                ctx.stroke(link, with: .color(.white.opacity(0.6)), style: StrokeStyle(lineWidth: 1, dash: [3, 3]))
                ring(to, r, width: 1.6, alpha: 1, dashed: true)
            }
        }
        if let h = hover {
            let p = CGPoint(x: h.x * scale, y: h.y * scale)
            let img = g.toImage(p)
            ring(p, screenRadius(g, img.x, img.y, brush.radius), width: 1.2, alpha: 0.9)
        }
    }

    private func changed(_ v: DragGesture.Value, _ size: CGSize) {
        let g = geometry(size)
        let at = CGPoint(x: v.location.x * scale, y: v.location.y * scale)
        hover = v.location
        if drag == nil {
            panLast = .zero
            if panning() {
                drag = .pan
            } else if let s = spots.first(where: { $0.id == selectedId }), let src = s.source,
                      hypot(at.x - g.toScreen(CGFloat(src[0]) * g.w, CGFloat(src[1]) * g.h).x,
                            at.y - g.toScreen(CGFloat(src[0]) * g.w, CGFloat(src[1]) * g.h).y)
                      < max(Self.grab * scale, screenRadius(g, CGFloat(s.x) * g.w, CGFloat(s.y) * g.h, s.radius)) {
                drag = .source(s.id)
            } else {
                let img = g.toImage(at)
                let (x, y) = fraction(g, img)
                guard let id = actions.onBegin(x, y) else { return }
                drag = .paint(id)
                last = img
            }
        }
        switch drag {
        case .pan:
            let d = CGSize(width: v.translation.width - panLast.width, height: v.translation.height - panLast.height)
            panLast = v.translation
            actions.onPan(Float(d.width * scale), Float(d.height * scale))
        case let .source(id):
            let (x, y) = fraction(g, g.toImage(at))
            actions.onSource(id, x, y)
        case let .paint(id):
            let img = g.toImage(at)
            if hypot(img.x - last.x, img.y - last.y) < max(0.5, CGFloat(brush.radius) * g.long * healStep) { return }
            last = img
            let (x, y) = fraction(g, img)
            actions.onExtend(id, [x, y])
        case nil:
            break
        }
    }

    private func ended() {
        if case .paint = drag { actions.onEnd() }
        drag = nil
    }
}
