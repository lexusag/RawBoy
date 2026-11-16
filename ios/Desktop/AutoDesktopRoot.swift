import RawBoyEngine
import SwiftUI

/** RawBoy Auto in the window: the batch's grid, or one photo in detail (the iOS app's screens, shared). */
struct AutoDesktopRoot: View {
    @ObservedObject var model: DesktopModel
    @ObservedObject var vm: AutoViewModel
    @State private var confirmingClear = false
    @State private var resetting = false
    /** The preset picker is open: for the whole batch (ids nil) or for these photos. */
    @State private var presetPick: PresetPick?

    var body: some View {
        Group {
            if let id = vm.selected {
                DetailScreen(vm: vm, session: vm.session, id: id, pickPreset: { ids in presetPick = PresetPick(ids: ids) })
            } else {
                GridScreen(vm: vm, addFromPhotos: nil, addFromFiles: { model.addPhotosPanel() },
                           addFromFolder: { model.addFolderPanel() }, onClearBatch: { vm.requestClear() },
                           onResetAll: { vm.requestReset() },
                           pickPreset: { ids in presetPick = PresetPick(ids: ids) })
            }
        }
        .toast($vm.message)
        .onChange(of: vm.clearRequest) { _, _ in confirmingClear = true }
        .onChange(of: vm.resetRequest) { _, _ in resetting = true }
        .sheet(isPresented: $resetting) { ResetAllSheet(vm: vm, isPresented: $resetting) }
        .sheet(item: $presetPick) { pick in
            PresetPickerSheet(count: pick.ids?.count, onPick: { p in
                presetPick = nil
                vm.applyChosenPreset(p, to: pick.ids)
            }, onCancel: { presetPick = nil })
        }
        .confirmationDialog(
            vm.photos.count == 1 ? "Remove the photo from the batch?" : "Remove all \(vm.photos.count) photos from the batch?",
            isPresented: $confirmingClear, titleVisibility: .visible) {
            Button(vm.photos.count == 1 ? "Remove 1 photo" : "Remove \(vm.photos.count) photos", role: .destructive) { vm.clearBatch() }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("They only leave the batch: the files, their sidecars and any exported photos stay where they are.")
        }
        .confirmationDialog("Apply a RawBoy preset",
                            isPresented: Binding(get: { !vm.presetChoices.isEmpty }, set: { if !$0 { vm.presetChoices = [] } }),
                            titleVisibility: .visible) {
            // Colour ones first, then black and white ones (a dialog has no headings: they say so in their name).
            ForEach(Presets.sections(vm.presetChoices).flatMap(\.presets)) { p in
                Button(p.isMonochrome ? "B&W · \(p.name)" : p.name) { vm.choosePreset(p) }
            }
            Button("Cancel", role: .cancel) { vm.presetChoices = [] }
        }
    }
}

private struct PresetPick: Identifiable {
    let id = UUID()
    let ids: Set<String>?
}

/**
 * Auto's "Apply RawBoy preset…": the presets saved in Pro (as the web's Auto lists the RawBoy tab's). Preset files are
 * imported in Pro's Presets, so Auto has no file dialog of its own; lens presets aren't listed (they already apply to the
 * photos taken with their lens).
 */
private struct PresetPickerSheet: View {
    let count: Int?
    let onPick: (Preset) -> Void
    let onCancel: () -> Void
    @State private var presets = PresetStore.load().filter { !$0.isLensPreset }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(count.map { $0 == 1 ? "RawBoy preset for 1 photo" : "RawBoy preset for \($0) photos" } ?? "Apply a RawBoy preset")
                .font(.headline)
            if presets.isEmpty {
                Text("No presets saved in Pro yet. Save one in Pro's Presets, or import a preset file there (Pro › Presets › Import…).")
                    .font(.callout).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            } else {
                Text("Your presets from Pro:").font(.callout).foregroundStyle(.secondary)
                ScrollView {
                    VStack(alignment: .leading, spacing: 2) {
                        ForEach(Presets.sections(presets), id: \.label) { section in
                            if let label = section.label {
                                Text(label).font(.caption.weight(.semibold)).foregroundStyle(.secondary).padding(.top, 8)
                            }
                            ForEach(section.presets) { p in
                                Button { onPick(p) } label: {
                                    VStack(alignment: .leading, spacing: 1) {
                                        Text(p.name).font(.body)
                                        Text(PresetGroup.allCases.filter { p.groups.contains($0) }.map(\.label).joined(separator: " · "))
                                            .font(.caption).foregroundStyle(.secondary)
                                    }
                                    .frame(maxWidth: .infinity, alignment: .leading)
                                    .padding(.vertical, 5)
                                    .contentShape(Rectangle())
                                }
                                .buttonStyle(.plain)
                                .accessibilityLabel(p.name)
                            }
                        }
                    }
                }
                .frame(maxHeight: 380)
            }
            HStack {
                Spacer()
                Button("Cancel", role: .cancel, action: onCancel).keyboardShortcut(.cancelAction)
            }
        }
        .padding(20)
        .frame(width: 380)
    }
}
