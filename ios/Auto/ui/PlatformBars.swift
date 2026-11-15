import SwiftUI

/** Toolbar sides and title style that exist on both platforms (the Mac has no top bar or inline titles to choose). */
extension ToolbarItemPlacement {
    static var barLeading: ToolbarItemPlacement {
        #if os(macOS)
        .navigation
        #else
        .topBarLeading
        #endif
    }

    static var barTrailing: ToolbarItemPlacement {
        #if os(macOS)
        .primaryAction
        #else
        .topBarTrailing
        #endif
    }
}

extension View {
    @ViewBuilder func inlineTitle() -> some View {
        #if os(macOS)
        self
        #else
        navigationBarTitleDisplayMode(.inline)
        #endif
    }
}
