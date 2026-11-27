package app.rawboy.auto

import app.rawboy.auto.analysis.CameraScene
import app.rawboy.auto.analysis.SceneAdjustment
import app.rawboy.auto.analysis.SceneAnalyzer
import app.rawboy.auto.analysis.SceneLight
import app.rawboy.auto.analysis.SceneRecognition
import app.rawboy.auto.analysis.SceneStats
import app.rawboy.develop.DevelopParams
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** Camera scene recognition map ([SceneRecognition]) and blue-sky pixel classification. */
class SceneRecognitionTest {
    private fun stats(
        blueSky: Float = 0.25f,
        iso: Float = 50f,
        p98: Float = -1.2f,
        clipped: Float = 0.002f,
        key: Float = 0.06f,
    ) = SceneStats(
        key = key,
        p1 = -8f,
        p5 = -7f,
        p50 = -4f,
        p98 = p98,
        p99 = p98 + 0.2f,
        clipped = clipped,
        chroma = 0.2f,
        greenBlue = blueSky,
        warm = 0.05f,
        faceArea = 0f,
        skinLuminance = 0f,
        iso = iso,
        histogram = IntArray(1),
        blueSky = blueSky,
    )

    @Test
    fun sunnyBlueSkyEntryLivesInSceneMapAndBrightens() {
        val entry = SceneRecognition.ADJUSTMENTS[CameraScene.SUNNY_BLUE_SKY]
        assertTrue("SUNNY_BLUE_SKY missing from scene recognition map", entry != null && entry.exposureEv > 0f)

        val light = SceneLight(exposureSeconds = 1f / 1000f, postRawBoost = 1f)
        val matches = SceneRecognition.recognize(stats(blueSky = 0.25f, iso = 50f), light)
        assertEquals(1, matches.size)
        assertEquals(CameraScene.SUNNY_BLUE_SKY, matches[0].scene)
        assertEquals(1f, matches[0].confidence, 1e-6f)

        val out = SceneRecognition.apply(DevelopParams(exposure = 0f), stats(blueSky = 0.25f, iso = 50f), light)
        assertEquals(0.45f, out.exposure, 1e-6f)
    }

    @Test
    fun blueSkyConfidenceRampsSmoothly() {
        val light = SceneLight(exposureSeconds = 1f / 1000f)
        assertTrue(SceneRecognition.recognize(stats(blueSky = 0.05f), light).isEmpty())
        assertTrue(SceneRecognition.recognize(stats(blueSky = 0.08f), light).isEmpty())

        val mid = SceneRecognition.recognize(stats(blueSky = 0.15f), light)
        assertEquals(1, mid.size)
        assertTrue("expected partial confidence, got ${mid[0].confidence}", mid[0].confidence in 0.4f..0.6f)

        val full = SceneRecognition.recognize(stats(blueSky = 0.25f), light)
        assertEquals(1f, full[0].confidence, 1e-6f)
    }

    @Test
    fun indoorAndNightScenesWithBlueDoNotTriggerSunnySky() {
        // Bright indoors (~3): ISO 200, 1/60 s -> product 3.33
        assertTrue(
            SceneRecognition.recognize(
                stats(blueSky = 0.35f, iso = 200f),
                SceneLight(exposureSeconds = 1f / 60f, postRawBoost = 1f),
            ).isEmpty(),
        )
        // Night blue hour (~20): ISO 800, 1/40 s
        assertTrue(
            SceneRecognition.recognize(
                stats(blueSky = 0.35f, iso = 800f),
                SceneLight(exposureSeconds = 1f / 40f, postRawBoost = 1f),
            ).isEmpty(),
        )
        // Borderline bright shade (product 1.0): partial confidence
        val borderline = SceneRecognition.recognize(
            stats(blueSky = 0.25f, iso = 100f),
            SceneLight(exposureSeconds = 1f / 100f, postRawBoost = 1f),
        )
        assertEquals(1, borderline.size)
        assertEquals(0.5f, borderline[0].confidence, 1e-4f)
    }

    @Test
    fun isoFallbackWhenShutterUnknown() {
        // Sunny base ISO without shutter time: still recognised.
        assertEquals(1f, SceneRecognition.recognize(stats(blueSky = 0.25f, iso = 50f), SceneLight()).single().confidence, 1e-6f)
        // High ISO without shutter time: ignored.
        assertTrue(SceneRecognition.recognize(stats(blueSky = 0.25f, iso = 400f), SceneLight()).isEmpty())
        // Unknown ISO (0): ignored.
        assertTrue(SceneRecognition.recognize(stats(blueSky = 0.25f, iso = 0f), SceneLight()).isEmpty())
    }

