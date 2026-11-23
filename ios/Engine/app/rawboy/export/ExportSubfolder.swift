import Foundation

/** The subfolder an export is written into (Pro's and Auto's export sheets on RawBoy Desktop); port of web's `Subfolder.ts`. */
public enum ExportSubfolder {
    /** Longest subfolder name kept. */
    public static let maxLength = 100

    /**
     * From what was typed: "" = none (the export folder itself). `{date}` is today's date as YYYY-MM-DD; path
     * separators and characters a file system refuses become "-" (one level only, no nested paths and no "..");
     * blanks and dots around the name are dropped.
     */
    public static func clean(_ text: String, now: Date = Date(), calendar: Calendar = .current) -> String {
        let c = calendar.dateComponents([.year, .month, .day], from: now)
        let date = String(format: "%04d-%02d-%02d", c.year ?? 0, c.month ?? 0, c.day ?? 0)
        let replaced = text.replacingOccurrences(of: "{date}", with: date, options: .caseInsensitive)
        let refused = CharacterSet(charactersIn: "\\/:*?\"<>|").union(.controlCharacters)
        var scalars = String.UnicodeScalarView()
        for s in replaced.unicodeScalars { scalars.append(refused.contains(s) ? "-" : s) }
        let edge = CharacterSet.whitespacesAndNewlines.union(CharacterSet(charactersIn: "."))
        let name = String(scalars).trimmingCharacters(in: edge)
        return String(name.prefix(maxLength)).trimmingCharacters(in: edge)
    }

    /** [base] with the cleaned subfolder inside it (base itself when the name is blank). */
    public static func apply(_ text: String, to base: URL) -> URL {
        let name = clean(text)
        return name.isEmpty ? base : base.appendingPathComponent(name, isDirectory: true)
    }
}
