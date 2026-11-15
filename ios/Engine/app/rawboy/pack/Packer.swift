#if os(macOS)
import CoreGraphics
import Foundation
import ImageIO
import RawBoyNative
import UniformTypeIdentifiers

/**
 * RawBoy Packer on the Mac: camera raws and DNGs re-saved as DNG 1.7 through the Adobe DNG SDK (`dng_pack.cpp`, the same
 * code as the web's WASM Packer; `rb_pack` in RawBoyNative). macOS only: the iOS slices don't include it.
 * This product includes DNG technology under license by Adobe.
 */
public enum Packer {
    public struct PackError: LocalizedError {
        public let message: String
        public var errorDescription: String? { message }
    }

    /** Whether this build of the native library can pack (it needs the Adobe DNG SDK). */
    public static var available: Bool { rb_has_dng_sdk() }

    private static func string<T>(_ tuple: T) -> String {
        withUnsafeBytes(of: tuple) { raw in
            let bytes = raw.prefix { $0 != 0 }
            return String(decoding: bytes, as: UTF8.self)
        }
    }

    private static func info(_ c: RBPackInfo) -> PackInfo {
        var i = PackInfo()
        i.make = string(c.make)
        i.model = string(c.model)
        i.lens = string(c.lens)
        i.format = string(c.format)
        i.width = Int(c.width)
        i.height = Int(c.height)
        i.dng = c.dng
        i.mosaic = c.mosaic
        i.bayer = c.bayer
        i.lensData = string(c.lensData)
        i.lensDistortion = c.lensDistortion
        i.lensVignetting = c.lensVignetting
        i.lensCa = c.lensCa
        i.adobeHints = c.adobeHints
        i.bits = Int(c.bits)
        i.compression = string(c.compression)
        i.dngVersion = string(c.dngVersion)
        i.modeUsed = [PackFormat.losslessJpeg, .losslessJxl, .small, .micro][min(max(Int(c.modeUsed), 0), 3)]
        i.linear = c.linear
        i.lensWritten = c.lensWritten
        i.preview = string(c.preview)
        i.outWidth = Int(c.outWidth)
        i.outHeight = Int(c.outHeight)
        i.seconds = c.seconds
        return i
    }

    /** What the file at [url] is, without decoding the image (fast). */
    public static func inspect(_ url: URL) throws -> PackInfo {
        let data = try Data(contentsOf: url, options: .alwaysMapped)
        return try RawImage.onLargeStack { () -> Result<PackInfo, PackError> in
            var c = RBPackInfo()
            var error = [CChar](repeating: 0, count: 512)
            let ok = data.withUnsafeBytes { raw in
                rb_pack_inspect(raw.bindMemory(to: UInt8.self).baseAddress, raw.count, &c, &error, error.count)
            }
            return ok ? .success(info(c)) : .failure(PackError(message: String(cString: error)))
        }.get()
    }

    /** A small sRGB JPEG for the DNG preview when the camera's own can't be used (ImageIO, quality 0.9). */
    private static let encodePreview: RBPreviewEncoder = { rgb, width, height, jpeg, size, _ in
        guard let rgb, let jpeg, let size else { return false }
        let count = Int(width) * Int(height) * 3
        let data = Data(bytes: rgb, count: count)
        guard let provider = CGDataProvider(data: data as CFData),
              let image = CGImage(width: Int(width), height: Int(height), bitsPerComponent: 8, bitsPerPixel: 24,
                                  bytesPerRow: Int(width) * 3, space: CGColorSpace(name: CGColorSpace.sRGB)!,
                                  bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.none.rawValue), provider: provider,
                                  decode: nil, shouldInterpolate: false, intent: .defaultIntent)
        else { return false }
        let out = NSMutableData()
        guard let dest = CGImageDestinationCreateWithData(out, UTType.jpeg.identifier as CFString, 1, nil) else { return false }
        CGImageDestinationAddImage(dest, image, [kCGImageDestinationLossyCompressionQuality: 0.9] as CFDictionary)
        guard CGImageDestinationFinalize(dest), let buffer = malloc(out.length) else { return false }
        memcpy(buffer, out.bytes, out.length)
        jpeg.pointee = buffer.assumingMemoryBound(to: UInt8.self)
        size.pointee = out.length
        return true
    }

    /**
     * Packs the file at [url] into [destination] (which must not exist: an existing file is never overwritten) with
     * [settings], the encoder using [threads] threads. Blocks for seconds: call it off the main thread. The input is
     * memory-mapped, the result written whole. Returns what the file was and what was written.
     */
    public static func pack(_ url: URL, to destination: URL, settings: PackSettings, threads: Int) throws -> PackInfo {
        let data = try Data(contentsOf: url, options: .alwaysMapped)
        var options = RBPackOptions(mode: Int32(modeIndex(settings.format)), distance: settings.quality.distance,
                                    effort: Int32(settings.speed.effort), maxSize: Int32(settings.maxSize),
                                    previewSize: Int32(settings.preview.pixels), lensCorrections: settings.lensCorrections,
                                    keepGps: settings.keepGps, threads: Int32(threads))
        // The SDK and LibRaw recurse deeply: a thread of its own with a big stack (the cooperative pool's is 512 KB).
        let result = RawImage.onLargeStack { () -> Result<(Data, PackInfo), PackError> in
            var out: UnsafeMutablePointer<UInt8>?
            var outSize = 0
            var c = RBPackInfo()
            var error = [CChar](repeating: 0, count: 512)
            let ok = data.withUnsafeBytes { raw in
                rb_pack(raw.bindMemory(to: UInt8.self).baseAddress, raw.count, &options, encodePreview, nil, &out, &outSize, &c,
                        &error, error.count)
            }
            guard ok, let out else { return .failure(PackError(message: String(cString: error))) }
            // Handed on without a copy; the deallocator frees the C buffer.
            return .success((Data(bytesNoCopy: out, count: outSize, deallocator: .custom { p, _ in rb_pack_free(p.assumingMemoryBound(to: UInt8.self)) }), info(c)))
        }
        let (dng, packed) = try result.get()
        try dng.write(to: destination, options: .withoutOverwriting)
        return packed
    }

    private static func modeIndex(_ f: PackFormat) -> Int {
        switch f {
        case .losslessJpeg: Int(RB_PACK_LOSSLESS_JPEG.rawValue)
        case .losslessJxl: Int(RB_PACK_LOSSLESS_JXL.rawValue)
        case .small: Int(RB_PACK_SMALL_RAW.rawValue)
        case .micro: Int(RB_PACK_MICRO.rawValue)
        }
    }
}
#endif
