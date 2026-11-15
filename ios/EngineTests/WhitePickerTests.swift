import XCTest
@testable import RawBoyEngine

/** The white balance picker (the same cases as WhitePickerTest.kt and web's whitepicker.test.ts). */
final class WhitePickerTests: XCTestCase {
    /** The shader's white balance (ShaderParams.from) at kelvin/tint applied to rgb. */
    private func developed(_ rgb: [Double], _ asShotK: Double, _ asShotTint: Double, _ kelvin: Double, _ tint: Double) -> [Double] {
        let m = WhiteBalance.rebalanceMatrix(
            asShotXY: WhiteBalance.xyFromTempTint(asShotK, asShotTint), targetXY: WhiteBalance.xyFromTempTint(kelvin, tint))
        return Mat3.apply(m, rgb)
    }

    private func patch(_ r: Float, _ g: Float, _ b: Float, _ n: Int = 16) -> [Float] {
        (0..<(n * 3)).map { [r, g, b][$0 % 3] }
    }

    private func white(_ p: WhitePicker.Pick) -> (kelvin: Float, tint: Float) {
        guard case let .white(kelvin, tint) = p else {
            XCTFail("expected a white, got \(p)")
            return (0, 0)
        }
        return (kelvin, tint)
    }

    func testAGreyPatchKeepsTheAsShotWhite() {
        let p = white(WhitePicker.pick(patch(0.18, 0.18, 0.18), asShotKelvin: 5200, asShotTint: 8))
        XCTAssertEqual(p.kelvin, 5200, accuracy: 2)
        XCTAssertEqual(p.tint, 8, accuracy: 0.2)
    }

    func testATintedPatchDevelopsNeutral() {
        for rgb in [[0.20, 0.17, 0.12], [0.10, 0.12, 0.16], [0.15, 0.17, 0.15]] {
            let p = white(WhitePicker.pick(patch(Float(rgb[0]), Float(rgb[1]), Float(rgb[2])), asShotKelvin: 5000, asShotTint: 0))
            let out = developed(rgb, 5000, 0, Double(p.kelvin), Double(p.tint))
            XCTAssertEqual(out[0] / out[1], 1, accuracy: 0.003)
            XCTAssertEqual(out[2] / out[1], 1, accuracy: 0.003)
        }
    }

    func testAWarmerPatchMeansAWarmerLight() {
        XCTAssertLessThan(white(WhitePicker.pick(patch(0.20, 0.17, 0.12), asShotKelvin: 5000, asShotTint: 0)).kelvin, 5000)
    }

    func testClippedPixelsAreLeftOut() {
        let p = white(WhitePicker.pick(patch(0.18, 0.18, 0.18, 4) + patch(1, 0.6, 0.2, 12), asShotKelvin: 5200, asShotTint: 0))
        XCTAssertEqual(p.kelvin, 5200, accuracy: 2)
        XCTAssertEqual(WhitePicker.pick(patch(1, 1, 1), asShotKelvin: 5200, asShotTint: 0), .clipped)
    }

    func testInfraredCastsDevelopNeutral() {
        for rgb in [[0.3, 0.1, 0.02], [0.3, 0.12, 0.2], [0.2, 0.1, 0.25]] {
            let p = white(WhitePicker.pick(patch(Float(rgb[0]), Float(rgb[1]), Float(rgb[2])), asShotKelvin: 5000, asShotTint: 0))
            let out = developed(rgb, 5000, 0, Double(p.kelvin), Double(p.tint))
            XCTAssertEqual(out[0] / out[1], 1, accuracy: 0.003)
            XCTAssertEqual(out[2] / out[1], 1, accuracy: 0.003)
        }
    }

    func testLocusBelow1667KJoinsKimsAndRoundTrips() {
        let a = WhiteBalance.planckianXY(1666.9)
        let b = WhiteBalance.planckianXY(1667.1)
        XCTAssertLessThan(hypot(a[0] - b[0], a[1] - b[1]), 1e-4)
        for k in [1000.0, 1200.0, 1500.0] {
            let xy = WhiteBalance.xyFromTempTint(k, -120)
            let tt = WhiteBalance.tempTintFromXY(xy[0], xy[1])
            XCTAssertEqual(tt[0], k, accuracy: 0.5)
            XCTAssertEqual(tt[1], -120, accuracy: 0.01)
        }
    }

    func testBlackIsNotNeutral() {
        XCTAssertEqual(WhitePicker.pick(patch(0, 0, 0), asShotKelvin: 5200, asShotTint: 0), .notNeutral)
    }