    @Test
    fun brightnessCompensationKeepsSunnyLiftInvariant() {
        // Brightness +2 EV: AE quadruples exposure (product 0.05 -> 0.20 * 4 = 0.80, still sunny once uncompensated;
        // raw p98 rises +2 EV, AutoTone subtracts -2 EV).
        val base = DevelopParams(exposure = -2f)
        val s = stats(blueSky = 0.25f, iso = 200f, p98 = 0.8f)
        val light = SceneLight(exposureSeconds = 1f / 250f, postRawBoost = 1f, captureEv = 2f)
        val adj = SceneRecognition.adjustment(s, light, baseExposureEv = base.exposure)
        assertEquals(0.45f, adj.exposureEv, 1e-5f)
        val out = SceneRecognition.apply(base, s, light)
        assertEquals(-1.55f, out.exposure, 1e-5f)
    }

    @Test
    fun highlightGuardProtectsNearClippedAndClippedScenes() {
        val light = SceneLight(exposureSeconds = 1f / 1000f)
        // Well below clip -> full lift.
        assertEquals(0.45f, SceneRecognition.adjustment(stats(p98 = -1.0f, clipped = 0.005f), light).exposureEv, 1e-5f)
        // Midway through highlight guard (-0.3 EV) -> half lift.
        assertEquals(0.225f, SceneRecognition.adjustment(stats(p98 = -0.3f, clipped = 0.005f), light).exposureEv, 1e-5f)
        // Already at clip -> no extra lift.
        assertEquals(0f, SceneRecognition.adjustment(stats(p98 = 0.0f, clipped = 0.005f), light).exposureEv, 1e-6f)
        // Heavy clipping -> no extra lift even if metered p98 is below 0.
        assertEquals(0f, SceneRecognition.adjustment(stats(p98 = -1.0f, clipped = 0.12f), light).exposureEv, 1e-6f)
    }

    @Test
    fun customSceneMapOverridesDefaultAdjustments() {
        val light = SceneLight(exposureSeconds = 1f / 1000f)
        val custom = mapOf(CameraScene.SUNNY_BLUE_SKY to SceneAdjustment(exposureEv = 0.6f, shadows = 10f, contrast = 4f))
        val out = SceneRecognition.apply(DevelopParams(exposure = 0f, shadows = 5f, contrast = 15f), stats(), light, custom)
        assertEquals(0.6f, out.exposure, 1e-6f)
        assertEquals(15f, out.shadows, 1e-6f)
        assertEquals(19f, out.contrast, 1e-6f)
    }

    @Test
    fun displaySourceIsUntouched() {
        val light = SceneLight(exposureSeconds = 1f / 1000f)
        val base = DevelopParams(exposure = 0f, displaySource = true)
        assertEquals(base, SceneRecognition.apply(base, stats(), light))
    }

    @Test
    fun blueSkyPixelClassificationSeparatesSkyFromFoliageCloudsAndDarkBlue() {
        // Clear daytime blue sky (same Rec.2020 sky as BwFilterTest) and pale horizon blue sky.
        assertTrue(SceneAnalyzer.isBlueSky(0.10f, 0.17f, 0.35f))
        assertTrue(SceneAnalyzer.isBlueSky(0.25f, 0.35f, 0.48f))
        // Deep zenith blue sky.
        assertTrue(SceneAnalyzer.isBlueSky(0.05f, 0.10f, 0.32f))
        // Foliage green -> not blue sky.
        assertFalse(SceneAnalyzer.isBlueSky(0.10f, 0.28f, 0.08f))
        // Overcast grey / white cloud -> not blue sky.
        assertFalse(SceneAnalyzer.isBlueSky(0.40f, 0.41f, 0.42f))
        // Dark blue shadow / night blue -> too dark.
        assertFalse(SceneAnalyzer.isBlueSky(0.005f, 0.008f, 0.025f))
        // Warm sunlit wall -> not blue sky.
        assertFalse(SceneAnalyzer.isBlueSky(0.40f, 0.28f, 0.12f))
        // Purple / magenta -> outside sky hue band.
        assertFalse(SceneAnalyzer.isBlueSky(0.25f, 0.10f, 0.35f))
    }
}
