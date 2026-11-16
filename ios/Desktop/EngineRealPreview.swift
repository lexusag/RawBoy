import CoreGraphics
import Foundation
import RawBoyEngine
import ViewerImaging
import enum RawBoyBrowseKit.PhotoFileType
import struct RawBoyBrowseKit.Size2D

/**
 * Browse mode's real preview (the R key, and Compare): a raw developed by RawBoy's own engine as shot, so the picture is the
 * one Pro opens, instead of Core Image's CIRAWFilter. The engine's decode and Metal develop are the export path's
 * (`Exporter.renderCGImage`: full-resolution bands developed on the GPU, area-downscaled to the requested size), with the
 * as-shot defaults and no edits, so nothing in a sidecar changes it; a sidecar's orientation is applied afterwards, as
 * for every other kind (`ImageLoader.oriented`), never twice.
 *
 * One develop at a time (`gate`): a raw decodes to half floats (6 bytes a pixel), and the GPU developer is kept between
 * requests, then dropped when idle. Called off the main thread by `ImageStore`, which also drops what a newer photo
 * made stale. Anything it can't do (not a raw, a raw the engine refuses, no GPU) goes to [fallback]: Core Image.
 */
struct EngineRealPreview: RealPreviewProvider {
    var fallback: any RealPreviewProvider = CoreImageRealPreview()

    func develop(_ url: URL, maxPixelSize: Int?, orientation: Int?) -> LoadedImage? {
        guard PhotoFileType(fileName: url.lastPathComponent) == .raw else {
            return fallback.develop(url, maxPixelSize: maxPixelSize, orientation: orientation)
        }
        if let image = Self.developed(url, maxPixelSize: maxPixelSize, orientation: orientation) { return image }
        return fallback.develop(url, maxPixelSize: maxPixelSize, orientation: orientation)
    }

    // MARK: One at a time

    private static let gate = NSLock()
    private nonisolated(unsafe) static var gpu: ExportGpu?
    private nonisolated(unsafe) static var release: DispatchWorkItem?

    /** The engine's developer is kept this long after the last request. */
    private static let idleSeconds = 20.0

    /** [url] developed as shot (nil when the engine can't), long side at most [maxPixelSize], turned as [orientation] says. */
    static func developed(_ url: URL, maxPixelSize: Int?, orientation: Int?) -> LoadedImage? {
        gate.lock()
        defer { gate.unlock() }
        release?.cancel()
        defer { scheduleRelease() }
        guard let image = try? RawImage.open(url: url) else { return nil }
        defer { image.close() }
        if Task.isCancelled { return nil }
        let defaults = PhotoSession.asShotDefaults(image)
        let params = ShaderParams.from(defaults, asShot: defaults, lut: nil, lens: LensTransform(info: image.lens, params: defaults),
                                       base: image.createPreview(maxDimension: PhotoSession.baseMaxDimension), bloomSources: nil,
                                       skinMask: nil)
        let shared = gpu ?? ExportGpu()
        gpu = shared
        guard let cg = try? Exporter().renderCGImage(image, params: params, maxLongSide: maxPixelSize, gpu: shared) else { return nil }
        let fullSize = ImageLoader.fullSize(of: url) ?? Size2D(width: Double(params.lens.outputWidth), height: Double(params.lens.outputHeight))
        let developed = LoadedImage(cgImage: ImageLoader.displayReady(cg), fullSize: fullSize, isFullResolution: maxPixelSize == nil)
        return ImageLoader.oriented(developed, url: url, orientation: orientation)
    }

    private static func scheduleRelease() {
        let work = DispatchWorkItem {
            gate.lock()
            gpu = nil
            gate.unlock()
        }
        release = work
        DispatchQueue.global(qos: .utility).asyncAfter(deadline: .now() + idleSeconds, execute: work)
    }
}
