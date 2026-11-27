package app.rawboy.camera

import app.rawboy.auto.looks.Adjustments
import app.rawboy.auto.looks.LookApplier
import app.rawboy.camera.platform.ActivePlatform
import app.rawboy.camera.platform.CameraPlatform
import app.rawboy.camera.platform.ChipVendor
import app.rawboy.camera.platform.PhoneDescription
import app.rawboy.develop.DevelopParams
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The shot's develop reads the platform profile and still gives exactly what the code before it gave: the former
 * `CameraSettings.develop` / `withPhoneIspLook` and `ShotSaver`'s noise scale are kept here verbatim, with their
 * constants as literals, and compared with the Tensor profile (a Pixel) and the Samsung one, on every look.
 */
class ShotDevelopParityTest {
    private val pixel = resolve("Google", ChipVendor.TENSOR)
    private val galaxy = resolve("samsung", ChipVendor.QUALCOMM)

    private fun resolve(maker: String, chip: ChipVendor): CameraPlatform =
        ActivePlatform.resolve(PhoneDescription(chip, manufacturer = maker), null).profile

    /** The DNG's Make the old code read: DngCreator writes the phone's Build.MANUFACTURER. */
    private val phones = listOf(pixel to "Google", galaxy to "samsung")

    private val bases = listOf(
        DevelopParams(),
        DevelopParams(contrast = 95f, saturation = 97f, denoise = 30f, grain = 20f, filmGrain = 75f),
        DevelopParams(contrast = -20f, saturation = -100f, denoise = 80f, colorDenoise = 10f),
        DevelopParams(denoise = 5f, colorDenoise = 90f, exposure = 0.7f),
    )

    private fun settingsVariants(): List<CameraSettings> {
        val modes = buildList {
            for (look in Edition.looks) add(CameraSettings(lookId = look.id, film = false, mono = false))
            for (look in Edition.filmLooks) add(CameraSettings(filmLookId = look.id, film = true, mono = false))
            for (look in Edition.monoLooks) {
                add(CameraSettings(monoLookId = look.id, film = false, mono = true))
                add(CameraSettings(monoLookId = look.id, film = true, mono = true))
            }
        }
        return modes.flatMap {
            listOf(it, it.copy(grain = false), it.copy(strength = 60f, brightness = 20f, warmth = -15f))
        }
    }

    @Test
    fun lookedEqualsTheOldDevelop() {
        val variants = settingsVariants()
        // Every kind of look is covered: plain LUT, experimental, Film, B&W, Film + B&W.
        assertTrue(variants.any { !it.filmMode && !it.monoMode && it.look.film == null && !it.look.experimental })
        assertTrue(variants.any { !it.monoMode && it.look.experimental })
        assertTrue(variants.any { it.filmMode && it.look.film != null })
        assertTrue(variants.any { it.monoMode && !it.filmMono })
        assertTrue(variants.any { it.filmMono })
        var compared = 0
        for (s in variants) for (base in bases) for (face in listOf(false, true)) for ((platform, make) in phones) {
            val old = oldWithPhoneIspLook(oldDevelop(s, base, face), make)
            assertEquals("${platform.layers} ${s.look.id} mono ${s.monoMode} film ${s.filmMode} $base", old, ShotDevelop.looked(s, base, face, platform))
            compared++
        }
        assertTrue(compared > 100)
    }

    @Test
    fun viewfinderDevelopEqualsTheOldOne() {
        // The live develop has no ISP look, only the floors.
        for (s in settingsVariants()) for (base in bases) for ((platform, _) in phones) {
            assertEquals(oldDevelop(s, base, false), s.develop(base, false, platform.noise))
        }
    }

    @Test
    fun noiseScaleEqualsTheOldOne() {
        for ((platform, _) in phones) for (front in listOf(false, true)) for (frames in listOf(1f, 2.5f, 7.3f, 8f)) {
            assertEquals(oldNoiseScale(front, frames), ShotDevelop.noiseIsoScale(platform.noise, front, frames), 0f)
        }
    }

    @Test
    fun theSamsungLookFollowsTheProfileNotTheName() {
        // Shared code holds no maker name: a Pixel profile gives no look, the Samsung one does.
        val s = CameraSettings(film = false, mono = false)
        val base = DevelopParams()
        assertEquals(s.develop(base, false, pixel.noise), ShotDevelop.looked(s, base, false, pixel))
        val looked = ShotDevelop.looked(s, base, false, galaxy)
        assertEquals(s.develop(base, false, galaxy.noise).contrast + 25f, looked.contrast, 1e-4f)
    }

    // --- The code before the platform profile, verbatim (constants as literals). ---

    private fun oldDevelop(s: CameraSettings, base: DevelopParams, hasFace: Boolean): DevelopParams {
        val p = oldDevelopLook(s, base, hasFace)
        return if (s.grain) p else p.copy(grain = 0f, filmGrain = 0f)
    }

