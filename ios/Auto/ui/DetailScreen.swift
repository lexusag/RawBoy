import RawBoyEngine
import SwiftUI

/** One photo: the developed preview (swipe between photos), the look strip and the controls. */
struct DetailScreen: View {
    @ObservedObject var vm: AutoViewModel
    @ObservedObject var session: PhotoSession
    let id: String
    var pickPreset: ((Set<String>) -> Void)? = nil

    /** Look: the look and the two everyday controls; Adjust: every adjustment (those two again, then the offsets from the auto develop). Kept across photos. */
    @AppStorage("auto.detailTab") private var tab = 0
    /** RawBoy Desktop: the side panel's closed sections, a comma list. */
    @AppStorage("auto.closedSections") private var closedSections = ""
    @State private var page: String?
    @State private var showExport = false
    @State private var pickingWhite = false
    /** Crop & rotate's shape lock (UI only; the crop itself is in the photo's adjustments). Portrait nil = follow the frame. */
    @State private var cropPortrait: Bool?

    /** Photos that can be opened, in grid order. */
    private var pages: [AutoPhoto] { vm.photos.filter { $0.analysis != nil } }

    var body: some View {
        if let photo = vm.photo(id), photo.analysis != nil {
            #if os(macOS)
            macBody(photo)
            #else
            phoneBody(photo)
            #endif
        }
    }

