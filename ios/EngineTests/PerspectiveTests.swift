import XCTest
@testable import RawBoyEngine

/** Pro's perspective sliders (the same cases as PerspectiveTest.kt and web's engine.test.ts). */
final class PerspectiveTests: XCTestCase {
    private let info = LensInfo.none(width: 6000, height: 4000)

    private func assertClose(_ a: [Double], _ b: [Double], _ accuracy: Double, file: StaticString = #filePath, line: UInt = #line) {
        XCTAssertEqual(a.count, b.count, file: file, line: line)
        for (x, y) in zip(a, b) { XCTAssertEqual(x, y, accuracy: accuracy, file: file, line: line) }
    }

    private func params(_ v: Float, _ h: Float, rotation: Int = 0, straighten: Float = 0) -> DevelopParams {
        var p = DevelopParams()
        p.perspectiveVertical = v
        p.perspectiveHorizontal = h
        p.rotation = rotation
        p.straighten = straighten
        return p
    }

    func testOffIsThePlainAffineMap() {
        XCTAssertEqual(LensTransform(info: info, params: params(0, 0)).outToImage, LensTransform(info: info, params: DevelopParams()).outToImage)
    }

    func testKeepsTheCentreAndAutoCropsToRealPicture() {
        for (v, h) in [(Float(-60), Float(0)), (45, 0), (0, -70), (0, 100), (-100, 100), (35, -25)] {
            let lens = LensTransform(info: info, params: params(v, h, straighten: 4))
            let w = Double(lens.outputWidth)
            let ht = Double(lens.outputHeight)
            assertClose(lens.source(w / 2, ht / 2), [3000, 2000], 1e-6)
            var slack = Double.greatestFiniteMagnitude
            for i in 0...20 {
                let t = Double(i) / 20
                for (x, y) in [(t * w, 0.0), (t * w, ht), (0.0, t * ht), (w, t * ht)] {
                    let s = lens.source(x, y)
                    XCTAssertTrue(s[0] > -1e-3 && s[1] > -1e-3 && s[0] < 6000 + 1e-3 && s[1] < 4000 + 1e-3)
                    slack = min(slack, s[0], s[1], 6000 - s[0], 4000 - s[1])
                }
            }
            XCTAssertLessThan(slack, 0.5)
        }
    }

    func testStraightensConvergingLines() {
        // Vertical below 0 widens the top.
        let up = LensTransform(info: info, params: params(-50, 0))
        func spread(_ y: Double) -> Double { up.source(Double(up.outputWidth) * 0.75, y)[0] - up.source(Double(up.outputWidth) * 0.25, y)[0] }
        XCTAssertLessThan(spread(0), spread(Double(up.outputHeight)) * 0.9)
        // Horizontal above 0 widens the right side.
        let right = LensTransform(info: info, params: params(0, 50))
        func tall(_ x: Double) -> Double { right.source(x, Double(right.outputHeight) * 0.75)[1] - right.source(x, Double(right.outputHeight) * 0.25)[1] }
        XCTAssertLessThan(tall(Double(right.outputWidth)), tall(0) * 0.9)
    }

    func testTurnsAndMirrorsWithThePicture() {
        for rotation in 0...3 {
            for (v, h) in [(Float(-40), Float(0)), (0, 55)] {
                let before = params(v, h, rotation: rotation, straighten: 3)
                let a = LensTransform(info: info, params: before)
                var turned = before
                turned.rotation = (rotation + 1) % 4
                let b = LensTransform(info: info, params: CropMath.rotatePerspective(turned, quarterTurns: 1))
                XCTAssertEqual([b.outputWidth, b.outputHeight], [a.outputHeight, a.outputWidth])
                // Clockwise: output (x, y) moves to (height - y, x).
                for (x, y) in [(0.0, 0.0), (Double(a.outputWidth), 0.0), (137.5, 401.25)] {
                    assertClose(b.source(Double(a.outputHeight) - y, x), a.source(x, y), 1e-6)
                }
                XCTAssertEqual(CropMath.rotatePerspective(CropMath.rotatePerspective(before, quarterTurns: 1), quarterTurns: -1), before)
                for vertical in [false, true] {
                    let f = LensTransform(info: info, params: CropMath.flip(before, vertical: vertical))
                    for (x, y) in [(0.0, 0.0), (Double(a.outputWidth), 0.0), (137.5, 401.25)] {
                        let m = vertical ? (x, Double(a.outputHeight) - y) : (Double(a.outputWidth) - x, y)
                        assertClose(f.source(m.0, m.1), a.source(x, y), 1e-6)
                    }
                }
            }
        }
    }
}
