import AppKit
import Combine
import RawBoyEngine
import SwiftUI
import UniformTypeIdentifiers

/** The window's two ways of working: one photo in the full editor, or a batch developed automatically. */
enum AppMode: String { case pro, auto }

/** One editor window's worth of state: the view models, the command bus and the sidecar persistence. */
@MainActor
final class DesktopModel: ObservableObject {
    static let shared = DesktopModel()

    let vm = EditorViewModel()
    let commands = EditorCommands()
    let sidecars = SidecarEdits()
    /** RawBoy Auto's batch, with its settings in `rawboy:Auto` sidecars. */
    let auto = AutoViewModel()
    let autoSidecars = SidecarAuto()
    @Published var mode = AppMode(rawValue: UserDefaults.standard.string(forKey: "desktop.mode") ?? "") ?? .pro {
        didSet {
            UserDefaults.standard.set(mode.rawValue, forKey: "desktop.mode")
            sidecars.flush()
            autoSidecars.flush()
        }
    }
    private var bag: Set<AnyCancellable> = []

    private static let folderKey = "desktop.export.folder"

    init() {
        vm.persistence = sidecars
        sidecars.onError = { [weak vm] in vm?.message = $0 }
        auto.persistence = autoSidecars
        autoSidecars.onError = { [weak auto] message in Task { @MainActor in auto?.message = message } }
        auto.saveExported = { [weak self] file, source in try self?.saveAutoExport(file, source: source) }
        auto.destinationView = AnyView(ExportDestinationSection(commands: commands, model: self))
        auto.editInPro = { [weak self] photo in self?.open(photo.url) }
        commands.sendToAuto = { [weak self] in self?.sendToAuto() }
        updateAutoDestination()
        commands.exportFolder = UserDefaults.standard.string(forKey: Self.folderKey).map { URL(fileURLWithPath: $0, isDirectory: true) }
        commands.exportHandler = { [weak self] settings in self?.export(settings) }
        commands.exportNote = { [weak self] folder in
            let name = folder?.lastPathComponent ?? self?.vm.currentURL?.deletingLastPathComponent().lastPathComponent ?? "the photo's folder"
            return "\(name) › "
        }
        commands.exportDestination = AnyView(ExportDestinationSection(commands: commands, model: self))
        // The window title follows the photo (the title bar is the only place the whole file name always fits).
        vm.objectWillChange.sink { [weak self] _ in self?.objectWillChange.send() }.store(in: &bag)
        auto.objectWillChange.sink { [weak self] _ in self?.objectWillChange.send() }.store(in: &bag)
        NotificationCenter.default.publisher(for: NSApplication.didResignActiveNotification)
            .sink { [weak self] _ in
                self?.sidecars.flush()
                self?.autoSidecars.flush()
            }.store(in: &bag)
    }

    /** Opens [url] in the editor; the file is edited in place (never copied), its sidecar kept beside it. */
    func open(_ url: URL) {
        guard !vm.state.busy else {
            vm.message = "Wait for the photo that is opening or exporting"
            return
        }
        // A photo handed over (Finder, RawBoy Viewer) is for the editor, whichever mode the window was in; Auto's batch stays.
        mode = .pro
        NSDocumentController.shared.noteNewRecentDocumentURL(url)
        vm.open(url)
    }

    /** The folder an export goes to: the chosen one, else the photo's own. */
    var exportDirectory: URL? { commands.exportFolder ?? vm.currentURL?.deletingLastPathComponent() }

    func setExportFolder(_ url: URL?) {
        commands.exportFolder = url
        UserDefaults.standard.set(url?.path, forKey: Self.folderKey)
        updateAutoDestination()
    }

    private func updateAutoDestination() {
        auto.destinationLabel = commands.exportFolder.map { "\($0.lastPathComponent) (\($0.path))" } ?? "the folder of each photo"
    }

    /** Auto's exported [file] goes to the chosen folder, else the photo's own; an existing file of that name is replaced. */
    private func saveAutoExport(_ file: URL, source: URL) throws {
        let dir = commands.exportFolder ?? source.deletingLastPathComponent()
        let target = dir.appendingPathComponent(file.lastPathComponent)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        if FileManager.default.fileExists(atPath: target.path) { try FileManager.default.removeItem(at: target) }
        try FileManager.default.moveItem(at: file, to: target)
        lastAutoExport = target
    }

