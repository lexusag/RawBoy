import Foundation
import Metal

/**
 * The masks' lens blur (port of gl/BokehTexture.kt / web's BokehTexture.ts). Like bloom it works on a small
 * whole-image copy, so the fit view, the 100% view and export tiles all sample the same texture: no tile seams and no
 * spatial margin. Two GPU passes, re-run only when the masks, their blur or the source change:
 * 1. `bokehPrepFragment` (shaders/bokeh_prep.glsl, built after develop.glsl so the masks are the develop shader's own
 *    layerMask): the highlight-boosted copy at the bokeh size, premultiplied by its fade-in, with each texel's blur
 *    radius in texels.
 * 2. `bokehGatherFragment` (Helpers.metal): an exact round disc gather (every texel inside the radius), sharp texels
 *    never smeared.
 * The develop shader mixes the result in by the radius at each pixel (main_body.glsl, `uBokeh`). Runs synchronously on
 * the caller's thread (the renderers draw on the main thread; export on its own queue). Not thread-safe.
 */
final class BokehTexture {
    /** Largest blur radius in bokeh texels: the texture is sized so a layer's strongest blur lands near it. */
    static let radius: Float = 16
    /** Bokeh texture long side limits. The source copy is `sourceMaxDimension`, so a smaller blur is sharper. */
    static let minDimension: Float = 128
    static let sourceMaxDimension = 1536

    /** Bokeh texture size for some params and how its texels relate to the image. */
    struct Geometry: Equatable {
        let width: Int
        let height: Int
        /** Bokeh texels per full-resolution pixel (`uBokehScale`). */
        let scale: Float
        /** Largest radius in texels. */
        let maxRadius: Float
    }

    /** nil = no lens blur (no source, or no layer blurs). */
    static func geometry(_ p: ShaderParams) -> Geometry? {
        guard let src = p.bokehSource else { return nil }
        let maxPx = p.layers.blur.prefix(p.layers.count).max() ?? 0
        guard maxPx > 0 else { return nil }
        let imageLong = Float(max(src.fullWidth, src.fullHeight))
        let long = min(Float(max(src.width, src.height)), max(minDimension, (radius * imageLong / maxPx).rounded()))
        let scale = long / imageLong
        return Geometry(width: max(1, Int((Float(src.fullWidth) * scale).rounded())),
                        height: max(1, Int((Float(src.fullHeight) * scale).rounded())),
                        scale: scale, maxRadius: maxPx * scale)
    }

    /** Uniforms the develop shader reads the lens blur with; scale 0 = off. */
    static func uniforms(_ p: ShaderParams) -> (scale: Float, texelX: Float, texelY: Float) {
        guard let g = geometry(p) else { return (0, 1, 1) }
        return (g.scale, 1 / Float(g.width), 1 / Float(g.height))
    }

    private let ctx = MetalContext.shared
    private let prepPipeline: MTLRenderPipelineState
    private let gatherPipeline: MTLRenderPipelineState
    private let mipSampler: MTLSamplerState
    private var source: MTLTexture?
    private var uploaded: UnsafePointer<UInt16>?
    private var radii: MTLTexture?
    /** The result, sampled by the develop shader; 1x1 transparent until the first blur. */
    private(set) var output: MTLTexture
    private var width = 0
    private var height = 0
    /** What [output] holds, so unchanged masks aren't blurred again on every slider move. */
    private var key = ""

    init() {
        let ctx = MetalContext.shared
        prepPipeline = try! MetalContext.pipeline(ctx.device, ctx.library, fragment: "bokehPrepFragment", format: .rgba16Float)
        let d = MTLRenderPipelineDescriptor()
        d.vertexFunction = ctx.library.makeFunction(name: "passVertex")
        d.fragmentFunction = ctx.library.makeFunction(name: "bokehGatherFragment")
        d.colorAttachments[0].pixelFormat = .rgba16Float
        gatherPipeline = try! ctx.device.makeRenderPipelineState(descriptor: d)
        let s = MTLSamplerDescriptor()
        s.minFilter = .linear
        s.magFilter = .linear
        s.mipFilter = .linear
        s.sAddressMode = .clampToEdge
        s.tAddressMode = .clampToEdge
        mipSampler = ctx.device.makeSamplerState(descriptor: s)!
        output = ctx.makeTexture(.rgba16Float, 1, 1)!
        var zero = [UInt16](repeating: 0, count: 4)
        output.replace(region: MTLRegionMake2D(0, 0, 1, 1), mipmapLevel: 0, withBytes: &zero, bytesPerRow: 8)
    }

    /** Brings the blur up to date for [p]; [brush] is the brush atlas the masks read (already uploaded). */
    func bind(_ p: ShaderParams, brush: MTLTexture) {
        guard let g = Self.geometry(p), let src = p.bokehSource else { return }
        render(p, src, g, brush)
    }

