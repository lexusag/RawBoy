import CoreGraphics
import Foundation
import os
#if !canImport(MediaPipeTasksVision)
import Vision

/**
 * macOS (RawBoy Desktop): MediaPipe Tasks ships no macOS slice, so the skin mask is built from Apple's Vision framework
 * (no third-party code, nothing bundled). What differs from MediaPipe's (iOS, Android, web):
 *  - There is no skin-class segmentation model. The face's skin is the polygon of Vision's face contour (jaw and
 *    temples, 17 points) plus a forehead cap above the eyebrows, minus the eyes, eyebrows, lips and nostrils (the same
 *    exclusions the web makes, from Vision's 76 landmarks instead of the 478-point mesh). The forehead cap's top is
 *    an estimate (Vision has no hairline), so it is cut back by a skin-colour model sampled from the face itself.
 *  - Body skin (neck, arms, hands) is found by that same colour model inside Vision's person mask, at 0.85 weight and
 *    only where the tone is close to the face's: a tan or pink garment, or brown hair next to the face, can be taken for
 *    skin, and skin of a very different tone to the face's (a hand in shadow) is missed. MediaPipe's trained classes
 *    don't have this weakness.
 *  - Faces are found by Vision's face detector (rev 3): about the same recall on frontal and three-quarter faces, weaker
 *    on small faces (the mask is made on a 1280 px copy) and profiles.
 * Everything downstream (skin smoothing, blemish detection, Portrait retouch) takes the mask as it comes.
 */
public enum SkinSegmenter {
    private static let logger = Logger(subsystem: "app.rawboy", category: "RawBoy")
    private static let lock = NSLock()

    /** The long side the mask is made at (PhotoSession hands it a copy that size). */
    public static let preferredDimension = 1280

    /** [image]: the small linear Rec.2020 copy of the photo; [fullWidth]/[fullHeight]: full-resolution size. */
    public static func segment(_ image: PreviewImage, fullWidth: Int, fullHeight: Int) throws -> SkinMask {
        lock.lock()
        defer { lock.unlock() }
        let start = Date()
        let w = image.width, h = image.height
        // The face detector wants an ordinary-looking picture: a dark scene auto-exposed to middle grey blows a lit face out,
        // so brighter-to-darker exposures are tried until it finds a face.
        let scene = try Scene(image)
        var rgb = [Float]()
        var cg: CGImage?
        var observations: [VNFaceObservation] = []
        for k in scene.exposures {
            let (c, p) = try scene.render(k)
            let request = VNDetectFaceLandmarksRequest()
            try VNImageRequestHandler(cgImage: c, orientation: .up).perform([request])
            if let found = request.results, !found.isEmpty {
                (cg, rgb, observations) = (c, p, found)
                break
            }
        }
        let personRequest = VNGeneratePersonSegmentationRequest()
        personRequest.qualityLevel = .accurate
        personRequest.outputPixelFormat = kCVPixelFormatType_OneComponent8
        if let cg, !observations.isEmpty { try VNImageRequestHandler(cgImage: cg, orientation: .up).perform([personRequest]) }
        let tFound = Date()
        let shapes = observations.compactMap { Face(observation: $0, width: w, height: h) }
        guard !shapes.isEmpty else {
            logger.debug("Vision: no face found")
            return SkinMask(width: w, height: h, data: [Float](repeating: 0, count: w * h), sigmaPx: 3, hasSkin: false,
                            faceDiameterPx: 0)
        }

        // Face: contour polygon (+ forehead cap cut back by colour), features carved out.
        var core = [Float](repeating: 0, count: w * h)
        var cap = [Float](repeating: 0, count: w * h)
        var keep = [Float](repeating: 1, count: w * h)
        for f in shapes {
            PortraitRetouch.fillPolygon(&core, w, h, f.contour)
            PortraitRetouch.fillPolygon(&cap, w, h, f.forehead)
            for feature in f.features { PortraitRetouch.fillPolygon(&keep, w, h, feature, value: 0) }
        }
        // Soften the cut so smoothing fades out instead of stopping at a hard line.
        let soft = Filters.box(keep, w, h, 1)

        // The face's own skin tone (chroma and brightness of the inside, away from the features and the rims), and
        // from it how skin-like each pixel is.
        let tone = SkinTone(rgb, w, h, region: core, keep: keep)
        let likeness = tone?.likeness(rgb, w, h)
        var face = [Float](repeating: 0, count: w * h)
        for i in face.indices {
            let capped = cap[i] * PortraitRetouch.smoothstep(0.25, 0.6, likeness?[i] ?? 1)
            face[i] = min(1, max(core[i], capped)) * soft[i]
        }
        // Edges snap to the photo (jaw, hairline), as the web's guided filter does for the model's mask.
        // Typed loop: the one-line map timed out the type checker on CI's Xcode.
        var gray = [Float](repeating: 0, count: w * h)
        for i in gray.indices {
            let r: Float = rgb[i * 3], g: Float = rgb[i * 3 + 1], b: Float = rgb[i * 3 + 2]
            gray[i] = 0.2126 * r + 0.7152 * g + 0.0722 * b
        }
        face = guidedFilter(gray, face, w, h, radius: 3, eps: 1e-3)

        var body = [Float](repeating: 0, count: w * h)
        if let person = personRequest.results?.first?.pixelBuffer, let likeness {
            let pm = read(person, w, h)
            for i in body.indices where face[i] < 0.5 && pm[i] > 0.5 { body[i] = pm[i] * PortraitRetouch.smoothstep(0.25, 0.6, likeness[i]) * 0.85 * soft[i] }
        }

        var skin = [Float](repeating: 0, count: w * h)
        var faceArea = 0.0, skinArea = 0.0
        for i in skin.indices {
            skin[i] = min(max(face[i] + body[i], 0), 1)
            if face[i] > 0.5 { faceArea += 1 }
            skinArea += Double(skin[i])
        }
        logger.debug("skin (Vision): \(shapes.count) face(s), faces \(Int(tFound.timeIntervalSince(start) * 1000)) ms, mask \(Int(Date().timeIntervalSince(tFound) * 1000)) ms")

        // Smoothing scale from the face size: ~1.2% of the face diameter.
        let scale = Double(fullWidth) / Double(w)
        let longEdge = Double(max(fullWidth, fullHeight))
        let faceDiameter = faceArea > 4 ? 2 * (faceArea / .pi).squareRoot() * scale : 0
        let sigma = faceArea > 4 ? min(max(0.012 * faceDiameter, 3), 40) : min(max(0.002 * longEdge, 3), 40)
        return SkinMask(width: w, height: h, data: skin, sigmaPx: Float(sigma), hasSkin: skinArea > 0.002 * Double(w * h),
                        faceDiameterPx: Float(faceDiameter), face: face, faces: shapes.map(\.shape))
    }

