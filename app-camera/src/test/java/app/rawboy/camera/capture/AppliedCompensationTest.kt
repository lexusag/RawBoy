package app.rawboy.camera.capture

import org.junit.Assert.assertEquals
import org.junit.Test

class AppliedCompensationTest {
    @Test
    fun brightLightAllReachesTheRaw() {
        // Short exposure, no boost: AE lengthens the exposure, the residual stays 1.
        assertEquals(1.7f, AppliedCompensation.ev(1.7f, residual = 1f, residualAtZero = 1f), 1e-4f)
        assertEquals(-1.5f, AppliedCompensation.ev(-1.5f, residual = 1f, residualAtZero = 1f), 1e-4f)
    }

    @Test
    fun lowLightCompensationThatStayedDigitalIsNotTakenOut() {
        // Pixel 9 Pro, dark room: 1/30 s, boost 2.39 at 0 (still: 1/15 s, residual 1.2). +1.7 EV only raises the boost.
        val atZero = AppliedCompensation.residual(postRawBoost = 2.39f, stillGain = 2f)
        val brighter = AppliedCompensation.residual(postRawBoost = 2.39f * 3.25f, stillGain = 2f)
        assertEquals(0f, AppliedCompensation.ev(1.7f, brighter, atZero), 0.02f)
    }

    @Test
    fun partlyApplied() {
        // At 0: 1/60 s, no boost. +1.7 EV: 1/30 s (preview cap) and boost 1.62; the still takes it all into 1/18 s.
        val brighter = AppliedCompensation.residual(postRawBoost = 1.62f, stillGain = 1.62f)
        assertEquals(1.7f, AppliedCompensation.ev(1.7f, brighter, residualAtZero = 1f), 1e-4f)
        // Had the still kept half of the extra stop digital, that half stays in the develop.
        assertEquals(1.2f, AppliedCompensation.ev(1.7f, residual = 1.4142f, residualAtZero = 1f), 1e-3f)
    }

    @Test
    fun darkerInLowLightThatOnlyLoweredTheBoost() {
        // -1 EV in a dark room: the AE drops the boost from 2.39 to 1.2, the raw is unchanged.
        val atZero = AppliedCompensation.residual(postRawBoost = 2.39f, stillGain = 1f)
        val darker = AppliedCompensation.residual(postRawBoost = 1.195f, stillGain = 1f)
        assertEquals(0f, AppliedCompensation.ev(-1f, darker, atZero), 1e-3f)
    }

    @Test
    fun neverMoreThanAskedNorTheOtherWay() {
        // A stale reference from a darker scene must not credit more than was asked for.
        assertEquals(1f, AppliedCompensation.ev(1f, residual = 1f, residualAtZero = 4f), 1e-4f)
        assertEquals(0f, AppliedCompensation.ev(1f, residual = 8f, residualAtZero = 1f), 1e-4f)
        assertEquals(-1f, AppliedCompensation.ev(-1f, residual = 4f, residualAtZero = 1f), 1e-4f)
        assertEquals(0f, AppliedCompensation.ev(0f, residual = 4f, residualAtZero = 1f), 0f)
    }

    // OnePlus 11, main camera, 2026-11-17: AE's gain ceiling = 1/15 s x ISO 6400.
    private val ceiling = 0.066666667f * 6400f

    @Test
    fun atTheCeilingABrighterCompensationNeverReachesTheRaw() {
        // A dark room at Brightness +1: preview 1/30 s x ISO 6400 x boost 2.0 (or 30 ms x boost 2.22, the same gain).
        assertEquals(0f, AppliedCompensation.evBelowCeiling(1f, 0.033328f * 6400f * 2.0f, ceiling), 0f)
        assertEquals(0f, AppliedCompensation.evBelowCeiling(1f, 0.029993f * 6400f * 2.22f, ceiling), 0f)
        assertEquals(0f, AppliedCompensation.evBelowCeiling(2.1667f, 0.033328f * 6400f * 2.0f, ceiling), 0f)
    }

    @Test
    fun belowTheCeilingAllOfItDoes() {
        // A lamp-lit room at +0.17: 1/30 s x ISO 6400 x boost 1.24.
        assertEquals(0.1667f, AppliedCompensation.evBelowCeiling(0.1667f, 0.033328f * 6400f * 1.24f, ceiling), 0f)
        // Bright light, nowhere near.
        assertEquals(1.7f, AppliedCompensation.evBelowCeiling(1.7f, 0.004f * 100f, ceiling), 0f)
    }

    @Test
    fun aDarkerCompensationAlwaysDoes() {
        // AE takes the boost down first: -1 at the ceiling came out -0.96 EV (merged) and -0.93 EV (single).
        assertEquals(-1f, AppliedCompensation.evBelowCeiling(-1f, 0.033328f * 6400f * 2.0f, ceiling), 0f)
        assertEquals(0f, AppliedCompensation.evBelowCeiling(0f, 0.033328f * 6400f * 2.0f, ceiling), 0f)
    }

    @Test
    fun anUnknownCeilingChangesNothing() {
        assertEquals(1f, AppliedCompensation.evBelowCeiling(1f, 1000f, 0f), 0f)
    }
}
