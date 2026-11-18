package app.rawboy.camera.capture

import app.rawboy.camera.capture.VideoProbe.Attempt
import app.rawboy.camera.capture.VideoProbe.Result
import app.rawboy.camera.capture.VideoVariant.OWN_CONTEXT
import app.rawboy.camera.capture.VideoVariant.RECORDABLE_VIEWFINDER
import app.rawboy.camera.capture.VideoVariant.SOFTWARE_AVC
import app.rawboy.camera.capture.VideoVariant.STANDARD
import app.rawboy.gl.EncoderConfig
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** The video probe on a stand-in encoder: which variants it tries, which it keeps, and what it remembers. */
class VideoProbeTest {
    private class MemoryStore(var state: VideoProbeState = VideoProbeState()) : VideoProbeStore {
        override fun read() = state
        override fun write(state: VideoProbeState) {
            this.state = state
        }
    }

    /** A stand-in encoder: each variant's outcome from [outcomes] (missing = starts), and the variants it was asked for. */
    private class Encoder(private val outcomes: Map<VideoVariant, VideoFailure?> = emptyMap(), private val abortAt: VideoVariant? = null) {
        val tried = ArrayList<VideoVariant>()

        suspend fun attempt(v: VideoVariant): Attempt<String> {
            tried += v
            if (v == abortAt) return Attempt.Aborted
            return outcomes[v]?.let { Attempt.Failed(it) } ?: Attempt.Started("recording with $v")
        }
    }

    private fun probe(store: VideoProbeStore, key: String = "build A") = VideoProbe(store, key)

    private fun run(probe: VideoProbe, encoder: Encoder, recordableView: Boolean = false) =
        runBlocking { probe.run(recordableView, encoder::attempt) }

    @Test
    fun standardIsTodaysPathAndFirst() {
        // The Pixel 9 Pro's path: today's surface attempts, the hardware encoder, the viewfinder as GLSurfaceView makes it.
        assertEquals(listOf(STANDARD, OWN_CONTEXT, RECORDABLE_VIEWFINDER, SOFTWARE_AVC), VideoVariant.ORDER)
        assertEquals(EncoderConfig.DEFAULT_ORDER, STANDARD.encoderConfigs)
        assertFalse(STANDARD.softwareAvc)
        assertFalse(STANDARD.recordableViewfinder)
        assertEquals(VideoVariant.ORDER, probe(MemoryStore()).plan())
        assertFalse(probe(MemoryStore()).recordableViewfinder())
    }

    @Test
    fun standardWorkingStopsTheProbe() {
        val store = MemoryStore()
        val encoder = Encoder()
        val result = run(probe(store), encoder)
        assertEquals(Result.Recording(STANDARD, "recording with STANDARD"), result)
        assertEquals(listOf(STANDARD), encoder.tried)
        assertEquals(STANDARD, store.state.variant)
        assertTrue(store.state.confirmed)
        // And the next recording goes the same way.
        val again = Encoder()
        run(probe(store), again)
        assertEquals(listOf(STANDARD), again.tried)
    }

    @Test
    fun failedVariantsAreSkippedAndTheFirstWorkingOneIsKept() {
        val store = MemoryStore()
        val encoder = Encoder(mapOf(STANDARD to VideoFailure.CODEC_ERROR))
        val result = run(probe(store), encoder)
        assertEquals(Result.Recording(OWN_CONTEXT, "recording with OWN_CONTEXT"), result)
        assertEquals(listOf(STANDARD, OWN_CONTEXT), encoder.tried)
        // One recording is only a work-around; the standard path failing again in the next one moves the phone.
        assertNull(store.state.variant)
        assertEquals(1, store.state.strikes)
        val second = Encoder(mapOf(STANDARD to VideoFailure.CODEC_ERROR))
        assertEquals(Result.Recording(OWN_CONTEXT, "recording with OWN_CONTEXT"), run(probe(store), second))
        assertEquals(listOf(STANDARD, OWN_CONTEXT), second.tried)
        assertEquals(VideoProbeState(OWN_CONTEXT, true, "build A", listOf("STANDARD: encoder error", "OWN_CONTEXT: ok")), store.state)
        // Next time the kept one goes first, and nothing else is tried; the report keeps the probe that chose it.
        val again = Encoder(mapOf(STANDARD to VideoFailure.CODEC_ERROR))
        run(probe(store), again)
        assertEquals(listOf(OWN_CONTEXT), again.tried)
        assertEquals(listOf("STANDARD: encoder error", "OWN_CONTEXT: ok"), store.state.lastTries)
    }

