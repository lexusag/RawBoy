import RawBoyEngine
import SwiftUI

@main
struct RawBoyProApp: App {
    @StateObject private var vm = EditorViewModel()

    var body: some Scene {
        WindowGroup {
            ProRoot(vm: vm)
                .preferredColorScheme(.dark)
                .tint(Color(red: 0xFF / 255, green: 0xB7 / 255, blue: 0x4D / 255))
                // A raw opened in RawBoy from Files or shared from another app.
                .onOpenURL { url in
                    if let copy = try? Imports.copy(url) { vm.open(copy) }
                }
                .task {
                    if let first = Imports.launchFiles().first { vm.open(first) }
                }
        }
    }
}

struct ProRoot: View {
    @ObservedObject var vm: EditorViewModel
    @State private var pickingPhotos = false
    @State private var pickingFiles = false

    var body: some View {
        EditorScreen(vm: vm, session: vm.session, openFromPhotos: { pickingPhotos = true },
                     openFromFiles: { pickingFiles = true })
            .toast($vm.message)
            .sheet(isPresented: $pickingPhotos) {
                PhotoPicker(selectionLimit: 1) { results in
                    Task {
                        let (urls, skipped) = await Imports.load(results, acceptDisplay: true)
                        if let url = urls.first { vm.open(url) } else if skipped > 0 { vm.message = "This photo is not RAW, HEIC, JPEG, PNG or TIFF" }
                    }
                }
                .ignoresSafeArea()
            }
            .fileImporter(isPresented: $pickingFiles, allowedContentTypes: photoFileTypes) { result in
                if case let .success(url) = result, let copy = try? Imports.copy(url) { vm.open(copy) }
            }
    }
}
