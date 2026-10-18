import RawBoyEngine
import SwiftUI
import UIKit

/**
 * Curves in the Light tab (Android's CurvesPanel.kt, web's CurvesPanel.tsx): a channel picker and a square
 * point-curve editor. Touch the curve to add a point on it, drag a point to move it, double-tap a point to remove it.
 * Touches elsewhere in the box fall through, so they scroll the panel (`CurveTouchLayer`).
 */
struct CurvesPanel: View {
    let curves: ToneCurves
    let onChange: (ToneCurves) -> Void

    @State private var channel = CurveChannel.rgb
    @State private var selected: Int?
    /** The point being dragged and the working copy of its channel (never a render that hasn't caught up). */
    @State private var drag: (index: Int, points: [CurvePoint])?
    @State private var lastTap: (time: Date, index: Int)?

    /** Finger distance that grabs a point or the curve; touches farther away scroll the panel instead. */
    private static let grabRadius: CGFloat = 24
    private static let doubleTap: TimeInterval = 0.35
    /** Margin around the curve inside the box, so the end points' dots aren't cut off. */
    private static let inset: CGFloat = 8

    private static func color(_ c: CurveChannel) -> Color {
        switch c {
        case .rgb: .primary
        case .red: Color(red: 1, green: 0.35, blue: 0.35)
        case .green: Color(red: 0.35, green: 0.83, blue: 0.42)
        case .blue: Color(red: 0.35, green: 0.61, blue: 1)
        }
    }

    private var points: [CurvePoint] { curves[channel] }

    private func set(_ p: [CurvePoint]) {
        var c = curves
        c[channel] = p
        onChange(c)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Picker("", selection: Binding(get: { channel }, set: { channel = $0; selected = nil })) {
                    ForEach(CurveChannel.allCases, id: \.self) { c in
                        Text(ToneCurves.isIdentity(curves[c]) ? c.label : "\(c.label) •").tag(c)
                    }
                }
                .pickerStyle(.segmented)
                Button("Reset") { set(ToneCurves.identity) }
                    .font(.subheadline)
                    .disabled(ToneCurves.isIdentity(points))
            }
            GeometryReader { geo in
                let size = geo.size
                Canvas { ctx, s in
                    let m = Self.inset, w = s.width - 2 * m, h = s.height - 2 * m
                    ctx.translateBy(x: m, y: m)
                    var grid = Path()
                    for g in [0.25, 0.5, 0.75] {
                        grid.move(to: CGPoint(x: g * w, y: 0))
                        grid.addLine(to: CGPoint(x: g * w, y: h))
                        grid.move(to: CGPoint(x: 0, y: g * h))
                        grid.addLine(to: CGPoint(x: w, y: g * h))
                    }
                    grid.move(to: CGPoint(x: 0, y: h))
                    grid.addLine(to: CGPoint(x: w, y: 0))
                    ctx.stroke(grid, with: .color(.secondary.opacity(0.4)), lineWidth: 1)
                    let color = Self.color(channel)
                    var curve = Path()
                    for (i, v) in ToneCurves.sample(points, count: 129).enumerated() {
                        let p = CGPoint(x: CGFloat(i) / 128 * w, y: (1 - CGFloat(v)) * h)
                        if i == 0 { curve.move(to: p) } else { curve.addLine(to: p) }
                    }
                    ctx.stroke(curve, with: .color(color), lineWidth: 2)
                    for (i, p) in points.enumerated() {
                        let r: CGFloat = 6
                        let dot = Path(ellipseIn: CGRect(x: CGFloat(p.x) * w - r, y: (1 - CGFloat(p.y)) * h - r,
                                                         width: 2 * r, height: 2 * r))
                        ctx.fill(dot, with: .color(i == selected ? Color.accentColor : Color(.systemBackground)))
                        ctx.stroke(dot, with: .color(color), lineWidth: 2)
                    }
                }
                .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 4))
                .overlay(CurveTouchLayer(points: points, inset: Self.inset, grab: Self.grabRadius, onTouch: { p, began in
                    let w = size.width - 2 * Self.inset
                    let h = size.height - 2 * Self.inset
                    let x = Float((p.x - Self.inset) / w), y = Float(1 - (p.y - Self.inset) / h)
                    if began {
                        press(x, y, radius: Float(Self.grabRadius / w))
                    } else if let d = drag, d.index >= 0 {  // < 0: this touch removed a point or had nothing to grab
                        let moved = ToneCurves.move(d.points, d.index, x, y)
                        drag = (d.index, moved)
                        set(moved)
                    }
                }, onEnd: { drag = nil }))
            }
            .aspectRatio(1, contentMode: .fit)
            .frame(maxWidth: 320)
            if let i = selected, i < points.count {
                Note("Input \(Int((points[i].x * 255).rounded())) → output \(Int((points[i].y * 255).rounded()))")
            } else {
                Note("Touch the curve to add a point and drag to shape it; double-tap a point to remove it.")
            }
        }
        .padding(.vertical, 4)
    }

    /** The start of a touch on the curve: grab the nearest point, remove it on a double tap, or add one on the curve. */
    private func press(_ x: Float, _ y: Float, radius: Float) {
        var pts = points
        let now = Date()
        if let i = ToneCurves.nearest(pts, x, y, radius: radius) {
            if let t = lastTap, t.index == i, now.timeIntervalSince(t.time) < Self.doubleTap {
                lastTap = nil
                selected = nil
                drag = (-1, pts)
                set(ToneCurves.remove(pts, i))
                return
            }
            drag = (i, pts)
            selected = i
            lastTap = (now, i)
        } else if let added = ToneCurves.add(pts, x, ToneCurves.evaluate(pts, x)) {  // on the curve, where the finger is
            pts = added.points
            drag = (added.index, pts)
            selected = added.index
            lastTap = (now, added.index)
            set(pts)
        } else {
            drag = (-1, pts)  // full, or too close to a point: nothing to drag until the finger lifts
        }
    }
}

