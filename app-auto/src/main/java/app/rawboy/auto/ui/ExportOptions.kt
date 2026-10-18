package app.rawboy.auto.ui

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowDropDown
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
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
import androidx.compose.ui.unit.dp
import app.rawboy.auto.AutoViewModel
import app.rawboy.export.ExportFormat
import app.rawboy.export.ExportSettings
import app.rawboy.view.CompactSlider
import kotlin.math.roundToInt

/**
 * Asked on Export all and the photo view's Export: format, quality or bit depth, and size (kept for the next exports,
 * as RawBoy's export dialog). They used to sit above the grid all the time.
 */
@Composable
fun ExportSheet(
    count: Int,
    settings: ExportSettings,
    onChange: (ExportSettings) -> Unit,
    onDismiss: () -> Unit,
    onExport: () -> Unit,
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(if (count > 1) "Export $count photos" else "Export") },
        text = {
            Column {
                ExportOptions(settings, onChange, Modifier.fillMaxWidth())
                Text(
                    "Saved to Pictures/${AutoViewModel.NAMING.folder}",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(top = 8.dp),
                )
            }
        },
        confirmButton = { Button(onClick = onExport) { Text("Export") } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}

/** Format, JPEG quality or TIFF bit depth, and size of exports (in [ExportSheet]). */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ExportOptions(
    settings: ExportSettings,
    onChange: (ExportSettings) -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
) {
    Column(modifier) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                "Format",
                style = MaterialTheme.typography.labelLarge,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(end = 12.dp),
            )
            SingleChoiceSegmentedButtonRow(Modifier.weight(1f)) {
                ExportFormat.entries.forEachIndexed { i, format ->
                    SegmentedButton(
                        selected = settings.format == format,
                        onClick = { onChange(settings.copy(format = format)) },
                        shape = SegmentedButtonDefaults.itemShape(i, ExportFormat.entries.size),
                        enabled = enabled,
                    ) { Text(format.name) }
                }
            }
            var open by remember { mutableStateOf(false) }
            Box {
                TextButton(onClick = { open = true }, enabled = enabled) {
                    Text(sizeLabel(settings.maxLongSide))
                    Icon(Icons.Default.ArrowDropDown, contentDescription = null)
                }
                DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
                    AutoViewModel.EXPORT_SIZES.forEach { size ->
                        DropdownMenuItem(
                            text = { Text(sizeLabel(size)) },
                            onClick = {
                                open = false
                                onChange(settings.copy(maxLongSide = size))
                            },
                        )
                    }
                }
            }
        }
        when (settings.format) {
            ExportFormat.JPEG -> CompactSlider(
                "Quality",
                settings.jpegQuality.toFloat(),
                1f..100f,
                AutoViewModel.SETTINGS.jpegQuality.toFloat(),
                modifier = Modifier.padding(end = 8.dp),
                labelWidth = 88.dp,
                valueWidth = 44.dp,
                format = { it.roundToInt().toString() },
            ) { if (enabled) onChange(settings.copy(jpegQuality = it.roundToInt().coerceIn(1, 100))) }
            ExportFormat.TIFF -> SingleChoiceSegmentedButtonRow(
                Modifier
                    .fillMaxWidth()
                    .padding(start = 88.dp, top = 4.dp, end = 8.dp, bottom = 4.dp),
            ) {
                listOf(8, 16).forEachIndexed { i, bits ->
                    SegmentedButton(
                        selected = settings.tiffBits == bits,
                        onClick = { onChange(settings.copy(tiffBits = bits)) },
                        shape = SegmentedButtonDefaults.itemShape(i, 2),
                        enabled = enabled,
                    ) { Text("$bits-bit") }
                }
            }
        }
    }
}

private fun sizeLabel(maxLongSide: Int?) = if (maxLongSide == null) "Original" else "$maxLongSide px"
