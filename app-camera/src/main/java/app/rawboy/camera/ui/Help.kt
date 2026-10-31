package app.rawboy.camera.ui

import app.rawboy.view.HelpItem
import app.rawboy.view.HelpSection

/** RawBoy Camera's and RawBoy Film's "?" sheet. Keep it in step with the Readme's RawBoy Camera section. */
internal val CAMERA_HELP = listOf(
    HelpSection(
        "Shooting",
        listOf(
            HelpItem("Shutter or volume buttons", "Take a photo. It is saved as a JPEG developed with the look (and the DNG, if RAW is on)."),
            HelpItem("Tap the viewfinder", "Lock focus and exposure at that point. AF LOCK ✕ or a tap elsewhere releases it."),
            HelpItem("Drag the focus ring", "Moves the focus point, with a magnified loupe; it focuses there when you let go."),
            HelpItem("Track subject after tap", "In Settings: the focus ring follows what you tapped (TRACKING ✕); back to autofocus once it's lost."),
            HelpItem("Press and hold", "See the photo without the look."),
            HelpItem("UW · W · T", "Switch between the ultrawide, wide and telephoto lenses. The button next to the shutter switches to the selfie camera."),
            HelpItem("Thumbnail", "Opens the last photo."),
            HelpItem("QR codes", "Point the camera at one: a bar above the lenses shows what it holds. Tap it to open the link, join the Wi-Fi network or copy the text; ✕ hides it. Settings › QR codes turns it off."),
        ),
    ),
    HelpSection(
        "Look",
        listOf(
            HelpItem("Look menu", "The film look the viewfinder shows and the photo gets."),
            HelpItem("Strength, Brightness, Warmth", "How much of the look, brighter or darker, warmer or cooler. Double-tap a slider to reset it."),
        ),
    ),
    HelpSection(
        "Top bar",
        listOf(
            HelpItem("RAW", "Keep the DNG next to the JPEG (lit) or not (struck through)."),
            HelpItem("Burst (stacked frames)", "Merge 8 frames into each shot without flash for less noise. Tap to cycle On, Auto (small A: merges in low light only; the default) and Off. Coloured when the next shot will merge, gray when it won't. Same as the Settings choice."),
            HelpItem("Flash", "Turns Focus-flash on or off: the light comes on to help focusing, then the flash fires."),
            HelpItem("Settings", "JPEG quality, Smaller photos, 50 MP / 48 MP (full sensor resolution on lenses that offer it; single frame, slower to save), Merge 8 frames (On, Auto or Off; each shot merges a burst of raws: less noise; hold still), Geotag (saves where each photo was taken; asks for location access when turned on), QR codes (on by default), Histogram (live red, green and blue levels in a corner of the viewfinder), Remember camera & settings and the licences."),
        ),
    ),
)
