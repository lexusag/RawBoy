package app.rawboy.view

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowDropDown
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.asPaddingValues
import androidx.compose.foundation.layout.displayCutout
import androidx.compose.foundation.layout.systemBars
import androidx.compose.foundation.layout.union
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import app.rawboy.auto.looks.Look

/**
 * A look or film stock picked from a menu: one row instead of a strip of chips. Colour and black and white looks get
 * their own headings when [looks] has both (they come colour first). [selected] null shows [placeholder].
 */
@Composable
fun LookDropdown(
    label: String,
    looks: List<Look>,
    selected: Look?,
    onSelect: (Look) -> Unit,
    modifier: Modifier = Modifier,
    loading: Boolean = false,
    labelWidth: Dp = 96.dp,
    placeholder: String = "",
    alignEnd: Boolean = false,
) {
    var open by remember { mutableStateOf(false) }
    // The menu scrolls, but Material sizes it to the whole window: turned sideways, edge to edge, its last items sat
    // under the navigation bar. Keep it within the space between the system bars.
    val bars = WindowInsets.systemBars.union(WindowInsets.displayCutout).asPaddingValues()
    val windowHeight = LocalConfiguration.current.screenHeightDp.dp
    val menuMax = (windowHeight - bars.calculateTopPadding() - bars.calculateBottomPadding() - 32.dp).coerceAtLeast(160.dp)
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = if (alignEnd) Arrangement.End else Arrangement.Start,
        modifier = modifier.fillMaxWidth(),
    ) {
        if (labelWidth > 0.dp) Text(label, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.width(labelWidth))
        Box {
            OutlinedButton(
                onClick = { open = true },
                contentPadding = androidx.compose.foundation.layout.PaddingValues(start = 16.dp, end = 8.dp),
                modifier = Modifier.heightIn(min = 36.dp),
            ) {
                Text(selected?.name ?: placeholder)
                Icon(Icons.Filled.ArrowDropDown, contentDescription = null)
            }
            DropdownMenu(expanded = open, onDismissRequest = { open = false }, modifier = Modifier.heightIn(max = menuMax)) {
                // Colour and black and white looks under their own headings, when the list has both.
                val sectioned = looks.any { it.monochrome } && looks.any { !it.monochrome }
                for ((i, look) in looks.withIndex()) {
                    if (sectioned && (i == 0 || look.monochrome != looks[i - 1].monochrome)) {
                        if (i > 0) HorizontalDivider(Modifier.padding(vertical = 4.dp))
                        MenuSectionLabel(if (look.monochrome) "Black & white" else "Color")
                    }
                    val isSelected = look.id == selected?.id
                    DropdownMenuItem(
                        text = {
                            Text(
                                look.name,
                                fontWeight = if (isSelected) FontWeight.Bold else null,
                                color = if (isSelected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurface,
                            )
                        },
                        onClick = {
                            open = false
                            onSelect(look)
                        },
                    )
                }
            }
        }
        if (loading) CircularProgressIndicator(Modifier.padding(start = 12.dp).size(18.dp), strokeWidth = 2.dp)
    }
}

/** A heading inside a dropdown menu, as Pro's section labels. */
@Composable
private fun MenuSectionLabel(text: String) {
    Text(
        text,
        style = MaterialTheme.typography.labelMedium,
        color = MaterialTheme.colorScheme.primary,
        modifier = Modifier.padding(horizontal = 12.dp, vertical = 6.dp),
    )
}
