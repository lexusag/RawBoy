import CoreGraphics
import ImageIO
import XCTest
import ViewerImaging
@testable import RawBoyEngine

/** Browse mode's real preview (`Desktop/EngineRealPreview.swift`, compiled into this bundle): the engine's as-shot develop. */
final class EngineRealPreviewTests: XCTestCase {
    private static let raw = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
        .deletingLastPathComponent().appendingPathComponent(".raw/DSC02273-compressed.dng")

    private func rawURL() throws -> URL {
        try XCTSkipUnless(FileManager.default.fileExists(atPath: Self.raw.path), "no .raw test file")
        return Self.raw
    }

    /** [image] as 8-bit sRGB RGBA, row by row. */
    private func pixels(_ image: CGImage) -> [UInt8] {
        var data = [UInt8](repeating: 0, count: image.width * image.height * 4)
        data.withUnsafeMutableBytes { buffer in
            let context = CGContext(data: buffer.baseAddress, width: image.width, height: image.height, bitsPerComponent: 8,
                                    bytesPerRow: image.width * 4, space: CGColorSpace(name: CGColorSpace.sRGB)!,
                                    bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
            context.draw(image, in: CGRect(x: 0, y: 0, width: image.width, height: image.height))
        }
        return data
    }

    func testReturnsTheRequestedSizeAndIsNotFullResolution() throws {
        let url = try rawURL()
        let small = try XCTUnwrap(EngineRealPreview().develop(url, maxPixelSize: 1200, orientation: nil))
        XCTAssertEqual(max(small.cgImage.width, small.cgImage.height), 1200)
        XCTAssertEqual(Double(small.cgImage.width) / Double(small.cgImage.height), 6000.0 / 4000.0, accuracy: 0.01)
        XCTAssertFalse(small.isFullResolution)
        XCTAssertEqual(small.fullSize.width, 6000)
        XCTAssertEqual(small.fullSize.height, 4000)
        // 8-bit BGRA in a colour space of its own, as ViewerImaging's other images are.
        XCTAssertEqual(small.cgImage.bitsPerComponent, 8)
        let full = try XCTUnwrap(EngineRealPreview().develop(url, maxPixelSize: nil, orientation: nil))
        XCTAssertEqual(full.cgImage.width, 6000)
        XCTAssertTrue(full.isFullResolution)
    }

    /** The photo as Pro opens it, developed through a `PhotoSession` and exported at the same size, matches. */
    @MainActor
    func testMatchesTheEnginesOwnAsShotDevelop() async throws {
        let url = try rawURL()
        let ours = try XCTUnwrap(EngineRealPreview().develop(url, maxPixelSize: 1200, orientation: nil)).cgImage
        let session = PhotoSession(onMessage: { _ in })
        let opened = try await session.open(url) { $0 }
        defer { session.close() }
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("engine-real-preview-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: dir) }
        let file = try await session.export(opened.params, defaults: opened.defaults, sourceName: "ref.dng",
                                            settings: ExportSettings(format: .tiff, tiffBits: 8, maxLongSide: 1200),
                                            directory: dir, onProgress: { _ in })
        let source = try XCTUnwrap(CGImageSourceCreateWithURL(file as CFURL, nil))
        let reference = try XCTUnwrap(CGImageSourceCreateImageAtIndex(source, 0, nil))
        XCTAssertEqual(ours.width, reference.width)
        XCTAssertEqual(ours.height, reference.height)
        let a = pixels(ours), b = pixels(reference)
        var total = 0, worst = 0
        for i in stride(from: 0, to: a.count, by: 4) {
            for c in 0..<3 {
                let d = abs(Int(a[i + c]) - Int(b[i + c]))
                total += d
                worst = max(worst, d)
            }
        }
        let mean = Double(total) / Double(a.count / 4 * 3)
        print("engine real preview vs session export: mean |diff| \(mean) /255, worst \(worst)")
        XCTAssertLessThan(mean, 1.0)
        XCTAssertLessThan(worst, 12)
    }

    func testASidecarOrientationIsAppliedOnce() throws {
        let url = try rawURL()
        let plain = try XCTUnwrap(EngineRealPreview().develop(url, maxPixelSize: 600, orientation: nil))
        let turned = try XCTUnwrap(EngineRealPreview().develop(url, maxPixelSize: 600, orientation: 6))
        XCTAssertEqual(plain.cgImage.width, turned.cgImage.height)
        XCTAssertEqual(plain.cgImage.height, turned.cgImage.width)
        XCTAssertEqual(turned.fullSize.width, 4000)
        XCTAssertEqual(turned.fullSize.height, 6000)
    }

    private final class Recording: RealPreviewProvider, @unchecked Sendable {
        nonisolated(unsafe) var urls: [String] = []
        func develop(_ url: URL, maxPixelSize: Int?, orientation: Int?) -> LoadedImage? {
            urls.append(url.lastPathComponent)
            let context = CGContext(data: nil, width: 2, height: 1, bitsPerComponent: 8, bytesPerRow: 0,
                                    space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedFirst.rawValue)!
            return LoadedImage(cgImage: context.makeImage()!, fullSize: .init(width: 2, height: 1), isFullResolution: false)
        }
    }

    func testWhatTheEngineCannotDevelopGoesToTheFallback() throws {
        let fallback = Recording()
        let provider = EngineRealPreview(fallback: fallback)
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("engine-real-preview-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: dir) }
        // Not a raw: straight to the fallback, whatever it holds.
        let jpeg = dir.appendingPathComponent("a.jpg")
        try Data("x".utf8).write(to: jpeg)
        XCTAssertNotNil(provider.develop(jpeg, maxPixelSize: 100, orientation: nil))
        // A raw the engine refuses: the fallback gets it too.
        let broken = dir.appendingPathComponent("b.dng")
        try Data("not a dng".utf8).write(to: broken)
        XCTAssertNotNil(provider.develop(broken, maxPixelSize: 100, orientation: nil))
        XCTAssertEqual(fallback.urls, ["a.jpg", "b.dng"])
    }

    /**
     * RAWBOY_PREVIEW_TIMING=<comma-separated raw files> [RAWBOY_PREVIEW_SIZE=3440]: how long R takes, the engine against Core
     * Image: the first request of each (cold: pipelines, caches) and the next three of the same photo (warm). Prints only.
     */
    func testTimings() throws {
        let list = ProcessInfo.processInfo.environment["RAWBOY_PREVIEW_TIMING"]
        try XCTSkipUnless(list != nil, "set RAWBOY_PREVIEW_TIMING")
        let files = list!.split(separator: ",")
        let size = ProcessInfo.processInfo.environment["RAWBOY_PREVIEW_SIZE"].flatMap(Int.init) ?? 3440
        func time(_ f: () -> LoadedImage?) -> String {
            let start = Date()
            let image = f()
            return String(format: "%.2f s%@", Date().timeIntervalSince(start), image == nil ? " (nil)" : "")
        }
        for file in files {
            let url = URL(fileURLWithPath: String(file))
            let name = url.lastPathComponent
            let coreImage = CoreImageRealPreview()
            print("[timing] \(name) at \(size) px: Core Image cold", time { coreImage.develop(url, maxPixelSize: size, orientation: nil) },
                  "warm", (0..<3).map { _ in time { coreImage.develop(url, maxPixelSize: size, orientation: nil) } }.joined(separator: " "))
            let engine = EngineRealPreview(fallback: Recording())
            print("[timing] \(name) at \(size) px: engine cold", time { engine.develop(url, maxPixelSize: size, orientation: nil) },
                  "warm", (0..<3).map { _ in time { engine.develop(url, maxPixelSize: size, orientation: nil) } }.joined(separator: " "))
        }
    }
}
