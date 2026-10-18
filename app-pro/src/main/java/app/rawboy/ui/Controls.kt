@file:OptIn(ExperimentalMaterial3Api::class)

package app.rawboy.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.PrimaryTabRow
import androidx.compose.material3.Tab
import androidx.compose.material3.Text
import androidx.compose.foundation.selection.selectable
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.RadioButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.ui.semantics.Role
import androidx.compose.material3.Switch
import androidx.compose.material3.TextButton
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.width
import androidx.compose.ui.text.style.TextAlign
import app.rawboy.lens.LensInfo
import app.rawboy.lut.LutEntry
import app.rawboy.lut.LutLibrary
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import app.rawboy.color.PrimariesSlider
import app.rawboy.color.PrimariesTrack
import app.rawboy.color.WhiteBalance
import app.rawboy.develop.CropAspect
import app.rawboy.develop.DevelopParams
import app.rawboy.develop.ToneMapper
import app.rawboy.auto.looks.FilmLooks
import app.rawboy.develop.crop
import app.rawboy.session.BlemishState
import app.rawboy.session.SkinState
import app.rawboy.view.CompactSlider
import app.rawboy.view.LookDropdown
import java.util.Locale
import kotlin.math.ln
import kotlin.math.pow
import kotlin.math.roundToInt