    // MARK: - Faces

    /** One detected face: polygons in pixels of the mask, and the anchors Portrait retouch needs. */
    struct Face {
        var contour: [(Float, Float)]
        /** The forehead cap above the contour's ends. */
        var forehead: [(Float, Float)]
        /** Polygons to keep out of the skin: eyes, eyebrows, lips, nostrils. */
        var features: [[(Float, Float)]]
        var shape: FaceShape

        init?(observation o: VNFaceObservation, width w: Int, height h: Int) {
            guard let lm = o.landmarks, let contourPts = lm.faceContour, contourPts.pointCount >= 5 else { return nil }
            let box = o.boundingBox
            /// Landmark points in fractions of the image, y down.
            func pts(_ r: VNFaceLandmarkRegion2D?) -> [SIMD2<Float>] {
                (r?.normalizedPoints ?? []).map {
                    SIMD2(Float(box.minX + $0.x * box.width), Float(1 - (box.minY + $0.y * box.height)))
                }
            }
            let W = Float(w), H = Float(h)
            func px(_ p: [SIMD2<Float>]) -> [(Float, Float)] { p.map { ($0.x * W, $0.y * H) } }
            let contour = pts(contourPts)
            let leftEye = pts(lm.leftEye), rightEye = pts(lm.rightEye)
            let leftBrow = pts(lm.leftEyebrow), rightBrow = pts(lm.rightEyebrow)
            let nose = pts(lm.nose), lips = pts(lm.outerLips), inner = pts(lm.innerLips)
            guard leftEye.count >= 4, rightEye.count >= 4, leftBrow.count >= 3, rightBrow.count >= 3, lips.count >= 4,
                  !nose.isEmpty else { return nil }

            // Face "up": from the chin to the point between the brows; its length scales the forehead and the line areas.
            let chin = contour.max { $0.y < $1.y }!
            let browPoints = leftBrow + rightBrow
            let eyeCentre = (leftEye + rightEye).reduce(SIMD2<Float>.zero, +) / Float(leftEye.count + rightEye.count)
            let browCentre = browPoints.reduce(SIMD2<Float>.zero, +) / Float(browPoints.count)
            // The brows' inner ends: each brow's point nearest the other brow.
            let lc = leftBrow.reduce(SIMD2<Float>.zero, +) / Float(leftBrow.count)
            let rc = rightBrow.reduce(SIMD2<Float>.zero, +) / Float(rightBrow.count)
            let innerL = leftBrow.min { simd_distance($0, rc) < simd_distance($1, rc) }!
            let innerR = rightBrow.min { simd_distance($0, lc) < simd_distance($1, lc) }!
            let glabella = (innerL + innerR) / 2
            let up = glabella - chin
            let upLen = max(simd_length(up), 1e-6)
            let upDir = up / upLen

            // Forehead cap: a half-ellipse over the contour's two end points, ~0.5 of the eye-to-chin distance tall.
            let a = contour.first!, b = contour.last!
            let mid = (a + b) / 2
            let half = simd_distance(a, b) / 2
            let eyeToChin = max(simd_distance(eyeCentre, chin), 1e-6)
            let along = (b - a) / max(simd_length(b - a), 1e-6)
            var cap: [SIMD2<Float>] = []
            for k in 0...12 {
                let t = Float(Double.pi) * Float(k) / 12
                cap.append(mid + along * (half * cosf(t)) + upDir * (0.5 * eyeToChin * sinf(t)))
            }
            self.contour = px(contour)
            self.forehead = px(cap)

            func grown(_ p: [SIMD2<Float>], _ k: Float, extra: Float = 0) -> [(Float, Float)] {
                let c = p.reduce(SIMD2<Float>.zero, +) / Float(p.count)
                return px(p.map { c + ($0 - c) * k + simd_normalize($0 - c + 1e-6) * extra })
            }
            // Eyes and brows a little larger than their outline (lids, shadow, lashes), lips with their rim; nostrils: the
            // lower part of the nose, where the wings and nostrils are.
            let noseTop = nose.min { $0.y < $1.y }!
            let noseLow = nose.filter { $0.y >= noseTop.y + (nose.map(\.y).max()! - noseTop.y) * 0.4 }
            // A brow is an open line of points: given a thickness (0.05 of the face width each side) to be a polygon.
            func thick(_ line: [SIMD2<Float>], _ half: Float) -> [(Float, Float)] {
                let sorted = line.sorted { $0.x < $1.x }
                var left: [SIMD2<Float>] = [], right: [SIMD2<Float>] = []
                for i in sorted.indices {
                    let a = sorted[max(i - 1, 0)], b = sorted[min(i + 1, sorted.count - 1)]
                    let d = simd_normalize(b - a + SIMD2(1e-6, 0))
                    let n = SIMD2(-d.y, d.x) * half
                    left.append(sorted[i] + n)
                    right.append(sorted[i] - n)
                }
                return px(left + right.reversed())
            }
            let faceWidth = (contour.map(\.x).max() ?? 0) - (contour.map(\.x).min() ?? 0)
            self.features = [grown(leftEye, 1.6), grown(rightEye, 1.6), thick(leftBrow, 0.05 * faceWidth),
                             thick(rightBrow, 0.05 * faceWidth), grown(lips, 1.18), grown(inner, 1.2),
                             grown(noseLow.count >= 3 ? noseLow : nose, 1.35)]

            // Anchors for Portrait retouch.
            func lowerLid(_ eye: [SIMD2<Float>]) -> [SIMD2<Float>] {
                let sorted = eye.sorted { $0.x < $1.x }
                let (p0, p1) = (sorted.first!, sorted.last!)
                let dir = p1 - p0
                // Below the corner-to-corner line (y down): the lower lid.
                // (cross product: y points down, so below the line is the negative side.)
                let lower = eye.filter { $0 != p0 && $0 != p1 && ($0.x - p0.x) * dir.y - ($0.y - p0.y) * dir.x <= 0 }
                var line = [p0] + lower.sorted { $0.x < $1.x } + [p1]
                if line.count < 3 { line = [p0, (p0 + p1) / 2 + SIMD2(0, simd_length(dir) * 0.15), p1] }
                // Nine evenly spaced points along it, as the mesh has.
                var lens: [Float] = [0]
                for i in 1..<line.count { lens.append(lens[i - 1] + simd_distance(line[i - 1], line[i])) }
                let total = max(lens.last!, 1e-6)
                return (0..<9).map { k in
                    let d = total * Float(k) / 8
                    var i = 1
                    while i < line.count - 1 && lens[i] < d { i += 1 }
                    let t = (d - lens[i - 1]) / max(lens[i] - lens[i - 1], 1e-6)
                    return line[i - 1] + (line[i] - line[i - 1]) * min(max(t, 0), 1)
                }
            }
            let wingL = nose.min { $0.x < $1.x }!, wingR = nose.max { $0.x < $1.x }!
            let cornerL = lips.min { $0.x < $1.x }!, cornerR = lips.max { $0.x < $1.x }!
            func toward(_ a: SIMD2<Float>, _ b: SIMD2<Float>, _ t: Float) -> SIMD2<Float> { a + (b - a) * t }
            let xs = contour.map(\.x)
            // The glabella + 0.29 of the chin-to-glabella length is the web's forehead centre, in the mesh's proportions.
            self.shape = FaceShape(
                lowerLidRight: lowerLid(rightEye.min { $0.x < $1.x }!.x < leftEye.min { $0.x < $1.x }!.x ? rightEye : leftEye),
                lowerLidLeft: lowerLid(rightEye.min { $0.x < $1.x }!.x < leftEye.min { $0.x < $1.x }!.x ? leftEye : rightEye),
                glabella: glabella, forehead: glabella + up * 0.29,
                nasolabialRight: toward(wingL, cornerL, 0.5), nasolabialLeft: toward(wingR, cornerR, 0.5),
                marionetteRight: toward(cornerL, chin, 0.35), marionetteLeft: toward(cornerR, chin, 0.35),
                width: (xs.max() ?? 0) - (xs.min() ?? 0))
        }
    }

