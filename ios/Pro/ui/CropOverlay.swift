import RawBoyEngine
import SwiftUI

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
 * [ratio] (width / height in pixels) locks the shape; nil = free.
 */
struct CropOverlay: View {
    let frameWidth: Int
    let frameHeight: Int
    let crop: CropRect
    let ratio: Double?
    let framePx: Int
    let onCropChange: (CropRect) -> Void

    @Environment(\.displayScale) private var scale
    @State private var start: CropRect?
    @State private var handle: CropMath.Handle?

    private static let grab: CGFloat = 24

    var body: some View {
        GeometryReader { geo in
            let r = fitRectPoints(geo.size, frameWidth, frameHeight, framePx: framePx, scale: scale)
            Canvas { ctx, _ in draw(ctx, r) }
                .contentShape(Rectangle())
                .gesture(
                    DragGesture(minimumDistance: 2)
                        .onChanged { v in
                            if start == nil {
                                let s = crop
                                start = s
                                handle = CropMath.handleAt(
                                    s, x: Float((v.startLocation.x - r.minX) / r.width),
                                    y: Float((v.startLocation.y - r.minY) / r.height),
                                    tolX: Float(Self.grab / r.width), tolY: Float(Self.grab / r.height))
                            }
                            guard let s = start, let h = handle else { return }
                            onCropChange(CropMath.drag(s, handle: h, dx: Float(v.translation.width / r.width),
                                                       dy: Float(v.translation.height / r.height), ratio: ratio,
                                                       frameWidth: frameWidth, frameHeight: frameHeight))
                        }
                        .onEnded { _ in
                            start = nil
                            handle = nil
                        })
        }
    }

    private func draw(_ ctx: GraphicsContext, _ r: CGRect) {
        let left = r.minX + CGFloat(crop.left) * r.width
        let top = r.minY + CGFloat(crop.top) * r.height
        let right = r.minX + CGFloat(crop.right) * r.width
        let bottom = r.minY + CGFloat(crop.bottom) * r.height
        let w = right - left
        let h = bottom - top

        // Dim what the crop cuts away.
        let shade = Color.black.opacity(0.55)
        ctx.fill(Path(CGRect(x: r.minX, y: r.minY, width: r.width, height: top - r.minY)), with: .color(shade))
        ctx.fill(Path(CGRect(x: r.minX, y: bottom, width: r.width, height: r.maxY - bottom)), with: .color(shade))
        ctx.fill(Path(CGRect(x: r.minX, y: top, width: left - r.minX, height: h)), with: .color(shade))
        ctx.fill(Path(CGRect(x: right, y: top, width: r.maxX - right, height: h)), with: .color(shade))

        // Fine grid to line up horizons and verticals, thirds slightly stronger.
        let lines = 9
        for i in 1..<lines {
            let color = Color.white.opacity(i % 3 == 0 ? 0.5 : 0.22)
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
