import Foundation

#if canImport(CoreML)
import CoreML
import CoreVideo
#endif

/**
 * Portrait blur's depth map for photos without one (port of web's DepthEstimator.ts and RawBoy Camera's AiDepth.kt):
 * Depth Anything V2 Small (Apache 2.0), Apple's Core ML build (`ios/models`, F16, input fixed at 518x392: the picture is
 * stretched to it), from the session's 512 px copy. Only RawBoy Desktop bundles the model (`RawBoyEngineMac`);
 * elsewhere `isAvailable` is false and Portrait blur keeps asking for a photo with a depth map. No person mask yet (the
 * web caps glasses at the person's depth and focuses on them): the focus is the middle of the frame.
 */
public enum DepthEstimator {
    public static var isAvailable: Bool {
        #if os(macOS)
        return true
        #else
        return false
        #endif
    }

    static let width = 518
    static let height = 392

    /** Inverse depth (nearer = larger) -> 0..1 depth (0 near, 1 far) over its 2nd..98th percentiles. */
    static func toDepth(_ inverse: [Float]) -> [Float] {
        let sorted = inverse.sorted()
        func at(_ q: Float) -> Float { sorted[min(sorted.count - 1, max(0, Int(Float(sorted.count) * q)))] }
        let lo = at(0.02)
        let range = max(at(0.98) - lo, 1e-6)
        return inverse.map { 1 - min(1, max(0, ($0 - lo) / range)) }
    }

    /** Linear Rec.2020 half floats -> sRGB bytes (BGRA) at [w] x [h] (bilinear, auto exposure), the model's input. */
    static func modelInput(_ image: PreviewImage, _ w: Int, _ h: Int) -> [UInt8] {
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
        var out = [UInt8](repeating: 255, count: 4 * w * h)
        for y in 0..<h {
            let sy = min(max((Float(y) + 0.5) * Float(image.height) / Float(h) - 0.5, 0), Float(image.height - 1))
            let y0 = Int(sy), y1 = min(y0 + 1, image.height - 1), fy = sy - Float(y0)
            for x in 0..<w {
                let sx = min(max((Float(x) + 0.5) * Float(image.width) / Float(w) - 0.5, 0), Float(image.width - 1))
                let x0 = Int(sx), x1 = min(x0 + 1, image.width - 1), fx = sx - Float(x0)
                for c in 0..<3 {
                    let a = rgb[(y0 * image.width + x0) * 3 + c] * (1 - fx) + rgb[(y0 * image.width + x1) * 3 + c] * fx
                    let b = rgb[(y1 * image.width + x0) * 3 + c] * (1 - fx) + rgb[(y1 * image.width + x1) * 3 + c] * fx
                    let v = min(max((a * (1 - fy) + b * fy) * 255 + 0.5, 0), 255)
                    out[(y * w + x) * 4 + (2 - c)] = UInt8(v) // BGRA
                }
            }
        }
        return out
    }

    #if canImport(CoreML)
    private static let lock = NSLock()
    nonisolated(unsafe) private static var loaded: MLModel?

    /** Loads the model the first time (compiled in the engine's resource bundle), then keeps it. */
    private static func model() throws -> MLModel {
        lock.lock()
        defer { lock.unlock() }
        if let loaded { return loaded }
        guard let url = LutRepository.resourceBundle.url(forResource: "DepthAnythingV2SmallF16", withExtension: "mlmodelc") else {
            throw RawImageError(message: "the depth model is missing from the app")
        }
        let configuration = MLModelConfiguration()
        configuration.computeUnits = .all
        let model = try MLModel(contentsOf: url, configuration: configuration)
        loaded = model
        return model
    }

    /** Estimates the depth map of [base] (the session's small linear copy). Slow: call it off the main thread. */
    public static func estimate(_ base: PreviewImage) throws -> DepthMap {
        let model = try model()
        let (w, h) = (width, height)
        var buffer: CVPixelBuffer?
        guard CVPixelBufferCreate(nil, w, h, kCVPixelFormatType_32BGRA, nil, &buffer) == kCVReturnSuccess, let buffer else {
            throw RawImageError(message: "cannot make the depth model's input")
        }
        let bytes = modelInput(base, w, h)
        CVPixelBufferLockBaseAddress(buffer, [])
        if let dst = CVPixelBufferGetBaseAddress(buffer) {
            let stride = CVPixelBufferGetBytesPerRow(buffer)
            for y in 0..<h {
                bytes.withUnsafeBufferPointer { src in
                    memcpy(dst + y * stride, src.baseAddress! + y * w * 4, w * 4)
                }
            }
        }
        CVPixelBufferUnlockBaseAddress(buffer, [])
        let input = try MLDictionaryFeatureProvider(dictionary: ["image": MLFeatureValue(pixelBuffer: buffer)])
        let output = try model.prediction(from: input)
        guard let depthBuffer = output.featureValue(for: "depth")?.imageBufferValue else {
            throw RawImageError(message: "the depth model gave no output")
        }
        let inverse = try read(depthBuffer)
        let ow = CVPixelBufferGetWidth(depthBuffer), oh = CVPixelBufferGetHeight(depthBuffer)
        let depth = toDepth(inverse)
        return DepthMap(
            width: ow, height: oh, hardware: false, subjectDetected: false, focusDepth: depth[(oh / 2) * ow + ow / 2],
            data: depth.map { UInt8(min(max($0 * 255 + 0.5, 0), 255)) })
    }

    /** The grey image's values as floats (the model writes 16-bit half floats; 8-bit and 32-bit float are read too). */
    private static func read(_ buffer: CVPixelBuffer) throws -> [Float] {
        CVPixelBufferLockBaseAddress(buffer, .readOnly)
        defer { CVPixelBufferUnlockBaseAddress(buffer, .readOnly) }
        guard let base = CVPixelBufferGetBaseAddress(buffer) else { throw RawImageError(message: "the depth map is empty") }
        let w = CVPixelBufferGetWidth(buffer), h = CVPixelBufferGetHeight(buffer)
        let stride = CVPixelBufferGetBytesPerRow(buffer)
        let format = CVPixelBufferGetPixelFormatType(buffer)
        var out = [Float](repeating: 0, count: w * h)
        for y in 0..<h {
            let row = base + y * stride
            switch format {
            case kCVPixelFormatType_OneComponent16Half:
                let p = row.assumingMemoryBound(to: Float16.self)
                for x in 0..<w { out[y * w + x] = Float(p[x]) }
            case kCVPixelFormatType_OneComponent32Float:
                let p = row.assumingMemoryBound(to: Float.self)
                for x in 0..<w { out[y * w + x] = p[x] }
            case kCVPixelFormatType_OneComponent8:
                let p = row.assumingMemoryBound(to: UInt8.self)
                for x in 0..<w { out[y * w + x] = Float(p[x]) / 255 }
            default:
                throw RawImageError(message: "the depth map has an unexpected pixel format")
            }
        }
        return out
    }
    #else
    public static func estimate(_ base: PreviewImage) throws -> DepthMap {
        throw RawImageError(message: "depth estimate is not available in this app")
    }
    #endif
}
