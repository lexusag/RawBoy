import AppKit
import RawBoyEngine
import SwiftUI

/** RawBoy Desktop: RawBoy's editor on the Mac, edits kept in the photo's XMP sidecar. */
@main
struct RawBoyDesktopApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var delegate
    @ObservedObject private var model = DesktopModel.shared

    var body: some Scene {
        Window("RawBoy Desktop", id: "main") {
            DesktopRoot(model: model)
                .frame(minWidth: 720, minHeight: 520)
                .preferredColorScheme(.dark)
                .tint(DesktopTheme.amber)
        }
        .defaultSize(width: 1280, height: 860)
        .commands { DesktopCommands(model: model) }
    }
}

/** DESIGN.md's tokens, the ones the Mac window needs beyond the editor's own colours. */
enum DesktopTheme {
    /** safelight-amber */
    static let amber = Color(red: 0xE8 / 255, green: 0xA3 / 255, blue: 0x3D / 255)
}

final class AppDelegate: NSObject, NSApplicationDelegate {
    private var keyboard: KeyboardShortcuts?

    @MainActor
    func applicationDidFinishLaunching(_ notification: Notification) {
        let model = DesktopModel.shared
        keyboard = KeyboardShortcuts(model: model)
        keyboard?.start()
        NSApp.appearance = NSAppearance(named: .darkAqua)
        // The photo's pointer position (Z, the wheel) needs mouse-moved events.
        for window in NSApp.windows { window.acceptsMouseMovedEvents = true }
        for url in Self.launchFiles() { model.open(url) }
        let batch = Self.launchFiles(after: "--auto")
        if !batch.isEmpty { model.addToAuto(batch) }
        #if DEBUG
        AutoBatchProbe.runIfRequested(model)
        AutoBatchProbe.openDetailIfRequested(model)
        AutoBatchProbe.mouseProbeIfRequested(model)
        AutoBatchProbe.selfTestIfRequested(model)
        #endif
    }

    @MainActor
    func applicationDidBecomeActive(_ notification: Notification) {
        for window in NSApp.windows { window.acceptsMouseMovedEvents = true }
    }

    /** Finder's Open With, a file dropped on the Dock icon, `open -a`. */
    @MainActor
    func application(_ application: NSApplication, open urls: [URL]) {
        let model = DesktopModel.shared
        // Several photos (or a folder) from the Finder go to Auto's batch; one opens in the editor.
        if urls.count > 1 || urls.first?.hasDirectoryPath == true { model.addToAuto(urls) } else if let url = urls.first { model.open(url) }
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }

    @MainActor
    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        DesktopModel.shared.sidecars.flush()
        DesktopModel.shared.autoSidecars.flush()
        return .terminateNow
    }

    /** Files named on the command line (`RawBoy\ Desktop --open photo.RAF`; `--auto a.RAF b.RAF folder/` fills Auto's batch), for scripts and tests. */
    private static func launchFiles(after flag: String = "--open") -> [URL] {
        let args = CommandLine.arguments
        guard let i = args.firstIndex(of: flag) else { return [] }
        return args[(i + 1)...].prefix { !$0.hasPrefix("--") }.map { URL(fileURLWithPath: $0) }
    }
}

/** The menu bar: every shortcut of the editor, the way the web lists them in its help. */
struct DesktopCommands: Commands {
    @ObservedObject var model: DesktopModel

    private var state: EditorState { model.vm.state }
    private var proMode: Bool { model.mode == .pro }
    private var ready: Bool { proMode && state.hasImage && !state.busy }
    private var auto: AutoViewModel { model.auto }
    private var autoReady: Bool { model.mode == .auto && auto.export == nil }
    private var autoExportable: Bool { autoReady && auto.photos.contains { $0.analysis != nil } }

