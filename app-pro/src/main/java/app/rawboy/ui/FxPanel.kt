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
import app.rawboy.develop.FxKind
import app.rawboy.develop.LightEffect
import app.rawboy.develop.LightEffects
import java.util.Locale
import kotlin.math.ln
import kotlin.math.pow
import kotlin.math.roundToInt
import kotlin.math.sqrt

/** Exponential slider 0..100 <-> [min]..[max], so small sizes are easy to set. */
private class FxExpSlider(val min: Float, val max: Float) {
    fun to(r: Float) = 100 * ln(r.coerceIn(min, max) / min) / ln(max / min)
    fun from(v: Float) = min * (max / min).pow(v / 100f)
}

/** The effect's mean radius (fraction of the long side). */
private val SIZE = FxExpSlider(0.03f, 1.5f)
private fun sizeOf(e: LightEffect) = sqrt(e.rx * e.ry)

/** Stretch slider -100..100 <-> rx / ry, 1/4..4. */
private fun stretchOf(rx: Float, ry: Float) = 100 * ln(rx / ry) / ln(4f)

private fun percent(r: Float) = "${(r * 200).roundToInt()}%"

private fun fxColor(hue: Float) = LightEffects.color(hue).let { Color(it[0], it[1], it[2]) }

/** The full hue circle for the Colour slider. */
private val HUE_TRACK: Brush by lazy { Brush.horizontalGradient(listOf(0f, 60f, 120f, 180f, 240f, 300f, 360f).map(::fxColor)) }

private fun hueName(h: Float): String {
    val d = ((h % 360f) + 360f) % 360f
    return when {
        d < 15f -> "Red"
        d < 45f -> "Orange"
        d < 70f -> "Yellow"
        d < 160f -> "Green"
        d < 200f -> "Cyan"
        d < 250f -> "Blue"
        d < 290f -> "Violet"
        d < 335f -> "Magenta"
        else -> "Red"
    }
}

private fun amountName(k: FxKind) = when (k) {
    FxKind.LIGHTNING -> "Branches"
    FxKind.SPARKS -> "Sparks"
    FxKind.TRAILS, FxKind.SWIRL -> "Strands"
}

/** The two light tools share one top-bar button; this switch (in both panels' headers) moves between them. */
@Composable
internal fun LightToolSwitch(mode: EditorMode, onMode: (EditorMode) -> Unit, modifier: Modifier = Modifier) {
    val tools = listOf(EditorMode.LEAKS to "Light leaks", EditorMode.FX to "Effects")
    SingleChoiceSegmentedButtonRow(modifier) {
        tools.forEachIndexed { i, (m, name) ->
            SegmentedButton(
                selected = mode == m,
                onClick = { onMode(m) },
                shape = SegmentedButtonDefaults.itemShape(i, tools.size),
                modifier = Modifier.height(36.dp),
                label = { Text(name, style = MaterialTheme.typography.labelMedium) },
            )
        }
    }
}

/**
 * Light effects, "lomo" (mirrors RawBoy Web's FxPanel): lightning, electric sparks, light trails and neon swirls,
 * generated at random and dragged into place on the photo like light leaks. A top-bar mode like Leaks: effect chips
 * (tap a selected chip to hide or delete it), then the selected effect's sliders; its box is also moved, sized and
 * turned on the photo.
 */
