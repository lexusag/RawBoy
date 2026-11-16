package app.rawboy.camera.platform

import app.rawboy.camera.platform.generic.neutralPlatform
import app.rawboy.camera.platform.oem.samsung.samsungLayer
import app.rawboy.camera.platform.tensor.tensorLayer

/** Builds a phone's profile from the neutral one and the layers that match it. Reads no `Build` fields itself. */
object PlatformRegistry {
    /** Every layer there is. Adding a chip or a phone = its file plus a line here (and its pinning test). */
    val layers: List<PlatformLayer> = listOf(
        tensorLayer,
        samsungLayer,
    )

    /** The profile for [phone]: the neutral one, then each matching layer by [LayerLevel] (list order within one). */
    fun resolve(phone: PhoneDescription, from: List<PlatformLayer> = layers): CameraPlatform =
        stack(from.filter { it.matches(phone) })

    /** The [PlatformLayer.title] of the layer called [name] (the name itself if there is none). */
    fun title(name: String): String = layers.firstOrNull { it.name == name }?.title ?: name

    /** The neutral profile with [chosen] applied by [LayerLevel] (list order within one level), names recorded. */
    fun stack(chosen: List<PlatformLayer>): CameraPlatform =
        chosen.sortedBy { it.level }.fold(neutralPlatform) { p, layer ->
            layer.patch.applyTo(p).copy(layers = p.layers + layer.name)
        }
}
