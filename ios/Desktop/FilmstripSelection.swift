import Foundation

/**
 * Which filmstrip photos are picked for a batch export (Pro on the Mac), with Finder's clicks: a plain click opens the
 * photo and clears the pick, ⌘-click adds or removes one (starting from the open photo), ⇧-click picks the run from the
 * last clicked photo (or the open one) to this one, ⌘A picks them all. Pure, so the rules are tested (FilmstripSelectionTests).
 */
struct FilmstripSelection: Equatable {
    private(set) var picked: Set<URL> = []
    /** Where a ⇧-click's run starts: the last photo clicked. */
    private(set) var anchor: URL?

    enum Click { case plain, command, shift }

    /**
     * A click on [url] among [files] while [current] is open. Returns true when the photo should open (a plain click);
     * ⌘ and ⇧ clicks only change the pick.
     */
    mutating func click(_ url: URL, _ kind: Click, files: [URL], current: URL?) -> Bool {
        switch kind {
        case .plain:
            picked = []
            anchor = url
            return true
        case .command:
            if picked.isEmpty, let current, current != url, files.contains(current) { picked.insert(current) }
            if picked.contains(url) { picked.remove(url) } else { picked.insert(url) }
            anchor = url
            return false
        case .shift:
            let from = anchor.flatMap { files.firstIndex(of: $0) } ?? current.flatMap { files.firstIndex(of: $0) }
            guard let to = files.firstIndex(of: url) else { return false }
            guard let from else {
                picked = [url]
                anchor = url
                return false
            }
            picked = Set(files[min(from, to)...max(from, to)])
            return false
        }
    }

    mutating func selectAll(_ files: [URL]) {
        picked = Set(files)
    }

    mutating func clear() {
        picked = []
        anchor = nil
    }

    /** Keeps only photos still in the folder (after it is listed again). */
    mutating func keep(_ files: [URL]) {
        picked.formIntersection(files)
        if let a = anchor, !files.contains(a) { anchor = nil }
    }

    /** The photos a batch export takes, in filmstrip order: two or more picked, else none (one photo is the plain export). */
    func batch(_ files: [URL]) -> [URL] {
        picked.count < 2 ? [] : files.filter(picked.contains)
    }

    func contains(_ url: URL) -> Bool { picked.contains(url) }
}