    var body: some Commands {
        CommandGroup(replacing: .newItem) {
            Button(proMode ? "Open…" : "Add Photos…") { if proMode { model.openPanel() } else { model.addPhotosPanel() } }
                .keyboardShortcut("o")
            Button("Add a Folder to Auto…") { model.addFolderPanel() }.keyboardShortcut("o", modifiers: [.command, .shift])
            Divider()
            Button(proMode ? "Export…" : "Export All…") {
                if proMode { model.commands.send(.export) } else { auto.requestExport() }
            }
            .keyboardShortcut("e").disabled(proMode ? !ready : !autoExportable)
            Button("Show Last Export in Finder") { model.showLastExportInFinder() }
                .disabled(proMode ? model.vm.lastExport == nil : model.lastAutoExport == nil)
            Button("Show Sidecar in Finder") { model.showSidecarInFinder() }.disabled(model.vm.currentURL == nil || !proMode)
        }
        CommandGroup(replacing: .undoRedo) {
            Button("Undo") { model.undoOrTextUndo() }.keyboardShortcut("z")
                .disabled(proMode ? !state.canUndo : !(auto.selected.map(auto.canUndo) ?? false))
            Button("Redo") { model.redoOrTextRedo() }.keyboardShortcut("z", modifiers: [.command, .shift])
                .disabled(proMode ? !state.canRedo : !(auto.selected.map(auto.canRedo) ?? false))
            Divider()
            Button("Reset All") { model.vm.reset() }.disabled(!ready)
            Button("Auto Dev") { model.vm.applyAuto() }.disabled(!ready)
        }
        CommandMenu("Mode") {
            Button("Pro: One Photo in the Editor") { model.mode = .pro }.keyboardShortcut("1").disabled(model.mode == .pro)
            Button("Auto: a Batch Developed Automatically") { model.mode = .auto }.keyboardShortcut("2").disabled(model.mode == .auto)
            Divider()
            Button("Previous Photo") { auto.page(-1) }.keyboardShortcut(.leftArrow, modifiers: []).disabled(!autoReady || auto.selected == nil)
            Button("Next Photo") { auto.page(1) }.keyboardShortcut(.rightArrow, modifiers: []).disabled(!autoReady || auto.selected == nil)
            Button("Edit in Pro") { model.editInPro() }.keyboardShortcut(.return, modifiers: .command)
                .disabled(!autoReady || model.autoPhotoForPro == nil)
            Button("Send to Auto") { model.sendToAuto() }.keyboardShortcut("a", modifiers: [.command, .shift])
                .disabled(!proMode || model.vm.currentURL == nil)
            Divider()
            Button("Select All Photos") { auto.selectAll() }.disabled(!autoReady || auto.selected != nil || auto.photos.isEmpty)
            Button("Clear Batch…") { auto.requestClear() }.disabled(!autoReady || auto.photos.isEmpty)
            Divider()
            Button("Open Focused Photo") { auto.openFocused() }.keyboardShortcut(.return, modifiers: [])
                .disabled(!autoReady || auto.selected != nil || auto.focusedId == nil)
            Button("Back to the Grid") { auto.goBack() }.keyboardShortcut(.escape, modifiers: []).disabled(!autoReady || auto.selected == nil)
        }
        CommandMenu("Photo") {
            Button("Crop & Rotate") { model.commands.send(.toggleMode(.geometry)) }.keyboardShortcut("c", modifiers: []).disabled(!ready)
            Button("Masks") { model.commands.send(.toggleMode(.masks)) }.disabled(!ready)
            Button("Healing Brush") { model.commands.send(.toggleMode(.heal)) }.disabled(!ready)
            Button("Light Leaks & Effects") { model.commands.send(.toggleMode(.leaks)) }.disabled(!ready)
            Button("Presets") { model.commands.send(.toggleMode(.presets)) }.disabled(!ready)
            Divider()
            Button("Rotate Left") { model.vm.rotate(-1) }.keyboardShortcut("[", modifiers: .command).disabled(!ready)
            Button("Rotate Right") { model.vm.rotate(1) }.keyboardShortcut("]", modifiers: .command).disabled(!ready)
            Button("Flip Horizontal") { model.vm.flip(false) }.disabled(!ready)
            Button("Flip Vertical") { model.vm.flip(true) }.disabled(!ready)
            Divider()
            Button("Close Tool") { model.commands.send(.done) }.disabled(!ready)
        }
        CommandMenu("View") {
            Button("100% at the Pointer / Whole Photo") { model.commands.send(.zoom100AtPointer) }
                .keyboardShortcut("z", modifiers: []).disabled(!ready)
            Button("Whole Photo") { model.commands.send(.zoomFit) }.disabled(!ready)
            Button("Compare with As Shot") { model.commands.send(.toggleCompare) }
                .keyboardShortcut("\\", modifiers: []).disabled(!ready)
            Button("Frame Colour") { model.commands.send(.cycleFrame) }.keyboardShortcut("d", modifiers: []).disabled(!ready)
            Button("Mark Clipped Highlights and Shadows") { model.vm.toggleClipWarning() }.disabled(!ready)
        }
        CommandMenu("Masks") {
            Button("Brush (Healing brush outside Masks)") { model.commands.send(.maskTool(.brush)) }.keyboardShortcut("b", modifiers: []).disabled(!ready)
            Button("Erase") { model.commands.send(.maskTool(.erase)) }.keyboardShortcut("e", modifiers: []).disabled(!ready)
            Button("Move") { model.commands.send(.maskTool(.move)) }.keyboardShortcut("v", modifiers: []).disabled(!ready)
            Button("Smaller Brush") { model.commands.send(.brushSize(-1)) }.keyboardShortcut("[", modifiers: []).disabled(!ready)
            Button("Larger Brush") { model.commands.send(.brushSize(1)) }.keyboardShortcut("]", modifiers: []).disabled(!ready)
        }
        CommandGroup(replacing: .help) {
            Button("RawBoy Desktop Help") { model.commands.send(.help) }.keyboardShortcut("/", modifiers: .command)
        }
    }
}

extension DesktopModel {
    /** ⌘Z while text is being edited undoes the text; otherwise the photo's edit. */
    func undoOrTextUndo() {
        if let text = NSApp.keyWindow?.firstResponder as? NSTextView { text.undoManager?.undo() } else { vm.undo() }
    }

    func redoOrTextRedo() {
        if let text = NSApp.keyWindow?.firstResponder as? NSTextView { text.undoManager?.redo() } else { vm.redo() }
    }
}
