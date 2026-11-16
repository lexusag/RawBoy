import Foundation
import os

/** Everything learned from a photo once; enough to render it small and to export it. */
public struct Analysis: @unchecked Sendable {
    public let defaults: DevelopParams
    public let autoBase: DevelopParams
    public let stats: SceneStats
    public let lens: LensInfo
    public let base: PreviewImage
    public let bloom: BloomSources
    public let skin: SkinMask?
    /**
     * The auto develop as measured, even where [autoBase] isn't it ([asIs]): its denoise, colour denoise and sharpening are
     * what Auto denoise gives a photo added "As is".
     */
    public let measured: DevelopParams

    /**
     * Auto's "As is" import (web's plain): the same analysis without the auto develop, so the photo starts as the file
     * itself ([autoBase] = the as-shot [defaults]); [measured] keeps the auto develop for Auto denoise.
     */
    public func asIs() -> Analysis {
        Analysis(defaults: defaults, autoBase: defaults, stats: stats, lens: lens, base: base, bloom: bloom, skin: skin,
                 measured: measured)
    }
}

/** The automatic develop of one raw, shared by RawBoy Auto and RawBoy Camera. */
public enum AutoAnalysis {
    /** Category of the per-photo stats log, used for recalibrating the auto develop. */
    private static let log = Logger(subsystem: "app.rawboy", category: "RawBoyAuto")

    /**
     * Decodes [url], keeps its small whole-image copies and works out the auto develop.
     * Blocking and memory hungry (a full-resolution decode): call from a background task, one at a time.
     * [onPreview], if given, gets the detail view's preview (PhotoSession.previewMaxDimension) made from the same
     * decode, so RawBoy Auto can show the photo before decoding it again.
     */
    public static func analyze(_ url: URL, cache: AnalysisCache? = nil, detectSkin: Bool = true, onPreview: ((PreviewImage) -> Void)? = nil) throws -> Analysis {
        // A snapshot of this very file (same path, size and modified time) from an earlier run: no decode, no preview.
        // Without skin detection nothing is read from or written to the cache (its snapshots hold the skin mask).
        let key = detectSkin ? cache?.key(for: url) : nil
        if let key, let s = cache?.get(key) { return restore(s, url.lastPathComponent) }
        // The raw is closed before segmentation, which needs only the 512 px copy.
        let img = try RawImage.open(url: url)
        onPreview?(img.createPreview(maxDimension: PhotoSession.previewMaxDimension))
        let copies = copiesOf(img)
        let info = Info.of(img, auto: true)
        let white = (img.displayReferred, img.clipLevel)
        img.close()
        let skin = segment(copies.0, detectSkin)
        if let key {
            cache?.put(key, AnalysisSnapshot(base: copies.0, halo: copies.1.halo, tail: copies.1.tail, lens: info.lens, iso: info.iso,
                                             temperature: info.defaults.temperature, tint: info.defaults.tint,
                                             displaySource: white.0, clipLevel: white.1, cameraMetered: info.cameraMetered,
                                             noise: info.noise, skin: skin, skinDone: true))
        }
        return finish(copies.0, copies.1, info, url.lastPathComponent, skin)
    }

    /** The analysis of a cached [snapshot]: what decoding the file would give, without decoding it. */
    static func restore(_ s: AnalysisSnapshot, _ label: String) -> Analysis {
        var defaults = DevelopParams()
        defaults.temperature = s.temperature
        defaults.tint = s.tint
        defaults.displaySource = s.displaySource
        defaults.clipLevel = s.clipLevel
        let info = Info(lens: s.lens, iso: s.iso, defaults: defaults, cameraMetered: s.cameraMetered, noise: s.noise)
        return finish(s.base, BloomSources(halo: s.halo, tail: s.tail), info, label, s.skin)
    }

    /**
     * The same for an already decoded [image] (kept open, e.g. to export it next). Blocking.
     * [noiseIsoScale]: see AutoTone.develop. [fallbackIso] is used when the file has no ISO (e.g. from the capture).
     * [detectSkin] false skips skin detection (face metering, skin retouch): the camera saw no face.
     * [meter]: see SceneAnalyzer.analyze. [phoneAe]: RawBoy Camera's raw, exposed by the phone's auto exposure (see
     * AutoTone.exposure); [captureEv]: the AE compensation it was shot with (see AutoTone.exposure).
     * [splitLuma]: see AutoTone.noiseSettings (Camera turns it off).
     */
    public static func analyze(_ image: RawImage, label: String, noiseIsoScale: Float = 1, fallbackIso: Float = 0,
                               detectSkin: Bool = true, meter: MeterArea? = nil, phoneAe: Bool = false,
                               captureEv: Float = 0, splitLuma: Bool = true) -> Analysis {
        let start = Date()
        let (base, bloom) = copiesOf(image)
        log.notice("small copies: \(Int(Date().timeIntervalSince(start) * 1000)) ms")
        var info = Info.of(image)
        if info.iso <= 0 { info = Info(lens: info.lens, iso: fallbackIso, defaults: info.defaults) }
        info.phoneAe = phoneAe
        info.captureEv = captureEv
        return analyze(base, bloom, info, label, noiseIsoScale, detectSkin, meter, splitLuma)
    }

