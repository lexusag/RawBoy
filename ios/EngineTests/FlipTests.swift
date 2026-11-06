import XCTest
@testable import RawBoyEngine

/** Pro's flips (the same cases as FlipTest.kt): a mirror of the picture as shown, crop and straighten included. */
final class FlipTests: XCTestCase {
    private let info = LensInfo.none(width: 6000, height: 4000)

    private func assertClose(_ a: [Double], _ b: [Double], _ accuracy: Double, file: StaticString = #filePath, line: UInt = #line) {
        XCTAssertEqual(a.count, b.count, file: file, line: line)
        for (x, y) in zip(a, b) { XCTAssertEqual(x, y, accuracy: accuracy, file: file, line: line) }
    }

    func testFlipsMirrorThePictureAsShown() {
        for rotation in 0...3 {
            for vertical in [false, true] {
                var before = DevelopParams()
                before.lensDistortion = 40
                before.lensAnamorphic = -35
                before.lensCrop = -20
                before.straighten = 7.5
                before.rotation = rotation
                before = before.withCrop(CropRect(0.1, 0.2, 0.5, 0.9))
                let a = LensTransform(info: info, params: before)
                let b = LensTransform(info: info, params: CropMath.flip(before, vertical: vertical))
                XCTAssertEqual([a.outputWidth, a.outputHeight], [b.outputWidth, b.outputHeight])
                // Crop edges round to whole pixels, so allow a pixel's worth.
                for (x, y) in [(0.0, 0.0), (Double(a.outputWidth), 0.0), (137.5, 401.25)] {
                    let m = vertical ? (x, Double(a.outputHeight) - y) : (Double(a.outputWidth) - x, y)
                    assertClose(b.source(m.0, m.1), a.source(x, y), 1)
                }
                // Twice is no flip.
                let twice = CropMath.flip(CropMath.flip(before, vertical: vertical), vertical: vertical)
                assertClose(LensTransform(info: info, params: twice).outToImage, a.outToImage, 1e-9)
            }
        }
    }

    func testASidewaysTurnSwapsTheAxis() {
        let plain = LensTransform(info: info, params: CropMath.flip(DevelopParams(), vertical: false))
        XCTAssertTrue(plain.flipHorizontal)
        assertClose(plain.source(100, 50), [5900, 50], 1e-6)
        var turned = DevelopParams()
        turned.rotation = 1
        XCTAssertTrue(CropMath.flip(turned, vertical: false).flipVertical)
    }

    func testScalePreservesResolutionAndZoomsAroundCenter() {
        let unscaled = LensTransform(info: info, params: DevelopParams())
        var p = DevelopParams()
        p.scale = 150
        let scaled = LensTransform(info: info, params: p)
        XCTAssertEqual(unscaled.outputWidth, scaled.outputWidth)
        XCTAssertEqual(unscaled.outputHeight, scaled.outputHeight)
        let cx = Double(unscaled.outputWidth) / 2
        let cy = Double(unscaled.outputHeight) / 2
        assertClose(unscaled.source(cx, cy), scaled.source(cx, cy), 1e-6)
        let s1 = scaled.source(cx + 150, cy)
        let s0 = unscaled.source(cx + 100, cy)
        assertClose(s0, s1, 1e-6)
    }

    func testAnamorphicDistortionAndAdjustableCrop() throws {
        var anam = DevelopParams()
        anam.lensAnamorphic = -60
        let auto = LensTransform(info: info, params: anam)
        XCTAssertFalse(auto.clipFrame)
        XCTAssertGreaterThan(auto.zoom, 1.0)
        // Horizontals keep constant source y when radial distortion is 0.
        let y0 = auto.source(1000, 500)[1]
        XCTAssertEqual(auto.source(3000, 500)[1], y0, accuracy: 1e-9)
        XCTAssertEqual(auto.source(5000, 500)[1], y0, accuracy: 1e-9)
        // Off-centre verticals bow horizontally.
        XCTAssertNotEqual(auto.source(1000, 200)[0], auto.source(1000, 2000)[0])
        for (x, y) in [(0.0, 0.0), (6000.0, 0.0), (0.0, 2000.0), (3000.0, 0.0)] {
            let s = auto.source(x, y)
            XCTAssertTrue(s[0] > -0.6 && s[0] < 6000.6 && s[1] > -0.6 && s[1] < 4000.6)
        }
        var outParams = anam
        outParams.lensCrop = -100
        let zoomedOut = LensTransform(info: info, params: outParams)
        XCTAssertTrue(zoomedOut.clipFrame)
        XCTAssertLessThan(zoomedOut.zoom, auto.zoom)
        XCTAssertLessThan(zoomedOut.source(0, 0)[0], -10)
        var tightParams = anam
        tightParams.lensCrop = 100
        let tighter = LensTransform(info: info, params: tightParams)
        XCTAssertFalse(tighter.clipFrame)
        XCTAssertGreaterThan(tighter.zoom, auto.zoom)

        var ext = DevelopParams()
        ext.lensDistortion = 100
        ext.lensAnamorphic = 100
        ext.lensCrop = -100
        let mono = LensTransform(info: info, params: ext)
        var prev = -Double.infinity
        for i in 0...20 {
            let sx = mono.source(Double(i) * 300, 200)[0]
            XCTAssertGreaterThan(sx, prev)
            prev = sx
        }
        ext.straighten = 6
        ext.rotation = 1
        let extreme = LensTransform(info: info, params: ext)
        for (x, y) in [(200.0, 300.0), (1800.0, 1200.0), (3500.0, 5200.0)] {
            let s = extreme.source(x, y)
            assertClose(extreme.output(s[0], s[1]), [x, y], 1e-2)
        }
    }

    func testCinemaCropAspectRatios() throws {
        XCTAssertEqual(CropAspect.r2x1.label(portrait: false), "2:1")
        XCTAssertEqual(CropAspect.r2x1.label(portrait: true), "1:2")
        XCTAssertEqual(try XCTUnwrap(CropAspect.r2x1.ratio(frameWidth: 6000, frameHeight: 4000, portrait: false)), 2.0, accuracy: 1e-9)
        XCTAssertEqual(try XCTUnwrap(CropAspect.r2x1.ratio(frameWidth: 6000, frameHeight: 4000, portrait: true)), 0.5, accuracy: 1e-9)
        XCTAssertEqual(CropAspect.r239x1.label(portrait: false), "2.39:1")
        XCTAssertEqual(CropAspect.r239x1.label(portrait: true), "1:2.39")
        XCTAssertEqual(try XCTUnwrap(CropAspect.r239x1.ratio(frameWidth: 6000, frameHeight: 4000, portrait: false)), 2.39, accuracy: 1e-9)
        XCTAssertEqual(try XCTUnwrap(CropAspect.r239x1.ratio(frameWidth: 6000, frameHeight: 4000, portrait: true)), 1.0 / 2.39, accuracy: 1e-9)
        let scope = CropMath.withAspect(CropMath.full, ratio: 2.39, frameWidth: 6000, frameHeight: 4000)
        XCTAssertEqual(scope.left, 0, accuracy: 1e-6)
        XCTAssertEqual(scope.right, 1, accuracy: 1e-6)
        XCTAssertEqual(Double(scope.right - scope.left) * 6000 / (Double(scope.bottom - scope.top) * 4000), 2.39, accuracy: 1e-5)
    }
}
