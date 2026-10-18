import RawBoyEngine
import SwiftUI

/** Format, quality / bit depth and size of the export. */
struct ExportDialog: View {
    let sourceName: String
    let onExport: (ExportSettings) -> Void

    @State private var settings: ExportSettings
    @Environment(\.dismiss) private var dismiss

    private static let sizes: [Int?] = [nil, 6000, 4000, 3000, 2048]

    init(initial: ExportSettings, sourceName: String, onExport: @escaping (ExportSettings) -> Void) {
        self.sourceName = sourceName
        self.onExport = onExport
        _settings = State(initialValue: initial)
    }

    var body: some View {
        NavigationStack {
            Form {
                Picker("Format", selection: $settings.format) {
                    ForEach(ExportFormat.allCases, id: \.self) { Text($0.rawValue).tag($0) }
                }
                .pickerStyle(.segmented)
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
                }
                Picker("Size", selection: $settings.maxLongSide) {
                    ForEach(Self.sizes, id: \.self) { s in
                        Text(s.map { "\($0) px long side" } ?? "Full resolution").tag(s)
                    }
                }
                Section {
                    Text("Photos › RawBoy › " + OutputNaming().fileName(OutputNaming.baseNameOf(sourceName),
                                                                       settings.format.fileExtension))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            .navigationTitle("Export")
            .navigationBarTitleDisplayMode(.inline)
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
        .presentationDetents([.medium])
    }
}
