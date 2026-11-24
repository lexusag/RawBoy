import XCTest
@testable import RawBoyEngine

/** The masks' lens blur: its sizing and uniforms (no GPU), then the two Metal passes on a synthetic frame. */
final class BokehTests: XCTestCase {
    private func layer(blur: Float) -> MaskLayer {
        var l = Masks.newRadial()
        l.shape = .radial(cx: 0.5, cy: 0.5, rx: 0.9, ry: 0.9, angle: 0, feather: 100)
        l.adjust.lensBlur = blur
        return l
    }

    private func image(width: Int, height: Int, spot: Bool) -> PreviewImage {
        var px = [UInt16](repeating: 0, count: width * height * 3)
        let dark = Float16(0.02).bitPattern, lit = Float16(4).bitPattern
        for y in 0..<height {
            for x in 0..<width {
                let on = spot && abs(x - width / 2) <= 1 && abs(y - height / 2) <= 1
                for c in 0..<3 { px[(y * width + x) * 3 + c] = on ? lit : dark }
            }
        }
        return PreviewImage(width: width, height: height, pixels: px, fullWidth: width, fullHeight: height)
    }

    private func params(_ masks: [MaskLayer], source: PreviewImage?, size: (Int, Int)) -> ShaderParams {
        var p = DevelopParams()
        p.masks = masks
        let info = LensInfo(lensName: "", width: size.0, height: size.1, sensorWidth: size.0, sensorHeight: size.1,
                            orientation: 1, warp: nil, vignette: nil, shading: nil, gainMapsApplied: 0)
        return ShaderParams.from(p, asShot: DevelopParams(), lut: nil, lens: LensTransform(info: info, params: p, knownZoom: 1),
                                 base: nil, bloomSources: nil, skinMask: nil, bokehSource: source)
    }

    func testLayerBlurIsAFractionOfTheLongSide() {
        let p = params([layer(blur: 100), layer(blur: 50)], source: nil, size: (3000, 2000))
        XCTAssertEqual(p.layers.blur[0], 0.03 * 3000, accuracy: 1e-3)
        XCTAssertEqual(p.layers.blur[1], 0.015 * 3000, accuracy: 1e-3)
        XCTAssertEqual(p.layers.blur[2], 0)
        XCTAssertEqual(params([layer(blur: 0)], source: nil, size: (3000, 2000)).layers.blur[0], 0)
    }

    func testTextureIsSizedSoTheStrongestBlurLandsNearSixteenTexels() throws {
        let src = PreviewImage(width: 1536, height: 1024, pixels: [], fullWidth: 6000, fullHeight: 4000)
        XCTAssertNil(BokehTexture.geometry(params([layer(blur: 100)], source: nil, size: (6000, 4000))))  // no source: off
        XCTAssertNil(BokehTexture.geometry(params([layer(blur: 0)], source: src, size: (6000, 4000))))   // no blur: off
        // Full blur: 180 px radius, so 16 texels need a ~533 px long side.
        let strong = try XCTUnwrap(BokehTexture.geometry(params([layer(blur: 100)], source: src, size: (6000, 4000))))
        XCTAssertEqual(strong.width, 533)
        XCTAssertEqual(strong.height, 355)
        XCTAssertEqual(strong.maxRadius, 16, accuracy: 0.1)
        XCTAssertEqual(strong.scale, 533.0 / 6000, accuracy: 1e-4)
        // A light blur keeps the whole source's size (never larger than it).
        let light = try XCTUnwrap(BokehTexture.geometry(params([layer(blur: 5)], source: src, size: (6000, 4000))))
        XCTAssertEqual(light.width, 1536)
        XCTAssertLessThan(light.maxRadius, 16)
        let u = BokehTexture.uniforms(params([layer(blur: 100)], source: src, size: (6000, 4000)))
        XCTAssertEqual(u.scale, strong.scale)
        XCTAssertEqual(u.texelX, 1 / 533)
        XCTAssertEqual(BokehTexture.uniforms(params([layer(blur: 0)], source: src, size: (6000, 4000))).scale, 0)
    }

    /** Metal: a bright spot on dark, blurred by a layer covering the frame, spreads into a disc; no source = untouched. */
    func testBlurSpreadsABrightSpotIntoADisc() throws {
        let w = 256, h = 192
        let img = image(width: w, height: h, spot: true)
        let dev = OffscreenDeveloper(imageWidth: w, imageHeight: h)
        func render(_ source: PreviewImage?) throws -> [UInt16] {
            var out = [UInt16](repeating: 0, count: w * h * 4)
            try out.withUnsafeMutableBufferPointer {
                try dev.renderPreview(params([layer(blur: 100)], source: source, size: (w, h)), preview: img, width: w, height: h,
                                      output: $0.baseAddress!)
            }
            return out
        }
        func px(_ o: [UInt16], _ x: Int, _ y: Int) -> Int { Int(o[(y * w + x) * 4 + 1]) }
        let sharp = try render(nil)
        let blurred = try render(img)
        let cx = w / 2, cy = h / 2
        let dark = px(sharp, 20, 20)
        // Without the source the frame is as it was: a lit spot, the dark field right next to it.
        XCTAssertGreaterThan(px(sharp, cx, cy), 60000)
        XCTAssertEqual(Double(px(sharp, cx + 5, cy)), Double(dark), accuracy: 100)
        // Blurred: the spot is dimmer and its light lies round it inside the disc (radius ~7.7 px), not outside it.
        XCTAssertLessThan(px(blurred, cx, cy), px(sharp, cx, cy) * 3 / 4)
        XCTAssertGreaterThan(px(blurred, cx + 5, cy), dark + 15000)
        XCTAssertGreaterThan(px(blurred, cx, cy + 5), dark + 15000)
        XCTAssertEqual(Double(px(blurred, cx + 12, cy)), Double(dark), accuracy: 400)
        // Far from it the frame is the same (a dark flat field blurs to itself).
        XCTAssertEqual(Double(px(blurred, 20, 20)), Double(dark), accuracy: 400)
        // The same masks again: nothing is redrawn (cached), and the result is the same.
        XCTAssertEqual(try render(img), blurred)
    }

    /** A bright flat field (above bloom's 0.6 highlight-boost threshold) must blur to itself without blowing out. */
    func testBrightFlatFieldDoesNotBlowOutWhenBlurred() throws {
        let w = 128, h = 96
        var px = [UInt16](repeating: 0, count: w * h * 3)
        let r = Float16(0.25).bitPattern, g = Float16(0.65).bitPattern, b = Float16(0.95).bitPattern
        for i in 0..<(w * h) {
            px[i * 3] = r; px[i * 3 + 1] = g; px[i * 3 + 2] = b
        }
        let img = PreviewImage(width: w, height: h, pixels: px, fullWidth: w, fullHeight: h)
        let dev = OffscreenDeveloper(imageWidth: w, imageHeight: h)
        func render(_ source: PreviewImage?) throws -> [UInt16] {
            var out = [UInt16](repeating: 0, count: w * h * 4)
            try out.withUnsafeMutableBufferPointer {
                try dev.renderPreview(params([layer(blur: 100)], source: source, size: (w, h)), preview: img, width: w, height: h,
                                      output: $0.baseAddress!)
            }
            return out
        }
        let sharp = try render(nil)
        let blurred = try render(img)
        let mid = ((h / 2) * w + (w / 2)) * 4
        for c in 0..<3 {
            XCTAssertEqual(Double(blurred[mid + c]), Double(sharp[mid + c]), accuracy: 200)
        }
    }
}
