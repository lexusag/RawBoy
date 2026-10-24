@file:OptIn(ExperimentalMaterial3Api::class)

package app.rawboy.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.PlainTooltip
import androidx.compose.material3.Text
import androidx.compose.material3.TooltipBox
import androidx.compose.material3.TooltipDefaults
import androidx.compose.material3.rememberTooltipState
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.addPathNodes
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.rawboy.view.HelpButton
import app.rawboy.view.RedoIcon
import app.rawboy.view.UndoIcon

/** The editor's top-bar tools; at most one replaces the slider tabs. */
enum class EditorMode { NONE, GEOMETRY, MASKS, LEAKS, PRESETS }

/**
 * Two short rows instead of a 64dp app bar: every action as an icon with a word under it (long-press for the full
 * name), then the file name and the shot info
 * (camera, ISO, shutter, aperture, focal length) in small type, with Undo, Redo and Reset all at its end (the first
 * row is full on a 360dp phone; Reset moved down when Light leaks joined it). The second line scrolls sideways when
 * it doesn't fit, rather than ending in an ellipsis.
 */
@Composable
fun EditorTopBar(
    fileName: String?,
    info: String?,
    enabled: Boolean,
    mode: EditorMode,
    onOpen: () -> Unit,
    onMode: (EditorMode) -> Unit,
    onReset: () -> Unit,
    onAuto: () -> Unit,
    canUndo: Boolean,
    canRedo: Boolean,
    onUndo: () -> Unit,
    onRedo: () -> Unit,
    onExport: () -> Unit,
    canOpen: Boolean,
) {
    Column(
        Modifier
            .background(MaterialTheme.colorScheme.surface)
            .statusBarsPadding()
            .fillMaxWidth(),
    ) {
        Row(Modifier.fillMaxWidth().height(52.dp).padding(start = 4.dp), verticalAlignment = Alignment.CenterVertically) {
            ToolButton(OpenIcon, "Open", "Open", canOpen, onOpen)
            ModeButton(EditorMode.GEOMETRY, CropRotateIcon, "Crop", "Crop & rotate", mode, enabled, onMode)
            ModeButton(EditorMode.MASKS, MasksIcon, "Masks", "Masks", mode, enabled, onMode)
            ModeButton(EditorMode.LEAKS, LeakIcon, "Leaks", "Light leaks", mode, enabled, onMode)
            ModeButton(EditorMode.PRESETS, PresetsIcon, "Presets", "Presets", mode, enabled, onMode)
            ToolButton(AutoIcon, "Auto", "Auto light and colour (keeps the LUT)", enabled, onAuto)
            Spacer(Modifier.weight(1f))
            ToolButton(ExportIcon, "Export", "Export", enabled, onExport, tint = MaterialTheme.colorScheme.primary)
            HelpButton("RawBoy", PRO_HELP, licences = true)
        }
        val secondary = MaterialTheme.colorScheme.onSurfaceVariant
        Row(Modifier.fillMaxWidth().padding(end = 4.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(
                buildAnnotatedString {
                    append(fileName ?: "RawBoy")
                    if (!info.isNullOrEmpty()) {
                        withStyle(SpanStyle(color = secondary)) { append("  ·  $info") }
                    }
                },
                style = MaterialTheme.typography.labelSmall,
                maxLines = 1,
                softWrap = false,
                modifier = Modifier.weight(1f).horizontalScroll(rememberScrollState()).padding(start = 16.dp, end = 8.dp),
            )
            IconButton(onClick = onUndo, enabled = enabled && canUndo, modifier = Modifier.size(40.dp)) {
                Icon(UndoIcon, contentDescription = "Undo")
            }
            IconButton(onClick = onRedo, enabled = enabled && canRedo, modifier = Modifier.size(40.dp)) {
                Icon(RedoIcon, contentDescription = "Redo")
            }
            IconButton(onClick = onReset, enabled = enabled, modifier = Modifier.size(40.dp)) {
                Icon(ResetIcon, contentDescription = "Reset all", modifier = Modifier.size(22.dp))
            }
        }
    }
}

@Composable
private fun ModeButton(
    target: EditorMode,
    icon: ImageVector,
    label: String,
    name: String,
    mode: EditorMode,
    enabled: Boolean,
    onMode: (EditorMode) -> Unit,
) {
    ToolButton(
        icon, label, name, enabled,
        onClick = { onMode(if (mode == target) EditorMode.NONE else target) },
        tint = if (mode == target) MaterialTheme.colorScheme.primary else LocalContentColor.current,
    )
}

/**
 * An icon with a word under it, 44dp wide so seven tools and Help fit a 360dp phone. Long press shows [name], the
 * full name (the icons alone weren't obvious, and a bare Refresh icon read as reload).
 */
@Composable
private fun ToolButton(
    icon: ImageVector,
    label: String,
    name: String,
    enabled: Boolean,
    onClick: () -> Unit,
    tint: Color = LocalContentColor.current,
) {
    TooltipBox(
        positionProvider = TooltipDefaults.rememberPlainTooltipPositionProvider(),
        tooltip = { PlainTooltip { Text(name) } },
        state = rememberTooltipState(),
    ) {
        val color = if (enabled) tint else LocalContentColor.current.copy(alpha = 0.38f)
        Column(
            Modifier
                .width(44.dp)
                .fillMaxHeight()
                .clickable(enabled = enabled, role = Role.Button, onClick = onClick),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center,
        ) {
            Icon(icon, contentDescription = name, tint = color, modifier = Modifier.size(22.dp))
            Text(
                label,
                color = color,
                fontSize = 10.sp,
                lineHeight = 12.sp,
                maxLines = 1,
                modifier = Modifier.clearAndSetSemantics {},
            )
        }
    }
}

private fun icon(name: String, path: String) = ImageVector.Builder(name, 24.dp, 24.dp, 24f, 24f)
    .addPath(pathData = addPathNodes(path), fill = SolidColor(Color.Black))
    .build()

/** Material "folder_open" icon (Apache 2.0). */
private val OpenIcon: ImageVector by lazy {
    icon(
        "FolderOpen",
        "M20,6h-8l-2,-2H4c-1.1,0 -1.99,0.9 -1.99,2L2,18c0,1.1 0.9,2 2,2h16c1.1,0 2,-0.9 2,-2V8c0,-1.1 -0.9,-2 -2,-2z" +
            "M20,18H4V8h16v10z",
    )
}

/** Material "settings_backup_restore" icon (Apache 2.0): Reset all, unlike Refresh, doesn't read as reload. */
private val ResetIcon: ImageVector by lazy {
    icon(
        "Reset",
        "M14,12c0,-1.1 -0.9,-2 -2,-2s-2,0.9 -2,2 0.9,2 2,2 2,-0.9 2,-2z" +
            "M12,3c-4.97,0 -9,4.03 -9,9H0l4,4 4,-4H5c0,-3.87 3.13,-7 7,-7s7,3.13 7,7 -3.13,7 -7,7" +
            "c-1.51,0 -2.91,-0.49 -4.06,-1.3l-1.42,1.44C8.04,20.3 9.94,21 12,21c4.97,0 9,-4.03 9,-9s-4.03,-9 -9,-9z",
    )
}

/** Material "auto_fix_high" icon (Apache 2.0): Auto as a labelled tool, so the row fits a 360dp phone. */
private val AutoIcon: ImageVector by lazy {
    icon(
        "Auto",
        "M7.5,5.6L10,7 8.6,4.5 10,2 7.5,3.4 5,2l1.4,2.5L5,7zM19.5,15.4L17,14l1.4,2.5L17,19l2.5,-1.4L22,19l-1.4,-2.5L22,14z" +
            "M22,2l-2.5,1.4L17,2l1.4,2.5L17,7l2.5,-1.4L22,7l-1.4,-2.5z" +
            "M14.37,7.29c-0.39,-0.39 -1.02,-0.39 -1.41,0L1.29,18.96c-0.39,0.39 -0.39,1.02 0,1.41l2.34,2.34" +
            "c0.39,0.39 1.02,0.39 1.41,0L16.7,11.05c0.39,-0.39 0.39,-1.02 0,-1.41l-2.33,-2.35z" +
            "M13.34,12.78l-2.12,-2.12 2.44,-2.44 2.12,2.12 -2.44,2.44z",
    )
}

/** Material "file_download" icon (Apache 2.0). */
private val ExportIcon: ImageVector by lazy { icon("Export", "M19,9h-4V3H9v6H5l7,7 7,-7zM5,18v2h14v-2H5z") }

/** Material "crop_rotate" icon (Apache 2.0), built here because it isn't in material-icons-core. */
private val CropRotateIcon: ImageVector by lazy {
    icon(
        "CropRotate",
        "M7.47,21.49C4.2,19.93 1.86,16.76 1.5,13H0c0.51,6.16 5.66,11 11.95,11 0.23,0 0.44,-0.02 0.66,-0.03" +
            "L8.8,20.15l-1.33,1.34zM12.05,0c-0.23,0 -0.44,0.02 -0.66,0.04l3.81,3.81 1.33,-1.33" +
            "C19.8,4.07 22.14,7.24 22.5,11H24c-0.51,-6.16 -5.66,-11 -11.95,-11zM16,14h2V8" +
            "c0,-1.11 -0.9,-2 -2,-2h-6v2h6v6zM8,16V4H6v2H4v2h2v8c0,1.1 0.89,2 2,2h8v2h2v-2h2v-2H8z",
    )
}

/** Material "bookmarks" icon (Apache 2.0), built here because it isn't in material-icons-core. */
private val PresetsIcon: ImageVector by lazy {
    icon(
        "Bookmarks",
        "M19,18l2,1V3c0,-1.1 -0.9,-2 -2,-2H8.99C7.89,1 7,1.9 7,3h10c1.1,0 2,0.9 2,2v13z" +
            "M15,5H5c-1.1,0 -2,0.9 -2,2v16l7,-3 7,3V7c0,-1.1 -0.9,-2 -2,-2z",
    )
}

/** Light leaks (same as RawBoy Web's): a diagonal beam of light with a glow either side, film-burn style. */
private val LeakIcon: ImageVector by lazy {
    ImageVector.Builder("LightLeak", 24.dp, 24.dp, 24f, 24f)
        .addPath(
            pathData = addPathNodes("M3,17L21,7"),
            stroke = SolidColor(Color.Black), strokeAlpha = 0.3f, strokeLineWidth = 8f, strokeLineCap = StrokeCap.Round,
        )
        .addPath(
            pathData = addPathNodes("M3,17L21,7"),
            stroke = SolidColor(Color.Black), strokeLineWidth = 3f, strokeLineCap = StrokeCap.Round,
        )
        .build()
}

/** Masks (same as RawBoy Web's): a frame with lines fading downwards and a soft disc. */
private val MasksIcon: ImageVector by lazy {
    ImageVector.Builder("Masks", 24.dp, 24.dp, 24f, 24f)
        .addPath(
            pathData = addPathNodes("M5,3h14a2,2 0,0 1,2 2v14a2,2 0,0 1,-2 2H5a2,2 0,0 1,-2 -2V5a2,2 0,0 1,2 -2z"),
            stroke = SolidColor(Color.Black), strokeLineWidth = 2f,
        )
        .addPath(pathData = addPathNodes("M3,8h18"), stroke = SolidColor(Color.Black), strokeLineWidth = 2f)
        .addPath(pathData = addPathNodes("M3,12h18"), stroke = SolidColor(Color.Black), strokeLineWidth = 2f, strokeAlpha = 0.6f)
        .addPath(pathData = addPathNodes("M3,16h18"), stroke = SolidColor(Color.Black), strokeLineWidth = 2f, strokeAlpha = 0.3f)
        .addPath(pathData = addPathNodes("M15,10a4,4 0,1 1,0 8a4,4 0,1 1,0 -8z"), fill = SolidColor(Color.Black), fillAlpha = 0.5f)
        .build()
}
