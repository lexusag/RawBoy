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
import app.rawboy.develop.LeakKind
import app.rawboy.develop.LightLeak
import app.rawboy.develop.LightLeaks
import java.util.Locale
import kotlin.math.ln
import kotlin.math.pow
import kotlin.math.roundToInt
import kotlin.math.sqrt

/** Size slider 0..100 <-> the leak's mean radius (fraction of the long side), exponential so small leaks are easy to set. */
private const val MIN_SIZE = 0.02f
private const val MAX_SIZE = 0.8f
private fun sizeOf(l: LightLeak) = sqrt(l.rx * l.ry)
private fun sizeToSlider(r: Float) = (100 * ln(r.coerceIn(MIN_SIZE, MAX_SIZE) / MIN_SIZE) / ln(MAX_SIZE / MIN_SIZE))
private fun sliderToSize(v: Float) = MIN_SIZE * (MAX_SIZE / MIN_SIZE).pow(v / 100f)

/** Stretch slider -100..100 <-> width / height, 1/4..4. */
private fun stretchOf(l: LightLeak) = (100 * ln(l.rx / l.ry) / ln(4f))

/** Exponential slider 0..100 <-> [min]..[max], for a streak's width and length. */
private class ExpSlider(val min: Float, val max: Float) {
    fun to(r: Float) = 100 * ln(r.coerceIn(min, max) / min) / ln(max / min)
    fun from(v: Float) = min * (max / min).pow(v / 100f)
}

/** A streak's half width and half length, fractions of the long side. */
private val WIDTH = ExpSlider(0.005f, 0.3f)
private val LENGTH = ExpSlider(0.1f, 1.5f)

private fun leakColor(hue: Float) = LightLeaks.color(hue).let { Color(it[0], it[1], it[2]) }

/** Rim colours across the Colour slider. */
private val HUE_TRACK: Brush by lazy {
    Brush.horizontalGradient(listOf(LightLeaks.HUE_MIN, -20f, 0f, 20f, 40f, LightLeaks.HUE_MAX).map(::leakColor))
}

private fun hueName(h: Float) = when {
    h < -15f -> "Magenta"
    h < 10f -> "Red"
    h < 38f -> "Orange"
    else -> "Amber"
}

/**
 * Light leaks (mirrors RawBoy Web's LeaksPanel): film-style streaks of light or glows dragged into place on the photo, e.g. to
 * tastefully cover part of a nude. A top-bar mode like Masks: leak chips (tap a selected chip to hide or delete it),
 * then the selected leak's sliders; the shape is also moved and sized on the photo.
 */
@Composable
fun LeaksPanel(
    leaks: List<LightLeak>,
    selectedId: String?,
    zoomed: Boolean,
    onSelect: (String) -> Unit,
    onAdd: (LeakKind) -> Unit,
    onUpdate: (String, Boolean, (LightLeak) -> LightLeak) -> Unit,
    onRemove: (String) -> Unit,
    onToggleZoom: () -> Unit,
    onDone: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val selected = leaks.firstOrNull { it.id == selectedId }
    var menuFor by remember { mutableStateOf<String?>(null) }

    Column(modifier) {
        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(start = 16.dp, end = 4.dp)) {
            Text("Light leaks", style = MaterialTheme.typography.titleSmall, modifier = Modifier.weight(1f))
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
            if (leaks.size < LightLeaks.MAX_LEAKS) {
                FilterChip(selected = false, onClick = { onAdd(LeakKind.STREAK) }, label = { Text("+ Streak") })
                FilterChip(selected = false, onClick = { onAdd(LeakKind.GLOW) }, label = { Text("+ Glow") })
            }
        }
        val leak = selected ?: run {
            LeakNote(
                "Add a film-style light leak, a streak (a beam of light across the photo) or a glow, then drag it over " +
                    "the photo. At full intensity its solid middle (inside the dashed lines) hides what is under it, so " +
                    "it can cover part of a photo; lower, it is light added to the picture. " +
                    "Up to ${LightLeaks.MAX_LEAKS}; leaks reset for each new photo.",
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
                    "Width", WIDTH.to(leak.ry), 0f..100f, WIDTH.to(LeakKind.STREAK.ry),
                    format = { WIDTH.from(it).let { r -> String.format(Locale.ROOT, if (r < 0.05f) "%.1f%%" else "%.0f%%", r * 200) } },
                ) { v -> set { it.copy(ry = WIDTH.from(v)) } }
                ParamSlider(
                    "Length", LENGTH.to(leak.rx), 0f..100f, LENGTH.to(LeakKind.STREAK.rx),
                    format = { "${(LENGTH.from(it) * 200).roundToInt()}%" },
                ) { v -> set { it.copy(rx = LENGTH.from(v)) } }
            } else {
                ParamSlider(
                    "Size", sizeToSlider(sizeOf(leak)), 0f..100f, sizeToSlider(sqrt(0.16f * 0.11f)),
                    format = { "${(sliderToSize(it) * 200).roundToInt()}%" },
                ) { v ->
                    set {
                        val k = sliderToSize(v) / sizeOf(it)
                        it.copy(rx = it.rx * k, ry = it.ry * k)
                    }
                }
                ParamSlider(
                    "Stretch", stretchOf(leak), -100f..100f, 0f,
                    format = { String.format(Locale.ROOT, "%.2f:1", 4f.pow(it / 100f)) },
                ) { v ->
                    set {
                        val s = sizeOf(it)
                        val ratio = sqrt(4f.pow(v / 100f))
                        it.copy(rx = s * ratio, ry = s / ratio)
                    }
                }
            }
            ParamSlider("Rotation", leak.angle, -180f..180f, 0f, format = { "${it.roundToInt()}°" }) { v ->
                set { it.copy(angle = v) }
            }
            ParamSlider("Softness", leak.softness, 0f..100f, leak.kind.softness, format = ::formatPlain) { v -> set { it.copy(softness = v) } }
            ParamSlider(
                "Colour", leak.hue, LightLeaks.HUE_MIN..LightLeaks.HUE_MAX, 22f, format = ::hueName, trackBrush = HUE_TRACK,
            ) { v -> set { it.copy(hue = v) } }
            TextButton(onClick = { set(force = true) { it.copy(seed = LightLeaks.newSeed()) } }) { Text("New shape") }
            LeakNote(
                (
                    if (leak.kind == LeakKind.STREAK) {
                        "Drag the streak to move it, the side dots to change its width, the end dots its length, the " +
                            "knob to turn it. Between the dashed lines it is solid at 100% intensity; it fades towards " +
                            "the solid lines and past its ends. "
                    } else {
                        "Drag the leak to move it, the dots to resize, the outer knob to rotate. Inside the dashed ring " +
                            "it is solid at 100% intensity; it fades out towards the solid ring. "
                    }
                    ) + "Several streaks side by side make a wider burn. Leaks aren't saved in presets: they belong to this photo.",
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