    /** The last file Auto exported, for "Show in Finder". */
    private(set) var lastAutoExport: URL?

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

    // MARK: Moving a photo between Pro and Auto

    /** The Auto photo "Edit in Pro" means: the open one, else the only selected one, else the focused one. */
    var autoPhotoForPro: AutoPhoto? {
        if let id = auto.selected { return auto.photo(id) }
        if auto.selection.count == 1, let id = auto.selection.first { return auto.photo(id) }
        return auto.focusedId.flatMap(auto.photo)
    }

    func editInPro() {
        guard let photo = autoPhotoForPro else {
            auto.message = "Select a photo to edit in Pro"
            return
        }
        open(photo.url)
    }

    /** The photo open in the editor joins Auto's batch (once) and Auto shows it. */
    func sendToAuto() {
        guard let url = vm.currentURL else {
            vm.message = "Open a photo first"
            return
        }
        sidecars.flush()
        addToAuto([url])
        auto.focusedId = url.path
        auto.selectionAnchor = url.path
    }

    // MARK: Auto: adding photos

    /** The photo files among [urls], folders searched (hidden files and packages skipped), in name order within a folder. */
    static func photoFiles(in urls: [URL]) -> [URL] {
        func isPhoto(_ u: URL) -> Bool {
            guard let t = UTType(filenameExtension: u.pathExtension.lowercased()) else { return false }
            // Not photoFileTypes' catch-all `.data` (some providers report raws as plain data): a folder holds notes and sidecars too.
            return photoFileTypes.contains { $0 != .data && t.conforms(to: $0) }
        }
        var out: [URL] = []
        for url in urls {
            var isDirectory: ObjCBool = false
            guard FileManager.default.fileExists(atPath: url.path, isDirectory: &isDirectory) else { continue }
            if isDirectory.boolValue {
                let files = FileManager.default.enumerator(at: url, includingPropertiesForKeys: nil,
                                                           options: [.skipsHiddenFiles, .skipsPackageDescendants])
                out += (files?.compactMap { $0 as? URL } ?? []).filter(isPhoto).sorted { $0.path < $1.path }
            } else if isPhoto(url) {
                out.append(url)
            }
        }
        return out
    }

    /** Adds [urls] (files and folders) to Auto's batch and shows Auto. */
    func addToAuto(_ urls: [URL]) {
        let files = Self.photoFiles(in: urls)
        mode = .auto
        if files.isEmpty {
            auto.message = "No RAW, HEIC, JPEG, PNG or TIFF photos there"
            return
        }
        files.forEach { NSDocumentController.shared.noteNewRecentDocumentURL($0) }
        auto.add(files)
    }

    func addPhotosPanel() {
        let panel = NSOpenPanel()
        panel.allowedContentTypes = Self.openTypes
        panel.allowsMultipleSelection = true
        panel.canChooseDirectories = false
        panel.message = "Choose photos to develop"
        if panel.runModal() == .OK { addToAuto(panel.urls) }
    }

    func addFolderPanel() {
        let panel = NSOpenPanel()
        panel.canChooseFiles = false
        panel.canChooseDirectories = true
        panel.allowsMultipleSelection = true
        panel.message = "Choose folders of photos to develop"
        if panel.runModal() == .OK { addToAuto(panel.urls) }
    }

    /** A RawBoy preset file for the batch (nil) or for the photos in [ids]. */
    func choosePresetFile(for ids: Set<String>?) {
        let panel = NSOpenPanel()
        panel.allowedContentTypes = [.json, .plainText, .data]
        panel.allowsMultipleSelection = false
        panel.message = "Choose a RawBoy preset file (.rawboy.json)"
        if panel.runModal() == .OK, let url = panel.url { auto.openPresetFile(url, ids: ids) }
    }

    func showLastExportInFinder() {
        if mode == .auto, let url = lastAutoExport {
            NSWorkspace.shared.activateFileViewerSelecting([url])
            return
        }
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
