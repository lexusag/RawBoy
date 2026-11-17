import RawBoyEngine
import SwiftUI
#if os(macOS)
import AppKit
#endif

/** ZoomMath.fitRect in view points: the renderer works in pixels, SwiftUI in points. */
func fitRectPoints(_ size: CGSize, _ imgW: Int, _ imgH: Int, framePx: Int, scale: CGFloat) -> CGRect {
    let r = ZoomMath.fitRect(viewW: Int(size.width * scale), viewH: Int(size.height * scale), imgW: imgW, imgH: imgH,
                             frame: framePx)
    return CGRect(x: CGFloat(r[0]) / scale, y: CGFloat(r[1]) / scale, width: CGFloat(r[2]) / scale,
                  height: CGFloat(r[3]) / scale)
}

/**
 * Crop frame over the aspect-fit picture of the whole (uncropped) frame of [frameWidth] x [frameHeight]:
 * dims what's cut, draws a grid for straightening, and edits [crop] by dragging corners, edges or the inside.
 * [ratio] (width / height in pixels) locks the shape; nil = free. With [rotate], a drag outside the crop frame
 * straightens the picture (port of the web's CropOverlay.tsx).
 */
struct CropOverlay: View {
    let frameWidth: Int
    let frameHeight: Int
    let crop: CropRect
    let ratio: Double?
    let framePx: Int
    let onCropChange: (CropRect) -> Void
    /** How dark the outside is, and the grid's cells per side (the Auto WB area: lighter, thirds only). */
    var shadeOpacity = 0.55
    var gridLines = 9
    /**
     * Drag outside the crop frame to rotate: [angle] is the straighten angle in degrees (+ turns clockwise) and
     * [onChange] gets the new one (-45..45, 0.01° steps) while the pointer circles the crop's centre. Without it,
     * presses outside do nothing.
     */
    var rotate: (angle: Float, onChange: (Float) -> Void)?

    @Environment(\.displayScale) private var scale
    @State private var start: CropRect?
    @State private var handle: CropMath.Handle?
    @State private var turning: Turning?

    /** A rotate drag: the crop's centre in view points, the pointer's last angle and the angle so far. */
    private struct Turning {
        let centre: CGPoint
        var last: Double
        var angle: Double
    }

    private static let grab: CGFloat = 24

    var body: some View {
        GeometryReader { geo in
            let r = fitRectPoints(geo.size, frameWidth, frameHeight, framePx: framePx, scale: scale)
            Canvas { ctx, _ in draw(ctx, r) }
                .contentShape(Rectangle())
                #if os(macOS)
                .onContinuousHover { phase in
                    guard start == nil, turning == nil else { return }
                    switch phase {
                    case let .active(p): cursor(for: handleAt(p, r)).set()
                    case .ended: NSCursor.arrow.set()
                    }
                }
                #endif
                .gesture(
                    DragGesture(minimumDistance: 2)
                        .onChanged { v in
                            if start == nil, turning == nil {
                                let s = crop
                                start = s
                                handle = handleAt(v.startLocation, r)
                                if handle == nil, let rotate {
                                    let c = CGPoint(x: r.minX + CGFloat(s.left + s.right) / 2 * r.width,
                                                    y: r.minY + CGFloat(s.top + s.bottom) / 2 * r.height)
                                    turning = Turning(centre: c, last: Self.angle(v.startLocation, c),
                                                      angle: Double(rotate.angle))
                                    #if os(macOS)
                                    NSCursor.closedHand.set()
                                    #endif
                                }
                            }
                            if var t = turning, let rotate {
                                // Clockwise on screen is a positive angle (y points down); the step is wrapped so
                                // crossing ±180° is smooth.
                                let now = Self.angle(v.location, t.centre)
                                var step = now - t.last
                                if step > .pi { step -= 2 * .pi } else if step < -.pi { step += 2 * .pi }
                                t.last = now
                                t.angle = min(45, max(-45, t.angle + step * 180 / .pi))
                                turning = t
                                rotate.onChange(Float((t.angle * 100).rounded() / 100))
                                return
                            }
                            guard let s = start, let h = handle else { return }
                            onCropChange(CropMath.drag(s, handle: h, dx: Float(v.translation.width / r.width),
                                                       dy: Float(v.translation.height / r.height), ratio: ratio,
                                                       frameWidth: frameWidth, frameHeight: frameHeight))
                        }
                        .onEnded { v in
                            start = nil
                            handle = nil
                            turning = nil
                            #if os(macOS)
                            cursor(for: handleAt(v.location, r)).set()
                            #endif
                        })
        }
    }

