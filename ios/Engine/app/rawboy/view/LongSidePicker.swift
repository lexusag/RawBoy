import SwiftUI

/**
 * Export size: one of `presets` (nil = `fullLabel`) or a custom long side typed in pixels. Only a valid custom value
 * reaches `size` (`ExportSettings.parseLongSide`); an invalid one shows the allowed range and keeps the last good size.
 */
public struct LongSidePicker: View {
    let title: String
    @Binding var size: Int?
    let presets: [Int?]
    let fullLabel: String
    let presetLabel: (Int) -> String

    @State private var custom: Bool
    @State private var text: String

    private static let customTag = -1

    public init(_ title: String = "Size", size: Binding<Int?>, presets: [Int?], fullLabel: String,
                presetLabel: @escaping (Int) -> String = { "\($0) px" }) {
        self.title = title
        _size = size
        self.presets = presets
        self.fullLabel = fullLabel
        self.presetLabel = presetLabel
        let isCustom = size.wrappedValue.map { !presets.contains($0) } ?? false
        _custom = State(initialValue: isCustom)
        _text = State(initialValue: isCustom ? String(size.wrappedValue ?? 0) : "")
    }

    private var invalid: Bool { custom && !text.isEmpty && ExportSettings.parseLongSide(text) == nil }

    public var body: some View {
        Picker(title, selection: Binding<Int?>(
            get: { custom ? Self.customTag : size },
            set: { choice in
                if choice == Self.customTag {
                    custom = true
                    text = size.map(String.init) ?? ""
                } else {
                    custom = false
                    size = choice
                }
            })) {
            ForEach(presets, id: \.self) { s in
                Text(s.map(presetLabel) ?? fullLabel).tag(s)
            }
            Text("Custom\u{2026}").tag(Int?.some(Self.customTag))
        }
        if custom {
            HStack {
                TextField("Long side, px", text: $text)
                    #if os(iOS)
                    .keyboardType(.numberPad)
                    #endif
                    .multilineTextAlignment(.trailing)
                    .onChange(of: text) { _, new in
                        let digits = String(new.filter { $0.isASCII && $0.isNumber }.prefix(6))
                        if digits != new { text = digits; return }
                        if let n = ExportSettings.parseLongSide(digits) { size = n }
                    }
                Text("px").foregroundStyle(.secondary)
            }
            if invalid {
                Text("\(ExportSettings.longSideRange.lowerBound)\u{2013}\(ExportSettings.longSideRange.upperBound) px")
                    .font(.caption).foregroundStyle(.red)
            }
        }
    }
}
