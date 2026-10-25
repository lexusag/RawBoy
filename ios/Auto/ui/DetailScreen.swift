import RawBoyEngine
import SwiftUI

/** One photo: the developed preview (swipe between photos), the look strip and the controls. */
struct DetailScreen: View {
    @ObservedObject var vm: AutoViewModel
    @ObservedObject var session: PhotoSession
    let id: String

    /** Look: the look and the two everyday controls; Adjust: every adjustment (those two again, then the offsets from the auto develop). Kept across photos. */
    @AppStorage("auto.detailTab") private var tab = 0
    @State private var page: String?
    @State private var showExport = false

    /** Photos that can be opened, in grid order. */
    private var pages: [AutoPhoto] { vm.photos.filter { $0.analysis != nil } }

    var body: some View {
        if let photo = vm.photo(id), photo.analysis != nil {
            NavigationStack {
                VStack(spacing: 0) {
                    pager
                    if let preset = photo.preset {
                        // A RawBoy preset develops this photo in place of the look strip.
                        HStack {
                            VStack(alignment: .leading, spacing: 1) {
                                Text(preset.name).lineLimit(1)
                                Text("RawBoy preset · " + PresetGroup.allCases.filter { preset.groups.contains($0) }.map(\.label)
                                    .joined(separator: " · "))
                                    .font(.caption).foregroundStyle(.secondary).lineLimit(1)
                            }
                            Spacer()
                            Button("Use a look") { vm.removePhotoPreset(photo.id) }.disabled(vm.export != nil)
                        }
                        .padding(.horizontal, 12)
                        .padding(.vertical, 6)
                        .overlay(RoundedRectangle(cornerRadius: 8).stroke(Color(white: 0.3)))
                        .padding(.horizontal, 16)
                        .padding(.vertical, 8)
                    } else {
                        // Looks (LUTs on the AgX develop) or Film (stocks rendered as negative + print).
                        Picker("", selection: Binding(get: { photo.mode }, set: { vm.setMode(photo.id, $0) })) {
                            Text("Looks").tag(LookMode.looks)
                            Text("Film").tag(LookMode.film)
                        }
                        .pickerStyle(.segmented)
                        .padding(.horizontal, 16)
                        .padding(.top, 8)
                        LookStrip(vm: vm, photo: photo)
                    }
                    // Copy previous sits by the tabs, next to the controls it changes (the top bar is full on phones).
                    HStack(spacing: 12) {
                        Picker("", selection: $tab) {
                            Text("Look").tag(0)
                            Text("Adjust").tag(1)
                        }
                        .pickerStyle(.segmented)
                        Button("Copy previous") { vm.copyPrevious(photo.id) }
                            .font(.subheadline)
                            .disabled(vm.export != nil || vm.previousPhoto(photo.id) == nil)
                    }
                    .padding(.horizontal, 16)
                    // Room for three sliders (the Look tab); Adjust scrolls. The photo keeps the rest of the screen.
                    ScrollView {
                        controls(photo).padding(.horizontal, 16).padding(.vertical, 4)
                    }
                    .id(tab)  // one scroll position per tab
                    .frame(height: ValueSlider.rowHeight * 3 + 8)
                }
                .toolbar { toolbar(photo) }
                .sheet(isPresented: $showExport) {
                    ExportSheet(vm: vm, count: 1) { vm.exportSelected() }
                }
                .navigationBarTitleDisplayMode(.inline)
            }
        }
    }

