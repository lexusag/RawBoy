import RawBoyEngine
import SwiftUI

/** RawBoy Packer's window: files on the left, settings and what they do on the right. */
struct PackerView: View {
    @ObservedObject var model: PackerModel
    @State private var dropping = false

    var body: some View {
        HSplitView {
            fileList.frame(minWidth: 380)
            settingsPanel.frame(minWidth: 340, idealWidth: 380, maxWidth: 460)
        }
        .frame(minWidth: 820, minHeight: 560)
        .preferredColorScheme(.dark)
        .overlay {
            if dropping {
                RoundedRectangle(cornerRadius: 12).strokeBorder(Color.accentColor, lineWidth: 3).padding(6).allowsHitTesting(false)
            }
        }
        .onDrop(of: [.fileURL], isTargeted: $dropping) { providers in
            Task { @MainActor in
                var urls: [URL] = []
                for provider in providers {
                    let url: URL? = await withCheckedContinuation { c in _ = provider.loadObject(ofClass: URL.self) { u, _ in c.resume(returning: u) } }
                    if let url { urls.append(url) }
                }
                model.add(urls)
            }
            return !model.running
        }
        .navigationTitle("RawBoy Packer")
    }

    // MARK: Files

    private var fileList: some View {
        VStack(spacing: 0) {
            HStack {
                Button("Add Files or Folders…", systemImage: "plus") { model.addFilesPanel() }.disabled(model.running)
                Spacer()
                if !model.items.isEmpty { Button("Clear", action: model.clear).disabled(model.running) }
            }
            .padding(10)
            Divider()
            if model.items.isEmpty {
                VStack(spacing: 10) {
                    Spacer()
                    Image(systemName: "shippingbox").font(.system(size: 38)).foregroundStyle(.secondary)
                    Text("Drop raws, DNGs or folders here").font(.headline)
                    Text("Each is saved as a DNG, usually a quarter to a half of the raw's size. Originals are never changed.")
                        .font(.callout).foregroundStyle(.secondary).multilineTextAlignment(.center).padding(.horizontal, 30)
                    Spacer()
                }
            } else {
                List {
                    ForEach(groups, id: \.folder) { group in
                        Section(group.folder ?? "Files") {
                            ForEach(group.items) { row($0) }
                        }
                    }
                }
                .listStyle(.inset)
            }
            Divider()
            runBar
        }
    }

    private struct Group { let folder: String?; let items: [PackItem] }

    /** Items by the folder they came from, folders in order of first appearance. */
    private var groups: [Group] {
        var order: [String?] = []
        var map: [String?: [PackItem]] = [:]
        for item in model.items {
            if map[item.folder] == nil { order.append(item.folder) }
            map[item.folder, default: []].append(item)
        }
        return order.map { Group(folder: $0, items: map[$0] ?? []) }
    }

    private func megabytes(_ n: Int) -> String { String(format: "%.1f MB", Double(n) / 1e6) }

    private func row(_ item: PackItem) -> some View {
        HStack(alignment: .top, spacing: 10) {
            statusIcon(item).frame(width: 18)
            VStack(alignment: .leading, spacing: 2) {
                Text(item.url.lastPathComponent).lineLimit(1).truncationMode(.middle)
                Text(detail(item)).font(.caption).foregroundStyle(item.status == .failed ? Color.red : Color.secondary).lineLimit(2)
            }
            Spacer(minLength: 0)
            if item.status == .done, let out = item.output {
                Button("Show") { NSWorkspace.shared.activateFileViewerSelecting([out]) }.buttonStyle(.link).font(.caption)
            }
            if !model.running {
                Button { model.remove(item.id) } label: { Image(systemName: "xmark.circle.fill") }
                    .buttonStyle(.plain).foregroundStyle(.secondary).help("Remove from the list")
            }
        }
        .padding(.vertical, 2)
    }

