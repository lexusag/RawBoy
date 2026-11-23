import Foundation

/**
 * The Mac inspector's sections (Light, Curve, Colour, ...) as units that can be switched off: a section that is off keeps
 * its values in `DevelopParams` but renders as the photo's defaults (`EditSections.effective`), so the user can compare
 * and bring the edits back. Web's `EditSections.ts` has the same ids and fields: keep them in step.
 */
public enum EditSection: String, CaseIterable, Sendable {
    case light, curve, colour, primaries, detail, portrait, effects, lut, lens

    public var title: String {
        switch self {
        case .light: "Light"
        case .curve: "Curve"
        case .colour: "Colour"
        case .primaries: "Primaries"
        case .detail: "Detail"
        case .portrait: "Portrait"
        case .effects: "Effects"
        case .lut: "LUT"
        case .lens: "Lens"
        }
    }

    /** Puts this section's fields back to [d]'s. The tone mapper and the film stock stay: they are not sliders of it. */
    public func restore(_ p: inout DevelopParams, from d: DevelopParams) {
        switch self {
        case .light:
            p.exposure = d.exposure; p.contrast = d.contrast; p.lumaContrast = d.lumaContrast; p.highlights = d.highlights
            p.shadows = d.shadows; p.whites = d.whites; p.blacks = d.blacks
            p.filmAmount = d.filmAmount; p.filmGrain = d.filmGrain; p.halation = d.halation
        case .curve:
            p.curves = d.curves
        case .colour:
            p.temperature = d.temperature; p.tint = d.tint; p.saturation = d.saturation
        case .primaries:
            p.redHue = d.redHue; p.redPurity = d.redPurity; p.greenHue = d.greenHue; p.greenPurity = d.greenPurity
            p.blueHue = d.blueHue; p.bluePurity = d.bluePurity; p.tintHue = d.tintHue; p.tintPurity = d.tintPurity
        case .detail:
            p.denoise = d.denoise; p.colorDenoise = d.colorDenoise; p.sharpening = d.sharpening
            p.localContrast = d.localContrast; p.highpassContrast = d.highpassContrast
        case .portrait:
            p.depthBlur = d.depthBlur; p.depthFocus = d.depthFocus; p.depthFalloff = d.depthFalloff; p.depthEdge = d.depthEdge
            p.skinRetouch = d.skinRetouch; p.blemishRemoval = d.blemishRemoval; p.portraitRetouch = d.portraitRetouch
        case .effects:
            p.bloom = d.bloom; p.anamorphic = d.anamorphic; p.anamorphicColor = d.anamorphicColor
            p.anamorphicGhosts = d.anamorphicGhosts; p.grain = d.grain; p.grainSize = d.grainSize
            p.grainRoughness = d.grainRoughness; p.grainColor = d.grainColor
        case .lut:
            p.lut = d.lut; p.lutAmount = d.lutAmount
        case .lens:
            p.lensProfile = d.lensProfile; p.lensDistortion = d.lensDistortion; p.lensAnamorphic = d.lensAnamorphic
            p.lensCrop = d.lensCrop; p.lensFisheye = d.lensFisheye; p.lensFisheyeFov = d.lensFisheyeFov
            p.lensFisheyeAuto = d.lensFisheyeAuto; p.lensFisheyeCircle = d.lensFisheyeCircle
            p.lensFisheyeX = d.lensFisheyeX; p.lensFisheyeY = d.lensFisheyeY
            p.vignetteAmount = d.vignetteAmount; p.vignetteMidpoint = d.vignetteMidpoint
            p.caRed = d.caRed; p.caBlue = d.caBlue
        }
    }
}

public enum EditSections {
    /**
     * What to render for [p]: its switched-off sections as the photo's [defaults]. Preview, histogram and export all
     * take their parameters through this (`PhotoSession.shaderParams` / `export`), so what you see is what is saved.
     */
    public static func effective(_ p: DevelopParams, defaults: DevelopParams) -> DevelopParams {
        if p.disabledSections.isEmpty { return p }
        var out = p
        for section in EditSection.allCases where p.disabledSections.contains(section.rawValue) {
            section.restore(&out, from: defaults)
        }
        return out
    }
}
