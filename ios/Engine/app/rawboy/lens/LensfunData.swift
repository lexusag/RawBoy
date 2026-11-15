import Foundation

/**
 * Loads the bundled Lensfun database (the engine's lensfun/ resource folder, the same files as web/public/lensfun;
 * see its README.txt): the index on first use, then the calibration file of the lens in use. Nothing is read until
 * the Lens tab's Lensfun switch is on. Web: engine/lens/LensfunData.ts (which fetches them).
 */
public actor LensfunData {
    public static let shared = LensfunData()

    private let folder: URL?
    private var loadedIndex: Lensfun.Index?
    private var chunks: [Int: Data] = [:]

    /** [folder]: where index.json and the calib files are; nil = the engine bundle's lensfun folder. */
    public init(folder: URL? = nil) {
        self.folder = folder ?? LutRepository.resourceBundle.resourceURL?.appendingPathComponent("lensfun", isDirectory: true)
    }

    private func read(_ file: String) throws -> Data {
        guard let folder else { throw Lensfun.DataError(message: "Could not load the Lensfun database") }
        do {
            return try Data(contentsOf: folder.appendingPathComponent(file))
        } catch {
            throw Lensfun.DataError(message: "Could not load the Lensfun database (\(file))")
        }
    }

    /** The cameras and lenses; a failed load is retried on the next call. */
    public func index() throws -> Lensfun.Index {
        if let loadedIndex { return loadedIndex }
        let index = try Lensfun.parseIndex(read("index.json"))
        loadedIndex = index
        return index
    }

    /** The calibration sets of [lens] (none when the database has no data for it). */
    public func calibrations(_ lens: Lensfun.Lens) throws -> [Lensfun.CalibrationSet] {
        if !lens.hasDistortion && !lens.hasTca && !lens.hasVignetting { return [] }
        let db = try index()
        guard db.chunks.indices.contains(lens.chunk) else { return [] }
        let data: Data
        if let cached = chunks[lens.chunk] {
            data = cached
        } else {
            data = try read("calib-\(db.chunks[lens.chunk]).json")
            chunks[lens.chunk] = data
        }
        return try Lensfun.calibrations(data, lensId: lens.id)
    }
}
