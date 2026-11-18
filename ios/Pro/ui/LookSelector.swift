import RawBoyEngine
import SwiftUI

/**
 * Look selector (port of the web's `ui/pro/LookSelector.tsx`): click the photo and the area there is shown through every
 * LUT and film stock at once, as vertical stripes of one continuous picture, each labelled; click a stripe to make that
 * the photo's look. Drag the window (its bar or the stripes) and the stripes follow the area under it; drag its corner to
 * resize it (remembered; double-click the corner for the default size). ← → or the bar's arrows turn the page, Esc closes.
 *
 * Each look of the page is developed once over the whole preview by the off-screen developer, with the photo's own
 * parameters and textures and only the LUT or film stock swapped, so a stripe is the preview's pixels as the photo would
 * show them; moving the window only redraws.
 */
struct LookSelector: View {
    @ObservedObject var vm: EditorViewModel
    @ObservedObject var session: PhotoSession
    /** Width of the frame round the photo in the fit view, points. */
    let frame: CGFloat
    /** Where the window opens: the clicked point, in the preview's points. */
    let at: CGPoint
    let onClose: () -> Void
    /** ← → from the keyboard (RawBoy Desktop): each new [PageStep] turns the page by its delta. */
    var pageStep = PageStep()

    struct PageStep: Equatable {
        var serial = 0
        var delta = 0
    }

    @Environment(\.displayScale) private var displayScale
    @State private var page: Int?
    @State private var pos: CGPoint?
    @State private var dragStart: CGPoint?
    @State private var resizeStart: CGSize?
    @State private var userSize: CGSize? = LookSelector.loadSize()
    @State private var hovered: Int?
    @State private var looks: [String: CGImage] = [:]
    @State private var looksKey: CacheKey?
    @State private var loading = false

    // The web's numbers (CSS px there, points here).
    private static let minStripe: CGFloat = 176
    private static let maxPerPage = 8
    private static let maxWidth: CGFloat = 2400
    private static let maxHeight: CGFloat = 360
    private static let minHeight: CGFloat = 140
    private static let maxUserHeight: CGFloat = 1600
    private static let keepIn: CGFloat = 96
    private static let dragSlop: CGFloat = 5
    private static let sizeKey = "pro.lookWindow"
    private static let renderer = ThumbnailRenderer()

    /** A LUT (DevelopParams.lut, nil = no LUT) or a film stock (DevelopParams.film). */
    struct Item: Hashable {
        let film: Bool
        let id: String?
        let name: String
        var key: String { "\(film ? "film" : "lut"):\(id ?? "none")" }
    }

    /** What the developed looks depend on: the photo's edit without its look, and the preview it is drawn from. */
    private struct CacheKey: Equatable {
        let params: DevelopParams
        let defaults: DevelopParams
        let previewWidth: Int
        let previewHeight: Int
        let longEdge: Int
    }

    private var items: [Item] {
        [Item(film: false, id: nil, name: "No LUT")]
            + vm.luts.bundled.map { Item(film: false, id: $0.id, name: $0.name) }
            + vm.luts.user.map { Item(film: false, id: $0.id, name: $0.name) }
            + FilmLooks.all.compactMap { l in l.film.map { Item(film: true, id: $0, name: l.name) } }
    }

    /** The photo's parameters showing [item]: a LUT turns Film off, a stock turns it on (full strength if it was off). */
    static func withLook(_ p: DevelopParams, _ item: Item) -> DevelopParams {
        var q = p
        if item.film {
            q.film = item.id
            if p.film == nil { q.filmAmount = 100 }
        } else {
            q.film = nil
            q.lut = item.id
        }
        return q
    }

    private static func isCurrent(_ p: DevelopParams, _ item: Item) -> Bool {
        item.film ? p.film == item.id : p.film == nil && p.lut == item.id
    }

    var body: some View {
        GeometryReader { geo in
            if let picture = picture(geo.size), let visible = visible(picture, geo.size) {
                window(geo.size, picture, visible)
            }
        }
        // Drags are measured in the preview's space, which stays put: in the window's own space, which moves with the
        // drag, every move shifted the origin it was measured from and the window jumped back and forth.
        .coordinateSpace(name: Self.space)
    }

    private static let space = "lookSelector"

    // MARK: - Geometry (points in the preview)

