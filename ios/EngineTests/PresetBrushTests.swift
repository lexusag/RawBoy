import XCTest
@testable import RawBoyEngine

/** Presets must never override existing brush mask layers or healing brush strokes. */
final class PresetBrushTests: XCTestCase {
    private func sampleStroke() -> BrushStroke {
        BrushStroke(id: "s1", erase: false, auto: false, radius: 0.04, hardness: 50, flow: 100, points: [0.2, 0.3, 0.4, 0.5])
    }

    func testApplyingMasksPresetKeepsExistingBrushLayersAndReplacesGradients() throws {
        var brush = Masks.newBrush(name: "Face")
        brush.adjust = LayerAdjust(exposure: 0.6)
        brush.strokes = [sampleStroke()]
        var oldGrad = Masks.newLinear(name: "Old")
        oldGrad.adjust = LayerAdjust(exposure: -0.5)
        var target = DevelopParams()
        target.masks = [oldGrad, brush]
        target.healSpots = [HealSpot(x: 0.4, y: 0.5, radius: 0.01)]

        var presetGrad = Masks.newRadial(name: "Vignette")
        presetGrad.adjust = LayerAdjust(exposure: -1)
        var src = DevelopParams()
        src.masks = [presetGrad]
        let preset = Presets.capture("Grad", src, [.masks])
        let decoded = try XCTUnwrap(Presets.decode(Presets.encode([preset])).first)

        let out = Presets.apply(decoded, target)
        XCTAssertEqual(out.masks.count, 2)
        XCTAssertEqual(out.masks[0], brush)
        XCTAssertEqual(out.masks[1].name, "Vignette")
        XCTAssertNotEqual(out.masks[1].id, presetGrad.id)
        XCTAssertEqual(out.healSpots, target.healSpots)

        // Even a preset with an empty masks list keeps existing brush layers.
        let emptyMasks = Presets.capture("Empty", DevelopParams(), [.masks])
        let cleared = Presets.apply(emptyMasks, target)
        XCTAssertEqual(cleared.masks, [brush])
    }

    func testApplyingMasksPresetCapsTotalLayersWithoutDroppingBrushLayers() {
        let brushes = (0..<3).map { i -> MaskLayer in
            var l = Masks.newBrush(name: "B\(i)")
            l.strokes = [sampleStroke()]
            return l
        }
        var target = DevelopParams()
        target.masks = brushes

        var src = DevelopParams()
        src.masks = [Masks.newLinear(name: "G1"), Masks.newRadial(name: "G2")]
        let preset = Presets.capture("Two", src, [.masks])

        let out = Presets.apply(preset, target)
        XCTAssertEqual(out.masks.count, Masks.maxLayers)
        XCTAssertEqual(Array(out.masks.prefix(3)), brushes)
        XCTAssertEqual(out.masks[3].name, "G1")
    }

    func testHasBrushDetectsHealSpotsBrushLayersAndGradientStrokes() {
        XCTAssertFalse(Presets.hasBrush(DevelopParams()))

        var plainGrad = DevelopParams()
        plainGrad.masks = [Masks.newLinear()]
        XCTAssertFalse(Presets.hasBrush(plainGrad))

        var withHeal = DevelopParams()
        withHeal.healSpots = [HealSpot(x: 0.1, y: 0.2, radius: 0.01)]
        XCTAssertTrue(Presets.hasBrush(withHeal))

        var withBrushLayer = DevelopParams()
        withBrushLayer.masks = [Masks.newBrush()]
        XCTAssertTrue(Presets.hasBrush(withBrushLayer))

        var withGradStroke = DevelopParams()
        var g = Masks.newLinear()
        g.strokes = [sampleStroke()]
        withGradStroke.masks = [g]
        XCTAssertTrue(Presets.hasBrush(withGradStroke))
    }
}