    private func handleAt(_ p: CGPoint, _ r: CGRect) -> CropMath.Handle? {
        CropMath.handleAt(crop, x: Float((p.x - r.minX) / r.width), y: Float((p.y - r.minY) / r.height),
                          tolX: Float(Self.grab / r.width), tolY: Float(Self.grab / r.height))
    }

    private static func angle(_ p: CGPoint, _ c: CGPoint) -> Double { atan2(Double(p.y - c.y), Double(p.x - c.x)) }

    #if os(macOS)
    /** Resize arrows on the edges and corners, a hand outside the crop when a drag there rotates (the web's grab). */
    private func cursor(for h: CropMath.Handle?) -> NSCursor {
        switch h {
        case .left?: return .frameResize(position: .left, directions: .all)
        case .right?: return .frameResize(position: .right, directions: .all)
        case .top?: return .frameResize(position: .top, directions: .all)
        case .bottom?: return .frameResize(position: .bottom, directions: .all)
        case .topLeft?: return .frameResize(position: .topLeft, directions: .all)
        case .topRight?: return .frameResize(position: .topRight, directions: .all)
        case .bottomLeft?: return .frameResize(position: .bottomLeft, directions: .all)
        case .bottomRight?: return .frameResize(position: .bottomRight, directions: .all)
        case .move?: return .arrow
        case nil: return rotate != nil ? .openHand : .arrow
        }
    }
    #endif

    private func draw(_ ctx: GraphicsContext, _ r: CGRect) {
        let left = r.minX + CGFloat(crop.left) * r.width
        let top = r.minY + CGFloat(crop.top) * r.height
        let right = r.minX + CGFloat(crop.right) * r.width
        let bottom = r.minY + CGFloat(crop.bottom) * r.height
        let w = right - left
        let h = bottom - top

        // Dim what the crop cuts away.
        let shade = Color.black.opacity(shadeOpacity)
        ctx.fill(Path(CGRect(x: r.minX, y: r.minY, width: r.width, height: top - r.minY)), with: .color(shade))
        ctx.fill(Path(CGRect(x: r.minX, y: bottom, width: r.width, height: r.maxY - bottom)), with: .color(shade))
        ctx.fill(Path(CGRect(x: r.minX, y: top, width: left - r.minX, height: h)), with: .color(shade))
        ctx.fill(Path(CGRect(x: right, y: top, width: r.maxX - right, height: h)), with: .color(shade))

        // Fine grid to line up horizons and verticals, thirds slightly stronger.
        let lines = gridLines
        for i in 1..<lines {
            let color = Color.white.opacity(lines == 9 && i % 3 == 0 ? 0.5 : 0.22)
            let x = left + w * CGFloat(i) / CGFloat(lines)
            let y = top + h * CGFloat(i) / CGFloat(lines)
            ctx.stroke(Path { $0.move(to: CGPoint(x: x, y: top)); $0.addLine(to: CGPoint(x: x, y: bottom)) },
                       with: .color(color), lineWidth: 0.5)
            ctx.stroke(Path { $0.move(to: CGPoint(x: left, y: y)); $0.addLine(to: CGPoint(x: right, y: y)) },
                       with: .color(color), lineWidth: 0.5)
        }
        ctx.stroke(Path(CGRect(x: left, y: top, width: w, height: h)), with: .color(.white), lineWidth: 1.5)

        // L-shaped corner handles and short edge handles.
        let len = min(20, w / 3, h / 3)
        var handles = Path()
        for (cx, dx) in [(left, CGFloat(1)), (right, CGFloat(-1))] {
            for (cy, dy) in [(top, CGFloat(1)), (bottom, CGFloat(-1))] {
                handles.move(to: CGPoint(x: cx + dx * len, y: cy))
                handles.addLine(to: CGPoint(x: cx, y: cy))
                handles.addLine(to: CGPoint(x: cx, y: cy + dy * len))
            }
        }
        let midX = (left + right) / 2
        let midY = (top + bottom) / 2
        for (a, b) in [
            (CGPoint(x: midX - len / 2, y: top), CGPoint(x: midX + len / 2, y: top)),
            (CGPoint(x: midX - len / 2, y: bottom), CGPoint(x: midX + len / 2, y: bottom)),
            (CGPoint(x: left, y: midY - len / 2), CGPoint(x: left, y: midY + len / 2)),
            (CGPoint(x: right, y: midY - len / 2), CGPoint(x: right, y: midY + len / 2)),
        ] {
            handles.move(to: a)
            handles.addLine(to: b)
        }
        ctx.stroke(handles, with: .color(.white), lineWidth: 3)
    }
}
