import XCTest
import ImageIO
import UniformTypeIdentifiers
@testable import RawBoyEngine

/**
 * Portrait retouch on a real portrait (RAWBOY_PORTRAIT=<raw>; skipped without it): the skin mask, the retouch map and their
 * timings. With RAWBOY_OUT=<folder> it writes PNGs to look at (the photo, the photo with the mask in red, the retouch gain).
 */
final class PortraitRealTests: XCTestCase {
    func testPortrait() throws {
        guard let path = ProcessInfo.processInfo.environment["RAWBOY_PORTRAIT"] else { throw XCTSkip("RAWBOY_PORTRAIT not set") }
        #if !canImport(MediaPipeTasksVision)
        let image = try RawImage.open(url: URL(fileURLWithPath: path))
        defer { image.close() }
        func ms(_ t: Date) -> Int { Int(Date().timeIntervalSince(t) * 1000) }
        var t = Date()
        let small = image.createPreview(maxDimension: SkinSegmenter.preferredDimension)
        let preview = image.createPreview(maxDimension: 1536)
        print("PORTRAIT previews \(ms(t)) ms, mask copy \(small.width)x\(small.height), preview \(preview.width)x\(preview.height)")
        if let dir = ProcessInfo.processInfo.environment["RAWBOY_OUT"] { try dump(dir, "pre", preview, SkinMask(width: 1, height: 1, data: [0], sigmaPx: 3, hasSkin: false, faceDiameterPx: 0), RetouchMap(width: 1, height: 1, data: [0, 0, 0, 0], strength: 1)) }
        t = Date()
        let skin = try SkinSegmenter.segment(small, fullWidth: image.width, fullHeight: image.height)
        print("PORTRAIT segment \(ms(t)) ms: hasSkin \(skin.hasSkin), faces \(skin.faces.count), faceDiameterPx \(skin.faceDiameterPx), sigma \(skin.sigmaPx)")
        let area = skin.data.reduce(0, +) / Float(skin.data.count)
        let faceArea = (skin.face ?? []).filter { $0 > 0.5 }.count
        print("PORTRAIT skin share \(area), face px \(faceArea) of \(skin.data.count)")
        XCTAssertTrue(skin.hasSkin)
        XCTAssertEqual(skin.faces.count, 1)
        for strength: Float in [40, 100] {
            t = Date()
            let map = try XCTUnwrap(PortraitRetouch.buildMap(preview, skin, strength: strength))
            var lo: Float = 0, hi: Float = 0, touched = 0, skinPx = 0
            for i in 0..<(map.width * map.height) {
                for c in 1...3 { lo = min(lo, map.data[i * 4 + c]); hi = max(hi, map.data[i * 4 + c]) }
                if abs(map.data[i * 4 + 2]) > 0.005 { touched += 1 }
                if map.data[i * 4] > 0.5 { skinPx += 1 }
            }
            print("PORTRAIT map @\(Int(strength)): \(ms(t)) ms, \(map.width)x\(map.height), gain log2 range \(lo)...\(hi), touched \(touched) px of \(skinPx) skin px")
            if let dir = ProcessInfo.processInfo.environment["RAWBOY_OUT"] { try dump(dir, "s\(Int(strength))", preview, skin, map) }
            if strength == 40 { try renderBoth(image, preview, skin, map) }
        }
        #endif
    }

