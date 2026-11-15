import Foundation

/**
 * "Reset all photos" (RawBoy Desktop's Auto): every photo goes back to a chosen look, a chosen film stock, or "As is" (the
 * Natural look: the auto develop alone, no LUT or stock). What a photo carries on top of its look is cleared: a RawBoy preset,
 * Strength (back to the default), and every adjustment (brightness, warmth, tint, contrast, saturation, grain, denoise,
 * rotation, straighten and crop). The photo's own auto develop (exposure, tone, white balance, noise) is its analysis and stays;
 * so do the lens preset choice and anything the sidecar keeps for the web.
 */
public enum AutoReset {
    public enum Target {
        /** A look (LUT), in Looks mode. */
        case look(Look)
        /** A film stock, in Film mode. */
        case film(Look)
        /** No look: Looks mode with Natural. */
        case asIs
    }

    public static func apply(_ target: Target, look: inout Look, mode: inout LookMode, filmLook: inout Look,
                             strength: inout Float, adjust: inout Adjustments, preset: inout Preset?) {
        switch target {
        case .look(let l): look = l; mode = .looks
        case .film(let f): filmLook = f; mode = .film
        case .asIs: look = Looks.natural; mode = .looks
        }
        strength = LookApplier.defaultStrength
        adjust = .none
        preset = nil
    }
}
