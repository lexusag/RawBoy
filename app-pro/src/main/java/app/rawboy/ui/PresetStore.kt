package app.rawboy.ui

import android.content.Context
import android.util.Log
import app.rawboy.develop.Preset
import app.rawboy.develop.Presets
import java.io.File

/** The user's presets, as one preset file (`presets.json`, the same format as exported files) in app storage. */
object PresetStore {
    private const val FILE = "presets.json"

    fun load(context: Context): List<Preset> {
        val f = File(context.filesDir, FILE)
        if (!f.exists()) return emptyList()
        return runCatching { Presets.decode(f.readText()) }
            .onFailure { Log.w("RawBoy", "Could not read presets", it) }
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
