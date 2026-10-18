package app.rawboy.auto.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.InputChip
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.addPathNodes
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.rawboy.auto.AutoPhoto
import app.rawboy.auto.AutoViewModel
import app.rawboy.auto.LookMode
import app.rawboy.auto.PhotoStatus
import app.rawboy.develop.Presets
import app.rawboy.view.HelpButton

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun GridScreen(vm: AutoViewModel, snackbar: SnackbarHostState, pickPhotos: () -> Unit, pickPreset: (Set<String>?) -> Unit) {
    val photos by vm.photos.collectAsStateWithLifecycle()
    val export by vm.export.collectAsStateWithLifecycle()
    val importMode by vm.importMode.collectAsStateWithLifecycle()
    val exportSettings by vm.exportSettings.collectAsStateWithLifecycle()
    val preset by vm.preset.collectAsStateWithLifecycle()
    val lensPresets by vm.lensPresets.collectAsStateWithLifecycle()
    val lensChoice by vm.lensChoice.collectAsStateWithLifecycle()
    // The lens preset picker: null = closed, empty = the whole batch, else the selection as it was when it opened.
    var lensPresetsFor by remember { mutableStateOf<Set<String>?>(null) }
    val exporting = export != null
    val exportable = photos.count { it.analysis != null }

    // Long-press a photo to start selecting; tap then toggles. Selection is for rotating, removing, exporting and giving
    // photos (one scene) their own RawBoy preset.
    var selection by remember { mutableStateOf(emptySet<String>()) }
    val selecting = selection.isNotEmpty()
    // Drop ids of photos that left the list (removed elsewhere, e.g. via the detail view).
    LaunchedEffect(photos) {
        val ids = photos.map { it.id }.toSet()
        if (!ids.containsAll(selection)) selection = selection intersect ids
    }
    BackHandler(enabled = selecting) { selection = emptySet() }
    // The export sheet: null = closed, empty = every photo, else the selection as it was when Export was tapped.
    var exportSheet by remember { mutableStateOf<Set<String>?>(null) }
    val exportableSelected = photos.count { it.analysis != null && it.id in selection }

    Scaffold(
        topBar = {
            if (selecting) {
                TopAppBar(
                    navigationIcon = {
                        IconButton(onClick = { selection = emptySet() }) {
                            Icon(Icons.Default.Close, contentDescription = "Cancel selection")
                        }
                    },
                    title = { Text("${selection.size} selected") },
                    actions = {
                        TextButton(onClick = { selection = photos.map { it.id }.toSet() }) { Text("All") }
                        // A lens preset for these photos: manual lenses record no lens name to match by.
                        if (lensPresets.isNotEmpty()) {
                            TextButton(onClick = { lensPresetsFor = selection }, enabled = !exporting) { Text("Lens") }
                        }
                        IconButton(onClick = { vm.rotate(selection, -1) }, enabled = !exporting) {
                            Text("↺", style = MaterialTheme.typography.titleLarge, modifier = Modifier.semantics { contentDescription = "Rotate left" })
                        }
                        IconButton(onClick = { vm.rotate(selection, 1) }, enabled = !exporting) {
                            Text("↻", style = MaterialTheme.typography.titleLarge, modifier = Modifier.semantics { contentDescription = "Rotate right" })
                        }
                        // A preset file for just these photos (one scene); the rest of the batch keeps its own.
                        IconButton(
                            onClick = {
                                pickPreset(selection)
                                selection = emptySet()
                            },
                            enabled = !exporting,
                        ) { Icon(PresetsIcon, contentDescription = "Preset for these photos") }
                        IconButton(
                            onClick = {
                                vm.remove(selection)
                                selection = emptySet()
                            },
                            enabled = !exporting,
                        ) { Icon(Icons.Default.Delete, contentDescription = "Remove") }
                        Button(onClick = { exportSheet = selection }, enabled = !exporting && exportableSelected > 0) {
                            Text(if (exportableSelected > 1) "Export ($exportableSelected)" else "Export")
                        }
                    },
                )
            } else {
                TopAppBar(
                    title = { Text("RawBoy Auto") },
                    actions = {
                        TextButton(onClick = pickPhotos, enabled = !exporting) { Text("Add") }
                        Button(onClick = { exportSheet = emptySet() }, enabled = !exporting && exportable > 0) {
                            Text(if (exportable > 1) "Export all ($exportable)" else "Export")
                        }
                        HelpButton("RawBoy Auto", AUTO_HELP, licences = true)
                    },
                )
            }
        },
        snackbarHost = { SnackbarHost(snackbar) },
    ) { padding ->
        Column(
            Modifier
                .padding(padding)
                .fillMaxSize(),
        ) {
            // One line (two on narrow phones): the mode for photos added next (each can switch in its detail view)
            // and the batch's RawBoy preset. Export format and size are asked in ExportSheet, so the grid keeps the screen.
            if (!selecting) {
                FlowRow(
                    Modifier
                        .fillMaxWidth()
                        .padding(start = 16.dp, end = 8.dp, top = 4.dp, bottom = 4.dp),
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                    verticalArrangement = Arrangement.spacedBy(4.dp),
                ) {
                    Row(Modifier.align(Alignment.CenterVertically), verticalAlignment = Alignment.CenterVertically) {
                        Text(
                            "Import as",
                            style = MaterialTheme.typography.labelLarge,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier.padding(end = 12.dp),
                        )
                        ModeSwitch(importMode, vm::setImportMode, Modifier.width(200.dp), enabled = !exporting)
                    }
                    // A RawBoy preset (from a file, or sent from RawBoy) develops every photo in place of its look.
                    val p = preset
                    if (p != null) {
                        InputChip(
                            selected = true,
                            onClick = vm::removePreset,
                            enabled = !exporting,
                            label = { Text("Preset: ${p.name}", maxLines = 1, overflow = TextOverflow.Ellipsis) },
                            trailingIcon = { Icon(Icons.Default.Close, contentDescription = "Remove preset") },
                            modifier = Modifier.align(Alignment.CenterVertically),
                        )
                    } else {
                        TextButton(onClick = { pickPreset(null) }, enabled = !exporting, modifier = Modifier.align(Alignment.CenterVertically)) {
                            Text("Apply RawBoy preset…")
                        }
                    }
                    // Lens presets from RawBoy: by lens they correct every photo taken with their lens, whatever its
                    // look; a named one (manual lenses) is picked for the batch here or for a selection.
                    if (lensPresets.isNotEmpty()) {
                        val label = when (val c = lensChoice) {
                            null -> if (lensPresets.size == 1) "1 lens preset" else "${lensPresets.size} lens presets"
                            Presets.NO_LENS_PRESET -> "Lens: none"
                            else -> "Lens: ${lensPresets.firstOrNull { it.id == c }?.name ?: "by lens"}"
                        }
                        TextButton(onClick = { lensPresetsFor = emptySet() }, modifier = Modifier.align(Alignment.CenterVertically)) {
                            Text(label, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        }
                    }
                }
            }
            val lensTarget = lensPresetsFor
            if (lensTarget != null && lensPresets.isNotEmpty()) {
                val ids = lensTarget.takeIf { it.isNotEmpty() }
                val choices = ids?.let { photos.filter { p -> p.id in it }.map { p -> p.lensChoice }.distinct() }
                LensPresetsDialog(
                    lensPresets,
                    count = ids?.size,
                    choice = if (choices == null) lensChoice else if (choices.size == 1) choices[0] else MIXED,
                    onChoose = {
                        vm.chooseLensPreset(it, ids)
                        lensPresetsFor = null
                        if (ids != null) selection = emptySet()
                    },
                    onRemove = vm::removeLensPreset,
                    onClose = { lensPresetsFor = null },
                )
            }
            export?.let { e ->
                Text(
                    "Exporting ${minOf(e.done + 1, e.total)} of ${e.total}",
                    style = MaterialTheme.typography.labelMedium,
                    modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp),
                )
                LinearProgressIndicator(
                    progress = { ((e.done + e.current) / e.total).coerceIn(0f, 1f) },
                    modifier = Modifier.fillMaxWidth(),
                )
            }
            if (photos.isEmpty()) {
                Column(
                    Modifier.fillMaxSize().padding(32.dp),
                    verticalArrangement = Arrangement.Center,
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    Text(
                        if (importMode == LookMode.FILM) {
                            "Pick RAW photos. Each is developed automatically as film, on a suggested stock. " +
                                "JPEG, HEIC, PNG and TIFF work too, at lower quality."
                        } else {
                            "Pick RAW photos. Each is developed automatically and gets a suggested film look. " +
                                "JPEG, HEIC, PNG and TIFF work too, at lower quality."
                        },
                        textAlign = TextAlign.Center,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Spacer(Modifier.height(16.dp))
                    Button(onClick = pickPhotos) { Text("Choose photos") }
                }
            } else {
                // Justified rows: every photo at its own aspect, rows ~120dp high on phones and ~180dp wider up.
                BoxWithConstraints(Modifier.fillMaxSize()) {
                    val gap = 8.dp
                    val target = if (maxWidth < 600.dp) 120.dp else 180.dp
                    val aspects = photos.map { it.thumbnail?.let { t -> t.width.toFloat() / t.height } ?: 1.5f }
                    val rows = remember(aspects, maxWidth) {
                        justifiedRows(aspects, (maxWidth - gap * 2).value, target.value, gap.value)
                    }
                    LazyColumn(
                        contentPadding = PaddingValues(gap),
                        verticalArrangement = Arrangement.spacedBy(gap),
                        modifier = Modifier.fillMaxSize(),
                    ) {
                        items(rows, key = { photos[it.start].id }) { row ->
                            Row(Modifier.fillMaxWidth().height(row.height.dp), horizontalArrangement = Arrangement.spacedBy(gap)) {
                                for (i in row.start until row.end) {
                                    val photo = photos[i]
                                    val selected = photo.id in selection
                                    PhotoCell(
                                        photo,
                                        selected = selected,
                                        enabled = !exporting,
                                        onClick = {
                                            when {
                                                selecting -> selection = if (selected) selection - photo.id else selection + photo.id
                                                photo.analysis != null -> vm.openDetail(photo.id)
                                            }
                                        },
                                        onLongClick = { selection = selection + photo.id },
                                        modifier = (
                                            if (row.full) Modifier.weight(aspects[i]) else Modifier.width((aspects[i] * row.height).dp)
                                        ).fillMaxHeight(),
                                    )
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    exportSheet?.let { ids ->
        ExportSheet(
            count = if (ids.isEmpty()) exportable else photos.count { it.analysis != null && it.id in ids },
            settings = exportSettings,
            onChange = vm::setExportSettings,
            onDismiss = { exportSheet = null },
            onExport = {
                exportSheet = null
                if (ids.isEmpty()) {
                    vm.exportAll()
                } else {
                    selection = emptySet() // the grid's badges then show each photo's export
                    vm.exportAll(ids)
                }
            },
        )
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun PhotoCell(
    photo: AutoPhoto,
    selected: Boolean,
    enabled: Boolean,
    onClick: () -> Unit,
    onLongClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Box(modifier.combinedClickable(enabled = enabled, onClick = onClick, onLongClick = onLongClick)) {
        Box(
            Modifier
                .fillMaxSize()
                .background(Color(0xFF1E1E1E))
                .then(if (selected) Modifier.border(3.dp, MaterialTheme.colorScheme.primary) else Modifier),
            contentAlignment = Alignment.Center,
        ) {
            photo.thumbnail?.let {
                Image(it.asImageBitmap(), contentDescription = photo.name, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
            }
            when (photo.status) {
                PhotoStatus.QUEUED -> Badge("Waiting")
                PhotoStatus.ANALYZING -> CircularProgressIndicator(Modifier.size(32.dp))
                PhotoStatus.EXPORTING -> CircularProgressIndicator(Modifier.size(32.dp))
                PhotoStatus.FAILED -> Badge(photo.error ?: "Failed", error = true)
                PhotoStatus.EXPORTED -> Badge("Saved", Modifier.align(Alignment.TopEnd))
                PhotoStatus.READY -> Unit
            }
            if (selected) {
                Icon(
                    Icons.Default.CheckCircle,
                    contentDescription = "Selected",
                    tint = MaterialTheme.colorScheme.primary,
                    modifier = Modifier
                        .align(Alignment.TopStart)
                        .padding(6.dp)
                        .background(Color(0xCC000000), CircleShape),
                )
            }
            // Name and look over the bottom of the photo, on a fade so they read on bright skies.
            Column(
                Modifier
                    .align(Alignment.BottomStart)
                    .fillMaxWidth()
                    .background(Brush.verticalGradient(listOf(Color.Transparent, Color(0xB3000000))))
                    .padding(start = 8.dp, end = 8.dp, top = 16.dp, bottom = 5.dp),
            ) {
                Text(
                    photo.name,
                    style = MaterialTheme.typography.labelSmall,
                    color = Color.White.copy(alpha = 0.85f),
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                if (photo.analysis != null) {
                    Text(
                        photo.lookName,
                        style = MaterialTheme.typography.labelSmall,
                        fontWeight = FontWeight.SemiBold,
                        color = MaterialTheme.colorScheme.primary,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
            }
        }
    }
}

/** Photos [start, end) of one grid row, [height] dp high; [full] rows fill the width, the last one may not. */
internal data class GridRow(val start: Int, val end: Int, val height: Float, val full: Boolean)

/**
 * Justified rows (as RawBoy Web's Auto grid): photos join a row until it would be at most [target] high across
 * [width], so each photo keeps its own aspect and rows fill the width. The last row keeps [target] height.
 */
internal fun justifiedRows(aspects: List<Float>, width: Float, target: Float, gap: Float): List<GridRow> {
    val rows = ArrayList<GridRow>()
    var start = 0
    var sum = 0f
    for (i in aspects.indices) {
        sum += aspects[i]
        val height = (width - gap * (i - start)) / sum
        if (height <= target) {
            rows += GridRow(start, i + 1, height, full = true)
            start = i + 1
            sum = 0f
        }
    }
    if (start < aspects.size) rows += GridRow(start, aspects.size, target, full = false)
    return rows
}

@Composable
private fun Badge(text: String, modifier: Modifier = Modifier, error: Boolean = false) {
    Text(
        text,
        style = MaterialTheme.typography.labelSmall,
        color = if (error) MaterialTheme.colorScheme.error else Color.White,
        maxLines = 2,
        textAlign = TextAlign.Center,
        modifier = modifier
            .padding(6.dp)
            .background(Color(0x99000000))
            .padding(horizontal = 6.dp, vertical = 2.dp),
    )
}

/** Material "bookmarks" icon (Apache 2.0), as RawBoy's Presets button. */
private val PresetsIcon: ImageVector by lazy {
    ImageVector.Builder("Bookmarks", 24.dp, 24.dp, 24f, 24f)
        .addPath(
            pathData = addPathNodes(
                "M19,18l2,1V3c0,-1.1 -0.9,-2 -2,-2H8.99C7.89,1 7,1.9 7,3h10c1.1,0 2,0.9 2,2v13z" +
                    "M15,5H5c-1.1,0 -2,0.9 -2,2v16l7,-3 7,3V7c0,-1.1 -0.9,-2 -2,-2z",
            ),
            fill = SolidColor(Color.Black),
        )
        .build()
}
