import RawBoyEngine
import SwiftUI
import enum RawBoyBrowseKit.PhotoSort

/**
 * The batch as a grid; long-press a photo to start selecting (for rotating, removing, exporting and giving photos, one
 * scene, their own RawBoy preset).
 */
struct GridScreen: View {
    @ObservedObject var vm: AutoViewModel
    /** nil (RawBoy Desktop): photos come from files only. */
    let addFromPhotos: (() -> Void)?
    let addFromFiles: () -> Void
    /** RawBoy Desktop: adds the photos in a folder. */
    var addFromFolder: (() -> Void)? = nil
    /** RawBoy Desktop: the "Clear batch" button (the root asks first). */
    var onClearBatch: (() -> Void)? = nil
    /** RawBoy Desktop: the "Reset all photos…" button beside it (the root's sheet asks which look and confirms). */
    var onResetAll: (() -> Void)? = nil
    /** Opens a RawBoy preset file to apply to the batch (nil), or to the photos with these ids. */
    let pickPreset: (Set<String>?) -> Void

    /** In the view model (⌘A and Esc come from the keyboard); a Binding-like pair for the body's many uses. */
    private var selection: Set<String> {
        get { vm.selection }
        nonmutating set { vm.selection = newValue }
    }
    @State private var showExport = false
    /** The selection as it was when its Export was tapped; nil = Export all. */
    @State private var exportIds: Set<String>?
    /** The lens preset picker: nil = closed, empty = the whole batch, else the selection as it was when it opened. */
    @State private var lensPresetsFor: Set<String>?

    private var selecting: Bool { !selection.isEmpty }
    private var exporting: Bool { vm.export != nil }
    private var exportable: Int { vm.shown.filter { $0.analysis != nil }.count }
    private var exportableSelected: Int { vm.photos.filter { $0.analysis != nil && selection.contains($0.id) }.count }

    var body: some View { withSheets(navigation) }

    private var navigation: some View {
        NavigationStack {
            #if os(macOS)
            HStack(spacing: 0) {
                sidebar
                Divider()
                VStack(spacing: 0) {
                    exportProgress
                    if vm.photos.isEmpty {
                        empty
                    } else if vm.shown.isEmpty {
                        VStack(spacing: 10) {
                            Text("No photos match the filter").foregroundStyle(.secondary)
                            Button("Clear filter") { vm.filter = AutoFilter() }
                        }
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                    } else {
                        grid
                    }
                }
                // The empty state's prompt is only as wide as its text: without this the row was centred in the window and
                // the sidebar sat in the middle of it.
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
            .navigationTitle(selecting ? "\(selection.count) selected" : "RawBoy Auto")
            .toolbar { toolbar }
            #else
            VStack(spacing: 0) {
                if !selecting {
                    // One line (two on narrow phones): the mode for photos added next (each can switch later) and the
                    // batch's RawBoy preset. Export format and size are asked in ExportSheet, so the grid keeps the screen.
                    ViewThatFits(in: .horizontal) {
                        HStack(spacing: 12) {
                            importMode
                            presetControl
                            sortControl
                            lensPresetsControl
                            autoDenoiseControl
                            Spacer(minLength: 0)
                        }
                        VStack(alignment: .leading, spacing: 4) {
                            importMode
                            presetControl
                            sortControl
                            lensPresetsControl
                            autoDenoiseControl
                        }
                    }
                    .disabled(exporting)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 6)
                }
                exportProgress
                if vm.photos.isEmpty {
                    empty
                } else {
                    grid
                }
            }
            .navigationTitle(selecting ? "\(selection.count) selected" : "RawBoy Auto")
            .inlineTitle()
            .toolbar { toolbar }
            #endif
        }
    }

    @ViewBuilder private var exportProgress: some View {
        if let e = vm.export {
            VStack(alignment: .leading, spacing: 4) {
                HStack {
                    Text(e.stopping
                        ? "Stopping after photo \(min(e.done + 1, e.total))…"
                        : "Exporting \(min(e.done + 1, e.total)) of \(e.total)").font(.caption)
                    Spacer()
                    if e.total > 1 {
                        Button("Stop") { vm.stopExport() }.font(.caption).disabled(e.stopping)
                    }
                }
                ProgressView(value: min(max((Double(e.done) + Double(e.current)) / Double(e.total), 0), 1))
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 6)
        }
    }

    /** The sheets and the selection/export bookkeeping, shared by the phone and Mac layouts. */
    private func withSheets<V: View>(_ content: V) -> some View {
        content
        .sheet(isPresented: $showExport) {
            let ids = exportIds
            ExportSheet(vm: vm, count: ids.map { ids in vm.photos.filter { $0.analysis != nil && ids.contains($0.id) }.count } ?? exportable) {
                if let ids {
                    selection = []  // the grid's badges then show each photo's export
                    vm.exportAll(only: ids)
                } else {
                    vm.exportAll()
                }
            }
        }
        .sheet(isPresented: Binding(get: { lensPresetsFor != nil && !vm.lensPresets.isEmpty }, set: { if !$0 { lensPresetsFor = nil } })) {
            let ids = lensPresetsFor.flatMap { $0.isEmpty ? nil : $0 }
            LensPresetsSheet(vm: vm, ids: ids) {
                if ids != nil { selection = [] }
            }
        }
        // Drop ids of photos that left the list (removed elsewhere, e.g. via the detail view).
        .onChange(of: vm.photos.map(\.id)) { _, ids in selection.formIntersection(ids) }
        .onChange(of: vm.exportRequest) { _, _ in
            if !exporting && exportable > 0 {
                exportIds = selecting ? selection : nil
                showExport = true
            }
        }
    }