    @Test
    fun aOneOffFailureOfStandardIsNotRemembered() {
        // An encoder slow to start or busy elsewhere: this recording moves on, the next starts with the standard path.
        for (failure in listOf(VideoFailure.NO_OUTPUT, VideoFailure.NO_ENCODER)) {
            val store = MemoryStore(VideoProbeState(STANDARD, confirmed = true, buildKey = "build A"))
            val result = run(probe(store), Encoder(mapOf(STANDARD to failure)))
            assertEquals(Result.Recording(OWN_CONTEXT, "recording with OWN_CONTEXT"), result)
            assertEquals(STANDARD, store.state.variant)
            assertEquals(VideoVariant.ORDER, probe(store).plan())
        }
        val fresh = MemoryStore()
        run(probe(fresh), Encoder(mapOf(STANDARD to VideoFailure.NO_OUTPUT)))
        assertNull(fresh.state.variant)
    }

    @Test
    fun theViewfinderIsRemadeOnlyOnEvidence() {
        // One-off failures: the variant that needs a new viewfinder is passed over.
        val store = MemoryStore()
        val encoder = Encoder(mapOf(STANDARD to VideoFailure.NO_OUTPUT, OWN_CONTEXT to VideoFailure.NO_OUTPUT))
        assertEquals(Result.Recording(SOFTWARE_AVC, "recording with SOFTWARE_AVC"), run(probe(store), encoder))
        assertEquals(listOf(STANDARD, OWN_CONTEXT, SOFTWARE_AVC), encoder.tried)
        assertFalse(probe(store).recordableViewfinder())
    }

    @Test
    fun aVariantNeedingTheViewfinderWaitsForTheNextRecording() {
        val store = MemoryStore()
        val failing = mapOf(STANDARD to VideoFailure.EGL_SURFACE, OWN_CONTEXT to VideoFailure.CODEC_ERROR)
        // The first failing recording only works around the standard path: no new viewfinder yet.
        val workaround = Encoder(failing)
        assertEquals(Result.Recording(SOFTWARE_AVC, "recording with SOFTWARE_AVC"), run(probe(store), workaround))
        assertEquals(listOf(STANDARD, OWN_CONTEXT, SOFTWARE_AVC), workaround.tried)
        assertFalse(probe(store).recordableViewfinder())
        val first = Encoder(failing)
        assertEquals(Result.NeedsViewfinder(RECORDABLE_VIEWFINDER), run(probe(store), first))
        assertEquals(listOf(STANDARD, OWN_CONTEXT), first.tried)
        assertEquals(RECORDABLE_VIEWFINDER, store.state.variant)
        assertFalse(store.state.confirmed)
        assertTrue(probe(store).recordableViewfinder())
        // On the remade viewfinder the probe goes on where it stopped.
        assertEquals(listOf(RECORDABLE_VIEWFINDER, SOFTWARE_AVC), probe(store).plan())
        val second = Encoder(failing)
        assertEquals(Result.Recording(RECORDABLE_VIEWFINDER, "recording with RECORDABLE_VIEWFINDER"), run(probe(store), second, recordableView = true))
        assertEquals(listOf(RECORDABLE_VIEWFINDER), second.tried)
        assertTrue(store.state.confirmed)
        assertEquals(
            listOf("STANDARD: EGL surface refused", "OWN_CONTEXT: encoder error", "RECORDABLE_VIEWFINDER: needs the viewfinder made again", "RECORDABLE_VIEWFINDER: ok"),
            store.state.lastTries,
        )
        assertTrue(probe(store).recordableViewfinder())
    }

