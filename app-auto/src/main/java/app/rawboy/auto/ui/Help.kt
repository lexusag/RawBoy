package app.rawboy.auto.ui

import app.rawboy.view.HelpItem
import app.rawboy.view.HelpSection

/** RawBoy Auto's "?" sheet. Keep it in step with the Readme's RawBoy Auto section and RawBoy Web's `ui/auto/help.ts`. */
internal val AUTO_HELP = listOf(
    HelpSection(
        "Basics",
        listOf(
            HelpItem("Add", "Pick or share photos. Each is developed automatically and gets a film look. JPEG, HEIC, PNG and TIFF work too, at lower quality."),
            HelpItem("Import as", "Looks (a film LUT on the auto develop) or Film (developed as film), for photos added from now on."),
            HelpItem("Export", "JPEG or TIFF and the size, asked when you tap Export all, Export on a selection or the photo view's Export; remembered."),
            HelpItem("Apply RawBoy preset…", "Develop every photo with a RawBoy preset instead of a look. Remove goes back to the looks."),
            HelpItem("RawBoy edits", "In RawBoy, Export › Send to Auto adds that photo with every edit (crop, masks, lens blur, light leaks): Auto develops it exactly so, with its own sliders on top, and Export all renders it with the rest. Use a look takes them off; Apply to all, Copy previous and presets replace them, since they belong to that one photo."),
            HelpItem("Lens presets", "Lens presets sent from RawBoy's Lens tab correct every photo taken with their lens, on top of its look or preset; only the lens settings change. The lens presets button picks one for every photo (By lens, None or a named preset, for manual lenses that record no lens); Lens in the selection bar picks one for the selected photos. Remove forgets a preset."),
            HelpItem("Sort", "Photos are in the order they were shot (from each file's EXIF date; a photo without one by its file's date). Sort: File name orders them by name instead; remembered."),
            HelpItem("Auto denoise all", "Once a series is done: every photo gets the denoise and sharpening measured on it (its noise and ISO) in place of its Denoise slider. Looks, presets, lens corrections and the other settings stay; Undo in a photo takes it back for that photo."),
            HelpItem("Export all", "Saves every photo to Pictures/RawBoy Auto. Stop ends it after the current photo; saved ones stay."),
            HelpItem("Tap a waiting photo", "It's analysed next, ahead of the rest (marked Next), and opens when it's ready."),
        ),
    ),
    HelpSection(
        "Selecting photos",
        listOf(
            HelpItem("Long-press a photo", "Start selecting; then tap others to add or remove them, or All."),
            HelpItem("↺ ↻, Remove (bin)", "Turn the selected photos 90° or take them out of the batch (the files stay)."),
            HelpItem("Auto denoise (dots)", "Give only the selected photos their measured denoise, as Auto denoise all does for the batch."),
            HelpItem("Preset (bookmarks)", "Develop the selected photos with their own RawBoy preset file, e.g. one per scene; the rest keep theirs."),
            HelpItem("Export", "Save only the selected photos, with the same format and size choices as Export all."),
        ),
    ),
    HelpSection(
        "Photo view",
        listOf(
            HelpItem("Swipe left or right", "Previous or next photo"),
            HelpItem("Undo, Redo", "The arrows in the top bar take this photo's last edit back, or bring it again."),
            HelpItem("Double-tap", "100% view; drag to pan, double-tap again to go back."),
            HelpItem("Pinch", "Two fingers zoom around their middle, up to 400%, and pan with it; out past the whole photo goes back to it."),
            HelpItem("Tap outside the photo", "Change the frame around it: grey, white or black."),
            HelpItem("Press and hold", "See the photo without the look."),
            HelpItem("Look, Adjust", "Look, Strength, Brightness and Warmth; Adjust has the auto develop's own sliders."),
            HelpItem("Remove from batch (⋮)", "Takes this photo out of the batch (the file stays) and goes on to the next."),
            HelpItem("Apply to all (⋮)", "Copies the look and its settings to every photo (brightness and denoise stay per photo)."),
            HelpItem("Copy previous", "Gives this photo the look, brightness and settings of the photo before it (denoise stays)."),
        ),
    ),
)
