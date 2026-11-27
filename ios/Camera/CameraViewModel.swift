import AVFoundation
import CoreMotion
import Foundation
import ImageIO
import os
import Photos
import RawBoyEngine
import UIKit

enum CameraStatus { case needsPermission, opening, ready, failed }

/**
 * RawBoy Camera: a viewfinder developed live with the auto develop and the chosen look, and a
 * queue that develops each raw shot into a JPEG with the same engine as RawBoy Auto. Port of Android's
 * CameraViewModel.
 */
@MainActor
final class CameraViewModel: ObservableObject {
    private static let log = Logger(subsystem: "app.rawboy", category: "RawBoyCamera")
    static let jpegNaming = OutputNaming(folder: Edition.album, suffix: Edition.jpegSuffix)
    static let rawNaming = OutputNaming(folder: Edition.rawAlbum, suffix: "")

    let controller = CameraController()
    let renderer = ViewfinderRenderer()

    @Published private(set) var settings = CameraSettingsStore.load()
    @Published private(set) var status = CameraStatus.needsPermission
    /** Shots captured but not yet saved as JPEG. */
    @Published private(set) var pending = 0
    /** The newest saved photo, for the thumbnail next to the shutter. */
    @Published private(set) var lastShot: UIImage?
    @Published var message: String?
    /** Press and hold: show the auto develop without the look. */
    @Published private(set) var compare = false
    /** The current side's lenses (UW / W / T). */
    @Published private(set) var lenses: [CameraController.Info] = []
    @Published private(set) var frontAvailable = false
    @Published private(set) var flashAvailable = false
    /** The shutter sound can't be turned off here (the law, or before iOS 18): it plays whatever the setting says. */
    @Published private(set) var shutterSoundRequired = false
    /** Focus lock point (upright normalised, as shown), or nil for continuous autofocus. */
    @Published private(set) var focusPoint: CGPoint?
    /** Photo / Video switch; not remembered between starts. */
    @Published private(set) var videoMode = false
    /** Elapsed recording time in whole seconds, nil when not recording. */
    @Published private(set) var recordingSeconds: Int?
    /** Exposure and white balance lock (AE/WB LOCK), available in photo and video modes, separate from focus lock. */
    @Published private(set) var exposureLocked = false
    /** Live auto-develop exposure (EV) held while AE/WB lock is active so recomposing does not re-meter it. */
    private var lockedExposureEv: Float?
    /** Where the focus ring is being dragged (upright normalised, as shown), or nil; it focuses there on release. */
    @Published private(set) var dragPoint: CGPoint?
    /** focusPoint follows the tapped subject (settings.trackFocus); the lock ends by itself once it is lost. */
    @Published private(set) var tracking = false
    private let subject = SubjectTracker()
    /** The tracked subject is out of sight (held for a moment): metering goes to the centre meanwhile. */
    private var subjectHidden = false
    private var sentHidden = false
    private var lastFocusMove: TimeInterval = 0
    /** The point the camera last focused on while tracking. */
    private var sentFocus: CGPoint?
    /** Counts captures: the UI's shutter feedback. */
    @Published private(set) var shutterCount = 0
    /** The raw format the current lens records (ProRAW when Bayer isn't available). */
    @Published private(set) var recording = RawFormat.bayer
    /** Upright raw size of the current lens: the viewfinder's aspect ratio. */
    @Published private(set) var aspect: CGFloat = 3.0 / 4.0
    /** RGB levels of the live develop (settings.showHistogram), nil when off or before the first one. */
    @Published private(set) var histogram: Histogram?
    /**
     * How far the phone is turned clockwise from upright portrait (continuous degrees, unwrapped across 360°), for the
     * level line; nil while the level is off or the phone lies flat.
     */
    @Published private(set) var tilt: Double?
    private let motion = CMMotionManager()
    private var tiltSmooth: (x: Double, y: Double)?
    private var tiltLast: Double = 0
    /** The QR code in the viewfinder (settings.scanQr), or nil. */
    @Published private(set) var qrCode: QrPayload?
    private var qrTracker = QrTracker()

    private var info: CameraController.Info?
    private var startTask: Task<Void, Never>?
    private var recorder: VideoRecorder?
    private var recordingTask: Task<Void, Never>?
    private var audioGranted = false
    /** The microphone is in the capture session (video mode with access). */
    private var microphoneIn = false
    private var active = false
    /** The phone's position while geotagging is on and the app is in front. */
    private let location = LocationTracker()

    /** The latest analysed viewfinder frame. */
    private struct Live {
        let base: PreviewImage
        let stats: SceneStats
        let defaults: DevelopParams
        let auto: DevelopParams
        /// The AE compensation `auto` took back out of the frame (see `easedExposure`).
        var captureEv: Float = 0
    }
    private var live: Live?
    private var analysing = false
    private var luts: [String: LutData] = [:]
    private var films: [String: FilmData] = [:]
    private var saveTask: Task<Void, Never>?
    /** Develops the viewfinder's base copy small for the histogram, one at a time. */
    private let histogramRenderer = ThumbnailRenderer()
    private var histogramBusy = false

    /** A captured raw waiting to be developed, with the controls as they were at the shutter. */
    private struct Shot {
        let dng: Data
        let name: String
        let settings: CameraSettings
        /** The viewfinder's scene key at the shutter, for calibrating previewScale. */
        let viewfinderKey: Float?
        /** Sensor ISO from the capture, in case the DNG lacks it. */
        let iso: Float
        /** Exposure duration in seconds at the shutter (0 = unknown, falls back to DNG EXIF). */
        let exposureSeconds: Float
        /** Exposure target bias the shot was taken with (Brightness), taken back out by the develop. */
        let compensationEv: Float
        /** The camera saw a face at the shutter: run skin detection. */
        let mayHaveFace: Bool
        /** The viewfinder's 512 px copy at the shutter (debug snapshots and Pure RAW thumbnail). */
        let viewfinder: PreviewImage?
        /** Live auto exposure (EV) at the shutter, used to tone-map the Pure RAW viewfinder thumbnail. */
        let viewfinderExposure: Float
        /** Where the photo is metered, in the photo's own (level) orientation: see meterArea. */
        let meter: MeterArea
        /** Capture timestamp, used when settings.photoFrame is .dateStamp. */
        let date: Date
        /** 1-based daily frame counter, used when settings.photoFrame is .pentax645. */
        let frameNumber: Int
        /** True when metered on a tapped focus point, false for auto centre metering. */
        let spotMetered: Bool
        /** Auto-develop exposure (EV) held while AE/WB lock is active; nil when unlocked. */
        let lockedExposureEv: Float?
    }
    private var shots: [Shot] = []
    private var developing = false
    /** Shots develop one at a time (each needs a full-resolution decode) on one queue that keeps its GPU developer. */
    private let developQueue = DispatchQueue(label: "RawBoy-develop", qos: .userInitiated)
    private let exportGpu = ExportGpu()

    /** A phone sensor is roughly as noisy as the camera raws the auto denoise was tuned on at ~4x its ISO. */
    private static let phoneNoiseIsoScale: Float = 4
    /** Selfie sensors are smaller still: a first guess, to tune on photos. */
    private static let frontNoiseIsoScale: Float = 8
    /** Exposure is metered on the middle half of the frame's width and height (owner's choice), unless tapped. */
    private static let meterCentre = MeterArea.centre(0.5)
    /**
     * How the phone is held (0, 90, 180 or 270 degrees clockwise from upright portrait), driven continuously by
     * CoreMotion gravity (with hysteresis and flat-pose memory) and seeded from system orientation as fallback.
     * Shared by still capture, video recording and tap metering.
     */
    private var orientationTracker = DeviceOrientationTracker()
    private var orientationObserver: NSObjectProtocol?
    /**
     * The iPhone's video frames are more saturated than the raw: fitted on 30 ProRAW shots (viewfinder 512 px copy at
     * the shutter vs the raw's, all lenses; Documents/debug + DeviceDngTests), log-chroma slope 0.58 (chroma error
     * halved; white balance already matched). Their tone curve is undone too (toneCurve, Helpers.metal).
     */
    private static let frameSaturation: Float = 0.58

    /** Camera grain is twice as fine as the film-scaled default (owner's preference). */
    private static let grainSizeScale: Float = 0.5

    init() {
        UIDevice.current.beginGeneratingDeviceOrientationNotifications()
        seedOrientationFromSystem()
        controller.onFrame = { [renderer, subject] buffer, time in
            guard !renderer.isRenderingPaused else { return }
            renderer.enqueue(buffer, time: time)
            let frame = renderer.frame
            subject.feed(buffer, rotation: frame?.rotation ?? CameraController.viewfinderRotation,
                         mirror: frame?.mirror ?? false)
        }
        subject.onResult = { [weak self] generation, event in
            Task { @MainActor in self?.subjectTracked(generation, event) }
        }
        renderer.onBase = { [weak self] base in
            Task { @MainActor in self?.onViewfinderBase(base) }
        }
        controller.onQr = { [weak self] text in
            Task { @MainActor in self?.qrSeen(text) }
        }
        controller.setScanQr(settings.scanQr)
    }

