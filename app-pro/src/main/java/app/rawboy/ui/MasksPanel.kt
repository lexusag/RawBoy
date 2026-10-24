@file:OptIn(ExperimentalMaterial3Api::class)

package app.rawboy.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.PrimaryTabRow
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import app.rawboy.develop.LayerAdjust
import app.rawboy.develop.MaskLayer
import app.rawboy.develop.MaskShape
import app.rawboy.develop.Masks
import java.util.Locale
import kotlin.math.ln
import kotlin.math.pow
import kotlin.math.roundToInt

/** Size slider 0..100 <-> brush radius (fraction of the long side), exponential so small brushes are easy to set. */
internal fun sizeToRadius(v: Float) =
    (Masks.MIN_BRUSH_RADIUS * (Masks.MAX_BRUSH_RADIUS / Masks.MIN_BRUSH_RADIUS).toDouble().pow(v / 100.0)).toFloat()

internal fun radiusToSize(r: Float) =
    (100 * ln(r / Masks.MIN_BRUSH_RADIUS) / ln(Masks.MAX_BRUSH_RADIUS / Masks.MIN_BRUSH_RADIUS)).toFloat()

private fun subtitle(l: MaskLayer) = when (l.shape) {
    MaskShape.Brush -> "Brush"
    is MaskShape.Linear -> "Linear"
    is MaskShape.Radial -> "Radial"
} + if (l.strokes.isNotEmpty() && l.shape != MaskShape.Brush) " + brush" else ""

/** What the masks panel can do; mask layers live in the params, the rest is UI state. */
class MaskPanelActions(
    val onSelect: (String) -> Unit,
    val onAdd: (MaskShape) -> Unit,
    val onUpdate: (String, (MaskLayer) -> MaskLayer) -> Unit,
    val onRemove: (String) -> Unit,
    val onTool: (MaskTool) -> Unit,
    val onBrush: (BrushSettings) -> Unit,
    /** The Size slider moved (show the brush size over the photo for a moment). */
    val onSizeChanging: () -> Unit,
    val onShowMask: (Boolean) -> Unit,
    val onUndoStroke: (String) -> Unit,
    val onClearBrush: (String) -> Unit,
    val onToggleZoom: () -> Unit,
    val onDone: () -> Unit,
)

/**
 * Mask layers (gradients and brush), each with its own adjustments (Capture One style). A top-bar mode like
 * Crop & rotate: layer chips (tap a selected chip for rename / hide / delete), then the selected layer's mask
 * tools and its adjustments on two small tabs, so it fits the slider panel's height.
 */
