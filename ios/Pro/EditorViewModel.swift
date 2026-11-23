import Combine
import Foundation
import RawBoyEngine
#if canImport(UIKit)
import UIKit
#endif

struct EditorState: Equatable {
    var loading = false
    var exporting = false
    /** The Auto button is working out the auto develop. */
    var autoRunning = false
    var exportProgress: Float = 0
    var fileName: String?
    var info: String?
    var params = DevelopParams()
    /** As-shot defaults for the current image (reset target, WB reference). */
    var defaults = DevelopParams()
    var canUndo = false
    var canRedo = false

    var hasImage: Bool { fileName != nil && !loading }
    var busy: Bool { loading || exporting || autoRunning }
}

/** Brush settings for new strokes ([radius]: fraction of the image's long side). */
struct BrushSettings: Equatable {
    var radius: Float = 0.03
    var hardness: Float = 50
    var flow: Float = 100
    var auto = false
}

/** Which kind of mask layer to add. */
enum MaskKind { case linear, radial, stripe, brush }

@MainActor
final class EditorViewModel: ObservableObject {
    @Published private(set) var state = EditorState()
    @Published var message: String?
    @Published private(set) var exportSettings = ExportSettingsStore.load()
    @Published private(set) var presets: [Preset] = []
    @Published private(set) var luts = LutLibrary()
    /** Frame around the photo in the fit view; tap outside the photo to cycle it. Remembered. */
    @Published private(set) var frameColor: FrameColor
    /** Brush settings for new strokes, remembered. */
    @Published private(set) var brush: BrushSettings
    /** RGB levels of the developed photo (the edit, whole crop, no mask view), shown above the slider tabs. */
    @Published private(set) var histogram: Histogram?
    /** Clipped highlights red and crushed shadows blue on the preview; tap the histogram. Not remembered. */
    @Published private(set) var clipWarning = false
    /** The last file exported into a folder (RawBoy Desktop), for Show in Finder. */
    @Published private(set) var lastExport: URL?

    /** The open photo; the pipeline state comes from it. */
    let session: PhotoSession
    /** Lens corrections from the Lensfun database (Lens tab). */
    let lensfun: LensfunStore
    /** The app's copy of the open file (deleted when the next one opens). RawBoy Desktop opens the file in place. */
    private var source: URL?
    /** The open photo's file. */
    var currentURL: URL? { source }
    /** RawBoy Desktop: keeps each photo's edits in its sidecar; nil on iOS. */
    var persistence: EditsPersistence?
    private var frameWidth = 0
    private let defaults = UserDefaults.standard
    /** This photo's edits, for Undo and Redo. */
    private var history = EditHistory<DevelopParams>()

    /** What the histogram was last made from, so a pan or zoom tile (session changes too) doesn't redo it. */
    private struct HistogramKey: Equatable {
        let params: DevelopParams
        let defaults: DevelopParams
        let lut: String?
        let film: String?
        let skin: Bool
        /** The lens data in use (a Lensfun profile swaps it). */
        let lens: ObjectIdentifier
        let baseWidth: Int
        let baseHeight: Int
    }
    private let histogramRenderer = ThumbnailRenderer()
    private var histogramTask: Task<Void, Never>?
    private var histogramKey: HistogramKey?
    private var sessionWatch: AnyCancellable?
    private var presetsWatch: AnyCancellable?

    init() {
        var onMessage: (String) -> Void = { _ in }
        var filmLoader: (String) async throws -> FilmData = { _ in throw RawImageError(message: "no film loader") }
        let photo = PhotoSession(filmLoader: { try await filmLoader($0) }, onMessage: { onMessage($0) })
        session = photo
        lensfun = LensfunStore(session: photo)
        frameColor = FrameColor.allCases.first { "\($0)" == UserDefaults.standard.string(forKey: "display.frame") } ?? .grey
        let d = BrushSettings()
        let s = UserDefaults.standard
        func f(_ k: String, _ v: Float) -> Float { s.object(forKey: k) as? Float ?? v }
        brush = BrushSettings(
            radius: min(max(f("brush.radius", d.radius), Masks.minBrushRadius), Masks.maxBrushRadius),
            hardness: min(max(f("brush.hardness", d.hardness), 0), 100),
            flow: min(max(f("brush.flow", d.flow), 1), 100),
            auto: s.bool(forKey: "brush.auto"))
        onMessage = { [weak self] in self?.message = $0 }
        // An estimated depth map focuses on its subject, unless a focus depth was already picked (it becomes the default).
        photo.onDepthEstimated = { [weak self] focus in
            guard let self else { return }
            let untouched = self.state.params.depthFocus == self.state.defaults.depthFocus
            self.state.defaults.depthFocus = focus
            if untouched {
                var p = self.state.params
                p.depthFocus = focus
                self.show(p)
            }
        }
        filmLoader = { [unowned self] in try await self.loadFilm($0) }
        presets = PresetStore.load()
        // RawBoy Desktop: Auto saves lens presets into the same file (picked from a sidecar, or removed there).
        presetsWatch = NotificationCenter.default.publisher(for: PresetStore.changed).sink { [weak self] _ in
            MainActor.assumeIsolated {
                guard let self else { return }
                let list = PresetStore.load()
                if list != self.presets { self.presets = list }
            }
        }
        // The histogram follows what the session loads (photo, LUT, film stock, skin mask) as well as the edits.
        sessionWatch = session.objectWillChange.sink { [weak self] _ in
            MainActor.assumeIsolated { self?.scheduleHistogram() }
        }
    }

