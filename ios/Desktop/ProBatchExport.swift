import Foundation
import RawBoyEngine

/**
 * Pro's batch export (RawBoy Desktop): the photos picked in the filmstrip, one after another, each with its own edits
 * from its sidecar (`rawboy:Develop`, as Pro would open it; no sidecar = as shot), with the export sheet's settings. The
 * photo open in the editor goes with its edits as they stand on screen, saved or not.
 *
 * Each photo is decoded into a session of its own, healed (healing brush, Blemish removal) and exported as Pro's single
 * export does it (masks, lens blur, retouch map, LUT, film stock), then closed, so the editor's photo stays open and
 * editable meanwhile. A Lensfun profile is not part of the edits, so the batch leaves it out. Stop finishes the photo
 * being exported and leaves the rest; a failure skips to the next.
 */
@MainActor
final class ProBatchExport: ObservableObject {
    struct Progress: Equatable {
        var done = 0
        var total: Int
        var failed = 0
        /** 0..1 of the photo being exported. */
        var current: Float = 0
        var stopping = false
        var name = ""
        var startedAt = Date()
    }

    @Published private(set) var progress: Progress?
    /** The last file written, for Show Last Export in Finder (cleared when Pro exports one photo after it). */
    var lastFile: URL?
    private var activity: NSObjectProtocol?

    var running: Bool { progress != nil }

    /**
     * Exports [urls] into [directory] (nil: each beside its photo). [edited]: the editor's photo and its edits now;
     * [restore]: a photo's saved edits for its as-shot defaults (nil = none); [finished] gets the closing message.
     */
    func start(_ urls: [URL], settings: ExportSettings, directory: URL?, edited: (url: URL, params: DevelopParams)?,
               restore: @escaping @MainActor (URL, DevelopParams) -> DevelopParams?,
               finished: @escaping @MainActor (String) -> Void) {
        guard progress == nil, !urls.isEmpty else { return }
        progress = Progress(total: urls.count)
        // A batch can take minutes: don't let the Mac idle-sleep under it.
        activity = ProcessInfo.processInfo.beginActivity(options: [.userInitiated, .idleSystemSleepDisabled], reason: "Exporting photos")
        let session = PhotoSession(lutCacheSize: 2, filmLoader: { try await Self.loadFilm($0) }, onMessage: { _ in })
        Task {
            var failed = 0
            var attempted = 0
            var stopped = false
            var firstError: String?
            for (index, url) in urls.enumerated() {
                if progress?.stopping == true { stopped = true; break }
                progress?.name = url.lastPathComponent
                progress?.current = 0
                attempted += 1
                do {
                    let opened = try await session.open(url) { defaults in
                        if let edited, edited.url == url { return edited.params }
                        return restore(url, defaults) ?? defaults
                    }
                    await session.healNow()
                    var itemSettings = settings
                    itemSettings.frameNumber = index + 1
                    let file = try await session.export(opened.params, defaults: opened.defaults, sourceName: url.lastPathComponent,
                                                        settings: itemSettings, directory: directory ?? url.deletingLastPathComponent()) { f in
                        Task { @MainActor in self.progress?.current = f }
                    }
                    lastFile = file
                } catch {
                    failed += 1
                    if firstError == nil { firstError = "\(url.lastPathComponent): \(error.localizedDescription)" }
                }
                session.close()
                progress?.done = index + 1
                progress?.failed = failed
                progress?.current = 0
            }
            let saved = attempted - failed
            let place = directory?.lastPathComponent ?? "each photo's folder"
            var text = (stopped ? "Stopped · " : "") + "Saved \(saved) \(saved == 1 ? "photo" : "photos") to \(place)"
            if failed > 0 { text += " · \(failed) failed" + (firstError.map { " (\($0))" } ?? "") }
            progress = nil
            if let a = activity { ProcessInfo.processInfo.endActivity(a) }
            activity = nil
            finished(text)
        }
    }

    /** Finishes the photo being exported and stops there; files already written stay. */
    func stop() {
        if progress != nil { progress?.stopping = true }
    }

    /** Film stocks (two 33³ LUTs each, under 1 MB), loaded per photo that uses one. */
    private nonisolated static func loadFilm(_ id: String) async throws -> FilmData {
        try await Task.detached(priority: .userInitiated) {
            guard let stock = try FilmStocks.byId(id) else { throw RawImageError(message: "Unknown film stock \(id)") }
            return try FilmStocks.load(stock)
        }.value
    }
}