@Composable
fun MasksPanel(
    layers: List<MaskLayer>,
    selectedId: String?,
    tool: MaskTool,
    brush: BrushSettings,
    showMask: Boolean,
    zoomed: Boolean,
    actions: MaskPanelActions,
    modifier: Modifier = Modifier,
) {
    val layer = layers.firstOrNull { it.id == selectedId }
    var tab by rememberSaveable { mutableIntStateOf(0) }
    var menuFor by remember { mutableStateOf<String?>(null) }
    var renaming by remember { mutableStateOf<MaskLayer?>(null) }
    var adding by remember { mutableStateOf(false) }

    Column(modifier) {
        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(start = 16.dp, end = 4.dp)) {
            Text("Masks", style = MaterialTheme.typography.titleSmall, modifier = Modifier.weight(1f))
            TextButton(onClick = actions.onToggleZoom) { Text(if (zoomed) "Fit" else "100%") }
            TextButton(onClick = actions.onDone) { Text("Done") }
        }
        Row(
            horizontalArrangement = Arrangement.spacedBy(6.dp),
            verticalAlignment = Alignment.CenterVertically,
            modifier = Modifier.horizontalScroll(rememberScrollState()).padding(horizontal = 12.dp),
        ) {
            for (l in layers) {
                Box {
                    FilterChip(
                        selected = l.id == selectedId,
                        onClick = { if (l.id == selectedId) menuFor = l.id else actions.onSelect(l.id) },
                        label = { Text(if (l.enabled) l.name else "${l.name} (off)") },
                    )
                    DropdownMenu(expanded = menuFor == l.id, onDismissRequest = { menuFor = null }) {
                        DropdownMenuItem(text = { Text("Rename") }, onClick = { menuFor = null; renaming = l })
                        DropdownMenuItem(
                            text = { Text(if (l.enabled) "Hide" else "Show") },
                            onClick = { menuFor = null; actions.onUpdate(l.id) { it.copy(enabled = !it.enabled) } },
                        )
                        DropdownMenuItem(text = { Text("Delete") }, onClick = { menuFor = null; actions.onRemove(l.id) })
                    }
                }
            }
            if (layers.size < Masks.MAX_LAYERS) {
                Box {
                    FilterChip(selected = false, onClick = { adding = true }, label = { Text("+ Add") })
                    DropdownMenu(expanded = adding, onDismissRequest = { adding = false }) {
                        DropdownMenuItem(text = { Text("Linear gradient") }, onClick = { adding = false; actions.onAdd(Masks.newLinear().shape) })
                        DropdownMenuItem(text = { Text("Radial gradient") }, onClick = { adding = false; actions.onAdd(Masks.newRadial().shape) })
                        DropdownMenuItem(text = { Text("Brush") }, onClick = { adding = false; actions.onAdd(MaskShape.Brush) })
                    }
                }
            }
        }
        if (layer == null) {
            Note(
                "Add a linear gradient (a graduated filter, e.g. for the sky), a radial one (a soft ellipse) or a brush " +
                    "layer, then shape it on the photo and adjust only that area. Up to ${Masks.MAX_LAYERS} layers; " +
                    "masks reset for each new photo.",
                Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
            )
            return@Column
        }
        PrimaryTabRow(selectedTabIndex = tab) {
            SmallTab("Mask · ${subtitle(layer)}", tab == 0) { tab = 0 }
            SmallTab("Adjust", tab == 1) { tab = 1 }
        }
        Column(Modifier.verticalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 6.dp)) {
            if (tab == 0) {
                MaskTab(layer, tool, brush, showMask, actions)
            } else {
                AdjustTab(layer, actions)
            }
        }
    }

    renaming?.let { l ->
        var name by remember(l.id) { mutableStateOf(l.name) }
        AlertDialog(
            onDismissRequest = { renaming = null },
            title = { Text("Rename layer") },
            text = { OutlinedTextField(name, { name = it }, singleLine = true) },
            confirmButton = {
                TextButton(onClick = {
                    val n = name.trim().ifEmpty { Masks.name(l.shape) }
                    actions.onUpdate(l.id) { it.copy(name = n) }
                    renaming = null
                }) { Text("Rename") }
            },
            dismissButton = { TextButton(onClick = { renaming = null }) { Text("Cancel") } },
        )
    }
}