    // MARK: - Histogram

    func toggleClipWarning() { clipWarning.toggle() }

    /** Redoes the histogram once the edits rest for ~150 ms (a slider drag would otherwise render every step). */
    private func scheduleHistogram() {
        histogramTask?.cancel()
        histogramTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 150_000_000)
            guard !Task.isCancelled else { return }
            await self?.renderHistogram()
        }
    }

    /** Develops the session's 512 px base at 256 px with the current edit and counts its levels. */
    private func renderHistogram() async {
        guard state.hasImage, session.hasImage, let base = session.base else {
            histogram = nil
            histogramKey = nil
            return
        }
        let key = HistogramKey(params: state.params, defaults: state.defaults, lut: session.lutData?.id,
                               film: session.filmData?.stock.id, skin: session.skin.mask != nil, lens: ObjectIdentifier(session.lensInfo),
                               baseWidth: base.width, baseHeight: base.height)
        if key == histogramKey && histogram != nil { return }
        let shader = session.shaderParams(state.params, defaults: state.defaults)
        guard let image = try? await histogramRenderer.render(shader, preview: base, maxDimension: 256),
              !Task.isCancelled else { return }
        histogram = Histogram(image: image)
        histogramKey = key
    }

    /** [initial]: the edits to start from (RawBoy Desktop's Edit in Pro: Auto's develop), in place of the sidecar's. */
    func open(_ url: URL, initial: DevelopParams? = nil) {
        if state.busy { return }
        persistence?.flush()  // the photo that is leaving
        state.loading = true
        Task {
            do {
                let previous = state
                #if os(macOS)
                // RawBoy Desktop starts every photo from its own sidecar or as shot; ⇧C / the bar's Copy takes the previous photo's edits.
                let opened = try await session.open(url) { initial ?? persistence?.restore(url, defaults: $0) ?? $0 }
                if let name = previous.fileName, name != url.lastPathComponent {
                    previousEdits = PreviousEdits(name: name, params: previous.params, defaults: previous.defaults)
                }
                #else
                let opened = try await session.open(url) { initial ?? persistence?.restore(url, defaults: $0) ?? carryOverEdits(previous.params, previous.defaults, $0) }
                #endif
                if let old = source, old != url { Imports.delete(old) }
                source = url
                state.loading = false
                state.fileName = url.lastPathComponent
                state.info = opened.description
                state.params = opened.params
                state.defaults = opened.defaults
                history.clear()
                state.canUndo = false
                state.canRedo = false
                session.selectLut(opened.params.lut) { [weak self] in self?.message = $0 }
                // The Film tone mapper, carried over from the previous photo.
                loadSelectedFilm(opened.params.film)
                lensfun.photoOpened(session.metadata)
                scheduleHistogram()
            } catch {
                state.loading = false
                Imports.delete(url)
                message = error.localizedDescription
            }
        }
    }

    /** The frame around the photo: grey, white, black (D). */
    func cycleFrame() {
        frameColor = frameColor.next()
        defaults.set("\(frameColor)", forKey: "display.frame")
    }

    /** Single tap in the preview: outside the photo (fit view) cycles the frame colour. */
    func onPreviewTap(_ x: Float, _ y: Float) {
        if session.zoomCenter != nil || !session.hasImage { return }
        if session.fitToImage(x, y, frameWidth: frameWidth) != nil { return }
        frameColor = frameColor.next()
        defaults.set("\(frameColor)", forKey: "display.frame")
    }

    func setViewSize(_ width: Int, _ height: Int, frame: Int) {
        frameWidth = frame
        session.setViewSize(width, height, frame: frame)
    }

    /** Double tap: zoom to 100% at the tapped point of the fit view, or back out. [extra]: margin around the frame. */
    func toggleZoom(_ x: Float, _ y: Float, extra: Int = 0) { session.toggleZoom(x, y, frameWidth: frameWidth + extra) }

    /** Pinch: zoom by [factor] around (x, y) in view pixels. [extra]: margin around the frame, as for [toggleZoom]. */
    func zoomBy(_ x: Float, _ y: Float, factor: Float, extra: Int = 0) {
        session.zoomBy(x, y, factor: factor, frameWidth: frameWidth + extra)
    }

    /**
     * White balance picker: sets temperature and tint so the tapped spot of the preview (fit or 100% view) renders
     * neutral grey.
     */
    func pickWhite(_ x: Float, _ y: Float) {
        guard state.hasImage, !state.busy else { return }
        let fileName = state.fileName
        let defaults = state.defaults
        Task {
            guard let pick = await session.pickWhite(x, y, frameWidth: frameWidth, defaults: defaults),
                  state.fileName == fileName else { return }
            switch pick {
            case let .white(kelvin, tint): edit(force: true) { $0.temperature = kelvin; $0.tint = tint }
            case .clipped: message = "That spot is blown out: pick a grey that isn't clipped"
            case .notNeutral: message = "No white balance makes that spot grey"
            }
        }
    }

    /** Auto white balance for an area of the photo ([rect]: fractions of the picture shown); [force]: its own undo step. */
    func autoWhiteBalance(_ rect: CropRect, force: Bool = false) {
        guard state.hasImage, !state.busy, let pick = session.autoWhite(rect, defaults: state.defaults) else { return }
        switch pick {
        case let .white(kelvin, tint): edit(force: force) { $0.temperature = kelvin; $0.tint = tint }
        case .clipped: message = "That region is blown out: pick an area that isn't clipped"
        case .notNeutral: message = "No white balance makes that area grey"
        }
    }

    /** White balance (temperature and tint) back to as shot. */
    func resetWhiteBalance() {
        let d = state.defaults
        edit(force: true) { $0.temperature = d.temperature; $0.tint = d.tint }
    }

    /** Drag in the zoomed view, in view pixels. */
    func pan(_ dx: Float, _ dy: Float) { session.pan(dx, dy) }

    func exitZoom() { session.exitZoom() }

    /**
     * Edits from the previous file carry over to the next one. White balance only
     * carries over if the user changed it; otherwise the new file's as-shot WB is used.
     */
    private func carryOverEdits(_ previousParams: DevelopParams, _ previousDefaults: DevelopParams, _ newDefaults: DevelopParams) -> DevelopParams {
        // Rotation, flips, straightening, perspective, crop, masks, light leaks, light effects and healing strokes belong to one photo.
        var p = previousParams
        p.rotation = newDefaults.rotation
        p.flipHorizontal = newDefaults.flipHorizontal
        p.flipVertical = newDefaults.flipVertical
        p.straighten = newDefaults.straighten
        p.perspectiveVertical = newDefaults.perspectiveVertical
        p.perspectiveHorizontal = newDefaults.perspectiveHorizontal
        p.scale = newDefaults.scale
        p.masks = newDefaults.masks
        p.leaks = newDefaults.leaks
        p.filmLeaks = newDefaults.filmLeaks
        p.fx = newDefaults.fx
        p.healSpots = newDefaults.healSpots
        p = p.withCrop(newDefaults.crop)
        let wbEdited = p.temperature != previousDefaults.temperature || p.tint != previousDefaults.tint
        if !wbEdited {
            p.temperature = newDefaults.temperature
            p.tint = newDefaults.tint
        }
        return p
    }

    /** The edits of the photo that was open before this one (RawBoy Desktop: what Copy previous takes). */
    struct PreviousEdits {
        let name: String
        let params: DevelopParams
        let defaults: DevelopParams
    }

    private(set) var previousEdits: PreviousEdits?

    var canCopyPrevious: Bool { previousEdits != nil && state.hasImage && !state.busy }

    /**
     * Copy previous (⇧C): gives this photo the previous photo's edits, as they used to carry over by themselves. Geometry,
     * masks, leaks, effects and healing stay this photo's own; white balance moves only if it had been changed. One undo step.
     */
    func copyPrevious() {
        guard canCopyPrevious, let previous = previousEdits else { return }
        commit(carryOverEdits(previous.params, previous.defaults, state.defaults), force: true)
        message = "Copied the settings of \(previous.name)"
    }

    /** A slider or drag: quick changes in a row are one undo step. */
    func update(_ params: DevelopParams) { commit(params, force: false) }

    func update(_ change: (inout DevelopParams) -> Void) { edit(force: false, change) }

    /** Applies [params] as an edit; [force] makes it its own undo step (a button, not a drag). */
    private func commit(_ params: DevelopParams, force: Bool) {
        history.record(state.params, force: force)
        show(params)
    }

    private func edit(force: Bool, _ change: (inout DevelopParams) -> Void) {
        var p = state.params
        change(&p)
        commit(p, force: force)
    }

    /** Shows [params], loading a LUT or film stock that changed. */
    private func show(_ params: DevelopParams) {
        let before = state.params
        state.params = params
        if let source { persistence?.changed(source, params: params, defaults: state.defaults) }
        state.canUndo = history.canUndo
        state.canRedo = history.canRedo
        session.setParams(params)
        if params.lut != before.lut { loadSelectedLut(params.lut) }
        if params.film != before.film { loadSelectedFilm(params.film) }
        scheduleHistogram()
    }

    func undo() {
        guard !state.busy, let p = history.undo(state.params) else { return }
        show(p)
    }

    func redo() {
        guard !state.busy, let p = history.redo(state.params) else { return }
        show(p)
    }

    func reset() {
        var p = state.defaults
        p.lut = nil
        p.film = nil
        commit(p, force: true)
    }

    /** Film stocks once loaded (two 33^3 LUTs each, under 1 MB). */
    private var films: [String: FilmData] = [:]
    /** The stock last chosen for the Film tone mapper, so switching back to Film brings it back. */
    private var lastFilm = "portra400"

    private func loadFilm(_ id: String) async throws -> FilmData {
        if let f = films[id] { return f }
        let data = try await Task.detached(priority: .userInitiated) {
            guard let stock = try FilmStocks.byId(id) else { throw RawImageError(message: "Unknown film stock \(id)") }
            return try FilmStocks.load(stock)
        }.value
        films[id] = data
        return data
    }

    /** Tone mapper segments: AgX, Filmic or Sigmoid turn the film off; its stock is kept for next time. */
    func setToneMapper(_ t: ToneMapper) {
        if let f = state.params.film { lastFilm = f }
        edit(force: true) { $0.toneMapper = t; $0.film = nil }
    }

    /** The Film tone mapper with stock [id] (nil = off); turning it on starts at full strength. */
    func selectFilm(_ id: String?) {
        if let id { lastFilm = id }
        let wasOff = state.params.film == nil
        edit(force: true) { p in
            p.film = id
            if id != nil && wasOff { p.filmAmount = 100 }
        }
    }

    /** The Look selector's pick: [next] is the photo's params with another LUT or film stock (one undo step). */
    func setLook(_ next: DevelopParams) {
        if let f = next.film { lastFilm = f }
        commit(next, force: true)
    }

    /** Film segment: the last stock (Portra 400 at first). */
    func useFilm() { selectFilm(state.params.film ?? lastFilm) }

    private func loadSelectedFilm(_ id: String?) {
        session.selectFilm(id) { [weak self] error in
            guard let self else { return }
            if self.state.params.film == id { self.state.params.film = nil }
            self.message = error
        }
    }

    /**
     * Auto: RawBoy Auto's develop (exposure, tone, WB, saturation, denoise, sharpening) on the current edit,
     * without a look; the LUT and everything else the user set stay. Faces steer exposure, as in Auto.
     */
    func applyAuto() {
        guard let base = session.base, state.hasImage, !state.busy else { return }
        state.autoRunning = true
        Task {
            let skin = await session.skinMask()
            let defaults = state.defaults
            let iso = session.iso
            let metered = session.cameraMetered
            let image = session.rawImage
            let auto = await Task.detached(priority: .userInitiated) {
                AutoAnalysis.autoBase(base, skin: skin, iso: iso, defaults: defaults, cameraMetered: metered,
                                      noise: image?.measureNoise() ?? .none)
            }.value
            state.autoRunning = false
            commit(AutoTone.applyTo(state.params, auto), force: true)
        }
    }

    // MARK: - Mask layers (see Masks.swift)

    /** Adds a layer (up to Masks.maxLayers); returns its id, or nil when full. */
    @discardableResult
    func addLayer(_ kind: MaskKind) -> String? {
        let p = state.params
        if p.masks.count >= Masks.maxLayers { return nil }
        let same = p.masks.filter {
            switch ($0.shape, kind) {
            case (.linear, .linear), (.radial, .radial), (.stripe, .stripe), (.brush, .brush): true
            default: false
            }
        }.count
        let base = switch kind {
        case .linear: "Linear"
        case .radial: "Radial"
        case .stripe: "Stripe"
        case .brush: "Brush"
        }
        let name = "\(base) \(same + 1)"
        let layer = switch kind {
        case .linear: Masks.newLinear(name: name)
        case .radial: Masks.newRadial(name: name)
        case .stripe: Masks.newStripe(name: name)
        case .brush: Masks.newBrush(name: name)
        }
        edit(force: true) { $0.masks.append(layer) }
        return layer.id
    }

    /** A layer's slider or handle drag; [force] for a button or a new stroke. */
    func updateLayer(_ id: String, force: Bool = false, _ change: (inout MaskLayer) -> Void) {
        edit(force: force) { p in
            if let i = p.masks.firstIndex(where: { $0.id == id }) { change(&p.masks[i]) }
        }
    }

    func removeLayer(_ id: String) {
        edit(force: true) { $0.masks.removeAll { $0.id == id } }
        session.dropBrush(id)
    }

    // MARK: - Light leaks (see LightLeaks.swift)

    /** Adds a light leak (up to LightLeaks.maxLeaks total with filmLeaks) in the middle; returns its id, or nil when full. */
    @discardableResult
    func addLeak(_ kind: LeakKind = .streak) -> String? {
        if state.params.leaks.count + state.params.filmLeaks.count >= LightLeaks.maxLeaks { return nil }
        let leak = LightLeaks.newLeak(kind)
        edit(force: true) { $0.leaks.append(leak) }
        return leak.id
    }

    /** A leak's slider or drag; [force] for a button (new shape, show/hide). */
    func updateLeak(_ id: String, force: Bool = false, _ change: (inout LightLeak) -> Void) {
        edit(force: force) { p in
            if let i = p.leaks.firstIndex(where: { $0.id == id }) { change(&p.leaks[i]) }
        }
    }

    func removeLeak(_ id: String) {
        edit(force: true) { $0.leaks.removeAll { $0.id == id } }
    }

    // MARK: - Generated film leaks (see FilmLeaks.swift)

    @discardableResult
    func addFilmLeak(_ type: FilmLeakType? = nil, aspect: Float, shortSideSprockets: Bool = false) -> String? {
        if state.params.leaks.count + state.params.filmLeaks.count >= LightLeaks.maxLeaks { return nil }
        let leak = FilmLeaks.random(
            type: type,
            aspect: aspect,
            seed: FilmLeaks.newSeed(),
            grade: state.params.filmLeaks.isEmpty,
            shortSideSprockets: shortSideSprockets
        )
        edit(force: true) { $0.filmLeaks.append(leak) }
        return leak.id
    }

    /** 🎲 Random with a type picked (as web's `rollFilmLeaks`): replaces the selected film leak; with none selected adds one if there is room, else replaces the last. Only + Add makes a new layer on top of existing ones. */
    @discardableResult
    func rollFilmLeak(_ type: FilmLeakType, aspect: Float, selectedId: String?, shortSideSprockets: Bool = false) -> String? {
        let p = state.params
        let room = max(0, LightLeaks.maxLeaks - p.leaks.count)
        guard room > 0 else { return nil }
        let idx = selectedId.flatMap { id in p.filmLeaks.firstIndex { $0.id == id } }
        var leak = FilmLeaks.random(
            type: type, aspect: aspect, seed: FilmLeaks.newSeed(),
            grade: (idx ?? 0) <= 0 && p.filmLeaks.count <= 1,
            shortSideSprockets: shortSideSprockets)
        if let i = idx {
            leak.id = p.filmLeaks[i].id
            edit(force: true) { $0.filmLeaks[i] = leak }
        } else if p.filmLeaks.count < room {
            edit(force: true) { $0.filmLeaks.append(leak) }
        } else if let last = p.filmLeaks.last {
            leak.id = last.id
            edit(force: true) { $0.filmLeaks[$0.filmLeaks.count - 1] = leak }
        } else {
            return nil
        }
        return leak.id
    }

    @discardableResult
    func randomFilmRoll(aspect: Float, shortSideSprockets: Bool = false) -> String? {
        let cap = max(0, LightLeaks.maxLeaks - state.params.leaks.count)
        guard cap > 0 else { return nil }
        let roll = Array(FilmLeaks.randomRoll(aspect: aspect, seed: FilmLeaks.newSeed(), shortSideSprockets: shortSideSprockets).prefix(cap))
        edit(force: true) { $0.filmLeaks = roll }
        return roll.first?.id
    }

    func updateFilmLeak(_ id: String, force: Bool = false, _ change: (inout FilmLeak) -> Void) {
        edit(force: force) { p in
            if let i = p.filmLeaks.firstIndex(where: { $0.id == id }) { change(&p.filmLeaks[i]) }
        }
    }

    func removeFilmLeak(_ id: String) {
        edit(force: true) { $0.filmLeaks.removeAll { $0.id == id } }
    }

    // MARK: - Healing brush (see HealSpots.swift)

    /** Starts a stroke (up to HealSpots.maxSpots); returns its id, nil when full. Healing follows ~300 ms after the edits rest. */
    func addHeal(_ spot: HealSpot) -> String? {
        if state.params.healSpots.count >= HealSpots.maxSpots { return nil }
        edit(force: true) { $0.healSpots.append(spot) }
        return spot.id
    }

    /** A stroke's source dragged or a button ([force]); one history step per [force]d change. */
    func updateHeal(_ id: String, force: Bool = false, _ change: (inout HealSpot) -> Void) {
        edit(force: force) { p in
            if let i = p.healSpots.firstIndex(where: { $0.id == id }) { change(&p.healSpots[i]) }
        }
    }

    /** Part of the step addHeal started, however slow the stroke: the stroke grows by flat x, y image fractions. */
    func extendHeal(_ id: String, _ points: [Float]) {
        var p = state.params
        guard let i = p.healSpots.firstIndex(where: { $0.id == id }) else { return }
        p.healSpots[i].path = Array((p.healSpots[i].path + points).prefix(HealSpots.maxPoints * 2))
        show(p)
    }

    func removeHeal(_ id: String) {
        edit(force: true) { $0.healSpots.removeAll { $0.id == id } }
    }

    func clearHeal() {
        if !state.params.healSpots.isEmpty { edit(force: true) { $0.healSpots = [] } }
    }

    // MARK: - Light effects (see LightEffects.swift)

    /** Adds a light effect (up to LightEffects.maxEffects) with a new random pattern, covering the photo of [aspect] (width / height); returns its id, or nil when full. */
    @discardableResult
    func addEffect(_ kind: FxKind, aspect: Float) -> String? {
        if state.params.fx.count >= LightEffects.maxEffects { return nil }
        let fx = LightEffects.newEffect(kind, aspect: aspect)
        edit(force: true) { $0.fx.append(fx) }
        return fx.id
    }

    /** An effect's slider or drag; [force] for a button (new pattern, show/hide). */
    func updateEffect(_ id: String, force: Bool = false, _ change: (inout LightEffect) -> Void) {
        edit(force: force) { p in
            if let i = p.fx.firstIndex(where: { $0.id == id }) { change(&p.fx[i]) }
        }
    }

    func removeEffect(_ id: String) {
        edit(force: true) { $0.fx.removeAll { $0.id == id } }
    }

    func beginStroke(_ layerId: String, _ stroke: BrushStroke) {
        updateLayer(layerId, force: true) { $0.strokes.append(stroke) }
    }

    /** Part of the step beginStroke started, however slow the stroke. */
    func extendStroke(_ layerId: String, _ strokeId: String, _ points: [Float]) {
        var p = state.params
        if let li = p.masks.firstIndex(where: { $0.id == layerId }),
           let si = p.masks[li].strokes.firstIndex(where: { $0.id == strokeId }) {
            p.masks[li].strokes[si].points += points
        }
        show(p)
    }

    /** A stroke that turned into a pinch: gone, with no Redo. */
    func cancelStroke(_ layerId: String) {
        if let p = history.drop() { show(p) }
    }

    func undoStroke(_ layerId: String) {
        updateLayer(layerId, force: true) { if !$0.strokes.isEmpty { $0.strokes.removeLast() } }
    }

    func clearBrush(_ layerId: String) { updateLayer(layerId, force: true) { $0.strokes = [] } }

    func setBrush(_ b: BrushSettings) {
        brush = b
        defaults.set(b.radius, forKey: "brush.radius")
        defaults.set(b.hardness, forKey: "brush.hardness")
        defaults.set(b.flow, forKey: "brush.flow")
        defaults.set(b.auto, forKey: "brush.auto")
    }

    // MARK: - Geometry

    func rotate(_ quarterTurns: Int) {
        edit(force: true) { p in
            p = CropMath.rotatePerspective(p, quarterTurns: quarterTurns)
            p.rotation = ((p.rotation + quarterTurns) % 4 + 4) % 4
            p = p.withCrop(CropMath.rotate(p.crop, quarterTurns: quarterTurns))  // the crop turns with the picture
        }
    }

    /** Mirrors the picture as shown, left-right or top-bottom ([vertical]); the crop and straighten mirror with it. */
    func flip(_ vertical: Bool) { commit(CropMath.flip(state.params, vertical: vertical), force: true) }

    func setCrop(_ crop: CropRect) { update(state.params.withCrop(crop)) }

    /** Lens geometry for [params] on the current image; cached while the lens sliders are unchanged. */
    func lensFor(_ params: DevelopParams) -> LensTransform { session.lensFor(params) }

    // MARK: - LUTs

    /** Rescans bundled LUTs and the user's Documents/LUTs folder. */
    func refreshLuts() {
        Task {
            luts = await Task.detached { LutRepository.library() }.value
        }
    }

    /** nil = "No LUT". */
    func selectLut(_ id: String?) { edit(force: true) { $0.lut = id } }

    private func loadSelectedLut(_ id: String?) {
        session.selectLut(id) { [weak self] error in
            guard let self else { return }
            if self.state.params.lut == id { self.state.params.lut = nil }
            self.message = error
        }
    }

    // MARK: - Presets

    private func setPresets(_ list: [Preset]) {
        presets = list
        if !PresetStore.save(list) { message = "Could not save presets" }
    }

    /** Saves the current edits of [groups] as a new preset. */
    func savePreset(_ name: String, _ groups: Set<PresetGroup>) {
        setPresets(presets + [Presets.capture(name, state.params, groups, lens: session.lensInfo.lensName)])
    }

    /**
     * Saves the Lens tab's settings as the lens preset called [name] for this photo's lens (replacing the one saved for it
     * before; with no lens name, as manual lenses record, the one of that name), so RawBoy Auto can correct every photo
     * taken with that lens, or the photos given the preset by name ([sendPresetToAuto]); returns the preset.
     */
    @discardableResult
    func saveLensPreset(name: String = "") -> Preset {
        let lensPreset = Presets.captureLens(state.params, lens: session.lensInfo.lensName, name: name)
        let list = Presets.putLensPreset(presets, lensPreset)
        setPresets(list)
        message = "Saved lens preset \(lensPreset.name)"
        return list.last { $0.isLensPreset && $0.lens == lensPreset.lens && $0.name == lensPreset.name } ?? lensPreset
    }

    /** Overwrites [id]'s values with the current edits (same groups). */
    func updatePreset(_ id: String) {
        setPresets(presets.map { p in
            guard p.id == id else { return p }
            let c = Presets.capture(p.name, state.params, p.groups, lens: p.lens ?? session.lensInfo.lensName)
            return Preset(id: id, name: c.name, groups: c.groups, values: c.values, lens: c.lens)
        })
    }

    func renamePreset(_ id: String, _ name: String) {
        setPresets(presets.map { p in
            var p = p
            if p.id == id { p.name = name.trimmingCharacters(in: .whitespaces) }
            return p
        })
    }

    func deletePreset(_ id: String) { setPresets(presets.filter { $0.id != id }) }

    func deletePresets(_ ids: Set<String>) { setPresets(presets.filter { !ids.contains($0.id) }) }

    /** Applies [preset]'s groups to the current photo; a LUT goes through selectLut (load, error message). */
    func applyPreset(_ preset: Preset) {
        commit(Presets.apply(preset, state.params), force: true)
        message = "Applied \(preset.name)"
    }

    func importPresets(_ url: URL) {
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        guard let text = try? String(contentsOf: url, encoding: .utf8), let added = try? Presets.decode(text) else {
            message = "Not a RawBoy preset file"
            return
        }
        setPresets(presets + added)
        message = added.count == 1 ? "Imported \(added[0].name)" : "Imported \(added.count) presets"
    }

    /** A temporary preset file holding [list] (one, or all), for the share sheet. */
    func presetFile(_ list: [Preset]) -> URL? {
        let name = list.count == 1 ? list[0].name : "RawBoy presets"
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent(OutputNaming.baseNameOf(name) + ".rawboy.json")
        do {
            try Presets.encode(list).write(to: url, atomically: true, encoding: .utf8)
            return url
        } catch {
            message = "Could not export presets"
            return nil
        }
    }

    /**
     * Opens RawBoy Auto with [preset] (a rawboy-auto:// link carrying the preset file, base64url); Auto applies it to
     * every photo of its batch.
     */
    func sendPresetToAuto(_ preset: Preset) {
        let json = Data(Presets.encode([preset]).utf8).base64EncodedString()
            .replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
        var link = URLComponents()
        link.scheme = "rawboy-auto"
        link.host = "preset"
        link.queryItems = [URLQueryItem(name: "json", value: json)]
        guard let url = link.url else { return }
        #if canImport(UIKit)
        Task {
            if !(await UIApplication.shared.open(url)) { message = "RawBoy Auto isn't installed" }
        }
        #else
        if let presetToAuto { presetToAuto(preset) } else { message = "Send to Auto works between the iPhone apps" }
        #endif
    }

    #if os(macOS)
    /** RawBoy Desktop: hands a preset to its Auto (a lens preset joins Auto's lens presets, another develops the batch). */
    var presetToAuto: ((Preset) -> Void)?
    #endif

    // MARK: - Export

    /** Keeps [settings] as the export sheet's next starting point (RawBoy Desktop's batch export, which runs elsewhere). */
    func rememberExportSettings(_ settings: ExportSettings) {
        exportSettings = settings
        ExportSettingsStore.save(settings)
    }

    /** [directory] (RawBoy Desktop): where the file goes; nil (iOS): developed into Photos › RawBoy. */
    func export(_ settings: ExportSettings, to directory: URL? = nil) {
        guard session.hasImage, !state.busy else { return }
        let current = state
        exportSettings = settings
        ExportSettingsStore.save(settings)
        state.exporting = true
        state.exportProgress = 0
        #if canImport(UIKit)
        UIApplication.shared.isIdleTimerDisabled = true
        #endif
        Task {
            do {
                let file = try await session.export(current.params, defaults: current.defaults,
                                                    sourceName: current.fileName ?? "image", settings: settings,
                                                    directory: directory ?? FileManager.default.temporaryDirectory) { p in
                    Task { @MainActor in self.state.exportProgress = p }
                }
                if let directory {
                    lastExport = file
                    message = "Saved \(file.lastPathComponent) to \(directory.lastPathComponent)"
                } else {
                    #if canImport(UIKit)
                    try await PhotoLibraryOutput.save(file)
                    message = "Saved \(file.lastPathComponent) to Photos › RawBoy"
                    #endif
                }
            } catch {
                message = "Export failed: \(error.localizedDescription)"
            }
            state.exporting = false
            #if canImport(UIKit)
            UIApplication.shared.isIdleTimerDisabled = false
            #endif
        }
    }
}

