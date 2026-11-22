@preconcurrency import AVFoundation
import CoreMedia
import Foundation
import os
import RawBoyEngine

/**
 * One video file: the viewfinder's developed frames ([sink], drawn by the renderer) as HEVC (H.264 where HEVC isn't
 * offered) plus the microphone's AAC, written to a temporary MP4 by AVAssetWriter. The picture already carries the
 * look; nothing here knows about colour except that the frames are tagged BT.709. Port of Android's VideoRecorder.
 *
 * Time: video frames carry the camera's presentation time and the audio comes from the same capture session's clock,
 * so the writer's session starts at the first video frame and audio before it is dropped.
 */
final class VideoRecorder: @unchecked Sendable {
    /** 1080p, portrait: the frames are always drawn upright, a phone held sideways is the file's transform. */
    static let size = (long: 1920, short: 1080)
    private static let log = Logger(subsystem: "app.rawboy", category: "RawBoyVideo")

    struct Failure: LocalizedError {
        let message: String
        var errorDescription: String? { message }
    }

    let sink: VideoSink
    let url: URL
    /** The file's name without extension (`VID_<date>_<time>-camera`). */
    let name: String
    private let writer: AVAssetWriter
    private let videoInput: AVAssetWriterInput
    private let adaptor: AVAssetWriterInputPixelBufferAdaptor
    private let audioInput: AVAssetWriterInput?
    private let lock = NSLock()
    private var sessionStarted = false
    private var firstTime = CMTime.invalid
    private var lastTime = CMTime.invalid
    private var framesWritten = 0
    private var notReady = 0
    private var outOfOrder = 0
    private var stopped = false
    private var failureValue: String?

    var hasAudio: Bool { audioInput != nil }

    /** Set once the writer failed (disk full, encoder error): the recording should be stopped and what exists kept. */
    var failure: String? { lock.withLock { failureValue } }

    /**
     * [degrees] is the phone's rotation (clockwise from portrait) when recording starts: the frames are always drawn
     * upright as portrait 1080 x 1920, and the file's transform turns them back for a phone held sideways, as the
     * system camera's own videos are. [bitrate] in bit/s (VideoQuality). [audioSettings]: the microphone output's recommended writer settings, or nil
     * for a silent video.
     */
    init(name: String, bitrate: Int, degrees: Int, audioSettings: [String: Any]?) throws {
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent("RawBoyVideo", isDirectory: true)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        url = folder.appendingPathComponent(name + ".mp4")
        try? FileManager.default.removeItem(at: url)
        self.name = name
        let width = Self.size.short
        let height = Self.size.long
        sink = VideoSink(width: width, height: height)
        writer = try AVAssetWriter(outputURL: url, fileType: .mp4)

        func settings(_ codec: AVVideoCodecType) -> [String: Any] {
            var compression: [String: Any] = [
                AVVideoAverageBitRateKey: bitrate,
                AVVideoExpectedSourceFrameRateKey: 30,
                AVVideoMaxKeyFrameIntervalKey: 60,
                AVVideoAllowFrameReorderingKey: true,
            ]
            if codec == .h264 { compression[AVVideoProfileLevelKey] = AVVideoProfileLevelH264HighAutoLevel }
            return [
                AVVideoCodecKey: codec,
                AVVideoWidthKey: width,
                AVVideoHeightKey: height,
                AVVideoColorPropertiesKey: [
                    AVVideoColorPrimariesKey: AVVideoColorPrimaries_ITU_R_709_2,
                    AVVideoTransferFunctionKey: AVVideoTransferFunction_ITU_R_709_2,
                    AVVideoYCbCrMatrixKey: AVVideoYCbCrMatrix_ITU_R_709_2,
                ],
                AVVideoCompressionPropertiesKey: compression,
            ]
        }
        let hevc = settings(.hevc)
        let chosen = writer.canApply(outputSettings: hevc, forMediaType: .video) ? hevc : settings(.h264)
        videoInput = AVAssetWriterInput(mediaType: .video, outputSettings: chosen)
        videoInput.expectsMediaDataInRealTime = true
        videoInput.transform = Self.transform(degrees: degrees, width: width, height: height)
        adaptor = AVAssetWriterInputPixelBufferAdaptor(
            assetWriterInput: videoInput,
            sourcePixelBufferAttributes: [
                kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
                kCVPixelBufferWidthKey as String: width,
                kCVPixelBufferHeightKey as String: height,
            ])
        guard writer.canAdd(videoInput) else { throw Failure(message: "the video encoder can't be set up") }
        writer.add(videoInput)

        if let audioSettings, writer.canApply(outputSettings: audioSettings, forMediaType: .audio) {
            let input = AVAssetWriterInput(mediaType: .audio, outputSettings: audioSettings)
            input.expectsMediaDataInRealTime = true
            if writer.canAdd(input) {
                writer.add(input)
                audioInput = input
            } else {
                audioInput = nil
            }
        } else {
            audioInput = nil
        }
        guard writer.startWriting() else {
            throw Failure(message: writer.error?.localizedDescription ?? "the file can't be written")
        }
        sink.onFrame = { [weak self] buffer, time in self?.appendVideo(buffer, time) }
        Self.log.notice("recording \(name): \(self.writer.status.rawValue), audio \(self.audioInput != nil), \(bitrate / 1_000_000) Mbit/s")
    }

