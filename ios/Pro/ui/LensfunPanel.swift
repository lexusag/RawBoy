import RawBoyEngine
import SwiftUI

private func lensLabel(_ l: Lensfun.Lens) -> String {
    l.model.lowercased().hasPrefix(l.maker.lowercased()) ? l.model : "\(l.maker) \(l.model)"
}

private func cameraLabel(_ c: Lensfun.Camera) -> String {
    let name = c.model.lowercased().hasPrefix(c.maker.lowercased()) ? c.model : "\(c.maker) \(c.model)"
    return c.variant.isEmpty ? name : "\(name) (\(c.variant))"
}

private func typeLabel(_ t: Lensfun.LensType) -> String {
    switch t {
    case .rectilinear: "Rectilinear (normal)"
    case .fisheye: "Fisheye, equidistant"
    case .equisolid: "Fisheye, equisolid angle"
    case .stereographic: "Fisheye, stereographic"
    case .orthographic: "Fisheye, orthographic"
    case .panoramic: "Panoramic"
    case .equirectangular: "Equirectangular"
    }
}

private let genericTypes = Lensfun.LensType.allCases.filter { $0 == .rectilinear || $0.isFisheye }

private func modeLabel(_ m: LensfunMode) -> String {
    switch m {
    case .auto: "Auto"
    case .manual: "Pick lens"
    case .generic: "Generic"
    }
}

/** A searchable list: type words to filter, tap to pick; the pick is shown on top with a way to clear it. */
private struct SearchPick<T>: View {
    let label: String
    let items: [T]
    let text: (T) -> String
    let selected: T?
    let placeholder: String
    let onPick: (T?) -> Void
    @State private var query = ""

    var body: some View {
        let words = query.trimmingCharacters(in: .whitespaces)
        let hits = words.isEmpty ? [] : Lensfun.searchByWords(items, words, limit: 40, text: text).map(text)
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(label).font(.subheadline)
                Spacer()
                if selected != nil {
                    Button("Clear") { onPick(nil) }.buttonStyle(.borderless).font(.caption)
                }
            }
            if let selected {
                Text(text(selected)).font(.subheadline.weight(.semibold))
            }
            TextField(placeholder, text: $query)
                .textFieldStyle(.roundedBorder)
                .font(.subheadline)
                .autocorrectionDisabled()
            if !words.isEmpty {
                if hits.isEmpty { Note("Nothing found") }
                // Names can repeat in the database (variants of one lens): rows are told apart by position.
                ForEach(Array(hits.enumerated()), id: \.offset) { i, name in
                    Button {
                        let found = Lensfun.searchByWords(items, words, limit: 40, text: text)
                        if i < found.count { onPick(found[i]) }
                        query = ""
                    } label: {
                        Text(name).font(.subheadline).frame(maxWidth: .infinity, alignment: .leading).contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .padding(.vertical, 4)
                }
            }
        }
        .padding(.vertical, 4)
    }
}

/** A number box that accepts what is typed and commits valid numbers. */
private struct NumberField: View {
    let label: String
    let value: Double
    let range: ClosedRange<Double>
    let onChange: (Double) -> Void
    @State private var text: String?
    @FocusState private var focused: Bool

    private var shown: String {
        if value == 0 { return "" }
        // Up to 4 decimals, without trailing zeros.
        let s = String(format: "%.4f", value)
        return s.contains(".") ? s.replacingOccurrences(of: #"\.?0+$"#, with: "", options: .regularExpression) : s
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label).font(.caption).foregroundStyle(.secondary)
            TextField("", text: Binding(
                get: { text ?? shown },
                set: { t in
                    text = t
                    if let v = Double(t.replacingOccurrences(of: ",", with: ".")), range.contains(v) { onChange(v) }
                }))
                .textFieldStyle(.roundedBorder)
                .font(.subheadline)
                .focused($focused)
                #if os(iOS)
                .keyboardType(.numbersAndPunctuation)
                #endif
                .onChange(of: focused) { _, f in if !f { text = nil } }
        }
    }
}