    /** The phones: a navigation bar, the pager, then the look strip and the Look / Adjust tabs. */
    @ViewBuilder
    private func phoneBody(_ photo: AutoPhoto) -> some View {
            NavigationStack {
                // The looks and sliders under the photo in portrait, beside it in landscape.
                PhotoWithControls { pager } controls: { beside in
                    if vm.cropping {
                        cropPanel(photo)
                    } else {
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
                            if let pickPreset {
                                Button("Change") { pickPreset([photo.id]) }.disabled(vm.export != nil)
                            }
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
                        .neutralSegments()
                        .padding(.horizontal, 16)
                        .padding(.top, 8)
                        LookNameLine(photo: photo)
                        LookStrip(vm: vm, photo: photo)
                    }
                    // Copy previous sits by the tabs, next to the controls it changes (the top bar is full on phones).
                    HStack(spacing: 12) {
                        Picker("", selection: $tab) {
                            Text("Look").tag(0)
                            Text("Adjust").tag(1)
                        }
                        .pickerStyle(.segmented)
                        .neutralSegments()
                        Button("Copy previous") { vm.copyPrevious(photo.id) }
                            .font(.subheadline)
                            .disabled(vm.export != nil || vm.previousPhoto(photo.id) == nil)
                    }
                    .padding(.horizontal, 16)
                    // Under the photo, room for three sliders (the Look tab); Adjust scrolls. The photo keeps the rest
                    // of the screen. Beside it, the rest of the panel's height.
                    ScrollView {
                        controls(photo).padding(.horizontal, 16).padding(.vertical, 4)
                    }
                    .id(tab)  // one scroll position per tab
                    .frame(height: beside ? nil : ValueSlider.rowHeight * 3 + 8)
                    }
                }
                .toolbar { toolbar(photo) }
                .sheet(isPresented: $showExport) {
                    ExportSheet(vm: vm, count: 1) { vm.exportSelected() }
                }
                .onChange(of: vm.exportRequest) { _, _ in if vm.export == nil { showExport = true } }
                .inlineTitle()
            }
    }

    // Swipe between the batch's photos. Only the shown photo is decoded; neighbours show their grid thumbnails
    // until they settle and open.
    private var pager: some View {
        ScrollView(.horizontal) {
            LazyHStack(spacing: 0) {
                ForEach(pages) { p in
                    PhotoPage(vm: vm, session: session, photo: p, current: p.id == id, pickingWhite: $pickingWhite, cropRatio: cropRatio)
                        .containerRelativeFrame(.horizontal)
                        .id(p.id)
                }
            }
            .scrollTargetLayout()
        }
        .scrollTargetBehavior(.paging)
        .scrollPosition(id: $page)
        .scrollIndicators(.never)
        // Drags pan the 100% view; an export holds the photo still.
        .scrollDisabled(session.zoomCenter != nil || vm.export != nil || vm.cropping)
        .background(Color(white: 0.07))
        .onAppear { page = id }
        .onChange(of: page) { _, new in if let new, new != id { vm.openDetail(new) } }
        .onChange(of: id) { _, new in
            if page != new { page = new }
            pickingWhite = false
            cropPortrait = nil
        }
        .onChange(of: tab) { _, _ in pickingWhite = false }
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
                Button {
                    pickingWhite.toggle()
                } label: {
                    Label(pickingWhite ? "Tap something neutral grey" : "Pick white balance", systemImage: "eyedropper")
                }
                .buttonStyle(.borderedProminent)
                .tint(pickingWhite ? .accentColor : .secondary)
                .padding(.vertical, 4)
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

    private var cropRatio: Double? {
        guard let f = frameLens else { return nil }
        let portrait = cropPortrait ?? (f.frameHeight > f.frameWidth)
        return vm.cropAspect.ratio(frameWidth: f.frameWidth, frameHeight: f.frameHeight, portrait: portrait)
    }

    private var frameLens: LensTransform? {
        guard let p = vm.photo(id)?.params, vm.sessionReady == id else { return nil }
        return session.lensFor(p.withoutCrop())
    }

    /** Crop & rotate in place of the look strip and sliders: shapes, quarter turns and the horizon. */
    @ViewBuilder
    private func cropPanel(_ photo: AutoPhoto) -> some View {
        let f = frameLens
        let portrait = cropPortrait ?? ((f?.frameHeight ?? 0) > (f?.frameWidth ?? 0))
        let a = photo.adjust
        ScrollView {
            VStack(alignment: .leading, spacing: 6) {
                HStack {
                    Text("Crop & rotate").font(.headline)
                    Spacer()
                    Button("Reset") {
                        vm.cropAspect = .original
                        cropPortrait = nil
                        vm.resetCrop(photo.id)
                    }
                    .disabled(a.crop == nil && a.straighten == 0 && vm.cropAspect == .original)
                    Button("Done") { vm.cropping = false }.fontWeight(.semibold)
                }
                HStack(spacing: 12) {
                    Button("↺  Left") { turn(-1) }.buttonStyle(.bordered)
                    Button("Right  ↻") { turn(1) }.buttonStyle(.bordered)
                    Button(portrait ? "Portrait" : "Landscape") { chooseAspect(vm.cropAspect, !portrait) }
                        .buttonStyle(.bordered)
                        .disabled(vm.cropAspect == .free || vm.cropAspect == .square)
                }
                ScrollView(.horizontal) {
                    HStack(spacing: 8) {
                        ForEach(CropAspect.allCases, id: \.self) { shape in
                            Button(shape.label(portrait: portrait)) { chooseAspect(shape, portrait) }
                                .buttonStyle(.bordered)
                                .tint(shape == vm.cropAspect ? .accentColor : .gray)
                        }
                    }
                }
                .scrollIndicators(.hidden)
                ValueSlider("Straighten", value: a.straighten, range: -45...45, defaultValue: 0,
                            format: { String(format: "%+.1f°", abs($0) < 0.05 ? 0 : $0) }) { v in
                    vm.setStraighten(photo.id, v)
                }
                Text("Drag the corners, edges or inside of the frame to crop. Straightening crops automatically so no empty corners show.")
                    .font(.caption).foregroundStyle(.secondary)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 8)
        }
    }

    private func startCrop(_ photo: AutoPhoto) {
        session.exitZoom()  // the crop tool works on the fit view
        vm.cropping = true
        // A remembered shape other than Original / Free shapes the frame at once, so the chip and the frame agree.
        if let f = frameLens, photo.adjust.crop == nil, vm.cropAspect != .free, vm.cropAspect != .original {
            let portrait = cropPortrait ?? (f.frameHeight > f.frameWidth)
            let ratio = vm.cropAspect.ratio(frameWidth: f.frameWidth, frameHeight: f.frameHeight, portrait: portrait)
            vm.setCrop(id, CropMath.withAspect(CropMath.full, ratio: ratio, frameWidth: f.frameWidth,
                                               frameHeight: f.frameHeight), force: true)
        }
    }

    private func turn(_ quarterTurns: Int) {
        vm.rotate([id], by: quarterTurns)
        cropPortrait = cropPortrait.map { !$0 }  // a locked shape turns with the picture
    }

    private func chooseAspect(_ aspect: CropAspect, _ toPortrait: Bool) {
        guard let f = frameLens, let photo = vm.photo(id) else { return }
        vm.cropAspect = aspect
        cropPortrait = toPortrait
        let ratio = aspect.ratio(frameWidth: f.frameWidth, frameHeight: f.frameHeight, portrait: toPortrait)
        vm.setCrop(id, CropMath.withAspect(photo.adjust.crop ?? CropMath.full, ratio: ratio, frameWidth: f.frameWidth,
                                           frameHeight: f.frameHeight), force: true)
    }

    @ToolbarContentBuilder
    private func toolbar(_ photo: AutoPhoto) -> some ToolbarContent {
        ToolbarItemGroup(placement: .barLeading) {
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
        ToolbarItemGroup(placement: .barTrailing) {
            // Apply to all and Remove share a menu: the bar is full on phones and the name needs the room.
            Menu {
                Button("Crop & rotate", systemImage: "crop.rotate") { startCrop(photo) }
                .disabled(vm.export != nil || vm.sessionReady != id)
                if let pickPreset {
                    Button("Apply RawBoy preset…") { pickPreset([id]) }
                        .disabled(vm.export != nil)
                }
                Button("Apply to all") { vm.applyLookToAll(id) }
                    .disabled(vm.export != nil || vm.photos.count < 2)
                Button("Remove from batch", systemImage: "trash") { vm.removeOpened(id) }
                    .disabled(vm.export != nil)
            } label: { Image(systemName: "ellipsis.circle") }
                .accessibilityLabel("More")
            Button("Export") { showExport = true }
                .buttonStyle(.borderedProminent)
                .disabled(vm.sessionReady != id || vm.export != nil)
            HelpButton("RawBoy Auto", sections: autoHelp, licences: true)
        }
    }
}

#if os(macOS)
/**
 * RawBoy Desktop's photo view, in Pro's layout so the two modes read as one app: Pro's one-row bar (back to the grid and
 * the photo on the left, Crop and Preset in the middle, what acts on the photo or the batch on the right, Export last)
 * and a side panel of sections that open and close (Look, Light, Colour, Detail) in place of the phones' Look / Adjust
 * tabs. One photo, no pager: the arrow keys and the bar's arrows page, and a Mac pager drew a scroll bar under the photo.
 */
extension DetailScreen {
    fileprivate func macBody(_ photo: AutoPhoto) -> some View {
        VStack(spacing: 0) {
            macBar(photo)
            PhotoWithControls {
                PhotoPage(vm: vm, session: session, photo: photo, current: true, pickingWhite: $pickingWhite, cropRatio: cropRatio)
                    // Room between the photo's frame and the window's edges and bar.
                    .padding(macPhotoMargin)
                    .overlay(alignment: .bottom) {
                        if let e = vm.export { ProgressView(value: Double(e.current)) }
                    }
            } controls: { _ in
                if vm.cropping { cropPanel(photo) } else { macPanel(photo) }
            }
        }
        .background(Color(white: 0.07))
        .sheet(isPresented: $showExport) {
            ExportSheet(vm: vm, count: 1) { vm.exportSelected() }
        }
        .onChange(of: vm.exportRequest) { _, _ in if vm.export == nil { showExport = true } }
        .onChange(of: id) { _, _ in
            pickingWhite = false
            cropPortrait = nil
        }
    }

    private var macPhotoMargin: CGFloat { 12 }

    /** Where the photo sits in the batch: its index among the photos that can be opened, and their count. */
    private var position: (index: Int, count: Int)? {
        pages.firstIndex(where: { $0.id == id }).map { ($0, pages.count) }
    }

    private func macBar(_ photo: AutoPhoto) -> some View {
        let idle = vm.export == nil
        let at = position
        return HStack(spacing: 14) {
            BarTool("chevron.backward", "Grid", "Back to the grid (Esc)") { vm.closeDetail() }
            VStack(alignment: .leading, spacing: 1) {
                Text(photo.name).font(.subheadline.weight(.medium)).lineLimit(1).truncationMode(.middle)
                Text(at.map { "Photo \($0.index + 1) of \($0.count)" } ?? " ")
                    .font(.caption2).monospacedDigit().foregroundStyle(.secondary).lineLimit(1)
            }
            .frame(minWidth: 60, maxWidth: 260, alignment: .leading)
            .help(photo.name)
            BarTool("chevron.left", "Previous", "Previous photo (←)") { vm.page(-1) }
                .disabled(!idle || vm.cropping || (at?.index ?? 0) == 0)
            BarTool("chevron.right", "Next", "Next photo (→)") { vm.page(1) }
                .disabled(!idle || vm.cropping || at.map { $0.index + 1 >= $0.count } ?? true)
            Spacer(minLength: 8)
            BarTool("crop.rotate", "Crop", "Crop & rotate", primary: vm.cropping) {
                if vm.cropping { vm.cropping = false } else { startCrop(photo) }
            }
            .disabled(!idle || vm.sessionReady != id)
            if let pickPreset {
                BarTool("bookmark", "Preset", "Apply a RawBoy preset…") { pickPreset([id]) }.disabled(!idle)
            }
            Spacer(minLength: 8)
            if let edit = vm.editInPro {
                BarTool("slider.horizontal.3", "Edit in Pro", "Open this photo in the Pro editor (⌘↩)") { edit(photo) }
            }
            BarTool("doc.on.doc", "Copy", "Copy the previous photo's look and adjustments (⇧C)") { vm.copyPrevious(id) }
                .disabled(!idle || vm.previousPhoto(id) == nil)
            BarTool("square.grid.2x2", "Apply to All", "Give every photo in the batch this look and adjustments") {
                vm.applyLookToAll(id)
            }
            .disabled(!idle || vm.photos.count < 2)
            BarTool("trash", "Remove", "Remove this photo from the batch (the file stays)") { vm.removeOpened(id) }
                .disabled(!idle)
            BarTool("arrow.uturn.backward", "Undo", "Undo (⌘Z)") { vm.undo(id) }.disabled(!idle || !vm.canUndo(id))
            BarTool("arrow.uturn.forward", "Redo", "Redo (⇧⌘Z)") { vm.redo(id) }.disabled(!idle || !vm.canRedo(id))
            BarTool("square.and.arrow.down", "Export", "Export this photo", primary: true) { showExport = true }
                .disabled(vm.sessionReady != id || !idle)
            HelpButton("RawBoy Auto", sections: autoHelp, licences: true)
                .font(.title3)
                .buttonStyle(BarButtonStyle())
        }
        .frame(height: 48)
        .padding(.horizontal, 16)
        .padding(.bottom, 4)
    }

    /** The side panel: the look first, then the adjustments in sections, all sliders one to a row. */
    private func macPanel(_ photo: AutoPhoto) -> some View {
        let a = photo.adjust
        let disabled = vm.export != nil
        return ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                macSection(photo.preset != nil ? "Preset" : photo.mode == .film ? "Film" : "Look", edited: false, reset: nil) {
                    if let preset = photo.preset {
                        // A RawBoy preset develops this photo in place of the looks.
                        Text(preset.name).font(.subheadline.weight(.semibold)).lineLimit(2)
                        Text("RawBoy preset · " + PresetGroup.allCases.filter { preset.groups.contains($0) }.map(\.label)
                            .joined(separator: " · "))
                            .font(.caption).foregroundStyle(.secondary).lineLimit(2)
                        HStack {
                            if let pickPreset { Button("Change…") { pickPreset([photo.id]) } }
                            Button("Use a look") { vm.removePhotoPreset(photo.id) }
                        }
                        .disabled(disabled)
                        .padding(.top, 6)
                    } else {
                        // Looks (LUTs on the AgX develop) or Film (stocks rendered as negative + print).
                        Picker("", selection: Binding(get: { photo.mode }, set: { vm.setMode(photo.id, $0) })) {
                            Text("Looks").tag(LookMode.looks)
                            Text("Film").tag(LookMode.film)
                        }
                        .pickerStyle(.segmented)
                        .neutralSegments()
                        .labelsHidden()
                        .controlSize(.small)
                        LookNameLine(photo: photo, inset: 0)
                        ValueSlider("Strength", value: photo.strength, range: 0...100, defaultValue: LookApplier.defaultStrength) {
                            vm.setStrength(id, $0)
                        }
                        LookGrid(vm: vm, photo: photo)
                    }
                }
                macSection("Light", edited: a.brightness != 0 || a.contrast != 0, reset: {
                    $0.brightness = 0; $0.contrast = 0
                }) {
                    ValueSlider("Brightness", value: a.brightness, range: -100...100, defaultValue: 0) { v in
                        vm.setAdjust(id) { $0.brightness = v }
                    }
                    ValueSlider("Contrast", value: a.contrast, range: -50...50, defaultValue: 0) { v in
                        vm.setAdjust(id) { $0.contrast = v }
                    }
                }
                macSection("Colour", edited: a.warmth != 0 || a.tint != 0 || a.saturation != 0, reset: {
                    $0.warmth = 0; $0.tint = 0; $0.saturation = 0
                }) {
                    Toggle(isOn: $pickingWhite) {
                        Label(pickingWhite ? "Click something neutral grey" : "Pick white balance", systemImage: "eyedropper")
                    }
                    .toggleStyle(.button)
                    .help("Then click something in the photo that should be neutral grey")
                    .padding(.vertical, 4)
                    ValueSlider("Warmth", value: a.warmth, range: -100...100, defaultValue: 0) { v in vm.setAdjust(id) { $0.warmth = v } }
                    ValueSlider("Tint", value: a.tint, range: -50...50, defaultValue: 0) { v in vm.setAdjust(id) { $0.tint = v } }
                    ValueSlider("Saturation", value: a.saturation, range: -100...100, defaultValue: 0) { v in
                        vm.setAdjust(id) { $0.saturation = v }
                    }
                }
                macSection("Detail", edited: a.grain != 0 || a.denoise != 0, reset: { $0.grain = 0; $0.denoise = 0 }) {
                    ValueSlider("Grain", value: a.grain, range: -50...50, defaultValue: 0) { v in vm.setAdjust(id) { $0.grain = v } }
                    ValueSlider("Denoise", value: a.denoise, range: -100...100, defaultValue: 0) { v in vm.setAdjust(id) { $0.denoise = v } }
                }
            }
            .disabled(disabled)
            .padding(.horizontal, 16)
            .padding(.bottom, 12)
        }
    }

    /** A section of the panel; [reset] puts its adjustments back to none, as one undo step. */
    private func macSection<Content: View>(_ title: String, edited: Bool, reset: ((inout Adjustments) -> Void)?,
                                           @ViewBuilder content: () -> Content) -> some View {
        InspectorSection(title, open: !InspectorSections.closed(closedSections).contains(title), edited: edited,
                         onToggle: { Motion.animate { closedSections = InspectorSections.toggled(closedSections, title) } },
                         onReset: reset.map { r in { vm.setAdjust(id, force: true, r) } }, content: content)
    }
}

