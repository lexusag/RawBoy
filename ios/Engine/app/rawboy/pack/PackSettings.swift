import Foundation
import enum RawBoyBrowseKit.PhotoOrder
import enum RawBoyBrowseKit.PhotoSort

/**
 * RawBoy Packer's settings, presets and the live summary of what they do: a port of web's `packer/settings.ts` (same
 * texts and numbers: measured on A7 III, GFX 50R, E-PL9, NEX-3 and Pixel 9 Pro files on 2026-11-01; app support
 * checked in Lightroom, Apple Photos, XnView and darktable). Portable; the packing itself is `Packer` (macOS).
 */
public enum PackFormat: String, Codable, CaseIterable, Sendable {
    case small, micro, losslessJpeg, losslessJxl

    public var label: String {
        switch self {
        case .small: "Small raw"
        case .micro: "Micro (resized)"
        case .losslessJpeg: "Lossless"
        case .losslessJxl: "Lossless JPEG XL"
        }
    }

    /** Whether the format has a quality (JPEG XL distance). */
    public var usesQuality: Bool { self == .small || self == .micro }
    /** Whether the format has a speed (encoder effort). */
    public var usesSpeed: Bool { self != .losslessJpeg }
}

public enum PackQuality: String, Codable, CaseIterable, Sendable {
    case archive, high, good, compact

    public var label: String {
        switch self {
        case .archive: "Archive"
        case .high: "High"
        case .good: "Good"
        case .compact: "Compact"
        }
    }

    /** The JPEG XL distance. */
    public var distance: Float {
        switch self {
        case .archive: 0.1
        case .high: 0.2
        case .good: 0.5
        case .compact: 1.0
        }
    }
}

public enum PackSpeed: String, Codable, CaseIterable, Sendable {
    case fast, normal, best

    public var label: String {
        switch self {
        case .fast: "Quick"
        case .normal: "Balanced"
        case .best: "Thorough"
        }
    }

    /** The encoder effort. */
    public var effort: Int {
        switch self {
        case .fast: 3
        case .normal: 5
        case .best: 7
        }
    }
}

public enum PackPreview: String, Codable, CaseIterable, Sendable {
    case standard, large, none

    public var label: String {
        switch self {
        case .standard: "1024 px"
        case .large: "2048 px"
        case .none: "None"
        }
    }

    public var pixels: Int {
        switch self {
        case .standard: 1024
        case .large: 2048
        case .none: 0
        }
    }
}

public enum PackPreset: String, CaseIterable, Sendable {
    case small, lossless, micro, custom

    public var label: String {
        switch self {
        case .small: "Smallest files"
        case .lossless: "Maximum compatibility"
        case .micro: "Tiny copies for sharing"
        case .custom: "Custom"
        }
    }

    /** One plain sentence under the preset row. */
    public var hint: String {
        switch self {
        case .small: "Keeps every bit of detail you can edit, at a quarter to a half of the camera raw's size. The best choice for archiving."
        case .lossless: "Same picture data as the raw, nothing lost, but bigger files. Opens in every program that reads DNG."
        case .micro: "A small, resized copy (about 5-20% of the raw) for sharing or casual archives. Less room for heavy edits."
        case .custom: "Your own combination, set under Advanced settings."
        }
    }
}

public struct PackSettings: Codable, Equatable, Sendable {
    public var format: PackFormat = .small
    public var quality: PackQuality = .high
    public var speed: PackSpeed = .normal
    /** Micro: long side in pixels. */
    public var maxSize = 4000
    public var preview: PackPreview = .standard
    public var lensCorrections = true
    public var keepGps = true
    /** Add the settings to the file name (DSC001-small-high.dng). */
    public var nameSuffix = false
    /** Show the advanced rows (format, quality, effort, preview, parallel files). */
    public var advanced = false
    /** Files packed in parallel; 0 = chosen from the cores and memory. */
    public var filesAtOnce = 0

    public init() {}

    public static let maxSizes = [2048, 3000, 4000, 6000]
    public static let maxFilesAtOnce = 4

