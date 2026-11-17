import Foundation

/**
 * Auto's export file name template (port of web's `engine/export/NameTemplate.ts`, same rules and tests): text with
 * {keywords} and # counters, e.g. "{name}_{look}_##" → "IMG_1234_Portra 400_01". The extension is added after it.
 * Keywords are case-insensitive:
 *
 *   {name} original name without extension   {camera}  camera make and model   {lens}  lens name
 *   {iso}  ISO speed                          {look}    look, preset or "RawBoy edits"
 *   {date} 2026-11-11   {time} 14-30-05   {year} {yy} {month} {day} {hour} {minute} {second}  (shoot date, else the file's)
 *   #, ##, ###...  the photo's number in this export: # = 1, ## = 01, ### = 001 (a run of #s sets the width)
 *
 * Anything else is kept as typed. A keyword the photo has no value for (no lens name...) is left out. Characters file
 * systems refuse (/ \ : * ? " < > | and control characters) become "_".
 */
public enum NameTemplate {
    /** The template used until the user changes it: the original name plus "-auto", as before templates existed. */
    public static let defaultTemplate = "{name}-auto"

    /** What a template can use about one photo. */
    public struct Context: Sendable {
        /** The original file name, with or without extension. */
        public var fileName: String
        public var camera: String?
        public var lens: String?
        public var iso: Float?
        public var look: String?
        /** "YYYY:MM:DD HH:MM:SS" (EXIF), or nil if unknown. */
        public var date: String?
        /** 1-based position of the photo in this export, for #. */
        public var index: Int

        public init(fileName: String, camera: String? = nil, lens: String? = nil, iso: Float? = nil, look: String? = nil,
                    date: String? = nil, index: Int) {
            self.fileName = fileName
            self.camera = camera
            self.lens = lens
            self.iso = iso
            self.look = look
            self.date = date
            self.index = index
        }
    }

    /** A keyword as typed in a template, and what it stands for. */
    public struct Keyword: Sendable, Identifiable {
        public let token: String
        public let text: String
        public var id: String { token }
        init(_ token: String, _ text: String) {
            self.token = token
            self.text = text
        }
    }

    /** The keywords, for the help text and the export sheet's buttons. */
    public static let keywords: [Keyword] = [
        Keyword("{name}", "original name"),
        Keyword("{camera}", "camera"),
        Keyword("{lens}", "lens"),
        Keyword("{iso}", "ISO"),
        Keyword("{look}", "look or preset"),
        Keyword("{date}", "2026-11-11"),
        Keyword("{time}", "14-30-05"),
        Keyword("{year}", "year"),
        Keyword("{month}", "month"),
        Keyword("{day}", "day"),
        Keyword("{hour}", "hour"),
        Keyword("{minute}", "minute"),
        Keyword("{second}", "second"),
        Keyword("#", "number: ## = 01"),
    ]

    private static let illegal: Set<Character> = ["/", "\\", ":", "*", "?", "\"", "<", ">", "|"]
    private static let reserved: Set<String> = {
        var s: Set<String> = ["con", "prn", "aux", "nul"]
        for i in 1...9 { s.insert("com\(i)"); s.insert("lpt\(i)") }
        return s
    }()
    private static let maxStem = 150
    private static let dateKeys: Set<String> = ["year", "yy", "month", "day", "hour", "minute", "second", "date", "time"]

    /** Strips the extension from a file name. */
    private static func stem(_ name: String) -> String {
        guard let dot = name.lastIndex(of: "."), dot > name.startIndex else { return name }
        return String(name[..<dot])
    }

    private static func isSpaceOrDot(_ c: Character) -> Bool { c == "." || c.isWhitespace }