    // MARK: - Skin tone

    /** The face's skin chroma (YCbCr) and brightness, and how close any pixel is to them. */
    private struct SkinTone {
        let cb: Float, cr: Float, sb: Float, sr: Float, y: Float

        init?(_ rgb: [Float], _ w: Int, _ h: Int, region: [Float], keep: [Float]) {
            var cbs: [Float] = [], crs: [Float] = [], ys: [Float] = []
            for i in 0..<(w * h) where region[i] > 0.99 && keep[i] > 0.99 {
                let (y, cb, cr) = Self.ycc(rgb[i * 3], rgb[i * 3 + 1], rgb[i * 3 + 2])
                ys.append(y)
                cbs.append(cb)
                crs.append(cr)
            }
            guard cbs.count >= 50 else { return nil }
            func median(_ a: [Float]) -> Float { a.sorted()[a.count / 2] }
            func mad(_ a: [Float], _ m: Float) -> Float { median(a.map { abs($0 - m) }) * 1.4826 }
            cb = median(cbs)
            cr = median(crs)
            y = median(ys)
            sb = max(0.012, mad(cbs, cb) * 1.6)
            sr = max(0.012, mad(crs, cr) * 1.6)
        }

        static func ycc(_ r: Float, _ g: Float, _ b: Float) -> (Float, Float, Float) {
            (0.299 * r + 0.587 * g + 0.114 * b, -0.168736 * r - 0.331264 * g + 0.5 * b, 0.5 * r - 0.418688 * g - 0.081312 * b)
        }

