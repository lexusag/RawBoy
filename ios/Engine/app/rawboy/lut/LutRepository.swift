import Foundation
import ImageIO

/**
 * Finds LUTs: bundled ones in the engine's `luts` resource folder (copied from <repo>/luts), and the user's own
 * in the app's Documents/LUTs folder, which the Files app shows (UIFileSharingEnabled), so LUTs can be dropped in
 * from anywhere. (Android asks for a folder grant instead.) On the Mac it is Application Support/RawBoy Desktop/LUTs
 * unless the user chose a folder of their own (`setUserFolder`, remembered); the panel names it, reveals it in Finder,
 * and copies picked or dropped files into it (`importFiles`).
 */
public enum LutRepository {
    private static let assetDir = "luts"
    private static let userDirName = "LUTs"
    private static let assetPrefix = "asset:"
    private static let filePrefix = "file:"
    private static let extensions: Set<String> = ["cube", "png"]

    private final class BundleToken {}
    public static var resourceBundle: Bundle { Bundle(for: BundleToken.self) }

    /** Documents/LUTs (macOS: the chosen folder, else Application Support/RawBoy Desktop/LUTs), created on first use. */
    public static var userFolder: URL {
        #if os(macOS)
        if let custom = customFolder { return custom }
        #endif
        return defaultUserFolder
    }

    /** The app's own LUT folder, created on first use. */
    public static var defaultUserFolder: URL {
        #if os(macOS)
        // RawBoy Desktop isn't sandboxed: a folder in ~/Documents would trigger a permission prompt, so it lives in Application Support.
        let docs = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("RawBoy Desktop", isDirectory: true)
        #else
        let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        #endif
        let dir = docs.appendingPathComponent(userDirName, isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }

    #if os(macOS)
    private static let folderKey = "luts.folder"

    /** The folder the user chose (Mac only), while it still exists; nil = the app's own. */
    public static var customFolder: URL? {
        guard let path = UserDefaults.standard.string(forKey: folderKey) else { return nil }
        var isDir: ObjCBool = false
        guard FileManager.default.fileExists(atPath: path, isDirectory: &isDir), isDir.boolValue else { return nil }
        return URL(fileURLWithPath: path, isDirectory: true)
    }

    /**
     * Reads the user's LUTs from [folder] from now on (nil = back to the app's own). LUTs are kept by file name, so a
     * photo whose LUT isn't in the new folder opens without it, as when a file is removed.
     */
    public static func setUserFolder(_ folder: URL?) {
        if let folder {
            UserDefaults.standard.set(folder.standardizedFileURL.path, forKey: folderKey)
        } else {
            UserDefaults.standard.removeObject(forKey: folderKey)
        }
    }
    #endif

    /** True for a file the LUT list takes by its name: `.cube` or `.png` (HaldCLUT). */
    public static func isLutFile(_ url: URL) -> Bool {
        extensions.contains(url.pathExtension.lowercased())
    }

    /**
     * True for a file that is surely a LUT, not a photo: a `.cube`, or a square `.png` whose side is a whole cube
     * (a HaldCLUT of level L is L³ pixels a side: 512 for level 8, 4096 for 16). Used where a dropped PNG could be either.
     */
    public static func isSurelyLut(_ url: URL) -> Bool {
        switch url.pathExtension.lowercased() {
        case "cube": return true
        case "png":
            guard let source = CGImageSourceCreateWithURL(url as CFURL, nil),
                  let props = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
                  let w = props[kCGImagePropertyPixelWidth] as? Int, let h = props[kCGImagePropertyPixelHeight] as? Int,
                  w == h, w >= 8 else { return false }
            let level = Int(pow(Double(w), 1.0 / 3.0).rounded())  // side = level³
            return (level - 1...level + 1).contains { $0 * $0 * $0 == w }
        default: return false
        }
    }

    /**
     * Copies the LUT files among [urls] into the user's folder (a file of the same name is replaced; one already in the
     * folder is left as it is). Returns how many are there now; other files are skipped.
     */
    @discardableResult
    public static func importFiles(_ urls: [URL]) -> Int {
        let folder = userFolder.standardizedFileURL
        let fm = FileManager.default
        var added = 0
        for url in urls where isLutFile(url) && !url.hasDirectoryPath {
            let target = folder.appendingPathComponent(url.lastPathComponent)
            if url.standardizedFileURL.deletingLastPathComponent().path == folder.path {
                added += 1
                continue
            }
            let scoped = url.startAccessingSecurityScopedResource()
            defer { if scoped { url.stopAccessingSecurityScopedResource() } }
            do {
                if fm.fileExists(atPath: target.path) { try fm.removeItem(at: target) }
                try fm.copyItem(at: url, to: target)
                added += 1
            } catch {
                continue
            }
        }
        return added
    }

    public static func library() -> LutLibrary {
        LutLibrary(bundled: bundled(), user: scanUserFolder(), userFolderGranted: true, folder: userFolder)
    }

    public static func open(_ id: String) throws -> Data {
        let url: URL
        if id.hasPrefix(assetPrefix) {
            guard let base = resourceBundle.resourceURL else { throw LutError(message: "No bundled LUTs") }
            url = base.appendingPathComponent(String(RetiredLooks.lut(id).dropFirst(assetPrefix.count)))
        } else if id.hasPrefix(filePrefix) {
            url = userFolder.appendingPathComponent(String(id.dropFirst(filePrefix.count)))
        } else {
            throw LutError(message: "Unknown LUT \(id)")
        }
        do {
            return try Data(contentsOf: url)
        } catch {
            throw LutError(message: "Cannot open LUT")
        }
    }

    private static func bundled() -> [LutEntry] {
        guard let dir = resourceBundle.resourceURL?.appendingPathComponent(assetDir),
              let names = try? FileManager.default.contentsOfDirectory(atPath: dir.path) else { return [] }
        return names
            .filter { extensions.contains(($0 as NSString).pathExtension.lowercased()) }
            .map { LutEntry(id: assetPrefix + "\(assetDir)/\($0)", name: displayName($0), bundled: true) }
            .sorted { $0.name.lowercased() < $1.name.lowercased() }
    }

    private static func scanUserFolder() -> [LutEntry] {
        guard let names = try? FileManager.default.contentsOfDirectory(atPath: userFolder.path) else { return [] }
        return names
            .filter { extensions.contains(($0 as NSString).pathExtension.lowercased()) }
            .map { LutEntry(id: filePrefix + $0, name: displayName($0), bundled: false) }
            .sorted { $0.name.lowercased() < $1.name.lowercased() }
    }

    private static func displayName(_ fileName: String) -> String {
        (fileName as NSString).deletingPathExtension.trimmingCharacters(in: .whitespaces)
    }
}
