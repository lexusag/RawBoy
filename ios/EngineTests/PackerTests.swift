#if os(macOS)
import ImageIO
import XCTest
@testable import RawBoyEngine

/**
 * The Packer on real files (skipped without them): every format over a few raws, the outputs read back by RawBoy's own
 * decoder and by ImageIO, sizes and timings printed. `RAWBOY_PACK_REF=<web.json>` (the web's WASM Packer on the same files,
 * see the PACKTEST lines) checks the sizes against the web's within 5%. Files: `.raw/` and `~/_claude/photos` DNGs, or
 * `RAWBOY_PACK_FILES=a:b`.
 */
final class PackerTests: XCTestCase {
    private func files() -> [URL] {
        if let list = ProcessInfo.processInfo.environment["RAWBOY_PACK_FILES"] { return list.split(separator: ":").map { URL(fileURLWithPath: String($0)) } }
        let repo = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        let dirs = [repo.appendingPathComponent(".raw"), URL(fileURLWithPath: NSHomeDirectory() + "/_claude/photos")]
        var out: [URL] = []
        for d in dirs {
            let names = ((try? FileManager.default.contentsOfDirectory(atPath: d.path)) ?? []).filter { $0.lowercased().hasSuffix(".dng") && !$0.contains("-camera") }.sorted()
            out += names.prefix(2).map { d.appendingPathComponent($0) }
        }
        return out
    }

