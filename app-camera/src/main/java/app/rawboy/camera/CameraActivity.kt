package app.rawboy.camera

import android.Manifest
import android.app.KeyguardManager
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Bundle
import android.provider.MediaStore
import android.view.KeyEvent
import android.view.OrientationEventListener
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.viewModels
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.ui.graphics.Color
import androidx.core.content.ContextCompat
import app.rawboy.camera.ui.CameraScreen

class CameraActivity : ComponentActivity() {
    private val viewModel: CameraViewModel by viewModels()

    private val permission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        viewModel.onPermission(granted)
    }

    /** Asked only when geotagging is turned on. Approximate location (coarse only) is enough too. */
    private val locationPermission = registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { granted ->
        viewModel.onLocationPermission(granted.values.any { it })
    }

    /** The UI stays portrait; the device's rotation only sets each photo's orientation. */
    private val orientation by lazy {
        object : OrientationEventListener(this) {
            override fun onOrientationChanged(degrees: Int) {
                if (degrees == ORIENTATION_UNKNOWN) return
                viewModel.deviceDegrees = ((degrees + 45) / 90 * 90) % 360
            }
        }
    }

    /**
     * Opened from the lock screen (the power button's double press on a locked phone, with RawBoy Camera as the
     * default camera): shown over the lock screen, and closed when it goes to the background, so locking the phone
     * again doesn't leave it there. Viewing photos asks to unlock first.
     */
    private var overLockScreen = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        onLaunch(intent, fresh = savedInstanceState == null)
        enableEdgeToEdge()
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        setContent {
            MaterialTheme(colorScheme = CameraColors) {
                CameraScreen(
                    viewModel,
                    requestPermission = { permission.launch(Manifest.permission.CAMERA) },
                    requestLocation = {
                        locationPermission.launch(arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION))
                    },
                    openPhoto = ::openPhoto,
                )
            }
        }
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
            viewModel.onPermission(true)
        } else {
            permission.launch(Manifest.permission.CAMERA)
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        onLaunch(intent, fresh = true)
    }

    private fun onLaunch(intent: Intent?, fresh: Boolean) {
        overLockScreen = intent?.action == MediaStore.INTENT_ACTION_STILL_IMAGE_CAMERA_SECURE
        setShowWhenLocked(overLockScreen)
        setTurnScreenOn(overLockScreen)
        if (overLockScreen && fresh) viewModel.forgetLastShot()
    }

    /** The thumbnail: opens the photo in the phone's viewer, after unlocking when the phone is locked. */
    private fun openPhoto(uri: Uri) {
        val view = {
            val intent = Intent(Intent.ACTION_VIEW)
                .setDataAndType(uri, "image/jpeg")
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            runCatching { startActivity(intent) }
        }
        val keyguard = getSystemService(KeyguardManager::class.java)
        if (!keyguard.isKeyguardLocked) {
            leaveLockScreen()
            view()
            return
        }
        keyguard.requestDismissKeyguard(this, object : KeyguardManager.KeyguardDismissCallback() {
            override fun onDismissSucceeded() {
                leaveLockScreen()
                view()
            }
        })
    }

    /** Unlocked: from now on an ordinary camera, which stays open in the background. */
    private fun leaveLockScreen() {
        if (!overLockScreen) return
        overLockScreen = false
        setShowWhenLocked(false)
        setTurnScreenOn(false)
    }

    /** Volume up / down take a photo (one per press; holding doesn't repeat), as in Google Camera. */
    override fun onKeyDown(keyCode: Int, event: KeyEvent): Boolean {
        if (isVolumeKey(keyCode) && !viewModel.settingsOpen) {
            if (event.repeatCount == 0) viewModel.shutter()
            return true // consumed: no volume panel
        }
        return super.onKeyDown(keyCode, event)
    }

    override fun onKeyUp(keyCode: Int, event: KeyEvent): Boolean =
        if (isVolumeKey(keyCode) && !viewModel.settingsOpen) true else super.onKeyUp(keyCode, event)

    private fun isVolumeKey(keyCode: Int) = keyCode == KeyEvent.KEYCODE_VOLUME_UP || keyCode == KeyEvent.KEYCODE_VOLUME_DOWN

    override fun onResume() {
        super.onResume()
        orientation.enable()
        viewModel.onResume()
    }

    override fun onPause() {
        orientation.disable()
        viewModel.onPause()
        super.onPause()
    }

    override fun onStop() {
        super.onStop()
        if (overLockScreen && !isChangingConfigurations) finish()
    }
}

private val CameraColors = darkColorScheme(
    primary = Color(0xFFFFB74D),
    onPrimary = Color(0xFF2B1700),
    secondary = Color(0xFF80CBC4),
    surface = Color(0xFF1B1B1B),
    background = Color(0xFF000000),
)
