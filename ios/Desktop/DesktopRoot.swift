import AppKit
import RawBoyEngine
import SwiftUI
import UniformTypeIdentifiers

/** The window's content: the editor, a drop target for photos, the toast and the window title. */
struct DesktopRoot: View {
    @ObservedObject var model: DesktopModel
    @State private var dropping = false

    var body: some View {
        EditorScreen(vm: model.vm, session: model.vm.session, openFromPhotos: nil, openFromFiles: { model.openPanel() },
                     commands: model.commands)
            .toast(Binding(get: { model.vm.message }, set: { model.vm.message = $0 }))
            .navigationTitle(model.vm.state.fileName ?? "RawBoy Desktop")
            .overlay {
                if dropping {
                    RoundedRectangle(cornerRadius: 12).strokeBorder(Color.accentColor, lineWidth: 3).padding(6).allowsHitTesting(false)
                }
            }
            .onDrop(of: [.fileURL], isTargeted: $dropping) { providers in
                guard let provider = providers.first else { return false }
                _ = provider.loadObject(ofClass: URL.self) { url, _ in
                    if let url { Task { @MainActor in model.open(url) } }
                }
                return true
            }
            .background(WindowSetup())
    }
}

/** Window details SwiftUI has no modifier for. */
private struct WindowSetup: NSViewRepresentable {
    func makeNSView(context: Context) -> NSView {
        let v = NSView()
        DispatchQueue.main.async { v.window?.acceptsMouseMovedEvents = true }
        return v
    }

    func updateNSView(_ view: NSView, context: Context) {}
}
