package app.rawboy.camera.platform

/**
 * A change to a profile: replaces only the fields it knows better and keeps the rest (written with `copy`, so a field
 * added later passes through untouched). Shared pieces several layers use live in `platform/traits/`; patches chain
 * with [plus].
 */
fun interface PlatformPatch {
    fun applyTo(p: CameraPlatform): CameraPlatform

    /** This patch, then [next]. */
    operator fun plus(next: PlatformPatch): PlatformPatch = PlatformPatch { next.applyTo(applyTo(it)) }
}

/** Where a layer sits in the stack; layers apply in this order (neutral profile first, a phone model last). */
enum class LayerLevel {
    /** A chip maker's ISP and GPU (Tensor, Qualcomm): what most phones with that chip share. */
    CHIP_VENDOR,
    /** One SoC of that maker (e.g. SM8550). */
    SOC,
    /** A phone maker's camera tuning on top of the chip (Samsung, OnePlus). */
    MANUFACTURER,
    /** One phone model: its sensors' numbers. Lives next to its manufacturer (or chip) layer. */
    MODEL,
}

/**
 * One layer of the profile stack, one file each under `platform/<chip>/` or `platform/oem/<maker>/` (models next to
 * their maker), listed in [PlatformRegistry.layers]. The file says where its numbers come from: phone, date, how
 * they were measured.
 */
class PlatformLayer(
    /** Short name for logs and [CameraPlatform.layers], e.g. "tensor", "samsung". */
    val name: String,
    val level: LayerLevel,
    /** Whether this layer applies to [phone]; reads only the description, never `Build` itself. */
    val matches: (PhoneDescription) -> Boolean,
    val patch: PlatformPatch,
    /** What Settings shows, e.g. "Google Tensor". */
    val title: String = name,
) {
    override fun toString() = "$name ($level)"
}
