import RawBoyEngine

/** RawBoy Auto's "?" sheet. Keep it in step with the Readme's RawBoy Auto section and Android's ui/Help.kt. */
let autoHelp = [
    HelpSection("Basics", [
        HelpItem("Add", "Pick photos from Photos or Files. Each is developed automatically and gets a film look. JPEG, HEIC, PNG and TIFF work too, at lower quality."),
        HelpItem("Import as", "Looks (a film LUT on the auto develop) or Film (developed as film), for photos added from now on."),
        HelpItem("Export", "JPEG or TIFF and the size, asked when you tap Export all, Export on a selection or the photo view's Export; remembered."),
        HelpItem("Apply RawBoy preset…", "Develop every photo with a RawBoy preset instead of a look. Remove goes back to the looks."),
        HelpItem("Export all", "Saves every photo to Photos, in the RawBoy Auto album."),
    ]),
    HelpSection("Selecting photos", [
        HelpItem("Long-press a photo", "Start selecting; then tap others to add or remove them, or All."),
        HelpItem("Rotate, Remove", "Turn the selected photos 90° or take them out of the batch (the originals stay)."),
        HelpItem("Preset (bookmarks)", "Develop the selected photos with their own RawBoy preset file, e.g. one per scene; the rest keep theirs."),
        HelpItem("Export", "Save only the selected photos, with the same format and size choices as Export all."),
    ]),
    HelpSection("Photo view", [
        HelpItem("Swipe left or right", "Previous or next photo"),
        HelpItem("Undo, Redo", "The arrows in the top bar take this photo's last edit back, or bring it again."),
        HelpItem("Double-tap", "100% view; drag to pan, double-tap again to go back."),
        HelpItem("Tap outside the photo", "Change the frame around it: grey, white or black."),
        HelpItem("Press and hold", "See the photo without the look."),
        HelpItem("Look, Adjust", "Look, Strength, Brightness and Warmth; Adjust has the auto develop's own sliders."),
        HelpItem("Apply to all", "Copies the look and its settings to every photo (brightness and denoise stay per photo)."),
        HelpItem("Copy previous", "Gives this photo the look and settings of the photo before it (brightness and denoise stay)."),
    ]),
]