    /** The picture inside the preview: the fit rectangle, or the zoomed view's (bigger than the preview). */
    private func picture(_ box: CGSize) -> CGRect? {
        guard session.preview != nil, box.width > 0 else { return nil }
        let lens = session.lensFor(vm.state.params)
        let s = displayScale
        let vw = Int((box.width * s).rounded()), vh = Int((box.height * s).rounded())
        let fw = Int((frame * s).rounded())
        let r = session.zoomCenter.map {
            ZoomMath.zoomedRect(cx: $0.0, cy: $0.1, viewW: vw, viewH: vh, imgW: lens.outputWidth, imgH: lens.outputHeight,
                                scale: session.zoomScale, frame: fw)
        } ?? ZoomMath.fitRect(viewW: vw, viewH: vh, imgW: lens.outputWidth, imgH: lens.outputHeight, frame: fw)
        return CGRect(x: CGFloat(r[0]) / s, y: CGFloat(r[1]) / s, width: CGFloat(r[2]) / s, height: CGFloat(r[3]) / s)
    }

    private func visible(_ picture: CGRect, _ box: CGSize) -> CGRect? {
        let v = picture.intersection(CGRect(origin: .zero, size: box))
        return v.width >= 40 && v.height >= 40 ? v : nil
    }

    private func clampW(_ w: CGFloat, _ visible: CGRect) -> CGFloat {
        floor(min(max(w, min(Self.minStripe * 2, visible.width)), min(visible.width, Self.maxWidth)))
    }

    private func clampH(_ h: CGFloat, _ visible: CGRect) -> CGFloat {
        floor(min(max(h, min(Self.minHeight, visible.height)), min(visible.height, Self.maxUserHeight)))
    }

    private func zone(_ visible: CGRect) -> CGSize {
        if let userSize { return CGSize(width: clampW(userSize.width, visible), height: clampH(userSize.height, visible)) }
        return CGSize(width: floor(min(visible.width, Self.maxWidth)),
                      height: floor(max(min(visible.height, Self.minHeight), min(visible.height * 0.6, Self.maxHeight))))
    }

    // MARK: - The window

    @ViewBuilder
    private func window(_ box: CGSize, _ picture: CGRect, _ visible: CGRect) -> some View {
        let all = items
        let size = zone(visible)
        let perPage = max(1, min(all.count, Self.maxPerPage, Int(size.width / Self.minStripe)))
        let pages = (all.count + perPage - 1) / perPage
        let current = max(0, all.firstIndex { Self.isCurrent(vm.state.params, $0) } ?? 0)
        let shownPage = min(max(0, page ?? current / perPage), pages - 1)
        let shown = Array(all[(shownPage * perPage)..<min(all.count, (shownPage + 1) * perPage)])
        // Opens centred on the click; it may hang over the photo's edges (and the preview's) but keeps keepIn in view.
        let p = pos ?? CGPoint(x: at.x - size.width / 2, y: at.y - size.height / 2)
        let left = min(max(p.x, Self.keepIn - size.width), box.width - Self.keepIn)
        let top = min(max(p.y, 0), box.height - Self.keepIn)
        let hangRight = max(0, left + size.width - box.width)
        let hangBottom = max(0, top + size.height - box.height)
        let longEdge = Int((max(picture.width, picture.height) * displayScale).rounded())

        ZStack(alignment: .topLeading) {
            Canvas { ctx, canvasSize in
                let n = shown.count
                // Only the picture is drawn; the window over the grey frame or past the preview stays empty.
                let clip = picture.intersection(CGRect(origin: .zero, size: box)).offsetBy(dx: -left, dy: -top)
                let target = picture.offsetBy(dx: -left, dy: -top)
                for (i, item) in shown.enumerated() {
                    let x0 = (CGFloat(i) * canvasSize.width / CGFloat(n)).rounded()
                    let x1 = (CGFloat(i + 1) * canvasSize.width / CGFloat(n)).rounded()
                    let stripe = CGRect(x: x0, y: 0, width: x1 - x0, height: canvasSize.height).intersection(clip)
                    guard !stripe.isNull, !stripe.isEmpty, let image = looks[item.key] else { continue }
                    ctx.drawLayer { c in
                        c.clip(to: Path(stripe))
                        c.draw(Image(decorative: image, scale: 1), in: target)
                    }
                }
            }
            HStack(spacing: 0) {
                ForEach(Array(shown.enumerated()), id: \.element) { i, item in
                    stripe(item, isCurrent: Self.isCurrent(vm.state.params, item), hovered: hovered == i, last: i == shown.count - 1)
                }
            }
            .padding(.bottom, hangBottom)
            bar(shownPage, pages, loading: loading)
                .padding(.leading, max(0, -left))
                .padding(.trailing, hangRight)
            resizeHandle(visible)
        }
        .frame(width: size.width, height: size.height)
        .background(Color(white: 0.067))
        .clipShape(RoundedRectangle(cornerRadius: 6))
        .overlay(RoundedRectangle(cornerRadius: 6).strokeBorder(Color.white.opacity(0.55), lineWidth: 1))
        .shadow(color: .black.opacity(0.55), radius: 12, y: 6)
        .contentShape(Rectangle())
        .onContinuousHover { phase in
            if case let .active(point) = phase, point.y > 30 {
                hovered = min(shown.count - 1, max(0, Int(point.x / size.width * CGFloat(shown.count))))
            } else {
                hovered = nil
            }
        }
        .gesture(
            DragGesture(minimumDistance: 0, coordinateSpace: .named(Self.space))
                .onChanged { g in
                    if dragStart == nil { dragStart = CGPoint(x: left, y: top) }
                    guard hypot(g.translation.width, g.translation.height) >= Self.dragSlop, let s = dragStart else { return }
                    pos = CGPoint(x: s.x + g.translation.width, y: s.y + g.translation.height)
                }
                .onEnded { g in
                    dragStart = nil
                    // A press that stayed put picks the stripe under it (not on the bar).
                    let x = g.location.x - left
                    let y = g.location.y - top
                    guard hypot(g.translation.width, g.translation.height) < Self.dragSlop, y > 30 else { return }
                    let i = min(shown.count - 1, max(0, Int(x / size.width * CGFloat(shown.count))))
                    vm.setLook(Self.withLook(vm.state.params, shown[i]))
                    onClose()
                })
        .offset(x: left, y: top)
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Look selector")
        .task(id: TaskKey(page: shownPage, perPage: perPage, cache: cacheKey(longEdge))) {
            await develop(shown, cacheKey(longEdge))
        }
        .onChange(of: pageStep) { _, step in
            page = min(max(0, shownPage + step.delta), pages - 1)
        }
    }

