package app.rawboy.view

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowDropDown
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import app.rawboy.export.ExportSettings

/**
 * Export size: one of [presets] (null = [fullLabel]) or a custom long side typed in pixels. Only a valid custom value
 * reaches [onChange] ([ExportSettings.parseLongSide]); an invalid one shows the allowed range and keeps the last good size.
 */
@Composable
fun LongSidePicker(
    value: Int?,
    presets: List<Int?>,
    fullLabel: String,
    onChange: (Int?) -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
) {
    var menuOpen by remember { mutableStateOf(false) }
    val isCustomValue = value != null && value !in presets
    var custom by remember { mutableStateOf(isCustomValue) }
    var text by remember { mutableStateOf(if (isCustomValue) value.toString() else "") }
    val showCustom = custom || isCustomValue
    val invalid = showCustom && text.isNotEmpty() && ExportSettings.parseLongSide(text) == null
    Column(modifier) {
        Box {
            TextButton(onClick = { menuOpen = true }, enabled = enabled) {
                Text(if (showCustom) "Custom" else value?.let { "$it px" } ?: fullLabel)
                Icon(Icons.Default.ArrowDropDown, contentDescription = null)
            }
            DropdownMenu(expanded = menuOpen, onDismissRequest = { menuOpen = false }) {
                presets.forEach { size ->
                    DropdownMenuItem(
                        text = { Text(size?.let { "$it px" } ?: fullLabel) },
                        onClick = {
                            menuOpen = false
                            custom = false
                            onChange(size)
                        },
                    )
                }
                DropdownMenuItem(
                    text = { Text("Custom\u2026") },
                    onClick = {
                        menuOpen = false
                        custom = true
                        text = value?.toString() ?: ""
                    },
                )
            }
        }
        if (showCustom) {
            OutlinedTextField(
                value = text,
                onValueChange = { t ->
                    val clean = t.filter { it in '0'..'9' }.take(6)
                    text = clean
                    ExportSettings.parseLongSide(clean)?.let(onChange)
                },
                label = { Text("Long side, px") },
                singleLine = true,
                enabled = enabled,
                isError = invalid,
                supportingText = {
                    Text(
                        if (invalid) "${ExportSettings.MIN_LONG_SIDE}\u2013${ExportSettings.MAX_LONG_SIDE} px"
                        else "Photos are never enlarged",
                    )
                },
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                modifier = Modifier.fillMaxWidth(),
            )
        }
    }
}
