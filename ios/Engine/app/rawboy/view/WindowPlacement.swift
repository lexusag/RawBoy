import CoreGraphics

/**
 * Where a window may sit (RawBoy Desktop): a window restored onto a display that is no longer connected, or left behind by
 * one that was unplugged or changed resolution, must not end up where it can't be reached. Pure geometry, in the screens'
 * shared coordinate space.
 */
public enum WindowPlacement {
    /** How much of the window (at least) must be on one screen: most of a title bar's width and height. */
    static let reachableWidth: CGFloat = 160
    static let reachableHeight: CGFloat = 80

    /** Whether enough of [frame] is on one of [screens] (their visible frames) to be grabbed and used. */
    public static func reachable(_ frame: CGRect, screens: [CGRect]) -> Bool {
        screens.contains { screen in
            let part = screen.intersection(frame)
            return !part.isNull && part.width >= min(frame.width, reachableWidth) && part.height >= min(frame.height, reachableHeight)
        }
    }

    /**
     * nil when [frame] is fine where it is; otherwise the frame to use: the same size cut down to fit [preferred] (the main
     * screen, else the first), centred on it. nil too when no screen is known.
     */
    public static func corrected(_ frame: CGRect, screens: [CGRect], preferred: CGRect? = nil) -> CGRect? {
        guard let target = preferred ?? screens.first, !reachable(frame, screens: screens) else { return nil }
        let size = CGSize(width: min(frame.width, target.width), height: min(frame.height, target.height))
        return CGRect(x: target.midX - size.width / 2, y: target.midY - size.height / 2, width: size.width, height: size.height).integral
    }
}