    private struct TaskKey: Equatable {
        let page: Int
        let perPage: Int
        let cache: CacheKey?
    }

    private func stripe(_ item: Item, isCurrent: Bool, hovered: Bool, last: Bool) -> some View {
        ZStack(alignment: .bottom) {
            Rectangle().fill(hovered ? Color.white.opacity(0.12) : Color.clear)
            if item.film {
                Text("FILM")
                    .font(.system(size: 10)).tracking(0.4)
                    .padding(.horizontal, 5).padding(.vertical, 1)
                    .background(Color.black.opacity(0.55), in: RoundedRectangle(cornerRadius: 3))
                    .frame(maxHeight: .infinity, alignment: .top)
                    .padding(.top, 34)
            }
            Text(item.name)
                .font(.system(size: 12))
                .lineLimit(2)
                .multilineTextAlignment(.center)
                .foregroundStyle(isCurrent ? Color.accentColor : Color.white)
                .shadow(color: .black.opacity(0.9), radius: 2)
                .padding(.horizontal, 4)
                .padding(.bottom, 6)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .overlay(
            (isCurrent || hovered) ? RoundedRectangle(cornerRadius: 0).strokeBorder(Color.accentColor, lineWidth: 2) : nil)
        .overlay(alignment: .trailing) { if !last { Rectangle().fill(Color.white.opacity(0.35)).frame(width: 1) } }
        .help(item.film ? "\(item.name) (film)" : item.name)
        .accessibilityElement()
        .accessibilityLabel("Use \(item.name)")
        .accessibilityAddTraits(isCurrent ? [.isButton, .isSelected] : .isButton)
    }

    private func bar(_ shownPage: Int, _ pages: Int, loading: Bool) -> some View {
        HStack(spacing: 8) {
            Text(loading ? "Looks …" : "Looks").font(.caption.weight(.semibold))
            if pages > 1 {
                Button { page = max(0, shownPage - 1) } label: { Image(systemName: "chevron.left") }
                    .disabled(shownPage == 0)
                    .accessibilityLabel("Previous looks")
                Text("\(shownPage + 1)/\(pages)").font(.caption.monospacedDigit())
                Button { page = min(pages - 1, shownPage + 1) } label: { Image(systemName: "chevron.right") }
                    .disabled(shownPage >= pages - 1)
                    .accessibilityLabel("Next looks")
            }
            Spacer(minLength: 0)
            Button(action: onClose) { Image(systemName: "xmark") }
                .accessibilityLabel("Close")
                .help("Close (Esc)")
        }
        .buttonStyle(.plain)
        .foregroundStyle(.white)
        .padding(.horizontal, 10)
        .frame(height: 28)
        .background(Color.black.opacity(0.6))
    }

    private func resizeHandle(_ visible: CGRect) -> some View {
        Image(systemName: "arrow.up.left.and.arrow.down.right")
            .font(.system(size: 10, weight: .semibold))
            .foregroundStyle(.white.opacity(0.8))
            .frame(width: 22, height: 22)
            .background(Color.black.opacity(0.5), in: RoundedRectangle(cornerRadius: 4))
            .padding(4)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottomTrailing)
            .help("Drag to resize; double-click for the default size")
            .accessibilityLabel("Resize the Looks window")
            .onTapGesture(count: 2) {
                userSize = nil
                Self.saveSize(nil)
            }
            .highPriorityGesture(
                DragGesture(minimumDistance: 1, coordinateSpace: .named(Self.space))
                    .onChanged { g in
                        let start = resizeStart ?? zone(visible)
                        if resizeStart == nil { resizeStart = start }
                        userSize = CGSize(width: clampW(start.width + g.translation.width, visible),
                                          height: clampH(start.height + g.translation.height, visible))
                    }
                    .onEnded { _ in
                        resizeStart = nil
                        Self.saveSize(userSize)
                    })
    }

