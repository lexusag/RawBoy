import Foundation
import RawBoyEngine

/** Where the lens comes from: matched from the photo's EXIF, picked from the database, or described by hand. */
enum LensfunMode: String, CaseIterable {
    case auto, manual, generic
}

struct LensfunState {
    /** The Lens tab's Lensfun switch (remembered). */
    var enabled = false
    var mode = LensfunMode.auto
    /** The database is being read. */
    var loading = false
    var error: String?
    /** Cameras and lenses for the pickers, once loaded. */
    var db: Lensfun.Index?
    /** The sensor: the matched or picked camera (a manual lens with no camera uses the photo's 35 mm equivalent, else the lens's own crop). */
    var camera: Lensfun.Camera?
    var lens: Lensfun.Lens?
    /** The photo's own lens and camera names, for the "not found" note. */
    var exifLens = ""
    var exifCamera = ""
    /** Focal length (mm) and aperture the profile is worked out for; the photo's own when it records them. */
    var focal = 0.0
    var aperture = 0.0
    var generic = Lensfun.GenericLens()
    /** What the applied profile contains ("distortion, vignetting"), "" = the lens has none, nil = nothing applied. */
    var applied: String?
    /** The crop factor in use, and the diagonal field of view of a fisheye lens (0 = not a fisheye). */
    var crop = 1.0
    var fisheyeFov = 0.0
}

/**
 * Pro's Lensfun lens corrections (web: ui/pro/LensfunStore.ts): keeps the choices, works the profile out for the open
 * photo and hands it to the session (which uses it in place of the file's own distortion/CA and vignette data).
 * Nothing is read until it is switched on.
 */
@MainActor
final class LensfunStore: ObservableObject {
    @Published private(set) var state = LensfunState()

    private let session: PhotoSession
    private let data: LensfunData
    private let defaults = UserDefaults.standard
    private var meta: PhotoMetadata?
    private var run = 0
    private var seedGeneric = true
    /** The camera picked last in manual mode ("maker|model|variant"), remembered. */
    private var savedCamera: String

    private static let enabledKey = "lensfun.enabled"
    private static let modeKey = "lensfun.mode"
    private static let genericKey = "lensfun.generic"
    private static let cameraKey = "lensfun.camera"

    init(session: PhotoSession, data: LensfunData = .shared) {
        self.session = session
        self.data = data
        savedCamera = UserDefaults.standard.string(forKey: Self.cameraKey) ?? ""
        state.enabled = defaults.bool(forKey: Self.enabledKey)
        state.mode = LensfunMode(rawValue: defaults.string(forKey: Self.modeKey) ?? "") ?? .auto
        if let saved = defaults.data(forKey: Self.genericKey), let g = try? JSONDecoder().decode(Lensfun.GenericLens.self, from: saved) {
            state.generic = g
        }
    }

    private static func key(_ c: Lensfun.Camera) -> String { "\(c.maker)|\(c.model)|\(c.variant)" }

    private func persist() {
        defaults.set(state.enabled, forKey: Self.enabledKey)
        defaults.set(state.mode.rawValue, forKey: Self.modeKey)
        if let g = try? JSONEncoder().encode(state.generic) { defaults.set(g, forKey: Self.genericKey) }
        if let c = state.camera { savedCamera = Self.key(c) }
        defaults.set(savedCamera, forKey: Self.cameraKey)
    }

    /** A new photo is open: starts again from its EXIF. */
    func photoOpened(_ meta: PhotoMetadata?) {
        self.meta = meta
        seedGeneric = true
        let manual = state.mode == .manual
        let focal = meta.map { $0.focalLength.isFinite && $0.focalLength > 0 ? $0.focalLength : 0 } ?? 0
        let aperture = meta.map { $0.fNumber.isFinite && $0.fNumber > 0 ? $0.fNumber : 0 } ?? 0
        state.focal = focal
        state.aperture = aperture
        state.applied = nil
        state.exifLens = meta?.lensModel.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        state.exifCamera = meta.map { "\($0.make) \($0.model)".trimmingCharacters(in: .whitespacesAndNewlines) } ?? ""
        // A manual pick (camera and lens) stays for the next photo; auto matches again.
        if !manual {
            state.camera = nil
            state.lens = nil
        }
        refresh()
    }

    func setEnabled(_ enabled: Bool) {
        state.enabled = enabled
        persist()
        refresh()
    }

    func setMode(_ mode: LensfunMode) {
        state.mode = mode
        if mode != .manual {
            state.camera = nil
            state.lens = nil
        }
        persist()
        refresh()
    }

