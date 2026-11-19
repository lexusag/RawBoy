@file:OptIn(ExperimentalMaterial3Api::class)

package app.rawboy.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import app.rawboy.develop.FilmLeak
import app.rawboy.develop.FilmLeakType
import app.rawboy.develop.FilmLeaks
import app.rawboy.develop.FilmPalette
import app.rawboy.develop.LeakKind
import app.rawboy.develop.LightLeak
import app.rawboy.develop.LightLeaks
import java.util.Locale
import kotlin.math.ln
import kotlin.math.pow
import kotlin.math.roundToInt
import kotlin.math.sqrt

/** Exponential slider 0..100 <-> [min]..[max], so small sizes are easy to set. */
private class ExpSlider(val min: Float, val max: Float) {
    fun to(r: Float) = 100 * ln(r.coerceIn(min, max) / min) / ln(max / min)
    fun from(v: Float) = min * (max / min).pow(v / 100f)
}

/** A glow's or triangle's mean radius; a streak's half width and half length (fractions of the long side). */
private val SIZE = ExpSlider(0.02f, 0.8f)
private val WIDTH = ExpSlider(0.003f, 0.3f)
private val LENGTH = ExpSlider(0.1f, 1.5f)
private fun sizeOf(l: LightLeak) = sqrt(l.rx * l.ry)

/** Stretch slider -100..100 <-> rx / ry, 1/4..4. */
private fun stretchOf(rx: Float, ry: Float) = (100 * ln(rx / ry) / ln(4f))

private fun percent(r: Float) = String.format(Locale.ROOT, if (r < 0.05f) "%.1f%%" else "%.0f%%", r * 200)
private fun signed(v: Float) = v.roundToInt().let { if (it > 0) "+$it" else "$it" }

private fun leakColor(hue: Float) = LightLeaks.color(hue).let { Color(it[0], it[1], it[2]) }

/** Inner glow colours across the Colour slider. */
private val HUE_TRACK: Brush by lazy {
    Brush.horizontalGradient(listOf(LightLeaks.HUE_MIN, -20f, 0f, 20f, 40f, LightLeaks.HUE_MAX).map(::leakColor))
}

private fun hueName(h: Float) = when {
    h < -15f -> "Magenta"
    h < 10f -> "Red"
    h < 45f -> "Orange"
    else -> "Amber"
}

/**
 * Light leaks (mirrors RawBoy Web's LeaksPanel): film-style light (streaks, glows, triangles) dragged into place on
 * the photo, e.g. to tastefully cover part of a nude. A top-bar mode like Masks: leak chips (tap a selected chip to
 * hide or delete it), then the selected leak's sliders; the shape is also moved, sized, turned and bent on the photo.
 */
