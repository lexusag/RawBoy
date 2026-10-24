@file:OptIn(ExperimentalMaterial3Api::class)

package app.rawboy.ui

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Slider
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import app.rawboy.export.ExportFormat
import app.rawboy.export.ExportSettings
import app.rawboy.export.MediaStoreOutput
import app.rawboy.export.OutputNaming
import kotlin.math.roundToInt

@Composable
fun ExportDialog(
    initial: ExportSettings,
    sourceName: String,
    onDismiss: () -> Unit,
    onExport: (ExportSettings) -> Unit,
    /** Hands the photo with all its edits to RawBoy Auto, for its batch export. */
    onSendToAuto: () -> Unit,
) {
    var settings by remember { mutableStateOf(initial) }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Export") },
        text = {
            Column {
                SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth()) {
                    ExportFormat.entries.forEachIndexed { index, format ->
                        SegmentedButton(
                            selected = settings.format == format,
                            onClick = { settings = settings.copy(format = format) },
                            shape = SegmentedButtonDefaults.itemShape(index, ExportFormat.entries.size),
                        ) { Text(format.name) }
                    }
                }
                Spacer(Modifier.height(16.dp))

                when (settings.format) {
                    ExportFormat.JPEG -> {
                        Text("Quality: ${settings.jpegQuality}")
                        Slider(
                            value = settings.jpegQuality.toFloat(),
                            onValueChange = { settings = settings.copy(jpegQuality = it.roundToInt()) },
                            valueRange = 1f..100f,
                        )
                    }
                    ExportFormat.TIFF -> {
                        Text("Bit depth")
                        SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth()) {
                            listOf(8, 16).forEachIndexed { index, bits ->
                                SegmentedButton(
                                    selected = settings.tiffBits == bits,
                                    onClick = { settings = settings.copy(tiffBits = bits) },
                                    shape = SegmentedButtonDefaults.itemShape(index, 2),
                                ) { Text("$bits-bit") }
                            }
                        }
                    }
                }

                Spacer(Modifier.height(16.dp))
                val name = MediaStoreOutput.fileName(
                    MediaStoreOutput.baseNameOf(sourceName), settings.format.extension, 0,
                )
                Text(
                    "${OutputNaming().relativePath}$name",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Spacer(Modifier.height(16.dp))
                HorizontalDivider()
                Spacer(Modifier.height(8.dp))
                Text(
                    "Or add this photo to RawBoy Auto's batch with every edit (crop, masks, lens blur, light leaks) " +
                        "and export it there with the rest.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                TextButton(onClick = onSendToAuto) { Text("Send to Auto") }
            }
        },
        confirmButton = { TextButton(onClick = { onExport(settings) }) { Text("Export") } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}