    /** What each preset chip sets: the format and its quality fields. */
    public static func settings(of preset: PackPreset) -> (format: PackFormat, quality: PackQuality, speed: PackSpeed, maxSize: Int)? {
        switch preset {
        case .small: (.small, .high, .normal, 4000)
        case .lossless: (.losslessJpeg, .high, .normal, 4000)
        case .micro: (.micro, .high, .normal, 4000)
        case .custom: nil
        }
    }

    public mutating func apply(_ preset: PackPreset) {
        guard let p = Self.settings(of: preset) else { return }
        format = p.format
        quality = p.quality
        speed = p.speed
        maxSize = p.maxSize
    }

    /** Which preset the settings match (fields a format doesn't use are ignored), or custom. */
    public var preset: PackPreset {
        for name in [PackPreset.small, .lossless, .micro] {
            guard let p = Self.settings(of: name), p.format == format else { continue }
            if format == .losslessJpeg { return name }
            if format == .losslessJxl { continue }
            if p.quality == quality && p.speed == speed && (format != .micro || p.maxSize == maxSize) { return name }
        }
        return .custom
    }

    /** The settings as a file name suffix: "small-high", "micro4000-good", "lossless", "lossless-jxl". */
    public var suffix: String {
        switch format {
        case .small: "small-\(quality.rawValue)"
        case .micro: "micro\(maxSize)-\(quality.rawValue)"
        case .losslessJxl: "lossless-jxl"
        case .losslessJpeg: "lossless"
        }
    }

    /** Values from a newer or older build fall back to the defaults (decoded from UserDefaults JSON). */
    public func validated() -> PackSettings {
        var s = self
        if !Self.maxSizes.contains(s.maxSize) { s.maxSize = 4000 }
        s.filesAtOnce = min(Self.maxFilesAtOnce, max(0, s.filesAtOnce))
        return s
    }
}

/**
 * Files to pack at once when the setting is Auto: a third of the cores (each file's encoder uses several), one on
 * machines under 8 GB (a 50 MP photo needs up to 1 GB), at most 3.
 */
public func autoFilesAtOnce(cores: Int = ProcessInfo.processInfo.activeProcessorCount,
                            memoryGb: Double = Double(ProcessInfo.processInfo.physicalMemory) / 1_073_741_824) -> Int {
    if memoryGb < 8 { return 1 }
    return max(1, min(3, cores / 3))
}

/** Threads for each file's encoder: the cores shared between the files packed at once. */
public func threadsPerFile(_ filesAtOnce: Int, cores: Int = ProcessInfo.processInfo.activeProcessorCount) -> Int {
    max(1, min(6, cores / max(1, filesAtOnce)))
}

/** What a file is, and what packing it did (rawboy::PackInfo). */
public struct PackInfo: Equatable, Sendable {
    public var make = "", model = "", lens = "", format = ""
    public var width = 0, height = 0
    public var dng = false
    /** The source holds raw CFA data (false: linear, e.g. iPhone ProRAW). */
    public var mosaic = true
    /** 2x2 CFA (false: X-Trans and others). */
    public var bayer = true
    /** "Sony", "Fujifilm" (corrections in the file) or "" (none). */
    public var lensData = ""
    public var lensDistortion = false, lensVignetting = false, lensCa = false
    /** Adobe's BaselineSharpness/Exposure known for this camera. */
    public var adobeHints = false
    public var bits = 0
    public var compression = "", dngVersion = ""
    // After packing:
    public var modeUsed: PackFormat = .small
    public var linear = false
    public var lensWritten = false
    public var preview = ""
    public var outWidth = 0, outHeight = 0
    public var seconds = 0.0

    public init() {}
}

// MARK: - Which apps open the output

public enum PackSupport: String, Sendable { case yes, no, likely, untested }

public struct AppSupport: Equatable, Sendable {
    public let app: String
    public let support: PackSupport
    public let note: String
}

public enum PackerInfo {
    private static let apps = ["RawBoy", "Lightroom", "Apple Photos", "Capture One", "darktable"]