    // MARK: - Developing the looks

    private func cacheKey(_ longEdge: Int) -> CacheKey? {
        guard let preview = session.preview else { return nil }
        var p = vm.state.params
        p.lut = nil
        p.film = nil
        return CacheKey(params: p, defaults: vm.state.defaults, previewWidth: preview.width, previewHeight: preview.height,
                        longEdge: longEdge)
    }

    /** Develops every look of the page not developed yet for [key], one after another, drawing each as it comes. */
    private func develop(_ shown: [Item], _ key: CacheKey?) async {
        guard let key, let preview = session.preview else { return }
        if looksKey != key {
            looks = [:]
            looksKey = key
        }
        let missing = shown.filter { looks[$0.key] == nil }
        guard !missing.isEmpty else { return }
        loading = true
        defer { loading = false }
        let params = vm.state.params
        for item in missing {
            do {
                var lut: LutData?
                var film: FilmData?
                if let id = item.id {
                    if item.film { film = try await Self.film(id) } else { lut = try await Self.lut(id) }
                }
                if Task.isCancelled { return }
                let sp = session.shaderParams(Self.withLook(params, item), defaults: key.defaults, lut: lut,
                                              useSelectedLut: false, film: film)
                let image = try await Self.renderer.render(sp, preview: preview, maxDimension: key.longEdge)
                if Task.isCancelled || looksKey != key { return }
                looks[item.key] = image
            } catch {
                continue  // that stripe stays empty
            }
        }
    }

    /** LUTs and film stocks parsed for the stripes (a page needs more than the session's own cache of four). */
    @MainActor private static var luts: [String: LutData] = [:]
    @MainActor private static var lutOrder: [String] = []
    @MainActor private static var films: [String: FilmData] = [:]

    @MainActor private static func lut(_ id: String) async throws -> LutData {
        if let l = luts[id] { return l }
        let data = try await Task.detached(priority: .userInitiated) { try LutLoader.load(id) }.value
        luts[id] = data
        lutOrder.append(id)
        if lutOrder.count > 48 { luts[lutOrder.removeFirst()] = nil }
        return data
    }

    @MainActor private static func film(_ id: String) async throws -> FilmData {
        if let f = films[id] { return f }
        let data = try await Task.detached(priority: .userInitiated) {
            guard let stock = try FilmStocks.byId(id) else { throw RawImageError(message: "Unknown film stock \(id)") }
            return try FilmStocks.load(stock)
        }.value
        films[id] = data
        return data
    }

    // MARK: - Remembered size

    private static func loadSize() -> CGSize? {
        guard let v = UserDefaults.standard.array(forKey: sizeKey) as? [Double], v.count == 2 else { return nil }
        return CGSize(width: v[0], height: v[1])
    }

    private static func saveSize(_ size: CGSize?) {
        if let size {
            UserDefaults.standard.set([Double(size.width), Double(size.height)], forKey: sizeKey)
        } else {
            UserDefaults.standard.removeObject(forKey: sizeKey)
        }
    }
}
