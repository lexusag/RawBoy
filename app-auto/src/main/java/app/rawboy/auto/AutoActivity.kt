package app.rawboy.auto

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.ui.graphics.Color
import androidx.core.content.IntentCompat
import app.rawboy.auto.ui.AutoApp
import app.rawboy.develop.Edits

class AutoActivity : ComponentActivity() {
    private val viewModel: AutoViewModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        if (savedInstanceState == null) handleIntent(intent)
        setContent {
            MaterialTheme(colorScheme = AutoColors) {
                AutoApp(viewModel)
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handleIntent(intent)
    }

    private fun handleIntent(intent: Intent?) {
        // RawBoy's "Send to Auto" for one photo: the photo with its edits, developed as RawBoy showed it.
        if (intent?.action == Edits.ACTION_SEND_TO_AUTO) {
            val photo = IntentCompat.getParcelableExtra(intent, Edits.EXTRA_PHOTO, Uri::class.java)
            val edits = IntentCompat.getParcelableExtra(intent, Edits.EXTRA_EDITS, Uri::class.java)
            if (photo != null && edits != null) viewModel.receiveEdits(photo, edits)
            return
        }
        val uris: List<Uri> = when (intent?.action) {
            Intent.ACTION_VIEW -> listOfNotNull(intent.data)
            Intent.ACTION_SEND -> listOfNotNull(IntentCompat.getParcelableExtra(intent, Intent.EXTRA_STREAM, Uri::class.java))
            Intent.ACTION_SEND_MULTIPLE ->
                IntentCompat.getParcelableArrayListExtra(intent, Intent.EXTRA_STREAM, Uri::class.java).orEmpty()
            else -> emptyList()
        }
        // A preset file (shared from RawBoy's "Send to Auto", or opened from a file manager) applies to the batch.
        val (presets, photos) = uris.partition { isPresetFile(it, intent?.type) }
        presets.firstOrNull()?.let(viewModel::openPresetFile)
        if (photos.isNotEmpty()) viewModel.add(photos)
    }

    private fun isPresetFile(uri: Uri, intentType: String?): Boolean {
        val type = contentResolver.getType(uri) ?: intentType
        return type == "application/json" || uri.lastPathSegment?.endsWith(".json", ignoreCase = true) == true
    }
}

private val AutoColors = darkColorScheme(
    primary = Color(0xFF80CBC4),
    onPrimary = Color(0xFF00201D),
    secondary = Color(0xFFFFB74D),
    surface = Color(0xFF1B1B1B),
    background = Color(0xFF121212),
)
