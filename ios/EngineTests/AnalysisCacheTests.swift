import XCTest
@testable import RawBoyEngine

final class AnalysisCacheTests: XCTestCase {
    private func tempDir() -> URL {
        let d = FileManager.default.temporaryDirectory.appendingPathComponent("analysis-cache-\(UUID().uuidString.prefix(8))")
        addTeardownBlock { try? FileManager.default.removeItem(at: d) }
        return d
    }

    private func image(_ w: Int, _ h: Int, _ seed: UInt16) -> PreviewImage {
        PreviewImage(width: w, height: h, pixels: (0..<w * h * 3).map { UInt16(truncatingIfNeeded: $0 &* 31 &+ Int(seed)) },
                     fullWidth: w * 8, fullHeight: h * 8)
    }

    private func snapshot(skin: Bool) -> AnalysisSnapshot {
        let lens = LensInfo(lensName: "Test 35mm", width: 6000, height: 4000, sensorWidth: 6000, sensorHeight: 4000, orientation: 6,
                            warp: .init(planes: 1, coefficients: [0.1, 0.2, 0.3, 0.4, 0.01, 0.02], centerX: 0.5, centerY: 0.5),
                            vignette: .init(k: [0.1, 0.2, 0.3, 0.4, 0.5], centerX: 0.5, centerY: 0.5),
                            shading: .init(pointsV: 2, pointsH: 2, originV: 0, originH: 0, spacingV: 1, spacingH: 1, gains: [1, 1.1, 1.2, 1.3]),
                            gainMapsApplied: 2)
        lens.fisheyeCircle = FisheyeCircle(offsetX: 1, offsetY: 2, radius: 3)
        let mask = SkinMask(width: 4, height: 3, data: (0..<12).map { Float($0) / 12 }, sigmaPx: 2.5, hasSkin: true, faceDiameterPx: 90,
                            face: (0..<12).map { Float($0) / 24 }, faces: [])
        return AnalysisSnapshot(base: image(8, 6, 1), halo: image(4, 3, 2), tail: image(2, 2, 3), lens: lens, iso: 640, focalLength: 35,
                                temperature: 5400, tint: -7, displaySource: false, clipLevel: 0.97, cameraMetered: true,
                                noise: NoiseLevel(luma: 0.02, chroma: 0.03), skin: skin ? mask : nil, skinDone: true)
    }

    func testRoundTripsASnapshot() throws {
        let cache = AnalysisCache(dir: tempDir())
        let s = snapshot(skin: true)
        cache.put("k1", s)
        let r = try XCTUnwrap(cache.get("k1"))
        XCTAssertEqual(r.base.pixels, s.base.pixels)
        XCTAssertEqual(r.halo.pixels, s.halo.pixels)
        XCTAssertEqual(r.tail.pixels, s.tail.pixels)
        XCTAssertEqual([r.base.fullWidth, r.base.fullHeight], [64, 48])
        XCTAssertEqual(r.lens.lensName, "Test 35mm")
        XCTAssertEqual(r.lens.orientation, 6)
        XCTAssertEqual(r.lens.warp?.coefficients, s.lens.warp?.coefficients)
        XCTAssertEqual(r.lens.vignette?.k, s.lens.vignette?.k)
        XCTAssertEqual(r.lens.shading?.gains, [1, 1.1, 1.2, 1.3])
        XCTAssertEqual(r.lens.fisheyeCircle?.radius, 3)
        XCTAssertEqual([r.iso, r.focalLength, r.temperature, r.tint, r.clipLevel], [640, 35, 5400, -7, 0.97])
        XCTAssertTrue(r.cameraMetered)
        XCTAssertEqual(r.noise, NoiseLevel(luma: 0.02, chroma: 0.03))
        XCTAssertEqual(r.skin?.data, s.skin?.data)
        XCTAssertEqual(r.skin?.face, s.skin?.face)
        XCTAssertEqual(r.skin?.sigmaPx, 2.5)
        XCTAssertTrue(r.skinDone)
        // No skin found is remembered too (nothing to detect again).
        cache.put("k2", snapshot(skin: false))
        let none = try XCTUnwrap(cache.get("k2"))
        XCTAssertNil(none.skin)
        XCTAssertTrue(none.skinDone)
        XCTAssertNil(cache.get("missing"))
    }

