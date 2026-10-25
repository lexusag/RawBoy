import Foundation
import Metal
import MetalKit

/** Frame colours around the photo, cycled by tapping outside it. Levels are display-encoded (sRGB). */
public enum FrameColor: CaseIterable, Sendable {
    /** Perceptual middle grey (~18% reflectance). */
    case grey, white, black

    public var level: Float {
        switch self {
        case .grey: 0.46
        case .white: 1
        case .black: 0
        }
    }

    public func next() -> FrameColor {
        let all = FrameColor.allCases
        return all[(all.firstIndex(of: self)! + 1) % all.count]
    }
}

/**
 * Renders the developed image into an MTKView: either the whole downscaled
 * preview (aspect-fit) or, when zoomed, a window into a full-resolution tile (1:1 at 100%, any scale with a pinch).
 * Draws on demand (the view is paused; setNeedsDisplay after each change). Main thread only.
 */
public final class DevelopRenderer: NSObject, MTKViewDelegate {
    private let ctx = MetalContext.shared
    private let textures = DevelopTextures()
    private let solidPipeline: MTLRenderPipelineState
    private var previewTexture: MTLTexture?
    private var uploadedImage: [UInt16]?
    private var uploadedDetail: DetailTile?
    private let denoiser = WaveletDenoise()
    /** Bumped on each preview upload: the denoise pre-pass caches by it. */
    private var previewVersion = 0

    public var image: PreviewImage?
    public var detail: DetailTile?
    public var params: ShaderParams?
    /** Frame around the photo in the fit and zoomed views: width in pixels and its grey level (display-encoded). */
    public var frameWidth = 0
    public var frameGrey: Float = FrameColor.grey.level
    /** Extra empty space around the frame in the fit view, pixels (room for the mask tool's handles). */
    public var margin = 0
    /** Paints clipped highlights red and crushed shadows blue (Pro's histogram, `clipWarning` in develop.glsl). */
    public var clipWarning = false
    /** Centre of the zoomed view in full-resolution pixels, or nil for fit-to-view. */
    public var zoomCenter: (Float, Float)?
    /** View pixels per full-resolution pixel while zoomed: 1 = 100%, others from a pinch. */
    public var zoomScale: Float = 1

    public override init() {
        let d = MTLRenderPipelineDescriptor()
        d.vertexFunction = ctx.library.makeFunction(name: "solidVertex")
        d.fragmentFunction = ctx.library.makeFunction(name: "solidFragment")
        d.colorAttachments[0].pixelFormat = MetalContext.previewPixelFormat
        solidPipeline = try! ctx.device.makeRenderPipelineState(descriptor: d)
        super.init()
    }

    /** Sets up [view] to be drawn by this renderer. */
    public func attach(_ view: MTKView) {
        view.device = ctx.device
        view.colorPixelFormat = MetalContext.previewPixelFormat
        view.framebufferOnly = true
        view.isPaused = true
        view.enableSetNeedsDisplay = true
        view.clearColor = MTLClearColor(red: 0.07, green: 0.07, blue: 0.07, alpha: 1)
        view.delegate = self
    }

    public func mtkView(_ view: MTKView, drawableSizeWillChange size: CGSize) {}

