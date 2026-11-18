import XCTest
@testable import RawBoyEngine

/** The healing brush's disks through the native engine, on a real raw from `.raw/` (skipped without one). */
final class HealBrushTests: XCTestCase {
    func testStrokeChangesOnlyItsNeighbourhoodAndEmptyingItRestoresThePhoto() throws {
        let dir = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
            .deletingLastPathComponent().appendingPathComponent(".raw")
        let files = ((try? FileManager.default.contentsOfDirectory(at: dir, includingPropertiesForKeys: nil)) ?? [])
            .filter { !$0.hasDirectoryPath && !$0.lastPathComponent.hasPrefix(".") }.sorted { $0.path < $1.path }
        guard let file = files.first else { throw XCTSkip("no test file in \(dir.path)") }
        let image = try RawImage.open(url: file)
        defer { image.close() }
        let before = image.createPreview(maxDimension: 1024)

        // A stroke across the middle, three disks wide: with the engine's own source, then with a chosen one.
        var stroke = HealSpot(x: 0.5, y: 0.5, radius: 0.01, source: nil, feather: 80)
        stroke.path = [0.54, 0.5]
        var chosen = HealSpot(x: 0.25, y: 0.3, radius: 0.01, source: [0.3, 0.3], feather: 80)
        chosen.path = [0.28, 0.3]
        image.healBlemishes([], strokes: HealSpots.strokes([stroke, chosen], width: image.width, height: image.height))
        let after = image.createPreview(maxDimension: 1024)
        XCTAssertEqual(before.pixels.count, after.pixels.count)

        func changed(_ x0: Double, _ y0: Double, _ x1: Double, _ y1: Double) -> Int {
            var n = 0
            for y in Int(y0 * Double(before.height))..<Int(y1 * Double(before.height)) {
                for x in Int(x0 * Double(before.width))..<Int(x1 * Double(before.width)) {
                    let i = (y * before.width + x) * 3
                    if before.pixels[i] != after.pixels[i] || before.pixels[i + 1] != after.pixels[i + 1] || before.pixels[i + 2] != after.pixels[i + 2] { n += 1 }
                }
            }
            return n
        }
        // Healing happened where painted (the Sony frame is detailed: a clone of other texture changes pixels) and nowhere far from it.
        XCTAssertGreaterThan(changed(0.47, 0.46, 0.57, 0.54), 0)
        XCTAssertGreaterThan(changed(0.23, 0.26, 0.31, 0.34), 0)
        XCTAssertEqual(changed(0.0, 0.0, 0.15, 0.15), 0)
        XCTAssertEqual(changed(0.8, 0.8, 1.0, 1.0), 0)

        // No strokes again: the original pixels are back (healing is undoable).
        image.healBlemishes([], strokes: [])
        XCTAssertEqual(image.createPreview(maxDimension: 1024).pixels, before.pixels)
    }
}

/** A photo closed while a background task still works on it (Auto's quick photo changes) must not trap. */
final class ClosedImageTests: XCTestCase {
    func testClosedImageDoesNotTrap() throws {
        let dir = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
            .deletingLastPathComponent().appendingPathComponent(".raw")
        let files = ((try? FileManager.default.contentsOfDirectory(at: dir, includingPropertiesForKeys: nil)) ?? [])
            .filter { !$0.hasDirectoryPath && !$0.lastPathComponent.hasPrefix(".") }.sorted { $0.path < $1.path }
        guard let file = files.first else { throw XCTSkip("no test file in \(dir.path)") }
        let image = try RawImage.open(url: file)
        image.close()
        image.healBlemishes([], strokes: [])
        let preview = image.createPreview(maxDimension: 256)
        XCTAssertEqual(preview.pixels.count, preview.width * preview.height * 3)
        XCTAssertEqual(image.measureNoise().luma, 0)
    }
}
