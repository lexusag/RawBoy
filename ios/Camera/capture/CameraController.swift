@preconcurrency import AVFoundation
import Foundation
import ImageIO
import os
import UIKit

/**
 * The camera (AVFoundation): one lens at a time streaming upright sRGB frames for the viewfinder, plus raw stills
 * as DNG. Each lens is a physical camera (Bayer RAW isn't available on the virtual multi-camera devices), so
 * switching lenses reconfigures the session. All session work runs on [queue]. Port of the role of Android's
 * Camera2 CameraController; the Pixel-specific workarounds there (YUV matrix, tone curve, manual flash) don't apply.
 */
final class CameraController: NSObject, @unchecked Sendable {
    /** A lens the app offers. */
    struct Info: Equatable {
        let label: String
        let deviceId: String
        let isFront: Bool
        let hasFlash: Bool
        /** 35 mm equivalent focal length, for ordering UW < W < T. */
        let equivalentFocal: Double

        static func == (a: Info, b: Info) -> Bool { a.deviceId == b.deviceId }
    }

    /** What the camera reports for the current frame. */
    struct FrameState {
        /** As-shot white (CIE xy) from the camera's white balance gains. */
        var whiteXY: [Double]?
        var iso: Float = 0
        /** Current exposure duration in seconds (0 = unknown), for scene recognition. */
        var exposureSeconds: Float = 0
        /**
         * EV the frames carry over AE's metering: a still's manual exposure (Exposure, ExposureProgram) while it is
         * set, else 0. The live develop takes it out, so the viewfinder doesn't jump while a shot is exposed by hand.
         */
        var compensationEv: Float = 0
        /** The sensor's ISO and exposure time range, for the shutter speed and ISO readout (stillExposure). */
        var isoRange: ClosedRange<Float> = 0...0
        var exposureRangeNs: ClosedRange<Int64> = 0...0
        /** Faces in upright normalised coordinates (as shown). */
        var faces: [CGRect] = []
        var focusing = false
        /**
         * Side of the focus lock's AF box as a share of the short side: focusSize where the device takes a focus
         * rectangle (iOS 26), else the area Apple picks around the point (about the metering spot).
         */
        var focusBox = CameraController.spotSize
    }

    struct CaptureResult {
        let dng: Data
        let iso: Float
        /** Exposure duration in seconds at the shutter (0 = unknown, falls back to DNG EXIF). */
        let exposureSeconds: Float
        /**
         * EV the raw got over AE's metered exposure (Exposure's manual exposure, as the camera applied it; 0 at the
         * metered exposure): the develop takes it back out (AutoTone captureEv) and adds the Exposure setting.
         */
        let compensationEv: Float
    }

    /**
     * A still being exposed by hand (Exposure != 0): AE's metered exposure it started from, and how many captures
     * still use the manual exposure (back-to-back shots share it). The camera queue's own; nil = AE runs.
     */
    private var manual: (meteredNs: Int64, meteredIso: Float, captures: Int)?

    /** AE meters at 0: an exposure target bias left from an older version (Brightness) is cleared. Call on the queue. */
    private func clearExposureBias(_ device: AVCaptureDevice) {
        guard device.exposureTargetBias != 0 else { return }
        do {
            try device.lockForConfiguration()
            device.setExposureTargetBias(0, completionHandler: nil)
            device.unlockForConfiguration()
        } catch {
            Self.log.error("exposure bias: \(error.localizedDescription)")
        }
    }

    /**
     * The manual exposure a still at [ev] would get now (the shutter speed and ISO readout), from the frames' metered
     * exposure; nil before the first frame.
     */
    func stillExposure(ev: Float) -> ExposureProgram.Exposure? {
        let st = frames
        guard st.iso > 0, st.exposureSeconds > 0, st.isoRange.upperBound > 0 else { return nil }
        let t0 = Int64((Double(st.exposureSeconds) * 1e9).rounded())
        if ev == 0 || st.compensationEv != 0 { return ExposureProgram.Exposure(exposureNs: t0, iso: Int(st.iso.rounded())) }
        return ExposureProgram.compute(ev: ev, t0Ns: t0, iso0: st.iso, isoMin: Int(st.isoRange.lowerBound.rounded(.up)),
                                       isoMax: Int(st.isoRange.upperBound), expMin: st.exposureRangeNs.lowerBound,
                                       expMax: st.exposureRangeNs.upperBound, maxStillNs: ExposureProgram.maxStillNs)
    }

