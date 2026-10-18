import RawBoyEngine
import SwiftUI
import UniformTypeIdentifiers

@main
struct RawBoyAutoApp: App {
    @StateObject private var vm = AutoViewModel()

    var body: some Scene {
        WindowGroup {
            AutoRoot(vm: vm)
                .preferredColorScheme(.dark)
                .tint(Color(red: 0x80 / 255, green: 0xCB / 255, blue: 0xC4 / 255))
                // Raws opened in RawBoy Auto from Files or shared from another app; a preset sent from RawBoy
                // (rawboy-auto:// link) or a .rawboy.json file opened from Files applies to the batch.
                .onOpenURL { url in
                    if url.scheme == "rawboy-auto" {
                        vm.openPresetLink(url)
                    } else if url.pathExtension.lowercased() == "json" {
                        vm.openPresetFile(url)
                    } else if let copy = try? Imports.copy(url) {
                        vm.add([copy])
                    }
                }
                .task { vm.add(Imports.launchFiles()) }
        }
    }
}

/** Grid of the batch, or one photo in detail. */
struct AutoRoot: View {
    @ObservedObject var vm: AutoViewModel
    @State private var pickingPhotos = false
    @State private var pickingFiles = false
    @State private var pickingPreset = false
    /** The photos the preset being picked is for: nil = the whole batch. */
    @State private var presetTarget: Set<String>?

    var body: some View {
        Group {
            if let id = vm.selected {
                DetailScreen(vm: vm, session: vm.session, id: id)
            } else {
                GridScreen(vm: vm, addFromPhotos: { pickingPhotos = true }, addFromFiles: { pickingFiles = true },
                           pickPreset: { ids in
                               presetTarget = ids
                               pickingPreset = true
                           })
            }
        }
        .toast($vm.message)
        .sheet(isPresented: $pickingPhotos) {
            PhotoPicker { results in
                Task {
                    let (urls, skipped) = await Imports.load(results, acceptDisplay: true)
                    vm.add(urls)
                    if skipped > 0 { vm.message = "\(skipped) photo\(skipped == 1 ? " is" : "s are") not RAW, HEIC, JPEG, PNG or TIFF" }
                }
            }
            .ignoresSafeArea()
        }
        .fileImporter(isPresented: $pickingFiles, allowedContentTypes: photoFileTypes, allowsMultipleSelection: true) { result in
            if case let .success(urls) = result { vm.add(urls.compactMap { try? Imports.copy($0) }) }
        }
        // Two fileImporters on one view don't both work: this one hangs off a background view.
        .background(
            Color.clear.fileImporter(isPresented: $pickingPreset, allowedContentTypes: [.json, .plainText, .data]) { result in
                if case let .success(url) = result { vm.openPresetFile(url, ids: presetTarget) }
            }
        )
        .confirmationDialog("Apply a RawBoy preset",
                            isPresented: Binding(get: { !vm.presetChoices.isEmpty }, set: { if !$0 { vm.presetChoices = [] } }),
                            titleVisibility: .visible) {
            ForEach(vm.presetChoices) { p in Button(p.name) { vm.choosePreset(p) } }
            Button("Cancel", role: .cancel) { vm.presetChoices = [] }
        }
    }
}
