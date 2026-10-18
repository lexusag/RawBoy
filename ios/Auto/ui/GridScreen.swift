import RawBoyEngine
import SwiftUI

/**
 * The batch as a grid; long-press a photo to start selecting (for rotating, removing, exporting and giving photos, one
 * scene, their own RawBoy preset).
 */
struct GridScreen: View {
    @ObservedObject var vm: AutoViewModel
    let addFromPhotos: () -> Void
    let addFromFiles: () -> Void
    /** Opens a RawBoy preset file to apply to the batch (nil), or to the photos with these ids. */
    let pickPreset: (Set<String>?) -> Void

    @State private var selection = Set<String>()
    @State private var showExport = false
    /** The selection as it was when its Export was tapped; nil = Export all. */
    @State private var exportIds: Set<String>?

    private var selecting: Bool { !selection.isEmpty }
    private var exporting: Bool { vm.export != nil }
    private var exportable: Int { vm.photos.filter { $0.analysis != nil }.count }
    private var exportableSelected: Int { vm.photos.filter { $0.analysis != nil && selection.contains($0.id) }.count }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                if !selecting {
                    // One line (two on narrow phones): the mode for photos added next (each can switch later) and the
                    // batch's RawBoy preset. Export format and size are asked in ExportSheet, so the grid keeps the screen.
                    ViewThatFits(in: .horizontal) {
                        HStack(spacing: 12) {
                            importMode
                            presetControl
                            Spacer(minLength: 0)
                        }
                        VStack(alignment: .leading, spacing: 4) {
                            importMode
                            presetControl
                        }
                    }
                    .disabled(exporting)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 6)
                }
                if let e = vm.export {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Exporting \(min(e.done + 1, e.total)) of \(e.total)").font(.caption)
                        ProgressView(value: min(max((Double(e.done) + Double(e.current)) / Double(e.total), 0), 1))
                    }
                    .padding(.horizontal, 16)
                    .padding(.vertical, 6)
                }
                if vm.photos.isEmpty {
                    empty
                } else {
                    grid
                }
            }
            .navigationTitle(selecting ? "\(selection.count) selected" : "RawBoy Auto")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { toolbar }
        }
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
        // Drop ids of photos that left the list (removed elsewhere, e.g. via the detail view).
        .onChange(of: vm.photos.map(\.id)) { _, ids in selection.formIntersection(ids) }
    }

    private var importMode: some View {
        HStack {
            Text("Import as").font(.subheadline).foregroundStyle(.secondary)
            Picker("Import as", selection: Binding(get: { vm.importMode }, set: { vm.setImportMode($0) })) {
                Text("Looks").tag(LookMode.looks)
                Text("Film").tag(LookMode.film)
            }
            .pickerStyle(.segmented)
            .frame(width: 180)
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

    private var empty: some View {
        VStack(spacing: 16) {
            Spacer()
            Text((vm.importMode == .film
                  ? "Pick RAW photos. Each is developed automatically as film, on a suggested stock."
                  : "Pick RAW photos. Each is developed automatically and gets a suggested film look.")
                 + " JPEG, HEIC, PNG and TIFF work too, at lower quality.")
                .multilineTextAlignment(.center)
                .foregroundStyle(.secondary)
            Button("Choose from Photos", action: addFromPhotos).buttonStyle(.borderedProminent)
            Button("Choose from Files", action: addFromFiles)
            Spacer()
        }
        .padding(32)
    }

    /** Justified rows: every photo at its own aspect, rows ~120 pt high on phones and ~180 pt wider up. */
    private var grid: some View {
        GeometryReader { geo in
            let gap: CGFloat = 8
            let photos = vm.photos
            let aspects = photos.map { p in p.thumbnail.map { CGFloat($0.width) / CGFloat($0.height) } ?? 1.5 }
            let rows = justifiedRows(aspects, width: geo.size.width - gap * 2,
                                     target: geo.size.width < 600 ? 120 : 180, gap: gap)
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
        }
    }

    private func cell(_ photo: AutoPhoto) -> some View {
        PhotoCell(photo: photo, selected: selection.contains(photo.id))
            .onTapGesture {
                guard !exporting else { return }
                if selecting {
                    if selection.contains(photo.id) { selection.remove(photo.id) } else { selection.insert(photo.id) }
                } else if photo.analysis != nil {
                    vm.openDetail(photo.id)
                }
            }
            .onLongPressGesture { if !exporting { selection.insert(photo.id) } }
    }

    @ToolbarContentBuilder
    private var toolbar: some ToolbarContent {
        if selecting {
            ToolbarItem(placement: .topBarLeading) {
                Button("Cancel") { selection = [] }
            }
            ToolbarItemGroup(placement: .topBarTrailing) {
                Button("All") { selection = Set(vm.photos.map(\.id)) }
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
            ToolbarItem(placement: .topBarLeading) {
                Menu("Add") {
                    Button("From Photos", systemImage: "photo.on.rectangle", action: addFromPhotos)
                    Button("From Files", systemImage: "folder", action: addFromFiles)
                }
                .disabled(exporting)
            }
            ToolbarItemGroup(placement: .topBarTrailing) {
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
    let selected: Bool

    var body: some View {
        ZStack {
            ZStack {
                Color(white: 0.12)
                if let t = photo.thumbnail {
                    Image(decorative: t, scale: 1).resizable().scaledToFill()
                }
                switch photo.status {
                case .queued: Badge(text: "Waiting")
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
            // Name and look over the bottom of the photo, on a fade so they read on bright skies.
            VStack(alignment: .leading, spacing: 1) {
                Text(photo.name).font(.caption2).foregroundStyle(.white.opacity(0.85)).lineLimit(1)
                if photo.analysis != nil {
                    Text(photo.lookName).font(.caption2.weight(.semibold)).foregroundStyle(Color.accentColor).lineLimit(1)
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
        .overlay(Rectangle().stroke(selected ? Color.accentColor : .clear, lineWidth: 3))
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
        func set(_ change: (inout ExportSettings) -> Void) {
            var next = vm.exportSettings
            change(&next)
            vm.setExportSettings(next)
        }
        return NavigationStack {
            VStack(alignment: .leading, spacing: 12) {
                HStack {
                    Text("Format").font(.subheadline).foregroundStyle(.secondary)
                    Picker("Format", selection: Binding(get: { s.format }, set: { f in set { $0.format = f } })) {
                        ForEach(ExportFormat.allCases, id: \.self) { Text($0.rawValue).tag($0) }
                    }
                    .pickerStyle(.segmented)
                    Picker("Size", selection: Binding(get: { s.maxLongSide }, set: { v in set { $0.maxLongSide = v } })) {
                        ForEach(AutoViewModel.exportSizes, id: \.self) { size in
                            Text(size.map { "\($0) px" } ?? "Original").tag(size)
                        }
                    }
                    .pickerStyle(.menu)
                }
                switch s.format {
                case .jpeg:
                    HStack {
                        Text("Quality \(s.jpegQuality)").font(.subheadline).monospacedDigit()
                        Slider(value: Binding(get: { Double(s.jpegQuality) },
                                              set: { q in set { $0.jpegQuality = Int(q.rounded()) } }),
                               in: 1...100, step: 1)
                    }
                case .tiff:
                    Picker("Bit depth", selection: Binding(get: { s.tiffBits }, set: { b in set { $0.tiffBits = b } })) {
                        Text("8-bit").tag(8)
                        Text("16-bit").tag(16)
                    }
                    .pickerStyle(.segmented)
                }
                Text("Saved to Photos › \(AutoViewModel.naming.folder)").font(.caption).foregroundStyle(.secondary)
                Spacer(minLength: 0)
            }
            .padding(16)
            .navigationTitle(count > 1 ? "Export \(count) photos" : "Export")
            .navigationBarTitleDisplayMode(.inline)
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
        .presentationDetents([.height(260)])
    }
}