@Composable
fun LeaksPanel(
    leaks: List<LightLeak>,
    selectedId: String?,
    filmLeaks: List<FilmLeak>,
    selectedFilmId: String?,
    zoomed: Boolean,
    onSelect: (String) -> Unit,
    onAdd: (LeakKind) -> Unit,
    onUpdate: (String, Boolean, (LightLeak) -> LightLeak) -> Unit,
    onRemove: (String) -> Unit,
    onSelectFilm: (String) -> Unit,
    onAddFilm: (FilmLeakType?, Boolean) -> Unit,
    onRandomRoll: (Boolean) -> Unit,
    onUpdateFilm: (String, Boolean, (FilmLeak) -> FilmLeak) -> Unit,
    onRemoveFilm: (String) -> Unit,
    onMode: (EditorMode) -> Unit,
    onToggleZoom: () -> Unit,
    onDone: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val selected = leaks.firstOrNull { it.id == selectedId }
    val selectedFilm = filmLeaks.firstOrNull { it.id == selectedFilmId }
    var menuFor by remember { mutableStateOf<String?>(null) }
    var genType by remember { mutableStateOf<FilmLeakType?>(null) }
    var shortSideSprockets by remember { mutableStateOf(false) }
    val budgetLeft = leaks.size + filmLeaks.size < LightLeaks.MAX_LEAKS

    Column(modifier) {
        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(start = 12.dp, end = 4.dp)) {
            LightToolSwitch(EditorMode.LEAKS, onMode, Modifier.weight(1f))
            TextButton(onClick = onToggleZoom) { Text(if (zoomed) "Fit" else "100%") }
            TextButton(onClick = onDone) { Text("Done") }
        }
        Row(
            horizontalArrangement = Arrangement.spacedBy(6.dp),
            verticalAlignment = Alignment.CenterVertically,
            modifier = Modifier.horizontalScroll(rememberScrollState()).padding(horizontal = 12.dp),
        ) {
            leaks.forEachIndexed { i, l ->
                Box {
                    FilterChip(
                        selected = l.id == selectedId,
                        onClick = { if (l.id == selectedId) menuFor = l.id else onSelect(l.id) },
                        leadingIcon = { Box(Modifier.size(10.dp).background(leakColor(l.hue), CircleShape)) },
                        label = { Text(if (l.enabled) "${l.kind.label} ${i + 1}" else "${l.kind.label} ${i + 1} (off)") },
                    )
                    DropdownMenu(expanded = menuFor == l.id, onDismissRequest = { menuFor = null }) {
                        DropdownMenuItem(
                            text = { Text(if (l.enabled) "Hide" else "Show") },
                            onClick = { menuFor = null; onUpdate(l.id, true) { it.copy(enabled = !it.enabled) } },
                        )
                        DropdownMenuItem(text = { Text("Delete") }, onClick = { menuFor = null; onRemove(l.id) })
                    }
                }
            }
            filmLeaks.forEachIndexed { i, fl ->
                Box {
                    FilterChip(
                        selected = fl.id == selectedFilmId,
                        onClick = { if (fl.id == selectedFilmId) menuFor = fl.id else onSelectFilm(fl.id) },
                        leadingIcon = { Box(Modifier.size(10.dp).background(Color(fl.palette.rgb), CircleShape)) },
                        label = { Text(if (fl.enabled) "${fl.type.label} ${i + 1}" else "${fl.type.label} ${i + 1} (off)") },
                    )
                    DropdownMenu(expanded = menuFor == fl.id, onDismissRequest = { menuFor = null }) {
                        DropdownMenuItem(
                            text = { Text(if (fl.enabled) "Hide" else "Show") },
                            onClick = { menuFor = null; onUpdateFilm(fl.id, true) { it.copy(enabled = !it.enabled) } },
                        )
                        DropdownMenuItem(text = { Text("Delete") }, onClick = { menuFor = null; onRemoveFilm(fl.id) })
                    }
                }
            }
            if (budgetLeft) {
                LeakKind.entries.forEach { k -> FilterChip(selected = false, onClick = { onAdd(k) }, label = { Text("+ ${k.label}") }) }
            }
        }
        Row(
            horizontalArrangement = Arrangement.spacedBy(6.dp),
            verticalAlignment = Alignment.CenterVertically,
            modifier = Modifier.horizontalScroll(rememberScrollState()).padding(horizontal = 12.dp),
        ) {
            FilterChip(selected = genType == null, onClick = { genType = null }, label = { Text("Any") })
            FilmLeakType.entries.forEach { t ->
                FilterChip(selected = genType == t, onClick = { genType = t }, label = { Text(t.label) })
            }
        }
        Row(
            horizontalArrangement = Arrangement.spacedBy(4.dp),
            verticalAlignment = Alignment.CenterVertically,
            modifier = Modifier.horizontalScroll(rememberScrollState()).padding(horizontal = 12.dp),
        ) {
            TextButton(onClick = { onAddFilm(genType, shortSideSprockets) }, enabled = budgetLeft) { Text("🎲 Random") }
            TextButton(onClick = { onRandomRoll(shortSideSprockets) }, enabled = leaks.size < LightLeaks.MAX_LEAKS) { Text("Roll") }
            FilterChip(
                selected = shortSideSprockets,
                onClick = { shortSideSprockets = !shortSideSprockets },
                label = { Text("Short-side sprockets") },
            )
            if (selectedFilm != null) {
                TextButton(
                    onClick = {
                        onUpdateFilm(selectedFilm.id, true) {
                            FilmLeaks.newVariation(it, FilmLeaks.newSeed().toFloat())
                        }
                    },
                ) { Text("New variation") }
            }
            if (budgetLeft && genType != null) {
                TextButton(onClick = { onAddFilm(genType, shortSideSprockets) }) { Text("+ Add ${genType!!.label}") }
            }
        }
        if (selectedFilm != null) {
            fun setFilm(force: Boolean = false, change: (FilmLeak) -> FilmLeak) = onUpdateFilm(selectedFilm.id, force, change)
            Column(Modifier.verticalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 6.dp)) {
                Row(
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                    modifier = Modifier.horizontalScroll(rememberScrollState()).padding(vertical = 4.dp),
                ) {
                    FilmPalette.entries.forEach { p ->
                        FilterChip(
                            selected = selectedFilm.palette == p,
                            onClick = { setFilm(force = true) { it.copy(palette = p) } },
                            leadingIcon = { Box(Modifier.size(10.dp).background(Color(p.rgb), CircleShape)) },
                            label = { Text(p.label) },
                        )
                    }
                }
                Row(horizontalArrangement = Arrangement.spacedBy(4.dp), verticalAlignment = Alignment.CenterVertically) {
                    if (selectedFilm.type == FilmLeakType.STREAK || selectedFilm.type == FilmLeakType.SCRATCHES) {
                        TextButton(onClick = { setFilm(force = true) { it.copy(turn = 0) } }) { Text("↔ Horizontal") }
                        TextButton(onClick = { setFilm(force = true) { it.copy(turn = 1) } }) { Text("↕ Vertical") }
                    } else if (selectedFilm.type != FilmLeakType.DUST && selectedFilm.type != FilmLeakType.FOG && selectedFilm.type != FilmLeakType.STAIN) {
                        listOf(0 to "←", 1 to "↑", 2 to "→", 3 to "↓").forEach { (t, arrow) ->
                            TextButton(onClick = { setFilm(force = true) { FilmLeaks.sideMove(it, t) } }) { Text(arrow) }
                        }
                    }
                    TextButton(onClick = { setFilm(force = true) { it.copy(mirror = !it.mirror) } }) {
                        Text(if (selectedFilm.mirror) "Flipped" else "Flip")
                    }
                }
                ParamSlider("Intensity", selectedFilm.intensity, 0f..100f, 80f, format = { "${it.roundToInt()}%" }) { v ->
                    setFilm { it.copy(intensity = v) }
                }
                ParamSlider("Softness", selectedFilm.softness, 0f..100f, 50f, format = { "${it.roundToInt()}" }) { v ->
                    setFilm { it.copy(softness = v) }
                }
                ParamSlider("Texture", selectedFilm.texture, 0f..100f, 65f, format = { "${it.roundToInt()}" }) { v ->
                    setFilm { it.copy(texture = v) }
                }
                ParamSlider("Amount", selectedFilm.amount, 0f..100f, 55f, format = { "${it.roundToInt()}" }) { v ->
                    setFilm { it.copy(amount = v) }
                }
                ParamSlider("Variant", selectedFilm.variant, 0f..100f, 50f, format = { "${it.roundToInt()}" }) { v ->
                    setFilm { it.copy(variant = v) }
                }
                ParamSlider("Warmth", selectedFilm.warmth, -100f..100f, 0f, format = ::signed) { v ->
                    setFilm { it.copy(warmth = v) }
                }
                ParamSlider("Tint", selectedFilm.tint, -100f..100f, 0f, format = ::signed) { v ->
                    setFilm { it.copy(tint = v) }
                }
                ParamSlider("Fade", selectedFilm.fade, 0f..100f, 0f, format = { "${it.roundToInt()}" }) { v ->
                    setFilm { it.copy(fade = v) }
                }
                ParamSlider("Contrast", selectedFilm.contrast, -100f..100f, 0f, format = ::signed) { v ->
                    setFilm { it.copy(contrast = v) }
                }
                LeakNote(
                    "Drag inside the box to move, or drag any of its 8 handles to stretch along X/Y. The bright edge marks where light enters or the film ends.",
                    Modifier.padding(top = 8.dp),
                )
            }
            return@Column
        }
        val leak = selected ?: run {
            LeakNote(
                "Add a hand-drawn light leak (+ Streak/Glow/Triangle) or generate a procedural film leak/damage above (up to ${LightLeaks.MAX_LEAKS} total). Generated leaks can be saved in presets under Light leaks.",
                Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
            )
            return@Column
        }
        fun set(force: Boolean = false, change: (LightLeak) -> LightLeak) = onUpdate(leak.id, force, change)
        Column(Modifier.verticalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 6.dp)) {
            SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
                LeakKind.entries.forEachIndexed { i, k ->
                    SegmentedButton(
                        selected = leak.kind == k,
                        onClick = { set(force = true) { it.withKind(k) } },
                        shape = SegmentedButtonDefaults.itemShape(i, LeakKind.entries.size),
                        modifier = Modifier.height(36.dp),
                        label = { Text(k.label, style = MaterialTheme.typography.labelMedium) },
                    )
                }
            }
            ParamSlider("Intensity", leak.intensity, 0f..100f, 100f, format = { "${it.roundToInt()}%" }) { v ->
                set { it.copy(intensity = v) }
            }
            if (leak.kind == LeakKind.STREAK) {
                ParamSlider(
                    "Width", WIDTH.to(leak.ry), 0f..100f, WIDTH.to(LeakKind.STREAK.ry), format = { percent(WIDTH.from(it)) },
                ) { v -> set { it.copy(ry = WIDTH.from(v)) } }
                ParamSlider(
                    "Length", LENGTH.to(leak.rx), 0f..100f, LENGTH.to(LeakKind.STREAK.rx), format = { percent(LENGTH.from(it)) },
                ) { v -> set { it.copy(rx = LENGTH.from(v)) } }
            } else {
                ParamSlider(
                    "Size", SIZE.to(sizeOf(leak)), 0f..100f, SIZE.to(sqrt(leak.kind.rx * leak.kind.ry)),
                    format = { percent(SIZE.from(it)) },
                ) { v ->
                    set {
                        val k = SIZE.from(v) / sizeOf(it)
                        it.copy(rx = it.rx * k, ry = it.ry * k)
                    }
                }
                ParamSlider(
                    "Stretch", stretchOf(leak.rx, leak.ry), -100f..100f, stretchOf(leak.kind.rx, leak.kind.ry),
                    format = { String.format(Locale.ROOT, "%.2f:1", 4f.pow(it / 100f)) },
                ) { v ->
                    set {
                        val s = sizeOf(it)
                        val ratio = sqrt(4f.pow(v / 100f))
                        it.copy(rx = s * ratio, ry = s / ratio)
                    }
                }
            }
            ParamSlider("Rotation", leak.angle, -180f..180f, leak.kind.angle, format = { "${it.roundToInt()}°" }) { v ->
                set { it.copy(angle = v) }
            }
            ParamSlider("Bend", leak.bend, -100f..100f, 0f, format = ::signed) { v -> set { it.copy(bend = v) } }
            ParamSlider("Taper", leak.taper, -100f..100f, 0f, format = ::signed) { v -> set { it.copy(taper = v) } }
            ParamSlider("Warp", leak.warp, 0f..100f, 0f, format = ::formatPlain) { v -> set { it.copy(warp = v) } }
            ParamSlider("Texture", leak.texture, 0f..100f, 0f, format = ::formatPlain) { v -> set { it.copy(texture = v) } }
            ParamSlider("Cover", leak.cover, 0f..100f, 0f, format = { "${it.roundToInt()}%" }) { v -> set { it.copy(cover = v) } }
            ParamSlider("Softness", leak.softness, 0f..100f, leak.kind.softness, format = ::formatPlain) { v ->
                set { it.copy(softness = v) }
            }
            ParamSlider("Glow", leak.glow, 0f..100f, leak.kind.glow, format = ::formatPlain) { v -> set { it.copy(glow = v) } }
            ParamSlider(
                "Colour", leak.hue, LightLeaks.HUE_MIN..LightLeaks.HUE_MAX, LightLeaks.HUE, format = ::hueName, trackBrush = HUE_TRACK,
            ) { v -> set { it.copy(hue = v) } }
            if (leak.warp > 0f || leak.texture > 0f) {
                TextButton(onClick = { set(force = true) { it.copy(seed = LightLeaks.newSeed()) } }) { Text("New pattern") }
            }
            LeakNote(
                "Drag the leak to move it, the dots to resize (" +
                    (if (leak.kind == LeakKind.STREAK) "side dots: width, end dots: length" else "along and across") +
                    "), the round knob to turn it, the square to bend it. Inside the dashed line it is pure white at full " +
                    "intensity; the glow around it is added in Screen mode. Leaks aren't saved in presets: they belong to " +
                    "this photo.",
            )
        }
    }
}

@Composable
private fun LeakNote(text: String, modifier: Modifier = Modifier) {
    Text(
        text,
        style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = modifier.padding(top = 4.dp),
    )
}
