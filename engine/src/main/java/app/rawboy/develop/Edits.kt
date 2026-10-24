package app.rawboy.develop

import org.json.JSONObject

/**
 * One photo's complete edit as JSON (port of web's Edits.ts, the same format): what RawBoy's "Send to Auto" hands
 * RawBoy Auto with a photo, so Auto develops and batch exports it exactly as RawBoy showed it. Unlike a preset it holds
 * every field: geometry (rotation, flips, straighten, crop), mask layers with their brush strokes and lens blur, and
 * light leaks. Only fields that differ from the photo's as-shot defaults are kept: absolute values, but a small file.
 */
object Edits {
    const val FORMAT = "rawboy-edit"
    const val VERSION = 1

    /** RawBoy's "Send to Auto" for one photo: the photo in [EXTRA_PHOTO], its edits file (this format) in [EXTRA_EDITS]. */
    const val ACTION_SEND_TO_AUTO = "app.rawboy.action.SEND_EDITS"
    const val EXTRA_PHOTO = "app.rawboy.extra.PHOTO"
    const val EXTRA_EDITS = "app.rawboy.extra.EDITS"

    /** Every preset group's fields; masks are written with their strokes (below), not as a preset keeps them. */
    private val SLIDERS = PresetGroup.entries.flatMap { it.fields } - "masks"

    private fun values(p: DevelopParams): LinkedHashMap<String, Any> {
        val values = LinkedHashMap<String, Any>()
        for (f in SLIDERS) {
            values[f] = when (val v = Presets.get(p, f)) {
                null -> JSONObject.NULL
                is ToneCurves -> v.toJson()
                is Float -> num(v)
                else -> v
            }
        }
        values["rotation"] = p.rotation
        values["flipHorizontal"] = p.flipHorizontal
        values["flipVertical"] = p.flipVertical
        values["straighten"] = num(p.straighten)
        values["cropLeft"] = num(p.cropLeft)
        values["cropTop"] = num(p.cropTop)
        values["cropRight"] = num(p.cropRight)
        values["cropBottom"] = num(p.cropBottom)
        values["masks"] = Masks.toJson(p.masks, strokes = true)
        values["leaks"] = LightLeaks.toJson(p.leaks)
        return values
    }

    /**
     * [params] as edits JSON, or null when they are the photo's [defaults] (nothing to keep); with [keepEmpty] an edit
     * with no values then, for "Send to Auto" of an unedited photo (Auto shows it as RawBoy left it: untouched).
     */
    fun encode(params: DevelopParams, defaults: DevelopParams, keepEmpty: Boolean = false): String? {
        val base = values(defaults)
        val changed = JSONObject()
        for ((k, v) in values(params)) if (v.toString() != base[k].toString()) changed.put(k, v)
        if (changed.length() == 0 && !keepEmpty) return null
        return JSONObject().put("format", FORMAT).put("version", VERSION).put("values", changed).toString()
    }

    /**
     * The photo's [defaults] with the edits in [text]; fields missing from it (unedited, or newer than the RawBoy that
     * wrote it) keep their defaults and values of the wrong type are skipped. null when [text] isn't RawBoy edits.
     */
    fun decode(text: String, defaults: DevelopParams): DevelopParams? {
        val o = runCatching { JSONObject(text) }.getOrNull() ?: return null
        if (o.optString("format") != FORMAT) return null
        val v = o.optJSONObject("values") ?: JSONObject()
        var p = defaults
        for (f in SLIDERS) {
            if (!v.has(f)) continue
            val raw = v.get(f)
            val value = when {
                f == "curves" -> ToneCurves.parse(raw) ?: continue
                raw == JSONObject.NULL -> null
                raw is Number -> raw.toFloat()
                else -> raw
            }
            p = Presets.set(p, f, value)
        }
        fun f(k: String, min: Float, max: Float) = (v.opt(k) as? Number)?.toFloat()?.takeIf { it.isFinite() }?.coerceIn(min, max)
        val left = f("cropLeft", 0f, 1f) ?: p.cropLeft
        val top = f("cropTop", 0f, 1f) ?: p.cropTop
        val right = f("cropRight", 0f, 1f) ?: p.cropRight
        val bottom = f("cropBottom", 0f, 1f) ?: p.cropBottom
        val cropOk = right > left && bottom > top
        return p.copy(
            rotation = (v.opt("rotation") as? Number)?.let { Math.floorMod(Math.round(it.toDouble()).toInt(), 4) } ?: p.rotation,
            flipHorizontal = v.opt("flipHorizontal") as? Boolean ?: p.flipHorizontal,
            flipVertical = v.opt("flipVertical") as? Boolean ?: p.flipVertical,
            straighten = f("straighten", -45f, 45f) ?: p.straighten,
            cropLeft = if (cropOk) left else p.cropLeft,
            cropTop = if (cropOk) top else p.cropTop,
            cropRight = if (cropOk) right else p.cropRight,
            cropBottom = if (cropOk) bottom else p.cropBottom,
            masks = if (v.has("masks")) Masks.parseLayers(v.opt("masks"), strokes = true) else p.masks,
            leaks = if (v.has("leaks")) LightLeaks.parseLeaks(v.opt("leaks")) else p.leaks,
        )
    }

    /** Floats via their shortest decimal, so 0.1 is written as 0.1. */
    private fun num(f: Float): Double = f.toString().toDouble()
}