    func pickCamera(_ camera: Lensfun.Camera?) {
        state.camera = camera
        persist()
        refresh()
    }

    func pickLens(_ lens: Lensfun.Lens?) {
        state.lens = lens
        refresh()
    }

    func setFocal(_ focal: Double) {
        state.focal = focal
        refresh()
    }

    func setAperture(_ aperture: Double) {
        state.aperture = aperture
        refresh()
    }

    func setGeneric(_ change: (inout Lensfun.GenericLens) -> Void) {
        change(&state.generic)
        persist()
        refresh()
    }

    /** Works the profile out again for the current choices and applies (or removes) it. */
    private func refresh() {
        run += 1
        let current = run
        guard state.enabled, let meta, session.hasImage else {
            session.setLensfun(nil)
            state.applied = nil
            state.loading = false
            state.error = nil
            state.fisheyeFov = 0
            return
        }
        Task { await self.work(current, meta) }
    }

    private func work(_ run: Int, _ meta: PhotoMetadata) async {
        do {
            let db: Lensfun.Index
            if let loaded = state.db {
                db = loaded
            } else {
                state.loading = true
                state.error = nil
                db = try await data.index()
                if run != self.run { return }
                state.db = db
                state.loading = false
            }
            // The photo's own 35 mm equivalent focal length gives its crop factor when the camera isn't known.
            let eq = meta.focalLength35mm / meta.focalLength
            let sensorCrop = eq.isFinite && eq > 0.5 && eq < 10 ? eq : 0
            var camera = state.camera
            var lens = state.lens
            var focal = state.focal
            var aperture = state.aperture
            let sets: [Lensfun.CalibrationSet]
            let shotCrop: Double
            let label: String
            let type: Lensfun.LensType
            if state.mode == .generic {
                var g = state.generic
                if seedGeneric {
                    // The photo's recorded focal length, aperture and sensor are the starting values for each new photo; a manual lens records none.
                    seedGeneric = false
                    if focal > 0 { g.focal = focal }
                    if aperture > 0 { g.aperture = aperture }
                    if let cam = Lensfun.matchCamera(db, make: meta.make, model: meta.model) {
                        g.crop = cam.crop
                    } else if sensorCrop > 0 {
                        g.crop = (sensorCrop * 100).rounded() / 100
                    }
                    state.generic = g
                    persist()
                }
                sets = Lensfun.genericCalibration(g)
                shotCrop = g.crop
                focal = g.focal
                aperture = g.aperture
                type = g.lensType
                label = "generic lens"
                lens = nil
            } else {
                if state.mode == .manual && camera == nil {
                    camera = db.cameras.first { Self.key($0) == savedCamera }
                    state.camera = camera
                }
                if state.mode == .auto {
                    camera = Lensfun.matchCamera(db, make: meta.make, model: meta.model)
                    lens = Lensfun.matchLens(db, lensMake: meta.lensMake, lensModel: meta.lensModel, camera: camera, focal: state.focal)
                    state.camera = camera
                    state.lens = lens
                }
                guard let picked = lens else {
                    session.setLensfun(nil)
                    state.applied = nil
                    state.loading = false
                    state.crop = camera?.crop ?? (sensorCrop > 0 ? sensorCrop : 1)
                    state.fisheyeFov = 0
                    return
                }
                shotCrop = camera?.crop ?? (sensorCrop > 0 ? sensorCrop : picked.crop)
                if !(focal > 0) { focal = picked.minFocal > 0 ? picked.minFocal : 50 }
                if !(aperture > 0) { aperture = picked.minAperture > 0 ? picked.minAperture : 4 }
                sets = try await data.calibrations(picked)
                if run != self.run { return }
                label = "\(picked.maker) \(picked.model)"
                type = picked.type
            }
            let c = Lensfun.correction(sets, Lensfun.Shot(crop: shotCrop, focal: focal, aperture: aperture), lens: lens)
            if c.warp != nil || c.vignette != nil {
                session.setLensfun((warp: c.warp, vignette: c.vignette, label: label))
            } else {
                session.setLensfun(nil)
            }
            state.applied = c.summary
            state.crop = shotCrop
            state.focal = focal
            state.aperture = aperture
            state.fisheyeFov = type.isFisheye ? Lensfun.fisheyeFov(type, focal: c.realFocal > 0 ? c.realFocal : focal, crop: shotCrop) : 0
            state.loading = false
            state.error = nil
        } catch {
            if run != self.run { return }
            session.setLensfun(nil)
            state.loading = false
            state.applied = nil
            state.error = error.localizedDescription
        }
    }
}
