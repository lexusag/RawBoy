package app.rawboy.view

import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.WindowInsetsSides
import androidx.compose.foundation.layout.displayCutout
import androidx.compose.foundation.layout.exclude
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.layout.systemBars
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.width
import androidx.compose.material3.VerticalDivider
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.min

/** Width of the controls panel beside the photo in landscape (the web's sidebar is 340 px). */
val SIDE_PANEL_WIDTH = 360.dp

/**
 * The photo and its controls, laid out by the window's shape: taller than wide (portrait) puts the controls under
 * the photo, capped at [maxPanelHeight] so the photo keeps the rest; wider than tall (landscape: a phone turned
 * sideways, a tablet, a desktop window) puts them in a panel on the right, at most [sidePanelWidth] and never more
 * than 45% of the width, and the photo takes the rest. Pro and Auto use it (iOS: `PhotoWithControls.swift`; web:
 * `@media (orientation: portrait)` in styles.css).
 *
 * [photo] gets the modifier sizing its area; [controls] runs in a column and gets the modifier its main panel should
 * use (height cap under the photo, or exactly [maxPanelHeight] with [fixedPanelHeight], so the photo doesn't jump
 * between tabs; the side panel's remaining height beside it). Whatever else [controls] puts in the column (a
 * histogram, a strip of looks) keeps its own height in both layouts.
 *
 * Turned sideways, a punch-hole camera can sit on either side; the Scaffold's insets cover the system bars only, so
 * the landscape row keeps clear of the cutout itself.
 */
@Composable
fun PhotoWithControls(
    maxPanelHeight: Dp,
    modifier: Modifier = Modifier,
    sidePanelWidth: Dp = SIDE_PANEL_WIDTH,
    fixedPanelHeight: Boolean = false,
    photo: @Composable (Modifier) -> Unit,
    controls: @Composable ColumnScope.(panel: Modifier) -> Unit,
) {
    BoxWithConstraints(modifier) {
        if (maxWidth > maxHeight) {
            val panelWidth = min(sidePanelWidth, maxWidth * 0.45f)
            val cutout = WindowInsets.displayCutout.exclude(WindowInsets.systemBars).only(WindowInsetsSides.Horizontal)
            Row(Modifier.fillMaxSize().windowInsetsPadding(cutout)) {
                photo(Modifier.weight(1f).fillMaxHeight())
                VerticalDivider()
                Column(Modifier.width(panelWidth).fillMaxHeight()) {
                    controls(Modifier.weight(1f, fill = false))
                }
            }
        } else {
            Column(Modifier.fillMaxSize()) {
                photo(Modifier.weight(1f).fillMaxWidth())
                controls(if (fixedPanelHeight) Modifier.height(maxPanelHeight) else Modifier.heightIn(max = maxPanelHeight))
            }
        }
    }
}