    // Swipe between the batch's photos. Only the shown photo is decoded; neighbours show their grid thumbnails
    // until they settle and open.
    private var pager: some View {
        ScrollView(.horizontal) {
            LazyHStack(spacing: 0) {
                ForEach(pages) { p in
                    PhotoPage(vm: vm, session: session, photo: p, current: p.id == id)
                        .containerRelativeFrame(.horizontal)
                        .id(p.id)
                }
            }
            .scrollTargetLayout()
        }
        .scrollTargetBehavior(.paging)
        .scrollPosition(id: $page)
        .scrollIndicators(.hidden)
        // Drags pan the 100% view; an export holds the photo still.
        .scrollDisabled(session.zoomCenter != nil || vm.export != nil)
        .background(Color(white: 0.07))
        .onAppear { page = id }
        .onChange(of: page) { _, new in if let new, new != id { vm.openDetail(new) } }
        .onChange(of: id) { _, new in if page != new { page = new } }
        .overlay(alignment: .bottom) {
            if let e = vm.export { ProgressView(value: Double(e.current)) }
        }
    }

    @ViewBuilder
    private func controls(_ photo: AutoPhoto) -> some View {
        let a = photo.adjust
        VStack(spacing: 0) {
            if tab == 0 {
                if photo.preset == nil {
                    ValueSlider("Strength", value: photo.strength, range: 0...100, defaultValue: LookApplier.defaultStrength) {
                        vm.setStrength(id, $0)
                    }
                }
                ValueSlider("Brightness", value: a.brightness, range: -100...100, defaultValue: 0) { v in
                    vm.setAdjust(id) { $0.brightness = v }
                }
                ValueSlider("Warmth", value: a.warmth, range: -100...100, defaultValue: 0) { v in vm.setAdjust(id) { $0.warmth = v } }
            } else {
                // Light and colour in pairs, side by side.
                HStack(spacing: 16) {
                    ValueSlider("Brightness", value: a.brightness, range: -100...100, defaultValue: 0, stacked: true) { v in
                        vm.setAdjust(id) { $0.brightness = v }
                    }
                    ValueSlider("Contrast", value: a.contrast, range: -50...50, defaultValue: 0, stacked: true) { v in
                        vm.setAdjust(id) { $0.contrast = v }
                    }
                }
                HStack(spacing: 16) {
                    ValueSlider("Warmth", value: a.warmth, range: -100...100, defaultValue: 0, stacked: true) { v in
                        vm.setAdjust(id) { $0.warmth = v }
                    }
                    ValueSlider("Tint", value: a.tint, range: -50...50, defaultValue: 0, stacked: true) { v in vm.setAdjust(id) { $0.tint = v } }
                }
                ValueSlider("Saturation", value: a.saturation, range: -100...100, defaultValue: 0) { v in
                    vm.setAdjust(id) { $0.saturation = v }
                }
                ValueSlider("Grain", value: a.grain, range: -50...50, defaultValue: 0) { v in vm.setAdjust(id) { $0.grain = v } }
                ValueSlider("Denoise", value: a.denoise, range: -100...100, defaultValue: 0) { v in vm.setAdjust(id) { $0.denoise = v } }
            }
        }
    }

    @ToolbarContentBuilder
    private func toolbar(_ photo: AutoPhoto) -> some ToolbarContent {
        ToolbarItemGroup(placement: .topBarLeading) {
            Button { vm.closeDetail() } label: { Image(systemName: "chevron.backward") }
                .accessibilityLabel("Back")
            Button { vm.undo(id) } label: { Image(systemName: "arrow.uturn.backward") }
                .disabled(vm.export != nil || !vm.canUndo(id))
                .accessibilityLabel("Undo")
            Button { vm.redo(id) } label: { Image(systemName: "arrow.uturn.forward") }
                .disabled(vm.export != nil || !vm.canRedo(id))
                .accessibilityLabel("Redo")
        }
        ToolbarItem(placement: .principal) {
            VStack(spacing: 0) {
                Text(photo.name).font(.subheadline).lineLimit(1)
                if pages.count > 1, let i = pages.firstIndex(where: { $0.id == id }) {
                    Text("\(i + 1) / \(pages.count)").font(.caption2).foregroundStyle(.secondary)
                }
            }
        }
        ToolbarItemGroup(placement: .topBarTrailing) {
            Button("Apply to all") { vm.applyLookToAll(id) }
                .disabled(vm.export != nil || vm.photos.count < 2)
            Button("Export") { showExport = true }
                .buttonStyle(.borderedProminent)
                .disabled(vm.sessionReady != id || vm.export != nil)
            HelpButton("RawBoy Auto", sections: autoHelp, licences: true)
        }
    }
}

