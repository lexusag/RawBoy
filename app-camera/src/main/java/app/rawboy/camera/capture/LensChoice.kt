package app.rawboy.camera.capture

import kotlin.math.abs

/**
 * Which of the cameras a phone offers become the lens list, and how they are labelled: the rules of
 * [CameraController.lenses] on plain numbers, so they can be checked on the JVM against known phones.
 */
object LensChoice {
    /** A camera with RAW as [CameraController.lenses] found it. */
    data class Candidate(
        /** "2", or "0/3" for physical lens 3 of logical camera 0. */
        val name: String,
        /** A physical lens streamed from a logical camera. */
        val physical: Boolean,
        /** A logical multi-camera (several lenses behind one id). */
        val logical: Boolean,
        /** 35 mm-equivalent focal length. */
        val focal: Float,
    )

    /** A listed lens and its label (W = main; UW, UW2... wider; T, T2... longer). */
    data class Chosen(val candidate: Candidate, val label: String)

    class Result(
        /** Widest first. */
        val lenses: List<Chosen>,
        /** Candidates left out, with why. */
        val skipped: List<Pair<Candidate, String>>,
    )

    /**
     * One entry per lens, then labels. Cameras with the same focal length (within 12%) are the same lens; the first in
     * this order wins: stand-alone cameras, then logical ones (the other way round unless [standaloneOverLogical]),
     * each in [found]'s order, then physical lenses. The main lens is the logical camera if exactly one is listed (the
     * lens it starts on), else the one nearest 26 mm.
     */
    fun choose(found: List<Candidate>, standaloneOverLogical: Boolean): Result {
        val order = found.sortedBy {
            when {
                it.physical -> 2
                it.logical == standaloneOverLogical -> 1
                else -> 0
            }
        }
        val kept = ArrayList<Candidate>()
        val skipped = ArrayList<Pair<Candidate, String>>()
        for (c in order) {
            val same = kept.firstOrNull { abs(it.focal - c.focal) < 0.12f * c.focal }
            if (same == null) kept += c
            else skipped += c to "same lens as ${same.name} (${String.format(java.util.Locale.ROOT, "%.1f", c.focal)} mm)"
        }
        if (kept.isEmpty()) return Result(emptyList(), skipped)
        kept.sortBy { it.focal }
        val logical = kept.filter { it.logical }
        val main = logical.singleOrNull() ?: kept.minBy { abs(it.focal - 26f) }
        val mainIndex = kept.indexOf(main)
        val lenses = kept.mapIndexed { i, c ->
            val label = when {
                i == mainIndex -> "W"
                i < mainIndex -> if (mainIndex - i == 1) "UW" else "UW${mainIndex - i}"
                else -> if (i - mainIndex == 1) "T" else "T${i - mainIndex}"
            }
            Chosen(c, label)
        }
        return Result(lenses, skipped)
    }
}