    private var importMode: some View {
        HStack {
            Text("Import as").font(.subheadline).foregroundStyle(.secondary)
            Picker("Import as", selection: Binding(get: { vm.importMode }, set: { vm.setImportMode($0) })) {
                ForEach(ImportMode.allCases, id: \.self) { Text($0.label).tag($0) }
            }
            .labelsHidden()
            .pickerStyle(.segmented)
            .neutralSegments()
            .frame(width: 240)
        }
    }

    /** The batch's order: by shoot date (photos without one by their file's date), or by file name. */
    @ViewBuilder private var sortControl: some View {
        if !vm.photos.isEmpty {
            Button(vm.sort == .date ? "Sort: Shoot date" : "Sort: File name") {
                vm.setSort(vm.sort == .date ? .name : .date)
            }
            .font(.subheadline)
            .lineLimit(1)
        }
    }

    /** A RawBoy preset (from a file, or sent from RawBoy) develops every photo in place of its look. */
    @ViewBuilder private var presetControl: some View {
        if let p = vm.preset {
            Button { vm.removePreset() } label: {
                HStack(spacing: 4) {
                    Text("Preset: \(p.name)").lineLimit(1)
                    Image(systemName: "xmark").font(.caption)
                }
                .font(.subheadline)
                .padding(.horizontal, 10)
                .padding(.vertical, 4)
                .overlay(Capsule().stroke(Color.accentColor))
            }
            .accessibilityLabel("Remove preset \(p.name)")
        } else {
            Button("Apply RawBoy preset…") { pickPreset(nil) }.font(.subheadline)
        }
    }

    /**
     * Lens presets from RawBoy: by lens they correct every photo taken with their lens, whatever its look; a named one
     * (manual lenses) is picked for the batch here or for a selection.
     */
    @ViewBuilder private var lensPresetsControl: some View {
        let n = vm.lensPresets.count
        if n > 0 {
            let label: String = {
                guard let c = vm.lensChoice else { return n == 1 ? "1 lens preset" : "\(n) lens presets" }
                if c == Presets.noLensPreset { return "Lens: none" }
                return "Lens: \(vm.lensPresets.first { $0.id == c }?.name ?? "by lens")"
            }()
            Button(label) { lensPresetsFor = [] }.font(.subheadline).lineLimit(1)
        }
    }

    /** For a finished series: each photo's own measured denoise in place of its Denoise slider. */
    @ViewBuilder private var autoDenoiseControl: some View {
        if !vm.photos.isEmpty {
            Button("Auto denoise all") { vm.autoDenoiseAll() }.font(.subheadline).lineLimit(1)
        }
    }

