package app.rawboy.camera.ui

import app.rawboy.view.HelpItem
import app.rawboy.view.HelpSection

/** RawBoy Camera's "?" sheet. Keep it in step with the Readme's RawBoy Camera section. */
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
            HelpItem("Zoom 1-10×", "For seeing something far away: pinch the viewfinder, or use + and − in the bottom right corner (Settings › Zoom buttons hides them) (hold to keep zooming). Tap the number between them to jump 1×, 2×, 5×, 10× and back to 1×. It zooms the viewfinder only: photos are still taken of the whole frame."),
            HelpItem("Thumbnail", "Opens the last photo."),
            HelpItem("QR codes", "Point the camera at one: a bar above the lenses shows what it holds. Tap it to open the link, join the Wi-Fi network or copy the text; ✕ hides it. Settings › QR codes turns it off."),
        ),
    ),
    HelpSection(
        "Look",
        listOf(
            HelpItem(
                "Film button",
                "The film strip left of the Look menu. On (the default), the menu lists film stocks, developed as the negative, its print and scan, with film grain and the red halation around bright lights; off, the looks on RawBoy's film LUTs. Each keeps its own pick. B&W uses only the black and white looks (with more contrast and grain while Film is on), and switching it off comes back to Film.",
            ),
            HelpItem("Look menu", "The film look the viewfinder shows and the photo gets."),
            HelpItem("Brightness, Warmth", "Brighter or darker, warmer or cooler. Double-tap a slider to reset it. How much of the look the photo gets (Strength) is in Settings."),
            HelpItem("Phone held sideways", "The controls move to the right, under your thumb: the shutter in the middle of the edge, a tall slider beside it, and B and W (F, the filter, in B&W) to pick what the slider changes, with the lenses in a column beside them. Double-tap a letter or the slider to reset it. RAW, Burst, Flash, ? and Settings are at the left."),
            HelpItem("B&W", "The B&W button left of the Look menu switches to black and white: the menu lists the black and white films, and Filter (Yellow, Orange, Red, Green) takes Warmth's place. Like a coloured filter on the lens, it lightens its own colour and darkens the others: Red gives dark skies and smooth skin, Green darker skin and lighter leaves. The DNG stays in colour."),
        ),
    ),
    HelpSection(
        "Top bar",
        listOf(
            HelpItem("Photo / Video (under the picture)", "The PHOTO and VIDEO pill above the shutter, or swipe sideways on the shutter area (left for video). Switches to video: the shutter becomes a red record button and the picture is recorded with the look on it, 1080p at 30 fps with stereo sound, into Movies/RawBoy Camera. The darkened bands show what a 16:9 video leaves out of the viewfinder. Lens and camera can't change while recording; leaving the app stops it. AE LOCK (top right) holds the exposure and a tap on the picture locks focus, each on its own. Settings › Flat video for grading records the picture without the look, to grade later. Settings › Optical video stabilization uses the lens stabilizer only."),
            HelpItem("RAW", "Keep the DNG next to the JPEG (lit) or not (struck through)."),
            HelpItem("Burst (stacked frames)", "Merge 8 frames into each shot without flash for less noise. Tap to cycle On, Auto (small A: merges in low light only; the default) and Off. Coloured when the next shot will merge, gray when it won't. Same as the Settings choice."),
            HelpItem("Flash", "Turns Focus-flash on or off: the light comes on to help focusing, then the flash fires. On the selfie camera it lights the screen: a bright frame around the picture, with the screen at full brightness, for the moment of the shot."),
            HelpItem("Timer and long exposure (Experimental)", "Turn on Settings › Experimental features to get two more buttons beside the Photo / Video switch, under the picture. Timer: Off, 2, 5 or 10 s; the shutter counts down first so the phone can settle on a tripod, and pressing it again cancels. Long exposure: Off, 5, 10, 30 or 60 s of frames stacked into one photo, like an ND filter; the shutter stops it early. Settings picks Average (smooth water and clouds) or Lighten (light and star trails). Use a tripod; not used with flash or the full sensor resolution."),
            HelpItem("Settings", "JPEG quality, Look strength, Smaller photos, 50 MP / 48 MP (full sensor resolution on lenses that offer it; single frame, slower to save), Merge 8 frames (On, Auto or Off; each shot merges a burst of raws: less noise; hold still), Geotag (saves where each photo was taken; asks for location access when turned on), HDR gain map (Ultra HDR JPEGs: extra highlight range on HDR screens, off by default), Date stamp (DD MM 'YY by default, or 'YY MM DD / MM DD 'YY, in a clock font in the corner of each photo, off by default), QR codes (on by default), Grid (a 3 x 3 grid over the viewfinder, off by default), Level (a line that turns yellow when the phone is straight, off by default), Histogram (live red, green and blue levels in a corner of the viewfinder), Remember camera & settings and the licences."),
        ),
    ),
)