    // MARK: - Lifecycle

    /** Asks for camera access (once) and starts the camera. */
    func activate() {
        active = true
        startOrientationTracking()
        // Location access taken away in the Settings app: geotagging can't work, so it shows as off.
        if settings.geotag && !location.authorized && !location.undetermined {
            change { $0.geotag = false }
            message = "Geotagging turned off: no location access"
        }
        updateLocation()
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized:
            startIfReady()
        case .notDetermined:
            Task {
                let granted = await AVCaptureDevice.requestAccess(for: .video)
                if granted { startIfReady() } else { status = .needsPermission }
            }
        default:
            status = .needsPermission
        }
    }

    func deactivate() {
        // A recording never carries on in the background: the file is finished and kept.
        stopRecording()
        active = false
        stopOrientationTracking()
        updateLocation()
        if saveTask != nil {
            saveTask?.cancel()
            saveTask = nil
            CameraSettingsStore.save(settings)
        }
        startTask?.cancel()
        startTask = nil
        controller.stop()
        setExposureLock(false)
        focusPoint = nil
        stopTracking()
        endDrag()
        clearQr()
        if status == .ready { status = .opening }
    }

    func openSettingsApp() {
        if let url = URL(string: UIApplication.openSettingsURLString) { UIApplication.shared.open(url) }
    }

    private func startIfReady() {
        guard active, startTask == nil, AVCaptureDevice.authorizationStatus(for: .video) == .authorized else { return }
        status = .opening
        startTask = Task {
            do {
                let back = CameraController.lenses(front: false)
                let front = CameraController.lenses(front: true)
                frontAvailable = !front.isEmpty
                guard !back.isEmpty else { throw CameraController.Failure(message: "no back camera") }
                let useFront = settings.front && frontAvailable
                let all = useFront ? front : back
                lenses = all
                if useFront != settings.front { change { $0.front = useFront } }
                let lens = info ?? all.first { $0.label == settings.lens } ?? all.first { $0.label == "W" } ?? all[0]
                info = lens
                flashAvailable = lens.hasFlash
                controller.setExposureBias(Self.exposureBias(settings))
                recording = try await controller.start(lens, format: settings.rawFormat, video: videoMode)
                guard !Task.isCancelled else { return }
                shutterSoundRequired = controller.shutterSoundRequired
                let size = controller.rawSize
                aspect = size.width / size.height
                renderer.frame = ViewfinderRenderer.Frame(fullWidth: Int(size.width), fullHeight: Int(size.height),
                                                          scale: settings.previewScale,
                                                          rotation: CameraController.viewfinderRotation,
                                                          mirror: lens.isFront, toneCurve: true,
                                                          saturation: Self.frameSaturation)
                status = .ready
                if lens.label != settings.lens { change { $0.lens = lens.label } }
                scheduleNeighborPreload()
            } catch {
                Self.log.error("camera start: \(error.localizedDescription)")
                message = "Camera: \(error.localizedDescription)"
                status = .failed
                startTask = nil
            }
        }
    }

    /** Focus lock at a point of the viewfinder (upright normalised, as shown). */
    func focusAt(_ x: Double, _ y: Double) {
        guard status == .ready else { return }
        focusPoint = CGPoint(x: x, y: y)
        stopTracking()
        // Focus first scans at the tap as usual; the tracker takes over from the next frame.
        if settings.trackFocus { subject.begin(x, y) }
        controller.focusAt(x, y)
    }

    func releaseFocus() {
        focusPoint = nil
        stopTracking()
        endDrag()
        controller.releaseFocus()
    }

    private func stopTracking() {
        subject.end()
        tracking = false
        sentFocus = nil
        subjectHidden = false
        sentHidden = false
    }

    /**
     * The tracker's answer for the lock of `generation`: the focus point (and the camera's focus and exposure points)
     * moves with the subject; a subject without enough detail keeps a plain lock; one lost for good releases focus.
     */
    private func subjectTracked(_ generation: Int, _ event: SubjectTracker.Event) {
        guard generation == subject.currentGeneration, let point = focusPoint else { return }
        switch event {
        case .started(let ok):
            tracking = ok
            if ok {
                sentFocus = point
                lastFocusMove = ProcessInfo.processInfo.systemUptime
                controller.focusAt(point.x, point.y, follow: true)
            }
        case .moved(let x, let y, let found):
            guard tracking else { return }
            if abs(x - point.x) >= Self.minFocusMove || abs(y - point.y) >= Self.minFocusMove {
                focusPoint = CGPoint(x: x, y: y)
            }
            subjectHidden = !found
            // Each move reconfigures the device: a few a second keep the AF box on the subject, and the last one
            // still goes out once the subject stops. Hiding or reappearing goes out at once (metering follows it).
            let now = ProcessInfo.processInfo.systemUptime
            guard let shown = focusPoint else { return }
            if (shown != sentFocus && now - lastFocusMove >= Self.focusMoveInterval) || subjectHidden != sentHidden {
                lastFocusMove = now
                sentFocus = shown
                sentHidden = subjectHidden
                controller.focusAt(shown.x, shown.y, follow: true, meter: !subjectHidden)
            }
        case .lost:
            releaseFocus()
            message = "Subject lost: autofocus"
        }
    }

    func setTrackFocus(_ on: Bool) {
        change { $0.trackFocus = on }
        // A subject being followed: a plain lock where it is now.
        if !on, tracking, let p = focusPoint { focusAt(p.x, p.y) }
    }

    /** Smallest move of a tracked subject (share of the frame) that moves the focus point. */
    private static let minFocusMove = 0.004
    /** Most the live develop's exposure moves per update (~3 a second), EV. */
    private static let maxEvStep: Float = 0.3
    /** Video eases much slower: a 0.3 EV step every 300 ms would pump visibly in a recording (Android's VIDEO_EV_STEP). */
    private static let videoEvStep: Float = 0.05

    /// The viewfinder's live exposure: only the metering eases ([step] EV per update); Brightness's AE compensation
    /// ([captureEv]) is taken out at once, as the phone's AE puts it into the frames within a few frames. Easing the whole
    /// exposure overshot a Brightness move by over a stop and sank back over ~2 s. Port of Android's `LiveExposure.ease`.
    static func easedExposure(last: Float?, lastCaptureEv: Float, exposure: Float, captureEv: Float, step: Float) -> Float {
        guard let last else { return exposure }
        let lastMetered = last + lastCaptureEv
        let metered = exposure + captureEv
        return lastMetered + min(max(metered - lastMetered, -step), step) - captureEv
    }
    /** At most this often a tracked subject's move reconfigures the camera's focus. */
    private static let focusMoveInterval: TimeInterval = 0.1

    /** The focus ring follows a drag to (x, y), with `loupe` over the viewfinder; endDragFocus focuses there. */
    func dragFocus(_ x: Double, _ y: Double, loupe: ViewfinderRenderer.Loupe?) {
        guard focusPoint != nil else { return }
        dragPoint = CGPoint(x: min(max(x, 0), 1), y: min(max(y, 0), 1))
        renderer.loupe = loupe
    }

    func endDragFocus() {
        guard let p = dragPoint else { return }
        endDrag()
        focusAt(p.x, p.y)
    }

    private func endDrag() {
        dragPoint = nil
        renderer.loupe = nil
    }

    /**
     * Where the auto develop meters exposure: around the tapped focus point while focus is locked (as the camera's
     * exposure point of interest does), else the centre box. Upright as the viewfinder shows it, like its 512 px copy.
     */
    private var meterArea: MeterArea {
        // A tracked subject out of sight: the centre, as the camera's exposure point meanwhile.
        guard let p = focusPoint, !(tracking && subjectHidden) else { return Self.meterCentre }
        return .spot(x: Float(p.x), y: Float(p.y))
    }

    /** The device's turn from portrait now (clockwise, 0/90/180/270), used by photo capture, video and tap metering. */
    private func currentDeviceDegrees() -> Int {
        if motion.isDeviceMotionActive, let g = motion.deviceMotion?.gravity {
            orientationTracker.update(ax: g.x, ay: g.y, az: g.z)
        } else if motion.isAccelerometerActive, let a = motion.accelerometerData?.acceleration {
            orientationTracker.update(ax: a.x, ay: a.y, az: a.z)
        }
        if !orientationTracker.hasGravityReading {
            seedOrientationFromSystem()
        }
        return orientationTracker.degrees
    }

    /** Maps UIDevice orientation (or active window scene interface orientation) to clockwise degrees from portrait. */
    private func systemDeviceDegrees() -> Int? {
        switch UIDevice.current.orientation {
        case .portrait: return 0
        case .landscapeRight: return 90  // home side on the left: phone turned 90° clockwise
        case .portraitUpsideDown: return 180
        case .landscapeLeft: return 270
        default: break
        }
        guard let scene = UIApplication.shared.connectedScenes.compactMap({ $0 as? UIWindowScene }).first else {
            return nil
        }
        switch scene.effectiveGeometry.interfaceOrientation {
        case .portrait: return 0
        case .landscapeLeft: return 90  // UIInterfaceOrientation.landscapeLeft == UIDeviceOrientation.landscapeRight
        case .portraitUpsideDown: return 180
        case .landscapeRight: return 270
        default: return nil
        }
    }

    /** Switches to the lens labelled [label] (UW, W, T) on the current side. */
    func selectLens(_ label: String) {
        guard recorder == nil, let lens = lenses.first(where: { $0.label == label }), lens != info else { return }
        switchTo(lens)
        change { $0.lens = label }
    }

    /** Back cameras <-> selfie camera. */
    func switchFacing() {
        guard recorder == nil else { return }
        let front = !settings.front
        let all = CameraController.lenses(front: front)
        guard let lens = all.first(where: { $0.label == "W" }) ?? all.first else { return }
        lenses = all
        switchTo(lens)
        change {
            $0.front = front
            $0.lens = lens.label
        }
    }

    func setRawFormat(_ format: RawFormat) {
        guard recorder == nil else { return }
        change { $0.rawFormat = format }
        if let info { switchTo(info) }
    }

    private func switchTo(_ lens: CameraController.Info) {
        info = lens
        setExposureLock(false)  // a new lens or format must converge AE/AWB fresh
        focusPoint = nil  // the restart ends any focus lock
        stopTracking()
        endDrag()
        // The live develop belongs to the old lens: start the new one fresh.
        live = nil
        renderer.params = nil
        clearQr()
        startTask?.cancel()
        startTask = nil
        startIfReady()
    }

    // MARK: - Live develop

    /** A small copy of the viewfinder frame: analyse it unless the last one is still running. */
    private func onViewfinderBase(_ base: PreviewImage) {
        // The QR detector reports only codes it sees: these few frames a second let a code that left the view go.
        qrSeen(nil)
        guard !analysing, status == .ready else { return }
        // The frame's scale follows the lens's calibration.
        let scale = settings.previewScale
        if var f = renderer.frame, f.scale != scale {
            f.scale = scale
            renderer.frame = f
        }
        let state = controller.frames
        let meter = meterArea
        analysing = true
        Task.detached(priority: .userInitiated) { [weak self] in
            var defaults = DevelopParams()
            if let xy = state.whiteXY {
                let tt = WhiteBalance.tempTintFromXY(xy[0], xy[1])
                defaults.temperature = Float(tt[0])
                defaults.tint = Float(tt[1])
            }
            let skin = state.faces.isEmpty ? nil : Self.faceMask(state.faces, base)
            let stats = SceneAnalyzer.analyze(base, skin: skin, iso: state.iso, meter: meter)
            // The phone's auto exposure set the frame (and the shot's raw): keep it, lifted where it went dark, as the
            // shot does (see develop).
            let captureEv = state.compensationEv
            let sceneLight = SceneLight(exposureSeconds: state.exposureSeconds, postRawBoost: 1, captureEv: captureEv)
            let auto = SceneRecognition.apply(
                AutoTone.develop(stats, asShot: defaults, phoneAe: true, captureEv: captureEv, splitLuma: false),
                stats: stats,
                light: sceneLight)
            await MainActor.run {
                guard let self else { return }
                self.analysing = false
                // A new metering area (a tap, a release, a tracked subject hiding) can move the exposure by a stop at
                // once; the viewfinder eases there over a few updates instead of snapping. Brightness's compensation isn't
                // eased (see easedExposure). While AE/WB lock is active, hold the locked exposure without re-metering.
                var eased = auto
                var shownCaptureEv = captureEv
                if self.exposureLocked {
                    let held = self.lockedExposureEv ?? auto.exposure
                    if self.lockedExposureEv == nil { self.lockedExposureEv = held }
                    eased.exposure = held
                } else {
                    // Video: the phone's AE takes a second or so to bring a Brightness change into the frames, so the
                    // compensation the develop takes back out follows it with a lag, else the picture swings up and down.
                    if self.videoMode, let last = self.live {
                        shownCaptureEv = last.captureEv + 0.3 * (captureEv - last.captureEv)
                        eased.exposure = auto.exposure + captureEv - shownCaptureEv
                    }
                    eased.exposure = Self.easedExposure(
                        last: self.live?.auto.exposure, lastCaptureEv: self.live?.captureEv ?? 0,
                        exposure: eased.exposure, captureEv: shownCaptureEv,
                        step: self.videoMode ? Self.videoEvStep : Self.maxEvStep)
                }
                // Video: the auto tone (rounded to whole slider steps) and the as-shot white also glide, else each
                // 300 ms analysis shows as a jump in gamma or colour.
                var shownDefaults = defaults
                if self.videoMode, let last = self.live {
                    func glide(_ last: Float, _ new: Float, _ step: Float) -> Float { last + min(max(new - last, -step), step) }
                    eased.highlights = glide(last.auto.highlights, eased.highlights, 1)
                    eased.shadows = glide(last.auto.shadows, eased.shadows, 1)
                    eased.contrast = glide(last.auto.contrast, eased.contrast, 1)
                    if !self.exposureLocked {
                        shownDefaults.temperature = last.defaults.temperature + 0.2 * (defaults.temperature - last.defaults.temperature)
                        shownDefaults.tint = last.defaults.tint + 0.2 * (defaults.tint - last.defaults.tint)
                    }
                }
                self.live = Live(base: base, stats: stats, defaults: shownDefaults, auto: eased, captureEv: shownCaptureEv)
                self.publish()
            }
        }
    }

    private var publishTask: Task<Void, Never>?
    private var neighborPreloadTask: Task<Void, Never>?

    /** Viewfinder uniforms for the latest frame and the current controls. */
    private func publish() {
        guard let l = live, let f = renderer.frame else { return }
        let s = settings
        var p = compare ? l.auto : s.develop(l.auto, hasFace: l.stats.hasFace)
        // The camera has already denoised and sharpened the preview stream.
        p.denoise = 0
        p.sharpening = 0
        p.skinRetouch = 0
        // Video also drops the colour denoise: its coarse stages are many taps per pixel, drawn twice a frame (screen and file).
        if videoMode { p.colorDenoise = 0 }
        let params = p
        let lutId = p.lut
        let filmId = p.film
        publishTask?.cancel()
        publishTask = Task {
            let lut = await lutId.asyncMap { try? await loadLut($0) } ?? nil
            let film = await filmId.asyncMap { try? await loadFilm($0) } ?? nil
            guard !Task.isCancelled else { return }
            let lens = LensTransform(info: LensInfo.none(width: f.fullWidth, height: f.fullHeight), params: params)
            let shader = ShaderParams.from(params, asShot: l.defaults, lut: lut, lens: lens, base: l.base,
                                           bloomSources: nil, skinMask: nil, grainSizeScale: Self.grainSizeScale,
                                           grainStrength: Self.grainStrength(s), film: film)
            renderer.params = shader
            updateHistogram(shader, l.base)
        }
    }

    /**
     * Warms the immediate next and previous stocks/looks around the active pick after a short settle delay so
     * swiping the viewfinder switches without disk/parse latency while never competing with the active load.
     */
    private func scheduleNeighborPreload() {
        neighborPreloadTask?.cancel()
        let neighbors = Looks.neighbors(settings.activeLooks, currentId: settings.look.id)
        guard !neighbors.isEmpty else { return }
        neighborPreloadTask = Task(priority: .utility) { [weak self] in
            try? await Task.sleep(nanoseconds: 150_000_000)
            guard !Task.isCancelled, let self else { return }
            for look in neighbors {
                guard !Task.isCancelled else { return }
                if let filmId = look.film {
                    _ = try? await self.loadFilm(filmId)
                } else if let lutId = look.lutId {
                    _ = try? await self.loadLut(lutId)
                }
            }
        }
    }

    /** The live develop's histogram at 128 px; a frame is skipped while the last one is still rendering. */
    private func updateHistogram(_ shader: ShaderParams, _ base: PreviewImage) {
        guard settings.showHistogram else {
            histogram = nil
            return
        }
        if histogramBusy { return }
        histogramBusy = true
        Task {
            let image = try? await histogramRenderer.render(shader, preview: base, maxDimension: 128)
            histogramBusy = false
            // Turned off meanwhile: stay off.
            guard settings.showHistogram else { return }
            if let image, let h = Histogram(image: image) { histogram = h }
        }
    }

    /**
     * Half-size grain partly averages out when the photo is saved at 3000 px (area downscale), so it's raised to look
     * as strong as at full size, where each pixel is a point sample. ProRAW is ×3 (owner's choice): its merged frames
     * have none of the sensor noise that gives a single raw (and the Pixel's) its texture, so the look's grain alone
     * measured under 1 level of 255 (std) on a Portra 160 photo. B&W mode has monoGrain times the grain, and
     * filmMonoGrain times that with Film on too.
     */
    private nonisolated static func grainStrength(_ s: CameraSettings) -> Float {
        (s.smallExport ? 1.34 : 1) * (s.rawFormat == .proRaw ? 3 : 1) * (s.monoMode ? monoGrain : 1)
            * (s.filmMono ? filmMonoGrain : 1)
    }

    /** B&W mode's grain on top of the mono stock's (owner's choice, 2026-10-31: the looks' own read too clean). */
    private nonisolated static let monoGrain: Float = 3
    /** Film + B&W: monoGrain times this (owner's choice, 2026-10-31: grainier than plain B&W). */
    private nonisolated static let filmMonoGrain: Float = 1.5

    // MARK: - Controls

    /** Picks id for the current mode: B&W mode's stock, Film mode's stock or the colour look. */
    func setLook(_ id: String) {
        neighborPreloadTask?.cancel()
        change {
            if $0.monoMode { $0.monoLookId = id } else if $0.filmMode { $0.filmLookId = id } else { $0.lookId = id }
        }
        scheduleNeighborPreload()
    }

    /** Steps delta positions (+1 next, -1 previous, wrapping) through the active mode's looks. Locked while recording. */
    @discardableResult
    func stepLook(_ delta: Int) -> Look? {
        guard recordingSeconds == nil else { return nil }
        guard let next = Looks.step(settings.activeLooks, currentId: settings.look.id, delta: delta, wrap: true) else {
            return nil
        }
        setLook(next.id)
        return next
    }

    func setMono(_ on: Bool) {
        neighborPreloadTask?.cancel()
        change { $0.mono = on }
        scheduleNeighborPreload()
    }
    /** The Film toggle: colour photos on the film stocks or on the LUT looks. */
    func setFilm(_ on: Bool) {
        neighborPreloadTask?.cancel()
        change { $0.film = on }
        scheduleNeighborPreload()
    }
    func setFilter(_ f: BwFilter) { change { $0.filter = f } }
    func setStrength(_ v: Float) { change { $0.strength = v } }
    func setBrightness(_ v: Float) {
        change { $0.brightness = v }
        controller.setExposureBias(Self.exposureBias(settings))
    }

    /** Brightness also shoots brighter or darker (exposure target bias), as many stops as it adds to the develop. */
    private static func exposureBias(_ s: CameraSettings) -> Float { s.brightness / 100 * LookApplier.brightnessEv }
    func setWarmth(_ v: Float) { change { $0.warmth = v } }
    func setJpegQuality(_ q: Int) { change { $0.jpegQuality = min(max(q, CameraSettings.minQuality), 100) } }
    func setKeepDng(_ keep: Bool) { change { $0.keepDng = keep } }
    func setRawWithJpeg(_ on: Bool) { change { $0.rawWithJpeg = on } }
    func setRawPreview(_ preview: RawPreview) { change { $0.rawPreview = preview } }
    func setSmallExport(_ on: Bool) { change { $0.smallExport = on } }
    func setRememberLast(_ on: Bool) { change { $0.rememberLast = on } }
    func setShutterSound(_ on: Bool) { change { $0.shutterSound = on } }
    func setShowGrid(_ on: Bool) { change { $0.showGrid = on } }
    func setShowLevel(_ on: Bool) {
        change { $0.showLevel = on }
        if !on { clearTilt() }
        if active { updateMotionInterval() }
    }

    private func startOrientationTracking() {
        seedOrientationFromSystem()
        if orientationObserver == nil {
            orientationObserver = NotificationCenter.default.addObserver(
                forName: UIDevice.orientationDidChangeNotification, object: nil, queue: .main
            ) { [weak self] _ in
                MainActor.assumeIsolated { self?.onSystemOrientationChanged() }
            }
        }
        startMotion()
    }

    private func stopOrientationTracking() {
        if let observer = orientationObserver {
            NotificationCenter.default.removeObserver(observer)
            orientationObserver = nil
        }
        stopMotion()
        orientationTracker.invalidateGravity()
    }

    private func seedOrientationFromSystem() {
        if let deg = systemDeviceDegrees() {
            orientationTracker.seed(degrees: deg)
        }
    }

    private func onSystemOrientationChanged() {
        if let deg = systemDeviceDegrees() {
            orientationTracker.updateFromSystem(degrees: deg)
        }
    }

    private var motionInterval: TimeInterval { settings.showLevel ? 1.0 / 20 : 1.0 / 15 }

    private func updateMotionInterval() {
        if motion.isDeviceMotionActive {
            motion.deviceMotionUpdateInterval = motionInterval
        } else if motion.isAccelerometerActive {
            motion.accelerometerUpdateInterval = motionInterval
        } else if active {
            startMotion()
        }
    }

    /**
     * Runs one CoreMotion gravity stream while active: prefers `CMDeviceMotion.gravity` (sensor-fused, immune to hand
     * acceleration when lifting the phone) and falls back to raw accelerometer if unavailable or if device motion
     * reports an error. Feeds both `orientationTracker` (photo/video orientation) and the horizon level line when
     * `settings.showLevel` is on.
     */
    private func startMotion() {
        if motion.isDeviceMotionAvailable {
            guard !motion.isDeviceMotionActive else {
                motion.deviceMotionUpdateInterval = motionInterval
                return
            }
            motion.deviceMotionUpdateInterval = motionInterval
            motion.startDeviceMotionUpdates(to: .main) { [weak self] data, error in
                MainActor.assumeIsolated {
                    guard let self else { return }
                    if let error {
                        Self.log.error("device motion: \(error.localizedDescription); falling back to accelerometer")
                        self.motion.stopDeviceMotionUpdates()
                        self.startAccelerometer()
                        return
                    }
                    guard let g = data?.gravity else { return }
                    self.handleGravity(x: g.x, y: g.y, z: g.z)
                }
            }
        } else {
            startAccelerometer()
        }
    }

    private func startAccelerometer() {
        guard active, motion.isAccelerometerAvailable else { return }
        guard !motion.isAccelerometerActive else {
            motion.accelerometerUpdateInterval = motionInterval
            return
        }
        motion.accelerometerUpdateInterval = motionInterval
        motion.startAccelerometerUpdates(to: .main) { [weak self] data, error in
            MainActor.assumeIsolated {
                guard let self else { return }
                if let error {
                    Self.log.error("accelerometer: \(error.localizedDescription)")
                    self.motion.stopAccelerometerUpdates()
                    return
                }
                guard let a = data?.acceleration else { return }
                self.handleGravity(x: a.x, y: a.y, z: a.z)
            }
        }
    }

    private func stopMotion() {
        if motion.isDeviceMotionActive { motion.stopDeviceMotionUpdates() }
        if motion.isAccelerometerActive { motion.stopAccelerometerUpdates() }
        clearTilt()
    }

    private func clearTilt() {
        tiltSmooth = nil
        if tilt != nil { tilt = nil }
    }

    private func handleGravity(x: Double, y: Double, z: Double) {
        orientationTracker.update(ax: x, ay: y, az: z)
        guard settings.showLevel else { return }
        // Gravity along the screen's axes: flat on a table (z dominates) there is no horizon to show.
        if abs(z) > 0.9 {
            clearTilt()
            return
        }
        // Portrait upright: gravity is -y. Turned clockwise, it moves to +x.
        let r = atan2(x, -y)
        // Low-pass the angle as a unit vector (no jump across 360), alpha 0.2 at 20 Hz (about a 0.2 s time constant).
        let v = tiltSmooth.map { (x: $0.x + 0.2 * (sin(r) - $0.x), y: $0.y + 0.2 * (cos(r) - $0.y)) } ?? (x: sin(r), y: cos(r))
        tiltSmooth = v
        let degrees = atan2(v.x, v.y) * 180 / .pi
        let nearest = (degrees / 90).rounded() * 90
        // Deadband: a hair either side of straight reads as straight. Tenths of a degree: no redraw for noise.
        let snapped = abs(degrees - nearest) < 0.4 ? nearest : degrees
        var delta = (snapped - tiltLast).truncatingRemainder(dividingBy: 360)
        if delta > 180 { delta -= 360 } else if delta <= -180 { delta += 360 }
        let next = ((tiltLast + delta) * 10).rounded() / 10
        tiltLast = next
        if tilt != next { tilt = next }
    }

    func setShowHistogram(_ on: Bool) {
        change { $0.showHistogram = on }
        if !on { histogram = nil }
    }
    func setPhotoFrame(_ frame: PhotoFrame) {
        change {
            $0.photoFrame = frame
            if frame != .none { $0.lastPhotoFrame = frame }
            // The date stamp has no "jan 26" layout (only the Pentax/Contax rebate does).
            if frame == .dateStamp && $0.dateStampFormat == .mmmYy { $0.dateStampFormat = .dmy }
        }
    }
    /** Toggles frames off or back on using the last enabled frame (Pentax 645 by default). */
    func togglePhotoFrame() {
        change {
            if $0.photoFrame == .none {
                $0.photoFrame = $0.lastPhotoFrame != .none ? $0.lastPhotoFrame : .pentax645
                if $0.photoFrame == .dateStamp && $0.dateStampFormat == .mmmYy { $0.dateStampFormat = .dmy }
            } else {
                $0.lastPhotoFrame = $0.photoFrame
                $0.photoFrame = .none
            }
        }
    }
    func setDateStampFormat(_ format: DateStampFormat) { change { $0.dateStampFormat = format } }
    func setDateStampStyle(_ style: DateStampStyle) { change { $0.dateStampStyle = style } }
    func setTimeStampFormat(_ format: TimeStampFormat) { change { $0.timeStampFormat = format } }
    func setFrameColor(_ color: FilmFrameColor) { change { $0.frameColor = color } }
    func setPentax645Flip(_ on: Bool) { change { $0.pentax645Flip = on } }
    func setPentax645Field(_ field: Pentax645Field, _ on: Bool) {
        change {
            if on { $0.pentax645Fields.insert(field) } else { $0.pentax645Fields.remove(field) }
        }
    }
    func movePentax645Fields(fromOffsets source: IndexSet, toOffset destination: Int) {
        change {
            $0.pentax645Order.move(fromOffsets: source, toOffset: destination)
        }
    }
    /** Turning it on asks for location access first (the system prompt the first time). */
    func setGeotag(_ on: Bool) {
        guard on else {
            change { $0.geotag = false }
            updateLocation()
            return
        }
        location.requestAccess { [weak self] granted in
            guard let self else { return }
            if granted {
                change { $0.geotag = true }
            } else {
                message = "No location access: allow it for RawBoy Camera in the Settings app"
            }
            updateLocation()
        }
    }

    /** Listens for the position only while it is used: geotagging on and the app in front. */
    private func updateLocation() {
        if settings.geotag && active { location.start() } else { location.stop() }
    }

    func toggleFlash() { change { $0.flash = $0.flash == .off ? .on : .off } }

    // MARK: - QR codes

    func setGrain(_ on: Bool) {
        change { $0.grain = on }
    }

    func setRandomLightLeak(_ on: Bool) { change { $0.randomLightLeak = on } }

    func setRandomLightLeakRate(_ rate: Int) {
        change { $0.randomLightLeakRate = min(max(rate, 1), CameraSettings.lightLeakSequenceSize) }
    }

    func setShortSideSprockets(_ on: Bool) { change { $0.shortSideSprockets = on } }

    func setScanQr(_ on: Bool) {
        change { $0.scanQr = on }
        controller.setScanQr(on)
        if !on { clearQr() }
    }

    /** Resets all user-configurable settings to defaults while keeping learned camera calibration. */
    func resetSettings() {
        let prev = settings
        let next = prev.resetToDefaults()
        change { $0 = next }
        controller.setExposureBias(Self.exposureBias(settings))
        if prev.front != next.front {
            let all = CameraController.lenses(front: next.front)
            if let target = all.first(where: { $0.label == next.lens }) ?? all.first {
                lenses = all
                switchTo(target)
                if target.label != next.lens { change { $0.lens = target.label } }
            }
        } else if prev.lens != next.lens || prev.rawFormat != next.rawFormat {
            if let target = lenses.first(where: { $0.label == next.lens }) ?? lenses.first {
                if target != info || prev.rawFormat != next.rawFormat { switchTo(target) }
                if target.label != next.lens { change { $0.lens = target.label } }
            }
        }
        if prev.showLevel && !next.showLevel {
            clearTilt()
            if active { updateMotionInterval() }
        }
        if prev.showHistogram && !next.showHistogram {
            histogram = nil
        }
        if prev.geotag != next.geotag {
            updateLocation()
        }
        if prev.trackFocus && !next.trackFocus, tracking, let p = focusPoint {
            focusAt(p.x, p.y)
        }
        if prev.scanQr != next.scanQr {
            controller.setScanQr(next.scanQr)
            if !next.scanQr { clearQr() }
        }
    }

    /** A sighting of a code (text) or a frame without one (nil). */
    private func qrSeen(_ text: String?) {
        guard settings.scanQr, status == .ready else { return }
        if qrTracker.update(text, now: ProcessInfo.processInfo.systemUptime) { qrCode = qrTracker.shown }
    }

    /** The bar's ✕: hides the code until it has left the view. */
    func dismissQr() {
        qrTracker.dismiss(now: ProcessInfo.processInfo.systemUptime)
        qrCode = nil
    }

    private func clearQr() {
        qrTracker.clear()
        qrCode = nil
    }

    /**
     * A tap on the bar: opens the link (or mail, phone, messages, maps) in its app, or copies the text. Wi-Fi: the
     * password is copied (joining a network needs Apple's Hotspot Configuration entitlement).
     */
    func openQr(_ code: QrPayload) {
        switch code {
        case let .link(_, url, _):
            open(URL(string: url), orCopy: url)
        case let .action(text, uri, _, _, body):
            open(Self.appURL(uri, body: body), orCopy: text)
        case let .wifi(_, ssid, password, _, _):
            UIPasteboard.general.string = password ?? ssid
            message = password != nil ? "Password copied: choose \(ssid) in Settings › Wi-Fi" : "Choose \(ssid) in Settings › Wi-Fi"
        case let .text(text):
            UIPasteboard.general.string = text
            message = "Copied"
        }
    }

    private func open(_ url: URL?, orCopy text: String) {
        guard let url else {
            UIPasteboard.general.string = text
            message = "Copied"
            return
        }
        UIApplication.shared.open(url) { [weak self] opened in
            guard !opened else { return }
            Task { @MainActor in
                UIPasteboard.general.string = text
                self?.message = "No app opens it: copied"
            }
        }
    }

    /** Android-style QR addresses (smsto:, geo:) as iOS's apps take them: sms:…&body=, Apple Maps. */
    nonisolated static func appURL(_ uri: String, body: String?) -> URL? {
        let allowed = CharacterSet.urlQueryAllowed.subtracting(CharacterSet(charactersIn: "&=+"))
        if uri.hasPrefix("smsto:") {
            let number = String(uri.dropFirst(6)).filter { !$0.isWhitespace }
            let encoded = body?.addingPercentEncoding(withAllowedCharacters: allowed)
            return URL(string: "sms:\(number)" + (encoded.map { "&body=\($0)" } ?? ""))
        }
        if uri.hasPrefix("geo:") {
            // geo:lat,lon[,alt][;u=…][?q=…]
            let rest = uri.dropFirst(4)
            let point = rest.prefix { $0 != ";" && $0 != "?" }.split(separator: ",").prefix(2).joined(separator: ",")
            var url = "https://maps.apple.com/?ll=\(point)"
            if let q = rest.range(of: "q=").map({ String(rest[$0.upperBound...]) }), !q.isEmpty {
                url += "&q=" + ((q.removingPercentEncoding ?? q).addingPercentEncoding(withAllowedCharacters: allowed) ?? "")
            }
            return URL(string: url)
        }
        if uri.hasPrefix("tel:") { return URL(string: "tel:" + uri.dropFirst(4).filter { !$0.isWhitespace }) }
        return URL(string: uri) ?? uri.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed).flatMap(URL.init(string:))
    }

    func setCompare(_ on: Bool) {
        compare = on
        publish()
    }

    private func change(_ edit: (inout CameraSettings) -> Void) {
        var s = settings
        edit(&s)
        settings = s
        // A slider drag changes settings every frame: save once it rests.
        saveTask?.cancel()
        saveTask = Task {
            try? await Task.sleep(nanoseconds: 500_000_000)
            guard !Task.isCancelled else { return }
            CameraSettingsStore.save(settings)
            saveTask = nil
        }
        publish()
    }

    // MARK: - Video

    func setVideoMode(_ on: Bool) {
        guard on != videoMode, recorder == nil, status == .ready else { return }
        videoMode = on
        renderer.animateGrain = on
        let stabilization = settings.videoStabilization
        Task {
            // The microphone is asked for the first time video mode is switched on; refusing gives silent videos.
            if on, !audioGranted { audioGranted = await Self.requestMicrophone() }
            microphoneIn = await controller.setVideoMode(on, audio: audioGranted, stabilization: stabilization)
            if on && !microphoneIn { message = "No microphone access: videos will have no sound" }
            // The camera runs its video format in video mode (it offers stabilization; the photo format doesn't), so it restarts.
            if let info { switchTo(info) }
        }
        publish()  // the video viewfinder drops the colour denoise (see publish)
    }

    private static func requestMicrophone() async -> Bool {
        switch AVCaptureDevice.authorizationStatus(for: .audio) {
        case .authorized: true
        case .notDetermined: await AVCaptureDevice.requestAccess(for: .audio)
        default: false
        }
    }

    func setExposureLock(_ locked: Bool) {
        exposureLocked = locked
        lockedExposureEv = locked ? live?.auto.exposure : nil
        controller.setExposureLock(locked)
    }

    /** Not in the middle of a recording: the file's bitrate is fixed when it starts. */
    func setVideoQuality(_ quality: VideoQuality) {
        if recorder == nil { change { $0.videoQuality = quality } }
    }

    func setVideoStabilization(_ on: Bool) {
        change { $0.videoStabilization = on }
        // Changing it moves the viewfinder's framing: not in the middle of a recording.
        if recorder == nil, videoMode { controller.setVideoStabilization(on) }
    }

    private func startRecording() {
        guard status == .ready, recorder == nil else { return }
        let s = settings
        // As photos do: how the phone is held, so a phone held sideways records a landscape file.
        let degrees = currentDeviceDegrees()
        let name = "VID_" + Self.timestamp() + "-" + Edition.jpegSuffix
        let audio = microphoneIn ? controller.audioSettings() : nil
        do {
            let r = try VideoRecorder(name: name, bitrate: s.videoQuality.bitrate, degrees: degrees, audioSettings: audio)
            controller.onAudio = { [weak r] sample in r?.appendAudio(sample) }
            recorder = r
            renderer.videoSink = r.sink
            recordingSeconds = 0
            UIApplication.shared.isIdleTimerDisabled = true
            UIImpactFeedbackGenerator(style: .medium).impactOccurred()
            recordingTask = Task { [weak self, weak r] in
                let start = Date()
                while !Task.isCancelled {
                    try? await Task.sleep(nanoseconds: 250_000_000)
                    guard let self, let r, self.recorder === r else { return }
                    let elapsed = Date().timeIntervalSince(start)
                    self.recordingSeconds = Int(elapsed)
                    // A writer that failed stops the recording at once and keeps what was written; one that got no
                    // frame at all (no params yet, a stalled camera) says so instead of timing on.
                    if let why = r.failure {
                        self.stopRecording(failure: "Recording stopped: \(why)")
                        return
                    }
                    if elapsed > 3, r.sink.framesSent == 0 {
                        self.stopRecording(failure: "Recording stopped: no picture from the camera")
                        return
                    }
                }
            }
        } catch {
            Self.log.error("recording did not start: \(error.localizedDescription)")
            message = "Could not start recording: \(error.localizedDescription)"
        }
    }

    /**
     * Ends the recording and saves the file to Photos. [failure]: why it stopped on its own, shown with the usual
     * message. The file is finished in the background even when the app has left the screen.
     */
    func stopRecording(failure: String? = nil) {
        guard let r = recorder else { return }
        recorder = nil
        recordingTask?.cancel()
        recordingTask = nil
        renderer.videoSink = nil
        controller.onAudio = nil
        recordingSeconds = nil
        UIApplication.shared.isIdleTimerDisabled = false
        UIImpactFeedbackGenerator(style: .medium).impactOccurred()
        pending += 1
        var task = UIBackgroundTaskIdentifier.invalid
        task = UIApplication.shared.beginBackgroundTask(withName: "RawBoy video") {
            UIApplication.shared.endBackgroundTask(task)
        }
        Task {
            var saved = false
            if let url = await r.stop() {
                do {
                    try await PhotoLibraryOutput.save(url, naming: Self.jpegNaming, video: true)
                    saved = true
                } catch {
                    Self.log.error("video save: \(error.localizedDescription)")
                    message = "Could not save the video: \(error.localizedDescription)"
                }
            }
            pending -= 1
            if task != .invalid { UIApplication.shared.endBackgroundTask(task) }
            if saved {
                message = failure.map { "\($0). Video saved to Photos › \(Edition.album)" } ?? "Video saved to Photos › \(Edition.album)"
            } else if message == nil {
                message = failure ?? "Nothing was recorded"
            }
        }
    }

    // MARK: - Capture

    /** Takes a raw now; it is developed into a JPEG in the background. */
    func shutter() {
        if videoMode {
            // The shutter, the volume buttons and the Camera Control record in video mode.
            if recorder != nil { stopRecording() } else { startRecording() }
            return
        }
        guard status == .ready else { return }
        let s = settings
        let flash = info?.hasFlash == true ? s.flash : .off
        // A flash shot's raw is lit by the flash, the viewfinder wasn't: no calibration from it.
        let viewfinderKey = flash == .off ? live?.stats.key : nil
        let mayHaveFace = !controller.frames.faces.isEmpty
        // The photo is level with the horizon; the tap was on the (portrait) viewfinder.
        let degrees = currentDeviceDegrees()
        let meter = meterArea.turned(degrees)
        let spotMetered = focusPoint != nil && !(tracking && subjectHidden)
        let frameNumber = CameraSettingsStore.nextFrameNumber()
        let name = "IMG_" + Self.timestamp()
        let gps = s.geotag ? location.current.map(LocationTracker.gpsMetadata) : nil
        let lockedEv = (exposureLocked && flash == .off) ? lockedExposureEv : nil
        pending += 1
        Task {
            do {
                let result = try await controller.captureDng(flash: flash, shutterSound: s.shutterSound,
                                                             deviceDegrees: degrees, gps: gps) { [weak self] in
                    Task { @MainActor in self?.shutterCount += 1 }
                }
                shots.append(Shot(dng: result.dng, name: name, settings: s, viewfinderKey: viewfinderKey,
                                  iso: result.iso, exposureSeconds: result.exposureSeconds, compensationEv: result.compensationEv, mayHaveFace: mayHaveFace, viewfinder: live?.base, viewfinderExposure: live?.auto.exposure ?? 0, meter: meter, date: Date(), frameNumber: frameNumber, spotMetered: spotMetered, lockedExposureEv: lockedEv))
                developNext()
            } catch {
                Self.log.error("capture: \(error.localizedDescription)")
                message = "Capture failed: \(error.localizedDescription)"
                pending -= 1
            }
        }
    }

    private static func timestamp() -> String {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "yyyyMMdd_HHmmss"
        return f.string(from: Date())
    }

    /** Develops queued shots one at a time. */
    private func developNext() {
        guard !developing, !shots.isEmpty else { return }
        developing = true
        let shot = shots.removeFirst()
        Task {
            do {
                try await develop(shot)
            } catch {
                Self.log.error("develop \(shot.name): \(error.localizedDescription)")
                message = "Could not save \(shot.name): \(error.localizedDescription)"
            }
            pending -= 1
            developing = false
            developNext()
        }
    }

    /** Raw -> auto develop + look -> JPEG / DNG with embedded preview, or Pure RAW directly to Photos. */
    private func develop(_ shot: Shot) async throws {
        let s = shot.settings
        let started = Date()
        var bgTask = UIBackgroundTaskIdentifier.invalid
        bgTask = UIApplication.shared.beginBackgroundTask(withName: "RawBoy photo") {
            UIApplication.shared.endBackgroundTask(bgTask)
        }
        defer { if bgTask != .invalid { UIApplication.shared.endBackgroundTask(bgTask) } }

        let tempDir = FileManager.default.temporaryDirectory
        let dngURL = tempDir.appendingPathComponent(shot.name + ".dng")
        defer { try? FileManager.default.removeItem(at: dngURL) }

        if s.pureRaw {
            // Pure RAW: no standalone JPEG and no embedded preview -> bypass decode, analysis and GPU develop.
            if let vf = shot.viewfinder {
                lastShot = Self.viewfinderThumbnail(vf, exposureEv: shot.viewfinderExposure)
            }
            try shot.dng.write(to: dngURL)
            try await PhotoLibraryOutput.save(dngURL, naming: Self.rawNaming)
            Self.log.notice("saved pure RAW \(shot.name) in \(Int(Date().timeIntervalSince(started) * 1000)) ms")
            return
        }

        let look = s.look
        // LUT first, on the main actor (it's cached there).
        let preliminary = LookApplier.apply(DevelopParams(), look: look, strength: s.strength, adjust: .none, hasFace: false)
        let lut = try await preliminary.lut.asyncMap { try await loadLut($0) }
        let film = try await preliminary.film.asyncMap { try await loadFilm($0) }
        let gpu = exportGpu
        let outcome = try await withCheckedThrowingContinuation { (c: CheckedContinuation<(jpeg: URL?, preview: Data?, dng: Data?, rawKey: Float), Error>) in
            developQueue.async {
                do {
                    let decodeStart = Date()
                    let img = try RawImage.open(data: shot.dng)
                    defer { img.close() }
                    let decodeMs = Int(Date().timeIntervalSince(decodeStart) * 1000)
                    let noiseScale = s.front ? Self.frontNoiseIsoScale : Self.phoneNoiseIsoScale
                    // The phone's auto exposure already metered the raw (ProRAW's or Bayer's BaselineExposure carries
                    // its boost): keep it, but lift it where the AE protected a highlight and took the scene down
                    // (AutoTone.phoneKey). Re-metering it to Auto's camera-raw target put ordinary rooms 1-2 EV under
                    // the phone's camera. Flash shots too: unlike the Pixel's manual flash, the iPhone's flash is
                    // exposed by its own AE.
                    let a = AutoAnalysis.analyze(img, label: shot.name, noiseIsoScale: noiseScale, fallbackIso: shot.iso,
                                                 detectSkin: shot.mayHaveFace, meter: shot.meter, phoneAe: true,
                                                 captureEv: shot.compensationEv, splitLuma: false)
                    let exifExp = img.shotInfo.exposureTime
                    let exposureSeconds: Float = shot.exposureSeconds > 0
                        ? shot.exposureSeconds
                        : (exifExp.isFinite && exifExp > 0 ? Float(exifExp) : 0)
                    let sceneLight = SceneLight(exposureSeconds: exposureSeconds, postRawBoost: 1, captureEv: shot.compensationEv)
                    let autoBase: DevelopParams
                    if let lockedEv = shot.lockedExposureEv {
                        var fixed = a.autoBase
                        fixed.exposure = lockedEv
                        autoBase = fixed
                    } else {
                        autoBase = SceneRecognition.apply(a.autoBase, stats: a.stats, light: sceneLight)
                    }
                    var params = s.develop(autoBase, hasFace: a.stats.hasFace)
                    // High ISO: more denoise than the auto develop's table, up to the coarse stage (denoise > 65).
                    params.denoise = max(params.denoise, Self.highIsoDenoise(a.stats.iso * noiseScale))
                    params.colorDenoise = max(Self.measuredColorDenoise(img, exposure: params.exposure, denoise: params.denoise) ?? params.denoise,
                                              params.colorDenoise ?? 0)
                    params.shadows = max(params.shadows, Self.backlightShadows(a.stats))
                    // Random light leak: one generated leak on saved JPEGs/previews, as on Android (the DNG raw stays clean).
                    if s.randomLightLeak, CameraSettingsStore.nextLightLeak(rate: s.randomLightLeakRate) {
                        let aspect = Float(a.base.width) / Float(max(a.base.height, 1))
                        params.filmLeaks = [FilmLeaks.randomForCamera(aspect: aspect, seed: FilmLeaks.newSeed(),
                                                                      shortSideSprockets: s.shortSideSprockets)]
                    }
                    let shader = ShaderParams.from(params, asShot: a.defaults, lut: lut,
                                                   lens: LensTransform(info: img.lens, params: params), base: a.base,
                                                   bloomSources: a.bloom, skinMask: a.skin,
                                                   grainSizeScale: Self.grainSizeScale, grainStrength: Self.grainStrength(s),
                                                   film: film)
                    let pentax645: Pentax645Info? = (s.photoFrame == .pentax645 || s.photoFrame == .contax645) ? {
                        let info = img.shotInfo
                        let fields = s.pentax645Fields
                        let focalMm = info.focalLength35mm.isFinite && info.focalLength35mm > 0 ? info.focalLength35mm : info.focalLength
                        let isoVal = info.iso.isFinite && info.iso > 0 ? info.iso : Double(shot.iso)
                        let mode = s.monoMode ? "BW" : s.filmMode ? "FILM" : "LOOK"
                        return Pentax645Info(
                            frameNumber: fields.contains(.frameNumber) ? shot.frameNumber : nil,
                            mode: fields.contains(.mode) ? mode : nil,
                            exposureTime: fields.contains(.shutter) ? info.exposureTime : nil,
                            fNumber: fields.contains(.aperture) ? info.fNumber : nil,
                            compensationEv: fields.contains(.exposureComp) ? s.exposureCompensationEv : nil,
                            spotMetered: fields.contains(.metering) ? shot.spotMetered : nil,
                            focalLengthMm: fields.contains(.focalLength) ? focalMm : nil,
                            iso: fields.contains(.iso) ? isoVal : nil,
                            date: fields.contains(.date) ? Pentax645Frame.formatDate(shot.date, format: s.dateStampFormat) : nil,
                            time: fields.contains(.time) ? Pentax645Frame.formatTime(shot.date, format: s.timeStampFormat) : nil,
                            flipped: s.pentax645Flip,
                            fieldOrder: s.pentax645Order.map(\.rawValue),
                            color: s.frameColor,
                            style: s.photoFrame == .contax645 ? .contax645 : .pentax645)
                    }() : nil
                    let export = ExportSettings(format: .jpeg, jpegQuality: s.jpegQuality, jpegEncoder: .jpegli,
                                                maxLongSide: s.maxLongSide,
                                                downscaleSharpen: CameraSettings.smallSharpen,
                                                dateStamp: s.photoFrame == .dateStamp ? DateStamp.format(shot.date, format: s.dateStampFormat) : "",
                                                dateStampStyle: s.dateStampStyle,
                                                pentax645: pentax645,
                                                monochromeImprint: s.monoMode)
                    let previewMaxLongSide = s.rawPreview.maxLongSide
                    var previewSettings = export
                    previewSettings.jpegQuality = CameraSettings.rawPreviewQuality
                    previewSettings.maxLongSide = previewMaxLongSide

                    let exportStart = Date()
                    var jpegURL: URL?
                    var previewData: Data?
                    if s.saveJpeg {
                        let file = try Exporter().export(img, sourceName: shot.name, params: shader, settings: export,
                                                         naming: Self.jpegNaming, gpu: gpu)
                        jpegURL = file
                        if s.embedDngPreview {
                            let jpegSmallerThanPreview = s.maxLongSide != nil && previewMaxLongSide != nil && previewMaxLongSide! > s.maxLongSide!
                            if jpegSmallerThanPreview {
                                previewData = try Exporter().exportJpegData(img, params: shader, settings: previewSettings, gpu: gpu)
                            } else {
                                previewData = Self.makePreviewJpeg(from: file, maxLongSide: previewMaxLongSide, quality: CameraSettings.rawPreviewQuality)
                            }
                        }
                    } else if s.embedDngPreview {
                        previewData = try Exporter().exportJpegData(img, params: shader, settings: previewSettings, gpu: gpu)
                    }
                    Self.log.notice("\(shot.name): decode \(decodeMs) ms, develop + JPEG \(Int(Date().timeIntervalSince(exportStart) * 1000)) ms")

                    var dngData: Data?
                    if s.keepDng {
                        if let previewData {
                            let embedStart = Date()
                            do {
                                dngData = try DngPreview.embed(previewData, in: shot.dng) ?? shot.dng
                                Self.log.notice("\(shot.name): embedded DNG preview (\(previewData.count / 1024) KB) in \(Int(Date().timeIntervalSince(embedStart) * 1000)) ms")
                            } catch {
                                Self.log.error("\(shot.name): DNG preview embed failed: \(error.localizedDescription)")
                                dngData = shot.dng
                            }
                        } else {
                            dngData = shot.dng
                        }
                    }
                    c.resume(returning: (jpegURL, previewData, dngData, a.stats.key))
                } catch {
                    c.resume(throwing: error)
                }
            }
        }
        if let jpeg = outcome.jpeg {
            lastShot = UIImage(contentsOfFile: jpeg.path)?.preparingThumbnail(of: CGSize(width: 160, height: 160))
            #if DEBUG
            DebugSnapshots.save(shot.name, jpeg: jpeg, viewfinder: shot.viewfinder, dng: outcome.dng ?? shot.dng)
            #endif
            try await PhotoLibraryOutput.save(jpeg, naming: Self.jpegNaming)
        } else if let preview = outcome.preview {
            lastShot = UIImage(data: preview)?.preparingThumbnail(of: CGSize(width: 160, height: 160))
        }
        if let dngData = outcome.dng {
            try dngData.write(to: dngURL)
            try await PhotoLibraryOutput.save(dngURL, naming: Self.rawNaming)
        }
        Self.log.notice("saved \(shot.name) in \(Int(Date().timeIntervalSince(started) * 1000)) ms")
        if let key = shot.viewfinderKey { calibrate(rawKey: outcome.rawKey, viewfinderKey: key, lens: s.lensKey, scaleAtShutter: s.previewScale) }
    }

    /** Downscales (if needed) and re-encodes the saved JPEG at [quality] for embedding as a DNG preview. */
    private nonisolated static func makePreviewJpeg(from jpegURL: URL, maxLongSide: Int?, quality: Int) -> Data? {
        guard let src = CGImageSourceCreateWithURL(jpegURL as CFURL, nil) else { return nil }
        let cgImage: CGImage?
        if let maxLongSide {
            let opts: [CFString: Any] = [
                kCGImageSourceCreateThumbnailFromImageAlways: true,
                kCGImageSourceCreateThumbnailWithTransform: true,
                kCGImageSourceThumbnailMaxPixelSize: maxLongSide,
            ]
            cgImage = CGImageSourceCreateThumbnailAtIndex(src, 0, opts as CFDictionary)
        } else {
            cgImage = CGImageSourceCreateImageAtIndex(src, 0, nil)
        }
        guard let cgImage else { return nil }
        let out = NSMutableData()
        guard let dest = CGImageDestinationCreateWithData(out as CFMutableData, "public.jpeg" as CFString, 1, nil) else { return nil }
        CGImageDestinationAddImage(dest, cgImage, [kCGImageDestinationLossyCompressionQuality: Double(quality) / 100] as CFDictionary)
        return CGImageDestinationFinalize(dest) ? out as Data : nil
    }

    /**
     * Builds a tiny (~160 px) sRGB thumbnail from the live 512 px linear Rec.2020 viewfinder frame in <1 ms,
     * so Pure RAW shots still update the shutter thumbnail without decoding the DNG.
     */
    private nonisolated static func viewfinderThumbnail(_ preview: PreviewImage, exposureEv: Float) -> UIImage? {
        let srcW = preview.width
        let srcH = preview.height
        guard srcW > 0, srcH > 0, preview.pixels.count >= srcW * srcH * 3 else { return nil }
        let step = max(1, max(srcW, srcH) / 160)
        let dstW = (srcW + step - 1) / step
        let dstH = (srcH + step - 1) / step
        let gain = powf(2, exposureEv)
        var rgba = [UInt8](repeating: 255, count: dstW * dstH * 4)
        var out = 0
        for y in 0..<dstH {
            let sy = min(y * step, srcH - 1)
            for x in 0..<dstW {
                let sx = min(x * step, srcW - 1)
                let off = (sy * srcW + sx) * 3
                let r2020 = Float(Float16(bitPattern: preview.pixels[off])) * gain
                let g2020 = Float(Float16(bitPattern: preview.pixels[off + 1])) * gain
                let b2020 = Float(Float16(bitPattern: preview.pixels[off + 2])) * gain
                // Linear Rec.2020 -> sRGB, soft Reinhard roll-off, sRGB gamma.
                let r = max(0, 1.6605 * r2020 - 0.5876 * g2020 - 0.0728 * b2020)
                let g = max(0, -0.1246 * r2020 + 1.1329 * g2020 - 0.0083 * b2020)
                let b = max(0, -0.0182 * r2020 - 0.1006 * g2020 + 1.1187 * b2020)
                rgba[out] = UInt8(min(max((255 * powf(r / (1 + r), 1 / 2.2)).rounded(), 0), 255))
                rgba[out + 1] = UInt8(min(max((255 * powf(g / (1 + g), 1 / 2.2)).rounded(), 0), 255))
                rgba[out + 2] = UInt8(min(max((255 * powf(b / (1 + b), 1 / 2.2)).rounded(), 0), 255))
                out += 4
            }
        }
        guard let cg = try? ThumbnailRenderer.cgImage(rgba, dstW, dstH) else { return nil }
        return UIImage(cgImage: cg)
    }

    /**
     * Learns the viewfinder's preview gain for a lens from a shot: the raw's scene key over the viewfinder's.
     * A lens's first shot takes the full correction; later shots move halfway (in stops), which smooths out
     * scene-to-scene noise.
     */
    private func calibrate(rawKey: Float, viewfinderKey: Float, lens: String, scaleAtShutter: Float) {
        guard rawKey > 0, viewfinderKey > 0 else { return }
        let estimate = scaleAtShutter * min(max(rawKey / viewfinderKey, 1.0 / 16), 16)
        let known = settings.previewScales[lens]
        let scale = known.map { $0 * (estimate / $0).squareRoot() } ?? estimate  // halfway in stops
        let clamped = min(max(scale, CameraSettings.minScale), CameraSettings.maxScale)
        Self.log.notice("calibrate \(lens): raw key \(rawKey), viewfinder key \(viewfinderKey) -> preview scale \(clamped)")
        change { $0.previewScales[lens] = clamped }
    }

    private func loadLut(_ id: String) async throws -> LutData {
        if let l = luts[id] { return l }
        let data = try await Task.detached(priority: .userInitiated) { try LutLoader.load(id) }.value
        luts[id] = data
        return data
    }

    /** A film stock's two LUTs, loaded once (Film mode). */
    private func loadFilm(_ id: String) async throws -> FilmData {
        if let f = films[id] { return f }
        let data = try await Task.detached(priority: .userInitiated) {
            guard let stock = try FilmStocks.byId(id) else { throw LutError(message: "Unknown film stock \(id)") }
            return try FilmStocks.load(stock)
        }.value
        films[id] = data
        return data
    }

    /**
     * Backlit scenes (a window, a lamp in frame): the phone's own preview lifts the dark parts locally, and the plain
     * raw develop left them near black (owner preferred the preview). Shadows rise with the scene's range, p98 - p5:
     * ordinary scenes span 3-5 stops (no change), a room against a window 7 (75, which matched the iPhone's
     * viewfinder on that shot). Fades out from ISO 800 to 3200, where lifting would mostly lift noise. Shots only:
     * the viewfinder's frames come already lifted.
     */
    nonisolated static func backlightShadows(_ s: SceneStats) -> Float {
        let lift = min(max((s.p98 - s.p5 - 5) * 37.5, 0), 80)
        let t = min(max((s.iso - 800) / 2400, 0), 1)
        return (lift * (1 - t * t * (3 - 2 * t))).rounded()
    }

    /**
     * Denoise for a phone shot at high ISO, by "equivalent" ISO (shot ISO x noise scale): unchanged up to 3200,
     * then 6400 -> 60, 12800 -> 80, 25600 and up -> 100, interpolated in stops. Above 65 the shader adds its coarse
     * stage.
     */
    /**
     * Colour denoise from the shot's measured colour noise (Auto's calibration, AutoTone.measuredNoiseSettings at the
     * develop's [exposure]), at least the luma [denoise] it used to follow; nil (follows denoise) when the raw can't be
     * measured. See ShotSaver.measuredColorDenoise (Android): the ISO table gave low-ISO night shots no colour denoise.
     * Luma stays on the ISO table. The shader scales this towards the corners by the lens shading gain.
     */
    private nonisolated static func measuredColorDenoise(_ img: RawImage, exposure: Float, denoise: Float) -> Float? {
        let noise = img.measureNoise()
        guard noise.measured else { return nil }
        return max(AutoTone.measuredNoiseSettings(noise, exposure: exposure).1, denoise)
    }

    private nonisolated static func highIsoDenoise(_ equivalentIso: Float) -> Float {
        if equivalentIso <= 3200 { return 0 }
        let stops = log2f(equivalentIso / 3200)
        let v: Float = stops <= 1 ? 60 * stops : stops <= 2 ? 60 + 20 * (stops - 1) : stops <= 3 ? 80 + 20 * (stops - 2) : 100
        return v.rounded()
    }

    /**
     * Camera face rectangles as a coarse skin mask for metering (SceneAnalyzer meters skin and
     * sizes faces from it): an ellipse in the middle of each face box.
     */
    private nonisolated static func faceMask(_ faces: [CGRect], _ base: PreviewImage) -> SkinMask {
        let w = 64
        let h = max(1, Int(64 * Float(base.height) / Float(base.width)))
        var data = [Float](repeating: 0, count: w * h)
        var diameter: Float = 0
        for face in faces {
            diameter = max(diameter, Float(face.width) * Float(base.fullWidth))
            let cx = Float(face.midX) * Float(w)
            let cy = Float(face.midY) * Float(h)
            let rx = Float(face.width) * Float(w) * 0.35
            let ry = Float(face.height) * Float(h) * 0.35
            if rx <= 0 || ry <= 0 { continue }
            for y in 0..<h {
                for x in 0..<w {
                    let dx = (Float(x) + 0.5 - cx) / rx
                    let dy = (Float(y) + 0.5 - cy) / ry
                    if dx * dx + dy * dy <= 1 { data[y * w + x] = 1 }
                }
            }
        }
        return SkinMask(width: w, height: h, data: data, sigmaPx: 3, hasSkin: diameter > 0, faceDiameterPx: diameter)
    }
}
