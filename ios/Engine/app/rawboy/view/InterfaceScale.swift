import SwiftUI

/**
 * RawBoy Desktop's interface size: the bundled Viewer's Settings › Interface size (`app.uiScale` under
 * `desktop.browse.`), so one choice sizes Browse, Pro, Auto and the Packer alike. 1 = as designed; the phones never set it.
 */
private struct InterfaceScaleKey: EnvironmentKey {
    static let defaultValue: CGFloat = 1
}

public extension EnvironmentValues {
    /** How much larger (or smaller) the interface is drawn than designed: `interfaceScaled()` applies it. */
    var interfaceScale: CGFloat {
        get { self[InterfaceScaleKey.self] }
        set { self[InterfaceScaleKey.self] = newValue }
    }
}

public extension View {
    /**
     * Draws this view at the environment's `interfaceScale`, as RawBoy Viewer's browser does: laid out in the space
     * offered divided by the scale, then scaled up (or down) from its top-left corner to fill it, so text, controls and
     * spacing all grow together and the view still takes exactly the space it is given (or, offered any size, its own
     * size times the scale). Used on the bars and panels around a photo, never on the photo's Metal view (scaling it
     * would draw the photo from a smaller or larger drawable).
     */
    func interfaceScaled() -> some View { modifier(InterfaceScaled()) }
}

private struct InterfaceScaled: ViewModifier {
    @Environment(\.interfaceScale) private var scale

    func body(content: Content) -> some View {
        #if os(macOS)
        let s = min(max(scale, 0.5), 2)
        // One view tree at every scale (no `if s == 1`), so changing the size keeps scroll positions and state.
        ScaledFrame(scale: s) {
            content.scaleEffect(s, anchor: .topLeading)
        }
        #else
        content  // the phones follow the system's text size instead
        #endif
    }
}

/**
 * Proposes its child the offered size divided by [scale], reports the child's size times [scale] and places the child
 * at its top-left corner: with the child's `scaleEffect(scale, anchor: .topLeading)` it then covers the frame exactly.
 */
private struct ScaledFrame: SwiftUI.Layout {
    let scale: CGFloat

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        guard let child = subviews.first else { return .zero }
        let size = child.sizeThatFits(unscaled(proposal))
        return CGSize(width: size.width * scale, height: size.height * scale)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        subviews.first?.place(at: bounds.origin, anchor: .topLeading,
                              proposal: ProposedViewSize(width: bounds.width / scale, height: bounds.height / scale))
    }

    private func unscaled(_ p: ProposedViewSize) -> ProposedViewSize {
        ProposedViewSize(width: p.width.map { $0 / scale }, height: p.height.map { $0 / scale })
    }
}