/** The frame around the photo in the fit view, as RawBoy's (grey, white or black: tap outside the photo). */
private let frameWidthPt: CGFloat = 12

/** One page of the pager: the live develop for the open photo, the grid thumbnail for the others. */
private struct PhotoPage: View {
    @ObservedObject var vm: AutoViewModel
    @ObservedObject var session: PhotoSession
    let photo: AutoPhoto
    let current: Bool

    /** Press and hold shows the auto develop without the look. */
    @State private var showAuto = false
    /** The drag's previous translation; a local var would reset on every redraw and make pans accelerate. */
    @State private var panLast = CGSize.zero
    /** The pinch's magnification at its last change, while two fingers zoom. */
    @State private var pinchLast: CGFloat?
    @Environment(\.displayScale) private var scale
    private var framePx: Int { Int(frameWidthPt * scale) }

    var body: some View {
        GeometryReader { geo in
            ZStack {
                let live = current && vm.sessionReady == photo.id
                // Until the raw is decoded, the photo's cached preview shows its develop (no 100% view yet).
                let cached = current && !live ? vm.cachedPreview.flatMap { $0.id == photo.id ? $0.image : nil } : nil
                if let analysis = photo.analysis, live || cached != nil {
                    // Press and hold shows the auto develop without the look.
                    let shown = showAuto && live ? analysis.autoBase : photo.params ?? analysis.autoBase
                    // One view for both, so it stays when the decoded preview replaces the cached one.
                    DevelopPreview(
                        image: live ? session.preview : cached,
                        params: live
                            ? session.shaderParams(shown, defaults: analysis.defaults, useSelectedLut: shown.lut != nil,
                                                   film: shown.film != nil ? session.filmData : nil)
                            : vm.cachedShaderParams(photo.id, shown),
                        zoomCenter: live ? session.zoomCenter : nil, detail: live ? session.detail : nil,
                        frameWidth: framePx, frameColor: vm.frameColor, zoomScale: live ? session.zoomScale : 1)
                    .gesture(previewGestures(live: live))
                    .onAppear { session.setViewSize(Int(geo.size.width * scale), Int(geo.size.height * scale), frame: framePx) }
                    .onChange(of: geo.size) { _, s in
                        session.setViewSize(Int(s.width * scale), Int(s.height * scale), frame: framePx)
                    }
                    if live, showAuto || session.zoomCenter != nil {
                        OverlayLabel(!showAuto ? ZoomMath.label(session.zoomScale) : photo.preset != nil ? "Without preset" : "Without look")
                            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                    }
                    if !live {
                        ProgressView()
                            .controlSize(.small)
                            .padding(12)
                            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topTrailing)
                    }
                } else {
                    // Until the raw is decoded, show the grid thumbnail.
                    // Inset by the frame so the photo doesn't move when the decoded preview replaces it.
                    if let t = photo.thumbnail { Image(decorative: t, scale: 1).resizable().scaledToFit().padding(frameWidthPt) }
                    if current { ProgressView() }
                }
            }
            .frame(width: geo.size.width, height: geo.size.height)
        }
    }

    /** [live]: the session holds this photo; on the cached preview the session's image is still the previous photo's. */
    private func previewGestures(live: Bool) -> some Gesture {
        let doubleTap = SpatialTapGesture(count: 2).onEnded { e in
            guard live else { return }
            session.toggleZoom(Float(e.location.x * scale), Float(e.location.y * scale), frameWidth: framePx)
        }
        let tap = SpatialTapGesture().onEnded { e in
            guard live else { return }
            vm.onPreviewTap(Float(e.location.x * scale), Float(e.location.y * scale), frameWidth: framePx)
        }
        let hold = LongPressGesture(minimumDuration: 0.25)
            .onEnded { _ in if live && pinchLast == nil { showAuto = true } }
            .sequenced(before: DragGesture(minimumDistance: 0).onEnded { _ in showAuto = false })
        let pan = DragGesture(minimumDistance: 1)
            .onChanged { v in
                guard session.zoomCenter != nil else { return }
                let d = CGSize(width: v.translation.width - panLast.width, height: v.translation.height - panLast.height)
                panLast = v.translation
                // While pinching, the zoom keeps the photo under the fingers; a drag's single finger would fight it.
                if pinchLast == nil { session.pan(Float(d.width * scale), Float(d.height * scale)) }
            }
            .onEnded { _ in panLast = .zero }
        // Pinch: zoom from fit up to 400% around where it started, stopping once at 100%.
        let pinch = MagnifyGesture()
            .onChanged { v in
                guard live else { return }
                showAuto = false
                let factor = v.magnification / (pinchLast ?? 1)
                pinchLast = v.magnification
                session.zoomBy(Float(v.startLocation.x * scale), Float(v.startLocation.y * scale), factor: Float(factor),
                               frameWidth: framePx)
            }
            .onEnded { _ in pinchLast = nil }
        return doubleTap.exclusively(before: tap).simultaneously(with: hold.simultaneously(with: pan))
            .simultaneously(with: pinch)
    }
}

