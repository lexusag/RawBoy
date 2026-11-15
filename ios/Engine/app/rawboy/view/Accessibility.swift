import SwiftUI
#if os(macOS)
import AppKit
#else
import UIKit
#endif

/**
 * Reduce Motion: the system setting, read where an animation starts (RawBoy Desktop follows it; so does the iPhone).
 * Nothing in RawBoy moves for its own sake; these are the few fades and scrolls.
 */
public enum Motion {
    public static var reduced: Bool {
        #if os(macOS)
        NSWorkspace.shared.accessibilityDisplayShouldReduceMotion
        #else
        UIAccessibility.isReduceMotionEnabled
        #endif
    }

    /** `withAnimation`, or just the change under Reduce Motion. */
    public static func animate<R>(_ body: () throws -> R) rethrows -> R {
        reduced ? try body() : try withAnimation { try body() }
    }

    /** An ease-out of [seconds], or none under Reduce Motion. */
    public static func easeOut(_ seconds: Double) -> Animation? { reduced ? nil : .easeOut(duration: seconds) }
}

/** The outline and fill of a chip (a mask, a leak, a preset): stronger with Increase Contrast. */
struct ChipStyle: ViewModifier {
    let selected: Bool
    @Environment(\.colorSchemeContrast) private var contrast

    func body(content: Content) -> some View {
        content
            .background(Capsule().fill(selected ? Color.accentColor.opacity(contrast == .increased ? 0.45 : 0.3) : Color.clear))
            .overlay(Capsule().stroke(selected ? Color.accentColor : contrast == .increased ? Color.primary : Color.secondary.opacity(0.5),
                                      lineWidth: contrast == .increased ? 1.5 : 1))
    }
}

public extension View {
    func chipStyle(selected: Bool) -> some View { modifier(ChipStyle(selected: selected)) }

    /**
     * A tappable view that is a real button: VoiceOver says "button" (and "selected"), the keyboard can focus it (Tab with
     * Full Keyboard Access on the Mac, Space acts) and it gets a focus ring, none of which `onTapGesture` gives.
     */
    func tapButton(selected: Bool? = nil, hint: String? = nil, action: @escaping () -> Void) -> some View {
        Button(action: action) { self.contentShape(Rectangle()) }
            .buttonStyle(.plain)
            .accessibilityAddTraits(selected == true ? .isSelected : [])
            .accessibilityHint(hint ?? "")
    }
}
