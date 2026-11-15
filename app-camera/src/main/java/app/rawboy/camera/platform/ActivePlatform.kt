package app.rawboy.camera.platform

import android.os.Build

/**
 * The profile of the phone the camera runs on, resolved once per process. `CameraViewModel` hands it to the
 * controller and to each `Shot`; nothing else reads it.
 *
 * Until autodetect (session 07) every phone is taken to have a Tensor chip, so all phones keep the behaviour the
 * camera was tuned with; the other fields are the phone's own, so manufacturer layers already apply.
 */
object ActivePlatform {
    val profile: CameraPlatform by lazy { PlatformRegistry.resolve(untilAutodetect()) }

    private fun untilAutodetect() = PhoneDescription(
        chip = ChipVendor.TENSOR,
        hardware = Build.HARDWARE.orEmpty(),
        board = Build.BOARD.orEmpty(),
        manufacturer = Build.MANUFACTURER.orEmpty(),
        brand = Build.BRAND.orEmpty(),
        model = Build.MODEL.orEmpty(),
        device = Build.DEVICE.orEmpty(),
        sdk = Build.VERSION.SDK_INT,
    )
}
