package app.rawboy.auto.ui

import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import app.rawboy.auto.LookMode

/** Looks (LUTs on the AgX develop) or Film (stocks rendered as negative + print). */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ModeSwitch(mode: LookMode, onChange: (LookMode) -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true) {
    SingleChoiceSegmentedButtonRow(modifier) {
        val modes = listOf(LookMode.LOOKS to "Looks", LookMode.FILM to "Film")
        modes.forEachIndexed { i, (m, label) ->
            SegmentedButton(
                selected = mode == m,
                onClick = { onChange(m) },
                shape = SegmentedButtonDefaults.itemShape(i, modes.size),
                enabled = enabled,
            ) { Text(label) }
        }
    }
}
