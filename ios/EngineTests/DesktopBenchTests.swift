import XCTest
@testable import RawBoyEngine

/**
 * Timings for RawBoy Desktop's feasibility notes: decode, the preview draw RawBoy's editor repeats while a slider
 * moves (1.4 MP preview into a 2560 x 1600 view's worth of pixels), and a full-size JPEG export. Runs on the largest
 * file in `.raw/` (or RAWBOY_BENCH=<path>); prints a `bench` line.
 */
final class DesktopBenchTests: XCTestCase {
    func testBench() throws {
        let dir = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
            .deletingLastPathComponent().appendingPathComponent(".raw")
        var url: URL?
        if let path = ProcessInfo.processInfo.environment["RAWBOY_BENCH"] ?? (try? String(contentsOfFile: "/tmp/rawboy-bench-path", encoding: .utf8)) {
            url = URL(fileURLWithPath: path.trimmingCharacters(in: .whitespacesAndNewlines))
        } else {
            let files = (try? FileManager.default.contentsOfDirectory(at: dir, includingPropertiesForKeys: [.fileSizeKey])) ?? []
            url = files.filter { !$0.hasDirectoryPath }.max { (try? $0.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0 < (try? $1.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0 }
        }
        // A benchmark of a real raw: nothing to time without one (CI has no `.raw/`).
        guard let file = url else { throw XCTSkip("no test file in \(dir.path)") }

        func ms(_ since: Date) -> Int { Int(Date().timeIntervalSince(since) * 1000) }
        var t = Date()
        let image = try RawImage.open(url: file)
        defer { image.close() }
        let decode = ms(t)
        t = Date()
        let preview = image.createPreview(maxDimension: 1536)
        let previewMs = ms(t)
        let base = image.createPreview(maxDimension: 512)
        var p = RenderTests.asShotDefaults(image)
        func shader(_ p: DevelopParams) -> ShaderParams {
            ShaderParams.from(p, asShot: RenderTests.asShotDefaults(image), lut: nil,
                              lens: LensTransform(info: image.lens, params: p), base: base, bloomSources: nil, skinMask: nil)
        }
        let dev = OffscreenDeveloper(imageWidth: preview.fullWidth, imageHeight: preview.fullHeight)
        let w = 2560, h = 1600
        var out = [UInt16](repeating: 0, count: w * h * 4)
        var times: [Double] = []
        for i in 0..<25 {
            p.exposure = Float(i % 5) * 0.2
            let s = shader(p)
            let t0 = Date()
            try out.withUnsafeMutableBufferPointer {
                try dev.renderPreview(s, preview: preview, width: w, height: h, output: $0.baseAddress!)
            }
            times.append(Date().timeIntervalSince(t0) * 1000)
        }
        let frames = times.dropFirst(5).sorted()
        let dir2 = FileManager.default.temporaryDirectory.appendingPathComponent("rawboy-bench", isDirectory: true)
        try FileManager.default.createDirectory(at: dir2, withIntermediateDirectories: true)
        t = Date()
        let outFile = try Exporter().export(image, sourceName: file.lastPathComponent, params: shader(p),
                                            settings: ExportSettings(format: .jpeg, jpegQuality: 92, jpegEncoder: .jpegli),
                                            naming: OutputNaming(suffix: "bench"), directory: dir2)
        let export = ms(t)
        let size = (try? outFile.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
        print(String(format: "bench %@ %@ | decode %d ms | preview copy %d ms | frame median %.1f ms (min %.1f max %.1f) | export JPEG %d ms (%d KB)",
                     file.lastPathComponent, image.description, decode, previewMs, frames[frames.count / 2], frames.first!, frames.last!, export, size / 1024))
        try? FileManager.default.removeItem(at: dir2)
    }
}
