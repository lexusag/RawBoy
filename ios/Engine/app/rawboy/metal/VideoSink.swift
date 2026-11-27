import CoreMedia
import CoreVideo
import Foundation

/**
 * Where the viewfinder's develop is drawn a second time while a video records: a pool of BGRA pixel buffers of the
 * file's size, each filled by the renderer (the 4:3 picture cropped to the file's aspect, cover fit) and handed to
 * [onFrame] with the camera frame's own presentation time. Port of the role of Android's `VideoSink`; the encoder
 * (AVAssetWriter) lives in the Camera app.
 */
public final class VideoSink: @unchecked Sendable {
    public let width: Int
    public let height: Int
    /** Clockwise quarter turns applied to the upright portrait develop frame into this sink's buffers (0..3). */
    public let turns: Int
    /** A developed frame, from a Metal completion thread: append it and let go quickly (the pool is small). */
    public var onFrame: ((CVPixelBuffer, CMTime) -> Void)?
    private var pool: CVPixelBufferPool?
    private let lock = NSLock()
    private var sentValue = 0
    private var droppedValue = 0

    /** Frames handed to [onFrame] so far. */
    public var framesSent: Int { lock.withLock { sentValue } }
    /** Frames the renderer skipped because every buffer was still in use (the encoder or the GPU was behind). */
    public var framesDropped: Int { lock.withLock { droppedValue } }

    public init(width: Int, height: Int, turns: Int = 0) {
        self.width = width
        self.height = height
        self.turns = ((turns % 4) + 4) % 4
        let attributes: [String: Any] = [
            kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
            kCVPixelBufferWidthKey as String: width,
            kCVPixelBufferHeightKey as String: height,
            kCVPixelBufferMetalCompatibilityKey as String: true,
            kCVPixelBufferIOSurfacePropertiesKey as String: [String: Any](),
        ]
        let poolAttributes: [String: Any] = [kCVPixelBufferPoolMinimumBufferCountKey as String: 4]
        CVPixelBufferPoolCreate(nil, poolAttributes as CFDictionary, attributes as CFDictionary, &pool)
    }

    /** A free buffer, tagged with the colour space the file declares (BT.709), or nil while all are in use. */
    func makeBuffer() -> CVPixelBuffer? {
        guard let pool else { return nil }
        var buffer: CVPixelBuffer?
        let aux: [String: Any] = [kCVPixelBufferPoolAllocationThresholdKey as String: 6]
        let status = CVPixelBufferPoolCreatePixelBufferWithAuxAttributes(nil, pool, aux as CFDictionary, &buffer)
        guard status == kCVReturnSuccess, let buffer else {
            lock.withLock { droppedValue += 1 }
            return nil
        }
        CVBufferSetAttachment(buffer, kCVImageBufferColorPrimariesKey, kCVImageBufferColorPrimaries_ITU_R_709_2, .shouldPropagate)
        CVBufferSetAttachment(buffer, kCVImageBufferTransferFunctionKey, kCVImageBufferTransferFunction_ITU_R_709_2, .shouldPropagate)
        CVBufferSetAttachment(buffer, kCVImageBufferYCbCrMatrixKey, kCVImageBufferYCbCrMatrix_ITU_R_709_2, .shouldPropagate)
        return buffer
    }

    func deliver(_ buffer: CVPixelBuffer, _ time: CMTime) {
        lock.withLock { sentValue += 1 }
        onFrame?(buffer, time)
    }
}
