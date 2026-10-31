import AVFoundation
import Foundation
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
    /** The QR code in the viewfinder (settings.scanQr), or nil. */
    @Published private(set) var qrCode: QrPayload?
    private var qrTracker = QrTracker()

    private var info: CameraController.Info?
    private var startTask: Task<Void, Never>?
    private var active = false
    /** The phone's position while geotagging is on and the app is in front. */
    private let location = LocationTracker()

    /** The latest analysed viewfinder frame. */
    private struct Live {
        let base: PreviewImage
        let stats: SceneStats
        let defaults: DevelopParams
        let auto: DevelopParams
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
        /** Exposure target bias the shot was taken with (Brightness), taken back out by the develop. */
        let compensationEv: Float
        /** The camera saw a face at the shutter: run skin detection. */
        let mayHaveFace: Bool
        /** The viewfinder's 512 px copy at the shutter (debug snapshots). */
        let viewfinder: PreviewImage?
        /** Where the photo is metered, in the photo's own (level) orientation: see meterArea. */
        let meter: MeterArea
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
    /** How the phone is held (degrees clockwise from portrait), kept while it lies flat; for the tap's metering spot. */
    private var deviceDegrees = 0
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
        controller.onFrame = { [renderer, subject] buffer in
            renderer.enqueue(buffer)
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
        active = false
        updateLocation()
        if saveTask != nil {
            saveTask?.cancel()
            saveTask = nil
            CameraSettingsStore.save(settings)
        }
        startTask?.cancel()
        startTask = nil
        controller.stop()
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
                recording = try await controller.start(lens, format: settings.rawFormat)
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

    /** The device's turn from portrait now (clockwise, as the photo's horizon-level orientation follows it). */
    private func currentDeviceDegrees() -> Int {
        switch UIDevice.current.orientation {
        case .portrait: deviceDegrees = 0
        case .landscapeRight: deviceDegrees = 90  // home side on the left: turned clockwise
        case .portraitUpsideDown: deviceDegrees = 180
        case .landscapeLeft: deviceDegrees = 270
        default: break  // flat or unknown: as last held
        }
        return deviceDegrees
    }

    /** Switches to the lens labelled [label] (UW, W, T) on the current side. */
    func selectLens(_ label: String) {
        guard let lens = lenses.first(where: { $0.label == label }), lens != info else { return }
        switchTo(lens)
        change { $0.lens = label }
    }

    /** Back cameras <-> selfie camera. */
    func switchFacing() {
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
        change { $0.rawFormat = format }
        if let info { switchTo(info) }
    }

    private func switchTo(_ lens: CameraController.Info) {
        info = lens
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
            let auto = AutoTone.develop(stats, asShot: defaults, phoneAe: true, captureEv: state.compensationEv)
            await MainActor.run {
                guard let self else { return }
                self.analysing = false
                // A new metering area (a tap, a release, a tracked subject hiding) can move the exposure by a stop at
                // once; the viewfinder eases there over a few updates instead of snapping.
                var eased = auto
                if let last = self.live?.auto.exposure {
                    eased.exposure = last + min(max(auto.exposure - last, -Self.maxEvStep), Self.maxEvStep)
                }
                self.live = Live(base: base, stats: stats, defaults: defaults, auto: eased)
                self.publish()
            }
        }
    }

    /** Viewfinder uniforms for the latest frame and the current controls. */
    private func publish() {
        guard let l = live, let f = renderer.frame else { return }
        let s = settings
        var p = compare ? l.auto : s.develop(l.auto, hasFace: l.stats.hasFace)
        // The camera has already denoised and sharpened the preview stream.
        p.denoise = 0
        p.sharpening = 0
        p.skinRetouch = 0
        let params = p
        let lutId = p.lut
        let filmId = p.film
        Task {
            let lut = await lutId.asyncMap { try? await loadLut($0) } ?? nil
            let film = await filmId.asyncMap { try? await loadFilm($0) } ?? nil
            let lens = LensTransform(info: LensInfo.none(width: f.fullWidth, height: f.fullHeight), params: params)
            let shader = ShaderParams.from(params, asShot: l.defaults, lut: lut, lens: lens, base: l.base,
                                           bloomSources: nil, skinMask: nil, grainSizeScale: Self.grainSizeScale,
                                           grainStrength: Self.grainStrength(s), film: film)
            renderer.params = shader
            updateHistogram(shader, l.base)
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
     * measured under 1 level of 255 (std) on a Portra 160 photo. B&W mode has monoGrain times the grain.
     */
    private nonisolated static func grainStrength(_ s: CameraSettings) -> Float {
        (s.smallExport ? 1.34 : 1) * (s.rawFormat == .proRaw ? 3 : 1) * (s.monoMode ? monoGrain : 1)
    }

    /** B&W mode's grain on top of the mono stock's (owner's choice, 2026-10-31: the looks' own read too clean). */
    private nonisolated static let monoGrain: Float = 3

    // MARK: - Controls

    /** Picks id for the current mode: B&W mode's stock or the colour look. */
    /** Picks id for the current mode: B&W mode's stock, Film mode's stock or the colour look. */
    func setLook(_ id: String) {
        change {
            if $0.monoMode { $0.monoLookId = id } else if $0.filmMode { $0.filmLookId = id } else { $0.lookId = id }
        }
    }
    func setMono(_ on: Bool) { change { $0.mono = on } }
    /** The Film toggle: colour photos on the film stocks or on the LUT looks. */
    func setFilm(_ on: Bool) { change { $0.film = on } }
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
    func setSmallExport(_ on: Bool) { change { $0.smallExport = on } }
    func setRememberLast(_ on: Bool) { change { $0.rememberLast = on } }
    func setShutterSound(_ on: Bool) { change { $0.shutterSound = on } }
    func setShowHistogram(_ on: Bool) {
        change { $0.showHistogram = on }
        if !on { histogram = nil }
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

    func setScanQr(_ on: Bool) {
        change { $0.scanQr = on }
        controller.setScanQr(on)
        if !on { clearQr() }
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

    // MARK: - Capture

    /** Takes a raw now; it is developed into a JPEG in the background. */
    func shutter() {
        guard status == .ready else { return }
        let s = settings
        let flash = info?.hasFlash == true ? s.flash : .off
        // A flash shot's raw is lit by the flash, the viewfinder wasn't: no calibration from it.
        let viewfinderKey = flash == .off ? live?.stats.key : nil
        let mayHaveFace = !controller.frames.faces.isEmpty
        // The photo is level with the horizon; the tap was on the (portrait) viewfinder.
        let meter = meterArea.turned(currentDeviceDegrees())
        let name = "IMG_" + Self.timestamp()
        let gps = s.geotag ? location.current.map(LocationTracker.gpsMetadata) : nil
        pending += 1
        Task {
            do {
                let result = try await controller.captureDng(flash: flash, shutterSound: s.shutterSound, gps: gps) { [weak self] in
                    Task { @MainActor in self?.shutterCount += 1 }
                }
                shots.append(Shot(dng: result.dng, name: name, settings: s, viewfinderKey: viewfinderKey,
                                  iso: result.iso, compensationEv: result.compensationEv, mayHaveFace: mayHaveFace, viewfinder: live?.base, meter: meter))
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

    /** Raw -> auto develop + look -> JPEG (jpegli), as RawBoy Auto develops a photo. */
    private func develop(_ shot: Shot) async throws {
        let s = shot.settings
        let look = s.look
        let started = Date()
        let tempDir = FileManager.default.temporaryDirectory
        let dngURL = tempDir.appendingPathComponent(shot.name + ".dng")
        try shot.dng.write(to: dngURL)
        defer { if !s.keepDng { try? FileManager.default.removeItem(at: dngURL) } }
        // LUT first, on the main actor (it's cached there).
        let preliminary = LookApplier.apply(DevelopParams(), look: look, strength: s.strength, adjust: .none, hasFace: false)
        let lut = try await preliminary.lut.asyncMap { try await loadLut($0) }
        let film = try await preliminary.film.asyncMap { try await loadFilm($0) }
        let gpu = exportGpu
        let (jpeg, rawKey) = try await withCheckedThrowingContinuation { (c: CheckedContinuation<(URL, Float), Error>) in
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
                                                 captureEv: shot.compensationEv)
                    var params = s.develop(a.autoBase, hasFace: a.stats.hasFace)
                    // High ISO: more denoise than the auto develop's table, up to the coarse stage (denoise > 65).
                    params.denoise = max(params.denoise, Self.highIsoDenoise(a.stats.iso * noiseScale))
                    params.colorDenoise = Self.measuredColorDenoise(img, exposure: params.exposure, denoise: params.denoise)
                    params.shadows = max(params.shadows, Self.backlightShadows(a.stats))
                    let shader = ShaderParams.from(params, asShot: a.defaults, lut: lut,
                                                   lens: LensTransform(info: img.lens, params: params), base: a.base,
                                                   bloomSources: a.bloom, skinMask: a.skin,
                                                   grainSizeScale: Self.grainSizeScale, grainStrength: Self.grainStrength(s),
                                                   film: film)
                    let export = ExportSettings(format: .jpeg, jpegQuality: s.jpegQuality, jpegEncoder: .jpegli,
                                                maxLongSide: s.maxLongSide,
                                                downscaleSharpen: CameraSettings.smallSharpen)
                    let exportStart = Date()
                    let file = try Exporter().export(img, sourceName: shot.name, params: shader, settings: export,
                                                     naming: Self.jpegNaming, gpu: gpu)
                    Self.log.notice("\(shot.name): decode \(decodeMs) ms, develop + JPEG \(Int(Date().timeIntervalSince(exportStart) * 1000)) ms")
                    c.resume(returning: (file, a.stats.key))
                } catch {
                    c.resume(throwing: error)
                }
            }
        }
        lastShot = UIImage(contentsOfFile: jpeg.path)?.preparingThumbnail(of: CGSize(width: 160, height: 160))
        #if DEBUG
        DebugSnapshots.save(shot.name, jpeg: jpeg, viewfinder: shot.viewfinder, dng: shot.dng)
        #endif
        try await PhotoLibraryOutput.save(jpeg, naming: Self.jpegNaming)
        if s.keepDng { try await PhotoLibraryOutput.save(dngURL, naming: Self.rawNaming) }
        Self.log.notice("saved \(shot.name) in \(Int(Date().timeIntervalSince(started) * 1000)) ms")
        if let key = shot.viewfinderKey { calibrate(rawKey: rawKey, viewfinderKey: key, lens: s.lensKey, scaleAtShutter: s.previewScale) }
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

    /** A film stock's two LUTs, loaded once (RawBoy Film). */
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
