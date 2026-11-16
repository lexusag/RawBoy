import RawBoyEngine

#if os(macOS)
/** RawBoy Desktop's Auto help: the phones' sheet with the Mac's grid, sidebar, bar, panel, mouse and keys. */
let autoHelp = [
    HelpSection("Basics", [
        HelpItem("Add", "⌘O adds photos, ⇧⌘O a folder, or drop photos and folders on the window. Each is developed automatically and gets a film look. JPEG, HEIC, PNG and TIFF work too, at lower quality. Photos are used in place, never copied."),
        HelpItem("Sidebar", "New photos: Looks (a film LUT on the auto develop) or Film (developed as film), for photos added from now on. Order: Shoot date (each file's EXIF date, else the file's date) or File name; remembered. Preset: develop every photo with one of your Pro presets instead of a look (preset files are imported in Pro's Presets). Lens: the lens preset for every photo (By lens, None or a named one). Auto denoise all: every photo gets the denoise and sharpening measured on it; Undo in a photo takes it back."),
        HelpItem("Export all", "⌘E: JPEG or TIFF, quality and size, next to each photo or into a folder you choose; NAME-auto.jpg replaces an earlier one. Stop ends it after the current photo."),
        HelpItem("A waiting photo", "Click it and it is analysed next, ahead of the rest, and opens when it's ready."),
    ]),
    HelpSection("Grid", [
        HelpItem("Arrows, Return", "Move between photos and open one; a click opens too."),
        HelpItem("Selecting", "⌘A selects all, ⌘-click adds or removes a photo, ⇧-click selects the range from the last one clicked; Esc clears the selection. A selection can be rotated, given a preset or lens preset, denoised, removed from the batch or exported."),
        HelpItem("Look name", "Under each photo, with \"suggested\" when Auto picked it; hover for the whole text."),
        HelpItem("Reset all photos…", "Next to Clear batch (and in the Mode menu): puts every photo back to one look, one film stock, or As is, and clears its adjustments, crop and any RawBoy preset. Undo in a photo's view brings its edits back."),
    ]),
    HelpSection("Photo view", [
        HelpItem("Bar", "Grid (Esc) goes back; ← and → (or the arrows by the name) go to the previous or next photo. Crop opens Crop & rotate, Preset develops this photo with a RawBoy preset. Edit in Pro (⌘↩) opens it in the editor; Copy (⇧C) gives it the previous photo's look and settings (denoise stays); Apply to All copies its look and settings to every photo (brightness, denoise and crop stay per photo); Remove takes it out of the batch (the file stays). Then Undo, Redo (⌘Z, ⇧⌘Z) and Export."),
        HelpItem("Panel", "Look (or Film): Looks or Film, Strength and every look as a thumbnail; click one to use it. Light: Brightness, Contrast. Colour: Pick white balance, Warmth, Tint, Saturation. Detail: Grain, Denoise. Click a section's name to open or close it; an amber dot and the arrow beside it reset that section."),
        HelpItem("Pick white balance", "Colour section: click something in the photo that should be neutral grey, and Warmth and Tint make it grey."),
        HelpItem("Double-click", "100% view at that point; drag to pan, double-click again to go back. A trackpad pinch zooms too."),
        HelpItem("Mouse wheel over the photo", "Zoom in and out around the pointer, up to 400%; double-click goes back to the whole photo. The middle button pans the zoomed photo."),
        HelpItem("Mouse wheel over a slider", "Move it without clicking; with Shift in big steps, with ⌘ in fine ones."),
        HelpItem("Press and hold", "See the photo without the look."),
        HelpItem("Click outside the photo", "Change the frame around it: grey, white or black."),
        HelpItem("Crop & rotate", "Drag the corners, edges or inside of the frame, pick a shape (Original, 1:1, 4:3, 3:2, 16:9...), turn the photo in quarter steps and straighten the horizon. The crop is in the exports and in Undo."),
        HelpItem("Double-click a slider", "Reset it."),
    ]),
]
#else
/** RawBoy Auto's "?" sheet. Keep it in step with the Readme's RawBoy Auto section and Android's ui/Help.kt. */
let autoHelp = [
    HelpSection("Basics", [
        HelpItem("Add", "Pick photos from Photos or Files. Each is developed automatically and gets a film look. JPEG, HEIC, PNG and TIFF work too, at lower quality."),
        HelpItem("Import as", "Looks (a film LUT on the auto develop) or Film (developed as film), for photos added from now on."),
        HelpItem("Export", "JPEG or TIFF and the size, asked when you tap Export all, Export on a selection or the photo view's Export; remembered."),
        HelpItem("Apply RawBoy preset…", "Develop every photo with a RawBoy preset instead of a look. Remove goes back to the looks."),
        HelpItem("Lens presets", "Lens presets sent from RawBoy's Lens tab correct every photo taken with their lens, on top of its look or preset; only the lens settings change. The lens presets button picks one for every photo (By lens, None or a named preset, for manual lenses that record no lens); Lens in the selection bar picks one for the selected photos. Remove forgets a preset."),
        HelpItem("Sort", "Photos are in the order they were shot (from each file's EXIF date; a photo without one by its file's date). Sort: File name (on the Mac, File name under Order in the sidebar) orders them by name instead; remembered."),
        HelpItem("Export all", "Saves every photo to Photos, in the RawBoy Auto album. Stop ends it after the current photo; saved ones stay."),
        HelpItem("Auto denoise all", "Once a series is done: every photo gets the denoise and sharpening measured on it (its noise and ISO) in place of its Denoise slider. Looks, presets, lens corrections and the other settings stay; Undo in a photo takes it back for that photo."),
        HelpItem("Tap a waiting photo", "It's analysed next, ahead of the rest (marked Next), and opens when it's ready."),
    ]),
    HelpSection("Selecting photos", [
        HelpItem("Long-press a photo", "Start selecting; then tap others to add or remove them, or All."),
        HelpItem("Auto denoise (dots)", "Give only the selected photos their measured denoise, as Auto denoise all does for the batch."),
        HelpItem("Rotate, Remove", "Turn the selected photos 90° or take them out of the batch (the originals stay)."),
        HelpItem("Preset (bookmarks)", "Develop the selected photos with their own RawBoy preset file, e.g. one per scene; the rest keep theirs."),
        HelpItem("Export", "Save only the selected photos, with the same format and size choices as Export all."),
    ]),
    HelpSection("Photo view", [
        HelpItem("Swipe left or right", "Previous or next photo"),
        HelpItem("Undo, Redo", "The arrows in the top bar take this photo's last edit back, or bring it again."),
        HelpItem("Double-tap", "100% view; drag to pan, double-tap again to go back."),
        HelpItem("Pinch", "Two fingers zoom around where they started, up to 400% (stops once at 100%); drag to pan. Out past the whole photo goes back to it."),
        HelpItem("Tap outside the photo", "Change the frame around it: grey, white or black."),
        HelpItem("Press and hold", "See the photo without the look."),
        HelpItem("Look, Adjust", "Look, Strength, Brightness and Warmth; Adjust has the auto develop's own sliders."),
        HelpItem("Pick white balance", "Adjust tab (Colour on the Mac): tap or click something neutral grey and Warmth and Tint make it grey."),
        HelpItem("Crop & rotate (…)", "Drag the corners, edges or inside of the frame, pick a shape (Original, 1:1, 4:3, 3:2, 16:9...), turn the photo in quarter steps and straighten the horizon. The crop is in the exports and in Undo; Apply to all leaves each photo's crop alone."),
        HelpItem("Apply RawBoy preset… (…)", "Develop this photo with a RawBoy preset instead of its look."),
        HelpItem("Remove from batch (…)", "Takes this photo out of the batch (the original stays) and goes on to the next."),
        HelpItem("Apply to all (…)", "Copies the look and its settings to every photo (brightness and denoise stay per photo)."),
        HelpItem("Copy previous", "Gives this photo the look, brightness and settings of the photo before it (denoise stays)."),
        HelpItem("Look name", "The name of the look or film stock a photo has now is on its cell in the grid (under the picture on the Mac; hover for the whole text) and in bold above the look strip in the photo view (above Strength in the Mac's Look section), with \"suggested\" when Auto picked it."),
        HelpItem("Reset all photos… (Mac)", "Next to Clear batch (and in the Mode menu): puts every photo back to one look, one film stock, or As is (just the automatic exposure and tone), and clears each photo's Strength, brightness, warmth, tint, contrast, saturation, grain, denoise, rotation, crop and any RawBoy preset. The photos stay; Undo in a photo's view brings its edits back."),
    ]),
]
#endif
