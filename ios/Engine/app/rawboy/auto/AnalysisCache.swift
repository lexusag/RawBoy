import CryptoKit
import Foundation

/**
 * What Auto's analysis learns from decoding a raw (the 512 px copy, the bloom copies, lens data, ISO, noise, the as-shot
 * white and the skin mask), enough to rebuild the whole [Analysis] without decoding the file again. The develop itself
 * (SceneStats, the auto develop) is worked out again on load, so tuning it needs no [AnalysisCache.version] bump.
 */
public struct AnalysisSnapshot: @unchecked Sendable {
    public var base: PreviewImage
    public var halo: PreviewImage
    public var tail: PreviewImage
    public var lens: LensInfo
    public var iso: Float
    public var temperature: Float
    public var tint: Float
    public var displaySource: Bool
    public var clipLevel: Float
    public var cameraMetered: Bool
    public var noise: NoiseLevel
    /** nil: no skin detected (or the segmenter isn't available); [skinDone] is then still true. */
    public var skin: SkinMask?
    public var skinDone: Bool
}

/**
 * Port of the web's `AnalysisCache.ts` for RawBoy Desktop: each photo's [AnalysisSnapshot] on disk, keyed by file path,
 * size and modified time, so opening a folder again doesn't decode and analyse it again. Least recently used files go
 * once [maxBytes] is reached. Thread-safe. Bump [version] when the decode, the copies, the noise estimate or the
 * segmentation change (anything a snapshot holds; the auto develop is not part of it).
 */
public final class AnalysisCache: @unchecked Sendable {
    public static let version = 1
    /** About 300 photos (each is 2-5 MB). */
    public static let maxBytes = 1_000_000_000

    private let dir: URL
    /** For tests. */
    var dirForTests: URL { dir }
    private let maxBytes: Int
    private let lock = NSLock()

    public init(dir: URL, maxBytes: Int = AnalysisCache.maxBytes) {
        self.dir = dir
        self.maxBytes = maxBytes
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    }

    /** The app's cache folder (Library/Caches/<bundle id>/analysis). */
    public static var defaultDir: URL {
        FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
            .appendingPathComponent(Bundle.main.bundleIdentifier ?? "app.rawboy", isDirectory: true)
            .appendingPathComponent("analysis", isDirectory: true)
    }

    /** The key of [url]'s current contents: path, size and modified time, with the cache version; nil if it can't be read. */
    public func key(for url: URL) -> String? {
        // Not URL.resourceValues, which a URL object caches (a file written since would still give its old size).
        guard let attrs = try? FileManager.default.attributesOfItem(atPath: url.path),
              let size = (attrs[.size] as? NSNumber)?.int64Value, let date = attrs[.modificationDate] as? Date else { return nil }
        return "v\(Self.version)|\(url.standardizedFileURL.path)|\(size)|\(Int64(date.timeIntervalSince1970 * 1000))"
    }

    private func file(_ key: String) -> URL {
        dir.appendingPathComponent(SHA256.hash(data: Data(key.utf8)).map { String(format: "%02x", $0) }.joined() + ".analysis")
    }

    public func get(_ key: String) -> AnalysisSnapshot? {
        let url = file(key)
        guard let data = try? Data(contentsOf: url), let stored = try? PropertyListDecoder().decode(Stored.self, from: data),
              stored.key == key, let snapshot = stored.snapshot else { return nil }
        lock.lock()
        try? FileManager.default.setAttributes([.modificationDate: Date()], ofItemAtPath: url.path) // recently used
        lock.unlock()
        return snapshot
    }

    public func put(_ key: String, _ snapshot: AnalysisSnapshot) {
        let encoder = PropertyListEncoder()
        encoder.outputFormat = .binary
        guard let data = try? encoder.encode(Stored(key: key, snapshot)) else { return }
        lock.lock()
        defer { lock.unlock() }
        do { try data.write(to: file(key), options: .atomic) } catch { return } // disk full or similar: just not cached
        trim()
    }

    public func clear() {
        lock.lock()
        defer { lock.unlock() }
        try? FileManager.default.removeItem(at: dir)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    }

    /** Call with [lock] held. */
    private func trim() {
        let keys: [URLResourceKey] = [.fileSizeKey, .contentModificationDateKey]
        let files = ((try? FileManager.default.contentsOfDirectory(at: dir, includingPropertiesForKeys: keys)) ?? [])
            .compactMap { u -> (URL, Int, Date)? in
                guard let v = try? u.resourceValues(forKeys: Set(keys)) else { return nil }
                return (u, v.fileSize ?? 0, v.contentModificationDate ?? .distantPast)
            }
        var total = files.reduce(0) { $0 + $1.1 }
        for f in files.sorted(by: { $0.2 < $1.2 }) where total > maxBytes {
            try? FileManager.default.removeItem(at: f.0)
            total -= f.1
        }
    }

