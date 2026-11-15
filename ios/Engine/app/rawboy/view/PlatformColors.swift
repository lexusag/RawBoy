import SwiftUI

/** The two system greys the curve box and a few panels use, on both platforms (UIKit's names have no SwiftUI static on macOS). */
public extension Color {
    static var rbGray4: Color {
        #if canImport(UIKit)
        Color(.systemGray4)
        #else
        Color(nsColor: .systemGray).opacity(0.55)
        #endif
    }

    static var rbSecondaryBackground: Color {
        #if canImport(UIKit)
        Color(.secondarySystemBackground)
        #else
        Color(nsColor: .controlBackgroundColor)
        #endif
    }

    static var rbBackground: Color {
        #if canImport(UIKit)
        Color(.systemBackground)
        #else
        Color(nsColor: .windowBackgroundColor)
        #endif
    }
}
