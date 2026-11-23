package app.rawboy.view

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import app.rawboy.develop.ExtendSides

/**
 * Crop & rotate's Extend canvas: the first chip turns every side on or off, the four after it (shown while Extend is
 * on) choose which edges the crop may reach past. A side that is off keeps the crop on the photo's edge.
 */
@Composable
fun ExtendChips(sides: ExtendSides, onSides: (ExtendSides) -> Unit, modifier: Modifier = Modifier) {
    Row(
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        modifier = modifier.padding(vertical = 2.dp).horizontalScroll(rememberScrollState()),
    ) {
        FilterChip(
            selected = sides.any,
            onClick = { onSides(if (sides.any) ExtendSides.NONE else ExtendSides.ALL) },
            label = { Text("Extend canvas") },
        )
        if (sides.any) {
            FilterChip(selected = sides.left, onClick = { onSides(sides.copy(left = !sides.left)) }, label = { Text("Left") })
            FilterChip(selected = sides.right, onClick = { onSides(sides.copy(right = !sides.right)) }, label = { Text("Right") })
            FilterChip(selected = sides.top, onClick = { onSides(sides.copy(top = !sides.top)) }, label = { Text("Top") })
            FilterChip(selected = sides.bottom, onClick = { onSides(sides.copy(bottom = !sides.bottom)) }, label = { Text("Bottom") })
        }
    }
}
