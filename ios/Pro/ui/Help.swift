import RawBoyEngine

#if os(macOS)
/** RawBoy Desktop's help sheet (⌘?): the web's, with the Mac's keys. Keep it in step with web/src/ui/pro/help.ts. */
let proHelp = [
    HelpSection("Basics", [
        HelpItem("Open, or drop a file", "⌘O or the Open button, a file dropped on the window, or Open With in Finder: a RAW file, or a HEIC, JPEG, PNG or TIFF (lower quality than RAW). Dropped .cube and HaldCLUT .png files go to Your LUTs."),
        HelpItem("Edits are saved with the photo", "As you work, RawBoy writes your edits into the photo's XMP sidecar (NAME.xmp next to it, or darktable's NAME.EXT.xmp if that is the one there), only its own field; everything else in the file is kept. Open the photo again, here or in RawBoy on the web, and it comes back as you left it. Photos with no saved edits take the previous photo's edits, as on the phone."),
        HelpItem("Sliders", "The panel on the right holds every slider in sections: Light, Curve, Colour, Primaries, Detail, Portrait, Effects, LUT and Lens. Click a section's name to open or close it; an amber dot means it has edits, and the arrow beside it resets that section only. Crop, rotation, flips and scale belong to one photo; the other edits carry over to a photo without saved edits."),
        HelpItem("Top bar", "The photo's name and exposure on the left; Crop, Masks, Light (leaks and effects), Heal, Presets and Looks in the middle; Auto Dev, To Auto, Reset, Undo, Redo and Export on the right. Hover a button for its name and key."),
        HelpItem("Export", "⌘E: JPEG or TIFF, into the folder next to the photo or one you choose. The file is called NAME-rawboy.jpg (or .tif)."),
        HelpItem("Export several photos", "Pick photos in the filmstrip with ⌘-click (one at a time) or ⇧-click (a run), or ⌘A for the whole folder, then ⌘E: each is exported with its own saved edits (the open photo as it is on screen), with the same options, one after another. A bar over the filmstrip shows the progress and the time left; Stop finishes the photo being written. A plain click on a photo, or Deselect, clears the pick."),
    ]),
    HelpSection("Photo", [
        HelpItem("Z, or double-click", "100% view at the pointer; again to go back to the whole photo. Drag to pan."),
        HelpItem("Mouse wheel over the photo", "Zoom in and out around the pointer, from a quarter of the whole photo (it stops once at the whole photo, so masks and light leaks can be placed outside its edges) up to 400% (stops once at 100%). A trackpad pinch works too. The middle button pans the zoomed photo."),
        HelpItem("Press and hold, or \\", "Compare with the as-shot render (the key toggles it until pressed again)."),
        HelpItem("Y", "Before/after slider: the as-shot render on the left of a divider you drag, the edit on the right. Y again hides it. It shows on the whole photo (zoomed in it steps aside), and holding or \\ still compare full size."),
        HelpItem("C", "Open or close Crop & rotate. Drag the corners, edges or inside of the frame to crop, or outside it to rotate (straighten, up to 45° each way)."),
        HelpItem("Filmstrip", "Under the photo: the other photos in its folder, by file name (a RAW + JPEG pair once, as the raw). Click one to open it, or press ← and → for the previous and next; the mouse wheel scrolls the strip. ⌘-click and ⇧-click pick photos for a batch export. Photos only in iCloud show a cloud and aren't downloaded until opened."),
        HelpItem("Copy previous (⇧C)", "RawBoy Desktop: gives this photo the settings of the photo you had open before it (the bar's Copy button, or ⇧C). Opening a photo no longer copies them by itself; geometry, masks, leaks, effects and healing stay the photo's own."),
        HelpItem("Tab or F", "Photo only: hides the bar and the panel; again, or Esc, brings them back. With Full Keyboard Access on, Tab moves between controls instead, and F still works."),
        HelpItem("D, or click outside the photo", "Change the frame around it: grey, white or black."),
        HelpItem("Histogram", "Above the sliders: red, green and blue levels of the developed photo, with the share of crushed shadows (left) and clipped highlights (right). Click it to mark clipped highlights red and crushed shadows blue on the photo."),
    ]),
    HelpSection("Sliders and tools", [
        HelpItem("Double-click a slider", "Reset it (clicking its value does too)."),
        HelpItem("VoiceOver and the keyboard", "Every slider says its name and value (swipe up or down to change it; Reset in the actions goes back to its default), the chips for masks, leaks, effects, looks and LUTs are buttons that say when they are selected, and the photo is announced as the developed photo. With Full Keyboard Access, Tab moves between controls with a focus ring and Space presses one. Reduce Motion stops the fades and scrolls, and Increase Contrast draws chips with a firmer outline. The handles on the photo are for the pointer; the sliders in the panel do the same from the keyboard."),
        HelpItem("Mouse wheel over a slider", "Move it without clicking; with Shift in big steps, with ⌘ in fine ones. A wheel that is scrolling the panel keeps scrolling it."),
        HelpItem("Mouse wheel over Film or stock", "Step through the film stocks without clicking, one per click. A wheel scrolling the panel leaves it alone."),
        HelpItem("Pick white balance", "Colour section: click something neutral grey and Temperature and Tint make it grey. Auto WB solves them for a frame you drag over the photo; Reset WB returns to as shot."),
        HelpItem("Curves", "Curve section: click the curve to add a point, drag it, double-click it to remove."),
        HelpItem("Detail and Effects", "Luma and Colour denoise work separately. Local contrast brings out texture; High-pass contrast is wider clarity. In Effects, fake anamorphic flare adds horizontal cinema streaks; click Grain's name for its size, roughness and colour."),
        HelpItem("Lens", "Embedded profile, Distortion, Horizontal distortion, Crop, Fisheye, Vignetting and Chromatic aberration. Use Lensfun profile corrects distortion, chromatic aberration and vignetting from the Lensfun lens database: Auto matches the camera and lens from the photo's EXIF, Pick lens searches the database, Generic describes a lens that is not in it."),
        HelpItem("Looks", "Click Looks, then the photo: a window over that spot shows it through every LUT and film stock, side by side as labelled stripes; click one to use it. Drag the window and the stripes follow the area under it; drag its corner to resize it. ← → or its arrows turn the page, Esc closes."),
        HelpItem("Your LUTs", "LUT section, under the included ones. Add files… copies .cube or HaldCLUT .png files into RawBoy's LUT folder (its path is shown under the list; Show in Finder opens it, and files put there yourself show up too). Dropping .cube files, or HaldCLUT .png files, on the panel or the window adds them the same way. Choose folder… reads them from a folder of your own instead; Use RawBoy's folder goes back."),
        HelpItem("Presets", "Save the edits by group, apply, import and export .rawboy.json files. Import, export, rename and delete work with no photo open too; Auto's Preset lists these presets."),
        HelpItem("Skin retouch, Blemish removal and Portrait retouch", "Portrait section. They work on skin found with Apple's Vision framework: faces (tilted ones too, small ones less well), their skin, and neck, arms and hands by tone. Portrait retouch is the natural clean-up of the web: spots, under-eyes, lines and unevenness, 40 is the tuned look; it is also in the Masks panel per layer, to retouch a brushed area only. A garment close to skin tone can be taken for skin; if no face is found the sliders say so."),
        HelpItem("Portrait blur", "Portrait section, on photos from RawBoy Camera with a saved depth map (Settings › Experimental › Save depth map in DNG there): blurs what is nearer or farther than the focus with the same round lens blur as the masks, up to 3% of the long side. Raising it opens Focus depth (0 near, 100 far; the camera's own focus to begin with), Depth falloff (higher = shallower depth of field) and Edge softness (how gradually the blur starts at a subject's edge). Photos without a depth map don't show it; estimating one from the picture is web only for now."),
        HelpItem("Lens blur", "Masks, Adjust tab: a round lens-like defocus inside the mask (up to 3% of the long side). Small bright lights become clean discs, and the sharp part next to the mask is never smeared; it follows the mask, so paint or draw the background and leave the subject out."),
        HelpItem("Healing brush", "Heal in the top bar, or B: click a dust spot, blemish or small object to heal it away, drag to paint a stroke (zoom to 100% for the fine ones). The tone is filled in from around it and the detail borrowed from a nearby clean area; Choose source lets you drag a dashed copy onto the area to clone from. Size and Feather set the next strokes; [ and ] change the size, Delete removes the selected stroke, Esc or Return finishes. Strokes belong to the photo (the sidecar keeps them, presets don't)."),
    ]),
    HelpSection("Export", [
        HelpItem("Film scan 1.5×", "In the export sheet, shown while a film look is on (the Film tone mapper in Pro, Film photos in Auto): renders the photo 1.5× larger, upscaled with sharp edges and the film grain on a finer pitch, like a finer scan of the negative. The size setting doesn't apply to it."),
    ]),
    HelpSection("Browse", [
        HelpItem("Browse (⌘3)", "The third mode next to Pro and Auto: RawBoy Viewer's browser (a grid of a folder's photos with a sidebar of favourites, recent folders and places) and its viewer, inside this window. Open a folder with ⌘O, drop one on the window, or click it in the sidebar. A RAW + JPEG pair is one photo, shown as the raw."),
        HelpItem("Rating and culling", "1–5 give stars, 0 clears them, P picks, X rejects, U unflags, Return or double-click opens the viewer (arrows to move, Esc back), ⌘[ and ⌘] turn a photo, C compares two to four. Ratings, picks and turns are written into the photo's XMP sidecar, the same one Pro and Auto use. The Browse menu has Rename, Export, Copy and Move to, Compare, Slideshow and Send to RawBoy Auto. Move to Trash is ⌘⌫, and ⌘Z undoes ratings and file moves."),
        HelpItem("Open in Pro, send to Auto", "In the viewer, E opens the photo in Pro (whichever mode the window was in; Auto's batch stays as it is). Send to RawBoy Auto adds the selected photos or folders to Auto's batch as Looks, Film or As is. Both happen inside Desktop: nothing is opened through the system."),
        HelpItem("Full-screen viewer", "Mode › Full-Screen Viewer in Browse opens the viewer as a screen-filling window of its own, with the menu bar and Dock hidden while it is in front, instead of inside this window; ⌥⌘↩ opens the selection the other way once. Edge panels slide in at the screen's edges, holding the mouse down peeks at 100%. E hands the photo to Pro and closes it; Esc goes back. Compare follows the same choice."),
        HelpItem("Settings of its own", "Browse keeps its sort order, sizes, favourites and export choices apart from the standalone RawBoy Viewer's, so the two never undo each other. ? shows its keys."),
    ]),
    HelpSection("Packer", [
        HelpItem("Pack Raws… (⇧⌘P)", "Opens RawBoy Packer, which re-saves raws and DNGs as smaller DNGs: drop raws or folders, choose Smallest files, Maximum compatibility or Tiny copies, and Pack. The summary under the settings says what each choice does and which programs open the result. Files are saved next to the originals (or in a folder you choose), never over an existing file; the originals are never changed."),
        HelpItem("Sort, folder headers", "Sort switches each folder between shoot date and file name (remembered). Click a folder's header to fold it to one line, which then shows how its files are getting on; Collapse all and Expand all do every folder; ✕ removes a folder from the list."),
    ]),
    HelpSection("Auto mode", [
        HelpItem("Pro | Auto", "The switch in the title bar (⌘1, ⌘2) changes between the full editor for one photo and Auto, which develops a batch automatically: each photo gets a suggested look, adjustable one by one or all at once."),
        HelpItem("Adding photos", "⌘O (Add Photos…), ⇧⌘O (a folder), or drop photos and folders on the window; several photos or a folder opened from the Finder or with --auto go to Auto too. Photos are used in place, never copied."),
        HelpItem("Grid", "Arrow keys move, Return opens, a click opens. ⌘A selects all, ⌘-click toggles a photo, ⇧-click selects the range from the last clicked photo; Esc clears the selection (and, in a photo, goes back to the grid); ← and → go to the previous or next photo. A selection can be rotated, given a preset, removed from the batch or exported."),
        HelpItem("Edit in Pro, Send to Auto", "Edit in Pro (⌘↩, in the photo view's toolbar, the Mode menu, or the grid with one photo selected) opens the photo in the editor with its Auto develop (look or preset and Auto's sliders) as the starting edits; Auto's batch stays. In the editor, To Auto (⇧⌘A) takes the photo back to Auto with these edits, which develop it there in place of its look (Auto's sliders adjust on top; Use a look drops them); a photo not in the batch joins it. A photo opened from the Finder or RawBoy Viewer always opens in the editor."),
        HelpItem("Clear batch", "The button at the top right of the grid, or Mode › Clear Batch…, takes every photo out of the batch after asking (it names the count). Files, sidecars and exported photos are never touched."),
        HelpItem("Export", "⌘E exports the batch (the sheet asks format, quality and size, and the folder: next to each photo, or one you choose). Files are named NAME-auto.jpg and replace an earlier one."),
        HelpItem("Sidecars", "Each photo's look, strength and adjustments are kept in its XMP sidecar (rawboy:Auto, 800 ms after a change), next to RawBoy's own edits; the photo comes back as you left it when it is added again, and RawBoy Web reads the same field."),
    ]),
    HelpSection("Masks", [
        HelpItem("B", "Inside Masks: brush (adds a brush layer if none is selected). Elsewhere it opens the Healing brush."),
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
        HelpItem("Tabs", "Light, Colour, Detail, LUTs and Lens hold the sliders. Edits carry over to the next photo; crop, rotation, flips and scale don't."),
        HelpItem("Lens preset", "Lens tab: name it (the lens by default) and Save lens preset keeps its settings for this photo's lens; Send to Auto also hands it to RawBoy Auto (on the Mac every saved lens preset is in Auto already), which corrects every photo taken with that lens on top of its look. Manual lenses record no lens: Auto lets you pick their presets by name."),
        HelpItem("Top bar", "Crop & rotate (turn, flip, straighten, Vertical and Horizontal perspective, scale, crop; drag outside the frame to straighten), Masks, Light (leaks and effects), Presets, Auto Dev (automatic light and colour, keeps the LUT) and Export; Reset all, Undo and Redo under them. Long-press a tool for its full name."),
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
        HelpItem("Pick white balance", "Colour tab: tap something neutral grey and Temperature and Tint make it grey. Auto WB solves them for a frame you drag over the photo; Reset WB returns to as shot."),
        HelpItem("Detail", "Luma and Colour denoise work separately. Local contrast brings out texture; High-pass contrast is wider clarity. Fake anamorphic flare adds horizontal cinema streaks (Neutral, Blue, Golden or Magenta, with an optional Ghosts switch: faint reflections of the lights mirrored through the middle of the frame, like the internal reflections of a real lens; big lit windows and signs do not flare). Tap Grain's name for its size, roughness and colour."),
        HelpItem("Lens", "Embedded profile, Distortion, Horizontal distortion (bows verticals like an anamorphic lens), Crop (0 auto-crops empty edges; negative shows the curved edges, positive crops tighter), Fisheye (tap its name: straightens a fisheye lens towards rectilinear; set the lens field of view, and for a circular fisheye the size and centre of its image circle), Vignetting and Chromatic aberration. Use Lensfun profile corrects distortion, chromatic aberration and vignetting from the Lensfun lens database: Auto matches the camera and lens from the photo's EXIF, Pick lens searches the database, Generic describes a lens that is not in it."),
        HelpItem("Masks", "Brush, linear, radial and stripe layers with their own light and colour. Brush or Erase paints on any layer."),
        HelpItem("Light leaks", "Film-style light (up to 4: streaks, glows, triangles), made like a Photoshop light leak: a white shape with an orange and a red glow, in Screen mode, so the photo shows through and the grain stays on top. Drag one anywhere inside to move it, the dots to resize (on a glow, the hollow dots reshape its outline around what it should hide; Round outline undoes that), the round knob to turn it, the square to bend it; Bend, Taper and Warp reshape it, Softness blurs the core, Glow sets how far the colour reaches. At 100% intensity its white middle (inside the dashed line) hides what is under it. Leaks belong to the photo: presets don't keep them."),
        HelpItem("Light effects", "Effects (the Effects switch at the top of the Light leaks panel): up to 4 \"lomo\" light effects, like light double-exposed onto film: + Lightning, + Sparks, + Trails or + Swirl, a new random one each press. It glows into the photo and the grain stays on top. Drag inside it to move it, the dots to size it, the round knob to turn it; New random draws a new pattern with the same settings, and the switch changes its kind. Effects belong to the photo: presets don't keep them."),
        HelpItem("Presets", "Save the edits by group, apply, import and export .rawboy.json files, or Send to Auto for a whole batch. Select to batch-delete or export."),
    ]),
]
#endif
