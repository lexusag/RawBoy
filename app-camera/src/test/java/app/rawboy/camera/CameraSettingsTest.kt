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
import org.junit.Test

class CameraSettingsTest {
    @Test
    fun defaultsHaveFramesDisabled() {
        val s = CameraSettings()
        assertEquals(PhotoFrame.NONE, s.photoFrame)
        assertEquals(PhotoFrame.PENTAX_645, s.lastPhotoFrame)
        assertEquals(DateStampFormat.DMY, s.dateStampFormat)
        assertEquals(DateStampStyle.CLASSIC, s.dateStampStyle)
        assertEquals(TimeStampFormat.H24, s.timeStampFormat)
        assertFalse(s.pentax645Flip)
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
        // Film mode only knows film stocks: an id that isn't one (a colour look's) falls back to the default stock.
        val stock = Edition.filmLooks.last().id
        assertEquals("cameraMode=film lut=$stock", CameraSettings(film = true, filmLookId = stock).descriptionNote())
        assertEquals(
            "cameraMode=film lut=${Edition.defaultFilmLookId}",
            CameraSettings(film = true, filmLookId = Looks.NATURAL.id).descriptionNote(),
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
        assert(VideoQuality.LOW.bitrate(false) < VideoQuality.OPTIMAL.bitrate(false))
        assert(VideoQuality.OPTIMAL.bitrate(false) < VideoQuality.HIGH.bitrate(false))
        assert(VideoQuality.LOW.bitrate(true) < VideoQuality.OPTIMAL.bitrate(true))
        assert(VideoQuality.OPTIMAL.bitrate(true) < VideoQuality.HIGH.bitrate(true))
        assert(VideoQuality.OPTIMAL.bitrate(true) > VideoQuality.OPTIMAL.bitrate(false))
    }
}