    public func draw(in view: MTKView) {
        if let img = image, uploadedImage.map({ !Self.same($0, img.pixels) }) ?? true {
            previewTexture = img.pixels.withUnsafeBufferPointer {
                DevelopTextures.halfRgbTexture(img.width, img.height, $0.baseAddress!, reuse: previewTexture)
            }
            uploadedImage = img.pixels
            previewVersion += 1
        }
        uploadedDetail = detail

        guard let pass = view.currentRenderPassDescriptor, let drawable = view.currentDrawable,
              let commands = ctx.queue.makeCommandBuffer() else { return }
        let viewWidth = max(1, Int(view.drawableSize.width))
        let viewHeight = max(1, Int(view.drawableSize.height))
        // The denoise pre-pass renders into its own targets, so it is encoded before the view's pass.
        var source: MTLTexture?
        var denoised = false
        var tile: DetailTile?
        if let p = params, let img = image, let preview = previewTexture {
            if let c = zoomCenter { tile = usableTile(p, img, c, viewWidth, viewHeight) }
            let zoomed = tile != nil
            let texture = zoomed ? tile!.texture : preview
            source = texture
            if WaveletDenoise.active(p.denoise, p.colorDenoise) {
                let key: AnyHashable = zoomed ? "tile" : AnyHashable(previewVersion)
                let scale = zoomed ? 1 : Float(preview.width) / Float(image!.fullWidth)
                source = denoiser.encode(commands, src: texture, srcKey: key, pixelScale: scale,
                                         denoise: p.denoise, colorDenoise: p.colorDenoise)
                denoised = true
            }
        }
        guard let encoder = commands.makeRenderCommandEncoder(descriptor: pass) else { return }
        if let p = params, let img = image, let input = source {
            textures.bind(p)
            let configure = uniforms(denoised: denoised)
            if let center = zoomCenter {
                drawZoomed(encoder, p, img, tile, input, center, viewWidth, viewHeight, configure)
            } else {
                drawFit(encoder, p, img, input, viewWidth, viewHeight, configure)
            }
        }
        encoder.endEncoding()
        commands.present(drawable)
        commands.commit()
    }

    private func drawFit(_ encoder: MTLRenderCommandEncoder, _ p: ShaderParams, _ img: PreviewImage,
                         _ preview: MTLTexture, _ viewWidth: Int, _ viewHeight: Int,
                         _ configure: @escaping (inout UniformBlock) -> Void) {
        let outW = p.lens.outputWidth
        let outH = p.lens.outputHeight
        let frame = frameWidth
        let r = ZoomMath.fitRect(viewW: viewWidth, viewH: viewHeight, imgW: outW, imgH: outH, frame: frame + margin)

        clearFrame(encoder, r[0], r[1], r[2], r[3], viewWidth, viewHeight)

        let sx = r[2] / Float(viewWidth)
        let sy = r[3] / Float(viewHeight)
        let input = PixelRect(x: 0, y: 0, width: img.fullWidth, height: img.fullHeight)
        let output = PixelRect(x: 0, y: 0, width: outW, height: outH)
        let geometry = SampleGeometry(textureWidth: img.width, textureHeight: img.height, input: input, output: output,
                                      imageWidth: img.fullWidth, imageHeight: img.fullHeight)
        // flipY as on Android: in both GL and Metal, clip-space +y is the top of the screen.
        DevelopProgram.draw(encoder, pipeline: ctx.previewPipeline, params: p, geometry: geometry, image: preview,
                            inputs: textures, scaleX: sx, scaleY: sy, flipY: true, configure: configure)
    }

    /**
     * The loaded full-resolution tile when the zoomed view needs it and it covers the view; nil draws from the preview:
     * between fit and 100% (pinch) the preview may be enough, and it stands in while a tile for a new region or scale
     * loads.
     */
    private func usableTile(_ p: ShaderParams, _ img: PreviewImage, _ center: (Float, Float), _ viewWidth: Int,
                            _ viewHeight: Int) -> DetailTile? {
        guard let tile = uploadedDetail,
              !ZoomMath.previewSuffices(zoomScale, previewWidth: img.width, fullWidth: img.fullWidth) else { return nil }
        if zoomScale == 1 { return tile }
        let view = ZoomMath.viewRect(cx: center.0, cy: center.1, viewW: viewWidth, viewH: viewHeight,
                                     imgW: p.lens.outputWidth, imgH: p.lens.outputHeight, scale: zoomScale, frame: frameWidth)
        return tile.rect.contains(p.lens.sourceBounds(view, margin: 0)) ? tile : nil
    }