/** Crop factor from a sensor's size in mm, for the generic lens. */
private struct SensorSize: View {
    let onCrop: (Double) -> Void
    @State private var width = 0.0
    @State private var height = 0.0
    @State private var open = false

    var body: some View {
        DisclosureGroup("Sensor size instead of crop factor", isExpanded: $open) {
            HStack {
                NumberField(label: "Width (mm)", value: width, range: 1...200) { v in
                    width = v
                    if height > 0 { onCrop((Lensfun.cropFactor(width: v, height: height) * 1000).rounded() / 1000) }
                }
                NumberField(label: "Height (mm)", value: height, range: 1...200) { v in
                    height = v
                    if width > 0 { onCrop((Lensfun.cropFactor(width: width, height: v) * 1000).rounded() / 1000) }
                }
            }
            Note("Full frame is 36 × 24 mm, APS-C about 23.5 × 15.6, Micro Four Thirds 17.3 × 13.")
        }
        .font(.subheadline)
    }
}

/** The Lens tab's Lensfun section: switch, auto-match, manual pick and generic lens (web: LensfunPanel.tsx). */
struct LensfunPanel: View {
    @ObservedObject var store: LensfunStore
    let params: DevelopParams
    let onChange: (DevelopParams) -> Void
    let hasFileProfile: Bool
    @State private var allMounts = false
    @State private var coefficientsOpen = false

    private var lensItems: [Lensfun.Lens] {
        let s = store.state
        guard let db = s.db else { return [] }
        guard s.mode == .manual, let camera = s.camera, !allMounts else { return db.lenses }
        let mounts = Lensfun.compatibleMounts(db, camera.mount)
        return db.lenses.filter { l in l.mounts.contains { mounts.contains($0) } }
    }

    var body: some View {
        let s = store.state
        SectionLabel("Lensfun lens database")
        Toggle("Use Lensfun profile", isOn: Binding(get: { s.enabled }, set: { store.setEnabled($0) }))
            .font(.subheadline)
            .padding(.vertical, 4)
        if !s.enabled {
            Note("Distortion, chromatic aberration and vignetting from the Lensfun database. Loaded only when switched on.")
        } else {
            Picker("", selection: Binding(get: { s.mode }, set: { store.setMode($0) })) {
                ForEach(LensfunMode.allCases, id: \.self) { Text(modeLabel($0)).tag($0) }
            }
            .pickerStyle(.segmented)
            .labelsHidden()
            .padding(.vertical, 4)
            if s.loading { Note("Loading the lens database…") }
            if let error = s.error { Note(error) }

            if s.mode == .auto, s.db != nil { Note(autoNote(s)) }
            if s.mode == .manual, let db = s.db {
                SearchPick(label: "Camera", items: db.cameras, text: cameraLabel, selected: s.camera,
                           placeholder: "Search cameras, e.g. fujifilm x-t3") { store.pickCamera($0) }
                SearchPick(label: "Lens", items: lensItems, text: lensLabel, selected: s.lens,
                           placeholder: "Search lenses, e.g. 18-55 f/2.8") { store.pickLens($0) }
                if s.camera != nil {
                    Toggle("Lenses of every mount (adapted lenses)", isOn: $allMounts).font(.caption)
                } else {
                    Note("Without a camera the sensor size comes from the photo’s 35 mm equivalent focal length, else the lens’s own.")
                }
            }
            if s.mode != .generic, s.lens != nil {
                HStack {
                    NumberField(label: "Focal length (mm)", value: (s.focal * 10).rounded() / 10, range: 1...2000) { store.setFocal($0) }
                    NumberField(label: "Aperture (f/)", value: (s.aperture * 10).rounded() / 10, range: 0.5...64) { store.setAperture($0) }
                }
            }
            if s.mode == .generic { generic(s.generic) }

            if let applied = s.applied, !applied.isEmpty {
                Note("Applying: \(applied)\(hasFileProfile ? " (replaces the file’s own profile)" : "")")
            }
            if s.applied == "", s.lens != nil || s.mode == .generic {
                Note(s.mode == .generic ? "A generic lens has no corrections unless you enter coefficients."
                     : "The database has no corrections for this lens at this sensor size.")
            }
            if s.fisheyeFov > 0 {
                let fov = Float(min(220, max(90, s.fisheyeFov.rounded())))
                Button("Straighten fisheye (\(Int(s.fisheyeFov.rounded()))° diagonal)") {
                    var p = params
                    p.lensFisheye = 100
                    p.lensFisheyeFov = fov
                    onChange(p)
                }
                .buttonStyle(.bordered)
                .font(.subheadline)
                .disabled(params.lensFisheye == 100 && params.lensFisheyeFov == fov)
                .padding(.vertical, 4)
                Note("Sets the Fisheye slider and its field of view from the focal length and sensor. It assumes an equidistant projection, so other fisheye types are approximate.")
            }
            if let db = s.db { Note("Lens data: Lensfun database (\(db.date)), CC BY-SA 3.0.") }
        }
    }

