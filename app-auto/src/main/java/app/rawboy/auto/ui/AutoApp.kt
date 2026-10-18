package app.rawboy.auto.ui

import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.rawboy.auto.AutoViewModel
import app.rawboy.develop.Preset
import app.rawboy.develop.PresetGroup

/** Grid of the batch, or one photo in detail. */
@Composable
fun AutoApp(vm: AutoViewModel) {
    val selected by vm.selected.collectAsStateWithLifecycle()
    val message by vm.message.collectAsStateWithLifecycle()
    val export by vm.export.collectAsStateWithLifecycle()
    val snackbar = remember { SnackbarHostState() }
    val picker = rememberLauncherForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { uris ->
        vm.add(uris)
    }
    val pickPhotos = { picker.launch(arrayOf("*/*")) } // raw MIME types are inconsistent across providers
    // The photos the preset being picked is for: null = the whole batch.
    var presetTarget by remember { mutableStateOf<Set<String>?>(null) }
    val presetPicker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        uri?.let { vm.openPresetFile(it, presetTarget) }
    }
    // As RawBoy's preset import: providers report .json files under any of these.
    val pickPreset = { ids: Set<String>? ->
        presetTarget = ids
        presetPicker.launch(arrayOf("application/json", "text/plain", "application/octet-stream"))
    }
    val presetChoices by vm.presetChoices.collectAsStateWithLifecycle()

    LaunchedEffect(message) {
        message?.let {
            snackbar.showSnackbar(it)
            vm.consumeMessage()
        }
    }

    // A batch export can take minutes; don't let the screen sleep and pause it.
    val view = LocalView.current
    DisposableEffect(export != null) {
        view.keepScreenOn = export != null
        onDispose { view.keepScreenOn = false }
    }

    val id = selected
    if (id != null) {
        BackHandler { vm.closeDetail() }
        DetailScreen(vm, id, snackbar)
    } else {
        GridScreen(vm, snackbar, pickPhotos, pickPreset)
    }
    if (presetChoices.isNotEmpty()) PresetChoiceDialog(presetChoices, vm::choosePreset)
}

/** Which preset of a file that holds several to apply to the batch; [onChoose] null = cancel. */
@Composable
private fun PresetChoiceDialog(presets: List<Preset>, onChoose: (Preset?) -> Unit) {
    AlertDialog(
        onDismissRequest = { onChoose(null) },
        title = { Text("Apply a RawBoy preset") },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState())) {
                for (p in presets) {
                    Column(
                        Modifier
                            .fillMaxWidth()
                            .clickable { onChoose(p) }
                            .padding(vertical = 8.dp),
                    ) {
                        Text(p.name)
                        Text(
                            groupSummary(p),
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
            }
        },
        confirmButton = {},
        dismissButton = { TextButton(onClick = { onChoose(null) }) { Text("Cancel") } },
    )
}

/**
 * The lens presets Auto keeps (sent from RawBoy or opened as files), each with the lens it corrects and a Remove
 * button. Photos taken with a listed lens get its corrections on top of their look or RawBoy preset.
 */
@Composable
internal fun LensPresetsDialog(presets: List<Preset>, onRemove: (String) -> Unit, onClose: () -> Unit) {
    AlertDialog(
        onDismissRequest = onClose,
        title = { Text("Lens presets") },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState())) {
                Text(
                    "Photos taken with these lenses get their corrections on top of their look. Save them in RawBoy's Lens tab.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                for (p in presets) {
                    Row(Modifier.fillMaxWidth().padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text(p.name)
                            Text(
                                lensLabel(p),
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                        TextButton(onClick = { onRemove(p.id) }) { Text("Remove") }
                    }
                }
            }
        },
        confirmButton = { TextButton(onClick = onClose) { Text("Done") } },
    )
}

/** Which photos a lens preset is for, as the lens presets list shows it. */
internal fun lensLabel(p: Preset): String {
    val lens = p.lens ?: return "Any lens"
    return lens.ifBlank { "Photos with no lens name" }
}

/** "Light · Color · Lens": the groups a preset holds. */
internal fun groupSummary(p: Preset): String = PresetGroup.entries.filter { it in p.groups }.joinToString(" · ") { it.label }
