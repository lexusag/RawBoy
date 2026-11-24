import AppKit
import RawBoyEngine

/**
 * The editor's plain-key shortcuts, matched on the key's physical position (`keyCode`, ANSI names), never on the letter
 * it types: on a Ukrainian or any other non-Latin layout Z is still the key in Z's place (web: `shortcutKey.ts`). The
 * ⌘ shortcuts are matched the same way, so they work on those layouts too. Menu items show the keys; this monitor sees a
 * key before the menu does and takes it.
 *
 * Nothing here fires while text is being typed (a text field has focus) or a sheet is open.
 */
@MainActor
final class KeyboardShortcuts {
    private let model: DesktopModel
    private var monitor: Any?

    /** ANSI key codes (Carbon's kVK_*). */
    enum Key: UInt16 {
        case a = 0, y = 16, z = 6, d = 2, c = 8, b = 11, e = 14, v = 9, o = 31, f = 3, tab = 48
        case leftBracket = 33, rightBracket = 30, backslash = 42
        case left = 123, right = 124, down = 125, up = 126, one = 18, two = 19
        case three = 20, delete = 51, forwardDelete = 117, space = 49, `return` = 36, keypadEnter = 76, escape = 53, slash = 44
    }

    init(model: DesktopModel) { self.model = model }

    func start() {
        guard monitor == nil else { return }
        MenuTracking.start()
        monitor = NSEvent.addLocalMonitorForEvents(matching: [.keyDown, .keyUp]) { [weak self] event in
            guard let self else { return event }
            return MainActor.assumeIsolated { self.handle(event) }
        }
    }

    func stop() {
        if let monitor { NSEvent.removeMonitor(monitor) }
        monitor = nil
    }

    private var typing: Bool {
        guard let window = NSApp.keyWindow else { return true }
        if window.attachedSheet != nil { return true }
        return window.firstResponder is NSText  // a text field's field editor
    }

    /**
     * Auto: the arrows move through the grid (and between photos in the photo view, as Space and ⌫ do there), Return opens,
     * Esc goes back, ⌫ / ⌦ in the grid removes the selection after confirming, ⌦ in the photo view removes the photo from
     * the batch, C opens Crop & rotate, E opens the photo in Pro with its edits, ⇧C copies the previous photo's look; ⌘E,
     * ⌘O, ⌘Z and the mode keys are the menu's. Nothing here fires while text is being typed or a sheet is open.
     */
    private func handleAuto(_ event: NSEvent, _ key: Key) -> NSEvent? {
        guard event.type == .keyDown, !typing else { return event }
        let flags = event.modifierFlags.intersection([.command, .control, .option, .shift])
        let auto = model.auto
        if flags == [.command] {
            switch key {
            case .z: if let id = auto.selected { auto.undo(id) }
            case .o: model.addPhotosPanel()
            case .e: if auto.photos.contains(where: { $0.analysis != nil }) { auto.requestExport() }
            case .a: if auto.selected == nil { auto.selectAll() }
            // Copy and paste edits (the web's Ctrl+C / Ctrl+V); a text field keeps its own (`typing` above).
            case .c: model.copyKey()
            case .v: model.pasteEdits()
            case .return, .keypadEnter: model.editInPro()
            case .one: model.mode = .pro
            case .three: model.mode = .browse
            case .slash: model.commands.send(.help)
            default: return event
            }
            return nil
        }
        if flags == [.command, .shift] {
            switch key {
            case .z: if let id = auto.selected { auto.redo(id) }
            case .o: model.addFolderPanel()
            default: return event
            }
            return nil
        }
        // ⇧C in the photo view: Copy previous (the look, brightness and settings of the photo before it), as on the web.
        if flags == [.shift], key == .c, auto.export == nil, let id = auto.selected {
            auto.copyPrevious(id)
            return nil
        }
        guard flags.isEmpty, auto.export == nil else { return event }
        // Esc with photos selected in the grid clears the selection first.
        if key == .escape, auto.selected == nil, !auto.selection.isEmpty {
            auto.clearSelection()
            return nil
        }
        if let id = auto.selected {
            // Crop & rotate open: Return, Esc or C put it down (the crop stays as drawn); the batch keys wait until then.
            // A held C doesn't flick the tool open and shut, and a held E doesn't bounce between Auto and Pro.
            if (key == .c || key == .e), event.isARepeat { return nil }
            if auto.cropping {
                switch key {
                case .return, .keypadEnter, .escape, .c: auto.cropping = false
                default: return event
                }
                return nil
            }
            switch key {
            // Space / ⌫ as on the web (and in darktable), also while a slider has focus.
            case .left, .delete: auto.page(-1)
            case .right, .space: auto.page(1)
            // ⌦ (fn-Delete, the web's Delete): out of the batch, on to the next photo.
            case .forwardDelete: auto.removeOpened(id)
            case .c: auto.requestCrop()
            case .e: model.editInPro()
            case .escape: auto.goBack()
            default: return event
            }
            return nil
        }
        switch key {
        case .left: auto.moveFocus(dx: -1, dy: 0)
        case .right: auto.moveFocus(dx: 1, dy: 0)
        case .up: auto.moveFocus(dx: 0, dy: -1)
        case .down: auto.moveFocus(dx: 0, dy: 1)
        case .return, .keypadEnter: auto.openFocused()
        case .delete, .forwardDelete:
            guard !event.isARepeat, !auto.selection.isEmpty else { return event }
            auto.requestRemoveSelection()
        default: return event
        }
        return nil
    }

