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
    /** The before/after slider over the photo (Y). */
    case toggleSplit
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
    /** Opens the Look selector at a point of the preview (points; nil = its centre). Debug probes. */
    case openLooks(CGPoint?)
    /** Copy the previous photo's settings onto this one (⇧C). */
    case copyPrevious
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
    /** The Masks tool is open: E selects its Erase tool instead of sending the photo back to Auto. */
    var masksOpen = false
    /** Crop & rotate is open: E leaves the photo where it is (as in Auto) instead of sending it to Auto. */
    var cropOpen = false

    /** RawBoy Desktop: a section for the export sheet choosing the folder, the file written there, and the folder chosen. */
    var exportDestination: AnyView?
    @Published var exportFolder: URL?
    /** RawBoy Desktop: the subfolder typed in the export sheet, as typed (ExportSubfolder.clean makes the name; "" = none). */
    @Published var exportSubfolder = ""
    var exportHandler: ((ExportSettings) -> Void)?
    /** RawBoy Desktop: adds the open photo to Auto's batch and shows Auto (nil elsewhere: no button). */
    var sendToAuto: (() -> Void)?
    /** RawBoy Desktop: the file names the export sheet exports when photos are picked in the filmstrip (empty: the open photo). */
    var exportBatch: (() -> [String])?
    /** The line under the export options: where the file goes. */
    var exportNote: ((URL?) -> String)?
    /** RawBoy Desktop: the folder's other photos, shown under the photo (nil elsewhere). */
    var filmstrip: AnyView?

    func send(_ a: EditorAction) {
        action = a
        serial += 1
    }
}
