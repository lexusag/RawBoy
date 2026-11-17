import RawBoyEngine
import SwiftUI

/**
 * Before/after slider (RawBoy Desktop, View › Before/After Slider, Y): the as-shot render (the same one press-and-hold
 * Compare shows, with the photo's own rotation, flips and crop) on the left of a draggable divider, the edit on the right.
 *
 * The as-shot picture is developed once, off screen, over the whole preview by a `ThumbnailRenderer` and drawn clipped to
 * the left of the divider over the live preview, so dragging only redraws and sliders never re-run it (the geometry is
 * the only edit it follows). It works on the whole-photo view; zoomed in, the divider steps aside until it is back.
 */
struct CompareSplit: View {
    @ObservedObject var session: PhotoSession
    /** The edit's geometry with everything else at the photo's defaults (EditorScreen.originalParams). */
    let original: DevelopParams
    let defaults: DevelopParams
    /** Width of the frame round the photo in the fit view, points. */
    let frame: CGFloat
    /** The divider's place as a fraction of the picture's width; EditorScreen keeps it. */
    @Binding var fraction: CGFloat

    @Environment(\.displayScale) private var displayScale
    @State private var dragStart: CGFloat?
    @State private var image: CGImage?
    @State private var imageKey: CacheKey?

    private static let renderer = ThumbnailRenderer()
    /** The divider's grab zone, points. */
    private static let grab: CGFloat = 28

    private struct CacheKey: Equatable {
        let params: DevelopParams
        let defaults: DevelopParams
        let previewWidth: Int
        let previewHeight: Int
        let longEdge: Int
    }

    var body: some View {
        GeometryReader { geo in
            if let picture = picture(geo.size) {
                let visible = picture.intersection(CGRect(origin: .zero, size: geo.size))
                // In steps of 256 px, so resizing the window doesn't develop the picture again at every size.
                let longEdge = max(256, Int((max(picture.width, picture.height) * displayScale / 256).rounded(.up)) * 256)
                let key = cacheKey(longEdge)
                ZStack(alignment: .topLeading) {
                    Canvas { ctx, _ in
                        guard let image else { return }
                        let part = SplitMath.originalRect(picture, fraction: fraction)
                        ctx.drawLayer { c in
                            c.clip(to: Path(part))
                            c.draw(Image(decorative: image, scale: 1), in: picture)
                        }
                    }
                    .allowsHitTesting(false)
                    divider(picture, visible, geo.size)
                    label("Original", at: .topLeading, picture: picture)
                    label("Edited", at: .topTrailing, picture: picture)
                }
                .task(id: key) { await develop(key) }
            }
        }
        // Drags are measured in the preview's space, which stays put: the divider moves with the drag, so measured in its
        // own space every move shifted the origin it came from (the Look selector jumped that way).
        .coordinateSpace(name: Self.space)
    }

    private static let space = "compareSplit"

    /** The picture inside the preview: the fit rectangle, as the Look selector computes it. */
    private func picture(_ box: CGSize) -> CGRect? {
        guard session.preview != nil, box.width > 0, box.height > 0, session.zoomCenter == nil else { return nil }
        let lens = session.lensFor(original)
        let s = displayScale
        let vw = Int((box.width * s).rounded()), vh = Int((box.height * s).rounded())
        let fw = Int((frame * s).rounded())
        let r = ZoomMath.fitRect(viewW: vw, viewH: vh, imgW: lens.outputWidth, imgH: lens.outputHeight, frame: fw)
        return CGRect(x: CGFloat(r[0]) / s, y: CGFloat(r[1]) / s, width: CGFloat(r[2]) / s, height: CGFloat(r[3]) / s)
    }

    private func divider(_ picture: CGRect, _ visible: CGRect, _ box: CGSize) -> some View {
        let x = picture.minX + picture.width * SplitMath.clamp(fraction)
        return ZStack {
            Rectangle().fill(Color.white.opacity(0.9)).frame(width: 1)
                .shadow(color: .black.opacity(0.6), radius: 1)
            Image(systemName: "arrow.left.and.right")
                .font(.system(size: 11, weight: .bold))
                .foregroundStyle(.black)
                .frame(width: 26, height: 26)
                .background(Circle().fill(Color.accentColor))
                .shadow(color: .black.opacity(0.5), radius: 2)
        }
        .frame(width: Self.grab, height: visible.height)
        .contentShape(Rectangle())
        #if os(macOS)
        .onHover { inside in
            if inside { NSCursor.resizeLeftRight.push() } else { NSCursor.pop() }
        }
        #endif
        .gesture(
            DragGesture(minimumDistance: 0, coordinateSpace: .named(Self.space))
                .onChanged { g in
                    if dragStart == nil { dragStart = fraction }
                    guard let start = dragStart else { return }
                    fraction = SplitMath.dragged(start: start, translation: g.translation.width, width: picture.width)
                }
                .onEnded { _ in dragStart = nil })
        .position(x: x, y: visible.midY)
        .accessibilityElement()
        .accessibilityLabel("Before and after divider")
        .accessibilityValue("\(Int((fraction * 100).rounded())) percent")
        .accessibilityAdjustableAction { direction in
            let step: CGFloat = 0.05
            switch direction {
            case .increment: fraction = SplitMath.clamp(fraction + step)
            case .decrement: fraction = SplitMath.clamp(fraction - step)
            @unknown default: break
            }
        }
    }

    private func label(_ text: String, at alignment: Alignment, picture: CGRect) -> some View {
        OverlayLabel(text)
            .frame(width: picture.width, height: picture.height, alignment: alignment)
            .offset(x: picture.minX, y: picture.minY)
            .allowsHitTesting(false)
    }

    private func cacheKey(_ longEdge: Int) -> CacheKey? {
        guard let preview = session.preview else { return nil }
        return CacheKey(params: original, defaults: defaults, previewWidth: preview.width, previewHeight: preview.height,
                        longEdge: longEdge)
    }

    /** Develops the as-shot picture for [key] (once per photo, geometry and size step; the old one stays up meanwhile). */
    private func develop(_ key: CacheKey?) async {
        guard let key, let preview = session.preview, imageKey != key else { return }
        let sp = session.shaderParams(key.params, defaults: key.defaults)
        guard let rendered = try? await Self.renderer.render(sp, preview: preview, maxDimension: key.longEdge),
              !Task.isCancelled
        else { return }
        image = rendered
        imageKey = key
    }
}
