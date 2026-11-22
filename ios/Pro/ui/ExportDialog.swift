import RawBoyEngine
import SwiftUI

/** Format, quality / bit depth and size of the export. */
struct ExportDialog: View {
    let sourceName: String
    let onExport: (ExportSettings) -> Void
    /** RawBoy Desktop: where the file goes (a section with the folder choice) and the line saying so. */
    var destination: AnyView?
    var destinationNote: String?
    /** A film look is on (the Film tone mapper): the Film scan option applies. */
    var filmLook = false
    /** RawBoy Desktop's batch export: how many photos (1 = the open photo). */
    var count = 1

    @State private var settings: ExportSettings
    @Environment(\.dismiss) private var dismiss

    private static let sizes: [Int?] = [nil, 6000, 4000, 3000, 2048]

    init(initial: ExportSettings, sourceName: String, destination: AnyView? = nil, destinationNote: String? = nil,
         filmLook: Bool = false, count: Int = 1, onExport: @escaping (ExportSettings) -> Void) {
        self.filmLook = filmLook
        self.count = count
        self.sourceName = sourceName
        self.onExport = onExport
        self.destination = destination
        self.destinationNote = destinationNote
        _settings = State(initialValue: initial)
    }

    var body: some View {
        NavigationStack {
            Form {
                Picker("Format", selection: $settings.format) {
                    ForEach(ExportFormat.allCases, id: \.self) { Text($0.rawValue).tag($0) }
                }
                .pickerStyle(.segmented)
                .neutralSegments()
                switch settings.format {
                case .jpeg:
                    Section {
                        VStack(alignment: .leading) {
                            Text("Quality: \(settings.jpegQuality)")
                            Slider(value: Binding(get: { Double(settings.jpegQuality) },
                                                  set: { settings.jpegQuality = Int($0.rounded()) }), in: 1...100)
                        }
                        Picker("Encoder", selection: $settings.jpegEncoder) {
                            Text("jpegli · 16-bit, 4:4:4").tag(JpegEncoder.jpegli)
                            Text("System").tag(JpegEncoder.system)
                        }
                    }
                case .tiff:
                    Picker("Bit depth", selection: $settings.tiffBits) {
                        Text("8-bit").tag(8)
                        Text("16-bit").tag(16)
                    }
                    .pickerStyle(.segmented)
                    .neutralSegments()
                }
                if filmLook {
                    Picker("Film scan", selection: $settings.filmScan) {
                        Text("Off").tag(false)
                        Text("1.5× size").tag(true)
                    }
                    .pickerStyle(.segmented)
                    .neutralSegments()
                    Text(count > 1
                         ? "Photos developed with a film stock are upscaled and their grain grown on a finer pitch, as a finer scan of the negative; the size below doesn't apply to them."
                         : "Upscales the photo and grows the grain on a finer pitch, as a finer scan of the negative. The size below doesn't apply.")
                        .font(.caption).foregroundStyle(.secondary)
                }
                LongSidePicker(size: $settings.maxLongSide, presets: Self.sizes, fullLabel: "Full resolution",
                               presetLabel: { "\($0) px long side" })
                    .disabled(filmLook && settings.filmScan)
                ExportFrameSections(settings: $settings)
                if let destination { Section { destination } }
                Section {
                    Text((destinationNote ?? "Photos › RawBoy › ") + OutputNaming().fileName(OutputNaming.baseNameOf(sourceName),
                                                                                              settings.format.fileExtension)
                         + (count > 1 ? " and \(count - 1) more, each with its own edits" : ""))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            .navigationTitle(count > 1 ? "Export \(count) Photos" : "Export")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Export") {
                        dismiss()
                        onExport(settings)
                    }
                }
            }
        }
        #if os(iOS)
        .presentationDetents([.medium, .large])
        #endif
    }
}
