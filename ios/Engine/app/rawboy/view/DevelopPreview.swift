import MetalKit
import SwiftUI

/**
 * The developed photo on screen (Android's DevelopPreview composable): an MTKView drawn by DevelopRenderer,
 * redrawn whenever one of its inputs changes. Sizes are in pixels, like the renderer's.
 */
#if os(macOS)
public typealias PlatformViewRepresentable = NSViewRepresentable
#else
public typealias PlatformViewRepresentable = UIViewRepresentable
#endif

public struct DevelopPreview: PlatformViewRepresentable {
    public var image: PreviewImage?
    public var params: ShaderParams?
    public var zoomCenter: (Float, Float)?
    public var detail: DetailTile?
    public var frameWidth: Int = 0
    public var frameColor: FrameColor = .grey
    /** Empty space around the frame in the fit view, pixels (the mask tool's room for handles). */
    public var margin: Int = 0
    /** Marks clipped highlights red and crushed shadows blue (Pro's histogram toggles it). */
    public var clipWarning = false
    /** View pixels per full-resolution pixel while zoomed (1 = 100%; a pinch sets others). */
    public var zoomScale: Float = 1

    public init(image: PreviewImage?, params: ShaderParams?, zoomCenter: (Float, Float)? = nil,
                detail: DetailTile? = nil, frameWidth: Int = 0, frameColor: FrameColor = .grey, margin: Int = 0,
                clipWarning: Bool = false, zoomScale: Float = 1) {
        self.image = image
        self.params = params
        self.zoomCenter = zoomCenter
        self.detail = detail
        self.frameWidth = frameWidth
        self.frameColor = frameColor
        self.margin = margin
        self.clipWarning = clipWarning
        self.zoomScale = zoomScale
    }

    public func makeCoordinator() -> DevelopRenderer { DevelopRenderer() }

    private func make(_ coordinator: DevelopRenderer) -> MTKView {
        let view = MTKView()
        coordinator.attach(view)
        view.autoResizeDrawable = true
        #if os(iOS)
        view.contentMode = .redraw
        #endif
        return view
    }

    private func update(_ view: MTKView, _ r: DevelopRenderer) {
        r.image = image
        r.params = params
        r.detail = detail
        r.zoomCenter = zoomCenter
        r.zoomScale = zoomScale
        r.frameWidth = frameWidth
        r.frameGrey = frameColor.level
        r.margin = margin
        r.clipWarning = clipWarning
        #if os(macOS)
        view.needsDisplay = true
        #else
        view.setNeedsDisplay()
        #endif
    }

    #if os(macOS)
    public func makeNSView(context: Context) -> MTKView { make(context.coordinator) }
    public func updateNSView(_ view: MTKView, context: Context) { update(view, context.coordinator) }
    #else
    public func makeUIView(context: Context) -> MTKView { make(context.coordinator) }
    public func updateUIView(_ view: MTKView, context: Context) { update(view, context.coordinator) }
    #endif
}
