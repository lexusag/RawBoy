package app.rawboy.camera

import android.Manifest
import android.app.KeyguardManager
import android.content.BroadcastReceiver
import android.content.ClipData
import android.content.ClipDescription
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.net.Uri
import android.net.wifi.WifiNetworkSuggestion
import android.os.Build
import android.os.Bundle
import android.os.PersistableBundle
import android.os.PowerManager
import android.provider.MediaStore
import android.provider.Settings
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
import app.rawboy.camera.qr.QrPayload
import app.rawboy.camera.ui.CameraScreen

/** The lock screen camera: [CameraActivity] in its own task (see the manifest). */
class LockScreenCameraActivity : CameraActivity()

open class CameraActivity : ComponentActivity() {
    private val viewModel: CameraViewModel by viewModels()

    private val permission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        viewModel.onPermission(granted)
    }

    /** Asked only when geotagging is turned on. Approximate location (coarse only) is enough too. */
    private val locationPermission = registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { granted ->
        viewModel.onLocationPermission(granted.values.any { it })
    }

    /** Android's "add this network?" sheet for a Wi-Fi QR code; it saves the network itself, nothing comes back to us. */
    private val addWifi = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) {}

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
     * default camera): shown over the lock screen, and closed when the screen turns off, so locking the phone
     * again doesn't leave it there. Viewing photos asks to unlock first.
     */
    private var overLockScreen = false

    /**
     * Launched by the lock screen action, even if unlocked since: closes with its task when the screen turns off, also
     * from the background (behind the photo viewer, say), so the next locked double press starts a fresh camera
     * instead of bringing back one that can't show over the lock screen.
     */
    private var closeOnScreenOff: BroadcastReceiver? = null

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
                    openQr = ::openQr,
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
        val secure = intent?.action == MediaStore.INTENT_ACTION_STILL_IMAGE_CAMERA_SECURE
        // The secure action on an unlocked phone (Settings' "Lock screen camera" choice) is an ordinary launch.
        overLockScreen = secure && getSystemService(KeyguardManager::class.java).isKeyguardLocked
        setShowWhenLocked(overLockScreen)
        setTurnScreenOn(overLockScreen)
        if (overLockScreen && fresh) viewModel.forgetLastShot()
        if (secure && closeOnScreenOff == null) {
            val receiver = object : BroadcastReceiver() {
                override fun onReceive(context: Context, intent: Intent) = finishAndRemoveTask()
            }
            ContextCompat.registerReceiver(this, receiver, IntentFilter(Intent.ACTION_SCREEN_OFF), ContextCompat.RECEIVER_NOT_EXPORTED)
            closeOnScreenOff = receiver
        }
    }

    override fun onDestroy() {
        closeOnScreenOff?.let { unregisterReceiver(it) }
        closeOnScreenOff = null
        super.onDestroy()
    }

    /**
     * Another app (photo viewer, browser, dialler, Wi-Fi settings) in its own task: in the camera's task it was what a
     * later lock screen launch brought back, and it can't show over the lock screen.
     */
    private fun startOutside(intent: Intent) = startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))

    /** The thumbnail: opens the photo in the phone's viewer, after unlocking when the phone is locked. */
    private fun openPhoto(uri: Uri) = whenUnlocked {
        val intent = Intent(Intent.ACTION_VIEW)
            .setDataAndType(uri, "image/jpeg")
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        runCatching { startOutside(intent) }
    }

    /**
     * The viewfinder's QR chip: opens the link (or mail, call, message, map), offers to join the Wi-Fi network, or
     * copies the text. Anything that leaves the camera asks to unlock first, so a locked phone can't be used to
     * open a link.
     */
    private fun openQr(code: QrPayload) {
        when (code) {
            is QrPayload.Text -> copy("QR code", code.text)
            is QrPayload.Link -> whenUnlocked {
                val intent = Intent(Intent.ACTION_VIEW, Uri.parse(code.url)).addCategory(Intent.CATEGORY_BROWSABLE)
                if (runCatching { startOutside(intent) }.isFailure) copy("Link", code.url)
            }
            is QrPayload.Action -> whenUnlocked {
                val uri = Uri.parse(code.uri)
                val intent = when (uri.scheme) {
                    "tel" -> Intent(Intent.ACTION_DIAL, uri) // the dialler with the number, never a call straight away
                    "smsto" -> Intent(Intent.ACTION_SENDTO, uri).apply { code.body?.let { putExtra("sms_body", it) } }
                    else -> Intent(Intent.ACTION_VIEW, uri)
                }
                if (runCatching { startOutside(intent) }.isFailure) copy("QR code", code.text)
            }
            is QrPayload.Wifi -> whenUnlocked { joinWifi(code) }
        }
    }

    /**
     * Android 11+: the system sheet that adds the network (apps can't join one themselves since Android 10). WEP,
     * which that sheet doesn't take, and older Android: the password is copied and Wi-Fi settings open.
     */
    private fun joinWifi(w: QrPayload.Wifi) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            val suggestion = runCatching {
                WifiNetworkSuggestion.Builder().setSsid(w.ssid).setIsHiddenSsid(w.hidden).apply {
                    when (w.security) {
                        "" -> Unit
                        "WPA" -> setWpa2Passphrase(requireNotNull(w.password))
                        "SAE" -> setWpa3Passphrase(requireNotNull(w.password))
                        else -> error("${w.security} networks can't be suggested")
                    }
                }.build() // also throws for a passphrase of the wrong length
            }.getOrNull()
            if (suggestion != null) {
                val intent = Intent(Settings.ACTION_WIFI_ADD_NETWORKS)
                    .putParcelableArrayListExtra(Settings.EXTRA_WIFI_NETWORK_LIST, arrayListOf(suggestion))
                if (runCatching { addWifi.launch(intent) }.isSuccess) return
            }
        }
        w.password?.let { copy("Wi-Fi password", it, sensitive = true) }
        viewModel.showMessage(if (w.password != null) "Password copied: choose ${w.ssid} in Wi-Fi settings" else "Choose ${w.ssid} in Wi-Fi settings")
        runCatching { startOutside(Intent(Settings.ACTION_WIFI_SETTINGS)) }
    }

    private fun copy(label: String, text: String, sensitive: Boolean = false) {
        val clip = ClipData.newPlainText(label, text)
        if (sensitive && Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            // Kept out of the clipboard preview Android shows.
            clip.description.extras = PersistableBundle().apply { putBoolean(ClipDescription.EXTRA_IS_SENSITIVE, true) }
        }
        getSystemService(ClipboardManager::class.java).setPrimaryClip(clip)
        // Android 13+ confirms copies itself.
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) viewModel.showMessage("Copied")
    }

    /** Runs [action] now, or after the user unlocks the phone when the camera is over the lock screen. */
    private fun whenUnlocked(action: () -> Unit) {
        val keyguard = getSystemService(KeyguardManager::class.java)
        if (!keyguard.isKeyguardLocked) {
            leaveLockScreen()
            action()
            return
        }
        keyguard.requestDismissKeyguard(this, object : KeyguardManager.KeyguardDismissCallback() {
            override fun onDismissSucceeded() {
                leaveLockScreen()
                action()
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

    /**
     * Over the lock screen, only the screen turning off closes the camera, so it can't be left there for the next
     * person. Finishing on any stop also closed it during the unlock and left a black screen after the passcode.
     */
    override fun onStop() {
        super.onStop()
        if (overLockScreen && !isChangingConfigurations && !getSystemService(PowerManager::class.java).isInteractive) finishAndRemoveTask()
    }

    /** Unlocked while it was open: from now on an ordinary camera. */
    override fun onStart() {
        super.onStart()
        if (overLockScreen && !getSystemService(KeyguardManager::class.java).isKeyguardLocked) leaveLockScreen()
    }
}

private val CameraColors = darkColorScheme(
    primary = Color(0xFFFFB74D),
    onPrimary = Color(0xFF2B1700),
    secondary = Color(0xFF80CBC4),
    surface = Color(0xFF1B1B1B),
    background = Color(0xFF000000),
)
