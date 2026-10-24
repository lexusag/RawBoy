@file:OptIn(ExperimentalMaterial3Api::class)

package app.rawboy.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
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
 * Light leaks (mirrors RawBoy Web's LeaksPanel): film-style warm glows dragged into place on the photo, e.g. to
 * tastefully cover part of a nude. A top-bar mode like Masks: leak chips (tap a selected chip to hide or delete it),
 * then the selected leak's sliders; the shape is also moved and sized on the photo.
 */
@Composable
fun LeaksPanel(
    leaks: List<LightLeak>,
    selectedId: String?,
    zoomed: Boolean,
    onSelect: (String) -> Unit,
    onAdd: () -> Unit,
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
                        label = { Text(if (l.enabled) "Leak ${i + 1}" else "Leak ${i + 1} (off)") },
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
                FilterChip(selected = false, onClick = onAdd, label = { Text("+ Light leak") })
            }
        }
        val leak = selected ?: run {
            LeakNote(
                "Add a film-style light leak, then drag it over the photo. At full intensity its solid middle (inside " +
                    "the dashed ring) hides what is under it, so it can cover part of a photo; lower, it is a warm glow. " +
                    "Up to ${LightLeaks.MAX_LEAKS}; leaks reset for each new photo.",
                Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
            )
            return@Column
        }
        fun set(force: Boolean = false, change: (LightLeak) -> LightLeak) = onUpdate(leak.id, force, change)
        Column(Modifier.verticalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 6.dp)) {
            ParamSlider("Intensity", leak.intensity, 0f..100f, 100f, format = { "${it.roundToInt()}%" }) { v ->
                set { it.copy(intensity = v) }
            }
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
            ParamSlider("Rotation", leak.angle, -180f..180f, 0f, format = { "${it.roundToInt()}°" }) { v ->
                set { it.copy(angle = v) }
            }
            ParamSlider("Softness", leak.softness, 0f..100f, 50f, format = ::formatPlain) { v -> set { it.copy(softness = v) } }
            ParamSlider(
                "Colour", leak.hue, LightLeaks.HUE_MIN..LightLeaks.HUE_MAX, 22f, format = ::hueName, trackBrush = HUE_TRACK,
            ) { v -> set { it.copy(hue = v) } }
            TextButton(onClick = { set(force = true) { it.copy(seed = LightLeaks.newSeed()) } }) { Text("New shape") }
            LeakNote(
                "Drag the leak to move it, the dots to resize, the outer knob to rotate. Inside the dashed ring it is " +
                    "solid at 100% intensity; it fades out towards the solid ring. Leaks aren't saved in presets: they " +
                    "belong to this photo.",
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
