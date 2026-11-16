import RawBoyEngine
import SwiftUI
#if canImport(AppKit)
import AppKit
#endif

/**
 * What the menu bar, the keyboard and the pointer ask of the editor (RawBoy Desktop). The editor's own state (open tool,
 * Compare, the export sheet) lives in `EditorScreen`, so these go through [EditorCommands]; iOS never sends any.
 */
enum EditorAction: Equatable {
    case export
    /** Opens the tool, or closes it when it is the open one. */
    case toggleMode(EditorMode)
    case toggleCompare
    /** Hides the bar and the panel, or brings them back (Tab, F). */
    case togglePhotoOnly
    /** 100% at the pointer, or back to the whole photo. */
    case zoom100AtPointer
    case zoomFit
    case cycleFrame
    case maskTool(MaskTool)
    /** Brush size, +1 larger / -1 smaller. */
    case brushSize(Int)
    /** Removes the selected healing stroke (Delete). */
    case deleteSelection
    /** Closes the open tool (Esc, Return). */
    case done
    /** The Look selector's page, -1 previous / +1 next (← → while it is open). */
    case looksPage(Int)
    /** The "?" sheet. */
    case help
}

/** Host hooks for [EditorScreen]: actions to run, the pointer's position over the photo, and the export destination. */
@MainActor
final class EditorCommands: ObservableObject {
    @Published private(set) var serial = 0
    private(set) var action: EditorAction?
    /** Where the pointer is over the photo, in the preview's points (nil: outside it). Not published. */
    var pointer: CGPoint?
    /** Space held: a drag pans the zoomed photo instead of painting. */
    var spaceHeld = false
    /** The Look selector is armed or open: ← → turn its pages instead of stepping through the folder. */
    var looksOpen = false

    /** RawBoy Desktop: a section for the export sheet choosing the folder, the file written there, and the folder chosen. */
    var exportDestination: AnyView?
    @Published var exportFolder: URL?
    var exportHandler: ((ExportSettings) -> Void)?
    /** RawBoy Desktop: adds the open photo to Auto's batch and shows Auto (nil elsewhere: no button). */
    var sendToAuto: (() -> Void)?
    /** The line under the export options: where the file goes. */
    var exportNote: ((URL?) -> String)?
    /** RawBoy Desktop: the folder's other photos, shown under the photo (nil elsewhere). */
    var filmstrip: AnyView?

    func send(_ a: EditorAction) {
        action = a
        serial += 1
    }
}
