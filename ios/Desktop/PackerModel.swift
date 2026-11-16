import AppKit
import Combine
import RawBoyEngine
import SwiftUI
import UniformTypeIdentifiers
import enum RawBoyBrowseKit.PhotoOrder

enum PackStatus: Equatable { case inspecting, ready, packing, done, failed }

/** One file in the Packer's list. */
struct PackItem: Identifiable {
    let url: URL
    /** The folder it came from (shown as its group), nil for a file added by itself. */
    var folder: String?
    /** When it was shot (EXIF date), else the file's date; orders the list. */
    var date: String?
    var size = 0
    var status = PackStatus.inspecting
    var info: PackInfo?
    /** After packing: what was written and what it is. */
    var result: PackInfo?
    var output: URL?
    var outputSize = 0
    var error: String?

    var id: String { url.path }
}

/**
 * RawBoy Packer's window: the file list, the settings, and the run. Files are inspected when added; a run packs them with
 * up to `filesAtOnce` at a time (each its own native call on a big-stack thread), writing next to the source or into a
 * folder, never over an existing file. Settings are remembered. See `Packer` and `PackSettings`.
 */
@MainActor
final class PackerModel: ObservableObject {
    static let shared = PackerModel()

    @Published private(set) var items: [PackItem] = []
    @Published var settings: PackSettings { didSet { UserDefaults.standard.set(try? JSONEncoder().encode(settings), forKey: Self.settingsKey) } }
    /** Where packed files go: nil = next to each source. */
    @Published private(set) var outputFolder: URL? = UserDefaults.standard.string(forKey: PackerModel.folderKey).map { URL(fileURLWithPath: $0, isDirectory: true) }
    @Published private(set) var running = false
    @Published private(set) var stopping = false
    /** The finished run's message (title, body), until the next run or Clear. */
    @Published private(set) var finished: (title: String, body: String)?
    /** Files of the current run, for the progress line. */
    @Published private(set) var runTotal = 0

    private static let settingsKey = "packer.settings"
    private static let folderKey = "packer.output"
    private var inspecting = false

    init() {
        settings = (UserDefaults.standard.data(forKey: Self.settingsKey).flatMap { try? JSONDecoder().decode(PackSettings.self, from: $0) } ?? PackSettings()).validated()
    }

    // MARK: Files

    /** The raws and DNGs among [urls] (folders searched, hidden files skipped), each with the folder it came from. */
    static func rawFiles(in urls: [URL]) -> [(URL, String?)] {
        func isRaw(_ u: URL) -> Bool {
            guard let t = UTType(filenameExtension: u.pathExtension.lowercased()) else { return false }
            return t.conforms(to: .rawImage) || u.pathExtension.lowercased() == "dng"
        }
        var out: [(URL, String?)] = []
        for url in urls {
            var isDirectory: ObjCBool = false
            guard FileManager.default.fileExists(atPath: url.path, isDirectory: &isDirectory) else { continue }
            if isDirectory.boolValue {
                let files = FileManager.default.enumerator(at: url, includingPropertiesForKeys: nil, options: [.skipsHiddenFiles, .skipsPackageDescendants])
                let found = (files?.compactMap { $0 as? URL } ?? []).filter(isRaw).sorted { $0.path < $1.path }
                // The group is the chosen folder's name, plus the subfolder a file lies in.
                let base = url.resolvingSymlinksInPath().path
                out += found.map { f in
                    let dir = f.resolvingSymlinksInPath().deletingLastPathComponent().path
                    return (f, url.lastPathComponent + String(dir.dropFirst(base.count)))
                }
            } else if isRaw(url) {
                out.append((url, nil))
            }
        }
        return out
    }

    /** Adds files and folders to the list (already listed ones are skipped) and reads what each is. */
    func add(_ urls: [URL]) {
        guard !running else { return }
        let known = Set(items.map(\.id))
        let fresh = Self.rawFiles(in: urls).filter { !known.contains($0.0.path) }
        if fresh.isEmpty { return }
        finished = nil
        Task {
            let dates = await Task.detached(priority: .userInitiated) { fresh.map { CaptureDate.read($0.0) } }.value
            let now = Set(items.map(\.id))
            for ((url, folder), date) in zip(fresh, dates) where !now.contains(url.path) {
                var item = PackItem(url: url, folder: folder)
                item.size = (try? FileManager.default.attributesOfItem(atPath: url.path)[.size] as? Int) ?? 0
                item.date = date
                items.append(item)
            }
            items.sort { PhotoOrder.inOrder(.date, ($0.date, $0.url.lastPathComponent), ($1.date, $1.url.lastPathComponent)) }
            inspectPending()
        }
    }