    /**
     * Sets the manual exposure for a still at [ev] over AE's metering (kept from an earlier manual shot still in
     * flight), then calls [ready] on the queue with the EV the camera applied; [ready] gets nil where the device can't
     * (no custom exposure). Call on the queue; each non-nil call must be matched by endManualExposure.
     */
    private func beginManualExposure(ev: Float, ready: @escaping (Float?) -> Void) {
        guard let device = input?.device, device.isExposureModeSupported(.custom) else { ready(nil); return }
        let format = device.activeFormat
        let metered = manual.map { ($0.meteredNs, $0.meteredIso) }
            ?? (Int64((device.exposureDuration.seconds * 1e9).rounded()), device.iso)
        guard metered.0 > 0, metered.1 > 0 else { ready(nil); return }
        let expMin = Int64((format.minExposureDuration.seconds * 1e9).rounded(.up))
        let expMax = Int64((format.maxExposureDuration.seconds * 1e9).rounded(.down))
        let program = ExposureProgram.compute(
            ev: ev, t0Ns: metered.0, iso0: metered.1, isoMin: Int(format.minISO.rounded(.up)), isoMax: Int(format.maxISO),
            expMin: expMin, expMax: expMax, maxStillNs: ExposureProgram.maxStillNs)
        let iso = min(max(Float(program.iso), format.minISO), format.maxISO)
        do {
            try device.lockForConfiguration()
        } catch {
            Self.log.error("manual exposure: \(error.localizedDescription)")
            ready(nil)
            return
        }
        manual = (metered.0, metered.1, (manual?.captures ?? 0) + 1)
        let meteredGain = Double(metered.0) / 1e9 * Double(metered.1)
        // Once: the frames at the new exposure have arrived, or (no completion, e.g. the session was interrupted) a
        // second has passed and the shot goes ahead at what the camera reports.
        let once = Once()
        let proceed = { [weak self] in
            guard let self, once.first() else { return }
            // What the camera applied (it may round the time or ISO), measured against the same metering.
            let applied = ExposureProgram.capturedEv(
                exposureNs: Int64((device.exposureDuration.seconds * 1e9).rounded()), iso: device.iso, meteredGain: meteredGain)
            self.stateLock.withLock { self.state.compensationEv = applied }
            Self.log.notice("exposure \(ev) EV: metered \(metered.0) ns ISO \(metered.1) -> \(program.exposureNs) ns ISO \(program.iso), raw \(applied) EV")
            ready(applied)
        }
        device.setExposureModeCustom(duration: CMTime(value: program.exposureNs, timescale: 1_000_000_000), iso: iso) { [weak self] _ in
            self?.queue.async { proceed() }
        }
        device.unlockForConfiguration()
        queue.asyncAfter(deadline: .now() + 1) { proceed() }
    }

    /** One manual still is done: AE takes over once none is left (or the lock holds AE's exposure). Call on the queue. */
    private func endManualExposure() {
        guard var m = manual else { return }
        m.captures -= 1
        if m.captures > 0 { manual = m; return }
        manual = nil
        stateLock.withLock { state.compensationEv = 0 }
        guard let device = input?.device else { return }
        do {
            try device.lockForConfiguration()
            if exposureLocked {
                // Back to the exposure the lock held.
                device.setExposureModeCustom(duration: CMTime(value: m.meteredNs, timescale: 1_000_000_000),
                                             iso: min(max(m.meteredIso, device.activeFormat.minISO), device.activeFormat.maxISO),
                                             completionHandler: nil)
            } else if device.isExposureModeSupported(.continuousAutoExposure) {
                device.exposureMode = .continuousAutoExposure
            }
            device.unlockForConfiguration()
        } catch {
            Self.log.error("end manual exposure: \(error.localizedDescription)")
        }
    }

    struct Failure: LocalizedError {
        let message: String
        var errorDescription: String? { message }
    }

    private static let log = Logger(subsystem: "app.rawboy", category: "RawBoyCamera")

    let session = AVCaptureSession()
    let queue = DispatchQueue(label: "RawBoy-camera")
    private let frameQueue = DispatchQueue(label: "RawBoy-frames", qos: .userInteractive)
    private let videoOutput = AVCaptureVideoDataOutput()
    private let photoOutput = AVCapturePhotoOutput()
    private let metadataOutput = AVCaptureMetadataOutput()
    private let audioOutput = AVCaptureAudioDataOutput()
    private let audioQueue = DispatchQueue(label: "RawBoy-audio", qos: .userInitiated)
    private var audioInput: AVCaptureDeviceInput?
    /** Video mode's state, applied after each (re)configuration; the camera queue's own. */
    private var videoStabilizationOn = false
    private var exposureLocked = false
    /**
     * Video mode runs the camera on its 1080p video format instead of the photo format: the photo format (4032 px) offers
     * no standard video stabilization, the video formats do. No raw stills then (video mode takes none); the camera
     * restarts on each switch of mode. The camera queue's own.
     */
    private var videoFormat = false
    private var input: AVCaptureDeviceInput?
    /**
     * `AVCaptureConnection.videoRotationAngle` that makes the active lens upright in portrait (90° on back lenses and
     * iPhone ≤ 16 front; 0° on iPhone 17/Pro/Air front). Read from the fresh video connection's default angle in
     * `orientConnection`, guarded by [queue].
     */
    private var portraitCaptureAngle = 90
    private var rawType: OSType?
    /**
     * The shutter sound can't be turned off: before iOS 18, or where the law requires it (Japan, Korea…), which
     * AVFoundation reports as no shutter sound suppression. Set by start.
     */
    private(set) var shutterSoundRequired = true
    private var current: Info?
    private var captures: [Int64: PhotoDelegate] = [:]
    private let stateLock = NSLock()
    private var state = FrameState()
    private var configured = false
    /** Log the next frame's size (after each start), to check its orientation. */
    private var logNextFrame = true