    #if os(macOS)
    /**
     * The Mac's batch settings, in a sidebar beside the grid as RawBoy Viewer's: what photos added next become, the
     * order, the batch's preset and lens presets, and the denoise for a finished series. On the phones they are the
     * line above the grid.
     */
    private var sidebar: some View {
        VStack(alignment: .leading, spacing: 0) {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                sidebarHeading("New photos")
                Picker("Import as", selection: Binding(get: { vm.importMode }, set: { vm.setImportMode($0) })) {
                    ForEach(ImportMode.allCases, id: \.self) { Text($0.label).tag($0) }
                }
                .labelsHidden()
                .pickerStyle(.segmented)
                .neutralSegments()
                .help("What photos added next are developed as; each photo can switch later")
                Text(Self.importHint(vm.importMode)).font(.caption).foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true).padding(.top, 4)
                sidebarHeading("Order")
                Picker("Order", selection: Binding(get: { vm.sort }, set: { vm.setSort($0) })) {
                    Text("Shoot date").tag(PhotoSort.date)
                    Text("File name").tag(PhotoSort.name)
                }
                .labelsHidden()
                .pickerStyle(.segmented)
                .neutralSegments()
                sidebarHeading("Preset")
                if let p = vm.preset {
                    HStack(spacing: 6) {
                        Text(p.name).font(.subheadline).lineLimit(2)
                        Spacer(minLength: 0)
                        Button { vm.removePreset() } label: { Image(systemName: "xmark.circle.fill") }
                            .buttonStyle(.borderless)
                            .foregroundStyle(.secondary)
                            .help("Remove the preset: photos go back to their looks")
                            .accessibilityLabel("Remove preset \(p.name)")
                    }
                    Text("Develops every photo in place of its look.").font(.caption).foregroundStyle(.secondary)
                } else {
                    Button("Apply RawBoy preset…") { pickPreset(nil) }
                    Text("One of your Pro presets develops every photo in place of its look.").font(.caption).foregroundStyle(.secondary)
                        .padding(.top, 2)
                }
                if !vm.lensPresets.isEmpty {
                    sidebarHeading("Lens")
                    lensPresetsControl
                }
                if !vm.photos.isEmpty {
                    FilterSection(vm: vm, heading: { AnyView(sidebarHeading($0)) })
                    sidebarHeading("Denoise")
                    Button("Auto denoise all") { vm.autoDenoiseAll() }
                    Text("Each photo's own measured denoise, for a finished series.").font(.caption).foregroundStyle(.secondary)
                        .padding(.top, 2)
                }
            }
            .controlSize(.small)
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .scrollIndicators(.hidden)
        // The batch at a glance, at the sidebar's foot (a Spacer inside the scroll view doesn't reach it).
        if !vm.photos.isEmpty {
            Divider()
            Text(batchSummary).font(.caption).foregroundStyle(.secondary).monospacedDigit()
                .padding(.horizontal, 14).padding(.vertical, 10)
        }
        }
        .frame(width: 220)
        .frame(maxHeight: .infinity)
        .background(Color(red: 0x1C / 255, green: 0x1C / 255, blue: 0x1E / 255))  // DESIGN.md's surface: an opaque edge panel
        .disabled(exporting)
    }

    private func sidebarHeading(_ text: String) -> some View {
        Text(text).font(.caption.weight(.semibold)).textCase(.uppercase).tracking(0.6).foregroundStyle(.secondary)
            .padding(.top, 16).padding(.bottom, 6)
            .accessibilityAddTraits(.isHeader)
    }

    /** What each Import as does, under the picker (the web's hint). */
    static func importHint(_ mode: ImportMode) -> String {
        switch mode {
        case .looks: return "Auto develop and a suggested colour look."
        case .film: return "Auto develop as film on a suggested stock."
        case .plain: return "No automatic edits and no look: raws get only their measured denoise, other files stay as they are."
        }
    }

    /** "24 photos · 3 waiting · 5 saved": the batch at a glance. */
    private var batchSummary: String {
        let n = vm.photos.count
        var parts = [n == 1 ? "1 photo" : "\(n) photos"]
        if vm.filter.isActive { parts[0] = "\(vm.shown.count) of \(n) shown" }
        let waiting = vm.photos.filter { $0.status == .queued || $0.status == .analyzing }.count
        if waiting > 0 { parts.append("\(waiting) to analyse") }
        let saved = vm.photos.filter { $0.status == .exported }.count
        if saved > 0 { parts.append("\(saved) saved") }
        return parts.joined(separator: " · ")
    }

    /**
     * The Mac's grid, as RawBoy Viewer's: even cells, each photo fitted whole in its tile with the name and look under it
     * (justified rows cropped nothing but gave every row its own height, and the names sat on the pictures).
     */
    private var macGrid: some View {
        GeometryReader { geo in
            let gap: CGFloat = 14
            let photos = vm.shown
            let columns = max(1, Int((geo.size.width - gap) / (Self.macCellMin + gap)))  // padding gap on each side, gap between
            let _ = { vm.rowStarts = Array(stride(from: 0, to: photos.count, by: columns)) }()
            ScrollViewReader { scroll in
                ScrollView {
                    LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: gap, alignment: .top), count: columns),
                              spacing: gap + 4) {
                        ForEach(photos) { photo in
                            cell(photo).id(photo.id)
                        }
                    }
                    .padding(gap)
                }
                .onChange(of: vm.focusedId) { _, id in
                    if let id { Motion.animate { scroll.scrollTo(id) } }
                }
            }
        }
        .background(Color(red: 0x12 / 255, green: 0x12 / 255, blue: 0x12 / 255))
    }

    /** The smallest cell width; the columns share what is left over. */
    private static let macCellMin: CGFloat = 190
    #endif

    private var empty: some View {
        VStack(spacing: 16) {
            Spacer()
            Text(vm.importMode == .plain
                 ? "Pick photos, e.g. TIFFs finished elsewhere. Each is added as it is, with no automatic edits (raws get their measured denoise): apply a preset or a look yourself."
                 : (vm.importMode == .film
                    ? "Pick RAW photos. Each is developed automatically as film, on a suggested stock."
                    : "Pick RAW photos. Each is developed automatically and gets a suggested film look.")
                   + " JPEG, HEIC, PNG and TIFF work too, at lower quality.")
                .multilineTextAlignment(.center)
                .foregroundStyle(.secondary)
            if let addFromPhotos {
                Button("Choose from Photos", action: addFromPhotos).buttonStyle(.borderedProminent)
                Button("Choose from Files", action: addFromFiles)
            } else {
                Button("Add photos… (⌘O)", action: addFromFiles).buttonStyle(.borderedProminent)
                if let addFromFolder { Button("Add a folder… (⇧⌘O)", action: addFromFolder) }
                Text("or drop photos or a folder here").font(.caption).foregroundStyle(.secondary)
            }
            Spacer()
        }
        .padding(32)
    }

    @ViewBuilder private var grid: some View {
        #if os(macOS)
        macGrid
        #else
        justifiedGrid
        #endif
    }

    /** Justified rows: every photo at its own aspect, rows ~120 pt high on phones and ~180 pt wider up. */
    private var justifiedGrid: some View {
        GeometryReader { geo in
            let gap: CGFloat = 8
            let photos = vm.shown
            let aspects = photos.map { p in p.thumbnail.map { CGFloat($0.width) / CGFloat($0.height) } ?? 1.5 }
            let rows = justifiedRows(aspects, width: geo.size.width - gap * 2,
                                     target: geo.size.width < 600 ? 120 : 180, gap: gap)
            let _ = { vm.rowStarts = rows.map(\.start) }()
            ScrollViewReader { scroll in
            ScrollView {
                LazyVStack(spacing: gap) {
                    ForEach(rows, id: \.start) { row in
                        HStack(spacing: gap) {
                            ForEach(row.start..<row.end, id: \.self) { i in
                                cell(photos[i])
                                    .frame(width: aspects[i] * row.height, height: row.height)
                            }
                            if !row.full { Spacer(minLength: 0) }
                        }
                        .id(photos[row.start].id)
                    }
                }
                .padding(gap)
            }
            // The keyboard focus stays in view.
            .onChange(of: vm.focusedId) { _, id in
                if let id, let i = photos.firstIndex(where: { $0.id == id }), let row = rows.last(where: { $0.start <= i }) {
                    Motion.animate { scroll.scrollTo(photos[row.start].id) }
                }
            }
            }
        }
    }

    private func cell(_ photo: AutoPhoto) -> some View {
        PhotoCell(photo: photo, next: vm.opening == photo.id, waiting: vm.export?.waiting.contains(photo.id) ?? false,
                  selected: selection.contains(photo.id), focused: vm.focusedId == photo.id)
            .onTapGesture { activate(photo) }
            .onLongPressGesture { if !exporting { selection.insert(photo.id) } }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(photo.name)
            .accessibilityValue(Self.spokenState(photo, selected: selection.contains(photo.id)))
            .accessibilityHint(selecting ? "Selects or deselects the photo" : "Opens the photo")
            .accessibilityAddTraits(selection.contains(photo.id) ? [.isButton, .isSelected] : .isButton)
            .accessibilityAction { activate(photo) }
            .accessibilityAction(named: selection.contains(photo.id) ? "Deselect" : "Select") {
                if selection.contains(photo.id) { selection.remove(photo.id) } else { selection.insert(photo.id) }
            }
    }

    /** What VoiceOver adds to a photo's name: where it is in the analysis, its look, and whether it is selected. */
    private static func spokenState(_ photo: AutoPhoto, selected: Bool) -> String {
        var parts: [String] = []
        switch photo.status {
        case .queued: parts.append("waiting to be analysed")
        case .analyzing: parts.append("being analysed")
        case .exporting: parts.append("being saved")
        case .exported: parts.append("saved")
        case .failed: parts.append("failed: \(photo.error ?? "unknown error")")
        case .ready: break
        }
        if photo.analysis != nil { parts.append("look \(photo.lookName)") }
        if selected { parts.append("selected") }
        return parts.joined(separator: ", ")
    }

    /** A tap or a VoiceOver activation: opens the photo, or selects it (⇧ and ⌘ select like Finder on the Mac). */
    private func activate(_ photo: AutoPhoto) {
        guard !exporting else { return }
        vm.focusedId = photo.id
        #if os(macOS)
        // ⌘-click or ⇧-click selects, as in Finder; a plain click opens.
        if NSEvent.modifierFlags.contains(.shift) {
            vm.selectRange(to: photo.id)  // from the last clicked photo to this one
            return
        }
        if NSEvent.modifierFlags.contains(.command) {
            if selection.contains(photo.id) { selection.remove(photo.id) } else { selection.insert(photo.id) }
            vm.selectionAnchor = photo.id
            return
        }
        vm.selectionAnchor = photo.id
        #endif
        if selecting {
            if selection.contains(photo.id) { selection.remove(photo.id) } else { selection.insert(photo.id) }
        } else {
            vm.openFromGrid(photo.id)
        }
    }

    @ToolbarContentBuilder
    private var toolbar: some ToolbarContent {
        if selecting {
            ToolbarItem(placement: .barLeading) {
                Button("Cancel") { selection = [] }
            }
            ToolbarItemGroup(placement: .barTrailing) {
                Button("All") { selection = Set(vm.photos.map(\.id)) }
                // A lens preset for these photos: manual lenses record no lens name to match by.
                if !vm.lensPresets.isEmpty {
                    Button("Lens preset", systemImage: "camera.aperture") { lensPresetsFor = selection }
                        .disabled(exporting)
                }
                // Each selected photo's own measured denoise in place of its Denoise slider.
                Button("Auto denoise", systemImage: "aqi.medium") { vm.autoDenoiseAll(selection) }
                    .disabled(exporting)
                Button("Rotate left", systemImage: "rotate.left") { vm.rotate(selection, by: -1) }
                    .disabled(exporting)
                Button("Rotate right", systemImage: "rotate.right") { vm.rotate(selection, by: 1) }
                    .disabled(exporting)
                // A preset file for just these photos (one scene); the rest of the batch keeps its own.
                Button("Preset", systemImage: "bookmark") {
                    pickPreset(selection)
                    selection = []
                }
                .disabled(exporting)
                if let edit = vm.editInPro, selection.count == 1, let p = vm.photo(selection.first!) {
                    Button("Edit in Pro", systemImage: "slider.horizontal.3") { edit(p) }.disabled(exporting)
                }
                Button("Remove", systemImage: "trash", role: .destructive) {
                    vm.remove(selection)
                    selection = []
                }
                .disabled(exporting)
                Button(exportableSelected > 1 ? "Export (\(exportableSelected))" : "Export") {
                    exportIds = selection
                    showExport = true
                }
                .buttonStyle(.borderedProminent)
                .disabled(exporting || exportableSelected == 0)
            }
        } else {
            ToolbarItem(placement: .barLeading) {
                Menu("Add") {
                    if let addFromPhotos { Button("From Photos", systemImage: "photo.on.rectangle", action: addFromPhotos) }
                    Button(addFromPhotos == nil ? "Photos…" : "From Files", systemImage: "folder", action: addFromFiles)
                    if let addFromFolder { Button("A Folder…", systemImage: "folder.badge.plus", action: addFromFolder) }
                }
                .disabled(exporting)
            }
            ToolbarItemGroup(placement: .barTrailing) {
                if onResetAll != nil {
                    Button("Reset all photos…", systemImage: "arrow.counterclockwise") { onResetAll?() }
                        .disabled(exporting || vm.photos.isEmpty)
                        .help("Put every photo back to one look, film stock or As is, clearing its adjustments")
                        .accessibilityLabel("Reset all photos")
                        .accessibilityHint("Asks which look, film stock or As is to give every photo, and clears their adjustments")
                }
                if onClearBatch != nil {
                    Button("Clear batch", systemImage: "xmark.bin") { onClearBatch?() }
                        .disabled(exporting || vm.photos.isEmpty)
                        .help("Take every photo out of the batch (files and sidecars stay)")
                }
                Button(exportable > 1 ? "Export all (\(exportable))" : "Export") {
                    exportIds = nil
                    showExport = true
                }
                    .buttonStyle(.borderedProminent)
                    .disabled(exporting || exportable == 0)
                HelpButton("RawBoy Auto", sections: autoHelp, licences: true)
            }
        }
    }
}

