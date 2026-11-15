import AppKit
import Combine
import RawBoyEngine
import SwiftUI

/** One editor window's worth of state: the view model, its command bus and the sidecar persistence. */
@MainActor
final class DesktopModel: ObservableObject {
    static let shared = DesktopModel()

    let vm = EditorViewModel()
    let commands = EditorCommands()
    let sidecars = SidecarEdits()
    private var bag: Set<AnyCancellable> = []

    private static let folderKey = "desktop.export.folder"

    init() {
        vm.persistence = sidecars
        sidecars.onError = { [weak vm] in vm?.message = $0 }
        commands.exportFolder = UserDefaults.standard.string(forKey: Self.folderKey).map { URL(fileURLWithPath: $0, isDirectory: true) }
        commands.exportHandler = { [weak self] settings in self?.export(settings) }
        commands.exportNote = { [weak self] folder in
            let name = folder?.lastPathComponent ?? self?.vm.currentURL?.deletingLastPathComponent().lastPathComponent ?? "the photo's folder"
            return "\(name) › "
        }
        commands.exportDestination = AnyView(ExportDestinationSection(commands: commands, model: self))
        // The window title follows the photo (the title bar is the only place the whole file name always fits).
        vm.objectWillChange.sink { [weak self] _ in self?.objectWillChange.send() }.store(in: &bag)
        NotificationCenter.default.publisher(for: NSApplication.didResignActiveNotification)
            .sink { [weak self] _ in self?.sidecars.flush() }.store(in: &bag)
    }

    /** Opens [url] in the editor; the file is edited in place (never copied), its sidecar kept beside it. */
    func open(_ url: URL) {
        guard !vm.state.busy else {
            vm.message = "Wait for the photo that is opening or exporting"
            return
        }
        NSDocumentController.shared.noteNewRecentDocumentURL(url)
        vm.open(url)
    }

    /** The folder an export goes to: the chosen one, else the photo's own. */
    var exportDirectory: URL? { commands.exportFolder ?? vm.currentURL?.deletingLastPathComponent() }

    func setExportFolder(_ url: URL?) {
        commands.exportFolder = url
        UserDefaults.standard.set(url?.path, forKey: Self.folderKey)
    }

    func export(_ settings: ExportSettings) {
        guard let dir = exportDirectory else { return }
        vm.export(settings, to: dir)
    }

    // MARK: Open panel

    static let openTypes = photoFileTypes

    func openPanel() {
        let panel = NSOpenPanel()
        panel.allowedContentTypes = Self.openTypes
        panel.allowsMultipleSelection = false
        panel.canChooseDirectories = false
        panel.message = "Choose a photo to develop"
        if panel.runModal() == .OK, let url = panel.url { open(url) }
    }

    func showLastExportInFinder() {
        if let url = vm.lastExport { NSWorkspace.shared.activateFileViewerSelecting([url]) }
    }

    func showSidecarInFinder() {
        guard let url = vm.currentURL else { return }
        let side = PhotoSidecar(photo: url).url
        NSWorkspace.shared.activateFileViewerSelecting([FileManager.default.fileExists(atPath: side.path) ? side : url])
    }
}

/** The export sheet's folder choice: next to the photo, or a folder of your own. */
struct ExportDestinationSection: View {
    @ObservedObject var commands: EditorCommands
    let model: DesktopModel

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Picker("Save to", selection: Binding(
                get: { commands.exportFolder == nil },
                set: { besides in
                    if besides { model.setExportFolder(nil) } else if commands.exportFolder == nil { chooseFolder() }
                })) {
                Text("Next to the photo").tag(true)
                Text("A folder…").tag(false)
            }
            .pickerStyle(.radioGroup)
            if let folder = commands.exportFolder {
                HStack {
                    Text(folder.path).font(.caption).foregroundStyle(.secondary).lineLimit(1).truncationMode(.middle)
                    Spacer()
                    Button("Choose…") { chooseFolder() }.controlSize(.small)
                }
            }
        }
    }

    private func chooseFolder() {
        let panel = NSOpenPanel()
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.canCreateDirectories = true
        panel.prompt = "Export here"
        if panel.runModal() == .OK, let url = panel.url { model.setExportFolder(url) }
    }
}