    func testKeyFollowsTheFile() throws {
        let dir = tempDir()
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let cache = AnalysisCache(dir: dir.appendingPathComponent("c"))
        let file = dir.appendingPathComponent("a.dng")
        try Data(count: 100).write(to: file)
        let k1 = try XCTUnwrap(cache.key(for: file))
        XCTAssertEqual(cache.key(for: file), k1)
        try Data(count: 101).write(to: file)  // size changes
        let k2 = try XCTUnwrap(cache.key(for: file))
        XCTAssertNotEqual(k2, k1)
        try FileManager.default.setAttributes([.modificationDate: Date(timeIntervalSince1970: 1_000_000)], ofItemAtPath: file.path)
        XCTAssertNotEqual(cache.key(for: file), k2)  // modified time changes
        XCTAssertNil(cache.key(for: dir.appendingPathComponent("missing.dng")))
    }

    func testDropsTheLeastRecentlyUsedPastItsLimit() {
        let one = snapshot(skin: false)
        let probe = AnalysisCache(dir: tempDir())
        probe.put("x", one)
        let size = (try? FileManager.default.contentsOfDirectory(at: probe.dirForTests, includingPropertiesForKeys: [.fileSizeKey]))?
            .compactMap { try? $0.resourceValues(forKeys: [.fileSizeKey]).fileSize }.first ?? 1
        let cache = AnalysisCache(dir: tempDir(), maxBytes: size * 5 / 2)  // room for two
        cache.put("a", one)
        Thread.sleep(forTimeInterval: 0.02)
        cache.put("b", one)
        Thread.sleep(forTimeInterval: 0.02)
        XCTAssertNotNil(cache.get("a"))  // a is used again, so b is the oldest
        Thread.sleep(forTimeInterval: 0.02)
        cache.put("c", one)
        XCTAssertNotNil(cache.get("a"))
        XCTAssertNil(cache.get("b"))
        XCTAssertNotNil(cache.get("c"))
    }

    /** A snapshot restores to the very analysis a fresh decode gives (needs a raw in `.raw/`; CI has none). */
    func testRestoreEqualsAFreshAnalysis() throws {
        guard let file = BenchFiles.first() else { throw XCTSkip("no raw file in .raw/") }
        let dir = tempDir()
        let cache = AnalysisCache(dir: dir)
        let fresh = try AutoAnalysis.analyze(file, cache: cache)  // decodes, stores
        let again = try AutoAnalysis.analyze(file, cache: cache)  // from the snapshot
        XCTAssertEqual(try FileManager.default.contentsOfDirectory(atPath: dir.path).count, 1)
        XCTAssertEqual(again.base.pixels, fresh.base.pixels)
        XCTAssertEqual(again.bloom.halo.pixels, fresh.bloom.halo.pixels)
        XCTAssertEqual(again.bloom.tail.pixels, fresh.bloom.tail.pixels)
        XCTAssertEqual(again.defaults.temperature, fresh.defaults.temperature)
        XCTAssertEqual(again.defaults.tint, fresh.defaults.tint)
        XCTAssertEqual(again.defaults.clipLevel, fresh.defaults.clipLevel)
        XCTAssertEqual(again.defaults.displaySource, fresh.defaults.displaySource)
        XCTAssertEqual(again.autoBase.exposure, fresh.autoBase.exposure)
        XCTAssertEqual(again.autoBase.highlights, fresh.autoBase.highlights)
        XCTAssertEqual(again.autoBase.shadows, fresh.autoBase.shadows)
        XCTAssertEqual(again.autoBase.contrast, fresh.autoBase.contrast)
        XCTAssertEqual(again.autoBase.denoise, fresh.autoBase.denoise)
        XCTAssertEqual(again.stats.key, fresh.stats.key)
        XCTAssertEqual(again.stats.p50, fresh.stats.p50)
        XCTAssertEqual(again.lens.lensName, fresh.lens.lensName)
        XCTAssertEqual(again.lens.warp?.coefficients, fresh.lens.warp?.coefficients)
        XCTAssertEqual(again.skin?.data, fresh.skin?.data)
    }
}

/** The raw files the tests that need one use: RAWBOY_BENCH_FILES (`:` separated) or everything in `.raw/`. */
enum BenchFiles {
    static func all() -> [URL] {
        if let list = ProcessInfo.processInfo.environment["RAWBOY_BENCH_FILES"] ?? (try? String(contentsOfFile: "/tmp/rawboy-bench-files", encoding: .utf8)) {
            return list.trimmingCharacters(in: .whitespacesAndNewlines).split(whereSeparator: { $0 == ":" || $0 == "\n" }).map { URL(fileURLWithPath: String($0)) }
        }
        let dir = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
            .appendingPathComponent(".raw")
        return ((try? FileManager.default.contentsOfDirectory(at: dir, includingPropertiesForKeys: nil)) ?? [])
            .filter { !$0.hasDirectoryPath && !$0.lastPathComponent.hasPrefix(".") }.sorted { $0.path < $1.path }
    }
    static func first() -> URL? { all().first }
}
