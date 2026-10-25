package app.rawboy.ui

import app.rawboy.view.HelpItem
import app.rawboy.view.HelpSection

/** RawBoy's "?" sheet. Keep it in step with the controls (Readme's Controls table) and RawBoy Web's `ui/pro/help.ts`. */
internal val PRO_HELP = listOf(
    HelpSection(
        "Basics",
        listOf(
            HelpItem("Open", "Opens a RAW file (or open one with RawBoy from another app)."),
            HelpItem("Tabs", "Light, Color, Detail, LUTs and Lens hold the sliders. Edits carry over to the next photo; crop, rotation and flips don't."),
            HelpItem("Lens preset", "Lens tab: name it (the lens by default) and Save lens preset keeps its settings for this photo's lens; Send to Auto also hands it to RawBoy Auto, which corrects every photo taken with that lens on top of its look. Manual lenses record no lens: Auto lets you pick their presets by name."),
            HelpItem("Top bar", "Crop & rotate (turn, flip, straighten, crop), Masks, Light leaks, Presets, Auto (automatic light and colour, keeps the LUT) and Export; Undo, Redo and Reset all under them. Long-press a tool for its full name."),
        ),
    ),
    HelpSection(
        "Photo",
        listOf(
            HelpItem("Double-tap", "100% view at that point; drag to pan, double-tap again to go back."),
            HelpItem(
                "Pinch",
                "Two fingers zoom around their middle, up to 400% (stops once at 100%), and pan with it; the finger left keeps panning. Out past the whole photo goes back to it.",
            ),
            HelpItem("Press and hold", "Compare with the as-shot render."),
            HelpItem("Tap outside the photo", "Change the frame around it: grey, white or black."),
            HelpItem("Histogram", "Above the tabs: red, green and blue levels of the developed photo, with the share of crushed shadows (left) and clipped highlights (right). Tap it to mark clipped highlights red and crushed shadows blue on the photo."),
        ),
    ),
    HelpSection(
        "Sliders and tools",
        listOf(
            HelpItem("Double-tap a slider", "Reset it (tapping its value does too)."),
            HelpItem("Pick white balance", "Color tab: tap something neutral grey and Temperature and Tint make it grey."),
            HelpItem("Curves", "Light tab: touch the curve to add a point, drag it, double-tap it to remove; elsewhere the box scrolls. RGB, then Red, Green and Blue."),
            HelpItem("Detail", "Luma and Color denoise work separately. Local contrast brings out texture; High-pass contrast is wider clarity. Tap Grain's name for its size, roughness and color."),
            HelpItem("Masks", "Brush, linear and radial layers with their own light and colour. Brush or Erase paints on any layer."),
            HelpItem("Light leaks", "Film-style light (up to 4): streaks (beams across the photo, white-hot in the middle with coloured edges) or glows. Drag one anywhere inside to move it, the dots to resize (a streak: side dots width, end dots length), the knob to rotate. At 100% intensity its middle (inside the dashed lines) hides what is under it, a tasteful way to cover part of a nude; lower, it is a glow. Leaks belong to the photo: presets don't keep them."),
            HelpItem("Presets", "Save the edits by group, apply, import and export .rawboy.json files, or Send to Auto for a whole batch."),
            HelpItem("Send to Auto (this photo)", "Export › Send to Auto adds this photo to RawBoy Auto's batch with every edit, crop, masks, lens blur and light leaks included, so Auto's Export all renders it as here. For the same look on a whole batch, use a preset instead: the photo's own crop, brush strokes and leaks don't fit other photos."),
        ),
    ),
)
