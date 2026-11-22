import XCTest
@testable import RawBoyEngine

/// The Pentax 645 / Contax 645 frames cover the photo's edges: the output keeps the photo's size and the photo isn't
/// moved or scaled (the same cases as Pentax645FrameTest.kt's and frames.test.ts's cover tests).
final class FrameCoverTests: XCTestCase {
    func testCoverBandKeepsThePhotoSizeAndLeavesItsPixelsWhereTheyAre() {
        for style in [FilmFrameStyle.pentax645, .contax645] {
            for (w, h) in [(600, 800), (800, 600), (600, 600)] {
                let layout = Pentax645Frame.layout(photoWidth: w, photoHeight: h, style: style)
                XCTAssertEqual(layout.outWidth, w)
                XCTAssertEqual(layout.outHeight, h)
                let info = Pentax645Info(frameNumber: 3, exposureTime: 1.0 / 125, fNumber: 2.8, style: style)
                var src = [UInt16](repeating: 0, count: w * h * 3)
                for y in 0..<h { for x in 0..<w { for c in 0..<3 { src[(y * w + x) * 3 + c] = UInt16(20000 + x + y * 3) } } }
                var dst = [UInt16](repeating: 0, count: w * h * 3)
                var y = 0
                while y < h {
                    let rows = min(97, h - y)
                    var out = [UInt16](repeating: 0, count: w * rows * 3)
                    src.withUnsafeBufferPointer { s in
                        out.withUnsafeMutableBufferPointer { o in
                            Pentax645Frame.coverBand(src: s.baseAddress! + y * w * 3, dst: o.baseAddress!, layout: layout,
                                                     y: y, rows: rows, monochrome: false, info: info)
                        }
                    }
                    for i in 0..<(w * rows * 3) { dst[y * w * 3 + i] = out[i] }
                    y += rows
                }
                let mid = ((layout.topPad + layout.photoHeight / 2) * w + layout.leftPad + layout.photoWidth / 2) * 3
                XCTAssertEqual(dst[mid], src[mid])
                XCTAssertLessThan(Int(dst[0]), 3000)
                XCTAssertLessThan(Int(dst[(w * h - 1) * 3]), 3000)
            }
        }
    }
}
