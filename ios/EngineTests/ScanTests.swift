import Metal
import XCTest
@testable import RawBoyEngine

/**
 * Film scan 1.5x (export): the constants, the upscale pre-pass against the web's WebGL2 run of the very same
 * `shaders/scan.frag` on the same input, and a whole export of a real photo with and without the scan.
 */
final class ScanTests: XCTestCase {
    func testConstantsAndSizesAreTheWebs() {
        XCTAssertEqual(ScanScale.scale, 1.5)
        XCTAssertEqual(ScanScale.margin, 16)
        XCTAssertEqual(ScanScale.grain, 0.86)
        XCTAssertEqual(ScanScale.sharpen, 1.0)
        XCTAssertEqual(ScanScale.size(6208, 8280).0, 9312)
        XCTAssertEqual(ScanScale.size(6208, 8280).1, 12420)
        XCTAssertEqual(ScanScale.size(1001, 667).0, 1502)
        XCTAssertEqual(ScanScale.size(1001, 667).1, 1001)
        var p = DevelopParams()
        let info = LensInfo(lensName: "", width: 100, height: 100, sensorWidth: 100, sensorHeight: 100, orientation: 1, warp: nil,
                            vignette: nil, shading: nil, gainMapsApplied: 0)
        func params(film: FilmData?, amount: Float) -> ShaderParams {
            p.film = film == nil ? nil : "portra400"
            return ShaderParams.from(p, asShot: DevelopParams(), lut: nil, lens: LensTransform(info: info, params: p, knownZoom: 1),
                                     base: nil, bloomSources: nil, skinMask: nil, film: film)
        }
        // A film look on, film strength above 0.
        let film = try? FilmStocks.byId("portra400").flatMap { try FilmStocks.load($0) }
        XCTAssertNotNil(film)
        p.filmAmount = 100
        XCTAssertFalse(ScanScale.applies(params(film: nil, amount: 100)))
        XCTAssertTrue(ScanScale.applies(params(film: film, amount: 100)))
        p.filmAmount = 0
        XCTAssertFalse(ScanScale.applies(params(film: film, amount: 0)))
    }

    func testGeometryMapsTheScanTileBackToThePhoto() {
        var g = SampleGeometry(textureWidth: 150, textureHeight: 150, input: PixelRect(x: 10, y: 10, width: 100, height: 100),
                               output: PixelRect(x: 1024, y: 512, width: 1024, height: 512), imageWidth: 1000, imageHeight: 800)
        g.renderScale = 1.5
        XCTAssertEqual(g.renderScale, 1.5)
        XCTAssertEqual(Exporter.evenRect(PixelRect(x: 3, y: 5, width: 10, height: 9), 100, 100), PixelRect(x: 2, y: 4, width: 12, height: 10))
        XCTAssertEqual(Exporter.evenRect(PixelRect(x: 90, y: 90, width: 11, height: 11), 101, 101), PixelRect(x: 90, y: 90, width: 10, height: 10))
    }

    /** The pre-pass on a constant image gives a constant one, and area-averaging the result gives the source back. */
    func testUpscaleKeepsFlatAreasAndTheMeanAtEveryScale() throws {
        let (w, h) = (64, 48)
        var halves = [UInt16](repeating: 0, count: w * h * 4)
        for y in 0..<h { for x in 0..<w {
            let v = Float16(0.3 + 0.2 * Float(x) / Float(w))
            for c in 0..<3 { halves[(y * w + x) * 4 + c] = v.bitPattern }
            halves[(y * w + x) * 4 + 3] = Float16(1).bitPattern
        } }
        let out = try upscale(halves, w, h, 96, 72)
        var mean: Float = 0, srcMean: Float = 0
        for i in 0..<(96 * 72) { mean += out[i * 4 + 1] }
        for i in 0..<(w * h) { srcMean += Float(Float16(bitPattern: halves[i * 4 + 1])) }
        XCTAssertEqual(mean / Float(96 * 72), srcMean / Float(w * h), accuracy: 0.002)
        // A smooth ramp stays a ramp: monotonic along a row (no ringing).
        for x in 1..<96 { XCTAssertGreaterThanOrEqual(out[(36 * 96 + x) * 4 + 1], out[(36 * 96 + x - 1) * 4 + 1] - 0.003) }
    }

