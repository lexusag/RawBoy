package app.rawboy.camera.report

import app.rawboy.camera.platform.ActivePlatform
import app.rawboy.camera.platform.ChipVendor
import app.rawboy.camera.platform.PhoneDescription
import app.rawboy.camera.platform.PlatformDetector
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import app.rawboy.camera.capture.VideoProbeState
import app.rawboy.camera.capture.VideoVariant
import java.util.Locale

class DeviceReportTest {
    /**
     * A phone shaped like the OnePlus 11 (its Build strings, lens layout and most camera values as session 01 found
     * them); some values are made up to reach other names (hardware level FULL, capability 99, a failed camera).
     */
    private val onePlus = PhoneDescription(
        chip = PlatformDetector.chipOf("QTI", "qcom"), socManufacturer = "QTI", socModel = "SM8550", hardware = "qcom",
        board = "kalama", manufacturer = "OnePlus", brand = "OnePlus", model = "CPH2447", device = "OP594DL1", sdk = 36,
        firmware = "CPH2447_16.0.5.1301(EX01)",
    )

    private val data = DeviceReportData(
        appVersion = "1.16.8 (116080)",
        packageName = "app.rawboy.camera.dev",
        debuggable = true,
        date = "2026-11-16",
        platform = ActivePlatform.resolve(onePlus, null),
        cameraIds = listOf("0", "1", "2", "3"),
        cameras = listOf(
            CameraFacts(
                id = "3", facing = 1, hardwareLevel = 1, capabilities = listOf(0, 1, 3, 99), focalLengthsMm = listOf(2.59f),
                apertures = listOf(2.2f), sensorSizeMm = "6.4x4.8", colorFilter = 0, blackLevels = listOf(64, 64, 64, 64),
                whiteLevel = 1023, rawSizes = listOf("4000x3000"), previewSizes = listOf("1920x1440", "1280x960"),
                toneMapModes = listOf(0, 1, 2), maxCurvePoints = 64, isoRange = "100..6400",
                exposureRangeNs = 13_000L to 2_500_000_000L, fpsRanges = listOf("10-30", "30-30"), aeCompensationStep = "1/6",
                aeCompensationRange = "-18..18", oisModes = listOf(0), lensShadingApplied = true, focusCalibration = 1,
                minFocusDistance = 25f, sessionKeys = listOf("android.control.aeTargetFpsRange"), vendorSessionKeys = 12,
            ),
            CameraFacts(id = "0/2", failure = "IllegalArgumentException"),
        ),
        lenses = listOf(
            LensFacts(1, "W", "3", 14.2f, 2.2f, "4000x3000", "1920x1440", null, flash = true),
            LensFacts(1, "T", "0", 23.4f, 1.8f, "4096x3072", "1920x1440", null, flash = true),
            LensFacts(0, "W", "1", 24f, 2.4f, "2304x1728", "1440x1080", null, flash = false),
        ),
        skipped = listOf(SkippedCamera("2", "same lens as 0 (23 mm)")),
        gl = GlFacts(
            vendor = "Qualcomm", renderer = "Adreno (TM) 740", version = "OpenGL ES 3.2 V@0676.76.1", shadingLanguage = null,
            maxTextureSize = 16384, eglVersion = "1.5",
            extensions = DeviceReport.EXTENSIONS.map { it to (it != "GL_EXT_YUV_target") },
            eglConfigs = listOf(EglConfigGroup(8, 8, 8, 8, 12, 4), EglConfigGroup(8, 8, 8, 0, 12, 0)),
        ),
        encoders = listOf(
            EncoderFacts("c2.qti.hevc.encoder", "video/hevc", hardware = true, vendor = true, alias = false, takes1080p30 = true, colorFormats = listOf(0x7f000789, 0x36, 0x7f00aaa2, 7)),
        ),
        calibration = listOf("previewScales3" to "W=3.93;T=1.5", "flashGuides@neutral+tensor" to "W=80.0"),
    )