    /**
     * [cameraMetered]: see AutoTone.cameraMetered; [noise]: the measured noise, only Auto's (Camera keeps its ISO-based
     * denoise, which has no time cost per shot); [phoneAe]: see AutoTone.exposure.
     */
    private struct Info {
        let lens: LensInfo
        let iso: Float
        let defaults: DevelopParams
        var cameraMetered = false
        var noise = NoiseLevel.none
        var phoneAe = false
        var captureEv: Float = 0

        static func of(_ img: RawImage, auto: Bool = false) -> Info {
            Info(lens: img.lens, iso: img.iso, defaults: PhotoSession.asShotDefaults(img),
                 cameraMetered: auto && AutoTone.cameraMetered(make: img.make, baselineExposure: img.baselineExposure),
                 noise: auto ? img.measureNoise() : .none)
        }
    }

    /**
     * The auto develop alone, for a photo already open elsewhere (RawBoy Pro's Auto button): [base] is its 512 px copy,
     * [skin] its skin mask (nil: no face metering), [noise] its measured noise. Fast; no decode or segmentation.
     */
    public static func autoBase(_ base: PreviewImage, skin: SkinMask?, iso: Float, defaults: DevelopParams,
                                cameraMetered: Bool, noise: NoiseLevel = .none) -> DevelopParams {
        develop(base, skin, iso, defaults, 1, cameraMetered, nil, noise).1
    }

    private static func develop(_ base: PreviewImage, _ skin: SkinMask?, _ iso: Float, _ defaults: DevelopParams,
                                _ noiseIsoScale: Float, _ cameraMetered: Bool,
                                _ meter: MeterArea?, _ noise: NoiseLevel = .none,
                                _ phoneAe: Bool = false, _ captureEv: Float = 0,
                                _ splitLuma: Bool = true) -> (SceneStats, DevelopParams) {
        let stats = SceneAnalyzer.analyze(base, skin: skin, iso: iso, meter: meter)
        return (stats, AutoTone.develop(stats, asShot: defaults, noiseIsoScale: noiseIsoScale, cameraMetered: cameraMetered,
                                        noise: noise, phoneAe: phoneAe, captureEv: captureEv, splitLuma: splitLuma))
    }

    private static func copiesOf(_ img: RawImage) -> (PreviewImage, BloomSources) {
        let base = img.createPreview(maxDimension: PhotoSession.baseMaxDimension)
        img.lens.fisheyeCircle = FisheyeCircle.detect(base)
        return (base, PhotoSession.bloomSourcesOf(img))
    }

    /** Skin detection on the 512 px copy; it can fail, and the photo is then just treated as having no face. */
    private static func segment(_ base: PreviewImage, _ detectSkin: Bool) -> SkinMask? {
        let start = Date()
        let skin = detectSkin ? try? SkinSegmenter.segment(base, fullWidth: base.fullWidth, fullHeight: base.fullHeight) : nil
        log.notice("skin detection: \(Int(Date().timeIntervalSince(start) * 1000)) ms")
        return skin
    }

    private static func analyze(_ base: PreviewImage, _ bloom: BloomSources, _ info: Info, _ label: String,
                                _ noiseIsoScale: Float = 1, _ detectSkin: Bool = true,
                                _ meter: MeterArea? = nil, _ splitLuma: Bool = true) -> Analysis {
        finish(base, bloom, info, label, segment(base, detectSkin), noiseIsoScale, meter, splitLuma)
    }

    private static func finish(_ base: PreviewImage, _ bloom: BloomSources, _ info: Info, _ label: String, _ skin: SkinMask?,
                               _ noiseIsoScale: Float = 1, _ meter: MeterArea? = nil, _ splitLuma: Bool = true) -> Analysis {
        let defaults = info.defaults
        let (stats, auto) = develop(base, skin, info.iso, defaults, noiseIsoScale, info.cameraMetered, meter, info.noise,
                                    info.phoneAe, info.captureEv, splitLuma)
        log.notice("""
            analysis \(label): key=\(stats.key) p1=\(stats.p1) p5=\(stats.p5) p50=\(stats.p50) p98=\(stats.p98) \
            p99=\(stats.p99) clipped=\(stats.clipped) chroma=\(stats.chroma) face=\(stats.faceArea) \
            skin=\(stats.skinLuminance) iso=\(info.iso) cameraMetered=\(info.cameraMetered) phoneAe=\(info.phoneAe) \
            noise=\(info.noise.luma)/\(info.noise.chroma) -> exposure=\(auto.exposure) \
            hl=\(auto.highlights) sh=\(auto.shadows) contrast=\(auto.contrast) \
            denoise=\(auto.denoise)/\(auto.colorDenoise.map { "\($0)" } ?? "-") \
            wb=\(Int(defaults.temperature))K/\(Int(defaults.tint)) -> \(Int(auto.temperature))K/\(Int(auto.tint))
            """)
        return Analysis(defaults: defaults, autoBase: auto, stats: stats, lens: info.lens, base: base, bloom: bloom,
                        skin: skin, measured: auto)
    }
}