    @ViewBuilder private func statusIcon(_ item: PackItem) -> some View {
        switch item.status {
        case .inspecting, .packing: ProgressView().controlSize(.small)
        case .ready: Image(systemName: "circle").foregroundStyle(.secondary)
        case .done: Image(systemName: "checkmark.circle.fill").foregroundStyle(.green)
        case .failed: Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(.red)
        }
    }

    /** Camera and lens, the raw data's line, and after packing what was written. */
    private func detail(_ item: PackItem) -> String {
        if item.status == .failed, let e = item.error { return e }
        guard let i = item.info else { return item.status == .inspecting ? "Reading…" : "" }
        var parts = ["\(i.make) \(i.model)".trimmingCharacters(in: .whitespaces)]
        if !i.lens.isEmpty { parts.append(i.lens) }
        let mp = Double(i.width * i.height) / 1e6
        var raw = ["\(i.dng ? "DNG \(i.dngVersion)" : i.format)"]
        if i.bits > 0 { raw.append("\(i.bits)-bit") }
        if !i.compression.isEmpty { raw.append(i.compression) }
        raw.append(i.mosaic ? (i.bayer ? "Bayer" : "X-Trans") : "linear")
        raw.append(String(format: "%.0f MP", mp))
        parts.append(raw.joined(separator: ", "))
        if !i.lensData.isEmpty { parts.append("lens corrections in the file") }
        var line = parts.joined(separator: " · ")
        if item.status == .done, let r = item.result {
            let pct = item.size > 0 ? item.outputSize * 100 / item.size : 0
            line = "\(megabytes(item.size)) → \(megabytes(item.outputSize)) (\(pct)%) · \(PackFormat.label(r.modeUsed, linear: r.linear)) · \(String(format: "%.1f", r.seconds)) s · \(item.output?.lastPathComponent ?? "")"
        } else {
            line += " · \(megabytes(item.size))"
        }
        return line
    }

    private var runBar: some View {
        VStack(alignment: .leading, spacing: 6) {
            if model.running {
                let done = model.items.filter { $0.status == .done || ($0.status == .failed && $0.info != nil) }.count
                ProgressView(value: Double(done), total: Double(max(model.runTotal, 1)))
                Text(model.stopping ? "Stopping after the files being packed…" : "\(done) of \(model.runTotal) · \(model.effectiveFilesAtOnce) at once").font(.caption).foregroundStyle(.secondary)
            } else if let f = model.finished {
                Text(f.title).font(.subheadline.weight(.semibold))
                Text(f.body).font(.caption).foregroundStyle(.secondary)
            }
            HStack {
                Text(model.items.isEmpty ? "" : "\(model.items.count) \(model.items.count == 1 ? "file" : "files") · \(megabytes(model.items.reduce(0) { $0 + $1.size }))")
                    .font(.caption).foregroundStyle(.secondary)
                Spacer()
                if model.running {
                    Button("Stop", action: model.stop).disabled(model.stopping)
                } else {
                    Button("Pack", action: model.start).buttonStyle(.borderedProminent).disabled(!model.canStart).keyboardShortcut(.return, modifiers: .command)
                }
            }
        }
        .padding(10)
    }

    // MARK: Settings

