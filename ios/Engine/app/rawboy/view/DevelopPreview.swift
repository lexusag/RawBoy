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
        let view = PreviewView()
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

/**
 * The MTKView the photo is drawn in. On the Mac it is tagged sRGB (the shader writes display-encoded sRGB), so the system
 * converts to whichever display the window is on: without a colour space a wide-gamut screen would show the same numbers as
 * its own primaries, over-saturated, and a window dragged to another display would keep that display's mistake. The view
 * redraws when its window changes screen, backing scale or colour profile (it only draws on demand). VoiceOver reads it as
 * the photo.
 */
final class PreviewView: MTKView {
    #if os(macOS)
    private var observers: [NSObjectProtocol] = []

    override func viewDidMoveToWindow() {
        super.viewDidMoveToWindow()
        (layer as? CAMetalLayer)?.colorspace = CGColorSpace(name: CGColorSpace.sRGB)
        observers.forEach(NotificationCenter.default.removeObserver)
        observers = []
        guard let window else { return }
        for name in [NSWindow.didChangeScreenNotification, NSWindow.didChangeBackingPropertiesNotification,
                     NSWindow.didChangeScreenProfileNotification] {
            observers.append(NotificationCenter.default.addObserver(forName: name, object: window, queue: .main) { [weak self] _ in
                MainActor.assumeIsolated {
                    self?.autoResizeDrawable = true
                    self?.needsDisplay = true
                }
            })
        }
    }

    override func viewDidChangeBackingProperties() {
        super.viewDidChangeBackingProperties()
        needsDisplay = true
    }

    deinit { observers.forEach(NotificationCenter.default.removeObserver) }

    override func isAccessibilityElement() -> Bool { true }
    override func accessibilityRole() -> NSAccessibility.Role? { .image }
    override func accessibilityLabel() -> String? { "Developed photo" }
    override func accessibilityHelp() -> String? { "The photo with your edits. Zoom and pan with the pointer; the panels' sliders change it." }
    #endif
}
