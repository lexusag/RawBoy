import SwiftUI

/** Width of the controls panel beside the photo in landscape (the web's sidebar is 340 px). */
public let sidePanelWidth: CGFloat = 360

/**
 * The photo and its controls, laid out by the window's shape: taller than wide (portrait) puts the controls under
 * the photo; wider than tall (the phone turned sideways) puts them in a panel on the right, at most [sidePanelWidth]
 * and never more than 45% of the width, and the photo takes the rest. Port of Android's `view/PhotoWithControls.kt`
 * (web: `@media (orientation: portrait)` in styles.css). Pro and Auto use it.
 *
 * [controls] gets `beside`: true in the side panel, where a panel should fill the height (no cap under the photo).
 * One `AnyLayout` switches between the two, so the photo's Metal view keeps its identity when the phone turns.
 */
public struct PhotoWithControls<Photo: View, Controls: View>: View {
    let photo: Photo
    let controls: (_ beside: Bool) -> Controls

    public init(@ViewBuilder photo: () -> Photo, @ViewBuilder controls: @escaping (_ beside: Bool) -> Controls) {
        self.photo = photo()
        self.controls = controls
    }

    public var body: some View {
        GeometryReader { geo in
            let beside = geo.size.width > geo.size.height
            let layout = beside ? AnyLayout(HStackLayout(spacing: 0)) : AnyLayout(VStackLayout(spacing: 0))
            layout {
                photo
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                if beside { Divider() }
                VStack(spacing: 0) {
                    controls(beside)
                }
                .frame(width: beside ? min(sidePanelWidth, geo.size.width * 0.45) : nil)
                .frame(maxHeight: beside ? .infinity : nil, alignment: .top)
            }
        }
    }
}
