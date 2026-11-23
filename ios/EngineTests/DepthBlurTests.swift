import XCTest
@testable import RawBoyEngine

/** Portrait blur: the depth map's sizing and uniforms (no GPU), edits and presets, then the Metal passes on a synthetic frame. */
final class DepthBlurTests: XCTestCase {
    /** Two bright spots on dark: one over the near (left) half, one over the far (right) half. */
    private func image(width: Int, height: Int) -> PreviewImage {
        var px = [UInt16](repeating: 0, count: width * height * 3)
        let dark = Float16(0.02).bitPattern, lit = Float16(4).bitPattern
        let spots = [(width / 4, height / 2), (3 * width / 4, height / 2)]
        for y in 0..<height {
            for x in 0..<width {
                let on = spots.contains { abs(x - $0.0) <= 1 && abs(y - $0.1) <= 1 }
                for c in 0..<3 { px[(y * width + x) * 3 + c] = on ? lit : dark }
            }
        }
        return PreviewImage(width: width, height: height, pixels: px, fullWidth: width, fullHeight: height)
    }

    /** 8 x 6 map: the left half near (0), the right half far (255). */
    private func map(focus: Float = 0) -> DepthMap {
        var data = [UInt8](repeating: 0, count: 8 * 6)
        for y in 0..<6 { for x in 4..<8 { data[y * 8 + x] = 255 } }
        return DepthMap(width: 8, height: 6, hardware: true, subjectDetected: false, focusDepth: focus, data: data)
    }

    private func params(_ edit: (inout DevelopParams) -> Void, depth: DepthMap?, source: PreviewImage?,
                        size: (Int, Int)) -> ShaderParams {
        var p = DevelopParams()
        edit(&p)
        let info = LensInfo(lensName: "", width: size.0, height: size.1, sensorWidth: size.0, sensorHeight: size.1,
                            orientation: 1, warp: nil, vignette: nil, shading: nil, gainMapsApplied: 0)
        return ShaderParams.from(p, asShot: DevelopParams(), lut: nil, lens: LensTransform(info: info, params: p, knownZoom: 1),
                                 base: nil, bloomSources: nil, skinMask: nil, bokehSource: source, depthMap: depth)
    }

    func testBlurIsAFractionOfTheLongSideAndNeedsAMap() {
        let p = params({ $0.depthBlur = 50; $0.depthFocus = 40; $0.depthFalloff = 25; $0.depthEdge = 80 },
                       depth: map(), source: nil, size: (3000, 2000))
        XCTAssertEqual(p.depthBlurPx, 0.015 * 3000, accuracy: 1e-3)
        XCTAssertEqual(p.depthFocus, 0.4, accuracy: 1e-6)
        XCTAssertEqual(p.depthFalloff, 0.25, accuracy: 1e-6)
        XCTAssertEqual(p.depthEdge, 0.8, accuracy: 1e-6)
        // No depth map: the slider does nothing.
        XCTAssertEqual(params({ $0.depthBlur = 100 }, depth: nil, source: nil, size: (3000, 2000)).depthBlurPx, 0)
        XCTAssertEqual(params({ $0.depthBlur = 0 }, depth: map(), source: nil, size: (3000, 2000)).depthBlurPx, 0)
    }

    func testTextureIsSizedLikeALayersBlur() throws {
        let src = PreviewImage(width: 1536, height: 1024, pixels: [], fullWidth: 6000, fullHeight: 4000)
        XCTAssertNil(BokehTexture.geometry(params({ $0.depthBlur = 100 }, depth: nil, source: src, size: (6000, 4000))))
        XCTAssertNil(BokehTexture.geometry(params({ $0.depthBlur = 100 }, depth: map(), source: nil, size: (6000, 4000))))
        let g = try XCTUnwrap(BokehTexture.geometry(params({ $0.depthBlur = 100 }, depth: map(), source: src, size: (6000, 4000))))
        XCTAssertEqual(g.width, 533)  // 180 px at full blur: 16 texels need a ~533 px long side
        XCTAssertEqual(g.maxRadius, 16, accuracy: 0.1)
    }

    func testEditsAndPresetsCarryTheDepthFields() throws {
        var p = DevelopParams()
        p.depthBlur = 60; p.depthFocus = 35; p.depthFalloff = 70; p.depthEdge = 10
        let text = try XCTUnwrap(Edits.encode(p, defaults: DevelopParams()))
        let back = try XCTUnwrap(Edits.decode(text, defaults: DevelopParams()))
        XCTAssertEqual(back.depthBlur, 60)
        XCTAssertEqual(back.depthFocus, 35)
        XCTAssertEqual(back.depthFalloff, 70)
        XCTAssertEqual(back.depthEdge, 10)
        // A preset keeps the look (blur, falloff, edge) but not the per-photo focus depth.
        XCTAssertTrue(PresetGroup.detail.fields.contains("depthBlur"))
        XCTAssertTrue(PresetGroup.detail.fields.contains("depthFalloff"))
        XCTAssertTrue(PresetGroup.detail.fields.contains("depthEdge"))
        XCTAssertFalse(PresetGroup.detail.fields.contains("depthFocus"))
    }

    /** Metal: the spot over the far half is blurred into a disc, the one over the in-focus near half stays sharp. */
    func testBlursOnlyWhatIsAwayFromTheFocus() throws {
        let w = 256, h = 192
        let img = image(width: w, height: h)
        let dev = OffscreenDeveloper(imageWidth: w, imageHeight: h)
        func render(_ depth: DepthMap?, blur: Float) throws -> [UInt16] {
            var out = [UInt16](repeating: 0, count: w * h * 4)
            let p = params({ $0.depthBlur = blur; $0.depthFocus = 0 }, depth: depth, source: img, size: (w, h))
            try out.withUnsafeMutableBufferPointer {
                try dev.renderPreview(p, preview: img, width: w, height: h, output: $0.baseAddress!)
            }
            return out
        }
        func px(_ o: [UInt16], _ x: Int, _ y: Int) -> Int { Int(o[(y * w + x) * 4 + 1]) }
        let near = (w / 4, h / 2), far = (3 * w / 4, h / 2)
        let sharp = try render(map(), blur: 0)
        let blurred = try render(map(), blur: 100)
        XCTAssertGreaterThan(px(sharp, far.0, far.1), 60000)
        // The far spot spreads out (dimmer centre, light beside it); the near one is untouched.
        XCTAssertLessThan(px(blurred, far.0, far.1), px(sharp, far.0, far.1) * 3 / 4)
        XCTAssertGreaterThan(px(blurred, far.0 + 5, far.1), px(sharp, far.0 + 5, far.1) + 10000)
        XCTAssertEqual(px(blurred, near.0, near.1), px(sharp, near.0, near.1))
        // No depth map: nothing is blurred.
        XCTAssertEqual(try render(nil, blur: 100), sharp)
    }
}
