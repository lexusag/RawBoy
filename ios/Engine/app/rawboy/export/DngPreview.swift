import Foundation
import RawBoyNative

/**
 * Re-saves a DNG with an sRGB JPEG (in the negative's native/sensor orientation, matching IFD0's Orientation tag)
 * embedded as its primary preview (Adobe DNG SDK, `dng_transcode.cpp`).
 */
public enum DngPreview {
    public struct Error: LocalizedError {
        public let message: String
        public var errorDescription: String? { message }
    }

    /**
     * Embeds [previewJpeg] as the primary DNG preview inside [dng] and returns the rewritten DNG bytes.
     * Returns `nil` when unchanged or when built without the Adobe DNG SDK (callers keep the original DNG).
     */
    public static func embed(_ previewJpeg: Data, in dng: Data) throws -> Data? {
        guard !dng.isEmpty, !previewJpeg.isEmpty else { return nil }
        var outPtr: UnsafeMutablePointer<UInt8>?
        var outSize: Int = 0
        var errBuf = [CChar](repeating: 0, count: 256)
        let rc: Int32 = dng.withUnsafeBytes { dngRaw in
            previewJpeg.withUnsafeBytes { jpgRaw in
                rb_dng_embed_preview(
                    dngRaw.bindMemory(to: UInt8.self).baseAddress, dng.count,
                    jpgRaw.bindMemory(to: UInt8.self).baseAddress, previewJpeg.count,
                    &outPtr, &outSize, &errBuf, errBuf.count
                )
            }
        }
        if rc == 1 || rc == 2 { return nil }
        if rc != 0 {
            let msg = String(cString: errBuf)
            throw Error(message: msg.isEmpty ? "DNG preview embed failed" : msg)
        }
        guard let ptr = outPtr, outSize > 0 else { return nil }
        defer { rb_dng_free(ptr) }
        return Data(bytes: ptr, count: outSize)
    }
}