    private func autoNote(_ s: LensfunState) -> String {
        if let lens = s.lens {
            return "Matched \(s.camera.map { cameraLabel($0) + ", " } ?? "")\(lensLabel(lens))"
        }
        let on = s.exifCamera.isEmpty ? "" : " on \(s.exifCamera)"
        if !s.exifLens.isEmpty {
            return "No profile found for “\(s.exifLens)”\(on). Pick the lens, or describe it under Generic."
        }
        return "This photo records no lens\(s.exifCamera.isEmpty ? "" : " (\(s.exifCamera))"). Pick the lens, or describe it under Generic."
    }

    @ViewBuilder private func generic(_ g: Lensfun.GenericLens) -> some View {
        HStack {
            NumberField(label: "Crop factor", value: g.crop, range: 0.2...10) { v in store.setGeneric { $0.crop = v } }
            NumberField(label: "Focal length (mm)", value: g.focal, range: 1...2000) { v in store.setGeneric { $0.focal = v } }
            NumberField(label: "Aperture (f/)", value: g.aperture, range: 0.5...64) { v in store.setGeneric { $0.aperture = v } }
        }
        SensorSize { c in store.setGeneric { $0.crop = c } }
        Picker("Lens type", selection: Binding(get: { g.lensType }, set: { t in store.setGeneric { $0.lensType = t } })) {
            ForEach(genericTypes, id: \.self) { Text(typeLabel($0)).tag($0) }
        }
        .font(.subheadline)
        .padding(.vertical, 4)
        DisclosureGroup("Known coefficients (optional)", isExpanded: $coefficientsOpen) {
            HStack {
                NumberField(label: "a", value: g.a, range: -1...1) { v in store.setGeneric { $0.a = v } }
                NumberField(label: "b", value: g.b, range: -1...1) { v in store.setGeneric { $0.b = v } }
                NumberField(label: "c", value: g.c, range: -1...1) { v in store.setGeneric { $0.c = v } }
            }
            Note("Distortion in PTLens’ terms (as Hugin or the Lensfun database list them). Leave at 0 for none.")
            HStack {
                NumberField(label: "k1", value: g.k1, range: -5...5) { v in store.setGeneric { $0.k1 = v } }
                NumberField(label: "k2", value: g.k2, range: -5...5) { v in store.setGeneric { $0.k2 = v } }
                NumberField(label: "k3", value: g.k3, range: -5...5) { v in store.setGeneric { $0.k3 = v } }
            }
            Note("Vignetting (Lensfun’s “pa” terms, r = 1 at the corner). Leave at 0 for none.")
        }
        .font(.subheadline)
    }
}
