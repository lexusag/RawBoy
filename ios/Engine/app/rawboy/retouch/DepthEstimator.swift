import Foundation

#if canImport(OnnxRuntimeBindings)
import OnnxRuntimeBindings
#endif

/**
 * Portrait blur's depth map for photos without one (port of web's DepthEstimator.ts and RawBoy Camera's AiDepth.kt):
 * Depth Anything V2 Small (Apache 2.0; the 4-bit-weight ONNX export every app bundles from engine/.../assets/models) run by
 * ONNX Runtime on the CPU, from the session's 512 px copy. Only RawBoy Desktop links the runtime (`RawBoyEngineMac`);
 * elsewhere `isAvailable` is false and Portrait blur keeps asking for a photo with a depth map. No person mask yet (the
 * web caps glasses at the person's depth and focuses on them): the focus is the middle of the frame.
 */
public enum DepthEstimator {
    public static var isAvailable: Bool {
        #if canImport(OnnxRuntimeBindings)
        return true
        #else
        return false
        #endif
    }

    static let inputLong = 518
    static let patch = 14
    static let mean: [Float] = [0.485, 0.456, 0.406]
    static let std: [Float] = [0.229, 0.224, 0.225]

    /** Inverse depth (nearer = larger) -> 0..1 depth (0 near, 1 far) over its 2nd..98th percentiles. */
    static func toDepth(_ inverse: [Float]) -> [Float] {
        let sorted = inverse.sorted()
        func at(_ q: Float) -> Float { sorted[min(sorted.count - 1, max(0, Int(Float(sorted.count) * q)))] }
        let lo = at(0.02)
        let range = max(at(0.98) - lo, 1e-6)
        return inverse.map { 1 - min(1, max(0, ($0 - lo) / range)) }
    }

    /** The model's input size for a [width] x [height] copy: long side about 518, multiples of 14. */
    static func inputSize(_ width: Int, _ height: Int) -> (Int, Int) {
        let scale = Float(inputLong) / Float(max(width, height))
        func snap(_ v: Int) -> Int { max(patch, Int((Float(v) * scale / Float(patch)).rounded()) * patch) }
        return (snap(width), snap(height))
    }

    /** Linear Rec.2020 half floats -> channel-first, normalised sRGB floats at [w] x [h] (bilinear, auto exposure). */
    static func modelInput(_ image: PreviewImage, _ w: Int, _ h: Int) -> [Float] {
        let n = image.width * image.height
        var rgb = [Float](repeating: 0, count: n * 3)
        var logSum = 0.0
        for i in 0..<n {
            let r = Float(Float16(bitPattern: image.pixels[i * 3]))
            let g = Float(Float16(bitPattern: image.pixels[i * 3 + 1]))
            let b = Float(Float16(bitPattern: image.pixels[i * 3 + 2]))
            rgb[i * 3] = 1.6605 * r - 0.5876 * g - 0.0728 * b
            rgb[i * 3 + 1] = -0.1246 * r + 1.1329 * g - 0.0083 * b
            rgb[i * 3 + 2] = -0.0182 * r - 0.1006 * g + 1.1187 * b
            logSum += log(max(0.2627 * Double(r) + 0.6780 * Double(g) + 0.0593 * Double(b), 1e-5))
        }
        // Auto exposure to middle grey, then a soft shoulder, as the skin model's input.
        let k = Float(0.18 / exp(logSum / Double(max(n, 1))))
        for i in 0..<(n * 3) {
            let v = max(rgb[i], 0) * k
            let t = min(max((v / (1 + v)) * 1.6, 0), 1)
            rgb[i] = t <= 0.0031308 ? t * 12.92 : 1.055 * powf(t, 1 / 2.4) - 0.055
        }
        var out = [Float](repeating: 0, count: 3 * w * h)
        for y in 0..<h {
            let sy = min(max((Float(y) + 0.5) * Float(image.height) / Float(h) - 0.5, 0), Float(image.height - 1))
            let y0 = Int(sy), y1 = min(y0 + 1, image.height - 1), fy = sy - Float(y0)
            for x in 0..<w {
                let sx = min(max((Float(x) + 0.5) * Float(image.width) / Float(w) - 0.5, 0), Float(image.width - 1))
                let x0 = Int(sx), x1 = min(x0 + 1, image.width - 1), fx = sx - Float(x0)
                for c in 0..<3 {
                    let a = rgb[(y0 * image.width + x0) * 3 + c] * (1 - fx) + rgb[(y0 * image.width + x1) * 3 + c] * fx
                    let b = rgb[(y1 * image.width + x0) * 3 + c] * (1 - fx) + rgb[(y1 * image.width + x1) * 3 + c] * fx
                    out[c * w * h + y * w + x] = ((a * (1 - fy) + b * fy) - mean[c]) / std[c]
                }
            }
        }
        return out
    }

    #if canImport(OnnxRuntimeBindings)
    private static let lock = NSLock()
    nonisolated(unsafe) private static var loaded: (ORTEnv, ORTSession)?

    /** Loads the model the first time (about 19 MB), then keeps it. */
    private static func session() throws -> (ORTEnv, ORTSession) {
        lock.lock()
        defer { lock.unlock() }
        if let loaded { return loaded }
        guard let path = LutRepository.resourceBundle.path(forResource: "depth_anything_v2_small_q4f16", ofType: "onnx") else {
            throw RawImageError(message: "the depth model is missing from the app")
        }
        let env = try ORTEnv(loggingLevel: .warning)
        let options = try ORTSessionOptions()
        try options.setIntraOpNumThreads(Int32(max(1, min(4, ProcessInfo.processInfo.activeProcessorCount - 1))))
        let session = try ORTSession(env: env, modelPath: path, sessionOptions: options)
        loaded = (env, session)
        return (env, session)
    }

    /** Estimates the depth map of [base] (the session's small linear copy). Slow: call it off the main thread. */
    public static func estimate(_ base: PreviewImage) throws -> DepthMap {
        let (_, session) = try session()
        let (w, h) = inputSize(base.width, base.height)
        let input = modelInput(base, w, h)
        let data = input.withUnsafeBufferPointer { NSMutableData(bytes: $0.baseAddress, length: $0.count * 4) }
        let tensor = try ORTValue(tensorData: data, elementType: .float, shape: [1, 3, NSNumber(value: h), NSNumber(value: w)])
        let inName = try session.inputNames()[0]
        let outName = try session.outputNames()[0]
        let outputs = try session.run(withInputs: [inName: tensor], outputNames: [outName], runOptions: nil)
        guard let out = outputs[outName] else { throw RawImageError(message: "the depth model gave no output") }
        let shape = try out.tensorTypeAndShapeInfo().shape.map { $0.intValue }
        guard shape.count >= 2 else { throw RawImageError(message: "the depth model's output has an odd shape") }
        let ow = shape[shape.count - 1], oh = shape[shape.count - 2]
        let raw = try out.tensorData() as Data
        guard raw.count >= ow * oh * 4 else { throw RawImageError(message: "the depth model's output is too small") }
        let inverse = raw.withUnsafeBytes { Array($0.bindMemory(to: Float.self).prefix(ow * oh)) }
        let depth = toDepth(inverse)
        return DepthMap(
            width: ow, height: oh, hardware: false, subjectDetected: false, focusDepth: depth[(oh / 2) * ow + ow / 2],
            data: depth.map { UInt8(min(max($0 * 255 + 0.5, 0), 255)) })
    }
    #else
    public static func estimate(_ base: PreviewImage) throws -> DepthMap {
        throw RawImageError(message: "depth estimate is not available in this app")
    }
    #endif
}