private struct PhotoCell: View {
    let photo: AutoPhoto
    /** Tapped while waiting: analysed next, then opened. */
    let next: Bool
    /** Still to be saved by the running "Export all": shown desaturated. */
    let waiting: Bool
    let selected: Bool
    var focused = false

    /** The Mac's cells are big and its screens too: the name and the look read at caption size there. */
    private static var nameFont: Font {
        #if os(macOS)
        .caption
        #else
        .caption2
        #endif
    }

    var body: some View {
        #if os(macOS)
        macBody
        #else
        phoneBody
        #endif
    }

    #if os(macOS)
    /** The picture fitted whole in a 3:2 tile, the name and look under it, as RawBoy Viewer's cells. */
    private var macBody: some View {
        VStack(alignment: .leading, spacing: 5) {
            ZStack {
                Color(white: 0.09)
                if let t = photo.thumbnail {
                    Image(decorative: t, scale: 1).resizable().scaledToFit()
                        .saturation(waiting ? 0 : 1)
                        .brightness(waiting ? -0.12 : 0)
                        .contrast(waiting ? 0.75 : 1)
                        .animation(Motion.easeOut(0.6), value: waiting)
                }
                status
            }
            .aspectRatio(3 / 2, contentMode: .fit)
            .clipShape(RoundedRectangle(cornerRadius: 4))
            .overlay(RoundedRectangle(cornerRadius: 4)
                .stroke(selected ? Color.accentColor : focused ? Color.white.opacity(0.8) : .clear, lineWidth: 2))
            VStack(alignment: .leading, spacing: 1) {
                Text(photo.name).font(.caption).foregroundStyle(.primary).lineLimit(1).truncationMode(.middle)
                Text(photo.analysis != nil ? photo.lookName : " ").font(.caption).foregroundStyle(.secondary).lineLimit(1)
            }
            .padding(.horizontal, 2)
        }
        .help(photo.analysis != nil ? "\(photo.name) · \(photo.lookName)" : photo.name)
        .contentShape(Rectangle())
    }
    #endif

