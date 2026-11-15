import RawBoyEngine
import SwiftUI

/** RawBoy Auto in the window: the batch's grid, or one photo in detail (the iOS app's screens, shared). */
struct AutoDesktopRoot: View {
    @ObservedObject var model: DesktopModel
    @ObservedObject var vm: AutoViewModel
    @State private var confirmingClear = false

    var body: some View {
        Group {
            if let id = vm.selected {
                DetailScreen(vm: vm, session: vm.session, id: id, pickPreset: { ids in model.choosePresetFile(for: ids) })
            } else {
                GridScreen(vm: vm, addFromPhotos: nil, addFromFiles: { model.addPhotosPanel() },
                           addFromFolder: { model.addFolderPanel() }, onClearBatch: { vm.requestClear() },
                           pickPreset: { ids in model.choosePresetFile(for: ids) })
            }
        }
        .toast($vm.message)
        .onChange(of: vm.clearRequest) { _, _ in confirmingClear = true }
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