/** The user's presets, as one preset file (`presets.json`, the same format as exported files) in app storage. */
enum PresetStore {
    private static var file: URL {
        let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        #if os(macOS)
        return support.appendingPathComponent("RawBoy Desktop", isDirectory: true).appendingPathComponent("presets.json")
        #else
        return support.appendingPathComponent("presets.json")
        #endif
    }

    static func load() -> [Preset] {
        guard let text = try? String(contentsOf: file, encoding: .utf8) else { return [] }
        return (try? Presets.decode(text)) ?? []
    }

    /**
     * Posted (on the main thread) after [save] wrote the file. RawBoy Desktop's Pro and Auto share it (Auto's lens presets
     * are the lens presets saved here, [LensPresetStore]), so each reloads what the other saved.
     */
    static let changed = Notification.Name("RawBoyPresetsChanged")

    /** Always an array, so one preset doesn't change the file's shape; written whole, then swapped in. */
    static func save(_ presets: [Preset]) -> Bool {
        let text = presets.isEmpty ? "[]" : presets.count == 1 ? "[\(Presets.encode(presets))]" : Presets.encode(presets)
        do {
            try FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
            try text.write(to: file, atomically: true, encoding: .utf8)
            NotificationCenter.default.post(name: changed, object: nil)
            return true
        } catch {
            return false
        }
    }
}