    func testSamplesASmallSquareAroundTheTap() {
        let b = WhitePicker.box(3000, 2000, 6000, 4000)
        XCTAssertEqual([b.x0, b.x1, b.y0, b.y1], [2980, 3020, 1980, 2020])
        let c = WhitePicker.box(0, 0, 6000, 4000)
        XCTAssertEqual([c.x0, c.x1, c.y0, c.y1], [0, 40, 0, 40])
    }

    func testWhiteBalanceAdjustSolvesForWarmthAndTint() {
        var base = DevelopParams()
        base.temperature = 5000
        base.tint = 0
        let unadjusted = LookApplier.develop(base, look: Looks.natural, strength: 100, adjust: Adjustments.none, hasFace: false, preset: nil, lensPreset: nil)

        let (w0, t0) = LookApplier.whiteBalanceAdjust(unadjusted, kelvin: 5000, tint: 0)
        XCTAssertEqual(w0, 0, accuracy: 1e-6)
        XCTAssertEqual(t0, 0, accuracy: 1e-6)

        let (wWarmer, tWarmer) = LookApplier.whiteBalanceAdjust(unadjusted, kelvin: 7071, tint: 15)
        XCTAssertEqual(wWarmer, 50, accuracy: 1e-6)
        let developed = LookApplier.develop(base, look: Looks.natural, strength: 100, adjust: Adjustments(warmth: wWarmer, tint: tWarmer), hasFace: false, preset: nil, lensPreset: nil)
        XCTAssertEqual(developed.temperature, 7071, accuracy: 10)
        XCTAssertEqual(developed.tint, 15, accuracy: 1)

        let (wMax, tMax) = LookApplier.whiteBalanceAdjust(unadjusted, kelvin: 50000, tint: 100)
        XCTAssertEqual(wMax, 100, accuracy: 1e-6)
        XCTAssertEqual(tMax, 50, accuracy: 1e-6)
    }

    /** Web's "autoWhiteArea solves for the selected rectangle through crop and leaves clipped pixels out". */
    func testAreaSolvesForTheRectangleThroughCropAndLeavesClippedPixelsOut() throws {
        let w = 40
        let h = 20
        var pixels = [UInt16](repeating: 0, count: w * h * 3)
        // Left half: warm; right top: cool; right bottom: clipped.
        for y in 0..<h {
            for x in 0..<w {
                let rgb: [Float] = x < w / 2 ? [0.2, 0.17, 0.12] : y < h / 2 ? [0.1, 0.12, 0.16] : [1, 1, 1]
                for c in 0..<3 { pixels[(y * w + x) * 3 + c] = Float16(rgb[c]).bitPattern }
            }
        }
        let base = PreviewImage(width: w, height: h, pixels: pixels, fullWidth: 400, fullHeight: 200)
        let full = LensTransform(info: LensInfo.none(width: 400, height: 200), params: DevelopParams())
        func pick(_ lens: LensTransform, _ rect: CropRect) -> WhitePicker.Pick? {
            WhitePicker.area(base: base, imageWidth: 400, imageHeight: 200, lens: lens, rect: rect, asShotKelvin: 5000, asShotTint: 0)
        }

        let left = white(try XCTUnwrap(pick(full, CropRect(0.05, 0.1, 0.45, 0.9))))
        let leftOut = developed([0.2, 0.17, 0.12], 5000, 0, Double(left.kelvin), Double(left.tint))
        XCTAssertEqual(leftOut[0] / leftOut[1], 1, accuracy: 0.005)
        XCTAssertEqual(leftOut[2] / leftOut[1], 1, accuracy: 0.005)

        // The whole right half: the clipped bottom quadrant is skipped, the cool top one made neutral.
        let right = white(try XCTUnwrap(pick(full, CropRect(0.55, 0.05, 0.95, 0.95))))
        let rightOut = developed([0.1, 0.12, 0.16], 5000, 0, Double(right.kelvin), Double(right.tint))
        XCTAssertEqual(rightOut[0] / rightOut[1], 1, accuracy: 0.005)
        XCTAssertEqual(rightOut[2] / rightOut[1], 1, accuracy: 0.005)

        // Only the clipped quadrant, and an empty area.
        XCTAssertEqual(pick(full, CropRect(0.55, 0.55, 0.95, 0.95)), .clipped)
        XCTAssertNil(pick(full, CropRect(0.5, 0.5, 0.5, 0.9)))

        // Cropped to the top right quarter: a rectangle over most of the output samples only the cool part.
        var p = DevelopParams()
        p.cropLeft = 0.5
        p.cropRight = 1
        p.cropTop = 0
        p.cropBottom = 0.5
        let cropped = white(try XCTUnwrap(pick(LensTransform(info: LensInfo.none(width: 400, height: 200), params: p), CropRect(0.1, 0.1, 0.9, 0.9))))
        XCTAssertEqual(cropped.kelvin, right.kelvin, accuracy: 5)
    }
}