/**
 * The curve box's touches. Only touches near a point or the curve hit this view; the rest fall through to the
 * Canvas underneath, which has no gesture, so the panel's scroll view takes them. A zero-duration press claims a hit
 * at once, before the scroll view's pan can start.
 */
private struct CurveTouchLayer: UIViewRepresentable {
    let points: [CurvePoint]
    let inset: CGFloat
    let grab: CGFloat
    /** Location in the box (points) and whether the touch just began. */
    let onTouch: (CGPoint, Bool) -> Void
    let onEnd: () -> Void

    func makeUIView(context: Context) -> CurveTouchView {
        let v = CurveTouchView()
        v.backgroundColor = .clear
        let press = UILongPressGestureRecognizer(target: v, action: #selector(CurveTouchView.pressed(_:)))
        press.minimumPressDuration = 0
        press.allowableMovement = .greatestFiniteMagnitude
        v.addGestureRecognizer(press)
        return v
    }

    func updateUIView(_ view: CurveTouchView, context: Context) {
        view.points = points
        view.inset = inset
        view.grab = grab
        view.onTouch = onTouch
        view.onEnd = onEnd
    }
}

private final class CurveTouchView: UIView {
    var points: [CurvePoint] = []
    var inset: CGFloat = 0
    var grab: CGFloat = 24
    var onTouch: ((CGPoint, Bool) -> Void)?
    var onEnd: (() -> Void)?

    override func hitTest(_ point: CGPoint, with event: UIEvent?) -> UIView? {
        guard bounds.contains(point), !points.isEmpty else { return nil }
        let w = bounds.width - 2 * inset, h = bounds.height - 2 * inset
        guard w > 0, h > 0 else { return nil }
        let x = Float((point.x - inset) / w), y = Float(1 - (point.y - inset) / h)
        if ToneCurves.nearest(points, x, y, radius: Float(grab / w)) != nil { return self }
        return abs(CGFloat(ToneCurves.evaluate(points, x) - y)) * h <= grab ? self : nil
    }

    @objc func pressed(_ g: UILongPressGestureRecognizer) {
        switch g.state {
        case .began: onTouch?(g.location(in: self), true)
        case .changed: onTouch?(g.location(in: self), false)
        case .ended, .cancelled, .failed: onEnd?()
        default: break
        }
    }
}
