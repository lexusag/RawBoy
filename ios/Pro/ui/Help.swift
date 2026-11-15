import RawBoyEngine

#if os(macOS)
/** RawBoy Desktop's help sheet (⌘?): the web's, with the Mac's keys. Keep it in step with web/src/ui/pro/help.ts. */
let proHelp = [
    HelpSection("Basics", [
        HelpItem("Open, or drop a file", "⌘O or the Open button, a file dropped on the window, or Open With in Finder: a RAW file, or a HEIC, JPEG, PNG or TIFF (lower quality than RAW)."),
        HelpItem("Edits are saved with the photo", "As you work, RawBoy writes your edits into the photo's XMP sidecar (NAME.xmp next to it, or darktable's NAME.EXT.xmp if that is the one there), only its own field; everything else in the file is kept. Open the photo again, here or in RawBoy on the web, and it comes back as you left it. Photos with no saved edits take the previous photo's edits, as on the phone."),
        HelpItem("Tabs", "Light, Color, Detail, LUTs and Lens hold the sliders. Crop, rotation, flips and scale belong to one photo; the other edits carry over to a photo without saved edits."),
        HelpItem("Top bar", "Crop & rotate, Masks, Light (leaks and effects), Presets, Auto Dev and Export; Reset all, Undo and Redo under them."),
        HelpItem("Export", "⌘E: JPEG or TIFF, into the folder next to the photo or one you choose. The file is called NAME-rawboy.jpg (or .tif)."),
    ]),
    HelpSection("Photo", [
        HelpItem("Z, or double-click", "100% view at the pointer; again to go back to the whole photo. Drag to pan."),
        HelpItem("Mouse wheel over the photo", "Zoom in and out around the pointer, from a quarter of the whole photo (it stops once at the whole photo, so masks and light leaks can be placed outside its edges) up to 400% (stops once at 100%). A trackpad pinch works too. The middle button pans the zoomed photo."),
        HelpItem("Press and hold, or \\", "Compare with the as-shot render (the key toggles it until pressed again)."),
        HelpItem("C", "Open or close Crop & rotate."),
        HelpItem("D, or click outside the photo", "Change the frame around it: grey, white or black."),
        HelpItem("Histogram", "Above the tabs: red, green and blue levels of the developed photo, with the share of crushed shadows (left) and clipped highlights (right). Click it to mark clipped highlights red and crushed shadows blue on the photo."),
    ]),
    HelpSection("Sliders and tools", [
        HelpItem("Double-click a slider", "Reset it (clicking its value does too)."),
        HelpItem("Mouse wheel over a slider", "Move it without clicking; with Shift in big steps, with ⌘ in fine ones. A wheel that is scrolling the panel keeps scrolling it."),
        HelpItem("Pick white balance", "Color tab: click something neutral grey and Temperature and Tint make it grey."),
        HelpItem("Curves", "Light tab: click the curve to add a point, drag it, double-click it to remove."),
        HelpItem("Detail", "Luma and Color denoise work separately. Local contrast brings out texture; High-pass contrast is wider clarity. Fake anamorphic flare adds horizontal cinema streaks. Click Grain's name for its size, roughness and color."),
        HelpItem("Lens", "Embedded profile, Distortion, Horizontal distortion, Crop, Fisheye, Vignetting and Chromatic aberration."),
        HelpItem("Presets", "Save the edits by group, apply, import and export .rawboy.json files."),
        HelpItem("Skin retouch and blemish removal", "Not available in RawBoy Desktop yet (they need the face detector, which the Mac build doesn't have)."),
    ]),
    HelpSection("Masks", [
        HelpItem("B", "Brush (adds a brush layer if none is selected)"),
        HelpItem("E", "Erase"),
        HelpItem("V", "Move: drag a gradient's or stripe's lines and handles"),
        HelpItem("[ and ]", "Smaller or larger brush"),
        HelpItem("Space", "Hold to pan while zoomed"),
        HelpItem("Middle mouse button, drag", "Pan the zoomed photo, also while a tool paints with the left button."),
        HelpItem("⌘Z", "Undo (each stroke is one step); with Shift, Redo"),
        HelpItem("Esc or Return", "Close the open tool."),
    ]),
]
#else
/** RawBoy's "?" sheet. Keep it in step with the controls (Readme's Controls table) and Android's ui/Help.kt. */
let proHelp = [
    HelpSection("Basics", [
        HelpItem("Open", "Opens a RAW file from Photos or Files, or a HEIC, JPEG, PNG or TIFF (lower quality than RAW)."),
        HelpItem("Tabs", "Light, Color, Detail, LUTs and Lens hold the sliders. Edits carry over to the next photo; crop, rotation, flips and scale don't."),
        HelpItem("Lens preset", "Lens tab: name it (the lens by default) and Save lens preset keeps its settings for this photo's lens; Send to Auto also hands it to RawBoy Auto, which corrects every photo taken with that lens on top of its look. Manual lenses record no lens: Auto lets you pick their presets by name."),
        HelpItem("Top bar", "Crop & rotate (turn, flip, straighten, Vertical and Horizontal perspective, scale, crop), Masks, Light (leaks and effects), Presets, Auto Dev (automatic light and colour, keeps the LUT) and Export; Reset all, Undo and Redo under them. Long-press a tool for its full name."),
    ]),
    HelpSection("Photo", [
        HelpItem("Double-tap", "100% view at that point; drag to pan, double-tap again to go back."),
        HelpItem("Pinch", "Two fingers zoom around where they started, up to 400% (stops once at 100%); drag to pan. Out past the whole photo (it stops once there) shrinks it to a quarter, leaving room around it for masks, light leaks and effects; double-tap goes back to the whole photo."),
        HelpItem("Press and hold", "Compare with the as-shot render."),
        HelpItem("Tap outside the photo", "Change the frame around it: grey, white or black."),
        HelpItem("Histogram", "Above the tabs: red, green and blue levels of the developed photo, with the share of crushed shadows (left) and clipped highlights (right). Tap it to mark clipped highlights red and crushed shadows blue on the photo."),
    ]),
    HelpSection("Sliders and tools", [
        HelpItem("Double-tap a slider", "Reset it (tapping its value does too)."),
        HelpItem("Pick white balance", "Color tab: tap something neutral grey and Temperature and Tint make it grey."),
        HelpItem("Detail", "Luma and Color denoise work separately. Local contrast brings out texture; High-pass contrast is wider clarity. Fake anamorphic flare adds horizontal cinema streaks (Neutral, Blue, Golden or Magenta, with optional faint Ghosts; big lit windows and signs do not flare). Tap Grain's name for its size, roughness and color."),
        HelpItem("Lens", "Embedded profile, Distortion, Horizontal distortion (bows verticals like an anamorphic lens), Crop (0 auto-crops empty edges; negative shows the curved edges, positive crops tighter), Fisheye (tap its name: straightens a fisheye lens towards rectilinear; set the lens field of view, and for a circular fisheye the size and centre of its image circle), Vignetting and Chromatic aberration."),
        HelpItem("Masks", "Brush, linear, radial and stripe layers with their own light and colour. Brush or Erase paints on any layer."),
        HelpItem("Light leaks", "Film-style light (up to 4: streaks, glows, triangles), made like a Photoshop light leak: a white shape with an orange and a red glow, in Screen mode, so the photo shows through and the grain stays on top. Drag one anywhere inside to move it, the dots to resize, the round knob to turn it, the square to bend it; Bend, Taper and Warp reshape it, Softness blurs the core, Glow sets how far the colour reaches. At 100% intensity its white middle (inside the dashed line) hides what is under it. Leaks belong to the photo: presets don't keep them."),
        HelpItem("Light effects", "Effects (the Effects switch at the top of the Light leaks panel): up to 4 \"lomo\" light effects, like light double-exposed onto film: + Lightning, + Sparks, + Trails or + Swirl, a new random one each press. It glows into the photo and the grain stays on top. Drag inside it to move it, the dots to size it, the round knob to turn it; New random draws a new pattern with the same settings, and the switch changes its kind. Effects belong to the photo: presets don't keep them."),
        HelpItem("Presets", "Save the edits by group, apply, import and export .rawboy.json files, or Send to Auto for a whole batch. Select to batch-delete or export."),
    ]),
]
#endif
