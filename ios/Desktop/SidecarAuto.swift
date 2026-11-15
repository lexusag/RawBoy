import Foundation
import os
import RawBoyEngine

/**
 * RawBoy Auto's settings live beside each photo, in the same XMP sidecar as RawBoy's edits (`rawboy:Auto`, the web's
 * `AutoSidecar` JSON; `PhotoSidecar` picks the file and writes only that field, atomically). A photo added to the batch
 * comes back as it was left; every change is written 800 ms after it stops (all photos changed meanwhile together), and
 * anything waiting is written when the app resigns active, on quit and when the mode changes.
 */
final class SidecarAuto: AutoPersistence, @unchecked Sendable {
    private static let log = Logger(subsystem: "app.rawboy", category: "RawBoyDesktop")
    private static let delay: Duration = .milliseconds(800)

    private let lock = NSLock()
    private var pending: [URL: SavedAuto] = [:]
    private var task: Task<Void, Never>?
    private var writesDone = 0
    /** Called with a message when a write fails (the app shows it). */
    var onError: @Sendable (String) -> Void = { _ in }

    var writes: Int { lock.withLock { writesDone } }

    func restore(_ url: URL) -> SavedAuto? {
        PhotoSidecar(photo: url).readAuto().flatMap(AutoSidecar.decode)
    }

    @MainActor func changed(_ photo: AutoPhoto) {
        lock.withLock { pending[photo.url] = photo.saved }
        task?.cancel()
        task = Task { [weak self] in
            try? await Task.sleep(for: Self.delay)
            guard !Task.isCancelled else { return }
            self?.flush()
        }
    }

    func flush() {
        let batch: [URL: SavedAuto] = lock.withLock {
            defer { pending = [:] }
            return pending
        }
        for (url, saved) in batch {
            do {
                try PhotoSidecar(photo: url).writeAuto(AutoSidecar.encode(saved))
                lock.withLock { writesDone += 1 }
            } catch {
                Self.log.error("Auto sidecar write failed: \(error.localizedDescription)")
                onError("Couldn't save the Auto settings next to \(url.lastPathComponent): \(error.localizedDescription)")
            }
        }
    }
}