    /** The develop shader with and without the map (uSkinFix): where it changes the picture, and by how much. */
    private func renderBoth(_ image: RawImage, _ preview: PreviewImage, _ skin: SkinMask, _ map: RetouchMap) throws {
        let w = 1024, h = Int((Float(w) * Float(preview.height) / Float(preview.width)).rounded())
        let defaults = RenderTests.asShotDefaults(image)
        var p = defaults
        p.exposure = 1.0
        func render(_ params: DevelopParams, _ m: RetouchMap?) throws -> [UInt16] {
            var out = [UInt16](repeating: 0, count: w * h * 4)
            let shader = ShaderParams.from(params, asShot: defaults, lut: nil, lens: LensTransform(info: image.lens, params: params),
                                           base: nil, bloomSources: nil, skinMask: skin, retouchMap: m)
            let dev = OffscreenDeveloper(imageWidth: preview.fullWidth, imageHeight: preview.fullHeight)
            try out.withUnsafeMutableBufferPointer { try dev.renderPreview(shader, preview: preview, width: w, height: h, output: $0.baseAddress!) }
            return out
        }
        let t = Date()
        let off = try render(p, map)
        p.portraitRetouch = 40
        let on = try render(p, map)
        var changed = 0, sum = 0.0, maxDiff = 0
        for i in 0..<(w * h) {
            var d = 0
            for c in 0..<3 { d = max(d, abs(Int(on[i * 4 + c]) - Int(off[i * 4 + c]))) }
            if d > 300 { changed += 1 }
            sum += Double(d)
            maxDiff = max(maxDiff, d)
        }
        print("PORTRAIT shader A/B \(w)x\(h): \(Int(Date().timeIntervalSince(t) * 1000)) ms, pixels changed > 0.5% \(changed) (\(100 * changed / (w * h))%), mean diff \(sum / Double(w * h) / 655.35)%, max \(Double(maxDiff) / 655.35)%")
        XCTAssertGreaterThan(changed, 100)
        XCTAssertEqual(off.count, on.count)
    }

    private func dump(_ dir: String, _ tag: String, _ p: PreviewImage, _ skin: SkinMask, _ map: RetouchMap) throws {
        try FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
        let w = p.width, h = p.height
        func png(_ name: String, _ f: (Int, Int, Int) -> UInt8) throws {
            var bytes = [UInt8](repeating: 255, count: w * h * 4)
            for y in 0..<h { for x in 0..<w { for c in 0..<3 { bytes[(y * w + x) * 4 + c] = f(x, y, c) } } }
            let cg = CGImage(width: w, height: h, bitsPerComponent: 8, bitsPerPixel: 32, bytesPerRow: w * 4,
                             space: CGColorSpace(name: CGColorSpace.sRGB)!,
                             bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.noneSkipLast.rawValue),
                             provider: CGDataProvider(data: Data(bytes) as CFData)!, decode: nil, shouldInterpolate: false,
                             intent: .defaultIntent)!
            let dest = CGImageDestinationCreateWithURL(URL(fileURLWithPath: "\(dir)/\(name).png") as CFURL, UTType.png.identifier as CFString, 1, nil)!
            CGImageDestinationAddImage(dest, cg, nil)
            XCTAssertTrue(CGImageDestinationFinalize(dest))
        }
        func lin(_ x: Int, _ y: Int, _ c: Int) -> Float { Float(Float16(bitPattern: p.pixels[(y * w + x) * 3 + c])) }
        func enc(_ v: Float) -> UInt8 { UInt8(min(max(powf(min(max(v * 3, 0), 1), 1 / 2.2), 0), 1) * 255) }
        func maskAt(_ x: Int, _ y: Int) -> Float { skin.data[min(skin.height - 1, y * skin.height / h) * skin.width + min(skin.width - 1, x * skin.width / w)] }
        try png("photo") { x, y, c in enc(lin(x, y, c)) }
        try png("mask-\(tag)") { x, y, c in
            let m = maskAt(x, y)
            let base = Float(enc(lin(x, y, c)))
            return UInt8(c == 0 ? min(255, base * (1 - m * 0.5) + 255 * m * 0.5) : base * (1 - m * 0.5))
        }
        try png("gain-\(tag)") { x, y, c in
            let g = map.data[(y * map.height / h * map.width + x * map.width / w) * 4 + 2]
            let v = min(1, abs(g) * 8)
            let base = Float(enc(lin(x, y, c))) * 0.5
            return UInt8(c == (g > 0 ? 1 : 0) ? min(255, base + 255 * v) : base)
        }
    }
}
