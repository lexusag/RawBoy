import Foundation

/**
 * Ratings, orientation and RawBoy's edits in XMP sidecars: a port of web's `engine/browse/XmpSidecar.ts` (with the
 * `tiff:Orientation` field RawBoy Viewer writes; its `RawBoyBrowseKit.XmpSidecar` is the same format). Keep the three in step.
 *
 * Existing sidecars usually hold another app's edits (darktable, Lightroom): only RawBoy's fields are changed, in
 * place, and everything else is kept byte for byte.
 */
public enum XmpSidecar {
    static let xmpNS = "http://ns.adobe.com/xap/1.0/"
    static let rawboyNS = "http://ns.rawboy.app/1.0/"
    static let tiffNS = "http://ns.adobe.com/tiff/1.0/"

    public enum WriteError: Error, Equatable {
        /// The text has no rdf:Description to add the field to.
        case notASidecar
    }

    public enum Flag: Equatable, Sendable { case pick, reject }

    public struct Rating: Equatable, Sendable {
        /// 0-5.
        public var stars: Int
        public var flag: Flag?
        public init(stars: Int = 0, flag: Flag? = nil) {
            self.stars = stars
            self.flag = flag
        }
    }

    /// The rating in a sidecar's text (`xmp:Rating` 0-5, -1 = rejected; `rawboy:Pick="1"`).
    public static func readRating(_ text: String) -> Rating {
        let rating = fieldValue(text, "xmp:Rating").flatMap(Double.init) ?? 0
        let pick = fieldValue(text, "rawboy:Pick") == "1"
        if rating < 0 { return Rating(stars: 0, flag: .reject) }
        return Rating(stars: max(0, min(5, Int(rating.rounded()))), flag: pick ? .pick : nil)
    }

    /// [text] (nil: a new sidecar) with [rating] written into it.
    public static func writeRating(_ text: String?, _ rating: Rating) throws -> String {
        var out = text ?? empty
        out = try setField(out, "xmp:Rating", "xmp", xmpNS, String(rating.flag == .reject ? -1 : rating.stars))
        out = try setField(out, "rawboy:Pick", "rawboy", rawboyNS, rating.flag == .pick ? "1" : nil)
        return out
    }

    /// The orientation a sidecar sets for its photo (`tiff:Orientation`, where Lightroom and RawBoy Viewer keep a rotation), or nil.
    public static func readOrientation(_ text: String) -> Int? {
        fieldValue(text, "tiff:Orientation").flatMap { Int($0) }.flatMap { (1...8).contains($0) ? $0 : nil }
    }

    /// [text] (nil: a new sidecar) with `tiff:Orientation` set to [orientation]; nil removes it.
    public static func writeOrientation(_ text: String?, _ orientation: Int?) throws -> String {
        try setField(text ?? empty, "tiff:Orientation", "tiff", tiffNS, orientation.map(String.init))
    }

    /// A photo's RawBoy Auto settings (`rawboy:Auto`, escaped `AutoSidecar` JSON) in a sidecar's text, or nil.
    public static func readAuto(_ text: String) -> String? {
        fieldValue(text, "rawboy:Auto").flatMap { $0.isEmpty ? nil : unescapeXml($0) }
    }

    /// [text] with RawBoy's Auto settings set to [json] (nil removes them); the other fields stay as they are.
    public static func writeAuto(_ text: String?, _ json: String?) throws -> String {
        try setField(text ?? empty, "rawboy:Auto", "rawboy", rawboyNS, json.map(escapeXml))
    }

    /// RawBoy's edits (`rawboy:Develop`, escaped `Edits` JSON) in a sidecar's text, or nil.
    public static func readDevelop(_ text: String) -> String? {
        fieldValue(text, "rawboy:Develop").flatMap { $0.isEmpty ? nil : unescapeXml($0) }
    }

    /// [text] (nil: a new sidecar) with RawBoy's edits set to [json]; nil removes them.
    public static func writeDevelop(_ text: String?, _ json: String?) throws -> String {
        try setField(text ?? empty, "rawboy:Develop", "rawboy", rawboyNS, json.map(escapeXml))
    }

    static let empty = """
        <?xpacket begin="\u{FEFF}" id="W5M0MpCehiHzreSzNTczkc9d"?>
        <x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="RawBoy">
         <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
          <rdf:Description rdf:about=""/>
         </rdf:RDF>
        </x:xmpmeta>
        <?xpacket end="w"?>

        """

    // MARK: Field editing

    private static func escape(_ s: String) -> String { NSRegularExpression.escapedPattern(for: s) }