        /** 0..1 per pixel: 1 at the face's chroma, falling off over a few spreads; brightness far from the face's (hair, deep shadow, white) counts less. */
        func likeness(_ rgb: [Float], _ w: Int, _ h: Int) -> [Float] {
            var out = [Float](repeating: 0, count: w * h)
            for i in 0..<(w * h) {
                let (yy, b, r) = Self.ycc(rgb[i * 3], rgb[i * 3 + 1], rgb[i * 3 + 2])
                let db = (b - cb) / sb, dr = (r - cr) / sr
                let chroma = exp(-0.5 * (db * db + dr * dr) / 4)
                let ratio = yy / max(y, 1e-3)
                let light: Float = ratio < 0.5 ? max(0, (ratio - 0.3) / 0.2) : ratio > 1.6 ? max(0, 1 - (ratio - 1.6) / 0.5) : 1
                out[i] = chroma * light
            }
            return out
        }
    }

    // MARK: - Pixels

    /** The linear Rec.2020 copy, to be shown as ordinary-looking sRGB images at several exposures. */
    private struct Scene {
        let width: Int, height: Int
        /** Linear sRGB-primaries RGB. */
        let lin: [Float]
        /** Exposures (multipliers) to try: the log-average at middle grey (as the web's), then darker ones, then raw 1.0 = 3. */
        let exposures: [Float]

