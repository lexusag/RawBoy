package app.rawboy.view

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.zIndex
import app.rawboy.export.DateStampFormat
import app.rawboy.export.DateStampStyle
import app.rawboy.export.ExportSettings
import app.rawboy.export.FilmFrameColor
import app.rawboy.export.Pentax645Field
import app.rawboy.export.PhotoFrame
import app.rawboy.export.TimeStampFormat
import kotlin.math.roundToInt

/**
 * Frame and date-stamp controls shared by RawBoy Pro's [app.rawboy.ui.ExportDialog] and RawBoy Auto's
 * [app.rawboy.auto.ui.ExportOptions]: Frame picker (`Off`, `Date stamp`, `Pentax 645`, `Contax 645`), Date stamp style
 * and format, or Pentax/Contax color, flip, date/time format, and draggable EXIF + Frame # shoot-info items.
 */
@Composable
fun ExportFrameControls(
    settings: ExportSettings,
    onChange: (ExportSettings) -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
) {
    Column(modifier) {
        FrameChoiceRow(
            title = "Frame",
            options = PhotoFrame.entries,
            selected = settings.photoFrame,
            label = { it.label },
            enabled = enabled,
            onSelect = { frame ->
                val fmt = if (frame == PhotoFrame.DATE_STAMP && settings.dateStampFormat == DateStampFormat.MMM_YY) {
                    DateStampFormat.DMY
                } else {
                    settings.dateStampFormat
                }
                onChange(settings.copy(photoFrame = frame, dateStampFormat = fmt))
            },
        )
        if (settings.photoFrame == PhotoFrame.DATE_STAMP) {
            FrameChoiceRow(
                title = "Style",
                options = DateStampStyle.entries,
                selected = settings.dateStampStyle,
                label = { it.label },
                enabled = enabled,
                indent = true,
                onSelect = { onChange(settings.copy(dateStampStyle = it)) },
            )
            FrameChoiceRow(
                title = "Date format",
                options = listOf(DateStampFormat.DMY, DateStampFormat.YMD, DateStampFormat.MDY),
                selected = settings.dateStampFormat.takeIf { it != DateStampFormat.MMM_YY } ?: DateStampFormat.DMY,
                label = { it.label },
                enabled = enabled,
                indent = true,
                onSelect = { onChange(settings.copy(dateStampFormat = it)) },
            )
        }
        if (settings.photoFrame == PhotoFrame.PENTAX_645 || settings.photoFrame == PhotoFrame.CONTAX_645) {
            FrameChoiceRow(
                title = "Color",
                options = FilmFrameColor.entries,
                selected = settings.frameColor,
                label = { it.label },
                enabled = enabled,
                indent = true,
                onSelect = { onChange(settings.copy(frameColor = it)) },
            )
            Row(
                Modifier
                    .fillMaxWidth()
                    .padding(start = 12.dp, top = 6.dp, bottom = 4.dp)
                    .toggleable(
                        value = settings.pentax645Flip,
                        enabled = enabled,
                        role = Role.Switch,
                        onValueChange = { onChange(settings.copy(pentax645Flip = it)) },
                    ),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(Modifier.weight(1f)) {
                    Text("Flip info upside down", style = MaterialTheme.typography.bodyMedium)
                    Text(
                        "Rotate shoot info 180° like on real film",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                Spacer(Modifier.width(12.dp))
                Switch(checked = settings.pentax645Flip, onCheckedChange = null, enabled = enabled)
            }
            if (Pentax645Field.DATE in settings.pentax645Fields) {
                FrameChoiceRow(
                    title = "Date format",
                    options = DateStampFormat.entries,
                    selected = settings.dateStampFormat,
                    label = { it.label },
                    enabled = enabled,
                    indent = true,
                    onSelect = { onChange(settings.copy(dateStampFormat = it)) },
                )
            }
            if (Pentax645Field.TIME in settings.pentax645Fields) {
                FrameChoiceRow(
                    title = "Time format",
                    options = TimeStampFormat.entries,
                    selected = settings.timeStampFormat,
                    label = { it.label },
                    enabled = enabled,
                    indent = true,
                    onSelect = { onChange(settings.copy(timeStampFormat = it)) },
                )
            }
            Text(
                "Shoot info (drag ≡ to reorder)",
                style = MaterialTheme.typography.labelLarge,
                color = MaterialTheme.colorScheme.primary,
                modifier = Modifier.padding(start = 12.dp, top = 12.dp, bottom = 4.dp),
            )
            val order = remember(settings.pentax645Order) {
                val filtered = settings.pentax645Order.filter { it in Pentax645Field.EXPORT_FIELDS }.distinct()
                filtered + Pentax645Field.EXPORT_FIELDS.filter { it !in filtered }
            }
            val currentSettings by rememberUpdatedState(settings)
            val currentOrder by rememberUpdatedState(order)
            var draggingField by remember { mutableStateOf<Pentax645Field?>(null) }
            var dragOffsetY by remember { mutableFloatStateOf(0f) }
            var rowHeightPx by remember { mutableFloatStateOf(0f) }
            for (field in order) {
                key(field) {
                    val isDragging = draggingField == field
                    val checked = field in settings.pentax645Fields
                    Row(
                        Modifier
                            .fillMaxWidth()
                            .heightIn(min = 42.dp)
                            .zIndex(if (isDragging) 1f else 0f)
                            .graphicsLayer {
                                translationY = if (isDragging) dragOffsetY else 0f
                            }
                            .onSizeChanged {
                                if (it.height > 0) rowHeightPx = it.height.toFloat()
                            }
                            .toggleable(
                                value = checked,
                                enabled = enabled,
                                role = Role.Switch,
                                onValueChange = { on ->
                                    val nextFields = if (on) settings.pentax645Fields + field else settings.pentax645Fields - field
                                    onChange(settings.copy(pentax645Fields = nextFields))
                                },
                            )
                            .padding(start = 8.dp, top = 2.dp, bottom = 2.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Box(
                            Modifier
                                .size(36.dp)
                                .pointerInput(field, enabled) {
                                    if (!enabled) return@pointerInput
                                    detectDragGestures(
                                        onDragStart = {
                                            draggingField = field
                                            dragOffsetY = 0f
                                        },
                                        onDragEnd = {
                                            draggingField = null
                                            dragOffsetY = 0f
                                        },
                                        onDragCancel = {
                                            draggingField = null
                                            dragOffsetY = 0f
                                        },
                                        onDrag = { change, dragAmount ->
                                            change.consume()
                                            dragOffsetY += dragAmount.y
                                            val step = rowHeightPx.takeIf { it > 0f } ?: return@detectDragGestures
                                            val cur = currentOrder
                                            val idx = cur.indexOf(field)
                                            if (idx >= 0) {
                                                val target = (idx + (dragOffsetY / step).roundToInt())
                                                    .coerceIn(0, cur.lastIndex)
                                                if (target != idx) {
                                                    val next = cur.toMutableList()
                                                    val item = next.removeAt(idx)
                                                    next.add(target, item)
                                                    onChange(currentSettings.copy(pentax645Order = next))
                                                    dragOffsetY -= (target - idx) * step
                                                }
                                            }
                                        },
                                    )
                                },
                            contentAlignment = Alignment.Center,
                        ) {
                            Text(
                                "≡",
                                style = MaterialTheme.typography.titleMedium,
                                color = if (isDragging) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                        Spacer(Modifier.width(4.dp))
                        Text(
                            field.label,
                            style = MaterialTheme.typography.bodyMedium,
                            modifier = Modifier.weight(1f),
                        )
                        Spacer(Modifier.width(12.dp))
                        Switch(checked = checked, onCheckedChange = null, enabled = enabled)
                    }
                }
            }
        }
    }
}

@Composable
private fun <T> FrameChoiceRow(
    title: String,
    options: List<T>,
    selected: T,
    label: (T) -> String,
    enabled: Boolean,
    indent: Boolean = false,
    onSelect: (T) -> Unit,
) {
    Column(Modifier.padding(start = if (indent) 12.dp else 0.dp, top = 6.dp, bottom = 4.dp)) {
        Text(
            title,
            style = MaterialTheme.typography.labelLarge,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Row(
            Modifier
                .padding(top = 4.dp)
                .fillMaxWidth()
                .clip(RoundedCornerShape(8.dp))
                .background(MaterialTheme.colorScheme.surfaceContainerHighest),
        ) {
            for (o in options) {
                val on = o == selected
                Box(
                    Modifier
                        .weight(1f)
                        .heightIn(min = 36.dp)
                        .padding(2.dp)
                        .clip(RoundedCornerShape(6.dp))
                        .background(if (on) MaterialTheme.colorScheme.primary else Color.Transparent)
                        .clickable(enabled = enabled) { onSelect(o) }
                        .semantics { stateDescription = if (on) "Selected" else "Not selected" },
                    contentAlignment = Alignment.Center,
                ) {
                    Text(
                        label(o),
                        style = MaterialTheme.typography.labelMedium,
                        color = if (on) MaterialTheme.colorScheme.onPrimary else MaterialTheme.colorScheme.onSurface,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
            }
        }
    }
}