    /** Each viewfinder frame with its presentation time (frame queue). */
    var onFrame: ((CVPixelBuffer, CMTime) -> Void)?

    /** A microphone buffer while video mode's microphone is on (audio queue). */
    var onAudio: ((CMSampleBuffer) -> Void)?

    /** The text of a QR code the camera sees (frame queue), while setScanQr is on. */
    var onQr: ((String) -> Void)?
    /** Guarded by queue. */
    private var scanQr = false

    /** The camera's latest frame metadata. */
    var frames: FrameState { stateLock.withLock { state } }

    /** The raw stills' full upright size for the current lens (sizes grain like the final), set by [start]. */
    private(set) var rawSize = CGSize(width: 3024, height: 4032)

    /** Lenses with a raw format, per side, in UW, W, T order. */
    static func lenses(front: Bool) -> [Info] {
        let types: [AVCaptureDevice.DeviceType] = front
            ? [.builtInWideAngleCamera]
            : [.builtInUltraWideCamera, .builtInWideAngleCamera, .builtInTelephotoCamera]
        let devices = AVCaptureDevice.DiscoverySession(deviceTypes: types, mediaType: .video,
                                                      position: front ? .front : .back).devices
        let sorted = devices.map { d -> (AVCaptureDevice, Double) in
            // Approximate 35 mm equivalents, only for ordering (iPhone 17 Pro: 13, 24, 100 mm).
            let focal: Double = switch d.deviceType {
            case .builtInUltraWideCamera: 13
            case .builtInTelephotoCamera: 100
            default: 24
            }
            return (d, focal)
        }.sorted { $0.1 < $1.1 }
        return sorted.map { d, focal in
            let label = front ? "W" : d.deviceType == .builtInUltraWideCamera ? "UW" : d.deviceType == .builtInTelephotoCamera ? "T" : "W"
            return Info(label: label, deviceId: d.uniqueID, isFront: front, hasFlash: d.hasFlash, equivalentFocal: focal)
        }
    }

    /** Starts (or switches to) [lens], recording [format] (falling back to the other raw format, then failing). */
    func start(_ lens: Info, format: RawFormat, video: Bool = false) async throws -> RawFormat {
        try await withCheckedThrowingContinuation { (c: CheckedContinuation<RawFormat, Error>) in
            queue.async {
                do {
                    self.videoFormat = video
                    let used = try self.configure(lens, format)
                    // After the commit: it rebuilds the connections for a new input, dropping their settings
                    // (the selfie camera came out sideways and stretched).
                    self.orientConnection(front: lens.isFront)
                    self.applyFrameRate()
                    // Only once the configuration is committed: startRunning inside it throws.
                    if !self.session.isRunning { self.session.startRunning() }
                    c.resume(returning: used)
                } catch {
                    c.resume(throwing: error)
                }
            }
        }
    }

