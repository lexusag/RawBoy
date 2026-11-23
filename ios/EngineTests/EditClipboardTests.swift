import XCTest
@testable import RawBoyEngine

/** ⌘C / ⌘V's clipboard: the same cases as web's ProStore "copyEdits / pasteEdits" tests. */
@MainActor
final class EditClipboardTests: XCTestCase {
    override func setUp() async throws { EditClipboard.clear() }

    func testDefaultGroupsLeaveLensDetailDenoiseAndGeometry() throws {
        var p = DevelopParams()
        p.exposure = 1.5
        p.saturation = 20
        p.rotation = 1
        p.lensDistortion = 30
        p.grain = 40
        p.denoise = 55
        let copied = try XCTUnwrap(EditClipboard.copy(p))
        XCTAssertEqual(copied.groups, PresetGroup.defaultGroups)
        let pasted = Presets.apply(copied, DevelopParams())
        XCTAssertEqual(pasted.exposure, 1.5)
        XCTAssertEqual(pasted.saturation, 20)
        XCTAssertEqual(pasted.rotation, 0)
        XCTAssertEqual(pasted.lensDistortion, 0)
        XCTAssertEqual(pasted.grain, 0)
        XCTAssertEqual(pasted.denoise, 0)
    }

    func testOnlyTheChosenGroups() throws {
        var p = DevelopParams()
        p.exposure = 1.5
        p.grain = 40
        let copied = try XCTUnwrap(EditClipboard.copy(p, [.detail]))
        let pasted = Presets.apply(copied, DevelopParams())
        XCTAssertEqual(pasted.grain, 40)
        XCTAssertEqual(pasted.exposure, 0)
        XCTAssertEqual(EditClipboard.preset, copied)
    }

    func testNoGroupCopiesNothing() {
        XCTAssertNil(EditClipboard.copy(DevelopParams(), []))
        XCTAssertNil(EditClipboard.preset)
    }

    func testLayerKeepsTheUnderPresetsOtherFields() {
        var a = DevelopParams()
        a.exposure = 1
        a.saturation = 10
        var b = DevelopParams()
        b.saturation = 30
        let under = Presets.capture("A", a, [.light, .color])
        let over = Presets.capture("B", b, [.color])
        let both = EditClipboard.layer(under, over)
        let out = Presets.apply(both, DevelopParams())
        XCTAssertEqual(out.exposure, 1)
        XCTAssertEqual(out.saturation, 30)
        XCTAssertEqual(both.groups, [.light, .color])
    }
}
