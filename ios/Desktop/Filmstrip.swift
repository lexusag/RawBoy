import AppKit
import ImageIO
import RawBoyEngine
import SwiftUI
import UniformTypeIdentifiers

/**
 * Pro's filmstrip: the other photos in the open photo's folder, under the photo, so the next one is a click (or ← →) away
 * instead of a trip through the Open panel. File name order; a RAW + JPEG pair (same name) shows once, as the raw, as in
 * RawBoy Viewer. Thumbnails are the files' own embedded previews (ImageIO), never a develop.
 */
@MainActor
final class Filmstrip: ObservableObject {
    @Published private(set) var files: [URL] = []
    /** The photo open in the editor (set as it starts opening). */
    @Published private(set) var current: URL?
    private var folder: URL?

    /** [url] is opening: list its folder when it is another folder, or the photo isn't listed yet. */
    func show(_ url: URL) {
        current = url
        let dir = url.deletingLastPathComponent()
        if dir != folder || !files.contains(url) {
            folder = dir
            reload()
        }
    }

    /** Lists the folder again (photos added or removed in the Finder meanwhile). */
    func reload() {
        guard let folder else { return }
        files = Self.photos(in: folder)
    }

    /** The photo [delta] places from the open one, if there is one. */
    func neighbour(_ delta: Int) -> URL? {
        guard let current, let i = files.firstIndex(of: current), files.indices.contains(i + delta) else { return nil }
        return files[i + delta]
    }

    /** The folder's photos (directory entries only: no file is read), in name order, a JPEG beside its raw left out. */
    static func photos(in folder: URL) -> [URL] {
        let all = (try? FileManager.default.contentsOfDirectory(at: folder, includingPropertiesForKeys: nil,
                                                                 options: [.skipsHiddenFiles, .skipsPackageDescendants])) ?? []
        let photos = DesktopModel.photoFiles(in: all.filter { !$0.hasDirectoryPath })
        let rawStems = Set(photos.filter(isRaw).map(stem))
        return photos.filter { isRaw($0) || !rawStems.contains(stem($0)) }
            .sorted { $0.lastPathComponent.localizedStandardCompare($1.lastPathComponent) == .orderedAscending }
    }

    private nonisolated static func isRaw(_ u: URL) -> Bool {
        UTType(filenameExtension: u.pathExtension.lowercased())?.conforms(to: .rawImage) ?? false
    }

    private nonisolated static func stem(_ u: URL) -> String { u.deletingPathExtension().lastPathComponent.lowercased() }
}

/** The strip under Pro's photo; nothing when the folder has only the open photo. */
struct FilmstripView: View {
    @ObservedObject var strip: Filmstrip
    let open: (URL) -> Void

    static let height: CGFloat = 78

    var body: some View {
        if strip.files.count > 1 {
            VStack(spacing: 0) {
                Divider()
                ScrollViewReader { proxy in
                    ScrollView(.horizontal) {
                        LazyHStack(spacing: 6) {
                            ForEach(strip.files, id: \.self) { url in
                                FilmstripCell(url: url, selected: url == strip.current) { open(url) }.id(url)
                            }
                        }
                        .padding(.horizontal, 12)
                        .padding(.vertical, 6)
                    }
                    .scrollIndicators(.never)
                    .background(WheelScrollsSideways())
                    .onAppear { if let c = strip.current { proxy.scrollTo(c, anchor: .center) } }
                    .onChange(of: strip.current) { _, c in
                        if let c { Motion.animate { proxy.scrollTo(c, anchor: .center) } }
                    }
                }
                .frame(height: Self.height)
            }
            .accessibilityElement(children: .contain)
            .accessibilityLabel("Photos in this folder")
        }
    }
}

private struct FilmstripCell: View {
    let url: URL
    let selected: Bool
    let action: () -> Void
    @State private var thumb: CGImage?
    @State private var online = false

    var body: some View {
        Button(action: action) {
            ZStack {
                Color(white: 0.12)
                if let thumb {
                    Image(decorative: thumb, scale: 1).resizable().scaledToFit()
                } else if online {
                    Image(systemName: "icloud").foregroundStyle(.secondary)
                }
            }
            .frame(width: 96, height: 64)
            .clipShape(RoundedRectangle(cornerRadius: 3))
            .overlay(RoundedRectangle(cornerRadius: 3).stroke(selected ? Color.accentColor : .clear, lineWidth: 2))
            .opacity(selected ? 1 : 0.8)
        }
        .buttonStyle(.plain)
        .help(url.lastPathComponent)
        .accessibilityLabel(url.lastPathComponent)
        .accessibilityAddTraits(selected ? .isSelected : [])
        .task(id: url) {
            if FilmstripThumbs.isOnlineOnly(url) {
                // Reading a cloud placeholder downloads it: the strip only shows that it is there.
                online = true
                return
            }
            thumb = await FilmstripThumbs.shared.thumbnail(url)
        }
    }
}