    /**
     * [tile] nil: [texture] is the (denoised) preview. Output = what's on screen; input = the loaded full-resolution
     * tile. If the lens moves pixels outside the tile while a new one loads, edges smear briefly.
     */
    private func drawZoomed(_ encoder: MTLRenderCommandEncoder, _ p: ShaderParams, _ img: PreviewImage,
                            _ tile: DetailTile?, _ texture: MTLTexture, _ center: (Float, Float), _ viewWidth: Int,
                            _ viewHeight: Int, _ configure: @escaping (inout UniformBlock) -> Void) {
        let outW = p.lens.outputWidth
        let outH = p.lens.outputHeight
        let scale = zoomScale
        let viewF = ZoomMath.viewRectF(cx: center.0, cy: center.1, viewW: viewWidth, viewH: viewHeight, imgW: outW,
                                       imgH: outH, scale: scale, frame: frameWidth)
        let view = ZoomMath.viewRect(cx: center.0, cy: center.1, viewW: viewWidth, viewH: viewHeight, imgW: outW,
                                     imgH: outH, scale: scale, frame: frameWidth)
        let w = viewF[2] * scale
        let h = viewF[3] * scale
        // The frame stays while zoomed: the photo shows inside it, like in the fit view.
        clearFrame(encoder, (Float(viewWidth) - w) / 2, (Float(viewHeight) - h) / 2, w, h, viewWidth, viewHeight)
        var geometry: SampleGeometry
        if let t = tile?.rect {
            geometry = SampleGeometry(textureWidth: t.width, textureHeight: t.height, input: t, output: view,
                                      imageWidth: img.fullWidth, imageHeight: img.fullHeight)
        } else {
            let input = PixelRect(x: 0, y: 0, width: img.fullWidth, height: img.fullHeight)
            geometry = SampleGeometry(textureWidth: img.width, textureHeight: img.height, input: input, output: view,
                                      imageWidth: img.fullWidth, imageHeight: img.fullHeight)
        }
        geometry.outputF = viewF
        DevelopProgram.draw(encoder, pipeline: ctx.previewPipeline, params: p, geometry: geometry, image: texture,
                            inputs: textures, scaleX: w / Float(viewWidth), scaleY: h / Float(viewHeight), flipY: true,
                            configure: configure)
    }

    /**
     * Frame: a band of neutral grey / white / black around the photo at ([left], [top], [width], [height]) (view
     * pixels, top-left origin), for judging exposure.
     */
    private func clearFrame(_ encoder: MTLRenderCommandEncoder, _ left: Float, _ top: Float, _ width: Float,
                            _ height: Float, _ viewWidth: Int, _ viewHeight: Int) {
        let frame = frameWidth
        guard frame > 0 else { return }
        let x0 = max(0, Int(left) - frame)
        let y0 = max(0, Int(top) - frame)
        let x1 = min(viewWidth, Int(left + width) + frame)
        let y1 = min(viewHeight, Int(top + height) + frame)
        guard x1 > x0 && y1 > y0 else { return }
        var color = SIMD4<Float>(frameGrey, frameGrey, frameGrey, 1)
        encoder.setScissorRect(MTLScissorRect(x: x0, y: y0, width: x1 - x0, height: y1 - y0))
        encoder.setRenderPipelineState(solidPipeline)
        encoder.setFragmentBytes(&color, length: MemoryLayout<SIMD4<Float>>.stride, index: 0)
        encoder.drawPrimitives(type: .triangleStrip, vertexStart: 0, vertexCount: 4)
        encoder.setScissorRect(MTLScissorRect(x: 0, y: 0, width: viewWidth, height: viewHeight))
    }

    /** Preview-only uniforms: the clip warning, and whether the image went through the denoise pre-pass. */
    private func uniforms(denoised: Bool) -> (inout UniformBlock) -> Void {
        let on: Float = clipWarning ? 1 : 0
        let pre: Float = denoised ? 1 : 0
        return {
            $0.float("uClipWarn", on)
            $0.float("uDenoisePre", pre)
        }
    }

    private static func same(_ a: [UInt16], _ b: [UInt16]) -> Bool {
        a.withUnsafeBufferPointer { $0.baseAddress } == b.withUnsafeBufferPointer { $0.baseAddress }
    }
}