@Composable
fun FxPanel(
    effects: List<LightEffect>,
    selectedId: String?,
    /** The photo's width / height: Size and Stretch reset to the box that covers it. */
    aspect: Float,
    zoomed: Boolean,
    onMode: (EditorMode) -> Unit,
    onSelect: (String) -> Unit,
    onAdd: (FxKind) -> Unit,
    onUpdate: (String, Boolean, (LightEffect) -> LightEffect) -> Unit,
    onRemove: (String) -> Unit,
    onToggleZoom: () -> Unit,
    onDone: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val selected = effects.firstOrNull { it.id == selectedId }
    var menuFor by remember { mutableStateOf<String?>(null) }
    val cover = LightEffects.coverSize(aspect)

    Column(modifier) {
        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(start = 12.dp, end = 4.dp)) {
            LightToolSwitch(EditorMode.FX, onMode, Modifier.weight(1f))
            TextButton(onClick = onToggleZoom) { Text(if (zoomed) "Fit" else "100%") }
            TextButton(onClick = onDone) { Text("Done") }
        }
        Row(
            horizontalArrangement = Arrangement.spacedBy(6.dp),
            verticalAlignment = Alignment.CenterVertically,
            modifier = Modifier.horizontalScroll(rememberScrollState()).padding(horizontal = 12.dp),
        ) {
            effects.forEachIndexed { i, e ->
                Box {
                    FilterChip(
                        selected = e.id == selectedId,
                        onClick = { if (e.id == selectedId) menuFor = e.id else onSelect(e.id) },
                        leadingIcon = { Box(Modifier.size(10.dp).background(fxColor(e.hue), CircleShape)) },
                        label = { Text(if (e.enabled) "${e.kind.label} ${i + 1}" else "${e.kind.label} ${i + 1} (off)") },
                    )
                    DropdownMenu(expanded = menuFor == e.id, onDismissRequest = { menuFor = null }) {
                        DropdownMenuItem(
                            text = { Text(if (e.enabled) "Hide" else "Show") },
                            onClick = { menuFor = null; onUpdate(e.id, true) { it.copy(enabled = !it.enabled) } },
                        )
                        DropdownMenuItem(text = { Text("Delete") }, onClick = { menuFor = null; onRemove(e.id) })
                    }
                }
            }
            if (effects.size < LightEffects.MAX_EFFECTS) {
                FxKind.entries.forEach { k -> FilterChip(selected = false, onClick = { onAdd(k) }, label = { Text("+ ${k.label}") }) }
            }
        }
        val fx = selected ?: run {
            FxNote(
                "Add lightning, electric sparks, light trails or a neon swirl: each press makes a new random one. Drag it " +
                    "over the photo, size and turn it with its dots, and press New random until you like it. The light glows " +
                    "into the photo like a double exposure and the grain stays on top. Up to ${LightEffects.MAX_EFFECTS}; " +
                    "effects reset for each new photo.",
                Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
            )
            return@Column
        }
        fun set(force: Boolean = false, change: (LightEffect) -> LightEffect) = onUpdate(fx.id, force, change)
        Column(Modifier.verticalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 6.dp)) {
            TextButton(onClick = { set(force = true) { it.copy(seed = LightEffects.newSeed()) } }) { Text("New random") }
            SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
                FxKind.entries.forEachIndexed { i, k ->
                    SegmentedButton(
                        selected = fx.kind == k,
                        onClick = { set(force = true) { it.withKind(k) } },
                        shape = SegmentedButtonDefaults.itemShape(i, FxKind.entries.size),
                        modifier = Modifier.height(36.dp),
                        label = { Text(k.label, style = MaterialTheme.typography.labelMedium, maxLines = 1) },
                    )
                }
            }
            ParamSlider("Intensity", fx.intensity, 0f..100f, 100f, format = { "${it.roundToInt()}%" }) { v ->
                set { it.copy(intensity = v) }
            }
            ParamSlider(amountName(fx.kind), fx.amount, 0f..100f, fx.kind.amount, format = ::formatPlain) { v ->
                set { it.copy(amount = v) }
            }
            ParamSlider(
                "Size", SIZE.to(sizeOf(fx)), 0f..100f, SIZE.to(sqrt(cover.first * cover.second)), format = { percent(SIZE.from(it)) },
            ) { v ->
                set {
                    val k = SIZE.from(v) / sizeOf(it)
                    it.copy(rx = it.rx * k, ry = it.ry * k)
                }
            }
            ParamSlider(
                "Stretch", stretchOf(fx.rx, fx.ry), -100f..100f, stretchOf(cover.first, cover.second),
                format = { String.format(Locale.ROOT, "%.2f:1", 4f.pow(it / 100f)) },
            ) { v ->
                set {
                    val s = sizeOf(it)
                    val ratio = sqrt(4f.pow(v / 100f))
                    it.copy(rx = s * ratio, ry = s / ratio)
                }
            }
            ParamSlider("Rotation", fx.angle, -180f..180f, fx.kind.angle, format = { "${it.roundToInt()}°" }) { v ->
                set { it.copy(angle = v) }
            }
            ParamSlider("Thickness", fx.thickness, 0f..100f, fx.kind.thickness, format = ::formatPlain) { v ->
                set { it.copy(thickness = v) }
            }
            ParamSlider("Glow", fx.glow, 0f..100f, fx.kind.glow, format = ::formatPlain) { v -> set { it.copy(glow = v) } }
            ParamSlider("Colour", fx.hue, 0f..360f, fx.kind.hue, format = ::hueName, trackBrush = HUE_TRACK) { v ->
                set { it.copy(hue = v) }
            }
            ParamSlider("Colour mix", fx.spread, 0f..100f, fx.kind.spread, format = ::formatPlain) { v ->
                set { it.copy(spread = v) }
            }
            FxNote(
                "Drag inside the box to move the effect, the dots to size it along and across, the round knob to turn it. " +
                    "New random draws a new pattern with the same settings. Colour mix lets each line drift from the colour " +
                    "(sparks in blue, violet and green). Effects aren't saved in presets: they belong to this photo.",
            )
        }
    }
}

@Composable
private fun FxNote(text: String, modifier: Modifier = Modifier) {
    Text(
        text,
        style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = modifier.padding(top = 4.dp),
    )
}