    private func inspectPending() {
        guard !inspecting else { return }
        inspecting = true
        Task {
            while let next = items.first(where: { $0.status == .inspecting }) {
                let url = next.url
                let result = await Task.detached(priority: .userInitiated) { Result { try Packer.inspect(url) } }.value
                update(next.id) {
                    switch result {
                    case let .success(info):
                        $0.info = info
                        $0.status = .ready
                    case let .failure(error):
                        $0.status = .failed
                        $0.error = error.localizedDescription
                    }
                }
            }
            inspecting = false
        }
    }

    private func update(_ id: String, _ change: (inout PackItem) -> Void) {
        guard let i = items.firstIndex(where: { $0.id == id }) else { return }
        change(&items[i])
    }

    func remove(_ id: String) {
        guard !running else { return }
        items.removeAll { $0.id == id }
    }

    func clear() {
        guard !running else { return }
        items = []
        finished = nil
    }

    func setOutputFolder(_ url: URL?) {
        outputFolder = url
        UserDefaults.standard.set(url?.path, forKey: Self.folderKey)
    }

    var inspected: [PackInfo] { items.compactMap(\.info) }
    var summary: [PackerInfo.Line] { PackerInfo.summarize(settings, inspected) }

    /** Files at once for this run: the setting, or Auto's choice. */
    var effectiveFilesAtOnce: Int { settings.filesAtOnce > 0 ? settings.filesAtOnce : autoFilesAtOnce() }

    // MARK: Run

    var canStart: Bool { !running && items.contains { $0.status == .ready || $0.status == .failed && $0.info != nil } }

    func start() {
        guard canStart else { return }
        let todo = items.filter { $0.status == .ready || $0.status == .failed && $0.info != nil }.map(\.id)
        for id in todo { update(id) { $0.status = .ready; $0.error = nil } }
        running = true
        stopping = false
        finished = nil
        runTotal = todo.count
        let settings = settings
        let atOnce = effectiveFilesAtOnce
        let threads = threadsPerFile(atOnce)
        let folder = outputFolder
        Task {
            var run = PackerInfo.Run()
            var queue = todo[...]
            await withTaskGroup(of: (String, Result<(PackInfo, URL, Int), Error>).self) { group in
                @MainActor func launch() {
                    guard !stopping, let id = queue.popFirst(), let item = items.first(where: { $0.id == id }) else { return }
                    update(id) { $0.status = .packing }
                    let source = item.url
                    group.addTask {
                        let result = await Task.detached(priority: .userInitiated) { () -> Result<(PackInfo, URL, Int), Error> in
                            Result {
                                let dir = folder ?? source.deletingLastPathComponent()
                                try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
                                // Never over an existing file: the next free name (-1, -2…).
                                var counter = 0
                                var destination: URL
                                repeat {
                                    destination = dir.appendingPathComponent(PackerInfo.outputName(source.lastPathComponent, counter: counter, suffix: settings.nameSuffix ? settings.suffix : ""))
                                    counter += 1
                                } while FileManager.default.fileExists(atPath: destination.path)
                                let info = try Packer.pack(source, to: destination, settings: settings, threads: threads)
                                let size = (try? FileManager.default.attributesOfItem(atPath: destination.path)[.size] as? Int) ?? 0
                                return (info, destination, size)
                            }
                        }.value
                        return (id, result)
                    }
                }
                for _ in 0..<atOnce { launch() }
                while let (id, result) = await group.next() {
                    switch result {
                    case let .success((info, url, size)):
                        update(id) { $0.status = .done; $0.result = info; $0.output = url; $0.outputSize = size }
                        run.done += 1
                        run.before += items.first { $0.id == id }?.size ?? 0
                        run.after += size
                    case let .failure(error):
                        update(id) { $0.status = .failed; $0.error = error.localizedDescription }
                        run.failed += 1
                    }
                    launch()
                }
            }
            // Files not started because of Stop go back to waiting.
            run.stopped = stopping && queue.count > 0
            for id in queue { update(id) { $0.status = .ready } }
            running = false
            stopping = false
            finished = PackerInfo.runMessage(run)
        }
    }

    /** Ends the run after the files being packed now (the encoder can't be interrupted midway). */
    func stop() { if running { stopping = true } }

    // MARK: Panels

    func addFilesPanel() {
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = true
        panel.canChooseDirectories = true
        panel.canChooseFiles = true
        panel.message = "Choose raws, DNGs or folders of them"
        if panel.runModal() == .OK { add(panel.urls) }
    }

    func chooseOutputPanel() {
        let panel = NSOpenPanel()
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.canCreateDirectories = true
        panel.prompt = "Pack here"
        if panel.runModal() == .OK, let url = panel.url { setOutputFolder(url) }
    }

    func showInFinder(_ item: PackItem) {
        NSWorkspace.shared.activateFileViewerSelecting([item.output ?? item.url])
    }
}
