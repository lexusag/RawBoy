import XCTest
@testable import RawBoyEngine

/** Extend canvas (the same cases as ExtendCropTest.kt): a crop may reach maxExtend past the frame, and the canvas is filled. */
final class ExtendCropTests: XCTestCase {
    private let frame = CropMath.full

    func testStaysInsideTheFrameUnlessExtending() {
        XCTAssertEqual(CropMath.drag(frame, handle: .left, dx: -0.5, dy: 0, ratio: nil, frameWidth: 1000, frameHeight: 800), frame)
        let e = CropMath.drag(frame, handle: .left, dx: -0.5, dy: 0, ratio: nil, frameWidth: 1000, frameHeight: 800, extend: true)
        XCTAssertEqual(e.left, -CropMath.maxExtend, accuracy: 1e-6)
        XCTAssertTrue(e.extendsFrame)
        let m = CropMath.drag(frame, handle: .move, dx: 0.9, dy: -0.9, ratio: nil, frameWidth: 1000, frameHeight: 800, extend: true)
        XCTAssertEqual(m.left, CropMath.maxExtend, accuracy: 1e-6)
        XCTAssertEqual(m.top, -CropMath.maxExtend, accuracy: 1e-6)
        XCTAssertEqual(m.right - m.left, 1, accuracy: 1e-6)
    }

    func testKeepsTheAspectRatioWhenACornerIsDraggedOut() {
        let r = CropMath.drag(frame, handle: .bottomRight, dx: 0.2, dy: 0.2, ratio: 1.5, frameWidth: 1500, frameHeight: 1000, extend: true)
        XCTAssertEqual(Double(r.width) * 1500 / (Double(r.height) * 1000), 1.5, accuracy: 1e-3)
        XCTAssertGreaterThan(r.right, 1)
    }

    func testMapsToAndFromTheToolCanvas() {
        let c = CropRect(-0.2, 0.1, 1.1, 0.9)
        let back = CropMath.fromView(CropMath.toView(c))
        XCTAssertEqual(c.left, back.left, accuracy: 1e-5)
        XCTAssertEqual(c.bottom, back.bottom, accuracy: 1e-5)
        XCTAssertGreaterThan(CropMath.toView(frame).left, 0)
    }

    func testAnExtendedCropIsLargerThanTheFrameAndAsksForTheFill() {
        let info = LensInfo.none(width: 6000, height: 4000)
        let t = LensTransform(info: info, params: DevelopParams().withCrop(CropRect(-0.1, 0, 1.1, 1)))
        XCTAssertEqual(t.outputWidth, 7200)
        XCTAssertEqual(t.cropRect.x, -600)
        XCTAssertTrue(t.fillOutside)
        XCTAssertFalse(LensTransform(info: info, params: DevelopParams()).fillOutside)
        XCTAssertEqual(t.source(0, 2000)[0], -600, accuracy: 1e-3)
    }
}
