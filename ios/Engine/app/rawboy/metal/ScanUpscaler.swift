import Foundation
import Metal

/**
 * The film scan export's upscale pre-pass (port of gl/ScanUpscaler.kt / web's ScanUpscaler.ts, `shaders/scan.frag`): a
 * larger copy of the image texture that the develop shader reads in place of the image, with `uPixelScale` = the scale.
 * Steps: bicubic start, four rounds of iterative back projection, then an unsharp mask on the luma. Float render
 * targets throughout (RGBA32F for the high-resolution passes). One instance per developer; not thread-safe.
 */
final class ScanUpscaler {
    private static let rounds = 4

    private let ctx = MetalContext.shared
    private let pipeline32: MTLRenderPipelineState
    private let pipeline16: MTLRenderPipelineState
    private let sampler: MTLSamplerState
    private var width = 0, height = 0, srcWidth = 0, srcHeight = 0
    private var hr: [MTLTexture] = []
    private var residual: MTLTexture?
    private var luma: MTLTexture?
    private var blur: MTLTexture?
    private var out: MTLTexture?

    init() {
        func pipeline(_ format: MTLPixelFormat) -> MTLRenderPipelineState {
            let d = MTLRenderPipelineDescriptor()
            d.vertexFunction = MetalContext.shared.library.makeFunction(name: "passVertex")
            d.fragmentFunction = MetalContext.shared.library.makeFunction(name: "scanFragment")
            d.colorAttachments[0].pixelFormat = format
            return try! MetalContext.shared.device.makeRenderPipelineState(descriptor: d)
        }
        pipeline32 = pipeline(.rgba32Float)
        pipeline16 = pipeline(.rgba16Float)
        let s = MTLSamplerDescriptor()
        s.minFilter = .linear
        s.magFilter = .linear
        s.sAddressMode = .clampToEdge
        s.tAddressMode = .clampToEdge
        sampler = ctx.device.makeSamplerState(descriptor: s)!
    }

    private func target(_ format: MTLPixelFormat, _ w: Int, _ h: Int) -> MTLTexture {
        let d = MTLTextureDescriptor.texture2DDescriptor(pixelFormat: format, width: w, height: h, mipmapped: false)
        d.usage = [.renderTarget, .shaderRead]
        d.storageMode = .private
        return ctx.device.makeTexture(descriptor: d)!
    }

    private func ensure(_ srcW: Int, _ srcH: Int, _ w: Int, _ h: Int) {
        if w == width, h == height, srcW == srcWidth, srcH == srcHeight, out != nil { return }
        hr = [target(.rgba32Float, w, h), target(.rgba32Float, w, h)]
        residual = target(.rgba16Float, srcW, srcH)
        luma = target(.rgba32Float, w, h)
        blur = target(.rgba32Float, w, h)
        out = target(.rgba16Float, w, h)
        (width, height, srcWidth, srcHeight) = (w, h, srcW, srcH)
    }

    /**
     * Upscales [src] (linear RGB, [srcW] x [srcH]) to [w] x [h] with the passes encoded on [commands]; returns the
     * texture the result lands in (RGBA16F, linearly filtered). [denoise]: the 0..1 Denoise slider, which raises the unsharp
     * mask's noise threshold as the develop's Sharpen does.
     */
    func encode(_ commands: MTLCommandBuffer, src: MTLTexture, srcW: Int, srcH: Int, w: Int, h: Int, denoise: Float) -> MTLTexture {
        ensure(srcW, srcH, w, h)
        var cur = 0
        func run(_ pass: Int, _ a: MTLTexture, _ b: MTLTexture?, _ to: MTLTexture) {
            let d = MTLRenderPassDescriptor()
            d.colorAttachments[0].texture = to
            d.colorAttachments[0].loadAction = .dontCare
            d.colorAttachments[0].storeAction = .store
            guard let e = commands.makeRenderCommandEncoder(descriptor: d) else { return }
            var u = UniformBlock(size: DevelopLayout.scanBlockSize, layout: DevelopLayout.scanUniforms)
            u.int("uPass", pass)
            u.vec2("uScale", Float(w) / Float(srcW), Float(h) / Float(srcH))
            u.ivec2("uSrcSize", srcW, srcH)
            u.ivec2("uHrSize", w, h)
            u.float("uAmount", ScanScale.sharpen)
            u.float("uThreshold", 0.008 + denoise * 0.04)  // as the develop's sharpenGain
            e.setRenderPipelineState(to.pixelFormat == .rgba32Float ? pipeline32 : pipeline16)
            u.bytes.withUnsafeBytes { e.setFragmentBytes($0.baseAddress!, length: $0.count, index: DevelopLayout.scanBufferIndex) }
            let textures: [String: MTLTexture] = ["uA": a, "uB": b ?? a]
            for (name, index) in DevelopLayout.scanTextures {
                e.setFragmentTexture(textures[name], index: index)
                e.setFragmentSamplerState(sampler, index: index)
            }
            e.drawPrimitives(type: .triangleStrip, vertexStart: 0, vertexCount: 4)
            e.endEncoding()
        }
        run(0, src, nil, hr[0])
        for _ in 0..<Self.rounds {
            run(1, hr[cur], src, residual!)
            run(2, hr[cur], residual!, hr[1 - cur])
            cur = 1 - cur
        }
        run(3, hr[cur], nil, luma!)
        run(4, luma!, nil, blur!)
        run(5, hr[cur], blur!, out!)
        return out!
    }
}

/** Film scan export constants (port of gl/ScanScale.kt / ScanScale.ts). */
public enum ScanScale {
    public static let scale: Float = 1.5

    /** Source pixels the upscale reads around a pixel: 4 back projection rounds (2 px each), the cubic, the unsharp blur. */
    public static let margin = 16

    /**
     * Grain strength at the finer pitch. Per pixel the grain is `scale` times stronger (Selwyn: sigma ~ 1/sqrt(area)),
     * but each grain also covers more output pixels, so averaged back to the photo's size it comes out stronger than a
     * plain export's (flat grey through Portra 400: std 0.0538 vs 0.0472). 0.86 matches them.
     */
    public static let grain: Float = 0.86

    /** Unsharp mask on the upscale (log2 ratio gain), where the develop's own Sharpen then works on top. */
    public static let sharpen: Float = 1.0

    /** Output size of a film scan of a [width] x [height] image. */
    public static func size(_ width: Int, _ height: Int) -> (Int, Int) {
        (Int((Float(width) * scale).rounded()), Int((Float(height) * scale).rounded()))
    }

    /** Whether a film scan applies: a film look is on (the scan is Film mode's). */
    public static func applies(_ params: ShaderParams) -> Bool { params.film != nil && params.filmAmount > 0 }
}