    /** Status badges and the selection tick over the picture. */
    @ViewBuilder private var status: some View {
        switch photo.status {
        case .queued: Badge(text: next ? "Next" : "Waiting")
        case .analyzing, .exporting: ProgressView()
        case .failed: Badge(text: photo.error ?? "Failed", error: true)
        case .exported: Badge(text: "Saved").frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topTrailing)
        case .ready: EmptyView()
        }
        if selected {
            Image(systemName: "checkmark.circle.fill")
                .foregroundStyle(Color.accentColor)
                .background(Circle().fill(.black.opacity(0.8)))
                .padding(6)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        }
    }

    private var phoneBody: some View {
        ZStack {
            ZStack {
                Color(white: 0.12)
                if let t = photo.thumbnail {
                    // Grey and lower contrast while it waits to be exported, turning to colour once saved.
                    Image(decorative: t, scale: 1).resizable().scaledToFill()
                        .saturation(waiting ? 0 : 1)
                        .brightness(waiting ? -0.12 : 0)
                        .contrast(waiting ? 0.75 : 1)
                        .animation(Motion.easeOut(0.6), value: waiting)
                }
                status
            }
            // Name and look over the bottom of the photo, on a fade so they read on bright skies.
            VStack(alignment: .leading, spacing: 1) {
                Text(photo.name).font(Self.nameFont).foregroundStyle(.white.opacity(0.85)).lineLimit(1)
                if photo.analysis != nil {
                    Text(photo.lookName).font(Self.nameFont.weight(.semibold)).foregroundStyle(Color.accentColor).lineLimit(1)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 8)
            .padding(.top, 16)
            .padding(.bottom, 5)
            .background(LinearGradient(colors: [.clear, .black.opacity(0.7)], startPoint: .top, endPoint: .bottom))
            .frame(maxHeight: .infinity, alignment: .bottom)
        }
        .clipped()
        .help(photo.analysis != nil ? "\(photo.name) · \(photo.lookName)" : photo.name)  // the whole text where a cell clips it
        .overlay(Rectangle().stroke(selected ? Color.accentColor : focused ? Color.white.opacity(0.8) : .clear, lineWidth: focused && !selected ? 2 : 3))
        .contentShape(Rectangle())
    }
}

