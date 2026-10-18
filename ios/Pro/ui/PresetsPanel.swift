import RawBoyEngine
import SwiftUI
import UniformTypeIdentifiers

/**
 * Opened from the top bar in place of the slider tabs: saved presets (tap to apply, menu to update, rename,
 * export, send to Auto or delete) and saving the current edits as a new one.
 */
struct PresetsPanel: View {
    @ObservedObject var vm: EditorViewModel
    let onDone: () -> Void
    /** The photo has brush strokes (which presets don't keep): the save dialog says so. */
    let hasStrokes: Bool

    @State private var saving = false
    @State private var renaming: Preset?
    @State private var renameText = ""
    @State private var deleting: Preset?
    @State private var importing = false
    @State private var sharing: URL?

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text("Presets").font(.headline)
                Spacer()
                Button("Done", action: onDone).fontWeight(.semibold)
            }
            HStack(spacing: 12) {
                Button("Save current…") { saving = true }.buttonStyle(.bordered)
                Button("Import") { importing = true }
                Button("Export all") { sharing = vm.presetFile(vm.presets) }.disabled(vm.presets.isEmpty)
            }
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    if vm.presets.isEmpty {
                        Note("No presets yet. Save the current edits (any groups of sliders) to reuse them on other photos. Rotation, flips, straightening and crop are never part of a preset.")
                    }
                    ForEach(vm.presets) { p in row(p) }
                }
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 8)
        .sheet(isPresented: $saving) {
            SavePresetSheet(hasStrokes: hasStrokes) { name, groups in vm.savePreset(name, groups) }
        }
        .alert("Rename preset", isPresented: Binding(get: { renaming != nil }, set: { if !$0 { renaming = nil } })) {
            TextField("Name", text: $renameText)
            Button("Rename") { if let p = renaming, !renameText.trimmingCharacters(in: .whitespaces).isEmpty { vm.renamePreset(p.id, renameText) } }
            Button("Cancel", role: .cancel) {}
        }
        .alert("Delete “\(deleting?.name ?? "")”?", isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } })) {
            Button("Delete", role: .destructive) { if let p = deleting { vm.deletePreset(p.id) } }
            Button("Cancel", role: .cancel) {}
        }
        .fileImporter(isPresented: $importing, allowedContentTypes: [.json, .plainText, .data]) { result in
            if case let .success(url) = result { vm.importPresets(url) }
        }
        .sheet(item: Binding(get: { sharing.map(ShareItem.init) }, set: { sharing = $0?.url })) { item in
            ShareSheet(items: [item.url])
        }
    }

    private func row(_ p: Preset) -> some View {
        HStack {
            VStack(alignment: .leading, spacing: 1) {
                Text(p.name).font(.subheadline).lineLimit(1)
                Text(PresetGroup.allCases.filter { p.groups.contains($0) }.map(\.label).joined(separator: " · "))
                    .font(.caption).foregroundStyle(.secondary).lineLimit(1)
            }
            Spacer()
            Menu {
                Button("Update from current") { vm.updatePreset(p.id) }
                Button("Rename") {
                    renameText = p.name
                    renaming = p
                }
                Button("Export") { sharing = vm.presetFile([p]) }
                Button("Send to Auto") { vm.sendPresetToAuto(p) }
                Button("Delete", role: .destructive) { deleting = p }
            } label: {
                Image(systemName: "ellipsis").frame(width: 36, height: 36)
            }
            .accessibilityLabel("Preset options")
        }
        .padding(.vertical, 4)
        .contentShape(Rectangle())
        .onTapGesture { vm.applyPreset(p) }
    }
}

private struct SavePresetSheet: View {
    let hasStrokes: Bool
    let onSave: (String, Set<PresetGroup>) -> Void

    @State private var name = ""
    @State private var groups = PresetGroup.defaultGroups
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Form {
                TextField("Name", text: $name)
                Section("Include") {
                    ForEach(PresetGroup.allCases, id: \.self) { g in
                        Toggle(g.label, isOn: Binding(get: { groups.contains(g) }, set: { on in
                            if on { groups.insert(g) } else { groups.remove(g) }
                        }))
                    }
                    if hasStrokes && groups.contains(.masks) {
                        Note("Brush strokes aren't saved in presets: they belong to this photo.")
                    }
                }
            }
            .navigationTitle("Save preset")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        onSave(name, groups)
                        dismiss()
                    }
                    .disabled(name.trimmingCharacters(in: .whitespaces).isEmpty || groups.isEmpty)
                }
            }
        }
    }
}

struct ShareItem: Identifiable {
    let url: URL
    var id: String { url.path }
}

/** The system share sheet (save to Files, AirDrop, …): where exported preset files go. */
struct ShareSheet: UIViewControllerRepresentable {
    let items: [Any]

    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: items, applicationActivities: nil)
    }

    func updateUIViewController(_ controller: UIActivityViewController, context: Context) {}
}
