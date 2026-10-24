package app.rawboy.camera.capture

import android.hardware.Camera
import android.media.MediaActionSound
import android.os.Build

/**
 * The system's shutter click. Camera2 plays no sound of its own, so this is the only one; it is a setting (off by
 * default). Where the law requires the sound (Japan, Korea…), [required] is true and MediaActionSound plays it on the
 * enforced stream, audible even on silent.
 */
class ShutterSound {
    private val sound = MediaActionSound().apply { load(MediaActionSound.SHUTTER_CLICK) }

    fun play() = sound.play(MediaActionSound.SHUTTER_CLICK)

    fun release() = sound.release()

    companion object {
        /** The device or region forces the shutter sound: apps must play it on every shot. */
        @Suppress("DEPRECATION")
        fun required(): Boolean = runCatching {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                MediaActionSound.mustPlayShutterSound()
            } else {
                // Before Android 13 the only public signal: a camera that can't disable its shutter sound.
                val info = Camera.CameraInfo()
                (0 until Camera.getNumberOfCameras()).any { Camera.getCameraInfo(it, info); !info.canDisableShutterSound }
            }
        }.getOrDefault(false)
    }
}