    /**
     * Browse: the keys are ViewerUI's (its own monitor, in this window, while Browse is showing); only the mode keys
     * are ours, matched by position like the others.
     */
    private func handleBrowse(_ event: NSEvent, _ key: Key) -> NSEvent? {
        guard event.type == .keyDown, !typing,
              event.modifierFlags.intersection([.command, .control, .option, .shift]) == [.command] else { return event }
        switch key {
        case .one: model.mode = .pro
        case .two: model.mode = .auto
        default: return event
        }
        return nil
    }

    private func handle(_ event: NSEvent) -> NSEvent? {
        guard let key = Key(rawValue: event.keyCode) else { return event }
        // A menu is open: Esc is its own (it closes it); the tool or screen behind stays as it is.
        if key == .escape, MenuTracking.isOpen { return event }
        let commands = model.commands
        if model.mode == .auto { return handleAuto(event, key) }
        if model.mode == .browse { return handleBrowse(event, key) }
        if key == .space {
            if typing { return event }
            let held = event.type == .keyDown
            commands.spaceHeld = held
            return commands.pointer != nil ? nil : event
        }
        guard event.type == .keyDown, !event.isARepeat || key == .leftBracket || key == .rightBracket, !typing else { return event }
        let flags = event.modifierFlags.intersection([.command, .control, .option, .shift])
        let vm = model.vm
        if flags == [.command] {
            switch key {
            case .z: vm.undo()
            case .o: model.openPanel()
            case .e: commands.send(.export)
            // Every photo in the filmstrip, for a batch export.
            case .a: model.filmstrip.selectAll()
            // Copy and paste edits: ⌘C twice asks which groups.
            case .c: model.copyKey()
            case .v: model.pasteEdits()
            case .slash: commands.send(.help)
            case .three: model.mode = .browse
            default: return event
            }
            return nil
        }
        if flags == [.command, .shift], key == .z {
            vm.redo()
            return nil
        }
        guard flags.isEmpty || flags == [.shift] else { return event }
        guard vm.state.hasImage else { return event }
        // Tab hides the panels, as in RawBoy Viewer, unless Full Keyboard Access uses it to move between controls (F always works).
        if key == .tab {
            guard flags.isEmpty, !NSApp.isFullKeyboardAccessEnabled else { return event }
            commands.send(.togglePhotoOnly)
            return nil
        }
        // ← → step through the folder (the filmstrip), unless a focused control (Full Keyboard Access) takes the arrows.
        if key == .left || key == .right, flags.isEmpty {
            if NSApp.keyWindow?.firstResponder is NSControl { return event }
            // With the Look selector out they turn its pages.
            if commands.looksOpen {
                commands.send(.looksPage(key == .left ? -1 : 1))
                return nil
            }
            model.openNeighbour(key == .left ? -1 : 1)
            return nil
        }
        // ⇧C: Copy previous (C alone is Crop & rotate).
        if flags == [.shift], key == .c {
            commands.send(.copyPrevious)
            return nil
        }
        switch key {
        case .f: commands.send(.togglePhotoOnly)
        case .z: commands.send(.zoom100AtPointer)
        case .d: commands.send(.cycleFrame)
        case .c: commands.send(.toggleMode(.geometry))
        case .backslash: commands.send(.toggleCompare)
        case .y: commands.send(.toggleSplit)
        case .b: commands.send(.maskTool(.brush))
        // Inside Masks: Erase; outside Masks: Send to Auto with the new edits (matching E on an opened Auto photo).
        case .e:
            if commands.masksOpen { commands.send(.maskTool(.erase)) }
            else if flags.isEmpty { model.sendToAuto() }
            else { return event }
        case .v: commands.send(.maskTool(.move))
        case .leftBracket: commands.send(.brushSize(-1))
        case .rightBracket: commands.send(.brushSize(1))
        case .delete, .forwardDelete: commands.send(.deleteSelection)
        case .escape, .return, .keypadEnter: commands.send(.done)
        default: return event
        }
        return nil
    }
}
