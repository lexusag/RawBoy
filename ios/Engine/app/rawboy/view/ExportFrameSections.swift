import SwiftUI

/**
 * Shared frame and date-stamp controls for the Pro and Auto export sheets (`Form` sections).
 * Mirrors Android's `ExportFrameControls.kt`.
 */
public struct ExportFrameSections: View {
    @Binding public var settings: ExportSettings

    public init(settings: Binding<ExportSettings>) {
        self._settings = settings
    }

    private var orderedFields: [Pentax645Field] {
        let exportSet = Pentax645Field.exportDefaultSet
        var list = settings.pentax645Order.filter { exportSet.contains($0) }
        for f in Pentax645Field.exportFields where !list.contains(f) {
            list.append(f)
        }
        return list
    }

    public var body: some View {
        Section {
            Picker("Frame", selection: $settings.photoFrame) {
                ForEach(PhotoFrame.allCases, id: \.self) { frame in
                    Text(frame.label).tag(frame)
                }
            }
            if settings.photoFrame == .dateStamp {
                Picker("Style", selection: $settings.dateStampStyle) {
                    ForEach(DateStampStyle.allCases, id: \.self) { style in
                        Text(style.label).tag(style)
                    }
                }
                Picker("Date format", selection: Binding(
                    get: { settings.dateStampFormat == .mmmYy ? .dmy : settings.dateStampFormat },
                    set: { settings.dateStampFormat = $0 }
                )) {
                    ForEach([DateStampFormat.dmy, .ymd, .mdy], id: \.self) { fmt in
                        Text(fmt.label).tag(fmt)
                    }
                }
            }
            if settings.photoFrame == .pentax645 || settings.photoFrame == .contax645 {
                Picker("Color", selection: $settings.frameColor) {
                    ForEach(FilmFrameColor.allCases, id: \.self) { color in
                        Text(color.label).tag(color)
                    }
                }
                Toggle(isOn: $settings.pentax645Flip) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Flip info upside down")
                        Text("Rotate shoot info 180° like on real film").font(.caption).foregroundStyle(.secondary)
                    }
                }
                if settings.pentax645Fields.contains(.date) {
                    Picker("Date format", selection: $settings.dateStampFormat) {
                        ForEach(DateStampFormat.allCases, id: \.self) { fmt in
                            Text(fmt.label).tag(fmt)
                        }
                    }
                }
                if settings.pentax645Fields.contains(.time) {
                    Picker("Time format", selection: $settings.timeStampFormat) {
                        ForEach(TimeStampFormat.allCases, id: \.self) { fmt in
                            Text(fmt.label).tag(fmt)
                        }
                    }
                }
            }
        }
        if settings.photoFrame == .pentax645 || settings.photoFrame == .contax645 {
            Section("Shoot info (drag to reorder)") {
                ForEach(orderedFields, id: \.self) { field in
                    Toggle(field.label, isOn: Binding(
                        get: { settings.pentax645Fields.contains(field) },
                        set: { on in
                            if on { settings.pentax645Fields.insert(field) }
                            else { settings.pentax645Fields.remove(field) }
                        }
                    ))
                }
                .onMove { source, destination in
                    var next = orderedFields
                    next.move(fromOffsets: source, toOffset: destination)
                    settings.pentax645Order = next
                }
            }
            .environment(\.editMode, .constant(.active))
        }
    }
}