    private var settingsPanel: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                Text("Pack as").font(.headline)
                Picker("", selection: Binding(get: { model.settings.preset }, set: { if $0 != .custom { model.settings.apply($0) } })) {
                    ForEach([PackPreset.small, .lossless, .micro], id: \.self) { Text($0.label).tag($0) }
                    if model.settings.preset == .custom { Text("Custom").tag(PackPreset.custom) }
                }
                .pickerStyle(.radioGroup)
                .labelsHidden()
                Text(model.settings.preset.hint).font(.caption).foregroundStyle(.secondary)
                if model.settings.format == .micro {
                    Picker("Longest side", selection: $model.settings.maxSize) {
                        ForEach(PackSettings.maxSizes, id: \.self) { Text("\($0) px").tag($0) }
                    }
                }
                Toggle("Lens corrections", isOn: $model.settings.lensCorrections)
                Toggle("Keep location (GPS)", isOn: $model.settings.keepGps)
                Toggle("Settings in the file name", isOn: $model.settings.nameSuffix)
                outputSection
                DisclosureGroup("Advanced settings", isExpanded: $model.settings.advanced) { advanced.padding(.top, 6) }
                Divider()
                Text("What this does").font(.headline)
                ForEach(Array(model.summary.enumerated()), id: \.offset) { _, line in
                    line.reduce(Text("")) { $0 + ($1.bold ? Text($1.text).bold() : Text($1.text)) }
                        .font(.callout).fixedSize(horizontal: false, vertical: true)
                }
                Text("After packing, the file opens in").font(.headline).padding(.top, 4)
                opensIn
                Text("This product includes DNG technology under license by Adobe.").font(.caption2).foregroundStyle(.secondary).padding(.top, 6)
            }
            .padding(14)
        }
    }

    private var outputSection: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("Save to").font(.subheadline)
            Picker("", selection: Binding(get: { model.outputFolder == nil }, set: { besides in
                if besides { model.setOutputFolder(nil) } else if model.outputFolder == nil { model.chooseOutputPanel() }
            })) {
                Text("Next to each file").tag(true)
                Text("A folder…").tag(false)
            }
            .pickerStyle(.radioGroup)
            .labelsHidden()
            if let folder = model.outputFolder {
                HStack {
                    Text(folder.path).font(.caption).foregroundStyle(.secondary).lineLimit(1).truncationMode(.middle)
                    Spacer()
                    Button("Choose…") { model.chooseOutputPanel() }.controlSize(.small)
                }
            }
            Text("Originals are never changed; a file that exists is never overwritten (-1, -2… is added).").font(.caption2).foregroundStyle(.secondary)
        }
        .disabled(model.running)
    }

    private var advanced: some View {
        VStack(alignment: .leading, spacing: 8) {
            Picker("File type", selection: $model.settings.format) {
                ForEach(PackFormat.allCases, id: \.self) { Text($0.label).tag($0) }
            }
            if model.settings.format.usesQuality {
                Picker("Quality", selection: $model.settings.quality) {
                    ForEach(PackQuality.allCases, id: \.self) { Text($0.label).tag($0) }
                }
            }
            if model.settings.format.usesSpeed {
                Picker("Compression effort", selection: $model.settings.speed) {
                    ForEach(PackSpeed.allCases, id: \.self) { Text($0.label).tag($0) }
                }
            }
            Picker("Preview", selection: $model.settings.preview) {
                ForEach(PackPreview.allCases, id: \.self) { Text($0.label).tag($0) }
            }
            Picker("Files at once", selection: $model.settings.filesAtOnce) {
                Text("Auto (\(autoFilesAtOnce()))").tag(0)
                ForEach(1...PackSettings.maxFilesAtOnce, id: \.self) { Text("\($0)").tag($0) }
            }
        }
        .disabled(model.running)
    }

    private var opensIn: some View {
        VStack(alignment: .leading, spacing: 5) {
            ForEach(PackerInfo.appSupport(model.settings.format), id: \.app) { s in
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    Image(systemName: icon(s.support)).foregroundStyle(color(s.support)).frame(width: 16)
                    Text(s.app).font(.callout.weight(.medium)).frame(width: 92, alignment: .leading)
                    Text(s.note).font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                }
            }
        }
    }

    private func icon(_ s: PackSupport) -> String {
        switch s {
        case .yes: "checkmark.circle.fill"
        case .no: "xmark.circle.fill"
        case .likely: "checkmark.circle"
        case .untested: "questionmark.circle"
        }
    }

    private func color(_ s: PackSupport) -> Color {
        switch s {
        case .yes: .green
        case .no: .red
        case .likely: .green.opacity(0.7)
        case .untested: .secondary
        }
    }
}

extension PackFormat {
    /** The format of a finished file, for the list ("Small raw", "Micro", "full-size linear" when a Small raw had to be demosaiced). */
    static func label(_ f: PackFormat, linear: Bool) -> String {
        f == .small && linear ? "Small raw (demosaiced)" : f.label
    }
}
