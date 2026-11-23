import SwiftUI

/**
 * Crop & rotate's Extend canvas: the first chip turns every side on or off, the four after it (shown while Extend is
 * on) choose which edges the crop may reach past. A side that is off keeps the crop on the photo's edge.
 */
public struct ExtendChips: View {
    public let sides: ExtendSides
    public let onSides: (ExtendSides) -> Void

    public init(sides: ExtendSides, onSides: @escaping (ExtendSides) -> Void) {
        self.sides = sides
        self.onSides = onSides
    }

    public var body: some View {
        ScrollView(.horizontal) {
            HStack(spacing: 8) {
                chip("Extend canvas", on: sides.any) { onSides(sides.any ? .off : .all) }
                if sides.any {
                    chip("Left", on: sides.left) { var s = sides; s.left.toggle(); onSides(s) }
                    chip("Right", on: sides.right) { var s = sides; s.right.toggle(); onSides(s) }
                    chip("Top", on: sides.top) { var s = sides; s.top.toggle(); onSides(s) }
                    chip("Bottom", on: sides.bottom) { var s = sides; s.bottom.toggle(); onSides(s) }
                }
            }
        }
        .scrollIndicators(.hidden)
    }

    private func chip(_ title: String, on: Bool, action: @escaping () -> Void) -> some View {
        Button(title, action: action)
            .buttonStyle(.bordered)
            .tint(on ? .accentColor : .gray)
            .accessibilityAddTraits(on ? .isSelected : [])
    }
}
