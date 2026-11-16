package app.rawboy.camera.capture

import app.rawboy.camera.capture.LensChoice.Candidate
import org.junit.Assert.assertEquals
import org.junit.Test
import kotlin.math.abs
import kotlin.random.Random

/** The lens list of known phones' camera layouts. */
class LensChoiceTest {
    private fun labels(found: List<Candidate>, standalone: Boolean = false) =
        LensChoice.choose(found, standalone).lenses.map { "${it.label}=${it.candidate.name}" }

    // Pixel 9 Pro (CLAUDE.md): back logical 0 over its wide and the physical UW 0/3, T 0/5, T2 0/4, T3 0/6 (focal
    // lengths illustrative, in that order); the logical camera stands for the wide.
    private val pixelBack = listOf(
        Candidate("0", physical = false, logical = true, focal = 24f),
        Candidate("0/2", physical = true, logical = false, focal = 24.5f),
        Candidate("0/3", physical = true, logical = false, focal = 13f),
        Candidate("0/5", physical = true, logical = false, focal = 113f),
        Candidate("0/4", physical = true, logical = false, focal = 150f),
        Candidate("0/6", physical = true, logical = false, focal = 200f),
    )

    @Test
    fun pixelKeepsItsLabels() {
        for (standalone in listOf(false, true)) {
            assertEquals(listOf("UW=0/3", "W=0", "T=0/5", "T2=0/4", "T3=0/6"), labels(pixelBack, standalone))
        }
        val front = listOf(
            Candidate("1", physical = false, logical = true, focal = 20f),
            Candidate("1/7", physical = true, logical = false, focal = 20f),
            Candidate("1/8", physical = true, logical = false, focal = 20.5f),
        )
        assertEquals(listOf("W=1"), labels(front))
        val r = LensChoice.choose(front, false)
        assertEquals(listOf("1/7", "1/8"), r.skipped.map { it.first.name })
        assertEquals("same lens as 1 (20.0 mm)", r.skipped[0].second)
    }

    // OnePlus 11 (session 01): logical 0 (23 mm, over 2 and 3), stand-alone 2 (23 mm) and 3 (14 mm).
    private val onePlusBack = listOf(
        Candidate("0", physical = false, logical = true, focal = 23.4f),
        Candidate("2", physical = false, logical = false, focal = 23.4f),
        Candidate("3", physical = false, logical = false, focal = 14.2f),
        Candidate("0/2", physical = true, logical = false, focal = 23.4f),
        Candidate("0/3", physical = true, logical = false, focal = 14.2f),
    )

    @Test
    fun onePlusListsItsStandaloneCameras() {
        assertEquals(listOf("UW=3", "W=2"), labels(onePlusBack, standalone = true))
    }

    @Test
    fun neutralKeepsTheLogicalCameraAsMain() {
        // Before: the widest camera without a physical id became W (W = the 14 mm ultrawide, T = the main).
        assertEquals(listOf("UW=3", "W=0"), labels(onePlusBack))
    }

    @Test
    fun withoutALogicalCameraTheMainIsNearest26mm() {
        val older = listOf(
            Candidate("0", physical = false, logical = false, focal = 26f),
            Candidate("2", physical = false, logical = false, focal = 13f),
            Candidate("3", physical = false, logical = false, focal = 52f),
        )
        assertEquals(listOf("UW=2", "W=0", "T=3"), labels(older))
        // Two logical cameras: neither is the main by rule.
        val twoLogical = listOf(
            Candidate("0", physical = false, logical = true, focal = 24f),
            Candidate("4", physical = false, logical = true, focal = 70f),
        )
        assertEquals(listOf("W=0", "T=4"), labels(twoLogical))
        assertEquals(emptyList<String>(), labels(emptyList()))
    }

    /** CameraController.lenses before session 10: dedupe in found order (physical lenses last), main = first non-physical. */
    private fun former(found: List<Candidate>): List<String> {
        val lenses = ArrayList<Candidate>()
        for (lens in found.sortedBy { if (it.physical) 1 else 0 }) {
            if (lenses.none { abs(it.focal - lens.focal) < 0.12f * lens.focal }) lenses += lens
        }
        if (lenses.isEmpty()) return emptyList()
        lenses.sortBy { it.focal }
        val main = lenses.firstOrNull { !it.physical } ?: lenses.minBy { abs(it.focal - 26f) }
        val mainIndex = lenses.indexOf(main)
        return lenses.mapIndexed { i, c ->
            val label = when {
                i == mainIndex -> "W"
                i < mainIndex -> if (mainIndex - i == 1) "UW" else "UW${mainIndex - i}"
                else -> if (i - mainIndex == 1) "T" else "T${i - mainIndex}"
            }
            "$label=${c.name}"
        }
    }

    @Test
    fun withoutTheFlagTheSameCamerasAreListedAsBefore() {
        val random = Random(10)
        repeat(2000) {
            val found = ArrayList<Candidate>()
            for (id in 0 until random.nextInt(1, 4)) {
                val logical = random.nextBoolean()
                found += Candidate("$id", physical = false, logical = logical, focal = 10f + random.nextInt(0, 12) * 10f)
                if (logical) repeat(random.nextInt(0, 4)) { p ->
                    found += Candidate("$id/${10 + p}", physical = true, logical = false, focal = 10f + random.nextInt(0, 12) * 10f)
                }
            }
            val now = labels(found)
            val before = former(found)
            // The same cameras, always.
            assertEquals("$found", before.map { it.substringAfter('=') }.sorted(), now.map { it.substringAfter('=') }.sorted())
            // The same labels unless several cameras open on their own (only the main lens rule changed, decision 36).
            if (LensChoice.choose(found, false).lenses.count { !it.candidate.physical } <= 1) assertEquals("$found", before, now)
        }
        assertEquals(former(pixelBack), labels(pixelBack))
    }
}