    func testAvailableAndInspects() throws {
        XCTAssertTrue(Packer.available)
        guard let file = files().first else { throw XCTSkip("no test files") }
        let info = try Packer.inspect(file)
        XCTAssertTrue(info.dng)
        XCTAssertGreaterThan(info.width, 100)
        XCTAssertFalse((info.make + info.model).isEmpty)
        print("PACKTEST inspect \(file.lastPathComponent): \(info.make) \(info.model) \(info.width)x\(info.height) \(info.compression) \(info.dngVersion) bits \(info.bits) bayer \(info.bayer) mosaic \(info.mosaic)")
        XCTAssertThrowsError(try Packer.inspect(URL(fileURLWithPath: #filePath)))  // a Swift file isn't a raw
    }

    func testEveryFormatPacksAndReadsBack() throws {
        let sources = files()
        if sources.isEmpty { throw XCTSkip("no test files") }
        let out = FileManager.default.temporaryDirectory.appendingPathComponent("rawboy-packer-\(UUID().uuidString.prefix(6))", isDirectory: true)
        try FileManager.default.createDirectory(at: out, withIntermediateDirectories: true)
        var reference: [[String: Any]] = []
        if let path = ProcessInfo.processInfo.environment["RAWBOY_PACK_REF"],
           let data = try? Data(contentsOf: URL(fileURLWithPath: path)),
           let json = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]] { reference = json }
        let formats: [(String, PackFormat)] = [("small", .small), ("lossless", .losslessJpeg), ("micro2048", .micro), ("losslessjxl", .losslessJxl)]
        for source in sources {
            let original = try RawImage.open(url: source)
            let originalWidth = original.width, originalHeight = original.height
            let originalMean = Self.mean(original.createPreview(maxDimension: 256))
            original.close()
            let sourceIsDng = source.pathExtension.lowercased() == "dng"
            let sourceSize = (try FileManager.default.attributesOfItem(atPath: source.path)[.size] as? Int) ?? 0
            for (tag, format) in formats {
                var s = PackSettings()
                s.format = format
                s.maxSize = 2048
                let dest = out.appendingPathComponent("\(source.deletingPathExtension().lastPathComponent).\(tag).dng")
                let t = Date()
                let packed = try Packer.pack(source, to: dest, settings: s, threads: 4)
                let ms = Int(Date().timeIntervalSince(t) * 1000)
                let size = (try FileManager.default.attributesOfItem(atPath: dest.path)[.size] as? Int) ?? 0
                // Never overwrites.
                XCTAssertThrowsError(try Packer.pack(source, to: dest, settings: s, threads: 4))
                // Read back by RawBoy's decoder: the same picture (exact for the bit-exact formats, close for the lossy ones).
                let back = try RawImage.open(url: dest)
                let mean = Self.mean(back.createPreview(maxDimension: 256))
                let backSize = (back.width, back.height)
                back.close()
                // And by ImageIO (what Finder and Preview use): the DNG's preview or the raw itself.
                let io = CGImageSourceCreateWithURL(dest as CFURL, nil)
                let ioImage = io.flatMap { CGImageSourceCreateThumbnailAtIndex($0, 0, [kCGImageSourceCreateThumbnailFromImageAlways: true, kCGImageSourceThumbnailMaxPixelSize: 256] as CFDictionary) }
                print("PACKTEST \(source.lastPathComponent) \(tag): \(sourceSize) -> \(size) bytes (\(size * 100 / max(sourceSize, 1))%), \(ms) ms, \(packed.outWidth)x\(packed.outHeight) \(packed.modeUsed) preview \(packed.preview) linear \(packed.linear), decoded \(backSize.0)x\(backSize.1), mean \(mean) vs \(originalMean), ImageIO \(ioImage.map { "\($0.width)x\($0.height)" } ?? "NO")")
                XCTAssertNotNil(ioImage, "ImageIO couldn't open \(dest.lastPathComponent)")
                // The web's output for the same file and settings (RAWBOY_PACK_WEBOUT=<its out/ folder>) decodes to the same picture.
                var webDecoded: (Int, Int, [Float])?
                if let webDir = ProcessInfo.processInfo.environment["RAWBOY_PACK_WEBOUT"] {
                    let webFile = URL(fileURLWithPath: webDir).appendingPathComponent("\(source.lastPathComponent).\(tag).dng")
                    if let w = try? RawImage.open(url: webFile) {
                        webDecoded = (w.width, w.height, Self.mean(w.createPreview(maxDimension: 256)))
                        w.close()
                    }
                }
                if let web = webDecoded {
                    XCTAssertEqual(backSize.0, web.0, "\(tag) width against the web's")
                    XCTAssertEqual(backSize.1, web.1, "\(tag) height against the web's")
                    for c in 0..<3 { XCTAssertEqual(mean[c], web.2[c], accuracy: max(web.2[c] * 0.002, 1e-5), "\(tag) channel \(c) against the web's") }
                    print("PACKTEST   decodes like the web's: \(backSize.0)x\(backSize.1), mean \(mean) vs \(web.2)")
                }
                // The picture: bit-exact formats from a camera raw come back as it was; from a lossy DNG, or lossy formats, close.
                // (A lossless DNG 1.4 of a DNG source keeps the sensor's full area, a few pixels more: the web's does too.)
                XCTAssertEqual(Double(max(backSize.0, backSize.1)), Double(tag == "micro2048" ? 2048 : max(originalWidth, originalHeight)), accuracy: 32, "\(tag) size")
                XCTAssertEqual(Double(backSize.0) / Double(backSize.1), Double(originalWidth) / Double(originalHeight), accuracy: 0.01, "aspect")
                // (Not for Lossless from a lossy DNG: Lossless writes the lossy file's decoded raw data, which a plain decoder
                // renders a little differently from the source's own opcodes; the comparison with the web's output covers it.)
                for c in 0..<3 where !(tag == "lossless" && sourceIsDng) {
                    XCTAssertEqual(mean[c], originalMean[c], accuracy: max(originalMean[c] * 0.04, 1e-4), "\(tag) channel \(c)")
                }
                if let ref = reference.first(where: { $0["name"] as? String == source.lastPathComponent && $0["tag"] as? String == tag }),
                   let webOut = ref["out"] as? Int {
                    let ratio = Double(size) / Double(webOut)
                    print("PACKTEST   vs web: \(size) / \(webOut) = \(String(format: "%.3f", ratio))")
                    XCTAssertEqual(ratio, 1, accuracy: 0.05, "\(source.lastPathComponent) \(tag) size against the web's")
                }
            }
        }
        try? FileManager.default.removeItem(at: out)
    }

    private static func mean(_ p: PreviewImage) -> [Float] {
        var sum = [Double](repeating: 0, count: 3)
        let n = p.width * p.height
        for i in 0..<n { for c in 0..<3 { sum[c] += Double(Float16(bitPattern: p.pixels[i * 3 + c])) } }
        return sum.map { Float($0 / Double(n)) }
    }
}
#endif