    @Test
    fun allFailedIsAnErrorAndForgetsTheViewfinder() {
        val store = MemoryStore(VideoProbeState(RECORDABLE_VIEWFINDER, confirmed = false, buildKey = "build A"))
        val encoder = Encoder(mapOf(RECORDABLE_VIEWFINDER to VideoFailure.CODEC_ERROR, SOFTWARE_AVC to VideoFailure.NO_ENCODER))
        val result = run(probe(store), encoder, recordableView = true)
        assertEquals(Result.AllFailed(listOf(RECORDABLE_VIEWFINDER to VideoFailure.CODEC_ERROR, SOFTWARE_AVC to VideoFailure.NO_ENCODER)), result)
        assertNull(store.state.variant)
        assertFalse(probe(store).recordableViewfinder())
        assertEquals(listOf("RECORDABLE_VIEWFINDER: encoder error", "SOFTWARE_AVC: no encoder"), store.state.lastTries)
        assertTrue(store.state.lastTries.none { it.contains("ok") })
    }

    @Test
    fun everyVariantFailingWithoutEvidenceIsAnErrorToo() {
        val all = VideoVariant.ORDER.associateWith { VideoFailure.NO_OUTPUT }
        val encoder = Encoder(all)
        val result = run(probe(MemoryStore()), encoder)
        assertTrue(result is Result.AllFailed)
        assertEquals(listOf(STANDARD, OWN_CONTEXT, SOFTWARE_AVC), encoder.tried)
    }

    @Test
    fun aRememberedVariantThatFailsStartsTheProbeOver() {
        val store = MemoryStore(VideoProbeState(OWN_CONTEXT, confirmed = true, buildKey = "build A"))
        val encoder = Encoder(mapOf(OWN_CONTEXT to VideoFailure.CODEC_ERROR))
        assertEquals(Result.Recording(STANDARD, "recording with STANDARD"), run(probe(store), encoder))
        assertEquals(listOf(OWN_CONTEXT, STANDARD), encoder.tried)
        // The standard path recording is always worth keeping: it is the default.
        assertEquals(STANDARD, store.state.variant)
    }

    @Test
    fun oneBadStartNeverMovesAPhoneOffItsVariant() {
        // A Pixel: the standard path recorded, then threw once at the start of a recording.
        val pixel = MemoryStore(VideoProbeState(STANDARD, confirmed = true, buildKey = "build A"))
        val once = Encoder(mapOf(STANDARD to VideoFailure.CODEC_ERROR, OWN_CONTEXT to VideoFailure.CODEC_ERROR))
        assertEquals(Result.Recording(SOFTWARE_AVC, "recording with SOFTWARE_AVC"), run(probe(pixel), once))
        assertEquals(listOf(STANDARD, OWN_CONTEXT, SOFTWARE_AVC), once.tried) // no new viewfinder for one bad start
        assertEquals(STANDARD, pixel.state.variant)
        assertTrue(pixel.state.confirmed)
        assertEquals(1, pixel.state.strikes)
        assertFalse(probe(pixel).recordableViewfinder())
        // Back to normal: the count starts again (the report still shows the work-around's tries).
        run(probe(pixel), Encoder())
        assertEquals(STANDARD, pixel.state.variant)
        assertEquals(0, pixel.state.strikes)

        // A OnePlus: its own-context variant recorded, then one slow start; the standard path fails as always.
        val onePlus = MemoryStore(VideoProbeState(OWN_CONTEXT, confirmed = true, buildKey = "build A"))
        val slow = Encoder(mapOf(OWN_CONTEXT to VideoFailure.NO_OUTPUT, STANDARD to VideoFailure.CODEC_ERROR))
        assertEquals(Result.Recording(SOFTWARE_AVC, "recording with SOFTWARE_AVC"), run(probe(onePlus), slow, recordableView = false))
        assertEquals(listOf(OWN_CONTEXT, STANDARD, SOFTWARE_AVC), slow.tried)
        assertEquals(OWN_CONTEXT, onePlus.state.variant)
        assertTrue(onePlus.state.confirmed)
        assertFalse(probe(onePlus).recordableViewfinder())
    }