    private func configure(_ lens: Info, _ format: RawFormat) throws -> RawFormat {
        guard let device = AVCaptureDevice(uniqueID: lens.deviceId) else { throw Failure(message: "camera not found") }
        session.beginConfiguration()
        defer { session.commitConfiguration() }
        session.sessionPreset = videoFormat ? .hd1920x1080 : .photo
        // sRGB frames, so the viewfinder's linearisation is exact up to a gain.
        session.automaticallyConfiguresCaptureDeviceForWideColor = false
        if let input { session.removeInput(input) }
        let newInput = try AVCaptureDeviceInput(device: device)
        guard session.canAddInput(newInput) else { throw Failure(message: "cannot use this camera") }
        session.addInput(newInput)
        input = newInput
        if !configured {
            videoOutput.videoSettings = [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA]
            videoOutput.alwaysDiscardsLateVideoFrames = true
            videoOutput.setSampleBufferDelegate(self, queue: frameQueue)
            if session.canAddOutput(videoOutput) { session.addOutput(videoOutput) }
            if session.canAddOutput(photoOutput) { session.addOutput(photoOutput) }
            if session.canAddOutput(metadataOutput) {
                session.addOutput(metadataOutput)
                metadataOutput.setMetadataObjectsDelegate(self, queue: frameQueue)
            }
            configured = true
        }
        updateMetadataTypes()
        try device.lockForConfiguration()
        if device.activeColorSpace != .sRGB, device.activeFormat.supportedColorSpaces.contains(.sRGB) {
            device.activeColorSpace = .sRGB
        }
        if device.activeFormat.isVideoHDRSupported {
            // No local tone mapping in the preview: the viewfinder's linearisation assumes a plain curve.
            device.automaticallyAdjustsVideoHDREnabled = false
            device.isVideoHDREnabled = false
        }
        if device.isFocusModeSupported(.continuousAutoFocus) { device.focusMode = .continuousAutoFocus }
        device.unlockForConfiguration()
        // A new lens meters afresh: a manual exposure in flight belonged to the old one.
        manual = nil
        stateLock.withLock {
            state.compensationEv = 0
        }
        clearExposureBias(device)
        applyExposureLock(device)

        if videoFormat {
            // Video mode: the 1080p stream, upright 9:16 like the file; no stills.
            rawType = nil
            rawSize = CGSize(width: 1080, height: 1920)
            current = lens
            logNextFrame = true
            Self.log.notice("camera \(lens.label) (\(device.localizedName)): video format")
            return format
        }

        // Raw: Bayer first (or ProRAW when asked), the other as fallback.
        photoOutput.maxPhotoQualityPrioritization = .quality
        if photoOutput.isAppleProRAWSupported { photoOutput.isAppleProRAWEnabled = format == .proRaw }
        let types = photoOutput.availableRawPhotoPixelFormatTypes
        let bayer = types.first { AVCapturePhotoOutput.isBayerRAWPixelFormat($0) }
        let proRaw = types.first { AVCapturePhotoOutput.isAppleProRAWPixelFormat($0) }
        var used = format
        rawType = format == .proRaw ? (proRaw ?? bayer) : (bayer ?? proRaw)
        if rawType == nil, format == .bayer, photoOutput.isAppleProRAWSupported {
            photoOutput.isAppleProRAWEnabled = true
            rawType = photoOutput.availableRawPhotoPixelFormatTypes.first { AVCapturePhotoOutput.isAppleProRAWPixelFormat($0) }
        }
        guard let rawType else { throw Failure(message: "this camera has no RAW") }
        used = AVCapturePhotoOutput.isAppleProRAWPixelFormat(rawType) ? .proRaw : .bayer
        if used == .bayer && photoOutput.isAppleProRAWEnabled { photoOutput.isAppleProRAWEnabled = false }
        // 12 MP stills in both formats (see RawFormat.proRaw); Bayer raws on the 48 MP sensors come binned anyway.
        if let largest = device.activeFormat.supportedMaxPhotoDimensions.max(by: { $0.width * $0.height < $1.width * $1.height }) {
            photoOutput.maxPhotoDimensions = device.activeFormat.supportedMaxPhotoDimensions
                .filter { $0.width * $0.height <= 13_000_000 }.max(by: { $0.width * $0.height < $1.width * $1.height }) ?? largest
            let d = photoOutput.maxPhotoDimensions
            rawSize = CGSize(width: Int(min(d.width, d.height)), height: Int(max(d.width, d.height)))
        }
        if #available(iOS 18.0, *) {
            shutterSoundRequired = !photoOutput.isShutterSoundSuppressionSupported
        }
        current = lens
        logNextFrame = true
        Self.log.notice("camera \(lens.label) (\(device.localizedName)): \(used.rawValue), raw \(Int(self.rawSize.width))x\(Int(self.rawSize.height))")
        return used
    }

    /**
     * Frames in the sensor's own landscape orientation, unmirrored: the viewfinder turns them upright (and mirrors the
     * selfie camera) itself, see [viewfinderRotation]. Asking the connection to do it worked for the back lenses but
     * left the selfie camera's frames sideways after a switch. Reads the connection's default `videoRotationAngle`
     * before zeroing it so [portraitCaptureAngle] works across sensor mountings (including iPhone 17 front).
     */
    private func orientConnection(front: Bool) {
        guard let c = videoOutput.connection(with: .video) else { return }
        let defaultAngle = Int(c.videoRotationAngle.rounded())
        portraitCaptureAngle = CameraOrientation.portraitAngle(fromDefaultVideoAngle: defaultAngle)
        if c.isVideoMirroringSupported {
            c.automaticallyAdjustsVideoMirroring = false
            c.isVideoMirrored = false
        }
        if c.isVideoRotationAngleSupported(0) { c.videoRotationAngle = 0 }
        Self.log.notice("viewfinder connection: default \(defaultAngle), portraitCapture \(self.portraitCaptureAngle), rotation \(c.videoRotationAngle), mirrored \(c.isVideoMirrored)")
        applyVideoStabilization()
    }

    /**
     * Look for QR codes too: AVFoundation's own detector, as the system camera's (no frames copied for it). Applied
     * now if the camera runs, else at the next start.
     */
    func setScanQr(_ on: Bool) {
        queue.async {
            self.scanQr = on
            if self.configured { self.updateMetadataTypes() }
        }
    }

    /** Faces (always, they steer exposure) and QR codes (scanQr), as far as the current camera offers them. */
    private func updateMetadataTypes() {
        let available = metadataOutput.availableMetadataObjectTypes
        let wanted: [AVMetadataObject.ObjectType] = scanQr ? [.face, .qr] : [.face]
        metadataOutput.metadataObjectTypes = wanted.filter { available.contains($0) }
    }

    /** Clockwise quarter turns from a sensor-oriented buffer to the portrait UI: the 90° AVFoundation uses. */
    static let viewfinderRotation = 1

    func stop() {
        queue.async {
            self.exposureLocked = false
            if self.session.isRunning { self.session.stopRunning() }
        }
    }

    // MARK: - Video

    /**
     * Video mode on or off: the microphone joins the session (when [audio]) so recordings carry sound, and the camera's
     * own video stabilization is applied to the viewfinder's frames (which are the video). Photos are never
     * stabilized: it crops the picture a little and delays it. Returns whether the microphone is in.
     */
    func setVideoMode(_ on: Bool, audio: Bool, stabilization: Bool) async -> Bool {
        await withCheckedContinuation { (c: CheckedContinuation<Bool, Never>) in
            queue.async {
                self.videoStabilizationOn = on && stabilization
                let hasMic = on && audio && self.setMicrophone(true)
                if !on || !hasMic { _ = self.setMicrophone(false) }
                self.applyVideoStabilization()
                c.resume(returning: hasMic)
            }
        }
    }

    /** Stabilization on or off now (a Settings switch in video mode). */
    func setVideoStabilization(_ on: Bool) {
        queue.async {
            self.videoStabilizationOn = on
            self.applyVideoStabilization()
        }
    }

    /** The microphone's input and output in or out of the session; on the queue. False when it can't be added. */
    private func setMicrophone(_ on: Bool) -> Bool {
        if on {
            if audioInput != nil { return true }
            guard let mic = AVCaptureDevice.default(for: .audio), let input = try? AVCaptureDeviceInput(device: mic) else {
                return false
            }
            session.beginConfiguration()
            defer { session.commitConfiguration() }
            guard session.canAddInput(input), session.canAddOutput(audioOutput) else { return false }
            session.addInput(input)
            session.addOutput(audioOutput)
            audioOutput.setSampleBufferDelegate(self, queue: audioQueue)
            audioInput = input
            // Both microphones, as the system camera's stereo video, where the device offers it.
            if #available(iOS 18.0, *), input.isMultichannelAudioModeSupported(.stereo) { input.multichannelAudioMode = .stereo }
        } else if let input = audioInput {
            session.beginConfiguration()
            audioOutput.setSampleBufferDelegate(nil, queue: nil)
            session.removeOutput(audioOutput)
            session.removeInput(input)
            session.commitConfiguration()
            audioInput = nil
        }
        return true
    }

    /** The recommended AAC settings for an MP4 from the microphone output; nil without the microphone. */
    func audioSettings() -> [String: Any]? {
        queue.sync { audioInput == nil ? nil : audioOutput.recommendedAudioSettingsForAssetWriter(writingTo: .mp4) as? [String: Any] }
    }

    /**
     * Video mode records at a steady 30 fps: the frame duration is pinned so the camera raises its ISO in dim light instead
     * of stretching exposures past 1/30 s and delivering fewer frames (the telephoto, with its small aperture, skipped
     * frames). Photo mode keeps the camera's default range. On the queue, after the configuration is committed.
     */
    private func applyFrameRate() {
        guard let device = input?.device else { return }
        let thirty = CMTime(value: 1, timescale: 30)
        let fits = device.activeFormat.videoSupportedFrameRateRanges.contains {
            $0.minFrameDuration <= thirty && thirty <= $0.maxFrameDuration
        }
        do {
            try device.lockForConfiguration()
            if videoFormat && fits {
                device.activeVideoMinFrameDuration = thirty
                device.activeVideoMaxFrameDuration = thirty
            } else {
                device.activeVideoMinFrameDuration = .invalid
                device.activeVideoMaxFrameDuration = .invalid
            }
            device.unlockForConfiguration()
            let d = device.activeVideoMinFrameDuration
            Self.log.notice("frame rate: pinned \(self.videoFormat && fits), min duration \(d.seconds)")
        } catch {
            Self.log.error("frame rate: \(error.localizedDescription)")
        }
    }

    /**
     * The camera's own stabilization (standard mode: a moderate crop and delay, over cinematic's larger ones) on the
     * viewfinder connection, or off. The photo stream is separate and never stabilized. On the queue.
     */
    private func applyVideoStabilization() {
        guard let c = videoOutput.connection(with: .video), let device = input?.device else { return }
        // Standard (a moderate crop and delay) where the format offers it, else the camera's own pick.
        let format = device.activeFormat
        let want: AVCaptureVideoStabilizationMode = !videoStabilizationOn ? .off
            : format.isVideoStabilizationModeSupported(.standard) ? .standard
            : format.isVideoStabilizationModeSupported(.auto) ? .auto : .off
        if c.preferredVideoStabilizationMode != want { c.preferredVideoStabilizationMode = want }
        let modes = [AVCaptureVideoStabilizationMode.off, .standard, .cinematic, .cinematicExtended, .previewOptimized, .auto].filter { device.activeFormat.isVideoStabilizationModeSupported($0) }.map(\.rawValue)
        Self.log.notice("video stabilization: format supports \(modes) on \(Int(CMVideoFormatDescriptionGetDimensions(device.activeFormat.formatDescription).width))px, asked \(self.videoStabilizationOn), preferred \(want.rawValue), active \(c.activeVideoStabilizationMode.rawValue)")
    }

    /** Exposure and white balance lock (AE/WB LOCK): exposure and white balance stay where they are until released. */
    func setExposureLock(_ locked: Bool) {
        queue.async {
            self.exposureLocked = locked
            if let device = self.input?.device { self.applyExposureLock(device) }
        }
    }

    private func applyExposureLock(_ device: AVCaptureDevice) {
        let expMode: AVCaptureDevice.ExposureMode = exposureLocked ? .locked : .continuousAutoExposure
        let wbMode: AVCaptureDevice.WhiteBalanceMode = exposureLocked ? .locked : .continuousAutoWhiteBalance
        let setExp = device.exposureMode != expMode && device.isExposureModeSupported(expMode)
        let setWb = device.whiteBalanceMode != wbMode && device.isWhiteBalanceModeSupported(wbMode)
        guard setExp || setWb else { return }
        do {
            try device.lockForConfiguration()
            if setExp { device.exposureMode = expMode }
            if setWb { device.whiteBalanceMode = wbMode }
            device.unlockForConfiguration()
        } catch {
            Self.log.error("exposure/WB lock: \(error.localizedDescription)")
        }
    }

    // MARK: - Focus

    /**
     * Tap focus: side of the AF box as a share of the short side, where the device takes a focus rectangle (5%, as
     * Android's CameraController.FOCUS_SIZE; never under the device's minimum).
     */
    static let focusSize = 0.05
    /** The metering spot's side (MeterArea.spotSize), about the focus ring and Apple's own area around a point. */
    static let spotSize = 0.16

    /**
     * Focus (and meter) at a point of the viewfinder (upright normalised, as shown) and keep it there. `follow`: a
     * tracked subject (SubjectTracker), which moves in depth too: continuous autofocus on the box instead of one
     * scan held; called again with each move. `meter` false: the tracked subject is out of sight, so exposure meters
     * the centre meanwhile (on the last spot it brightened whatever was left there).
     */
    func focusAt(_ x: Double, _ y: Double, follow: Bool = false, meter: Bool = true) {
        queue.async {
            guard let device = self.input?.device, let lens = self.current else { return }
            // Device coordinates are the sensor's landscape frame; the viewfinder shows it turned 90° (mirrored
            // for the selfie camera).
            let point = lens.isFront ? CGPoint(x: y, y: x) : CGPoint(x: y, y: 1 - x)
            do {
                try device.lockForConfiguration()
                var box = Self.spotSize
                if #available(iOS 26.0, *), device.isFocusRectOfInterestSupported {
                    // A small box, so a thin subject isn't outvoted by the background around it; exposure keeps its
                    // own (larger) area around the point.
                    let rect = Self.focusRect(around: point, device: device)
                    device.focusRectOfInterest = rect
                    box = Self.shortSideShare(rect, device: device)
                } else if device.isFocusPointOfInterestSupported {
                    device.focusPointOfInterest = point
                }
                // Faces would pull focus away from the tapped point (iOS 15.4+); back to automatic on release.
                device.automaticallyAdjustsFaceDrivenAutoFocusEnabled = false
                device.isFaceDrivenAutoFocusEnabled = false
                // Setting the mode is also what applies a new point or rectangle of interest.
                let mode: AVCaptureDevice.FocusMode = follow ? .continuousAutoFocus : .autoFocus
                if device.isFocusModeSupported(mode) { device.focusMode = mode }
                if device.isExposurePointOfInterestSupported, !self.exposureLocked {
                    device.exposurePointOfInterest = meter ? point : CGPoint(x: 0.5, y: 0.5)
                    device.exposureMode = .continuousAutoExposure
                }
                device.unlockForConfiguration()
                self.stateLock.withLock { self.state.focusBox = box }
            } catch {
                Self.log.error("focus: \(error.localizedDescription)")
            }
        }
    }

    /**
     * A box Self.focusSize of the short side around `point` (device coordinates, 0...1 across the landscape frame,
     * so a square is narrower than it is tall there), at least the device's minimum and moved inside the frame.
     */
    @available(iOS 26.0, *)
    private static func focusRect(around point: CGPoint, device: AVCaptureDevice) -> CGRect {
        let aspect = landscapeAspect(device)
        let minimum = device.minFocusRectOfInterestSize
        let w = min(1, max(CGFloat(focusSize / aspect), minimum.width))
        let h = min(1, max(CGFloat(focusSize), minimum.height))
        return CGRect(x: min(max(point.x - w / 2, 0), 1 - w), y: min(max(point.y - h / 2, 0), 1 - h), width: w, height: h)
    }

    /** The side of a square as large as [rect] (device coordinates), as a share of the short side. */
    private static func shortSideShare(_ rect: CGRect, device: AVCaptureDevice) -> Double {
        max(Double(rect.width) * landscapeAspect(device), Double(rect.height))
    }

    /** Long side over short side of the device's frames. */
    private static func landscapeAspect(_ device: AVCaptureDevice) -> Double {
        let d = CMVideoFormatDescriptionGetDimensions(device.activeFormat.formatDescription)
        return Double(max(d.width, d.height)) / Double(max(1, min(d.width, d.height)))
    }

    func releaseFocus() {
        queue.async {
            guard let device = self.input?.device else { return }
            do {
                try device.lockForConfiguration()
                let centre = CGPoint(x: 0.5, y: 0.5)
                // Also resets a focus rectangle to the default one around the centre.
                if device.isFocusPointOfInterestSupported { device.focusPointOfInterest = centre }
                device.automaticallyAdjustsFaceDrivenAutoFocusEnabled = true
                if device.isExposurePointOfInterestSupported, !self.exposureLocked { device.exposurePointOfInterest = centre }
                if device.isFocusModeSupported(.continuousAutoFocus) { device.focusMode = .continuousAutoFocus }
                device.unlockForConfiguration()
            } catch {}
        }
    }

    // MARK: - Capture

    /**
     * Takes a raw still; [onShutter] runs when the camera captures it (shutter feedback). [deviceDegrees] is how the
     * phone is held clockwise from upright portrait (0, 90, 180, 270). [gps]: ImageIO's GPS dictionary for the DNG
     * (LocationTracker.gpsMetadata), or nil. [shutterSound] false silences the system's click where that is allowed
     * (shutterSoundRequired). [exposureEv]: the Exposure setting; a still without flash at != 0 is exposed by hand
     * along ExposureProgram (flash shots keep the iPhone's flash AE, and the develop adds the whole EV).
     */
    func captureDng(flash: FlashMode, shutterSound: Bool, deviceDegrees: Int = 0, gps: [String: Any]? = nil,
                    exposureEv: Float = 0, onShutter: @escaping @Sendable () -> Void) async throws -> CaptureResult {
        try await withCheckedThrowingContinuation { (c: CheckedContinuation<CaptureResult, Error>) in
            queue.async {
                guard self.rawType != nil else {
                    c.resume(throwing: Failure(message: "camera not ready"))
                    return
                }
                // A shot in flight still holds a manual exposure: this one goes through it too (at its own EV).
                if (exposureEv != 0 || self.manual != nil) && flash == .off {
                    self.beginManualExposure(ev: exposureEv) { applied in
                        self.shoot(flash: flash, shutterSound: shutterSound, deviceDegrees: deviceDegrees, gps: gps,
                                   manualEv: applied, onShutter: onShutter, c)
                    }
                } else {
                    self.shoot(flash: flash, shutterSound: shutterSound, deviceDegrees: deviceDegrees, gps: gps,
                               manualEv: nil, onShutter: onShutter, c)
                }
            }
        }
    }

    /**
     * Takes the still now, on the queue. [manualEv]: the EV a manual exposure (beginManualExposure) gave the raw, nil
     * at AE's own exposure; a manual shot ends it when done.
     */
    private func shoot(flash: FlashMode, shutterSound: Bool, deviceDegrees: Int, gps: [String: Any]?, manualEv: Float?,
                       onShutter: @escaping @Sendable () -> Void, _ c: CheckedContinuation<CaptureResult, Error>) {
        guard let rawType = self.rawType else {
            if manualEv != nil { self.endManualExposure() }
            c.resume(throwing: Failure(message: "camera not ready"))
            return
        }
        let settings = AVCapturePhotoSettings(rawPixelFormatType: rawType)
        settings.maxPhotoDimensions = self.photoOutput.maxPhotoDimensions
        if self.current?.hasFlash == true, self.photoOutput.supportedFlashModes.contains(.on) {
            settings.flashMode = flash == .on ? .on : .off
        }
        if #available(iOS 18.0, *), self.photoOutput.isShutterSoundSuppressionSupported {
            settings.isShutterSoundSuppressionEnabled = !shutterSound
        }
        // The photo's orientation: how the phone is held, level with the horizon, relative to this sensor's
        // portrait mounting angle (avoids RotationCoordinator resetting to portrait on lens switches or tilt).
        let isFront = self.current?.isFront == true
        let angle = CGFloat(CameraOrientation.photoRotationAngle(
            portraitAngle: self.portraitCaptureAngle, deviceDegrees: deviceDegrees, isFront: isFront))
        if let connection = self.photoOutput.connection(with: .video), connection.isVideoRotationAngleSupported(angle) {
            connection.videoRotationAngle = angle
            if connection.isVideoMirroringSupported {
                connection.automaticallyAdjustsVideoMirroring = false
                connection.isVideoMirrored = isFront
            }
            Self.log.notice("capture orientation: device \(deviceDegrees)°, portrait \(self.portraitCaptureAngle)°, front \(isFront) -> angle \(Int(angle))°")
        }
        let iso = self.input?.device.iso ?? 0
        let rawDur = self.input?.device.exposureDuration.seconds ?? 0
        let exposureSeconds: Float = rawDur.isFinite && rawDur > 0 ? Float(rawDur) : 0
        let compensation = manualEv ?? 0
        let delegate = PhotoDelegate(gps: gps, onShutter: onShutter) { [weak self] result in
            self?.queue.async {
                self?.captures[settings.uniqueID] = nil
                if manualEv != nil { self?.endManualExposure() }
            }
            switch result {
            case let .success(data):
                c.resume(returning: CaptureResult(dng: data, iso: iso, exposureSeconds: exposureSeconds, compensationEv: compensation))
            case let .failure(error): c.resume(throwing: error)
            }
        }
        self.captures[settings.uniqueID] = delegate
        self.photoOutput.capturePhoto(with: settings, delegate: delegate)
    }

    /** True the first time only; used on the camera queue. */
    private final class Once: @unchecked Sendable {
        private var done = false
        func first() -> Bool {
            if done { return false }
            done = true
            return true
        }
    }

    /** One still: the DNG data, or why it failed. */
    private final class PhotoDelegate: NSObject, AVCapturePhotoCaptureDelegate, AVCapturePhotoFileDataRepresentationCustomizer {
        private let gps: [String: Any]?
        private let onShutter: @Sendable () -> Void
        private let done: (Result<Data, Error>) -> Void
        private var data: Data?

        init(gps: [String: Any]?, onShutter: @escaping @Sendable () -> Void, done: @escaping (Result<Data, Error>) -> Void) {
            self.gps = gps
            self.onShutter = onShutter
            self.done = done
        }

        /** Geotagging: the photo's own metadata plus the GPS dictionary. */
        func replacementMetadata(for photo: AVCapturePhoto) -> [String: Any]? {
            guard let gps else { return nil }
            var metadata = photo.metadata
            metadata[kCGImagePropertyGPSDictionary as String] = gps
            return metadata
        }

        func photoOutput(_ output: AVCapturePhotoOutput, willCapturePhotoFor resolvedSettings: AVCaptureResolvedPhotoSettings) {
            onShutter()
        }

        func photoOutput(_ output: AVCapturePhotoOutput, didFinishProcessingPhoto photo: AVCapturePhoto, error: Error?) {
            if photo.isRawPhoto { data = gps == nil ? photo.fileDataRepresentation() : photo.fileDataRepresentation(with: self) }
        }

        func photoOutput(_ output: AVCapturePhotoOutput, didFinishCaptureFor resolvedSettings: AVCaptureResolvedPhotoSettings,
                         error: Error?) {
            if let error {
                done(.failure(error))
            } else if let data {
                done(.success(data))
            } else {
                done(.failure(Failure(message: "no raw data")))
            }
        }
    }
}

