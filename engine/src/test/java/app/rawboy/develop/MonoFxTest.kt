package app.rawboy.develop

import app.rawboy.gl.ShaderParams
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** The B&W rule behind `uMonoFx`: leaks and effects go grey with a black and white picture. */
class MonoFxTest {
    @Test
    fun monoRuleIsTheExplicitFlagOrAFullStrengthMonoLut() {
        val mono = "asset:luts/Yellow Mono 400.cube"
        assertFalse(DevelopParams().monoFx)
        assertFalse(ShaderParams.isMono(DevelopParams()))
        assertTrue(ShaderParams.isMono(DevelopParams(monoFx = true)))
        assertTrue(ShaderParams.isMono(DevelopParams(lut = mono)))
        assertFalse(ShaderParams.isMono(DevelopParams(lut = mono, lutAmount = 60f)))
        assertFalse(ShaderParams.isMono(DevelopParams(lut = mono, film = "portra400")))
        assertFalse(ShaderParams.isMono(DevelopParams(lut = "asset:luts/Movie Green.cube")))
    }
}
