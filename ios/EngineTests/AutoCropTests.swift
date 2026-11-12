import XCTest
@testable import RawBoyEngine

/** Auto's Crop & rotate: Adjustments.crop / straighten (the same case as LookApplierTest.kt and web's autostore.test.ts). */
final class AutoCropTests: XCTestCase {
    func testCropAndStraightenArePartOfTheAdjustments() {
        let crop = CropRect(0.1, 0.2, 0.6, 0.9)
        let adjust = Adjustments(straighten: 2.5, crop: crop)
        let p = LookApplier.apply(DevelopParams(), look: Looks.natural, strength: 100, adjust: adjust, hasFace: false)
        XCTAssertEqual(p.crop, crop)
        XCTAssertEqual(p.straighten, 2.5, accuracy: 1e-6)
        // Nothing set: the develop's own crop stays.
        var own = DevelopParams()
        own.cropLeft = 0.3
        let kept = LookApplier.apply(own, look: Looks.natural, strength: 100, adjust: .none, hasFace: false)
        XCTAssertEqual(kept.cropLeft, 0.3, accuracy: 0)
    }
}
