import AppKit
import ImageIO
import RawBoyEngine
import SwiftUI
import ViewerFiles
import ViewerImaging
import enum RawBoyBrowseKit.PhotoGroups

/**
 * Pro's filmstrip: the other photos in the open photo's folder, under the photo, so the next one is a click (or ← →) away
 * instead of a trip through the Open panel. The list and the thumbnails are RawBoy Viewer's (`FolderScanner` and
 * `PhotoGroups`: file name order, a RAW + JPEG pair once, as the raw; `ThumbnailStore`: embedded previews, never a develop,
 * kept on disk). Directory entries only: no file is read.
 */
@MainActor
final class Filmstrip: ObservableObject {
    @Published private(set) var files: [URL] = []
    /** The photo open in the editor (set as it starts opening). */
    @Published private(set) var current: URL?
    /** Cloud placeholders (their data isn't on this Mac): the strip shows that they are there and reads nothing. */
    private(set) var onlineOnly: Set<URL> = []
    private var folder: URL?
    let thumbnails = ThumbnailStore(pixelSize: 240)

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
        let scanned = (try? FolderScanner.photos(in: folder)) ?? []
        files = PhotoGroups.group(scanned.map(\.url.lastPathComponent)).map { folder.appendingPathComponent($0.main) }
        onlineOnly = Set(scanned.filter(\.isOnlineOnly).map(\.url))
    }

    /** The photo [delta] places from the open one, if there is one. */
    func neighbour(_ delta: Int) -> URL? {
        guard let current, let i = files.firstIndex(of: current), files.indices.contains(i + delta) else { return nil }
        return files[i + delta]
    }
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
                                FilmstripCell(strip: strip, url: url, selected: url == strip.current) { open(url) }.id(url)
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
    let strip: Filmstrip
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
            if strip.onlineOnly.contains(url) {
                // Reading a cloud placeholder downloads it: the strip only shows that it is there.
                online = true
                return
            }
            thumb = await strip.thumbnails.thumbnail(url)?.cgImage
        }
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