@Composable
private fun MaskTab(layer: MaskLayer, tool: MaskTool, brush: BrushSettings, showMask: Boolean, actions: MaskPanelActions) {
    SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
        val tools = listOf(MaskTool.MOVE to if (layer.shape == MaskShape.Brush) "Select" else "Move", MaskTool.BRUSH to "Brush", MaskTool.ERASE to "Erase")
        tools.forEachIndexed { i, (t, label) ->
            SegmentedButton(
                selected = tool == t,
                onClick = { actions.onTool(t) },
                shape = SegmentedButtonDefaults.itemShape(i, tools.size),
                modifier = Modifier.height(36.dp),
                label = { Text(label, style = MaterialTheme.typography.labelMedium) },
            )
        }
    }
    if (tool != MaskTool.MOVE) {
        ParamSlider("Size", radiusToSize(brush.radius), 0f..100f, radiusToSize(0.03f), format = { _ ->
            String.format(Locale.ROOT, if (brush.radius < 0.05f) "%.1f%%" else "%.0f%%", brush.radius * 200)
        }) {
            actions.onBrush(brush.copy(radius = sizeToRadius(it)))
            actions.onSizeChanging()
        }
        ParamSlider("Hardness", brush.hardness, 0f..100f, 50f, format = ::formatPlain) { actions.onBrush(brush.copy(hardness = it)) }
        ParamSlider("Flow", brush.flow, 1f..100f, 100f, format = ::formatPlain) { actions.onBrush(brush.copy(flow = it)) }
        SwitchRow("Auto mask: only colours like the one under the brush", brush.auto) { actions.onBrush(brush.copy(auto = it)) }
        Row {
            TextButton(onClick = { actions.onUndoStroke(layer.id) }, enabled = layer.strokes.isNotEmpty()) { Text("Undo stroke") }
            TextButton(onClick = { actions.onClearBrush(layer.id) }, enabled = layer.strokes.isNotEmpty()) { Text("Clear brush") }
        }
    }
    SwitchRow("Show mask", showMask, actions.onShowMask)
    SwitchRow("Invert", layer.invert) { v -> actions.onUpdate(layer.id) { it.copy(invert = v) } }
    ParamSlider("Opacity", layer.opacity, 0f..100f, 100f, format = { "${it.roundToInt()}%" }) { v ->
        actions.onUpdate(layer.id) { it.copy(opacity = v) }
    }
    when (val s = layer.shape) {
        is MaskShape.Linear -> ParamSlider("Curvature", s.curve, -100f..100f, 0f) { v ->
            actions.onUpdate(layer.id) { l -> (l.shape as? MaskShape.Linear)?.let { l.copy(shape = it.copy(curve = v)) } ?: l }
        }
        is MaskShape.Radial -> ParamSlider("Feather", s.feather, 0f..100f, 50f, format = ::formatPlain) { v ->
            actions.onUpdate(layer.id) { l -> (l.shape as? MaskShape.Radial)?.let { l.copy(shape = it.copy(feather = v)) } ?: l }
        }
        MaskShape.Brush -> Unit
    }
    Note(
        when {
            tool != MaskTool.MOVE -> "Paint with one finger, pan the 100% view with two."
            layer.shape is MaskShape.Linear ->
                "Solid line: full effect. Dashed line: no effect. Drag the middle line to move the gradient, an outer " +
                    "line to change its width and angle, the square to bend it."
            layer.shape is MaskShape.Radial ->
                "Drag the centre to move, the dots to resize, the outer knob to rotate. The effect fades between the " +
                    "dashed and the solid ellipse."
            else -> "Pick Brush to paint this layer's mask."
        },
    )
    if (layer.strokes.isNotEmpty()) Note("Brush strokes belong to this photo: presets keep gradients only.")
}

@Composable
private fun AdjustTab(layer: MaskLayer, actions: MaskPanelActions) {
    val a = layer.adjust
    fun set(change: LayerAdjust.(Float) -> LayerAdjust): (Float) -> Unit = { v -> actions.onUpdate(layer.id) { it.copy(adjust = it.adjust.change(v)) } }
    ParamSlider("Exposure", a.exposure, -5f..5f, 0f, ::formatEv, onChange = set { copy(exposure = it) })
    ParamSlider("Contrast", a.contrast, -100f..100f, 0f, onChange = set { copy(contrast = it) })
    ParamSlider("Highlights", a.highlights, -100f..100f, 0f, onChange = set { copy(highlights = it) })
    ParamSlider("Shadows", a.shadows, -100f..100f, 0f, onChange = set { copy(shadows = it) })
    ParamSlider("Temperature", a.temperature, -100f..100f, 0f, onChange = set { copy(temperature = it) })
    ParamSlider("Tint", a.tint, -100f..100f, 0f, onChange = set { copy(tint = it) })
    ParamSlider("Saturation", a.saturation, -100f..100f, 0f, onChange = set { copy(saturation = it) })
    ParamSlider("Clarity", a.clarity, -100f..100f, 0f, onChange = set { copy(clarity = it) })
    ParamSlider("Lens blur", a.lensBlur, 0f..100f, 0f, onChange = set { copy(lensBlur = it) })
}

@Composable
private fun SwitchRow(label: String, checked: Boolean, onChange: (Boolean) -> Unit) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier.fillMaxWidth().height(40.dp).clickable { onChange(!checked) },
    ) {
        Text(label, style = MaterialTheme.typography.bodySmall, modifier = Modifier.weight(1f))
        Switch(checked = checked, onCheckedChange = onChange)
    }
}

@Composable
private fun Note(text: String, modifier: Modifier = Modifier) {
    Text(
        text,
        style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = modifier.padding(top = 4.dp),
    )
}