    /** Replaces characters file systems refuse, trims the ends (Windows drops trailing dots and spaces) and caps the length. */
    public static func sanitize(_ text: String) -> String {
        var cleaned = ""
        var lastSpace = false
        for c in text {
            let refused = illegal.contains(c) || c.unicodeScalars.contains { $0.value < 0x20 }
            if refused {
                cleaned.append("_")
                lastSpace = false
            } else if c.isWhitespace {
                if !lastSpace { cleaned.append(" ") }
                lastSpace = true
            } else {
                cleaned.append(c)
                lastSpace = false
            }
        }
        var s = Substring(cleaned)
        while let f = s.first, isSpaceOrDot(f) { s.removeFirst() }
        while let l = s.last, isSpaceOrDot(l) { s.removeLast() }
        if s.count > maxStem {
            s = s.prefix(maxStem)
            while let l = s.last, isSpaceOrDot(l) { s.removeLast() }
        }
        let out = String(s)
        return reserved.contains(out.lowercased()) ? "_" + out : out
    }

    /** The date parts of an EXIF date, or nil if it isn't one. */
    private static func dateParts(_ date: String?) -> [String: String]? {
        guard let date else { return nil }
        let c = Array(date)
        guard c.count >= 19 else { return nil }
        func digits(_ r: Range<Int>) -> String? {
            let s = String(c[r])
            return s.allSatisfy { $0.isASCII && $0.isNumber } ? s : nil
        }
        guard c[4] == ":", c[7] == ":", c[10] == " " || c[10] == "T", c[13] == ":", c[16] == ":",
              let y = digits(0..<4), let mo = digits(5..<7), let d = digits(8..<10),
              let h = digits(11..<13), let mi = digits(14..<16), let s = digits(17..<19) else { return nil }
        return ["year": y, "yy": String(y.suffix(2)), "month": mo, "day": d, "hour": h, "minute": mi, "second": s,
                "date": "\(y)-\(mo)-\(d)", "time": "\(h)-\(mi)-\(s)"]
    }

    /** The file name (without extension) [template] gives [ctx]; never empty. */
    public static func apply(_ template: String, _ ctx: Context) -> String {
        var values: [String: String] = [
            "name": stem(ctx.fileName),
            "camera": ctx.camera ?? "",
            "lens": ctx.lens ?? "",
            "iso": ctx.iso.flatMap { $0 > 0 ? String(Int($0.rounded())) : nil } ?? "",
            "look": ctx.look ?? "",
        ]
        if let dates = dateParts(ctx.date) { values.merge(dates) { _, new in new } }
        let trimmed = template.trimmingCharacters(in: .whitespacesAndNewlines)
        let chars = Array(trimmed.isEmpty ? defaultTemplate : template)
        var out = ""
        var i = 0
        while i < chars.count {
            let c = chars[i]
            if c == "#" {
                var j = i
                while j < chars.count, chars[j] == "#" { j += 1 }
                let number = String(max(0, ctx.index))
                out += String(repeating: "0", count: max(0, (j - i) - number.count)) + number
                i = j
                continue
            }
            if c == "{" {
                var j = i + 1
                while j < chars.count, chars[j].isASCII, chars[j].isLetter { j += 1 }
                if j > i + 1, j < chars.count, chars[j] == "}" {
                    let key = String(chars[(i + 1)..<j]).lowercased()
                    // Unknown words stay as typed, so a typo shows in the preview.
                    if values[key] != nil || dateKeys.contains(key) {
                        out += values[key] ?? ""
                    } else {
                        out += String(chars[i...j])
                    }
                    i = j + 1
                    continue
                }
            }
            out.append(c)
            i += 1
        }
        let name = sanitize(out)
        return name.isEmpty ? "image" : name
    }

    /** "<stem>.<ext>", then "<stem>-001.<ext>", "-002"... for [counter] > 0 (two photos that got the same name). */
    public static func fileName(_ stem: String, _ ext: String, _ counter: Int) -> String {
        counter == 0 ? "\(stem).\(ext)" : "\(stem)-\(String(format: "%03d", counter)).\(ext)"
    }

    /**
     * The first name from [fileName] (counter 0, 1, ...) that isn't a file in [directory] yet (web's `writeUnique`): an
     * export never overwrites a file. Nil after 999 tries.
     */
    public static func freeName(_ stem: String, _ ext: String, in directory: URL) -> String? {
        for counter in 0...999 {
            let name = fileName(stem, ext, counter)
            if !FileManager.default.fileExists(atPath: directory.appendingPathComponent(name).path) { return name }
        }
        return nil
    }
}