    /// An attribute (name="v") form of [name].
    private static func attributeRe(_ name: String) -> NSRegularExpression {
        // swiftlint:disable:next force_try
        try! NSRegularExpression(pattern: #"(\s"# + escape(name) + #"\s*=\s*)(["'])((?:(?!\2)[^<])*)\2"#)
    }

    /// A simple element (<name>v</name>) form of [name].
    private static func elementRe(_ name: String) -> NSRegularExpression {
        // swiftlint:disable:next force_try
        try! NSRegularExpression(pattern: "(<" + escape(name) + ">)([^<]*)(</" + escape(name) + ">)")
    }

    static func fieldValue(_ text: String, _ name: String) -> String? {
        let ns = text as NSString
        let all = NSRange(location: 0, length: ns.length)
        if let m = attributeRe(name).firstMatch(in: text, range: all) {
            return ns.substring(with: m.range(at: 3)).trimmingCharacters(in: .whitespacesAndNewlines)
        }
        if let m = elementRe(name).firstMatch(in: text, range: all) {
            return ns.substring(with: m.range(at: 2)).trimmingCharacters(in: .whitespacesAndNewlines)
        }
        return nil
    }

    /// Sets [name] to [value] where it already is (attribute or element), else adds it as an attribute of the first
    /// rdf:Description, declaring [prefix] there if that element doesn't. A nil value removes the field.
    static func setField(_ text: String, _ name: String, _ prefix: String, _ ns: String, _ value: String?) throws -> String {
        let nsText = text as NSString
        let all = NSRange(location: 0, length: nsText.length)
        if let m = attributeRe(name).firstMatch(in: text, range: all) {
            guard let value else { return nsText.replacingCharacters(in: m.range, with: "") }
            return nsText.replacingCharacters(in: m.range(at: 3), with: value)
        }
        if let m = elementRe(name).firstMatch(in: text, range: all) {
            if let value { return nsText.replacingCharacters(in: m.range(at: 2), with: value) }
            // swiftlint:disable:next force_try
            let whole = try! NSRegularExpression(pattern: #"\s*<"# + escape(name) + ">[^<]*</" + escape(name) + ">")
            guard let w = whole.firstMatch(in: text, range: all) else { return text }
            return nsText.replacingCharacters(in: w.range, with: "")
        }
        guard let value else { return text }
        // swiftlint:disable:next force_try
        let descriptionRe = try! NSRegularExpression(pattern: #"<rdf:Description\b[^>]*?(?=\/?>)"#)
        guard let d = descriptionRe.firstMatch(in: text, range: all) else { throw WriteError.notASidecar }
        let description = nsText.substring(with: d.range)
        let declared = description.range(of: #"\sxmlns:"# + escape(prefix) + #"\s*="#, options: .regularExpression)
        let added = (declared != nil ? "" : "\n   xmlns:\(prefix)=\"\(ns)\"") + "\n   \(name)=\"\(value)\""
        return nsText.replacingCharacters(in: NSRange(location: d.range.upperBound, length: 0), with: added)
    }

    static func escapeXml(_ s: String) -> String {
        s.replacingOccurrences(of: "&", with: "&amp;").replacingOccurrences(of: "<", with: "&lt;")
            .replacingOccurrences(of: ">", with: "&gt;").replacingOccurrences(of: "\"", with: "&quot;")
            .replacingOccurrences(of: "'", with: "&apos;")
    }

    static func unescapeXml(_ s: String) -> String {
        guard s.contains("&") else { return s }
        var out = ""
        var rest = Substring(s)
        while let amp = rest.firstIndex(of: "&") {
            out += rest[..<amp]
            guard let semi = rest[amp...].firstIndex(of: ";") else { break }
            let entity = rest[rest.index(after: amp)..<semi]
            switch entity.lowercased() {
            case "amp": out += "&"
            case "lt": out += "<"
            case "gt": out += ">"
            case "quot": out += "\""
            case "apos": out += "'"
            default:
                let code: UInt32? =
                    entity.hasPrefix("#x") || entity.hasPrefix("#X")
                    ? UInt32(entity.dropFirst(2), radix: 16) : entity.hasPrefix("#") ? UInt32(entity.dropFirst()) : nil
                if let code, let scalar = Unicode.Scalar(code) {
                    out.unicodeScalars.append(scalar)
                } else {
                    out += rest[amp...semi]
                }
            }
            rest = rest[rest.index(after: semi)...]
        }
        return out + rest
    }
}

/**
 * An EXIF orientation as what it does to the stored pixels: mirror left-right first (when [mirrored]), then turn
 * [quarterTurns] x 90 degrees clockwise (RawBoy's own order: `flipHorizontal` then `rotation`). Same as RawBoy Viewer's.
 */
public struct ExifOrientation: Equatable, Sendable {
    public let mirrored: Bool
    public let quarterTurns: Int

    public init(mirrored: Bool = false, quarterTurns: Int = 0) {
        self.mirrored = mirrored
        self.quarterTurns = ((quarterTurns % 4) + 4) % 4
    }

    /// EXIF/TIFF Orientation 1...8 (anything else: up).
    public init(exif: Int) {
        switch exif {
        case 2: self.init(mirrored: true)
        case 3: self.init(quarterTurns: 2)
        case 4: self.init(mirrored: true, quarterTurns: 2)
        case 5: self.init(mirrored: true, quarterTurns: 3)
        case 6: self.init(quarterTurns: 1)
        case 7: self.init(mirrored: true, quarterTurns: 1)
        case 8: self.init(quarterTurns: 3)
        default: self.init()
        }
    }

    /// This, then [next].
    public func then(_ next: ExifOrientation) -> ExifOrientation {
        ExifOrientation(mirrored: mirrored != next.mirrored,
                        quarterTurns: next.mirrored ? next.quarterTurns - quarterTurns : next.quarterTurns + quarterTurns)
    }

    public var inverse: ExifOrientation { mirrored ? self : ExifOrientation(quarterTurns: -quarterTurns) }

    /// What a sidecar's `tiff:Orientation` ([sidecar]) adds on top of the photo's own orientation ([file]).
    public static func delta(file: Int, sidecar: Int) -> ExifOrientation {
        ExifOrientation(exif: file).inverse.then(ExifOrientation(exif: sidecar))
    }
}

/**
 * Where a photo's sidecar is and how RawBoy Desktop reads and writes it (web's `BrowserStore.editsSidecar`): NAME.xmp
 * next to the photo, else darktable's NAME.EXT.xmp, else a new NAME.xmp. Every write reads the file afresh and changes
 * only RawBoy's field, atomically, so it never undoes another app's (or the Viewer's) write.
 */
public struct PhotoSidecar: Sendable {
    public let photo: URL

    public init(photo: URL) { self.photo = photo }

    /// The sidecar's URL: an existing NAME.xmp or NAME.EXT.xmp (matched ignoring case), else the NAME.xmp to create.
    public var url: URL {
        let dir = photo.deletingLastPathComponent()
        let stem = photo.deletingPathExtension().lastPathComponent
        let names = (try? FileManager.default.contentsOfDirectory(atPath: dir.path)) ?? []
        func named(_ n: String) -> String? { names.first { $0.caseInsensitiveCompare(n) == .orderedSame } }
        let name = named(stem + ".xmp") ?? named(photo.lastPathComponent + ".xmp") ?? stem + ".xmp"
        return dir.appendingPathComponent(name)
    }

    /// The sidecar's text, or nil when there is none.
    public func readText() -> String? {
        try? String(contentsOf: url, encoding: .utf8)
    }

    /// RawBoy's edits JSON in the sidecar (`rawboy:Develop`), or nil.
    public func readDevelop() -> String? { readText().flatMap(XmpSidecar.readDevelop) }

    /// RawBoy Auto's settings JSON in the sidecar (`rawboy:Auto`), or nil.
    public func readAuto() -> String? { readText().flatMap(XmpSidecar.readAuto) }

    /// As `writeDevelop`, for RawBoy Auto's settings (`rawboy:Auto`).
    public func writeAuto(_ json: String?) throws {
        let url = self.url
        let old = try? String(contentsOf: url, encoding: .utf8)
        if old == nil && json == nil { return }
        let out = try XmpSidecar.writeAuto(old, json)
        if out == old { return }
        try Data(out.utf8).write(to: url, options: .atomic)
    }

    /// The sidecar's `tiff:Orientation`, or nil.
    public func readOrientation() -> Int? { readText().flatMap(XmpSidecar.readOrientation) }

    /// Sets RawBoy's edits ([json], nil removes them); a missing sidecar is created only for non-nil edits. Skipped when
    /// nothing changes. Atomic (a temporary file moved over the sidecar).
    public func writeDevelop(_ json: String?) throws {
        let url = self.url
        let old = try? String(contentsOf: url, encoding: .utf8)
        if old == nil && json == nil { return }
        let out = try XmpSidecar.writeDevelop(old, json)
        if out == old { return }
        try Data(out.utf8).write(to: url, options: .atomic)
    }
}
