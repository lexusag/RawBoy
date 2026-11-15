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
        case z = 6, d = 2, c = 8, b = 11, e = 14, v = 9, o = 31
        case leftBracket = 33, rightBracket = 30, backslash = 42
        case delete = 51, forwardDelete = 117, space = 49, `return` = 36, keypadEnter = 76, escape = 53, slash = 44
    }

    init(model: DesktopModel) { self.model = model }

    func start() {
        guard monitor == nil else { return }
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

    private func handle(_ event: NSEvent) -> NSEvent? {
        guard let key = Key(rawValue: event.keyCode) else { return event }
        let commands = model.commands
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
            case .slash: commands.send(.help)
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
        switch key {
        case .z: commands.send(.zoom100AtPointer)
        case .d: commands.send(.cycleFrame)
        case .c: commands.send(.toggleMode(.geometry))
        case .backslash: commands.send(.toggleCompare)
        case .b: commands.send(.maskTool(.brush))
        case .e: commands.send(.maskTool(.erase))
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
