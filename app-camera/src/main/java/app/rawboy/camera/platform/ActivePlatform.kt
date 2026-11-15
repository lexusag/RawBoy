package app.rawboy.camera.platform

import android.os.Build

/**
 * The profile of the phone the camera runs on, resolved once per process. `CameraViewModel` hands it to the
 * controller and to each `Shot`; nothing else reads it.
 *
 * The chip isn't detected yet: every phone is taken to have a Tensor chip ([untilAutodetect]), so all phones keep
 * the behaviour the camera was tuned with, while manufacturer layers already apply by the phone's own fields.
 */
object ActivePlatform {
    val profile: CameraPlatform by lazy { PlatformRegistry.resolve(untilAutodetect(fromBuild())) }

    /** [phone] with its chip taken as Tensor; every other field stays the phone's own. */
    internal fun untilAutodetect(phone: PhoneDescription) = phone.copy(chip = ChipVendor.TENSOR)

    private fun fromBuild() = PhoneDescription(
        chip = ChipVendor.UNKNOWN,
        hardware = Build.HARDWARE.orEmpty(),
        board = Build.BOARD.orEmpty(),
        manufacturer = Build.MANUFACTURER.orEmpty(),
        brand = Build.BRAND.orEmpty(),
        model = Build.MODEL.orEmpty(),
        device = Build.DEVICE.orEmpty(),
        sdk = Build.VERSION.SDK_INT,
    )
}