    /**
     * The file's rotation for a phone held at [degrees] clockwise from portrait: the frames are portrait, so a phone
     * turned clockwise needs them turned back anticlockwise to look upright. Written with the translation that keeps
     * the turned frame at the origin, as a camera's own files carry it.
     */
    static func transform(degrees: Int, width: Int, height: Int) -> CGAffineTransform {
        let w = CGFloat(width)
        let h = CGFloat(height)
        switch ((degrees % 360) + 360) % 360 {
        case 90: return CGAffineTransform(a: 0, b: -1, c: 1, d: 0, tx: 0, ty: w)
        case 180: return CGAffineTransform(a: -1, b: 0, c: 0, d: -1, tx: w, ty: h)
        case 270: return CGAffineTransform(a: 0, b: 1, c: -1, d: 0, tx: h, ty: 0)
        default: return .identity
        }
    }

    private func appendVideo(_ buffer: CVPixelBuffer, _ time: CMTime) {
        lock.lock()
        defer { lock.unlock() }
        guard !stopped, failureValue == nil, writer.status == .writing else {
            if writer.status == .failed, failureValue == nil {
                failureValue = writer.error?.localizedDescription ?? "the video encoder failed"
            }
            return
        }
        if !sessionStarted {
            writer.startSession(atSourceTime: time)
            sessionStarted = true
            firstTime = time
        }
        // Frames arrive in order; a repeated or earlier time would fail the writer.
        if lastTime.isValid, time <= lastTime { outOfOrder += 1; return }
        guard videoInput.isReadyForMoreMediaData else { notReady += 1; return }
        if adaptor.append(buffer, withPresentationTime: time) {
            lastTime = time
            framesWritten += 1
        } else if writer.status == .failed {
            failureValue = writer.error?.localizedDescription ?? "the video encoder failed"
        }
    }

    /** A microphone buffer (audio queue). Dropped before the first video frame and while the writer is busy. */
    func appendAudio(_ sample: CMSampleBuffer) {
        lock.lock()
        defer { lock.unlock() }
        guard let audioInput, !stopped, sessionStarted, writer.status == .writing else { return }
        guard CMSampleBufferGetPresentationTimeStamp(sample) >= firstTime else { return }
        if audioInput.isReadyForMoreMediaData { audioInput.append(sample) }
    }

    /**
     * Ends the file. Returns its URL, or nil when nothing was recorded (the file is deleted). A recording the writer
     * lost part of through a failure is still finished, and kept when it has frames.
     */
    func stop() async -> URL? {
        let wrote: Bool = lock.withLock {
            stopped = true
            sink.onFrame = nil
            Self.log.notice("recording ended: \(self.framesWritten) frames written, \(self.sink.framesSent) sent, \(self.sink.framesDropped) dropped (no free buffer), \(self.notReady) skipped (encoder busy), \(self.outOfOrder) out of order")
            return sessionStarted && framesWritten > 0
        }
        guard wrote else {
            writer.cancelWriting()
            try? FileManager.default.removeItem(at: url)
            return nil
        }
        lock.withLock {
            videoInput.markAsFinished()
            audioInput?.markAsFinished()
        }
        await writer.finishWriting()
        if writer.status == .completed { return url }
        Self.log.error("video not finished: \(self.writer.error?.localizedDescription ?? "unknown")")
        try? FileManager.default.removeItem(at: url)
        return nil
    }
}
