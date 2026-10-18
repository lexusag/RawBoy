package app.rawboy

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
import app.rawboy.ui.EditorScreen
import app.rawboy.ui.EditorViewModel

class MainActivity : ComponentActivity() {
    private val viewModel: EditorViewModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        if (savedInstanceState == null) handleIntent(intent)
        setContent {
            MaterialTheme(colorScheme = RawBoyColors) {
                EditorScreen(viewModel)
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handleIntent(intent)
    }

    private fun handleIntent(intent: Intent?) {
        val uri = when (intent?.action) {
            Intent.ACTION_VIEW -> intent.data
            Intent.ACTION_SEND -> IntentCompat.getParcelableExtra(intent, Intent.EXTRA_STREAM, Uri::class.java)
            else -> null
        } ?: return
        viewModel.open(uri)
    }
}

private val RawBoyColors = darkColorScheme(
    primary = Color(0xFFFFB74D),
    onPrimary = Color(0xFF2B1700),
    surface = Color(0xFF1B1B1B),
    background = Color(0xFF121212),
)
