import RawBoyEngine

/** RawBoy's "?" sheet. Keep it in step with the controls (Readme's Controls table) and Android's ui/Help.kt. */
let proHelp = [
    HelpSection("Basics", [
        HelpItem("Open", "Opens a RAW file from Photos or Files, or a HEIC, JPEG, PNG or TIFF (lower quality than RAW)."),
        HelpItem("Tabs", "Light, Color, Detail, LUTs and Lens hold the sliders. Edits carry over to the next photo; crop, rotation and flips don't."),
        HelpItem("Lens preset", "Lens tab: name it (the lens by default) and Save lens preset keeps its settings for this photo's lens; Send to Auto also hands it to RawBoy Auto, which corrects every photo taken with that lens on top of its look. Manual lenses record no lens: Auto lets you pick their presets by name."),
        HelpItem("Top bar", "Crop & rotate (turn, flip, straighten, crop), Masks, Light leaks, Presets, Auto (automatic light and colour, keeps the LUT) and Export; Reset all, Undo and Redo under them. Long-press a tool for its full name."),
    ]),
    HelpSection("Photo", [
        HelpItem("Double-tap", "100% view at that point; drag to pan, double-tap again to go back."),
        HelpItem("Pinch", "Two fingers zoom around where they started, up to 400% (stops once at 100%); drag to pan. Out past the whole photo goes back to it."),
        HelpItem("Press and hold", "Compare with the as-shot render."),
        HelpItem("Tap outside the photo", "Change the frame around it: grey, white or black."),
        HelpItem("Histogram", "Above the tabs: red, green and blue levels of the developed photo, with the share of crushed shadows (left) and clipped highlights (right). Tap it to mark clipped highlights red and crushed shadows blue on the photo."),
    ]),
    HelpSection("Sliders and tools", [
        HelpItem("Double-tap a slider", "Reset it (tapping its value does too)."),
        HelpItem("Pick white balance", "Color tab: tap something neutral grey and Temperature and Tint make it grey."),
        HelpItem("Curves", "Light tab: touch the curve to add a point, drag it, double-tap it to remove; elsewhere the box scrolls. RGB, then Red, Green and Blue."),
        HelpItem("Detail", "Luma and Color denoise work separately. Local contrast brings out texture; High-pass contrast is wider clarity. Tap Grain's name for its size, roughness and color."),
        HelpItem("Masks", "Brush, linear, radial and stripe layers with their own light and colour. Brush or Erase paints on any layer."),
        HelpItem("Light leaks", "Film-style light (up to 4: streaks, glows, triangles), made like a Photoshop light leak: a white shape with an orange and a red glow, in Screen mode, so the photo shows through and the grain stays on top. Drag one anywhere inside to move it, the dots to resize, the round knob to turn it, the square to bend it; Bend, Taper and Warp reshape it, Softness blurs the core, Glow sets how far the colour reaches. At 100% intensity its white middle (inside the dashed line) hides what is under it. Leaks belong to the photo: presets don't keep them."),
        HelpItem("Presets", "Save the edits by group, apply, import and export .rawboy.json files, or Send to Auto for a whole batch."),
    ]),
]
