import XCTest
@testable import RawBoyEngine

/** The zoomed view's geometry: the same cases as MasksTest.kt's zoom tests. */
final class ZoomTests: XCTestCase {
    func testZoomedViewKeepsTheFrameAndReachesThePhotoEdges() {
        XCTAssertEqual(ZoomMath.viewRect(cx: 0, cy: 0, viewW: 800, viewH: 600, imgW: 4000, imgH: 3000, frame: 12),
                       PixelRect(x: 0, y: 0, width: 776, height: 576))
        let z = ZoomMath.zoomedRect(cx: 0, cy: 0, viewW: 800, viewH: 600, imgW: 4000, imgH: 3000, frame: 12)
        XCTAssertEqual(z[0], 12)  // the photo's corner just inside the frame
        XCTAssertEqual(z[1], 12)
        let c = ZoomMath.clampCenter(cx: 4000, cy: 3000, viewW: 800, viewH: 600, imgW: 4000, imgH: 3000, frame: 12)
        XCTAssertEqual(c.0, 4000 - 388)
        XCTAssertEqual(c.1, 3000 - 288)
    }

    func testPinchZoomKeepsTheCentreInTheMiddle() {
        // Scale 2: half the region, with fractional edges so panning moves by less than a pixel.
        let v = ZoomMath.viewRectF(cx: 1000.3, cy: 800, viewW: 800, viewH: 600, imgW: 4000, imgH: 3000, scale: 2)
        XCTAssertEqual(v[2], 400, accuracy: 1e-3)
        XCTAssertEqual(v[0], 800.3, accuracy: 1e-3)
        let z = ZoomMath.zoomedRect(cx: 1000.3, cy: 800, viewW: 800, viewH: 600, imgW: 4000, imgH: 3000, scale: 2)
        XCTAssertEqual(z[0] + 1000.3 * 2, 400, accuracy: 1e-2)
        XCTAssertEqual(z[1] + 800 * 2, 300, accuracy: 1e-2)
        XCTAssertEqual(z[2], 8000)
        // Whole pixels covering it, for the tile.
        XCTAssertEqual(ZoomMath.viewRect(cx: 1000.3, cy: 800, viewW: 800, viewH: 600, imgW: 4000, imgH: 3000, scale: 2),
                       PixelRect(x: 800, y: 650, width: 401, height: 300))
        // Below 100% the view reaches the photo's edges.
        let c = ZoomMath.clampCenter(cx: 0, cy: 0, viewW: 800, viewH: 600, imgW: 4000, imgH: 3000, scale: 0.5)
        XCTAssertEqual(c.0, 800)
        XCTAssertEqual(c.1, 600)
        XCTAssertEqual(ZoomMath.fitScale(viewW: 800, viewH: 600, imgW: 4000, imgH: 3000, frame: 0), 0.2, accuracy: 1e-6)
        XCTAssertEqual(ZoomMath.label(1), "100%")
        XCTAssertEqual(ZoomMath.label(2.5), "250%")
    }
}