/** Photos [start, end) of one grid row, [height] pt high; [full] rows fill the width, the last one may not. */
struct GridRow {
    let start: Int
    let end: Int
    let height: CGFloat
    let full: Bool
}

/**
 * Justified rows (as Android's and RawBoy Web's Auto grid): photos join a row until it would be at most [target]
 * high across [width], so each photo keeps its own aspect and rows fill the width. The last row keeps [target] height.
 */
func justifiedRows(_ aspects: [CGFloat], width: CGFloat, target: CGFloat, gap: CGFloat) -> [GridRow] {
    var rows: [GridRow] = []
    var start = 0
    var sum: CGFloat = 0
    for i in aspects.indices {
        sum += aspects[i]
        let height = (width - gap * CGFloat(i - start)) / sum
        if height <= target {
            rows.append(GridRow(start: start, end: i + 1, height: height, full: true))
            start = i + 1
            sum = 0
        }
    }
    if start < aspects.count { rows.append(GridRow(start: start, end: aspects.count, height: target, full: false)) }
    return rows
}

private struct Badge: View {
    let text: String
    var error = false

    var body: some View {
        Text(text)
            .font(.caption2)
            .foregroundStyle(error ? .red : .white)
            .multilineTextAlignment(.center)
            .lineLimit(2)
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background(Color.black.opacity(0.6))
            .padding(6)
    }
}

/**
 * Asked on Export all and the photo view's Export: format, quality or bit depth, and size (kept for the next exports,
 * as RawBoy's export dialog). They used to sit above the grid all the time.
 */
struct ExportSheet: View {
    @ObservedObject var vm: AutoViewModel
    let count: Int
    let onExport: () -> Void
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        let s = vm.exportSettings
        let settingsBinding = Binding<ExportSettings>(
            get: { vm.exportSettings },
            set: { vm.setExportSettings($0) }
        )
        return NavigationStack {
            Form {
                Section {
                    Picker("Format", selection: settingsBinding.format) {
                        ForEach(ExportFormat.allCases, id: \.self) { Text($0.rawValue).tag($0) }
                    }
                    .pickerStyle(.segmented)
                    .neutralSegments()
                    switch s.format {
                    case .jpeg:
                        VStack(alignment: .leading) {
                            Text("Quality \(s.jpegQuality)").font(.subheadline).monospacedDigit()
                            Slider(value: Binding(get: { Double(s.jpegQuality) },
                                                  set: { settingsBinding.wrappedValue.jpegQuality = Int($0.rounded()) }),
                                   in: 1...100, step: 1)
                        }
                    case .tiff:
                        Picker("Bit depth", selection: settingsBinding.tiffBits) {
                            Text("8-bit").tag(8)
                            Text("16-bit").tag(16)
                        }
                        .pickerStyle(.segmented)
                        .neutralSegments()
                    }
                    if vm.hasFilmPhotos {
                        Picker("Film scan", selection: settingsBinding.filmScan) {
                            Text("Off").tag(false)
                            Text("1.5× size").tag(true)
                        }
                        .pickerStyle(.segmented)
                        .neutralSegments()
                        Text("Film photos only: upscaled, with finer grain. The size below doesn't apply to them.")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                    Picker("Size", selection: settingsBinding.maxLongSide) {
                        ForEach(AutoViewModel.exportSizes, id: \.self) { size in
                            Text(size.map { "\($0) px" } ?? "Original").tag(size)
                        }
                    }
                }
                ExportFrameSections(settings: settingsBinding)
                Section {
                    if let destination = vm.destinationView {
                        destination
                    } else {
                        Text("Saved to \(vm.destinationLabel)").font(.caption).foregroundStyle(.secondary)
                    }
                }
            }
            .navigationTitle(count > 1 ? "Export \(count) photos" : "Export")
            .inlineTitle()
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Export") {
                        dismiss()
                        onExport()
                    }
                }
            }
        }
        .presentationDetents([.medium, .large])
    }
}

