import AppKit
import RawBoyEngine
import enum RawBoyBrowseKit.AutoImport
import protocol ViewerUI.PhotoHandOff

/**
 * What Browse mode hands to the rest of Desktop, in-process (no Open With, no `rawboy-desktop://` round trip): a photo
 * opens in Pro whichever mode the window was in (a batch in Auto stays as it is), and photos or folders sent to Auto join
 * its batch as Looks, Film or As is.
 */
@MainActor
struct DesktopHandOff: PhotoHandOff {
    unowned let model: DesktopModel

    /** Pro is the editor, so the viewer's E key and menus name it. */
    var editor: (name: String, url: URL?) { ("RawBoy Pro", nil) }

    var canSendToAuto: Bool { true }

    /**
     * As is from Browse brings the photos with their sidecars and nothing else: the crop, turn and RawBoy edits saved
     * beside them (or their own Auto settings), no measured denoise, preset or lens preset. Looks and Film develop as usual.
     */
    func sendToAuto(_ urls: [URL], as how: AutoImport) async throws {
        model.addToAuto(urls, as: ImportMode(rawValue: how.rawValue), sidecarOnly: how == .plain)
    }

    func openInEditor(_ url: URL) async -> Bool {
        model.open(url)
        return true
    }
}
