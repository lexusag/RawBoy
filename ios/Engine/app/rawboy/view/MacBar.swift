#if os(macOS)
import SwiftUI

/**
 * RawBoy Desktop's shared chrome, so Pro and Auto's photo view look like one app: the one-row bar's buttons (an icon with
 * a word under it) and the side panel's collapsible sections.
 */

/** An icon with a word under it: the icons alone weren't obvious, and arrow.counterclockwise read as reload. */
public struct BarToolLabel: View {
    let icon: String
    let label: String

    public init(icon: String, label: String) {
        self.icon = icon
        self.label = label
    }

    public var body: some View {
        VStack(spacing: 2) {
            Image(systemName: icon).font(.title3).frame(height: 24)
            Text(label).font(.system(size: 10, weight: .medium)).lineLimit(1).fixedSize()
        }
    }
}

/** The bar's buttons: white icons (amber only for [primary], the bar's one main action), dimmed when disabled. */
public struct BarButtonStyle: ButtonStyle {
    let primary: Bool
    @Environment(\.isEnabled) private var enabled

    public init(primary: Bool = false) { self.primary = primary }

    public func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .foregroundStyle(primary ? Color.accentColor : Color.primary)
            .opacity(!enabled ? 0.35 : configuration.isPressed ? 0.5 : 1)
            .contentShape(Rectangle())
    }
}

/** A bar button: [BarToolLabel] in [BarButtonStyle], with [name] as its tooltip and spoken label. */
public struct BarTool: View {
    let icon: String
    let label: String
    let name: String
    let primary: Bool
    let action: () -> Void

    public init(_ icon: String, _ label: String, _ name: String, primary: Bool = false, action: @escaping () -> Void) {
        self.icon = icon
        self.label = label
        self.name = name
        self.primary = primary
        self.action = action
    }

    public var body: some View {
        Button(action: action) { BarToolLabel(icon: icon, label: label) }
            .buttonStyle(BarButtonStyle(primary: primary))
            .help(name)
            .accessibilityLabel(name)
    }
}

/**
 * A side panel section: its header (chevron, name, an amber dot when [edited], a reset for just this section) and,
 * while [open], its controls, then a hairline. Clicking the header opens or closes it.
 */
public struct InspectorSection<Content: View>: View {
    let title: String
    let open: Bool
    let edited: Bool
    let onToggle: () -> Void
    let onReset: (() -> Void)?
    let content: Content

    public init(_ title: String, open: Bool, edited: Bool, onToggle: @escaping () -> Void, onReset: (() -> Void)?,
                @ViewBuilder content: () -> Content) {
        self.title = title
        self.open = open
        self.edited = edited
        self.onToggle = onToggle
        self.onReset = onReset
        self.content = content()
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 6) {
                Image(systemName: "chevron.right")
                    .font(.system(size: 9, weight: .bold))
                    .foregroundStyle(.secondary)
                    .rotationEffect(.degrees(open ? 90 : 0))
                    .frame(width: 12)
                Text(title).font(.subheadline.weight(.semibold))
                if edited {
                    Circle().fill(Color.accentColor).frame(width: 6, height: 6).help("\(title) has edits")
                }
                Spacer(minLength: 0)
                if edited, let onReset {
                    Button(action: onReset) {
                        Image(systemName: "arrow.counterclockwise").font(.caption)
                    }
                    .buttonStyle(.borderless)
                    .foregroundStyle(.secondary)
                    .help("Reset \(title)")
                    .accessibilityLabel("Reset \(title)")
                }
            }
            .frame(height: 32)
            .contentShape(Rectangle())
            .onTapGesture(perform: onToggle)
            .accessibilityElement(children: .contain)
            .accessibilityLabel(title + (edited ? ", edited" : ""))
            .accessibilityValue(open ? "open" : "closed")
            .accessibilityAddTraits([.isHeader, .isButton])
            .accessibilityAction { onToggle() }
            if open {
                VStack(alignment: .leading, spacing: 0) { content }
                    .padding(.bottom, 10)
            }
            Divider()
        }
    }
}

/** Which sections are closed, kept as a comma list in UserDefaults under the panel's own key. */
public enum InspectorSections {
    public static func closed(_ stored: String) -> Set<String> { Set(stored.split(separator: ",").map(String.init)) }

    /** [stored] with [title] opened or closed. */
    public static func toggled(_ stored: String, _ title: String) -> String {
        var c = closed(stored)
        if c.contains(title) { c.remove(title) } else { c.insert(title) }
        return c.sorted().joined(separator: ",")
    }
}
#endif