    // MARK: - File format (a binary property list; pixels as Data)

    private struct Image: Codable {
        let width: Int, height: Int, fullWidth: Int, fullHeight: Int
        let pixels: Data

        init(_ p: PreviewImage) {
            width = p.width; height = p.height; fullWidth = p.fullWidth; fullHeight = p.fullHeight
            pixels = p.pixels.withUnsafeBytes { Data($0) }
        }

        var image: PreviewImage? {
            guard width > 0, height > 0, pixels.count == width * height * 3 * 2 else { return nil }
            let px = pixels.withUnsafeBytes { raw in
                [UInt16](unsafeUninitializedCapacity: width * height * 3) { buf, n in
                    memcpy(buf.baseAddress!, raw.baseAddress!, pixels.count)
                    n = width * height * 3
                }
            }
            return PreviewImage(width: width, height: height, pixels: px, fullWidth: fullWidth, fullHeight: fullHeight)
        }
    }

    private struct Lens: Codable {
        let lensName: String
        let width: Int, height: Int, sensorWidth: Int, sensorHeight: Int, orientation: Int
        let warp: LensInfo.Warp?
        let vignette: LensInfo.RadialVignette?
        let shading: LensInfo.ShadingMap?
        let gainMapsApplied: Int
        let fisheye: FisheyeCircle?
    }

    private struct Skin: Codable {
        let width: Int, height: Int
        let data: Data
        let sigmaPx: Float
        let hasSkin: Bool
        let faceDiameterPx: Float
        let face: Data?
        let faces: [FaceShape]
    }

    private static func floats(_ d: Data) -> [Float] {
        d.withUnsafeBytes { raw in
            [Float](unsafeUninitializedCapacity: d.count / 4) { buf, n in
                memcpy(buf.baseAddress!, raw.baseAddress!, d.count / 4 * 4)
                n = d.count / 4
            }
        }
    }

    private struct Stored: Codable {
        let key: String
        let base: Image, halo: Image, tail: Image
        let lens: Lens
        let iso: Float, temperature: Float, tint: Float, clipLevel: Float
        let displaySource: Bool, cameraMetered: Bool
        let noiseLuma: Float, noiseChroma: Float
        let skin: Skin?
        let skinDone: Bool

        init(key: String, _ s: AnalysisSnapshot) {
            self.key = key
            base = Image(s.base); halo = Image(s.halo); tail = Image(s.tail)
            lens = Lens(lensName: s.lens.lensName, width: s.lens.width, height: s.lens.height, sensorWidth: s.lens.sensorWidth,
                        sensorHeight: s.lens.sensorHeight, orientation: s.lens.orientation, warp: s.lens.warp,
                        vignette: s.lens.vignette, shading: s.lens.shading, gainMapsApplied: s.lens.gainMapsApplied,
                        fisheye: s.lens.fisheyeCircle)
            iso = s.iso; temperature = s.temperature; tint = s.tint; clipLevel = s.clipLevel
            displaySource = s.displaySource; cameraMetered = s.cameraMetered
            noiseLuma = s.noise.luma; noiseChroma = s.noise.chroma
            skin = s.skin.map {
                Skin(width: $0.width, height: $0.height, data: $0.data.withUnsafeBytes { Data($0) }, sigmaPx: $0.sigmaPx,
                     hasSkin: $0.hasSkin, faceDiameterPx: $0.faceDiameterPx, face: $0.face.map { $0.withUnsafeBytes { Data($0) } },
                     faces: $0.faces)
            }
            skinDone = s.skinDone
        }

        var snapshot: AnalysisSnapshot? {
            guard let b = base.image, let h = halo.image, let t = tail.image else { return nil }
            let l = LensInfo(lensName: lens.lensName, width: lens.width, height: lens.height, sensorWidth: lens.sensorWidth,
                             sensorHeight: lens.sensorHeight, orientation: lens.orientation, warp: lens.warp,
                             vignette: lens.vignette, shading: lens.shading, gainMapsApplied: lens.gainMapsApplied)
            l.fisheyeCircle = lens.fisheye
            var mask: SkinMask?
            if let s = skin {
                let data = AnalysisCache.floats(s.data)
                guard data.count == s.width * s.height else { return nil }
                mask = SkinMask(width: s.width, height: s.height, data: data, sigmaPx: s.sigmaPx, hasSkin: s.hasSkin,
                                faceDiameterPx: s.faceDiameterPx, face: s.face.map(AnalysisCache.floats), faces: s.faces)
            }
            return AnalysisSnapshot(base: b, halo: h, tail: t, lens: l, iso: iso, temperature: temperature, tint: tint,
                                    displaySource: displaySource, clipLevel: clipLevel, cameraMetered: cameraMetered,
                                    noise: NoiseLevel(luma: noiseLuma, chroma: noiseChroma), skin: mask, skinDone: skinDone)
        }
    }
}