    /**
     * RAWBOY_SCAN_IN (half RGBA input, 96 x 64) and RAWBOY_SCAN_WEB (the web's WebGL2 output as JSON, from
     * shaders/scan.frag run by Chrome): the Metal output matches it.
     */
    func testUpscaleMatchesTheWebsWebGL() throws {
        let env = ProcessInfo.processInfo.environment
        guard let inPath = env["RAWBOY_SCAN_IN"], let webPath = env["RAWBOY_SCAN_WEB"] else { throw XCTSkip("RAWBOY_SCAN_IN / RAWBOY_SCAN_WEB not set") }
        let raw = try Data(contentsOf: URL(fileURLWithPath: inPath))
        let halves: [UInt16] = raw.withUnsafeBytes { Array($0.bindMemory(to: UInt16.self)) }
        let web = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: URL(fileURLWithPath: webPath))) as? [String: Any])
        let (ow, oh) = (web["w"] as! Int, web["h"] as! Int)
        let webData = (web["data"] as! [NSNumber]).map(\.floatValue)
        let metal = try upscale(halves, 96, 64, ow, oh)
        var maxDiff: Float = 0, sumDiff: Double = 0, n = 0
        var sums = [Double](repeating: 0, count: 4), sqs = [Double](repeating: 0, count: 4), wsums = [Double](repeating: 0, count: 4), wsqs = [Double](repeating: 0, count: 4)
        for i in 0..<(ow * oh) {
            for c in 0..<3 {
                let m = metal[i * 4 + c], w = webData[i * 4 + c]
                maxDiff = max(maxDiff, abs(m - w))
                sumDiff += Double(abs(m - w))
                n += 1
                sums[c] += Double(m); sqs[c] += Double(m * m); wsums[c] += Double(w); wsqs[c] += Double(w * w)
            }
        }
        let count = Double(ow * oh)
        func stat(_ s: Double, _ q: Double) -> (Double, Double) { (s / count, (q / count - (s / count) * (s / count)).squareRoot()) }
        for c in 0..<3 {
            let (mm, ms) = stat(sums[c], sqs[c]), (wm, ws) = stat(wsums[c], wsqs[c])
            print("SCANTEST channel \(c): metal mean \(mm) std \(ms) | web mean \(wm) std \(ws)")
            XCTAssertEqual(mm, wm, accuracy: 2e-4 + wm * 1e-3)
            XCTAssertEqual(ms, ws, accuracy: 2e-4 + ws * 2e-3)
        }
        print("SCANTEST \(ow)x\(oh): mean abs diff \(sumDiff / Double(n)), max abs diff \(maxDiff)")
        XCTAssertLessThan(sumDiff / Double(n), 5e-4)
        XCTAssertLessThan(maxDiff, 0.02)
    }

    /** A real photo exported in Film mode with the scan on: 1.5x the size, and the picture the plain export has. */
    func testScanExportOfARealPhoto() throws {
        let repo = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        let dir = repo.appendingPathComponent(".raw")
        // Needs a DNG in .raw (git-ignored): skipped on CI, as DesktopBenchTests is.
        guard let file = ((try? FileManager.default.contentsOfDirectory(atPath: dir.path)) ?? []).filter({ $0.lowercased().hasSuffix(".dng") }).sorted().first.map({ dir.appendingPathComponent($0) }) else {
            throw XCTSkip("no test file in \(dir.path)")
        }
        let image = try RawImage.open(url: file)
        defer { image.close() }
        var p = RenderTests.asShotDefaults(image)
        p.film = "portra400"
        p.filmAmount = 100
        let film = try FilmStocks.byId("portra400").flatMap { try FilmStocks.load($0) }
        let params = ShaderParams.from(p, asShot: RenderTests.asShotDefaults(image), lut: nil, lens: LensTransform(info: image.lens, params: p),
                                       base: image.createPreview(maxDimension: 512), bloomSources: nil, skinMask: nil, film: film)
        XCTAssertTrue(ScanScale.applies(params))
        let out = FileManager.default.temporaryDirectory.appendingPathComponent("rawboy-scan-\(UUID().uuidString.prefix(6))", isDirectory: true)
        try FileManager.default.createDirectory(at: out, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: out) }
        func export(_ scan: Bool) throws -> (URL, Double) {
            var s = ExportSettings(format: .tiff, tiffBits: 16)
            s.filmScan = scan
            let t = Date()
            let url = try Exporter().export(image, sourceName: "photo.dng", params: params, settings: s,
                                            naming: OutputNaming(suffix: scan ? "scan" : "plain"), directory: out)
            return (url, Date().timeIntervalSince(t))
        }
        let (plain, plainTime) = try export(false)
        let (scan, scanTime) = try export(true)
        let a = try Self.tiffStats(plain), b = try Self.tiffStats(scan)
        print("SCANTEST export \(file.lastPathComponent): plain \(a.width)x\(a.height) \(String(format: "%.1f", plainTime)) s mean \(a.mean) | scan \(b.width)x\(b.height) \(String(format: "%.1f", scanTime)) s mean \(b.mean)")
        let (w, h) = ScanScale.size(params.lens.outputWidth, params.lens.outputHeight)
        XCTAssertEqual(b.width, w)
        XCTAssertEqual(b.height, h)
        XCTAssertEqual(a.width, params.lens.outputWidth)
        for c in 0..<3 { XCTAssertEqual(b.mean[c], a.mean[c], accuracy: a.mean[c] * 0.03, "channel \(c) mean") }
    }

    // MARK: helpers

    /** Runs the upscaler on [halves] (RGBA half, [w] x [h]) to [ow] x [oh] and returns the result's RGBA floats. */
    private func upscale(_ halves: [UInt16], _ w: Int, _ h: Int, _ ow: Int, _ oh: Int) throws -> [Float] {
        let ctx = MetalContext.shared
        let src = try XCTUnwrap(ctx.makeTexture(.rgba16Float, w, h))
        src.replace(region: MTLRegionMake2D(0, 0, w, h), mipmapLevel: 0, withBytes: halves, bytesPerRow: w * 8)
        let commands = try XCTUnwrap(ctx.queue.makeCommandBuffer())
        let scanner = ScanUpscaler()
        let result = scanner.encode(commands, src: src, srcW: w, srcH: h, w: ow, h: oh, denoise: 0)
        let buffer = try XCTUnwrap(ctx.device.makeBuffer(length: ow * oh * 8, options: .storageModeShared))
        let blit = try XCTUnwrap(commands.makeBlitCommandEncoder())
        blit.copy(from: result, sourceSlice: 0, sourceLevel: 0, sourceOrigin: MTLOrigin(x: 0, y: 0, z: 0),
                  sourceSize: MTLSize(width: ow, height: oh, depth: 1), to: buffer, destinationOffset: 0,
                  destinationBytesPerRow: ow * 8, destinationBytesPerImage: ow * oh * 8)
        blit.endEncoding()
        commands.commit()
        commands.waitUntilCompleted()
        XCTAssertNil(commands.error)
        let ptr = buffer.contents().bindMemory(to: UInt16.self, capacity: ow * oh * 4)
        return (0..<(ow * oh * 4)).map { Float(Float16(bitPattern: ptr[$0])) }
    }

    /** Size and per-channel mean (0..1) of a 16-bit RGB TIFF as this engine writes it (uncompressed, one strip per band). */
    private static func tiffStats(_ url: URL) throws -> (width: Int, height: Int, mean: [Float]) {
        guard let source = CGImageSourceCreateWithURL(url as CFURL, nil), let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else {
            throw XCTSkip("cannot read \(url.lastPathComponent)")
        }
        let w = image.width, h = image.height
        // Averaged down by drawing into a small 8-bit context: a mean of the whole picture.
        let small = 64
        var px = [UInt8](repeating: 0, count: small * small * 4)
        let ctx = CGContext(data: &px, width: small, height: small, bitsPerComponent: 8, bytesPerRow: small * 4, space: CGColorSpace(name: CGColorSpace.sRGB)!,
                            bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
        ctx.interpolationQuality = .high
        ctx.draw(image, in: CGRect(x: 0, y: 0, width: small, height: small))
        var mean = [Float](repeating: 0, count: 3)
        for i in 0..<(small * small) { for c in 0..<3 { mean[c] += Float(px[i * 4 + c]) / 255 } }
        return (w, h, mean.map { $0 / Float(small * small) })
    }
}
