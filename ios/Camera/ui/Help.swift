import RawBoyEngine

/** RawBoy Camera's and RawBoy Film's "?" sheet. Keep it in step with the Readme's RawBoy Camera section. */
let cameraHelp = [
    HelpSection("Shooting", [
        HelpItem("Shutter, volume buttons or Camera Control", "Take a photo. It is saved as a JPEG developed with the look (and the DNG, if RAW is on)."),
        HelpItem("Tap the viewfinder", "Lock focus and exposure at that point. AF LOCK ✕ or a tap elsewhere releases it."),
        HelpItem("Drag the focus ring", "Moves the focus point, with a magnified loupe; it focuses there when you let go."),
        HelpItem("Track subject after tap", "In Settings: the focus ring follows what you tapped (TRACKING ✕); back to autofocus once it's lost."),
        HelpItem("Press and hold", "See the photo without the look."),
        HelpItem("UW · W · T", "Switch between the ultrawide, wide and telephoto lenses. The button next to the shutter switches to the selfie camera."),
        HelpItem("Thumbnail", "Opens Photos."),
        HelpItem("QR codes", "Point the camera at one: a bar above the lenses shows what it holds. Tap it to open the link or copy the text (for Wi-Fi, the password); ✕ hides it. Settings › QR codes turns it off."),
    ]),
    HelpSection("Look", (Edition.filmLooks.isEmpty ? [HelpItem]() : [
        // RawBoy Camera only: RawBoy Film's looks are the film stocks already.
        HelpItem("Film button", "The film strip left of the Look menu. On (the default), the menu lists film stocks, developed as the negative, its print and scan, with film grain and the red halation around bright lights; off, the looks on RawBoy's film LUTs. Each keeps its own pick. B&W uses only the black and white looks (with more contrast and grain while Film is on), and switching it off comes back to Film."),
    ]) + [
        HelpItem("Look menu", "The film look the viewfinder shows and the photo gets."),
        HelpItem("Strength, Brightness, Warmth", "How much of the look, brighter or darker, warmer or cooler. Double-tap a slider to reset it."),
        HelpItem("B&W", "The B&W button left of the Look menu switches to black and white: the menu lists the black and white films, and Filter (Yellow, Orange, Red, Green) takes Warmth's place. Like a coloured filter on the lens, it lightens its own colour and darkens the others: Red gives dark skies and smooth skin, Green darker skin and lighter leaves. The DNG stays in colour."),
    ]),
    HelpSection("Top bar", [
        HelpItem("RAW", "Keep the DNG next to the JPEG (lit) or not (struck through)."),
        HelpItem("Flash", "Turns the flash on or off."),
        HelpItem("Settings", "JPEG quality, Smaller photos, Geotag (saves where each photo was taken; asks for location access when turned on), Shutter sound (a click on each shot, off by default; always on where the law requires it), QR codes (on by default), Histogram (live red, green and blue levels in a corner of the viewfinder), Remember camera & settings and the licences."),
    ]),
]
