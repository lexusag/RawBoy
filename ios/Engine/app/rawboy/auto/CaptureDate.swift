import Foundation
import ImageIO
import enum RawBoyBrowseKit.PhotoOrder

/**
 * When a photo was shot, for ordering Auto's batch ([PhotoOrder]): EXIF's DateTimeOriginal (else when it was digitised
 * or last written), from ImageIO's properties, which read raws' metadata (CR3 included) without decoding them; the
 * file's modified date when it has none. Ports: `CaptureDate.kt`, the web's `engine/browse/CaptureDate.ts`.
 */
public enum CaptureDate {
    /** [url]'s capture date, else its file date, as an EXIF date; nil when neither is known. Blocking: call off the main actor. */
    public static func read(_ url: URL) -> String? {
        if let source = CGImageSourceCreateWithURL(url as CFURL, [kCGImageSourceShouldCache: false] as CFDictionary),
           let props = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any] {
            let exif = props[kCGImagePropertyExifDictionary] as? [CFString: Any]
            let tiff = props[kCGImagePropertyTIFFDictionary] as? [CFString: Any]
            if let d = PhotoOrder.validDate(exif?[kCGImagePropertyExifDateTimeOriginal] as? String)
                ?? PhotoOrder.validDate(exif?[kCGImagePropertyExifDateTimeDigitized] as? String)
                ?? PhotoOrder.validDate(tiff?[kCGImagePropertyTIFFDateTime] as? String) {
                return d
            }
        }
        return PhotoOrder.fileDate((try? url.resourceValues(forKeys: [.contentModificationDateKey]))?.contentModificationDate)
    }

    /**
     * [url]'s camera from its EXIF make and model ("FUJIFILM GFX 50R"; the model alone when it already starts with the
     * make, as the decoders name it), for Auto's Camera filter; nil when the file names none. Blocking.
     */
    public static func camera(_ url: URL) -> String? {
        guard let source = CGImageSourceCreateWithURL(url as CFURL, [kCGImageSourceShouldCache: false] as CFDictionary),
              let props = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
              let tiff = props[kCGImagePropertyTIFFDictionary] as? [CFString: Any] else { return nil }
        let make = (tiff[kCGImagePropertyTIFFMake] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        let model = (tiff[kCGImagePropertyTIFFModel] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        if model.isEmpty { return make.isEmpty ? nil : make }
        if make.isEmpty || model.lowercased().hasPrefix(make.lowercased()) { return model }
        return "\(make) \(model)"
    }
}
