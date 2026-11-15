import Foundation
import RawBoyEngine

/**
 * A photo's edits kept outside the app (RawBoy Desktop: its XMP sidecar). iOS has none: edits carry over to the next
 * photo instead. The editor view model calls it on the main actor.
 */
@MainActor
protocol EditsPersistence: AnyObject {
    /** The edits [url] opens with, given its as-shot [defaults]; nil: none saved, carry the previous photo's over. */
    func restore(_ url: URL, defaults: DevelopParams) -> DevelopParams?
    /** The open photo's edits changed. */
    func changed(_ url: URL, params: DevelopParams, defaults: DevelopParams)
    /** Writes anything still waiting (before another photo opens, and on quit). */
    func flush()
}