    @Test
    fun aVariantFailingRecordingAfterRecordingGivesWay() {
        val store = MemoryStore(VideoProbeState(STANDARD, confirmed = true, buildKey = "build A"))
        val broken = mapOf(STANDARD to VideoFailure.EGL_SURFACE)
        repeat(VideoProbe.STRIKES - 1) { run(probe(store), Encoder(broken)) }
        assertEquals(STANDARD, store.state.variant)
        run(probe(store), Encoder(broken))
        assertEquals(OWN_CONTEXT, store.state.variant)
        assertEquals(0, store.state.strikes)
    }

    @Test
    fun anUpdateForgetsWhatWasLearned() {
        val store = MemoryStore(VideoProbeState(RECORDABLE_VIEWFINDER, confirmed = true, buildKey = "build A"))
        val updated = probe(store, key = "build B")
        assertEquals(VideoVariant.ORDER, updated.plan())
        assertFalse(updated.recordableViewfinder())
        val encoder = Encoder()
        run(updated, encoder)
        assertEquals(listOf(STANDARD), encoder.tried)
        assertEquals(VideoProbeState(STANDARD, true, "build B", listOf("STANDARD: ok")), store.state)
    }

    @Test
    fun aNarrowedListIgnoresAVariantOutsideIt() {
        // A debug override of the list: a remembered variant not in it doesn't sneak in first.
        val store = MemoryStore(VideoProbeState(OWN_CONTEXT, confirmed = true, buildKey = "build A"))
        val narrowed = VideoProbe(store, "build A", listOf(STANDARD, SOFTWARE_AVC))
        assertEquals(listOf(STANDARD, SOFTWARE_AVC), narrowed.plan())
    }

    @Test
    fun anAbortedAttemptKeepsWhatWasKnown() {
        val before = VideoProbeState(OWN_CONTEXT, confirmed = true, buildKey = "build A")
        val store = MemoryStore(before)
        assertEquals(Result.Aborted, run(probe(store), Encoder(abortAt = OWN_CONTEXT)))
        assertEquals(OWN_CONTEXT, store.state.variant)
        assertTrue(store.state.confirmed)
    }

    @Test
    fun progressOfARecording() {
        fun p(egl: Boolean = false, codec: Boolean = false, encoded: Int = 0, sent: Long? = null, now: Long = 1000) =
            VideoRecorder.progressOf(egl, codec, encoded, sent, startMs = 0, nowMs = now)
        assertEquals(VideoProgress.Waiting, p())
        assertEquals(VideoProgress.Waiting, p(sent = 500, now = 500 + VideoRecorder.NO_OUTPUT_MS))
        assertEquals(VideoProgress.Encoding, p(encoded = 1, sent = 500))
        assertEquals(VideoProgress.Broken(VideoFailure.CODEC_ERROR), p(codec = true, encoded = 30, sent = 500))
        // A surface lost mid-recording stops it too (the renderer stops drawing into it).
        assertEquals(VideoProgress.Broken(VideoFailure.EGL_SURFACE), p(egl = true, encoded = 30, sent = 500))
        assertEquals(VideoProgress.Failed(VideoFailure.EGL_SURFACE), p(egl = true))
        assertEquals(VideoProgress.Failed(VideoFailure.CODEC_ERROR), p(codec = true, sent = 500))
        assertEquals(VideoProgress.Failed(VideoFailure.NO_OUTPUT), p(sent = 500, now = 501 + VideoRecorder.NO_OUTPUT_MS))
        assertEquals(VideoProgress.NoCamera, p(now = VideoRecorder.NO_CAMERA_MS + 1))
        assertTrue(VideoFailure.EGL_SURFACE.definite && VideoFailure.CODEC_ERROR.definite)
        assertFalse(VideoFailure.NO_OUTPUT.definite || VideoFailure.NO_ENCODER.definite)
    }
}
