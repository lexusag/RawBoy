package app.rawboy.auto

import android.content.Context
import android.util.Log
import app.rawboy.develop.Preset
import app.rawboy.develop.Presets
import java.io.File

/**
 * The lens presets RawBoy sent or the user opened ([Preset.isLensPreset]), as one preset file (`lens-presets.json`,
 * the same format as RawBoy's preset files) in app storage, so later batches get them too.
 */
object LensPresetStore {
    private const val FILE = "lens-presets.json"

    fun load(context: Context): List<Preset> {
        val f = File(context.filesDir, FILE)
        if (!f.exists()) return emptyList()
        return runCatching { Presets.decode(f.readText()).filter { it.isLensPreset } }
            .onFailure { Log.w("RawBoyAuto", "Could not read lens presets", it) }
            .getOrDefault(emptyList())
    }

    fun save(context: Context, presets: List<Preset>) {
        val f = File(context.filesDir, FILE)
        val tmp = File(context.filesDir, "$FILE.tmp")
        // Always an array, so one preset doesn't change the file's shape; written whole, then swapped in.
        tmp.writeText(if (presets.isEmpty()) "[]" else Presets.encode(presets).let { if (presets.size == 1) "[$it]" else it })
        tmp.renameTo(f)
    }
}