/**
 * The Mac panel's looks: thumbnails in rows that wrap, under their group's heading, so a mouse wheel scrolls them with the
 * rest of the panel (a horizontal strip only scrolled with Shift or a trackpad).
 */
private struct LookGrid: View {
    @ObservedObject var vm: AutoViewModel
    let photo: AutoPhoto

    var body: some View {
        let looks = photo.mode == .film ? FilmLooks.all : Looks.all
        let sections = Looks.sections(looks)
        VStack(alignment: .leading, spacing: 8) {
            ForEach(sections) { s in
                if sections.count > 1 {
                    Text(s.group.label).font(.caption.weight(.semibold)).foregroundStyle(.secondary).padding(.top, 4)
                }
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 64), spacing: 8, alignment: .top)], alignment: .leading, spacing: 8) {
                    ForEach(s.looks) { look in LookChip(vm: vm, photo: photo, look: look) }
                }
            }
        }
        .padding(.top, 6)
    }
}
#endif

/** The frame around the photo in the fit view, as RawBoy's (grey, white or black: tap outside the photo). */
private let frameWidthPt: CGFloat = 12

/** One page of the pager: the live develop for the open photo, the grid thumbnail for the others. */
private struct PhotoPage: View {
    @ObservedObject var vm: AutoViewModel
    @ObservedObject var session: PhotoSession
    let photo: AutoPhoto
    let current: Bool
    @Binding var pickingWhite: Bool
    /** Crop & rotate's locked shape, width / height in pixels (nil = free). */
    let cropRatio: Double?

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
                    let uncropped = showAuto && live ? analysis.autoBase : photo.params ?? analysis.autoBase
                    let cropping = live && vm.cropping
                    let shown = cropping ? uncropped.withoutCrop() : uncropped
                    #if os(macOS)
                    // The wheel zooms around the pointer (as Pro's and the web's), the middle button pans.
                    PointerSurface(
                        onMove: { _ in },
                        onZoom: { p, factor in
                            guard live, !cropping else { return }
                            showAuto = false
                            session.zoomBy(Float(p.x * scale), Float(p.y * scale), factor: Float(factor), frameWidth: framePx)
                        },
                        onPan: { d in
                            if live, session.zoomCenter != nil { session.pan(Float(d.width * scale), Float(d.height * scale)) }
                        })
                    #endif
                    // One view for both, so it stays when the decoded preview replaces the cached one.
                    DevelopPreview(
                        image: live ? session.preview : cached,
                        params: live
                            ? session.shaderParams(shown, defaults: analysis.defaults, useSelectedLut: shown.lut != nil,
                                                   film: shown.film != nil ? session.filmData : nil)
                            : vm.cachedShaderParams(photo.id, shown),
                        zoomCenter: live ? session.zoomCenter : nil, detail: live ? session.detail : nil,
                        frameWidth: framePx, frameColor: vm.frameColor, zoomScale: live ? session.zoomScale : 1)
                    .gesture(previewGestures(live: live && !cropping))
                    .onAppear { session.setViewSize(Int(geo.size.width * scale), Int(geo.size.height * scale), frame: framePx) }
                    .onChange(of: geo.size) { _, s in
                        session.setViewSize(Int(s.width * scale), Int(s.height * scale), frame: framePx)
                    }
                    if cropping, session.zoomCenter == nil, session.preview != nil {
                        let shader = session.shaderParams(shown, defaults: analysis.defaults, useSelectedLut: shown.lut != nil,
                                                          film: shown.film != nil ? session.filmData : nil)
                        CropOverlay(frameWidth: shader.lens.outputWidth, frameHeight: shader.lens.outputHeight,
                                    crop: photo.adjust.crop ?? CropMath.full, ratio: cropRatio, framePx: framePx,
                                    onCropChange: { vm.setCrop(photo.id, $0) })
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
                    // Inset by the frame so the photo doesn't move when the decoded preview replaces it, and framed as
                    // the preview will be, so the frame doesn't blink out while it renders.
                    if let t = photo.thumbnail {
                        Image(decorative: t, scale: 1).resizable().scaledToFit()
                            .background(Color(white: Double(vm.frameColor.level)).padding(-frameWidthPt))
                            .padding(frameWidthPt)
                    }
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
            if pickingWhite {
                pickingWhite = false
                vm.pickWhite(photo.id, Float(e.location.x * scale), Float(e.location.y * scale), frameWidth: framePx)
            } else {
                vm.onPreviewTap(Float(e.location.x * scale), Float(e.location.y * scale), frameWidth: framePx)
            }
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

/**
 * The name of the look or film stock the photo has now (the web shows it on each grid cell; here also above the strip, whose
 * chips only name theirs in small type under each thumbnail): "Yellow Portrait 400", with "suggested" when Auto picked it.
 */
private struct LookNameLine: View {
    let photo: AutoPhoto
    /** Side margin: the phones' strip is edge to edge, the Mac panel has its own padding. */
    var inset: CGFloat = 16

    var body: some View {
        let look = photo.activeLook
        let suggested = (photo.mode == .film ? photo.suggestedFilm : photo.suggested).id == look.id
        let kind = photo.mode == .film ? "Film stock" : "Look"
        HStack(spacing: 6) {
            Text(look.name).font(.subheadline.weight(.semibold)).foregroundStyle(Color.accentColor).lineLimit(2)
            if suggested { Text("suggested").font(.caption).foregroundStyle(.secondary) }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, inset)
        .padding(.top, 4)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(kind): \(look.name)\(suggested ? ", suggested by Auto" : "")")
        .accessibilityAddTraits(.isHeader)
    }
}

private struct LookStrip: View {
    @ObservedObject var vm: AutoViewModel
    let photo: AutoPhoto

    var body: some View {
        // Colour, experimental and black and white looks in sections (Looks.sections): a heading over each, a divider
        // between them.
        let looks = photo.mode == .film ? FilmLooks.all : Looks.all
        let sections = Looks.sections(looks)
        let sectioned = sections.count > 1
        ScrollViewReader { proxy in
            ScrollView(.horizontal) {
                LazyHStack(alignment: .top, spacing: 8) {
                    if !sectioned {
                        ForEach(looks) { look in
                            LookChip(vm: vm, photo: photo, look: look).id(look.id)
                        }
                    } else {
                        ForEach(Array(sections.enumerated()), id: \.element.id) { i, s in
                            if i > 0 { Divider() }
                            section(s.group.label, s.looks)
                        }
                    }
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 6)
            }
            .scrollIndicators(.never)  // `.hidden` still drew the Mac's scroll bar over the chips' names
            .onAppear { proxy.scrollTo(photo.activeLook.id, anchor: .leading) }
            .onChange(of: photo.id) { _, _ in proxy.scrollTo(photo.activeLook.id, anchor: .leading) }
            .onChange(of: photo.mode) { _, _ in proxy.scrollTo(photo.activeLook.id, anchor: .leading) }
        }
        .frame(height: 92 + (sectioned ? Self.headingHeight : 0))
    }

    private static let headingHeight: CGFloat = 16

    /** A section's heading and its chips. */
    private func section(_ title: String, _ looks: [Look]) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(title).font(.caption.weight(.semibold)).foregroundStyle(Color.accentColor)
                .frame(height: Self.headingHeight)
            HStack(spacing: 8) {
                ForEach(looks) { look in
                    LookChip(vm: vm, photo: photo, look: look).id(look.id)
                }
            }
        }
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
        .tapButton(selected: selected, hint: "Applies this look") { vm.setLook(photo.id, look) }
        .accessibilityLabel(suggested.id == look.id ? "\(look.name), suggested" : look.name)
        // Keeps showing the previous thumbnail while a slider moves; re-renders once it rests.
        .task(id: "\(photo.id)|\(look.film ?? look.id)|\(photo.adjust)") {
            if !vm.hasCurrentLookThumbnail(photo.id, look) { try? await Task.sleep(nanoseconds: 400_000_000) }
            guard !Task.isCancelled else { return }
            if let t = await vm.lookThumbnail(photo.id, look) { thumb = t }
        }
    }
}