        init(_ image: PreviewImage) throws {
            let n = image.width * image.height
            guard n > 0 else { throw SkinSegmenterError(message: "empty image") }
            var lin = [Float](repeating: 0, count: n * 3)
            var logSum = 0.0
            for i in 0..<n {
                let r = Float(Float16(bitPattern: image.pixels[i * 3]))
                let g = Float(Float16(bitPattern: image.pixels[i * 3 + 1]))
                let b = Float(Float16(bitPattern: image.pixels[i * 3 + 2]))
                lin[i * 3] = 1.6605 * r - 0.5876 * g - 0.0728 * b
                lin[i * 3 + 1] = -0.1246 * r + 1.1329 * g - 0.0083 * b
                lin[i * 3 + 2] = -0.0182 * r - 0.1006 * g + 1.1187 * b
                logSum += log(max(0.2627 * Double(r) + 0.6780 * Double(g) + 0.0593 * Double(b), 1e-5))
            }
            let k = Float(0.18 / exp(logSum / Double(n)))
            width = image.width
            height = image.height
            self.lin = lin
            exposures = [k, k / 4, k / 16, 3]
        }

        /** The image at exposure [k] (a soft shoulder, sRGB encoded) as a CGImage, and its 0..1 RGB floats. */
        func render(_ k: Float) throws -> (CGImage, [Float]) {
            let n = width * height
            var bytes = [UInt8](repeating: 255, count: n * 4)
            var rgb = [Float](repeating: 0, count: n * 3)
            for i in 0..<n {
                for ch in 0..<3 {
                    let v = max(lin[i * 3 + ch], 0) * k
                    let t = (v / (1 + v)) * 1.6
                    let e = min(max(t <= 0.0031308 ? t * 12.92 : 1.055 * powf(t, 1 / 2.4) - 0.055, 0), 1)
                    let e8 = Int(e * 255 + 0.5)
                    bytes[i * 4 + ch] = UInt8(e8)
                    rgb[i * 3 + ch] = Float(e8) / 255
                }
            }
            guard let provider = CGDataProvider(data: Data(bytes) as CFData),
                  let cg = CGImage(width: width, height: height, bitsPerComponent: 8, bitsPerPixel: 32, bytesPerRow: width * 4,
                                   space: CGColorSpace(name: CGColorSpace.sRGB)!,
                                   bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.noneSkipLast.rawValue),
                                   provider: provider, decode: nil, shouldInterpolate: false, intent: .defaultIntent)
            else { throw SkinSegmenterError(message: "cannot make the face detector's input image") }
            return (cg, rgb)
        }
    }

    /** A one-component 8-bit Vision mask resampled to w x h, 0..1. */
    private static func read(_ buffer: CVPixelBuffer, _ w: Int, _ h: Int) -> [Float] {
        CVPixelBufferLockBaseAddress(buffer, .readOnly)
        defer { CVPixelBufferUnlockBaseAddress(buffer, .readOnly) }
        let sw = CVPixelBufferGetWidth(buffer), sh = CVPixelBufferGetHeight(buffer)
        let stride = CVPixelBufferGetBytesPerRow(buffer)
        guard let base = CVPixelBufferGetBaseAddress(buffer) else { return [Float](repeating: 0, count: w * h) }
        let src = base.assumingMemoryBound(to: UInt8.self)
        var plain = [Float](repeating: 0, count: sw * sh)
        for y in 0..<sh { for x in 0..<sw { plain[y * sw + x] = Float(src[y * stride + x]) / 255 } }
        return sw == w && sh == h ? plain : PortraitRetouch.resize(plain, sw, sh, w, h)
    }

    /** Guided filter (He et al.): edge-preserving refinement of [p] using guide [g]. */
    private static func guidedFilter(_ g: [Float], _ p: [Float], _ w: Int, _ h: Int, radius: Int, eps: Float) -> [Float] {
        let n = g.count
        var gp = [Float](repeating: 0, count: n), gg = [Float](repeating: 0, count: n)
        for i in 0..<n {
            gp[i] = g[i] * p[i]
            gg[i] = g[i] * g[i]
        }
        let meanG = Filters.box(g, w, h, radius), meanP = Filters.box(p, w, h, radius)
        let corrGP = Filters.box(gp, w, h, radius), corrGG = Filters.box(gg, w, h, radius)
        var a = [Float](repeating: 0, count: n), b = [Float](repeating: 0, count: n)
        for i in 0..<n {
            let variance = corrGG[i] - meanG[i] * meanG[i]
            a[i] = (corrGP[i] - meanG[i] * meanP[i]) / (variance + eps)
            b[i] = meanP[i] - a[i] * meanG[i]
        }
        let meanA = Filters.box(a, w, h, radius), meanB = Filters.box(b, w, h, radius)
        return g.indices.map { min(max(meanA[$0] * g[$0] + meanB[$0], 0), 1) }
    }
}
#endif
