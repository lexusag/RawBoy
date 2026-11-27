package app.rawboy.camera.capture

import android.content.Context
import android.hardware.camera2.CameraMetadata
import android.os.Build

/**
 * Compact persisted descriptor of a discovered camera lens so cold starts can open the target camera immediately
 * (1-2 Binder IPCs) without waiting ~1.7 s for full multi-camera discovery across all back, front, and physical IDs.
 * Keyed by [Build.FINGERPRINT] and [SCHEMA_VERSION], so any OS update invalidates stale camera IDs automatically.
 */
data class FastLensEntry(
    val openId: String,
    val physicalId: String?,
    /** Whether [physicalId] successfully streamed from logical camera [openId] (skips isSessionConfigurationSupported). */
    val physicalFromLogical: Boolean,
    val label: String,
    val facing: Int,
    val equivalentFocal: Float,
    val rawWidth: Int,
    val rawHeight: Int,
    val previewWidth: Int,
    val previewHeight: Int,
    val sensorOrientation: Int,
    val previewGamma: Float,
    val hasFlash: Boolean,
    val maxResWidth: Int,
    val maxResHeight: Int,
    val maxResFormat: Int,
    val hiRes: Boolean,
    val fNumber: Float,
) {
    /** Camera ID passed to `CameraManager.openCamera` for this lens. */
    val targetOpenId: String get() = if (physicalId != null && !physicalFromLogical) physicalId else openId

    fun serialize(): String = listOf(
        openId,
        physicalId.orEmpty(),
        if (physicalFromLogical) "1" else "0",
        label,
        facing.toString(),
        equivalentFocal.toString(),
        rawWidth.toString(),
        rawHeight.toString(),
        previewWidth.toString(),
        previewHeight.toString(),
        sensorOrientation.toString(),
        previewGamma.toString(),
        if (hasFlash) "1" else "0",
        maxResWidth.toString(),
        maxResHeight.toString(),
        maxResFormat.toString(),
        if (hiRes) "1" else "0",
        fNumber.toString(),
    ).joinToString("|")

    companion object {
        fun parse(text: String?): FastLensEntry? {
            if (text.isNullOrEmpty()) return null
            val p = text.split('|')
            if (p.size != 18) return null
            val openId = p[0].takeIf { it.isNotEmpty() } ?: return null
            val physicalId = p[1].takeIf { it.isNotEmpty() }
            val rawW = p[6].toIntOrNull()?.takeIf { it > 0 } ?: return null
            val rawH = p[7].toIntOrNull()?.takeIf { it > 0 } ?: return null
            val prevW = p[8].toIntOrNull()?.takeIf { it > 0 } ?: return null
            val prevH = p[9].toIntOrNull()?.takeIf { it > 0 } ?: return null
            return FastLensEntry(
                openId = openId,
                physicalId = physicalId,
                physicalFromLogical = p[2] == "1",
                label = p[3].takeIf { it.isNotEmpty() } ?: return null,
                facing = p[4].toIntOrNull() ?: return null,
                equivalentFocal = p[5].toFloatOrNull() ?: return null,
                rawWidth = rawW,
                rawHeight = rawH,
                previewWidth = prevW,
                previewHeight = prevH,
                sensorOrientation = p[10].toIntOrNull() ?: return null,
                previewGamma = p[11].toFloatOrNull() ?: return null,
                hasFlash = p[12] == "1",
                maxResWidth = p[13].toIntOrNull() ?: 0,
                maxResHeight = p[14].toIntOrNull() ?: 0,
                maxResFormat = p[15].toIntOrNull() ?: 0,
                hiRes = p[16] == "1",
                fNumber = p[17].toFloatOrNull()?.takeIf { it > 0f } ?: return null,
            )
        }
    }
}

object FastLensCache {
    private const val PREFS = "fast_lens_cache"
    private const val SCHEMA_VERSION = 1
    private const val KEY_FINGERPRINT = "fp"
    private const val KEY_SCHEMA = "v"