    private static let table: [PackFormat: [(PackSupport, String)]] = [
        .small: [
            (.yes, "Opens and edits it as a raw."),
            (.yes, "Lightroom Classic, desktop and mobile open it as a raw (needs a current version: DNG 1.7.1)."),
            (.yes, "Photos and Preview render it as a raw."),
            (.untested, "No support for JPEG XL DNGs has been reported."),
            (.no, "Shows a purple picture: it skips a step these DNGs need (the raw data is stored scaled)."),
        ],
        .micro: [
            (.yes, "Opens and edits it (white balance and exposure stay editable)."),
            (.yes, "Opens it as a linear DNG (a 2023 or later version: DNG 1.7)."),
            (.untested, "Apple reads JPEG XL DNGs; this kind not checked yet."),
            (.untested, "No support for JPEG XL DNGs has been reported."),
            (.untested, "Not checked yet."),
        ],
        .losslessJpeg: [
            (.yes, "Opens and edits it as a raw."),
            (.yes, "Opens it as a raw, any version since 2012."),
            (.yes, "Photos and Preview render it as a raw."),
            (.likely, "Classic DNG compression that raw developers have read for years; not checked with Capture One."),
            (.yes, "Classic DNG compression."),
        ],
        .losslessJxl: [
            (.yes, "Opens and edits it as a raw."),
            (.yes, "Opens it as a raw (a 2023 or later version: DNG 1.7)."),
            (.no, "Shows a black picture (only the preview is visible)."),
            (.untested, "No support for JPEG XL DNGs has been reported."),
            (.untested, "Not checked yet."),
        ],
    ]

    /** Which apps open a file packed as [format] (web's appSupport). */
    public static func appSupport(_ format: PackFormat) -> [AppSupport] {
        zip(apps, table[format] ?? []).map { AppSupport(app: $0.0, support: $0.1.0, note: $0.1.1) }
    }

    // MARK: The summary

    /** A run of text, bold when it matters most. */
    public struct Span: Equatable, Sendable {
        public let text: String
        public let bold: Bool
    }

    public typealias Line = [Span]

    private static func b(_ text: String) -> Span { Span(text: text, bold: true) }
    private static func t(_ text: String) -> Span { Span(text: text, bold: false) }

    /** Size of the output against the camera's raw, measured at each quality (A7 III, GFX 50R, E-PL9). */
    private static let smallSize: [PackQuality: String] = [.archive: "40–65%", .high: "25–50%", .good: "10–25%", .compact: "5–15%"]
    private static let qualityText: [PackQuality: String] = [
        .archive: "measurably different from the camera raw only in pixel peeping at extreme edits",
        .high: "looks the same as the camera raw on correctly exposed photos",
        .good: "looks the same at normal edits; pushing shadows by several stops shows smoothed, slightly blocky noise",
        .compact: "shows smoothed detail at 100% and breaks up under strong edits",
    ]

    private static func plural(_ n: Int, _ one: String, _ many: String? = nil) -> String {
        "\(n) \(n == 1 ? one : (many ?? one + "s"))"
    }