private struct LookStrip: View {
    @ObservedObject var vm: AutoViewModel
    let photo: AutoPhoto

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView(.horizontal) {
                LazyHStack(spacing: 8) {
                    ForEach(photo.mode == .film ? FilmLooks.all : Looks.all) { look in
                        LookChip(vm: vm, photo: photo, look: look).id(look.id)
                    }
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 6)
            }
            .scrollIndicators(.hidden)
            .onAppear { proxy.scrollTo(photo.activeLook.id, anchor: .leading) }
            .onChange(of: photo.id) { _, _ in proxy.scrollTo(photo.activeLook.id, anchor: .leading) }
            .onChange(of: photo.mode) { _, _ in proxy.scrollTo(photo.activeLook.id, anchor: .leading) }
        }
        .frame(height: 92)
    }
}

private struct LookChip: View {
    @ObservedObject var vm: AutoViewModel
    let photo: AutoPhoto
    let look: Look

    @State private var thumb: CGImage?
    private static let size: CGFloat = 64

    var body: some View {
        let selected = photo.activeLook.id == look.id
        let suggested = photo.mode == .film ? photo.suggestedFilm : photo.suggested
        VStack(spacing: 2) {
            ZStack(alignment: .bottom) {
                Color(white: 0.12)
                if let thumb { Image(decorative: thumb, scale: 1).resizable().scaledToFill() }
                if suggested.id == look.id {
                    Text("Suggested")
                        .font(.system(size: 9, weight: .semibold))
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 1)
                        .background(Color.accentColor.opacity(0.85))
                        .foregroundStyle(.black)
                }
            }
            .frame(width: Self.size, height: Self.size)
            .clipped()
            .overlay(Rectangle().stroke(selected ? Color.accentColor : .clear, lineWidth: 2))
            // Two lines, so long stock names ("Double-X 5222") aren't cut off; always two so the strip doesn't jump.
            Text(look.name).font(.caption2).lineLimit(2, reservesSpace: true)
                .multilineTextAlignment(.center)
                .foregroundStyle(selected ? Color.accentColor : .primary)
        }
        .frame(width: Self.size)
        .onTapGesture { vm.setLook(photo.id, look) }
        // Keeps showing the previous thumbnail while a slider moves; re-renders once it rests.
        .task(id: "\(photo.id)|\(look.film ?? look.id)|\(photo.adjust)") {
            if !vm.hasCurrentLookThumbnail(photo.id, look) { try? await Task.sleep(nanoseconds: 400_000_000) }
            guard !Task.isCancelled else { return }
            if let t = await vm.lookThumbnail(photo.id, look) { thumb = t }
        }
    }
}