@Composable
fun ControlsPanel(
    params: DevelopParams,
    defaults: DevelopParams,
    onChange: (DevelopParams) -> Unit,
    luts: LutLibrary,
    lutLoading: Boolean,
    onSelectLut: (String?) -> Unit,
    filmLoading: Boolean,
    onToneMapper: (ToneMapper) -> Unit,
    onFilm: () -> Unit,
    onSelectFilm: (String) -> Unit,
    onLutsTabShown: () -> Unit,
    onChooseLutFolder: () -> Unit,
    lens: LensInfo,
    skin: SkinState,
    blemish: BlemishState,
    modifier: Modifier = Modifier,
    /** White balance picker armed: the next tap on the photo sets temperature and tint. */
    pickingWhite: Boolean = false,
    onPickWhite: () -> Unit = {},
) {
    var chosenTab by rememberSaveable { mutableIntStateOf(0) }
    // Film replaces the tone mapper and the user LUT (which is kept, but not rendered), so the LUTs tab
    // hides while Film is on. Tabs keep their index (TAB_NAMES) whether or not LUTs is shown.
    val filmOn = params.film != null
    val tab = if (filmOn && chosenTab == TAB_LUTS) 0 else chosenTab
    val shownTabs = TAB_NAMES.indices.filter { !(filmOn && it == TAB_LUTS) }
    // One scroll position per tab (Light, Color, Detail, LUTs, Lens), kept across rotation.
    val scrollStates = List(TAB_NAMES.size) { rememberScrollState() }
    LaunchedEffect(tab) { if (tab == TAB_LUTS) onLutsTabShown() } // rescan the user's folder
    Column(modifier) {
        PrimaryTabRow(selectedTabIndex = shownTabs.indexOf(tab)) {
            for (i in shownTabs) {
                SmallTab(TAB_NAMES[i], tab == i) { chosenTab = i }
            }
        }
        Column(
            Modifier
                .verticalScroll(scrollStates[tab])
                .padding(horizontal = 16.dp, vertical = 8.dp),
        ) {
            if (tab == 0) {
                Row(
                    Modifier.horizontalScroll(rememberScrollState()),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text("Tone mapper", style = MaterialTheme.typography.bodyMedium)
                    for (t in ToneMapper.entries) {
                        FilterChip(
                            selected = params.film == null && params.toneMapper == t,
                            onClick = { onToneMapper(t) },
                            label = { Text(t.label) },
                        )
                    }
                    // Film: negative + print on a stock, in place of the tone mapper (also what Auto's Film mode sets).
                    FilterChip(selected = params.film != null, onClick = onFilm, label = { Text("Film") })
                }
                params.film?.let { film ->
                    LookDropdown(
                        label = "Stock",
                        looks = FILM_STOCKS,
                        selected = FILM_STOCKS.firstOrNull { it.film == film },
                        onSelect = { look -> look.film?.let(onSelectFilm) },
                        loading = filmLoading,
                        labelWidth = 72.dp,
                        placeholder = film,
                    )
                    if (params.lut != null) {
                        Text(
                            "Your LUT is off while Film is on; it returns with another tone mapper.",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                    ParamSlider("Film strength", params.filmAmount, 0f..100f, 100f, ::formatPlain) {
                        onChange(params.copy(filmAmount = it))
                    }
                    ParamSlider("Film grain", params.filmGrain, 0f..200f, 100f, ::formatPlain) {
                        onChange(params.copy(filmGrain = it))
                    }
                    ParamSlider("Halation", params.halation, 0f..200f, 100f, ::formatPlain) {
                        onChange(params.copy(halation = it))
                    }
                }
                ParamSlider("Exposure", params.exposure, -5f..5f, defaults.exposure, ::formatEv) {
                    onChange(params.copy(exposure = it))
                }
                ParamSlider("Contrast", params.contrast, -100f..100f, defaults.contrast) {
                    onChange(params.copy(contrast = it))
                }
                ParamSlider("Highlights", params.highlights, -100f..100f, defaults.highlights) {
                    onChange(params.copy(highlights = it))
                }
                ParamSlider("Shadows", params.shadows, -100f..100f, defaults.shadows) {
                    onChange(params.copy(shadows = it))
                }
                ParamSlider("Whites", params.whites, -100f..100f, defaults.whites) {
                    onChange(params.copy(whites = it))
                }
                ParamSlider("Blacks", params.blacks, -100f..100f, defaults.blacks) {
                    onChange(params.copy(blacks = it))
                }
                SectionLabel("Curves")
                CurvesPanel(params.curves) { onChange(params.copy(curves = it)) }
            } else if (tab == 1) {
                FilterChip(
                    selected = pickingWhite,
                    onClick = onPickWhite,
                    label = { Text(if (pickingWhite) "Tap something neutral grey" else "Pick white balance") },
                )
                TemperatureSlider(params.temperature, defaults.temperature) {
                    onChange(params.copy(temperature = it))
                }
                ParamSlider("Tint", params.tint, -WhiteBalance.MAX_TINT.toFloat()..WhiteBalance.MAX_TINT.toFloat(), defaults.tint) {
                    onChange(params.copy(tint = it))
                }
                ParamSlider("Saturation", params.saturation, -100f..100f, defaults.saturation) {
                    onChange(params.copy(saturation = it))
                }

                SectionLabel("RGB primaries")
                val degrees = { v: Float -> String.format(Locale.ROOT, "%+.1f°", v) }
                PrimariesParamSlider("Red hue", params, PrimariesSlider.RED_HUE, params.redHue, -30f..30f, degrees) { onChange(params.copy(redHue = it)) }
                PrimariesParamSlider("Red purity", params, PrimariesSlider.RED_PURITY, params.redPurity, -100f..100f) { onChange(params.copy(redPurity = it)) }
                PrimariesParamSlider("Green hue", params, PrimariesSlider.GREEN_HUE, params.greenHue, -30f..30f, degrees) { onChange(params.copy(greenHue = it)) }
                PrimariesParamSlider("Green purity", params, PrimariesSlider.GREEN_PURITY, params.greenPurity, -100f..100f) { onChange(params.copy(greenPurity = it)) }
                PrimariesParamSlider("Blue hue", params, PrimariesSlider.BLUE_HUE, params.blueHue, -30f..30f, degrees) { onChange(params.copy(blueHue = it)) }
                PrimariesParamSlider("Blue purity", params, PrimariesSlider.BLUE_PURITY, params.bluePurity, -100f..100f) { onChange(params.copy(bluePurity = it)) }
                PrimariesParamSlider("Tint hue", params, PrimariesSlider.TINT_HUE, params.tintHue, -180f..180f, degrees) { onChange(params.copy(tintHue = it)) }
                PrimariesParamSlider("Tint purity", params, PrimariesSlider.TINT_PURITY, params.tintPurity, 0f..100f, ::formatPlain) { onChange(params.copy(tintPurity = it)) }
                Text(
                    "Hue: red → yellow, green → cyan, blue → magenta for positive values.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            } else if (tab == 2) {
                // Colour denoise follows luminance until set (edits and presets from before the split); moving
                // luminance pins it, so the two sliders stay independent from then on.
                ParamSlider("Luma denoise", params.denoise, 0f..100f, defaults.denoise, ::formatPlain) {
                    onChange(params.copy(denoise = it, colorDenoise = params.effectiveColorDenoise))
                }
                ParamSlider("Color denoise", params.effectiveColorDenoise, 0f..100f, defaults.effectiveColorDenoise, ::formatPlain) {
                    onChange(params.copy(colorDenoise = it))
                }
                ParamSlider("Sharpening", params.sharpening, 0f..100f, defaults.sharpening, ::formatPlain) {
                    onChange(params.copy(sharpening = it))
                }
                ParamSlider("Local contrast", params.localContrast, -100f..100f, defaults.localContrast) {
                    onChange(params.copy(localContrast = it))
                }
                ParamSlider("High-pass contrast", params.highpassContrast, -100f..100f, defaults.highpassContrast) {
                    onChange(params.copy(highpassContrast = it))
                }
                ParamSlider("Skin retouch", params.skinRetouch, 0f..100f, defaults.skinRetouch, ::formatPlain) {
                    onChange(params.copy(skinRetouch = it))
                }
                val skinNote = when {
                    params.skinRetouch <= 0f -> null
                    skin is SkinState.Computing -> "Finding skin…"
                    skin is SkinState.Failed -> "Skin detection failed"
                    skin is SkinState.Ready && !skin.mask.hasSkin -> "No skin found in this photo"
                    else -> null
                }
                if (skinNote != null) {
                    Text(skinNote, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                ParamSlider("Blemish removal", params.blemishRemoval, 0f..100f, defaults.blemishRemoval, ::formatPlain) {
                    onChange(params.copy(blemishRemoval = it))
                }
                val blemishNote = when {
                    params.blemishRemoval <= 0f -> null
                    skin is SkinState.Computing -> "Finding skin…"
                    skin is SkinState.Failed -> "Skin detection failed"
                    skin is SkinState.Ready && !skin.mask.hasSkin -> "No skin found in this photo"
                    blemish.working -> "Removing blemishes…"
                    blemish.healed == 1 -> "1 spot removed"
                    else -> "${blemish.healed} spots removed"
                }
                if (blemishNote != null) {
                    Text(blemishNote, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                ParamSlider("Bloom", params.bloom, 0f..100f, defaults.bloom, ::formatPlain) {
                    onChange(params.copy(bloom = it))
                }
                ParamSlider("Grain", params.grain, 0f..100f, defaults.grain, ::formatPlain) {
                    onChange(params.copy(grain = it))
                }
            } else if (tab == 4) {
                LensPanel(params, defaults, lens, onChange)
            } else {
                LutPanel(params, luts, lutLoading, onChange, onSelectLut, onChooseLutFolder)
            }
        }
    }
}

@Composable
private fun LensPanel(params: DevelopParams, defaults: DevelopParams, lens: LensInfo, onChange: (DevelopParams) -> Unit) {
    SectionLabel("Lens profile")
    Text(lens.lensName.ifBlank { "Unknown lens" }, style = MaterialTheme.typography.bodyMedium)
    val summary = lens.profileSummary
    Text(
        if (summary != null) "Embedded in file: $summary" else "No lens correction data in this file",
        style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 4.dp),
    ) {
        Text("Use embedded profile", style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f))
        Switch(
            checked = params.lensProfile && lens.hasProfile,
            onCheckedChange = { onChange(params.copy(lensProfile = it)) },
            enabled = lens.hasProfile,
        )
    }

    SectionLabel("Manual")
    ParamSlider("Distortion", params.lensDistortion, -100f..100f, defaults.lensDistortion) {
        onChange(params.copy(lensDistortion = it))
    }
    ParamSlider("Vignetting", params.vignetteAmount, -100f..100f, defaults.vignetteAmount) {
        onChange(params.copy(vignetteAmount = it))
    }
    ParamSlider("Vignette radius", params.vignetteMidpoint, 0f..100f, defaults.vignetteMidpoint, ::formatPlain) {
        onChange(params.copy(vignetteMidpoint = it))
    }
    Text(
        "Distortion crops automatically so no empty edges show.",
        style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
}

@Composable
private fun LutPanel(
    params: DevelopParams,
    luts: LutLibrary,
    loading: Boolean,
    onChange: (DevelopParams) -> Unit,
    onSelect: (String?) -> Unit,
    onChooseFolder: () -> Unit,
) {
    if (params.lut != null) {
        ParamSlider("Strength", params.lutAmount, 0f..100f, 100f, ::formatPlain) {
            onChange(params.copy(lutAmount = it))
        }
    }
    LutRow("No LUT", selected = params.lut == null, loading = false) { onSelect(null) }

    SectionLabel("Included")
    luts.bundled.forEach { LutItem(it, params, loading, onSelect) }

    SectionLabel("Your LUTs · Documents/luts")
    if (!luts.userFolderGranted) {
        Text(
            "Allow access to Documents/luts to use your own .cube and HaldCLUT .png files.",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        OutlinedButton(onClick = onChooseFolder, modifier = Modifier.padding(vertical = 8.dp)) {
            Text("Choose folder")
        }
    } else {
        if (luts.user.isEmpty()) {
            Text(
                "No .cube or .png LUTs found.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        luts.user.forEach { LutItem(it, params, loading, onSelect) }
        OutlinedButton(onClick = onChooseFolder, modifier = Modifier.padding(vertical = 8.dp)) {
            Text("Change folder")
        }
    }
}

@Composable
private fun LutItem(entry: LutEntry, params: DevelopParams, loading: Boolean, onSelect: (String?) -> Unit) {
    val selected = params.lut == entry.id
    LutRow(entry.name, selected, loading && selected) { onSelect(entry.id) }
}

@Composable
private fun LutRow(name: String, selected: Boolean, loading: Boolean, onClick: () -> Unit) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier
            .fillMaxWidth()
            .selectable(selected = selected, onClick = onClick, role = Role.RadioButton)
            .padding(vertical = 2.dp),
    ) {
        RadioButton(selected = selected, onClick = null)
        Text(name, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f).padding(start = 8.dp))
        if (loading) CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp)
    }
}

/** A 36dp tab (Material's are 48dp): the slider panel is short on a phone. */
@Composable
internal fun SmallTab(text: String, selected: Boolean, onClick: () -> Unit) {
    Tab(
        selected = selected,
        onClick = onClick,
        modifier = Modifier.height(36.dp),
        text = { Text(text, style = MaterialTheme.typography.labelLarge) },
    )
}

@Composable
internal fun SectionLabel(text: String) {
    Spacer(Modifier.height(12.dp))
    Text(text, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.primary)
}

/**
 * Rotate in 90 degree steps, flip, straighten the horizon (auto-cropped) and crop, optionally to a fixed aspect ratio.
 */
@Composable
fun GeometryPanel(
    params: DevelopParams,
    onChange: (DevelopParams) -> Unit,
    onRotate: (Int) -> Unit,
    onFlip: (vertical: Boolean) -> Unit,
    aspect: CropAspect,
    portrait: Boolean,
    onAspect: (CropAspect, Boolean) -> Unit,
    onResetCrop: () -> Unit,
    onDone: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(modifier.padding(horizontal = 16.dp, vertical = 8.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("Crop & rotate", style = MaterialTheme.typography.titleSmall, modifier = Modifier.weight(1f))
            TextButton(onClick = onResetCrop, enabled = !params.crop.isFull || aspect != CropAspect.FREE) { Text("Reset crop") }
            TextButton(onClick = onDone) { Text("Done") }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp), modifier = Modifier.padding(vertical = 4.dp)) {
            OutlinedButton(onClick = { onRotate(-1) }) { Text("↺  Left") }
            OutlinedButton(onClick = { onRotate(1) }) { Text("Right  ↻") }
            OutlinedButton(
                onClick = { onAspect(aspect, !portrait) },
                enabled = aspect != CropAspect.FREE && aspect != CropAspect.SQUARE,
            ) { Text(if (portrait) "Portrait" else "Landscape") }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp), modifier = Modifier.padding(vertical = 4.dp)) {
            OutlinedButton(onClick = { onFlip(false) }) { Text("⇆  Flip") }
            OutlinedButton(onClick = { onFlip(true) }) { Text("⇅  Flip") }
        }
        Row(
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            modifier = Modifier.horizontalScroll(rememberScrollState()),
        ) {
            for (a in CropAspect.entries) {
                FilterChip(
                    selected = a == aspect,
                    onClick = { onAspect(a, portrait) },
                    label = { Text(a.label(portrait)) },
                )
            }
        }
        ParamSlider(
            "Straighten", params.straighten, -45f..45f, 0f,
            format = { String.format(Locale.ROOT, "%+.1f°", it) },
        ) { onChange(params.copy(straighten = (it * 10).roundToInt() / 10f)) }
        Text(
            "Drag the corners, edges or inside of the frame to crop. Straightening crops automatically so no " +
                "empty corners show. Resets for each new photo.",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

/**
 * One compact row: label, slider, value (44dp instead of two lines). Tap the value or double-tap the slider to
 * reset it to its default.
 */
@Composable
internal fun ParamSlider(
    label: String,
    value: Float,
    range: ClosedFloatingPointRange<Float>,
    default: Float,
    format: (Float) -> String = ::formatSigned,
    trackBrush: Brush? = null,
    onChange: (Float) -> Unit,
) {
    CompactSlider(
        label = label,
        value = value,
        range = range,
        default = default,
        rowHeight = SLIDER_ROW,
        labelWidth = SLIDER_LABEL,
        valueWidth = SLIDER_VALUE,
        format = format,
        trackBrush = trackBrush,
        onChange = onChange,
    )
}

/** A primaries slider whose track shows the colour it gives at each position ([PrimariesTrack]). */
@Composable
private fun PrimariesParamSlider(
    label: String,
    params: DevelopParams,
    slider: PrimariesSlider,
    value: Float,
    range: ClosedFloatingPointRange<Float>,
    format: (Float) -> String = ::formatSigned,
    onChange: (Float) -> Unit,
) {
    val brush = remember(slider, params.redHue, params.redPurity, params.greenHue, params.greenPurity, params.blueHue,
        params.bluePurity, params.tintHue, params.tintPurity) {
        Brush.horizontalGradient(PrimariesTrack.colors(params, slider, range).map { Color(it[0], it[1], it[2]) })
    }
    ParamSlider(label, value, range, 0f, format, brush, onChange)
}

private val SLIDER_ROW = 44.dp
private val SLIDER_LABEL = 96.dp
private val SLIDER_VALUE = 72.dp

/** Log-scaled Kelvin slider: equal travel per ratio of temperature. */
@Composable
private fun TemperatureSlider(kelvin: Float, default: Float, onChange: (Float) -> Unit) {
    val min = WhiteBalance.MIN_KELVIN
    val max = WhiteBalance.MAX_KELVIN
    val ratio = ln(max / min)
    fun toPosition(k: Float) = (ln(k.toDouble().coerceIn(min, max) / min) / ratio).toFloat()
    fun fromPosition(t: Float) = (min * (max / min).pow(t.toDouble())).toFloat()
    ParamSlider(
        label = "Temperature",
        value = toPosition(kelvin),
        range = 0f..1f,
        default = toPosition(default),
        format = { "${(fromPosition(it) / 10).roundToInt() * 10} K" },
    ) { t -> onChange(if (t == toPosition(default)) default else fromPosition(t)) }
}

internal fun formatSigned(v: Float) = String.format(Locale.ROOT, "%+d", v.roundToInt())
internal fun formatPlain(v: Float) = v.roundToInt().toString()
internal fun formatEv(v: Float) = String.format(Locale.ROOT, "%+.2f EV", v)

private val TAB_NAMES = listOf("Light", "Color", "Detail", "LUTs", "Lens")
private const val TAB_LUTS = 3

/** The Film tone mapper's stocks (Auto's film looks without Natural). */
private val FILM_STOCKS = FilmLooks.ALL.filter { it.film != null }