    /**
     * What packing with [s] does, as lines for the summary panel; [files] are the inspected files (may be empty), so the
     * lines can name what applies to them (lens data present or lost, X-Trans, DNG sources).
     */
    public static func summarize(_ s: PackSettings, _ files: [PackInfo]) -> [Line] {
        var lines: [Line] = []
        let q = s.quality
        switch s.format {
        case .small:
            lines.append([
                b("Raw data, lossy JPEG XL. "),
                t("Every photosite is kept, so white balance, highlight recovery and demosaicing stay as editable as in the camera raw. At "),
                t("\(q.label) quality it "),
                b(qualityText[q] ?? ""),
                t(". "),
                b("About \(smallSize[q] ?? "") of the camera raw's size."),
            ])
        case .micro:
            lines.append([
                b("Demosaiced and resized to \(s.maxSize) px"),
                t(" on the long side, lossy JPEG XL (a linear DNG). White balance and exposure stay editable, but "),
                b("the raw data itself is gone"),
                t(": demosaicing, noise reduction and sharpening start from the resized image. At "),
                t("\(q.label) quality it \(qualityText[q] ?? ""). "),
                b(s.maxSize <= 3000 ? "About 5–15% of the camera raw." : "About 8–20% of the camera raw."),
            ])
        case .losslessJpeg:
            lines.append([
                b("Bit-exact: "),
                t("the raw data is identical to the camera's, in classic lossless JPEG (DNG 1.4) that "),
                b("every raw developer reads"),
                t(". "),
                b("70–100% of compressed camera raws"),
                t(" (much smaller than uncompressed ones; Fujifilm compressed RAFs come out a little larger)."),
            ])
        case .losslessJxl:
            lines.append([
                b("Bit-exact "),
                t("raw data in lossless JPEG XL: "),
                b("40–100% of the camera raw"),
                t(", but "),
                b("slow"),
                t(" (about 40 s for a 50 MP photo) and "),
                b("Apple Photos shows it black"),
                t(". Lossless (classic) is the safer choice."),
            ])
        }

        let sources = files.filter { !$0.dng }
        let dngs = files.filter(\.dng)
        let notBayer = files.filter { !$0.bayer || !$0.mosaic }
        if s.format == .small && !notBayer.isEmpty {
            lines.append([
                b("\(plural(notBayer.count, "file")) can't be saved as Small raw"),
                t(" (X-Trans or already demosaiced, e.g. phone ProRAW): saved "),
                b("demosaiced at full size"),
                t(" instead, as in Micro."),
            ])
        }

        // Lens corrections.
        let withLens = sources.filter { !$0.lensData.isEmpty }
        let withoutLens = sources.filter { $0.lensData.isEmpty }
        if !s.lensCorrections {
            lines.append([
                b("Lens corrections are dropped. "),
                t("Lightroom applies its own lens profile only when it has one for the lens; RawBoy shows the photo uncorrected."),
            ])
        } else {
            let whereText = s.format == .micro
                ? "applied to the pixels (they can't be turned off later)"
                : s.format == .small
                    ? "kept as DNG instructions that RawBoy and Lightroom apply (vignetting is applied to the raw data itself)"
                    : "kept as DNG instructions that RawBoy and Lightroom apply and can switch off"
            let corrections = !withLens.isEmpty && !sources.isEmpty ? "\(plural(withLens.count, "file")): the camera's" : "The camera's"
            lines.append([b("\(corrections) lens corrections"), t(" (Sony and Fujifilm: distortion, colour fringing, vignetting) are "), t(whereText), t(".")])
            if !withoutLens.isEmpty {
                var seen: [String] = []
                for f in withoutLens {
                    let m = "\(f.make) \(f.model)".trimmingCharacters(in: .whitespaces)
                    if !seen.contains(m) { seen.append(m) }
                }
                let models = seen.prefix(3).joined(separator: ", ")
                lines.append([
                    b("\(plural(withoutLens.count, "file")) without lens corrections in the file"),
                    t(" (\(models); adapted and manual lenses store none): Lightroom uses its own lens profile when it knows the lens."),
                ])
            }
            if !dngs.isEmpty { lines.append([t("\(plural(dngs.count, "DNG")): "), t("the DNG's own lens corrections are carried over.")]) }
        }

        let noHints = sources.filter { !$0.adobeHints }
        if !noHints.isEmpty {
            var seen: [String] = []
            for f in noHints {
                let m = "\(f.make) \(f.model)".trimmingCharacters(in: .whitespaces)
                if !seen.contains(m) { seen.append(m) }
            }
            lines.append([
                t("\(seen.prefix(3).joined(separator: ", ")): "),
                t("Adobe's default sharpening and exposure for this camera aren't known to the Packer, so "),
                b("Lightroom may open it a little softer and darker"),
                t(" than its own DNG (raise Sharpening to match)."),
            ])
        }

        lines.append(s.preview == .none
            ? [b("No preview: "), t("Finder, Explorer and photo browsers show no thumbnail until an app renders the raw.")]
            : [t("Preview: the camera's own JPEG when the file has one, else a "), t("\(s.preview.pixels) px render.")])
        if !s.keepGps { lines.append([b("Location removed"), t(" (GPS tags).")]) }
        lines.append([
            t("The original files are "),
            b("not changed or deleted"),
            t(s.filesAtOnce > 1 ? ". \(s.filesAtOnce) files at once: each 50 MP photo needs up to 1 GB of memory." : "."),
        ])
        return lines
    }

