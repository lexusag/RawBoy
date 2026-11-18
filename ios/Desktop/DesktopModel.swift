import AppKit
import Combine
import RawBoyEngine
import SwiftUI
import UniformTypeIdentifiers
import ViewerUI
import struct RawBoyBrowseKit.PhotoSidecar
import enum RawBoyBrowseKit.XmpSidecar

/**
 * The window's three ways of working: one photo in the full editor, a batch developed automatically, or browsing a
 * folder (RawBoy Viewer's grid, viewer and culling, hosted here).
 */
enum AppMode: String { case pro, auto, browse }

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
    /** Pro's filmstrip: the open photo's folder. */
    let filmstrip = Filmstrip()
    /** Pro's batch export: the photos picked in the filmstrip, each with its own edits. */
    let batchExport = ProBatchExport()
    /**
     * Browse mode: RawBoy Viewer's browser and viewer (`ViewerUI`), owned here. Its choices (sort, sizes, favourites,
     * export options...) are kept under `desktop.browse.` in the preferences, never the standalone Viewer's keys; it
     * hides neither the menu bar nor the Dock; the viewer is a view in this window, not a borderless one of its own.
     */
    let browse: AppModel = {
        ViewerSettings.store = UserDefaultsSettings(prefix: "desktop.browse.")
        // Real previews (R, Compare) are the engine's as-shot develop, as Pro opens the photo.
        ViewerHost.realPreview = EngineRealPreview()
        // The viewer is a view in this window unless the Browse setting asks for the screen-filling one, which then hides
        // the menu bar and Dock while it is the key window (never the in-window one); either opens on this window's display.
        var options = ViewerOptions()
        options.hidesDockAndMenuBar = true
        options.opensOnHostScreen = true
        // The Pro / Auto / Browse switch sits in the window's toolbar area, over the top of the browser's own toolbar.
        options.toolbarTopInset = 14
        options.viewerInHostWindow = !ViewerSettings.store.bool(forKey: DesktopModel.immersiveKey)
        return AppModel(options: options)
    }()

    /**
     * The bundled Viewer's Settings › Interface size (its `SettingsKeys.uiScale`, under `desktop.browse.`): Browse scales
     * itself, and Pro, Auto and the Packer follow it through `EnvironmentValues.interfaceScale`.
     */
    static let interfaceScaleKey = "app.uiScale"
    /** The interface size now (1 = as designed), updated as soon as the setting changes. */
    @Published private(set) var interfaceScale = DesktopModel.storedInterfaceScale

    private static var storedInterfaceScale: CGFloat {
        let s = ViewerSettings.store.double(forKey: interfaceScaleKey)
        return s >= 0.5 && s <= 2 ? s : 1  // as the Viewer reads it: unset (0) or out of range = as designed
    }

    /** The Browse setting key (under `desktop.browse.`): the viewer opens as the screen-filling window. */
    static let immersiveKey = "viewer.immersive"

    /** Browse's viewer and Compare open in a screen-filling window of their own (Mode menu › Full-Screen Viewer), else in this window. */
    @Published var immersiveViewer = ViewerSettings.store.bool(forKey: DesktopModel.immersiveKey) {
        didSet {
            ViewerSettings.store.set(immersiveViewer, forKey: Self.immersiveKey)
            browse.options.viewerInHostWindow = !immersiveViewer
        }
    }
    /** Every launch starts in Browse (the last mode is not remembered); a photo handed over by Finder or `--open` switches to Pro. */
    @Published var mode: AppMode = .browse {
        didSet {
            sidecars.flush()
            autoSidecars.flush()
            browse.writePendingNow()
            // A window of Browse's own must not stay over the other modes (or their menus and keys).
            if oldValue == .browse && mode != .browse { browse.closeOwnWindows() }
        }
    }
    private var bag: Set<AnyCancellable> = []

    /** What quitting now would cut short or lose (see `QuitWork`); asked by the app delegate before it terminates. */
    var quitWork: QuitWork {
        var w = QuitWork()
        w.proExporting = vm.state.exporting
        w.proBatchExporting = batchExport.running
        w.proAutoRunning = vm.state.autoRunning
        w.unsavedEditsOf = sidecars.unsavedPhoto?.lastPathComponent
        w.autoExporting = auto.export != nil
        w.autoPhotosInProgress = auto.photos.filter { [.queued, .analyzing, .exporting].contains($0.status) }.count
        w.packerRunning = PackerModel.shared.running
        return w
    }

    private static let folderKey = "desktop.export.folder"

    init() {
        // Photos the viewer or the browser hand over open here, with no round trip through the system.
        ViewerHost.handOff = DesktopHandOff(model: self)
        vm.persistence = sidecars
        sidecars.onError = { [weak vm] in vm?.message = $0 }
        auto.persistence = autoSidecars
        // Each photo's analysis stays on disk (Caches), so a folder opened again isn't decoded again; RAWBOY_NO_ANALYSIS_CACHE=1 turns it off.
        if ProcessInfo.processInfo.environment["RAWBOY_NO_ANALYSIS_CACHE"] == nil { auto.analysisCache = AnalysisCache(dir: AnalysisCache.defaultDir) }
        autoSidecars.onError = { [weak auto] message in Task { @MainActor in auto?.message = message } }
        auto.saveExported = { [weak self] file, source in try self?.saveAutoExport(file, source: source) ?? file.lastPathComponent }
        auto.destinationView = AnyView(ExportDestinationSection(commands: commands, model: self))
        auto.editInPro = { [weak self] photo in self?.editInPro(photo) }
        commands.sendToAuto = { [weak self] in self?.sendToAuto() }
        vm.presetToAuto = { [weak self] preset in
            guard let self else { return }
            // Pro and Auto share the presets file, so a lens preset is in Auto's list already: this applies it and shows Auto.
            self.mode = .auto
            self.auto.applyChosenPreset(preset, to: nil)
        }
        updateAutoDestination()
        commands.exportFolder = UserDefaults.standard.string(forKey: Self.folderKey).map { URL(fileURLWithPath: $0, isDirectory: true) }
        commands.exportHandler = { [weak self] settings in self?.export(settings) }
        commands.exportNote = { [weak self] folder in
            let name = folder?.lastPathComponent ?? self?.vm.currentURL?.deletingLastPathComponent().lastPathComponent ?? "the photo's folder"
            return "\(name) › "
        }
        commands.exportDestination = AnyView(ExportDestinationSection(commands: commands, model: self))
        commands.exportBatch = { [weak self] in self?.filmstrip.batch.map(\.lastPathComponent) ?? [] }
        commands.filmstrip = AnyView(FilmstripView(strip: filmstrip, exporter: batchExport) { [weak self] url in self?.open(url) })
        // The window title follows the photo (the title bar is the only place the whole file name always fits).
        vm.objectWillChange.sink { [weak self] _ in self?.objectWillChange.send() }.store(in: &bag)
        auto.objectWillChange.sink { [weak self] _ in self?.objectWillChange.send() }.store(in: &bag)
        // The menus name the batch (Export 5 Photos…) and follow its progress.
        filmstrip.objectWillChange.sink { [weak self] _ in self?.objectWillChange.send() }.store(in: &bag)
        batchExport.objectWillChange.sink { [weak self] _ in self?.objectWillChange.send() }.store(in: &bag)
        // Show Last Export in Finder: a one-photo export after a batch is the last one.
        vm.$lastExport.sink { [weak self] file in if file != nil { self?.batchExport.lastFile = nil } }.store(in: &bag)
        // The Viewer's Settings window writes the size through its store, i.e. UserDefaults: follow it live.
        NotificationCenter.default.publisher(for: UserDefaults.didChangeNotification)
            .receive(on: DispatchQueue.main)
            .sink { [weak self] _ in
                let s = Self.storedInterfaceScale
                if self?.interfaceScale != s { self?.interfaceScale = s }
            }
            .store(in: &bag)
        NotificationCenter.default.publisher(for: NSApplication.didResignActiveNotification)
            .sink { [weak self] _ in
                self?.sidecars.flush()
                self?.autoSidecars.flush()
            }.store(in: &bag)
        // Back in the app, the folder may have new photos (or fewer).
        NotificationCenter.default.publisher(for: NSApplication.didBecomeActiveNotification)
            .sink { [weak self] _ in self?.filmstrip.reload() }.store(in: &bag)
    }

    /** Opens [url] in the editor; the file is edited in place (never copied), its sidecar kept beside it. */
    func open(_ url: URL, initial: DevelopParams? = nil) {
        guard !vm.state.busy else {
            vm.message = "Wait for the photo that is opening or exporting"
            return
        }
        // A photo handed over (Finder, RawBoy Viewer) is for the editor, whichever mode the window was in; Auto's batch stays.
        mode = .pro
        NSDocumentController.shared.noteNewRecentDocumentURL(url)
        filmstrip.show(url)
        vm.open(url, initial: initial ?? autoDevelopForPro(url))
    }

    /**
     * A photo in Auto's batch that Pro hasn't edited yet (no `rawboy:Develop` in its sidecar) opens in Pro as Auto shows it
     * (look or preset, adjustments), so fixing blemishes there doesn't start from the bare as-shot develop. Once Pro has saved
     * edits, its sidecar wins. nil otherwise.
     */
    private func autoDevelopForPro(_ url: URL) -> DevelopParams? {
        guard let params = auto.photo(url.path)?.params else { return nil }
        let text = PhotoSidecar(photo: url).readText()
        if let text, XmpSidecar.readDevelop(text) != nil { return nil }
        return params
    }

    /** ← → in Pro: the previous or next photo in the filmstrip. */
    func openNeighbour(_ delta: Int) {
        if let url = filmstrip.neighbour(delta) { open(url) }
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
    /**
     * Moves an Auto export (named by Auto's name template) into the export folder, or beside its photo. A name already
     * taken there gets -001, -002... (NameTemplate.freeName, as the web's folder export): an export never overwrites.
     */
    private func saveAutoExport(_ file: URL, source: URL) throws -> String {
        let dir = commands.exportFolder ?? source.deletingLastPathComponent()
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        guard let name = NameTemplate.freeName(file.deletingPathExtension().lastPathComponent, file.pathExtension, in: dir) else {
            throw CocoaError(.fileWriteFileExists, userInfo: [NSFilePathErrorKey: dir.appendingPathComponent(file.lastPathComponent).path])
        }
        let target = dir.appendingPathComponent(name)
        try FileManager.default.moveItem(at: file, to: target)
        lastAutoExport = target
        return name
    }

    /** The last file Auto exported, for "Show in Finder". */
    private(set) var lastAutoExport: URL?

    /** The export sheet's Export: the photos picked in the filmstrip when there are two or more, else the open photo. */
    func export(_ settings: ExportSettings) {
        let batch = filmstrip.batch
        if batch.count > 1 {
            exportBatch(batch, settings)
            return
        }
        guard let dir = exportDirectory else { return }
        vm.export(settings, to: dir)
    }

    /**
     * Pro's batch export: each picked photo with its own saved edits (the open one with its edits as they stand), into the
     * chosen folder or beside each photo. The editor stays usable meanwhile.
     */
    func exportBatch(_ urls: [URL], _ settings: ExportSettings) {
        guard !batchExport.running else {
            vm.message = "A batch export is already running"
            return
        }
        vm.rememberExportSettings(settings)
        sidecars.flush()
        var edited: (url: URL, params: DevelopParams)?
        if let url = vm.currentURL, vm.state.hasImage { edited = (url: url, params: vm.state.params) }
        batchExport.start(urls, settings: settings, directory: commands.exportFolder, edited: edited,
                          restore: { [weak self] url, defaults in self?.sidecars.restore(url, defaults: defaults) },
                          finished: { [weak self] text in
                              self?.vm.message = text
                              // The picked photos are done: a plain ⌘E exports the open photo again (a pick made meanwhile stays).
                              if self?.filmstrip.batch == urls { self?.filmstrip.deselectAll() }
                          })
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

    // MARK: LUTs

    /** Copies dropped `.cube` / HaldCLUT `.png` files into the LUT folder and says so where the user is looking. */
    func importLuts(_ urls: [URL]) {
        let added = LutRepository.importFiles(urls)
        vm.refreshLuts()
        let text = added == 0 ? "Couldn't add those LUTs" : "Added \(added) LUT\(added == 1 ? "" : "s") to Your LUTs (Pro's LUT section)"
        if mode == .auto { auto.message = text } else { vm.message = text }
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
        editInPro(photo)
    }

    /**
     * Opens an Auto photo in Pro with its current develop (look, preset or RawBoy edits, and its adjustments) as the starting
     * edits, as the web's Edit in RawBoy does; To Auto there brings it back with Pro's edits.
     */
    func editInPro(_ photo: AutoPhoto) {
        open(photo.url, initial: photo.params)
    }

    /**
     * The photo open in the editor goes to Auto with Pro's edits ("Back to Auto"): they develop it there in place of its look,
     * with Auto's sliders on top; it joins the batch if it isn't in it, and opens when analysed.
     */
    func sendToAuto() {
        guard let url = vm.currentURL else {
            vm.message = "Open a photo first"
            return
        }
        guard vm.state.hasImage, !vm.state.busy else { return }
        sidecars.flush()
        mode = .auto
        guard auto.receiveEdits(url, vm.state.params) else {
            vm.message = "Auto is exporting; try again when it has finished"
            mode = .pro
            return
        }
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

    /**
     * Adds [urls] (files and folders) to Auto's batch and shows Auto; [how] overrides the sidebar's New photos choice for
     * them. [sidecarOnly]: only what the photos' sidecars hold, nothing added (Browse's As is; AutoViewModel.add).
     */
    func addToAuto(_ urls: [URL], as how: ImportMode? = nil, sidecarOnly: Bool = false) {
        let files = Self.photoFiles(in: urls)
        mode = .auto
        if files.isEmpty {
            auto.message = "No RAW, HEIC, JPEG, PNG or TIFF photos there"
            return
        }
        files.forEach { NSDocumentController.shared.noteNewRecentDocumentURL($0) }
        auto.add(files, as: how, sidecarOnly: sidecarOnly)
    }

    /**
     * RawBoy Viewer's "Send to RawBoy Auto": `rawboy-desktop://auto?as=looks|film|plain&path=…&path=…` adds the files and
     * folders to the batch as Looks, Film or As is. Returns false for a link it doesn't know.
     */
    @discardableResult
    func handle(link: URL) -> Bool {
        guard link.scheme == "rawboy-desktop", link.host == "auto",
              let items = URLComponents(url: link, resolvingAgainstBaseURL: false)?.queryItems else { return false }
        let paths = items.filter { $0.name == "path" }.compactMap(\.value).map { URL(fileURLWithPath: $0) }
        guard !paths.isEmpty else { return false }
        addToAuto(paths, as: items.first { $0.name == "as" }?.value.flatMap(ImportMode.init(rawValue:)))
        return true
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

    func showLastExportInFinder() {
        if mode == .auto, let url = lastAutoExport {
            NSWorkspace.shared.activateFileViewerSelecting([url])
            return
        }
        if let url = batchExport.lastFile ?? vm.lastExport { NSWorkspace.shared.activateFileViewerSelecting([url]) }
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