extension CameraController: AVCaptureVideoDataOutputSampleBufferDelegate, AVCaptureAudioDataOutputSampleBufferDelegate,
    AVCaptureMetadataOutputObjectsDelegate {
    func captureOutput(_ output: AVCaptureOutput, didOutput sampleBuffer: CMSampleBuffer, from connection: AVCaptureConnection) {
        if output === audioOutput {
            onAudio?(sampleBuffer)
            return
        }
        guard let buffer = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
        if let device = input?.device {
            // As-shot white for the live develop, from the camera's current white balance.
            let gains = device.deviceWhiteBalanceGains
            let max = device.maxWhiteBalanceGain
            let clamped = AVCaptureDevice.WhiteBalanceGains(
                redGain: min(Swift.max(gains.redGain, 1), max), greenGain: min(Swift.max(gains.greenGain, 1), max),
                blueGain: min(Swift.max(gains.blueGain, 1), max))
            let xy = device.chromaticityValues(for: clamped)
            let iso = device.iso
            let rawDur = device.exposureDuration.seconds
            let exposureSeconds: Float = rawDur.isFinite && rawDur > 0 ? Float(rawDur) : 0
            let focusing = device.isAdjustingFocus
            let format = device.activeFormat
            let isoRange = format.minISO...Swift.max(format.minISO, format.maxISO)
            let expMin = Int64((format.minExposureDuration.seconds * 1e9).rounded(.up))
            let expMax = Swift.max(expMin, Int64((format.maxExposureDuration.seconds * 1e9).rounded(.down)))
            stateLock.withLock {
                state.isoRange = isoRange
                state.exposureRangeNs = expMin...expMax
                state.whiteXY = [Double(xy.x), Double(xy.y)]
                state.iso = iso
                state.exposureSeconds = exposureSeconds
                state.focusing = focusing
            }
        }
        if logNextFrame {
            logNextFrame = false
            let w = CVPixelBufferGetWidth(buffer)
            let h = CVPixelBufferGetHeight(buffer)
            Self.log.notice("first frame \(w)x\(h)")
            if h > w {
                // Defensive safeguard: if the sensor delivers an upright portrait buffer at rotation 0 (iPhone 17
                // front) even if a connection was reused with angle 0, ensure portraitCaptureAngle stays 0.
                let deviceId = input?.device.uniqueID
                queue.async {
                    guard self.current?.deviceId == deviceId, self.portraitCaptureAngle % 180 != 0 else { return }
                    self.portraitCaptureAngle = 0
                    Self.log.notice("corrected portraitCaptureAngle to 0 from portrait frame \(w)x\(h)")
                }
            }
        }
        onFrame?(buffer, CMSampleBufferGetPresentationTimeStamp(sampleBuffer))
    }

    func metadataOutput(_ output: AVCaptureMetadataOutput, didOutput objects: [AVMetadataObject],
                        from connection: AVCaptureConnection) {
        let front = current?.isFront == true
        if let qr = objects.lazy.compactMap({ ($0 as? AVMetadataMachineReadableCodeObject)?.stringValue }).first {
            onQr?(qr)
        }
        // Face bounds are in the sensor's landscape frame (0..1); turn them upright as shown.
        let faces = objects.compactMap { ($0 as? AVMetadataFaceObject)?.bounds }.map { b -> CGRect in
            let x = 1 - b.maxY
            return CGRect(x: front ? 1 - x - b.height : x, y: b.minX, width: b.height, height: b.width)
        }
        stateLock.withLock { state.faces = faces }
    }
}