    internal fun slotKey(front: Boolean, lens: String, maxRes: Boolean): String =
        "lens_${if (front) "F" else "B"}_${lens}_${if (maxRes) "H" else "N"}"

    private fun currentFingerprint(): String = Build.FINGERPRINT ?: "unknown"

    fun load(context: Context, front: Boolean, lens: String, maxRes: Boolean): FastLensEntry? {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        if (prefs.getInt(KEY_SCHEMA, 0) != SCHEMA_VERSION) return null
        if (prefs.getString(KEY_FINGERPRINT, null) != currentFingerprint()) return null
        return FastLensEntry.parse(prefs.getString(slotKey(front, lens, maxRes), null))
    }

    /** Returns all cached lenses for [maxRes] grouped by `front` (widest first), or empty if cache is cold/stale. */
    fun loadAll(context: Context, maxRes: Boolean): Map<Boolean, List<FastLensEntry>> {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        if (prefs.getInt(KEY_SCHEMA, 0) != SCHEMA_VERSION) return emptyMap()
        if (prefs.getString(KEY_FINGERPRINT, null) != currentFingerprint()) return emptyMap()
        val suffix = "_${if (maxRes) "H" else "N"}"
        val back = mutableListOf<FastLensEntry>()
        val front = mutableListOf<FastLensEntry>()
        for ((key, value) in prefs.all) {
            if (!key.startsWith("lens_") || !key.endsWith(suffix)) continue
            val entry = FastLensEntry.parse(value as? String) ?: continue
            if (entry.facing == CameraMetadata.LENS_FACING_FRONT) front += entry else back += entry
        }
        back.sortBy { it.equivalentFocal }
        front.sortBy { it.equivalentFocal }
        return mapOf(false to back, true to front)
    }

    fun saveAll(
        context: Context,
        sides: Map<Boolean, List<CameraController.Info>>,
        maxRes: Boolean,
        physicalFromLogical: Map<String, Boolean> = emptyMap(),
    ) {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val edit = prefs.edit()
            .putInt(KEY_SCHEMA, SCHEMA_VERSION)
            .putString(KEY_FINGERPRINT, currentFingerprint())
        for ((front, list) in sides) {
            for (inf in list) {
                val entry = FastLensEntry(
                    openId = inf.openId,
                    physicalId = inf.physicalId,
                    physicalFromLogical = physicalFromLogical[inf.name] ?: (inf.physicalId != null),
                    label = inf.label,
                    facing = inf.facing,
                    equivalentFocal = inf.equivalentFocal,
                    rawWidth = inf.rawSize.width,
                    rawHeight = inf.rawSize.height,
                    previewWidth = inf.previewSize.width,
                    previewHeight = inf.previewSize.height,
                    sensorOrientation = inf.sensorOrientation,
                    previewGamma = inf.previewGamma,
                    hasFlash = inf.hasFlash,
                    maxResWidth = inf.maxResSize?.width ?: 0,
                    maxResHeight = inf.maxResSize?.height ?: 0,
                    maxResFormat = inf.maxResFormat,
                    hiRes = inf.hiRes,
                    fNumber = inf.fNumber,
                )
                edit.putString(slotKey(front, inf.label, maxRes), entry.serialize())
            }
        }
        edit.apply()
    }

    /** Records whether [inf]'s physical stream succeeded from its logical camera, avoiding the probe on future starts. */
    fun updatePhysicalStream(context: Context, inf: CameraController.Info, maxRes: Boolean, fromLogical: Boolean) {
        val existing = load(context, inf.isFront, inf.label, maxRes) ?: return
        if (existing.physicalFromLogical == fromLogical) return
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putString(slotKey(inf.isFront, inf.label, maxRes), existing.copy(physicalFromLogical = fromLogical).serialize())
            .apply()
    }

    fun clear(context: Context) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().clear().apply()
    }
}
