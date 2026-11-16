package app.rawboy.camera.platform

import android.content.Context
import android.content.pm.ApplicationInfo
import android.util.Log

/** The phone as detected, what a debug build was told to take it for, and the profile that gives. */
data class ResolvedPlatform(
    val phone: PhoneDescription,
    /** The chip picked by hand in a debug build ([ActivePlatform.choose]); null = as detected. */
    val chosenChip: ChipVendor?,
    val profile: CameraPlatform,
)

/**
 * The profile of the phone the camera runs on, resolved once per process. `CameraViewModel` hands it to the
 * controller and to each `Shot`; nothing else reads it.
 *
 * A debug build can take the phone for another chip ([choose]; the phone's other fields stay its own, so
 * manufacturer layers still apply), from the next start of the app. A release build ignores that choice.
 */
object ActivePlatform {
    private const val TAG = "RawBoyPlatform"
    private const val PREFS = "platform"
    private const val CHOSEN_CHIP = "chosenChip"

    /**
     * What a debug build offers to take the phone for: as detected (null), the chips with a layer of their own or
     * about to get one, and none (the neutral profile, plus the phone maker's layer). Four, to fit one row.
     */
    val choices: List<ChipVendor?> = listOf(null, ChipVendor.TENSOR, ChipVendor.QUALCOMM, ChipVendor.UNKNOWN)

    @Volatile
    private var resolved: ResolvedPlatform? = null

    /** This process's platform, detected (and logged) on the first call. */
    fun get(context: Context): ResolvedPlatform = resolved ?: synchronized(this) {
        resolved ?: resolve(PlatformDetector.detect(), chosen(context)).also {
            resolved = it
            Log.i(TAG, describe(it))
        }
    }

    /** The chip a debug build was told to take the phone for, or null (always null in a release build). */
    fun chosen(context: Context): ChipVendor? {
        if (!debuggable(context)) return null
        val name = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(CHOSEN_CHIP, null) ?: return null
        return ChipVendor.entries.firstOrNull { it.name == name }
    }

    /** Debug builds: take the phone for [chip] (null = as detected) from the next start of the app. */
    fun choose(context: Context, chip: ChipVendor?) {
        if (!debuggable(context)) return
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .apply { if (chip == null) remove(CHOSEN_CHIP) else putString(CHOSEN_CHIP, chip.name) }
            .apply()
    }

    /**
     * The profile for [phone], taken for [chosenChip] if set. A chosen profile that differs from the automatic one
     * gets its own [CameraPlatform.calibrationSlot] (its layers' names), so calibration learned under it stays apart.
     */
    fun resolve(phone: PhoneDescription, chosenChip: ChipVendor?): ResolvedPlatform {
        val automatic = PlatformRegistry.resolve(phone)
        if (chosenChip == null) return ResolvedPlatform(phone, null, automatic)
        val chosen = PlatformRegistry.resolve(phone.copy(chip = chosenChip))
        val profile = if (chosen.layers == automatic.layers) chosen else chosen.copy(calibrationSlot = chosen.layers.joinToString("+"))
        return ResolvedPlatform(phone, chosenChip, profile)
    }

    /** The startup log line: the phone as read, the layers applied and every value of the profile. */
    fun describe(r: ResolvedPlatform): String {
        val p = r.profile
        val choice = r.chosenChip?.let { "taken for $it by hand" } ?: "automatic"
        val slot = p.calibrationSlot.ifEmpty { "own" }
        return "platform: ${PlatformDetector.describe(r.phone)}; $choice; layers ${p.layers.joinToString("+")}; " +
            "calibration $slot; ${p.lenses}; ${p.preview}; ${p.still}; ${p.noise}; ${p.flash}"
    }

    private fun debuggable(context: Context) = (context.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE) != 0
}
