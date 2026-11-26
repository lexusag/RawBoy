package app.rawboy.camera

import app.rawboy.auto.looks.Looks
import app.rawboy.camera.platform.PreviewLevel
import app.rawboy.camera.platform.generic.neutralPlatform
import app.rawboy.develop.DevelopParams
import app.rawboy.export.DateStampFormat
import app.rawboy.export.DateStampStyle
import app.rawboy.export.Pentax645Field
import app.rawboy.export.PhotoFrame
import app.rawboy.export.TimeStampFormat
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class CameraSettingsTest {
    @Test
    fun easyModeForcesThePlainShotAndKeepsTheStoredValues() {
        val pro = CameraSettings(
            brightness = 40f, warmth = -20f, keepDng = true, burstMode = BurstMode.ON, selfTimer = 5, longExposure = 10,
            experimental = true, randomLightLeak = true, photoFrame = PhotoFrame.DATE_STAMP, trackFocus = true,
            flatVideo = true, videoMotionData = true, saveDepth = true, depthPortrait = true,
            showHistogram = true, showGrid = true, showLevel = true,
            showZoomControl = true, smallExport = false, jpegQuality = 90, lens = "T", film = false,
        )
        // Off: nothing changes.
        assertEquals(pro, pro.effective)
        val easy = pro.copy(easy = true)
        val e = easy.effective
        assertEquals(0f, e.brightness)
        assertEquals(0f, e.warmth)
        assertEquals(0f, e.exposureCompensationEv)
        assertEquals(BurstMode.AUTO, e.burstMode)
        assertEquals(0, e.activeSelfTimer)
        assertEquals(null, e.longExposureSpec(null, PreviewLevel.BOOSTED, 1f))
        assertFalse(e.randomLightLeak)
        assertFalse(e.trackFocus || e.flatVideo || e.videoMotionData || e.saveDepth || e.depthPortrait)
        assertFalse(e.showHistogram || e.showGrid || e.showLevel || e.showZoomControl)
        // Colour: Film mode on the default film stock; B&W: Film + B&W on the default mono stock.
        assertEquals(Edition.filmLook(Edition.defaultFilmLookId), e.look)
        assertTrue(e.filmMode)
        val bw = easy.copy(easyMono = true).effective
        assertTrue(bw.filmMono)
        assertEquals(Edition.monoLook(Edition.defaultMonoLookId), bw.look)
        assertFalse(pro.copy(easyMono = true).effective.monoMode)
        // What Easy mode leaves alone: RAW, frames, size, quality, lens.
        assertTrue(e.keepDng)
        assertEquals(PhotoFrame.DATE_STAMP, e.photoFrame)
        assertFalse(e.smallExport)
        assertEquals(90, e.jpegQuality)
        assertEquals("T", e.lens)
        // The stored settings keep the user's own values for when Easy mode is off again.
        assertEquals(40f, easy.brightness)
        assertEquals(BurstMode.ON, easy.burstMode)
        assertEquals(pro, easy.copy(easy = false).effective)
    }

    @Test
    fun defaultsHaveFramesDisabled() {
        val s = CameraSettings()
        assertEquals(PhotoFrame.NONE, s.photoFrame)
        assertEquals(PhotoFrame.PENTAX_645, s.lastPhotoFrame)
        assertEquals(DateStampFormat.DMY, s.dateStampFormat)
        assertEquals(DateStampStyle.CLASSIC, s.dateStampStyle)
        assertEquals(TimeStampFormat.H24, s.timeStampFormat)
        assertFalse(s.pentax645Flip)
        assertFalse(s.showZoomControl)
        assertEquals(Pentax645Field.DEFAULT, s.pentax645Fields)
        assertEquals(Pentax645Field.DEFAULT_ORDER, s.pentax645Order)
        val subset = setOf(Pentax645Field.SHUTTER, Pentax645Field.ISO, Pentax645Field.DATE, Pentax645Field.TIME)
        assertEquals(subset, Pentax645Field.parseSet(Pentax645Field.serialize(subset)))
        // Legacy "datetime" key migrates to both DATE and TIME.
        assertEquals(setOf(Pentax645Field.DATE, Pentax645Field.TIME), Pentax645Field.parseSet("datetime"))
        val customOrder = listOf(Pentax645Field.TIME, Pentax645Field.DATE, Pentax645Field.FRAME_NUMBER)
        val parsedOrder = Pentax645Field.parseOrder(Pentax645Field.serializeOrder(customOrder))
        assertEquals(Pentax645Field.entries.size, parsedOrder.size)
        assertEquals(customOrder, parsedOrder.take(3))
    }

    @Test
    fun grainIsOnByDefaultAndOffRemovesIt() {
        val base = DevelopParams(grain = 20f, filmGrain = 75f)
        val on = CameraSettings()
        assertEquals(true, on.grain)
        val off = on.copy(grain = false).develop(base, false, neutralPlatform.noise)
        assertEquals(0f, off.grain, 0f)
        assertEquals(0f, off.filmGrain, 0f)
    }

    @Test
    fun monoFxFollowsBwMode() {
        val base = DevelopParams()
        assertFalse(CameraSettings().develop(base, false, neutralPlatform.noise).monoFx)
        // B&W (also with Film on): the leaks and effects go grey with the picture.
        assertTrue(CameraSettings(mono = true).develop(base, false, neutralPlatform.noise).monoFx)
        assertTrue(CameraSettings(mono = true, film = true).develop(base, false, neutralPlatform.noise).monoFx)
    }

    @Test
    fun resetToDefaultsKeepsCalibration() {
        val scales = mapOf("W" to 0.42f, "FW" to 0.6f)
        val guides = mapOf("W" to 12.5f)
        val modified = CameraSettings(
            jpegQuality = 80,
            strength = 50f,
            brightness = 20f,
            warmth = -15f,
            mono = true,
            film = false,
            keepDng = true,
            smallExport = false,
            rememberLast = true,
            showGrid = true,
            showLevel = true,
            showHistogram = true,
            videoQuality = VideoQuality.HIGH,
            grain = false,
            scanQr = false,
            photoFrame = PhotoFrame.PENTAX_645,
            front = true,
            lens = "T",
            previewScales = scales,
            flashGuides = guides,
        )
        val reset = modified.resetToDefaults()
        assertEquals(CameraSettings(previewScales = scales, flashGuides = guides), reset)
        assertEquals(scales, reset.previewScales)
        assertEquals(guides, reset.flashGuides)
    }

    @Test
    fun rawCaptureModeDefaultsAndHelpers() {
        // Default (RAW off): saves JPEG only, no DNG preview, not Pure RAW.
        val jpegOnly = CameraSettings()
        assertFalse(jpegOnly.keepDng)
        assertFalse(jpegOnly.rawWithJpeg)
        assertEquals(RawPreview.P3000, jpegOnly.rawPreview)
        assertEquals(85, CameraSettings.RAW_PREVIEW_QUALITY)
        assertEquals(3000, RawPreview.P3000.maxLongSide)
        assertEquals(4000, RawPreview.MP12.maxLongSide)
        assertEquals(null, RawPreview.NONE.maxLongSide)
        assertTrue(jpegOnly.saveJpeg)
        assertFalse(jpegOnly.embedDngPreview)
        assertFalse(jpegOnly.pureRaw)

        // RAW on (default): RAW only with 3000 px embedded preview.
        val rawDefault = jpegOnly.copy(keepDng = true)
        assertFalse(rawDefault.saveJpeg)
        assertTrue(rawDefault.embedDngPreview)
        assertFalse(rawDefault.pureRaw)

        // RAW + JPEG with 12 MP embedded preview.
        val rawAndJpeg = rawDefault.copy(rawWithJpeg = true, rawPreview = RawPreview.MP12)
        assertTrue(rawAndJpeg.saveJpeg)
        assertTrue(rawAndJpeg.embedDngPreview)
        assertFalse(rawAndJpeg.pureRaw)

        // Pure RAW: RAW only, no embedded preview -> skips develop.
        val pureRaw = rawDefault.copy(rawPreview = RawPreview.NONE)
        assertFalse(pureRaw.saveJpeg)
        assertFalse(pureRaw.embedDngPreview)
        assertTrue(pureRaw.pureRaw)

        // RAW + JPEG with embedded preview off: still saves JPEG, so not Pure RAW.
        val rawAndJpegNoPreview = rawAndJpeg.copy(rawPreview = RawPreview.NONE)
        assertTrue(rawAndJpegNoPreview.saveJpeg)
        assertFalse(rawAndJpegNoPreview.embedDngPreview)
        assertFalse(rawAndJpegNoPreview.pureRaw)

        // Easy mode preserves RAW sub-options.
        val easyPure = pureRaw.copy(easy = true).effective
        assertTrue(easyPure.keepDng)
        assertFalse(easyPure.rawWithJpeg)
        assertEquals(RawPreview.NONE, easyPure.rawPreview)
        assertTrue(easyPure.pureRaw)
    }

    @Test
    fun automaticCalibrationKeepsItsStorageKeys() {
        // The owner's learned calibration lives under these keys; a debug build's chosen profile learns beside them.
        assertEquals("previewScales3", CameraSettingsStore.scalesKey(""))
        assertEquals("flashGuides", CameraSettingsStore.flashGuidesKey(""))
        assertEquals("previewScales3@neutral+tensor", CameraSettingsStore.scalesKey("neutral+tensor"))
        assertEquals("flashGuides@neutral", CameraSettingsStore.flashGuidesKey("neutral"))
        assertEquals("previewScales3", CameraSettingsStore.scalesKey("", PreviewLevel.BOOSTED))
    }

    @Test
    fun eachPreviewLevelLearnsItsOwnScales() {
        // A scale learned under one level means something else under another (OnePlus: ~0.4 boosted, ~1.0 white balanced).
        assertEquals("previewScalesWb", CameraSettingsStore.scalesKey("", PreviewLevel.STILL_WHITE_BALANCED))
        assertEquals("previewScalesWb@neutral+tensor", CameraSettingsStore.scalesKey("neutral+tensor", PreviewLevel.STILL_WHITE_BALANCED))
        assertEquals(PreviewLevel.entries.size, PreviewLevel.entries.map { it.scalesKey }.toSet().size)
    }

    @Test
    fun descriptionNoteIncludesModeAndLut() {
        assertEquals("cameraMode=film lut=${Edition.defaultFilmLookId}", CameraSettings().descriptionNote())
        // Film mode only knows film stocks (plus Natural): a colour-only look id falls back to the default stock.
        val stock = Edition.filmLooks.last().id
        assertEquals("cameraMode=film lut=$stock", CameraSettings(film = true, filmLookId = stock).descriptionNote())
        assertEquals(
            "cameraMode=film lut=${Looks.NATURAL.id}",
            CameraSettings(film = true, filmLookId = Looks.NATURAL.id).descriptionNote(),
        )
        assertEquals(
            "cameraMode=film lut=${Edition.defaultFilmLookId}",
            CameraSettings(film = true, filmLookId = Looks.MOVIE_GREEN.id).descriptionNote(),
        )
        assertEquals(
            "cameraMode=look lut=${Looks.EKTAR_100.id}",
            CameraSettings(film = false, lookId = Looks.EKTAR_100.id).descriptionNote(),
        )
        assertEquals(
            "cameraMode=look lut=${Looks.NATURAL.id}",
            CameraSettings(film = false, lookId = Looks.NATURAL.id).descriptionNote(),
        )
        assertEquals(
            "cameraMode=bw lut=${Edition.defaultMonoLookId}",
            CameraSettings(mono = true, film = true).descriptionNote(),
        )
    }

    @Test
    fun videoQualityDefaultsAndBitrates() {
        assertEquals(VideoQuality.OPTIMAL, CameraSettings().videoQuality)
        assertEquals(listOf(VideoQuality.LOW, VideoQuality.OPTIMAL, VideoQuality.HIGH), VideoQuality.entries)
        assertEquals(listOf("Low", "Optimal", "High"), VideoQuality.entries.map { it.label })
        assertTrue(VideoQuality.LOW.bitrate(false) < VideoQuality.OPTIMAL.bitrate(false))
        assertTrue(VideoQuality.OPTIMAL.bitrate(false) < VideoQuality.HIGH.bitrate(false))
        assertTrue(VideoQuality.LOW.bitrate(true) < VideoQuality.OPTIMAL.bitrate(true))
        assertTrue(VideoQuality.OPTIMAL.bitrate(true) < VideoQuality.HIGH.bitrate(true))
        for (q in VideoQuality.entries) {
            assertTrue(q.bitrate(true) > q.bitrate(false))
        }
    }

    @Test
    fun randomLightLeakRateDefaultsAndExactCountsPerFivePhotoSequence() {
        assertEquals(CameraSettings.LIGHT_LEAK_SEQUENCE_SIZE, CameraSettings().randomLightLeakRate)
        assertEquals(listOf(1, 2, 3, 4, 5), CameraSettings.LIGHT_LEAK_RATES)

        val rng = kotlin.random.Random(42)
        for (rate in CameraSettings.LIGHT_LEAK_RATES) {
            var state: String? = null
            repeat(20) {
                var leaks = 0
                repeat(CameraSettings.LIGHT_LEAK_SEQUENCE_SIZE) {
                    val (leak, next) = LightLeakSequence.next(state, rate, random = rng)
                    if (leak) leaks++
                    state = next
                }
                assertEquals("rate $rate should produce exactly $rate leaks per 5 shots", rate, leaks)
                assertEquals("", state)
            }
        }
    }

    @Test
    fun randomLightLeakOneOfFiveHitsAllPositionsUnpredictably() {
        val rng = kotlin.random.Random(12345)
        var state: String? = null
        val positions = mutableSetOf<Int>()
        repeat(50) {
            var hitIndex = -1
            repeat(CameraSettings.LIGHT_LEAK_SEQUENCE_SIZE) { idx ->
                val (leak, next) = LightLeakSequence.next(state, rate = 1, random = rng)
                if (leak) hitIndex = idx
                state = next
            }
            assertTrue(hitIndex in 0 until CameraSettings.LIGHT_LEAK_SEQUENCE_SIZE)
            positions += hitIndex
        }
        assertEquals(setOf(0, 1, 2, 3, 4), positions)
    }

    @Test
    fun randomLightLeakSequenceResetsOnRateChangeOrCorruptState() {
        val rng = kotlin.random.Random(7)
        val (_, midState) = LightLeakSequence.next(null, rate = 1, random = rng)
        assertTrue(midState.startsWith("1:"))

        // Switching rate mid-sequence deals a fresh 5-shot sequence for the new rate.
        var state: String? = midState
        var leaks = 0
        repeat(CameraSettings.LIGHT_LEAK_SEQUENCE_SIZE) {
            val (leak, next) = LightLeakSequence.next(state, rate = 3, random = rng)
            if (leak) leaks++
            state = next
        }
        assertEquals(3, leaks)

        // Malformed states fall back cleanly without crashing.
        for (bad in listOf("", "bad", "2:", ":0101", "2:abc", "2:010101")) {
            val (_, next) = LightLeakSequence.next(bad, rate = 2, random = rng)
            assertTrue(next.startsWith("2:"))
        }
    }
}

