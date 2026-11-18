import Foundation

/**
 * What RawBoy Desktop would lose by quitting right now, so it can ask first (the web's `leaveWarning`, which makes the
 * browser confirm before the tab goes away). Pure: the app fills in [QuitWork] from its view models and shows [message].
 *
 * Edits themselves are not on the list: they are written to the photo's sidecar as they are made and flushed on quit, so
 * only a sidecar the app could not write counts (the web's "edits not exported" without a sidecar).
 */
public struct QuitWork: Equatable {
    /** Pro is exporting the open photo. */
    public var proExporting = false
    /** RawBoy Desktop: Pro's batch export (photos picked in the filmstrip) is running. */
    public var proBatchExporting = false
    /** Pro's Auto button is measuring the photo. */
    public var proAutoRunning = false
    /** Pro's last sidecar write failed: the named photo's latest edits exist only in memory. */
    public var unsavedEditsOf: String?
    /** Auto's batch export is running. */
    public var autoExporting = false
    /** Auto photos waiting, being analysed or being exported (or a photo opening). */
    public var autoPhotosInProgress = 0
    /** The Packer is converting files. */
    public var packerRunning = false

    public init() {}

    public var isEmpty: Bool { reasons.isEmpty }

    /** One sentence per thing that would be cut short, most important first. */
    public var reasons: [String] {
        var out: [String] = []
        if proExporting { out.append("The photo is still exporting, and the file would be left unfinished.") }
        if proBatchExporting { out.append("Pro's batch export is still running; photos not yet written would be skipped.") }
        if autoExporting { out.append("Auto's batch export is still running; photos not yet written would be skipped.") }
        else if autoPhotosInProgress > 0 {
            out.append(autoPhotosInProgress == 1 ? "Auto is still working on 1 photo." : "Auto is still working on \(autoPhotosInProgress) photos.")
        }
        if packerRunning { out.append("The Packer is still converting files; the one in progress would be left unfinished.") }
        if proAutoRunning { out.append("Auto Dev is still measuring the photo.") }
        if let name = unsavedEditsOf { out.append("The latest edits to \(name) could not be saved next to the photo.") }
        return out
    }

    /** The alert's text: what is running or unsaved, one line each. */
    public var message: String { reasons.joined(separator: "\n") }
}
