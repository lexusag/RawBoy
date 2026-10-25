package app.rawboy.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Checkbox
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import app.rawboy.develop.Preset
import app.rawboy.develop.PresetGroup
import app.rawboy.develop.Presets

/** What the Presets panel can do; the editor screen wires these to the view model and the file pickers. */
class PresetActions(
    val apply: (Preset) -> Unit,
    val save: (String, Set<PresetGroup>) -> Unit,
    val update: (Preset) -> Unit,
    val rename: (Preset, String) -> Unit,
    val delete: (Preset) -> Unit,
    val export: (List<Preset>) -> Unit,
    val import: () -> Unit,
    /** Hands the preset to RawBoy Auto, which applies it to its whole batch. */
    val sendToAuto: (Preset) -> Unit,
)

/**
 * Opened from the top bar in place of the slider tabs: saved presets (tap to apply, menu to update, rename,
 * export, send to Auto or delete) and saving the current edits as a new one.
 */
@Composable
fun PresetsPanel(
    presets: List<Preset>,
    actions: PresetActions,
    onDone: () -> Unit,
    modifier: Modifier = Modifier,
    /** The photo has brush strokes (which presets don't keep): the save dialog says so. */
    hasStrokes: Boolean = false,
) {
    Column(modifier.padding(horizontal = 16.dp, vertical = 8.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("Presets", style = MaterialTheme.typography.titleSmall, modifier = Modifier.weight(1f))
            TextButton(onClick = onDone) { Text("Done") }
        }
        Column(Modifier.verticalScroll(rememberScrollState())) { PresetsContent(presets, actions, hasStrokes) }
    }
}

@Composable
private fun PresetsContent(presets: List<Preset>, actions: PresetActions, hasStrokes: Boolean) {
    var saving by remember { mutableStateOf(false) }
    var renaming by remember { mutableStateOf<Preset?>(null) }
    var deleting by remember { mutableStateOf<Preset?>(null) }

    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(bottom = 4.dp)) {
        OutlinedButton(onClick = { saving = true }) { Text("Save current…") }
        TextButton(onClick = actions.import) { Text("Import") }
        TextButton(onClick = { actions.export(presets) }, enabled = presets.isNotEmpty()) { Text("Export all") }
    }
    if (presets.isEmpty()) {
        Text(
            "No presets yet. Save the current edits (any groups of sliders) to reuse them on other photos. " +
                "Rotation, flips, straightening and crop are never part of a preset.",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
    for ((label, section) in Presets.sections(presets)) {
        if (label != null) SectionLabel(label)
        for (p in section) {
            PresetRow(
                p,
                onApply = { actions.apply(p) },
                onUpdate = { actions.update(p) },
                onRename = { renaming = p },
                onExport = { actions.export(listOf(p)) },
                onSendToAuto = { actions.sendToAuto(p) },
                onDelete = { deleting = p },
            )
        }
    }

    if (saving) {
        SavePresetDialog(
            hasStrokes = hasStrokes,
            onDismiss = { saving = false },
            onSave = { name, groups ->
                saving = false
                actions.save(name, groups)
            },
        )
    }
    renaming?.let { p ->
        NameDialog(
            title = "Rename preset", initial = p.name, confirm = "Rename",
            onDismiss = { renaming = null },
            onConfirm = {
                renaming = null
                actions.rename(p, it)
            },
        )
    }
    deleting?.let { p ->
        AlertDialog(
            onDismissRequest = { deleting = null },
            title = { Text("Delete “${p.name}”?") },
            confirmButton = {
                TextButton(onClick = {
                    deleting = null
                    actions.delete(p)
                }) { Text("Delete") }
            },
            dismissButton = { TextButton(onClick = { deleting = null }) { Text("Cancel") } },
        )
    }
}

@Composable
private fun PresetRow(
    preset: Preset,
    onApply: () -> Unit,
    onUpdate: () -> Unit,
    onRename: () -> Unit,
    onExport: () -> Unit,
    onSendToAuto: () -> Unit,
    onDelete: () -> Unit,
) {
    var menu by remember { mutableStateOf(false) }
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onApply)
            .padding(vertical = 4.dp),
    ) {
        Column(Modifier.weight(1f)) {
            Text(preset.name, style = MaterialTheme.typography.bodyMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(
                PresetGroup.entries.filter { it in preset.groups }.joinToString(" · ") { it.label },
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
        Box {
            IconButton(onClick = { menu = true }) { Icon(Icons.Default.MoreVert, contentDescription = "Preset options") }
            DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                DropdownMenuItem(text = { Text("Update from current") }, onClick = { menu = false; onUpdate() })
                DropdownMenuItem(text = { Text("Rename") }, onClick = { menu = false; onRename() })
                DropdownMenuItem(text = { Text("Export") }, onClick = { menu = false; onExport() })
                DropdownMenuItem(text = { Text("Send to Auto") }, onClick = { menu = false; onSendToAuto() })
                DropdownMenuItem(text = { Text("Delete") }, onClick = { menu = false; onDelete() })
            }
        }
    }
}

@Composable
private fun SavePresetDialog(hasStrokes: Boolean, onDismiss: () -> Unit, onSave: (String, Set<PresetGroup>) -> Unit) {
    var name by remember { mutableStateOf("") }
    var groups by remember { mutableStateOf(PresetGroup.DEFAULT) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Save preset") },
        text = {
            Column {
                OutlinedTextField(name, { name = it }, label = { Text("Name") }, singleLine = true)
                val all = groups.size == PresetGroup.entries.size
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween,
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(top = 4.dp),
                ) {
                    Text(
                        "Include",
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.primary,
                    )
                    TextButton(onClick = { groups = if (all) emptySet() else PresetGroup.entries.toSet() }) {
                        Text(if (all) "Deselect all" else "Select all")
                    }
                }
                for (g in PresetGroup.entries) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        modifier = Modifier
                            .fillMaxWidth()
                            .clickable { groups = if (g in groups) groups - g else groups + g },
                    ) {
                        Checkbox(checked = g in groups, onCheckedChange = null, modifier = Modifier.padding(8.dp))
                        Text(g.label, style = MaterialTheme.typography.bodyMedium)
                    }
                }
                if (hasStrokes && PresetGroup.MASKS in groups) {
                    Text(
                        "Brush strokes aren't saved in presets: they belong to this photo.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        },
        confirmButton = {
            TextButton(onClick = { onSave(name, groups) }, enabled = name.isNotBlank() && groups.isNotEmpty()) {
                Text("Save")
            }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}

@Composable
private fun NameDialog(title: String, initial: String, confirm: String, onDismiss: () -> Unit, onConfirm: (String) -> Unit) {
    var name by remember { mutableStateOf(initial) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = { OutlinedTextField(name, { name = it }, label = { Text("Name") }, singleLine = true) },
        confirmButton = { TextButton(onClick = { onConfirm(name) }, enabled = name.isNotBlank()) { Text(confirm) } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}
