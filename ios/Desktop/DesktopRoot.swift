import AppKit
import RawBoyEngine
import SwiftUI
import UniformTypeIdentifiers

/** The window's content: the editor, a drop target for photos, the toast and the window title. */
struct DesktopRoot: View {
    @ObservedObject var model: DesktopModel
    @State private var dropping = false

    var body: some View {
        Group {
            switch model.mode {
            case .pro:
                EditorScreen(vm: model.vm, session: model.vm.session, openFromPhotos: nil, openFromFiles: { model.openPanel() },
                             commands: model.commands)
                    .toast(Binding(get: { model.vm.message }, set: { model.vm.message = $0 }))
            case .auto:
                AutoDesktopRoot(model: model, vm: model.auto)
            }
        }
        .navigationTitle(title)
        .toolbar {
            // The mode switch: one photo in the full editor, or a batch developed automatically.
            ToolbarItem(placement: .principal) {
                Picker("Mode", selection: $model.mode) {
                    Text("Pro").tag(AppMode.pro)
                    Text("Auto").tag(AppMode.auto)
                }
                .pickerStyle(.segmented)
                .frame(width: 130)
                .help("Pro edits one photo (⌘1); Auto develops a batch (⌘2)")
            }
        }
        .overlay {
            if dropping {
                RoundedRectangle(cornerRadius: 12).strokeBorder(Color.accentColor, lineWidth: 3).padding(6).allowsHitTesting(false)
            }
        }
        .onDrop(of: [.fileURL], isTargeted: $dropping) { providers in
            guard !providers.isEmpty else { return false }
            Task { @MainActor in
                var urls: [URL] = []
                for provider in providers {
                    if let url = await Self.fileURL(provider) { urls.append(url) }
                }
                guard !urls.isEmpty else { return }
                // Auto takes any number of photos and folders; Pro opens the first photo.
                if model.mode == .auto || urls.count > 1 || urls[0].hasDirectoryPath {
                    model.addToAuto(urls)
                } else {
                    model.open(urls[0])
                }
            }
            return true
        }
        .background(WindowSetup())
    }

    private var title: String {
        switch model.mode {
        case .pro: model.vm.state.fileName ?? "RawBoy Desktop"
        case .auto: model.auto.selected.flatMap { model.auto.photo($0)?.name } ?? "RawBoy Auto"
        }
    }

    private static func fileURL(_ provider: NSItemProvider) async -> URL? {
        await withCheckedContinuation { continuation in
            _ = provider.loadObject(ofClass: URL.self) { url, _ in continuation.resume(returning: url) }
        }
    }
}