    @Test
    fun rendersWhatSession01FoundByHand() {
        val text = DeviceReport.render(data)
        val lines = text.lines()
        for (expected in listOf(
            "format: ${DeviceReport.FORMAT}",
            "app: 1.16.8 (116080), app.rawboy.camera.dev, debug build",
            "chip: Qualcomm Snapdragon (QUALCOMM)",
            "soc manufacturer: QTI",
            "soc model: SM8550",
            "firmware: CPH2447_16.0.5.1301(EX01)",
            "choice: automatic",
            "layers: neutral + qualcomm + oneplus + cph2447",
            "calibration: own",
            "lenses: LensProfile(standaloneOverLogical=true, motionGain={})",
            "preview: PreviewProfile(color=CameraSaturation(SrgbPreviewColor, {3=1.25}), curveAtEvenPoints=true, level=STILL_WHITE_BALANCED, liftsShadows=false, rawViewfinder=false)",
            "camera ids: 0, 1, 2, 3",
            "back W: camera 3, 14.2 mm, f/2.2, RAW 4000x3000, preview 1920x1440, max res -, flash yes",
            "back T: camera 0, 23.4 mm, f/1.8, RAW 4096x3072, preview 1920x1440, max res -, flash yes",
            "front W: camera 1, 24 mm, f/2.4, RAW 2304x1728, preview 1440x1080, max res -, flash no",
            "skipped 2: same lens as 0 (23 mm)",
            "== Camera 3 ==",
            "hardware level: FULL",
            "capabilities: BACKWARD_COMPATIBLE, MANUAL_SENSOR, RAW, 99",
            "focal lengths mm: 2.59",
            "black level: 64 64 64 64",
            "white level: 1023",
            "tone map modes: CONTRAST_CURVE, FAST, HIGH_QUALITY",
            "max curve points: 64",
            "ISO range: 100..6400",
            "exposure range: 1/76923 s .. 2.5 s",
            "fps ranges: 10-30, 30-30",
            "AE compensation: step 1/6 EV, range -18..18",
            "OIS modes: OFF",
            "lens shading applied: yes",
            "focus calibration: APPROXIMATE",
            "min focus distance: 25 dpt",
            "session keys: android.control.aeTargetFpsRange, +12 vendor keys",
            "== Camera 0/2 ==",
            "not read: IllegalArgumentException",
            "GL_RENDERER: Adreno (TM) 740",
            "GLSL: -",
            "GL_EXT_YUV_target: no",
            "EGL_ANDROID_recordable: yes",
            "EGL configs RGBA 8888: 12, recordable 4",
            "EGL configs RGBA 8880: 12, recordable 0",
            "c2.qti.hevc.encoder (video/hevc): hardware, vendor; 1080p30 yes",
            "  colour formats: 0x7f000789 Surface, 0x36 YUVP010, 0x7f00aaa2 32bitABGR2101010, 0x7",
            "flashGuides@neutral+tensor: W=80.0",
            "previewScales3: T=1.5",
            "previewScales3: W=3.93",
        )) assertTrue("missing line: $expected\n$text", expected in lines)
        // Not read yet, but every line still a key and a value.
        assertTrue("flash: -" in lines)
        assertFalse("Not read" in text.substringAfter("== Calibration =="))
    }

    @Test
    fun emptyAndMissingFieldsStillRender() {
        val bare = DeviceReportData(
            appVersion = "", packageName = "", debuggable = false, date = "",
            platform = ActivePlatform.resolve(PhoneDescription(ChipVendor.UNKNOWN), null),
            cameraIds = emptyList(), cameras = listOf(CameraFacts("0")), lenses = emptyList(), skipped = emptyList(),
            gl = null, encoders = emptyList(), calibration = listOf("previewScales3" to ""),
            failures = listOf("cameras: SecurityException"),
        )
        val lines = DeviceReport.render(bare).lines()
        for (expected in listOf(
            "chip: unknown (UNKNOWN)", "soc model: -", "android sdk: -", "camera ids: -", "none listed", "facing: -",
            "capabilities: -", "exposure range: -", "not read", "previewScales3: -", "== Not read ==",
            "cameras: SecurityException",
        )) assertTrue("missing line: $expected", expected in lines)
        // Every line under a section is "key: value" (or a section's own note).
        assertTrue(lines.none { it.endsWith(": ") })
    }

    @Test
    fun numbersReadTheSameInEveryLocale() {
        val before = Locale.getDefault()
        try {
            Locale.setDefault(Locale.forLanguageTag("ru-RU"))
            val ru = DeviceReport.render(data)
            Locale.setDefault(Locale.ROOT)
            assertEquals(DeviceReport.render(data), ru)
            assertTrue("focal lengths mm: 2.59" in ru.lines())
        } finally {
            Locale.setDefault(before)
        }
    }

    @Test
    fun exposureTimes() {
        assertEquals("1/30 s", DeviceReport.seconds(33_333_333L))
        assertEquals("1/15 s", DeviceReport.seconds(66_666_667L))
        assertEquals("1 s", DeviceReport.seconds(1_000_000_000L))
        assertEquals("32 s", DeviceReport.seconds(32_000_000_000L))
        assertEquals("0 ns", DeviceReport.seconds(0L))
    }

    @Test
    fun videoProbeLines() {
        val probed = data.copy(
            video = VideoProbeState(VideoVariant.OWN_CONTEXT, confirmed = true, buildKey = "k", lastTries = listOf("STANDARD: encoder error", "OWN_CONTEXT: ok")),
            videoForThisBuild = true,
        )
        val lines = DeviceReport.render(probed).lines()
        for (expected in listOf(
            "== Video probe ==", "variant: OWN_CONTEXT (recorded)", "stored for this build: yes", "failed in a row: 0",
            "last probe: STANDARD: encoder error", "last probe: OWN_CONTEXT: ok",
        )) assertTrue("missing line: $expected", expected in lines)
        val pending = DeviceReport.render(data.copy(video = VideoProbeState(VideoVariant.RECORDABLE_VIEWFINDER), videoForThisBuild = false)).lines()
        assertTrue("variant: RECORDABLE_VIEWFINDER (next, on the remade viewfinder)" in pending)
        assertTrue("last probe: -" in pending)
        val none = DeviceReport.render(data.copy(video = VideoProbeState())).lines()
        assertTrue("variant: STANDARD (nothing stored)" in none)
        assertTrue("not read" in DeviceReport.render(data).lines().dropWhile { it != "== Video probe ==" }.take(2))
    }
}