/** Thumbnails from the files' embedded previews, kept in memory by path and modified date. */
final class FilmstripThumbs: @unchecked Sendable {
    static let shared = FilmstripThumbs()
    private let cache = NSCache<NSString, CGImage>()

    init() { cache.countLimit = 400 }

    func thumbnail(_ url: URL) async -> CGImage? {
        let date = (try? url.resourceValues(forKeys: [.contentModificationDateKey]))?.contentModificationDate
        let key = "\(url.path)|\(date?.timeIntervalSince1970 ?? 0)" as NSString
        if let hit = cache.object(forKey: key) { return hit }
        let image = await Task.detached(priority: .utility) { Self.make(url) }.value
        if let image { cache.setObject(image, forKey: key) }
        return image
    }

    /** About twice the cell's size for a Retina screen. */
    private static let maxPixels = 240

    /**
     * The embedded thumbnail when it is big enough and the photo's own shape (cameras' EXIF thumbnails are 160 × 120,
     * letterboxed for portrait photos), else one ImageIO makes from the larger preview or the image.
     */
    private static func make(_ url: URL) -> CGImage? {
        guard let src = CGImageSourceCreateWithURL(url as CFURL, [kCGImageSourceShouldCache: false] as CFDictionary) else { return nil }
        func thumb(always: Bool) -> CGImage? {
            let options: [CFString: Any] = [
                always ? kCGImageSourceCreateThumbnailFromImageAlways : kCGImageSourceCreateThumbnailFromImageIfAbsent: true,
                kCGImageSourceThumbnailMaxPixelSize: maxPixels,
                kCGImageSourceCreateThumbnailWithTransform: true,
            ]
            return CGImageSourceCreateThumbnailAtIndex(src, 0, options as CFDictionary)
        }
        if let t = thumb(always: false), max(t.width, t.height) >= maxPixels * 3 / 4, fits(t, src) { return t }
        return thumb(always: true)
    }

    /** Whether [t] has the photo's shape (within 5%), turned as the photo is shown. */
    private static func fits(_ t: CGImage, _ src: CGImageSource) -> Bool {
        guard let p = CGImageSourceCopyPropertiesAtIndex(src, 0, nil) as? [CFString: Any],
              let w = p[kCGImagePropertyPixelWidth] as? Double, let h = p[kCGImagePropertyPixelHeight] as? Double, w > 0, h > 0
        else { return true }
        let orientation = p[kCGImagePropertyOrientation] as? Int ?? 1
        let aspect = orientation >= 5 ? h / w : w / h
        return abs(Double(t.width) / Double(t.height) / aspect - 1) < 0.05
    }

    /** An iCloud or File Provider placeholder whose data isn't on this Mac. */
    static func isOnlineOnly(_ url: URL) -> Bool {
        var st = stat()
        guard stat(url.path, &st) == 0 else { return false }
        return st.st_flags & 0x4000_0000 != 0  // SF_DATALESS
    }
}

/**
 * A mouse wheel's vertical turn scrolls the strip sideways: a horizontal SwiftUI ScrollView ignores it otherwise (RawBoy
 * Viewer's filmstrip does the same). Trackpads, which scroll sideways themselves, are left alone.
 */
private struct WheelScrollsSideways: NSViewRepresentable {
    func makeNSView(context: Context) -> WheelView { WheelView() }
    func updateNSView(_ view: WheelView, context: Context) {}

    final class WheelView: NSView {
        private var monitor: Any?
        /** One notch moves about a third of a thumbnail. */
        private static let factor = 4.0

        override func viewDidMoveToWindow() {
            super.viewDidMoveToWindow()
            if let monitor { NSEvent.removeMonitor(monitor) }
            monitor = nil
            guard window != nil else { return }
            monitor = NSEvent.addLocalMonitorForEvents(matching: .scrollWheel) { [weak self] event in
                MainActor.assumeIsolated { self?.sideways(event) ?? event }
            }
        }

        private func sideways(_ event: NSEvent) -> NSEvent {
            guard event.window === window, !event.hasPreciseScrollingDeltas, event.scrollingDeltaY != 0,
                  event.scrollingDeltaX == 0, bounds.contains(convert(event.locationInWindow, from: nil)),
                  let cg = event.cgEvent?.copy()
            else { return event }
            let fields: [(CGEventField, CGEventField)] = [
                (.scrollWheelEventDeltaAxis1, .scrollWheelEventDeltaAxis2),
                (.scrollWheelEventPointDeltaAxis1, .scrollWheelEventPointDeltaAxis2),
                (.scrollWheelEventFixedPtDeltaAxis1, .scrollWheelEventFixedPtDeltaAxis2),
            ]
            for (vertical, horizontal) in fields {
                cg.setDoubleValueField(horizontal, value: cg.getDoubleValueField(vertical) * Self.factor)
                cg.setDoubleValueField(vertical, value: 0)
            }
            return NSEvent(cgEvent: cg) ?? event
        }

        override func hitTest(_ point: NSPoint) -> NSView? { nil }  // clicks go to the cells
    }
}