    private func upload(_ src: PreviewImage) -> Bool {
        let base = src.pixels.withUnsafeBufferPointer { $0.baseAddress }
        if let u = uploaded, u == base, let t = source, t.width == src.width, t.height == src.height { return false }
        let d = MTLTextureDescriptor.texture2DDescriptor(pixelFormat: .rgba16Float, width: src.width, height: src.height,
                                                         mipmapped: true)
        d.usage = .shaderRead
        d.storageMode = .shared
        guard let t = ctx.device.makeTexture(descriptor: d) else { return false }
        // RGB half floats -> RGBA (alpha 1): Metal has no 3-channel formats.
        var rgba = [UInt16](repeating: 0x3C00, count: src.width * src.height * 4)
        src.pixels.withUnsafeBufferPointer { px in
            rgba.withUnsafeMutableBufferPointer { dst in
                for i in 0..<(src.width * src.height) {
                    dst[i * 4] = px[i * 3]
                    dst[i * 4 + 1] = px[i * 3 + 1]
                    dst[i * 4 + 2] = px[i * 3 + 2]
                }
            }
        }
        t.replace(region: MTLRegionMake2D(0, 0, src.width, src.height), mipmapLevel: 0, withBytes: rgba,
                  bytesPerRow: src.width * 8)
        source = t
        uploaded = base
        key = ""
        return true
    }

    private func render(_ p: ShaderParams, _ src: PreviewImage, _ g: Geometry, _ brush: MTLTexture) {
        let fresh = upload(src)
        guard let source else { return }
        let l = p.layers
        let brushes = l.brush.map { r in r.map { "\(ObjectIdentifier($0).hashValue)@\($0.version)" } ?? "-" }
        let newKey = "\(g.width)x\(g.height)|\(l.count)|\(l.geom)|\(l.shape)|\(l.form)|\(l.color)|\(l.blur)|\(brushes)"
        if newKey == key { return }
        if g.width != width || g.height != height || radii == nil {
            let usage: MTLTextureUsage = [.renderTarget, .shaderRead]
            guard let r = ctx.makeTexture(.rgba16Float, g.width, g.height, usage: usage),
                  let o = ctx.makeTexture(.rgba16Float, g.width, g.height, usage: usage) else { return }
            radii = r
            output = o
            width = g.width
            height = g.height
        }
        guard let radii, let commands = ctx.queue.makeCommandBuffer() else { return }
        if fresh, source.mipmapLevelCount > 1, let blit = commands.makeBlitCommandEncoder() {
            blit.generateMipmaps(for: source)
            blit.endEncoding()
        }
        let lod = max(0, log2(Float(max(src.width, src.height)) / Float(max(g.width, g.height))))

        // 1. Masks -> radius, premultiplied source.
        let pass = MTLRenderPassDescriptor()
        pass.colorAttachments[0].texture = radii
        pass.colorAttachments[0].loadAction = .dontCare
        pass.colorAttachments[0].storeAction = .store
        if let e = commands.makeRenderCommandEncoder(descriptor: pass) {
            var v = UniformBlock(size: DevelopLayout.vertexBlockSize, layout: DevelopLayout.vertexUniforms)
            v.vec2("uScale", 1, 1)  // the whole target
            v.float("uFlipY", 0)
            v.vec4("uUvRect", 0, 0, 1, 1)
            let geometry = SampleGeometry(
                textureWidth: src.width, textureHeight: src.height,
                input: PixelRect(x: 0, y: 0, width: src.fullWidth, height: src.fullHeight),
                output: PixelRect(x: 0, y: 0, width: src.fullWidth, height: src.fullHeight),
                imageWidth: src.fullWidth, imageHeight: src.fullHeight)
            var f = DevelopProgram.fragmentUniforms(p, geometry, size: DevelopLayout.bokehBlockSize,
                                                    layout: DevelopLayout.bokehUniforms)
            f.float("uBokehSrcLod", lod)
            f.vec2("uBokehSize", Float(g.width), Float(g.height))
            f.float("uBokehScale", g.scale)
            e.setRenderPipelineState(prepPipeline)
            e.setVertexBuffer(ctx.quad, offset: 0, index: MetalContext.quadBufferIndex)
            v.bytes.withUnsafeBytes { e.setVertexBytes($0.baseAddress!, length: $0.count, index: DevelopLayout.vertexBufferIndex) }
            f.bytes.withUnsafeBytes {
                e.setFragmentBytes($0.baseAddress!, length: $0.count, index: DevelopLayout.bokehBufferIndex)
            }
            let textures: [String: MTLTexture] = ["uBrushMask": brush, "uBokehSrc": source]
            for (name, index) in DevelopLayout.bokehTextures {
                e.setFragmentTexture(textures[name], index: index)
                e.setFragmentSamplerState(name == "uBokehSrc" ? mipSampler : ctx.sampler, index: index)
            }
            e.drawPrimitives(type: .triangleStrip, vertexStart: 0, vertexCount: 4)
            e.endEncoding()
        }

        // 2. Disc gather.
        pass.colorAttachments[0].texture = output
        if let e = commands.makeRenderCommandEncoder(descriptor: pass) {
            var maxRadius = Int32(g.maxRadius.rounded(.up))
            e.setRenderPipelineState(gatherPipeline)
            e.setFragmentTexture(radii, index: 0)
            e.setFragmentBytes(&maxRadius, length: 4, index: 0)
            e.drawPrimitives(type: .triangleStrip, vertexStart: 0, vertexCount: 4)
            e.endEncoding()
        }
        commands.commit()
        commands.waitUntilCompleted()
        key = newKey
    }
}