/**
 * The lens presets Auto keeps (sent from RawBoy or opened as files), to pick one for the photos [ids] (nil = the whole
 * batch and photos added later): by lens (each photo gets the preset saved for its lens), none, or a named preset
 * (manual lenses record no lens name). Each preset has a Remove button.
 */
private struct LensPresetsSheet: View {
    @ObservedObject var vm: AutoViewModel
    let ids: Set<String>?
    /** After a pick. */
    let onChosen: () -> Void
    @Environment(\.dismiss) private var dismiss

    /** The current pick; nil when the photos picked differ. */
    private var current: String?? {
        guard let ids else { return .some(vm.lensChoice) }
        let choices = Set(vm.photos.filter { ids.contains($0.id) }.map(\.lensChoice))
        return choices.count == 1 ? .some(choices.first!) : nil
    }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    option(nil, "By lens", "Each photo gets the preset saved for its lens")
                    option(Presets.noLensPreset, "None", "The auto develop's lens corrections")
                    ForEach(vm.lensPresets) { p in
                        HStack {
                            option(p.id, p.name, Self.lensLabel(p))
                            Button("Remove") { vm.removeLensPreset(p.id) }.buttonStyle(.borderless)
                        }
                    }
                } footer: {
                    Text((ids == nil ? "For every photo, and photos added later. " : "")
                         + "The lens corrections go on top of the look. Save presets in RawBoy's Lens tab.")
                }
            }
            .navigationTitle(ids.map { $0.count == 1 ? "Lens preset for 1 photo" : "Lens preset for \($0.count) photos" } ?? "Lens presets")
            .inlineTitle()
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        }
    }

    private func option(_ value: String?, _ title: String, _ detail: String) -> some View {
        Button {
            vm.chooseLensPreset(value, ids: ids)
            onChosen()
            dismiss()
        } label: {
            HStack {
                Image(systemName: current == .some(value) ? "checkmark.circle.fill" : "circle")
                    .foregroundStyle(Color.accentColor)
                VStack(alignment: .leading) {
                    Text(title)
                    Text(detail).font(.caption).foregroundStyle(.secondary)
                }
                Spacer(minLength: 0)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    /** Which photos a lens preset is for. */
    private static func lensLabel(_ p: Preset) -> String {
        let lens = p.lens?.trimmingCharacters(in: .whitespaces) ?? ""
        return lens.isEmpty ? "Manual lens: pick it here" : "Photos taken with \(lens)"
    }
}

/**
 * RawBoy Desktop's "Reset all photos": which look, film stock or As is every photo goes back to, and the confirmation. The
 * adjustments are cleared; it can be undone photo by photo (Undo in a photo's view).
 */
struct ResetAllSheet: View {
    @ObservedObject var vm: AutoViewModel
    @Binding var isPresented: Bool

    private enum Kind: String, CaseIterable { case look = "Look", film = "Film stock", asIs = "As is" }
    @State private var kind = Kind.look
    @State private var look = Looks.portra400
    @State private var film = FilmLooks.portra400

    private var count: Int { vm.photos.count }
    private var target: AutoReset.Target {
        switch kind {
        case .look: .look(look)
        case .film: .film(film)
        case .asIs: .asIs
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text(count == 1 ? "Reset the photo?" : "Reset all \(count) photos?").font(.headline)
            Picker("Reset to", selection: $kind) {
                ForEach(Kind.allCases, id: \.self) { Text($0.rawValue).tag($0) }
            }
            .pickerStyle(.segmented)
            .neutralSegments()
            .accessibilityHint("Choose what every photo goes back to")
            switch kind {
            case .look:
                Picker("Look", selection: $look) {
                    ForEach(Looks.all) { Text($0.name).tag($0) }
                }
            case .film:
                Picker("Film stock", selection: $film) {
                    ForEach(FilmLooks.all) { Text($0.name).tag($0) }
                }
            case .asIs:
                Text("No look: just the automatic exposure and tone.").font(.callout).foregroundStyle(.secondary)
            }
            Text("This clears each photo's Strength, brightness, warmth, tint, contrast, saturation, grain, denoise, rotation and crop, and any RawBoy preset. The photos stay in the batch, and their sidecars are updated. Undo in a photo's view brings its edits back.")
                .font(.callout).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            HStack {
                Spacer()
                Button("Cancel", role: .cancel) { isPresented = false }.keyboardShortcut(.cancelAction)
                Button(count == 1 ? "Reset 1 photo" : "Reset \(count) photos", role: .destructive) {
                    vm.resetAll(to: target)
                    isPresented = false
                }
                .keyboardShortcut(.defaultAction)
                .accessibilityHint("Resets \(count == 1 ? "the photo" : "all \(count) photos") and clears their adjustments")
            }
        }
        .padding(20)
        .frame(width: 440)
    }
}

#if os(macOS)
/**
 * The sidebar's Filter (the web's): camera, lens, ISO range, focal length range and shoot day, each listing what the batch
 * holds with a count, and Unedited (photos still As is). The grid, the photo view's arrows and Export all follow it.
 */
private struct FilterSection: View {
    @ObservedObject var vm: AutoViewModel
    let heading: (String) -> AnyView

    var body: some View {
        let photos = vm.photos
        let cameras = Self.options(photos.compactMap(\.cameraLabel))
        let lenses = Self.options(photos.compactMap(\.lensLabel))
        let isos = Self.counts(photos.compactMap(\.isoValue)).sorted { $0.0 < $1.0 }
        let focals = Self.counts(photos.compactMap(\.focalLengthValue)).sorted { $0.0 < $1.0 }
        let days = Self.options(photos.compactMap(\.day))
        heading("Filter")
        VStack(alignment: .leading, spacing: 6) {
            menu("Camera", vm.filter.camera, cameras) { vm.filter.camera = $0 }
            menu("Lens", vm.filter.lens, lenses) { vm.filter.lens = $0 }
            HStack(spacing: 6) {
                rangeMenu("Min ISO", "", vm.filter.isoMin, isos) { v in
                    vm.filter.isoMin = v
                    if let v, let hi = vm.filter.isoMax, hi < v { vm.filter.isoMax = nil }
                }
                rangeMenu("Max ISO", "", vm.filter.isoMax, isos) { v in
                    vm.filter.isoMax = v
                    if let v, let lo = vm.filter.isoMin, lo > v { vm.filter.isoMin = nil }
                }
            }
            HStack(spacing: 6) {
                rangeMenu("Min mm", "mm", vm.filter.focalMin, focals) { v in
                    vm.filter.focalMin = v
                    if let v, let hi = vm.filter.focalMax, hi < v { vm.filter.focalMax = nil }
                }
                rangeMenu("Max mm", "mm", vm.filter.focalMax, focals) { v in
                    vm.filter.focalMax = v
                    if let v, let lo = vm.filter.focalMin, lo > v { vm.filter.focalMin = nil }
                }
            }
            menu("Date", vm.filter.date, days) { vm.filter.date = $0 }
            Toggle("Unedited (As is)", isOn: $vm.filter.unedited)
                .help("Only photos still As is: no look, preset, edits or adjustments")
            if vm.filter.isActive {
                Button("Clear filter") { vm.filter = AutoFilter() }
            }
        }
    }

    private static func counts<T: Hashable>(_ values: [T]) -> [(T, Int)] {
        Dictionary(values.map { ($0, 1) }, uniquingKeysWith: +).map { ($0.key, $0.value) }
    }

    private static func options(_ values: [String]) -> [(String, Int)] {
        counts(values).sorted { $0.0.localizedStandardCompare($1.0) == .orderedAscending }
    }

    private func menu(_ title: String, _ value: String?, _ options: [(String, Int)], _ set: @escaping (String?) -> Void) -> some View {
        Picker(title, selection: Binding(get: { value ?? "" }, set: { set($0.isEmpty ? nil : $0) })) {
            Text("Any").tag("")
            ForEach(options, id: \.0) { o in Text("\(o.0) (\(o.1))").tag(o.0) }
            if let value, !options.contains(where: { $0.0 == value }) { Text(value).tag(value) }
        }
        .help("\(title): only photos with this value")
    }

    private func rangeMenu(_ title: String, _ unit: String, _ value: Int?, _ options: [(Int, Int)], _ set: @escaping (Int?) -> Void) -> some View {
        // String tags match menu(_:_:_:_:) so macOS Picker's NSPopUpButton reliably updates when options populate after analysis.
        let stringOptions = options.map { (key: String($0.0), label: unit.isEmpty ? "\($0.0)" : "\($0.0) \(unit)", count: $0.1) }
        return Picker(title, selection: Binding(
            get: { value.map(String.init) ?? "" },
            set: { set($0.isEmpty ? nil : Int($0)) }
        )) {
            Text(title).tag("")
            ForEach(stringOptions, id: \.key) { o in Text("\(o.label) (\(o.count))").tag(o.key) }
            if let value, !options.contains(where: { $0.0 == value }) {
                Text(unit.isEmpty ? "\(value)" : "\(value) \(unit)").tag(String(value))
            }
        }
        .labelsHidden()
        .help(title)
    }
}
#endif