    // MARK: Names and the run's message

    /**
     * The output's file name: the source's name with .dng; DNG sources get "-packed" so nothing is overwritten. With a
     * suffix (the settings) that replaces "-packed": the name already differs from the source's.
     */
    public static func outputName(_ source: String, counter: Int = 0, suffix: String = "") -> String {
        let ns = source as NSString
        let ext = ns.pathExtension
        let base = ext.isEmpty ? source : ns.deletingPathExtension
        let isDng = ext.lowercased() == "dng"
        let tag = !suffix.isEmpty ? "-\(suffix)" : isDng ? "-packed" : ""
        return "\(base)\(tag)\(counter > 0 ? "-\(counter)" : "").dng"
    }

    /** What a finished run did, for the "packing finished" message. */
    public struct Run: Equatable, Sendable {
        public var done = 0, failed = 0
        /** Stopped before every file was packed. */
        public var stopped = false
        /** Sizes of the packed files' sources and outputs. */
        public var before = 0, after = 0

        public init(done: Int = 0, failed: Int = 0, stopped: Bool = false, before: Int = 0, after: Int = 0) {
            self.done = done
            self.failed = failed
            self.stopped = stopped
            self.before = before
            self.after = after
        }
    }

    public static func runMessage(_ r: Run) -> (title: String, body: String) {
        let title = r.stopped ? "Packing stopped" : r.failed > 0 && r.done == 0 ? "Packing failed" : "Packing finished"
        var parts: [String] = []
        if r.done > 0 {
            let pct = r.before > 0 ? Int((Double(r.after) / Double(r.before) * 100).rounded()) : 0
            parts.append("\(plural(r.done, "file")) packed: \(String(format: "%.0f", Double(r.before) / 1e6)) MB → \(String(format: "%.0f", Double(r.after) / 1e6)) MB (\(pct)%).")
        }
        if r.failed > 0 { parts.append("\(plural(r.failed, "file")) failed.") }
        if r.done == 0 && r.failed == 0 { parts.append("No files were packed.") }
        return (title, parts.joined(separator: " "))
    }

    /**
     * Groups the list by the folder each file came from, folders in the order they first appear, and orders each folder
     * by [sort] (shoot date, those without one last by name; or file name). Web's `groupByFolder`.
     */
    public static func groupByFolder<T>(_ items: [T], sort: PhotoSort, folder: (T) -> String?, date: (T) -> String?,
                                        name: (T) -> String) -> [(folder: String?, items: [T])] {
        var order: [String?] = []
        var map: [String?: [T]] = [:]
        for item in items {
            let key = folder(item)
            if map[key] == nil { order.append(key) }
            map[key, default: []].append(item)
        }
        return order.map { key in
            (key, (map[key] ?? []).sorted { PhotoOrder.inOrder(sort, (date($0), name($0)), (date($1), name($1))) })
        }
    }

    /** How a collapsed folder's line reads its files' progress. */
    public enum FolderStatusKind: Equatable, Sendable { case busy, error, done }

    /**
     * A collapsed folder's progress ("2 packing… · 1 done", "1 failed", "all done", "3 of 5 done"), nil while nothing
     * has started. Web's `folderStatusSummary`.
     */
    public static func folderStatus(total: Int, packing: Int, done: Int, failed: Int) -> (text: String, kind: FolderStatusKind)? {
        guard total > 0 else { return nil }
        if packing > 0 {
            var parts = ["\(packing) packing…"]
            if done > 0 { parts.append("\(done) done") }
            if failed > 0 { parts.append("\(failed) failed") }
            return (parts.joined(separator: " · "), .busy)
        }
        if failed > 0 {
            var parts = ["\(failed) failed"]
            if done > 0 { parts.append("\(done) done") }
            return (parts.joined(separator: " · "), .error)
        }
        if done == total { return ("all done", .done) }
        if done > 0 { return ("\(done) of \(total) done", .done) }
        return nil
    }
}
