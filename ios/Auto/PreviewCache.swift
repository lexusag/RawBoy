import Foundation
import RawBoyEngine

/**
 * The detail view's preview of each analysed photo (PhotoSession.previewMaxDimension, as the session makes), kept on
 * disk so swiping to a photo shows its develop at once instead of after a full decode (port of PreviewCache.kt).
 * Written by the analysis, which has the full image decoded anyway. About 17 MB per photo; the oldest files go once
 * [maxBytes] is reached, and those photos fall back to the grid thumbnail until decoded. The batch isn't kept across
 * launches, so the folder starts empty. Thread-safe.
 */
final class PreviewCache: @unchecked Sendable {
    /** About 90 photos at 2048 px. */
    static let maxBytes = 1_500_000_000

    private let dir: URL
    private let maxBytes: Int
    private let lock = NSLock()
    /** Cached ids with their files and sizes; [order] keeps them oldest first. */
    private var files: [String: (url: URL, size: Int)] = [:]
    private var order: [String] = []
    private var total = 0
    private var nextFile = 0

    init(dir: URL, maxBytes: Int = PreviewCache.maxBytes) {
        self.dir = dir
        self.maxBytes = maxBytes
        try? FileManager.default.removeItem(at: dir)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    }

    func put(_ id: String, _ image: PreviewImage) {
        lock.lock()
        defer { lock.unlock() }
        drop(id)
        let url = dir.appendingPathComponent("\(nextFile).f16")
        nextFile += 1
        var data = Data(capacity: 16 + image.pixels.count * 2)
        for v in [image.width, image.height, image.fullWidth, image.fullHeight] {
            withUnsafeBytes(of: Int32(v)) { data.append(contentsOf: $0) }
        }
        image.pixels.withUnsafeBytes { data.append(contentsOf: $0) }
        do {
            try data.write(to: url)
        } catch {
            try? FileManager.default.removeItem(at: url) // disk full or similar: this photo just isn't cached
            return
        }
        files[id] = (url, data.count)
        order.append(id)
        total += data.count
        while total > maxBytes, order.count > 1 { drop(order[0]) }
    }

    /** The cached preview of [id], or nil. Blocking (reads ~17 MB): call off the main actor. */
    func get(_ id: String) -> PreviewImage? {
        lock.lock()
        let url = files[id]?.url
        lock.unlock()
        guard let url, let data = try? Data(contentsOf: url), data.count >= 16 else { return nil }
        let header = data.withUnsafeBytes { raw in (0..<4).map { Int(raw.loadUnaligned(fromByteOffset: $0 * 4, as: Int32.self)) } }
        let (w, h) = (header[0], header[1])
        guard w > 0, h > 0, data.count == 16 + w * h * 3 * 2 else { return nil }
        let pixels = data.withUnsafeBytes { raw in
            [UInt16](unsafeUninitializedCapacity: w * h * 3) { buf, n in
                memcpy(buf.baseAddress!, raw.baseAddress! + 16, w * h * 3 * 2)
                n = w * h * 3
            }
        }
        return PreviewImage(width: w, height: h, pixels: pixels, fullWidth: header[2], fullHeight: header[3])
    }

    func remove(_ id: String) {
        lock.lock()
        defer { lock.unlock() }
        drop(id)
    }

    func clear() {
        lock.lock()
        defer { lock.unlock() }
        for id in order { drop(id) }
    }

    /** Call with [lock] held. */
    private func drop(_ id: String) {
        guard let f = files.removeValue(forKey: id) else { return }
        order.removeAll { $0 == id }
        total -= f.size
        try? FileManager.default.removeItem(at: f.url)
    }
}