    private fun oldDevelopLook(s: CameraSettings, base: DevelopParams, hasFace: Boolean): DevelopParams {
        val bw = s.monoMode
        val adjust = Adjustments(
            brightness = s.brightness,
            warmth = if (bw) 0f else s.warmth,
            contrast = if (s.filmMono) CameraSettings.FILM_MONO_CONTRAST else 0f,
        )
        val p = LookApplier.apply(base, s.look, s.strength, adjust, hasFace)
        if (bw) return p.copy(saturation = -100f, bwFilter = s.filter, monoFx = true)
        if (s.look.film != null) return p
        val experimental = s.look.experimental
        val luma = if (experimental) 22f /* LUT_LUMA_DENOISE_EXPERIMENTAL */ else 12f /* LUT_LUMA_DENOISE */
        val color = if (experimental) 70f /* LUT_COLOR_DENOISE_EXPERIMENTAL */ else 70f /* LUT_COLOR_DENOISE */
        val punch = !experimental
        return p.copy(
            denoise = maxOf(p.denoise, luma),
            colorDenoise = maxOf(p.colorDenoise ?: p.denoise, color),
            contrast = if (punch) (p.contrast + CameraSettings.LOOK_CONTRAST).coerceAtMost(100f) else p.contrast,
            saturation = if (punch) (p.saturation + CameraSettings.LOOK_SATURATION).coerceAtMost(100f) else p.saturation,
        )
    }

    private fun oldWithPhoneIspLook(p: DevelopParams, make: String): DevelopParams {
        if (!make.equals("samsung", ignoreCase = true)) return p
        return p.copy(
            contrast = (p.contrast + 25f /* SAMSUNG_CONTRAST */).coerceAtMost(100f),
            saturation = if (p.saturation <= -100f) p.saturation else (p.saturation + 25f /* SAMSUNG_SATURATION */).coerceAtMost(100f),
        )
    }

    /** ShotSaver: (front ? FRONT_NOISE_ISO_SCALE : PHONE_NOISE_ISO_SCALE) / effectiveFrames. */
    private fun oldNoiseScale(front: Boolean, effectiveFrames: Float) = (if (front) 8f else 4f) / effectiveFrames

    @Test
    fun backlightShadowsAsBefore() {
        // The former ShotSaver.backlightShadows, verbatim.
        fun former(range: Float, iso: Float): Float {
            val lift = ((range - 5f) * 37.5f).coerceIn(0f, 80f)
            val t = ((iso - 800f) / 2400f).coerceIn(0f, 1f)
            return Math.round(lift * (1f - t * t * (3f - 2f * t))).toFloat()
        }
        for (range in listOf(3f, 5f, 6.2f, 7f, 8.8f, 12f)) for (iso in listOf(50f, 800f, 1600f, 2400f, 3200f, 6400f)) {
            val stats = app.rawboy.auto.analysis.SceneStats(
                0.05f, -12f, -4f - range, -6f, -4f, -3f, 0f, 0.1f, 0f, 0f, 0f, 0f, iso, IntArray(1),
            )
            assertEquals("range $range iso $iso", former(range, iso), ShotDevelop.backlightShadows(stats))
        }
        assertEquals(75f, former(7f, 150f))
    }

    @Test
    fun autoBaseHoldsLockedExposureAndSkipsSceneLift() {
        val skyStats = app.rawboy.auto.analysis.SceneStats(
            0.06f, -8f, -7f, -5f, -1.2f, -0.7f, 0f, 0.1f, 0.25f, 0f, 0f, 0f, 50f, IntArray(1), 0.25f,
        )
        val sunnyLight = app.rawboy.auto.analysis.SceneLight(exposureSeconds = 1f / 1000f)
        val base = DevelopParams(exposure = 1.4f, contrast = 15f, highlights = -10f, shadows = 20f)

        // Unlocked non-flash photo gets SceneRecognition lift (+0.45 EV).
        val unlocked = ShotDevelop.autoBase(base, skyStats, sunnyLight, isFlash = false, lockedExposureEv = null)
        assertEquals(1.85f, unlocked.exposure, 1e-5f)

        // AE/WB-locked photo holds the locked exposure without re-metering or scene lift, keeping tone adjustments.
        val locked = ShotDevelop.autoBase(base, skyStats, sunnyLight, isFlash = false, lockedExposureEv = -0.35f)
        assertEquals(-0.35f, locked.exposure, 1e-5f)
        assertEquals(base.contrast, locked.contrast, 1e-5f)
        assertEquals(base.highlights, locked.highlights, 1e-5f)
        assertEquals(base.shadows, locked.shadows, 1e-5f)

        // Manual flash photo keeps AutoTone's own exposure even if a locked value were present.
        val flash = ShotDevelop.autoBase(base, skyStats, sunnyLight, isFlash = true, lockedExposureEv = -0.35f)
        assertEquals(base, flash)
    }
}
