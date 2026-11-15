import Foundation

/**
 * Portrait retouch: a natural, high-end skin clean-up (port of web's PortraitRetouch.ts, same numbers). Four
 * corrections, all on skin only and in sizes relative to the face width fw, so they look the same on a headshot and a
 * full-length portrait:
 *  1. spots: dark or red outliers about 0.25-1.2% of fw healed to their surroundings, in brightness and colour; moles
 *     (very dark, sharp) and tattoo ink (less red than skin) are kept;
 *  2. under-eyes: dark shading in the band below the lower lids lifted part-way;
 *  3. lines: dark mid-scale lines in the frown, forehead, nasolabial and marionette areas softened;
 *  4. evening: a light reduction of mid-scale unevenness inside the skin, away from its outline, half on the body.
 * Fine texture under ~0.3% of fw (pores, grain) is never touched.
 *
 * The result is a map of per-channel gains (log2, linear Rec.2020) at about the session preview's size, packed with the
 * skin mask into the skin texture (`DevelopTextures.skinMask`) and multiplied into the image by the develop shader
 * (`uSkinFix`), so the preview, the 100% view and the export all get the same correction.
 */
public struct RetouchMap: @unchecked Sendable {
    public let width: Int
    public let height: Int
    /** RGBA per pixel: r = the skin mask (as SkinMask.data, resampled), g, b, a = log2 gain of linear R, G, B. */
    public let data: [Float]
    /** The Portrait retouch value (1..100) the map was made for; the shader scales it for others until it is redone. */
    public let strength: Float

    public init(width: Int, height: Int, data: [Float], strength: Float) {
        self.width = width
        self.height = height
        self.data = data
        self.strength = strength
    }
}

public enum PortraitRetouch {
    /** Tuned at strength 40 on Reblum Natural 40 before/after pairs (web's P40). */
    private struct Tuning {
        var evenFace: [Float] = [0.04, 0.08, 0.06, 0, 0]
        var evenBody: [Float] = [0.02, 0.04, 0.03, 0, 0]
        var spotSigma: [Float] = [0.0025, 0.012]
        var spotZ: [Float] = [3.0, 5.0]
        var spotGain: Float = 1.0
        var spotLight: Float = 0.5
        var underEyeBands = [2, 3, 4]
        var underEyeGain: Float = 0.6
        var lineBands = [1, 2, 3]
        var lineZ: [Float] = [0.5, 3.0]
        var lineGain: Float = 0.7
        var lineLight: Float = 0.6
        var mole: [Float] = [0.5, 0.85]
        var ink: [Float] = [3.0, 8.0]
        var maxEv: Float = 0.45
    }

    /** Detail bands: band k lies between Gaussians of these sigmas (fractions of the face width). */
    private static let bands: [Float] = [0.003, 0.006, 0.012, 0.024, 0.048, 0.09]
    /** Faces larger than this (work pixels) are retouched on a downscaled copy: the bands are relative anyway. */
    private static let maxFacePx: Float = 600

    /** The slider at [strength] 1..100 (40 = the tuned Natural look): gains scale with it, thresholds loosen above 40. */
    private static func tuning(at strength: Float) -> Tuning {
        let k = strength / 40
        func g(_ x: Float) -> Float { min(0.95, x * k) }
        let shift = 0.5 * log2(max(k, 1e-3))
        var q = Tuning()
        q.evenFace = q.evenFace.map(g)
        q.evenBody = q.evenBody.map(g)
        q.spotGain = g(q.spotGain)
        q.underEyeGain = g(q.underEyeGain)
        q.lineGain = g(q.lineGain)
        q.spotZ = q.spotZ.map { max(0.8, $0 - shift) }
        q.lineZ = q.lineZ.map { max(0.4, $0 - shift) }
        return q
    }

    static func smoothstep(_ a: Float, _ b: Float, _ x: Float) -> Float {
        let t = min(1, max(0, (x - a) / (b - a)))
        return t * t * (3 - 2 * t)
    }

    /** The shader's `uSkinFix` for Portrait retouch [strength] 0..100 with [map]: the map scaled until it is redone. */
    public static func skinFix(strength: Float, map: RetouchMap?) -> Float {
        guard let map, strength > 0, map.strength > 0 else { return 0 }
        return min(2.5, strength / map.strength)
    }

    /**
     * The retouch map for [preview] (the session preview, linear Rec.2020) with [skin] (the skin mask, faces and their
     * landmarks) at Portrait retouch [strength] 1..100, or nil when there's no face to size it by.
     */
    public static func buildMap(_ preview: PreviewImage, _ skin: SkinMask, strength: Float) -> RetouchMap? {
        guard strength > 0, skin.hasSkin else { return nil }
        var fwPreview: Float = 0
        for f in skin.faces { fwPreview = max(fwPreview, f.width * Float(preview.width)) }
        // No landmarks (a face seen side on, or only skin): the face-skin area's diameter stands in for the width.
        if fwPreview <= 0 { fwPreview = skin.faceDiameterPx * Float(preview.width) / Float(preview.fullWidth) }
        guard fwPreview > 8 else { return nil }

        let step = max(1, Int((fwPreview / maxFacePx).rounded(.up)))
        let fw = fwPreview / Float(step)
        // Only the skin's bounding box (plus the widest blur's reach) is worked on: the rest of the map stays 0.
        guard let (x0, y0, w, h) = skinBox(skin, Float(preview.width) / Float(step), Float(preview.height) / Float(step), 0.3 * fw)
        else { return nil }
        let n = w * h
        let q = tuning(at: strength)

        // Scene pixels (Rec.2020) at the work size, and an sRGB-primaries linear copy at a skin-friendly exposure for Lab.
        var scene = [Float](repeating: 0, count: n * 3)
        downscale(preview, step, x0, y0, w, h, &scene)
        let mask = resizeRegion(skin.data, skin.width, skin.height, Float(preview.width) / Float(step),
                                Float(preview.height) / Float(step), x0, y0, w, h)
        var logSum = 0.0
        var wSum = 0.0
        for i in 0..<n {
            let y = 0.2627 * scene[i * 3] + 0.678 * scene[i * 3 + 1] + 0.0593 * scene[i * 3 + 2]
            let m: Double = mask[i] > 0.5 ? 1 : 0
            logSum += m * Double(log(max(y, 1e-6)))
            wSum += m
        }
        guard wSum >= 16 else { return nil }
        // Skin at about sRGB 0.62, where the Lab thresholds were tuned (on developed JPEGs).
        let k = Float(0.35 / exp(logSum / wSum))
        var lin = [Float](repeating: 0, count: n * 3)
        var L = [Float](repeating: 0, count: n)
        var A = [Float](repeating: 0, count: n)
        var B = [Float](repeating: 0, count: n)
        for i in 0..<n {
            let r = scene[i * 3] * k, g = scene[i * 3 + 1] * k, b = scene[i * 3 + 2] * k
            let lr = max(0, 1.6605 * r - 0.5876 * g - 0.0728 * b)
            let lg = max(0, -0.1246 * r + 1.1329 * g - 0.0083 * b)
            let lb = max(0, -0.0182 * r - 0.1006 * g + 1.1187 * b)
            lin[i * 3] = lr
            lin[i * 3 + 1] = lg
            lin[i * 3 + 2] = lb
            L[i] = log2(0.2126 * lr + 0.7152 * lg + 0.0722 * lb + 1e-3)
            let lab = toLab(lr, lg, lb)
            A[i] = lab.1
            B[i] = lab.2
        }

        let S = mask.map { smoothstep(0.35, 0.75, $0) }
        let blur = Blur(w, h, S.map { max($0, 1e-3) })

        let bl = bands.map { blur.masked(L, $0 * fw) }
        let d = (0..<(bl.count - 1)).map { sub(bl[$0], bl[$0 + 1]) }
        let spread: [[Float]] = d.enumerated().map { j, x in
            blur.masked(mul(x, x), 4 * bands[j] * fw).map { sqrt(max(0, $0)) + 0.012 }
        }

        let faceConf = skin.face.map { resize($0, skin.width, skin.height, w, h, x0: x0, y0: y0,
                                                fullW: Float(preview.width) / Float(step), fullH: Float(preview.height) / Float(step)) } ?? S
        let isFace = gauss(faceConf, w, h, 0.02 * fw).map { min(1, max(0, $0)) }
        // Evening stays inside the skin, away from its outline (jaw, hairline), where shading is form.
        let solid = S.map { $0 > 0.5 ? Float(1) : 0 }
        let inner = gauss(minFilter(solid, w, h, (Int(0.08 * fw) | 1) / 2), w, h, 0.03 * fw)

        var underEye = [Float](repeating: 0, count: n)
        var lines = [Float](repeating: 0, count: n)
        let fullW = Float(preview.width / step)
        let fullH = Float(preview.height / step)
        for f in skin.faces {
            func pt(_ p: FaceShape.Point) -> (Float, Float) { (p.x * fullW - Float(x0), p.y * fullH - Float(y0)) }
            maxInto(&underEye, underEyeMask(f, pt, w, h, fw))
            maxInto(&lines, linesMask(f, pt, w, h, fw))
        }

        // Kept: tattoo ink (clearly less red than the skin around it) and moles (very dark, sharp).
        let aWide = blur.masked(A, 0.06 * fw)
        let aFine = gauss(A, w, h, 0.004 * fw)
        var moleRaw = [Float](repeating: 0, count: n)
        for i in 0..<n { moleRaw[i] = smoothstep(q.mole[0], q.mole[1], -(bl[0][i] - bl[2][i])) }
        let mole = gauss(moleRaw, w, h, 0.006 * fw)
        var keep = [Float](repeating: 0, count: n)
        for i in 0..<n {
            let ink = smoothstep(q.ink[0], q.ink[1], aWide[i] - aFine[i])
            keep[i] = (1 - ink) * (1 - min(1, max(0, mole[i] * 2)))
        }

        var dL = [Float](repeating: 0, count: n)
        var dA = [Float](repeating: 0, count: n)
        var dB = [Float](repeating: 0, count: n)
        // 4. evening: only small, texture-like deviations; edges (jaw, nose) keep their shape.
        for j in 0..<d.count {
            let ef = q.evenFace[j], eb = q.evenBody[j]
            if ef == 0 && eb == 0 { continue }
            for i in 0..<n {
                let calm = (1 - smoothstep(1.0, 2.2, abs(d[j][i] / spread[j][i]))) * inner[i]
                dL[i] -= d[j][i] * calm * (ef * isFace[i] + eb * (1 - isFace[i]))
            }
        }
        // 1. spots: dark, or red even if not dark (light ones by half), in one blob band.
        let s0 = q.spotSigma[0] * fw, s1 = q.spotSigma[1] * fw
        let D = sub(blur.masked(L, s0), blur.masked(L, s1))
        let DA = sub(blur.masked(A, s0), blur.masked(A, s1))
        let DB = sub(blur.masked(B, s0), blur.masked(B, s1))
        let spD = blur.masked(mul(D, D), 0.08 * fw)
        let spA = blur.masked(mul(DA, DA), 0.12 * fw)
        var wRaw = [Float](repeating: 0, count: n)
        for i in 0..<n {
            let z = D[i] / (sqrt(max(0, spD[i])) + 0.01)
            let zr = DA[i] / (sqrt(max(0, spA[i])) + 0.3)
            wRaw[i] = max(smoothstep(q.spotZ[0], q.spotZ[1], -z), smoothstep(q.spotZ[0], q.spotZ[1], zr))
                + q.spotLight * smoothstep(q.spotZ[0], q.spotZ[1], z)
        }
        let spot = gauss(wRaw, w, h, s0)
        for i in 0..<n {
            // A healed spot takes the surrounding colour as well as its brightness (lifting luma alone turned brown marks orange).
            let wt = min(1, max(0, spot[i] * 1.5)) * q.spotGain
            dL[i] -= D[i] * wt
            dA[i] -= DA[i] * wt
            dB[i] -= DB[i] * wt
        }
        // 2. under-eyes: dark mid-scale shading lifted.
        for j in q.underEyeBands { for i in 0..<n { dL[i] -= min(d[j][i], 0) * underEye[i] * q.underEyeGain } }
        // 3. lines: dark ones, light ones in part.
        for j in q.lineBands {
            for i in 0..<n where lines[i] > 0 {
                let z = d[j][i] / spread[j][i]
                dL[i] -= d[j][i] * (smoothstep(q.lineZ[0], q.lineZ[1], -z) + q.lineLight * smoothstep(q.lineZ[0], q.lineZ[1], z))
                    * lines[i] * q.lineGain
            }
        }

        // Only well inside the skin, and never past ±0.45 EV.
        let core = gauss(minFilter(S, w, h, (max(3, Int(0.02 * fw)) | 1) / 2), w, h, 0.01 * fw)
        let mapW = Int(fullW), mapH = Int(fullH)
        var out = [Float](repeating: 0, count: mapW * mapH * 4)
        let fullMask = resize(skin.data, skin.width, skin.height, mapW, mapH)
        for i in 0..<(mapW * mapH) { out[i * 4] = fullMask[i] }
        for i in 0..<n {
            let o = ((y0 + i / w) * mapW + x0 + (i % w)) * 4
            let c = min(1, max(0, core[i])) * keep[i]
            if c <= 0 { continue }
            let el = min(q.maxEv, max(-q.maxEv, dL[i] * c))
            let ea = dA[i] * c, eb = dB[i] * c
            if abs(el) < 1e-4 && abs(ea) < 1e-3 && abs(eb) < 1e-3 { continue }
            let gain = exp2(el)
            let r0 = lin[i * 3], g0 = lin[i * 3 + 1], b0 = lin[i * 3 + 2]
            let lab = toLab(r0 * gain, g0 * gain, b0 * gain)
            let (r1, g1, b1) = fromLab(lab.0, lab.1 + ea, lab.2 + eb)
            // Back to scene Rec.2020: the original pixel times the change, through the sRGB -> Rec.2020 primaries.
            let dr = r1 - r0, dg = g1 - g0, db = b1 - b0
            let R = scene[i * 3], G = scene[i * 3 + 1], Bc = scene[i * 3 + 2]
            let nr = R + (0.6274 * dr + 0.3293 * dg + 0.0433 * db) / k
            let ng = G + (0.0691 * dr + 0.9195 * dg + 0.0114 * db) / k
            let nb = Bc + (0.0164 * dr + 0.088 * dg + 0.8956 * db) / k
            out[o + 1] = logRatio(nr, R)
            out[o + 2] = logRatio(ng, G)
            out[o + 3] = logRatio(nb, Bc)
        }
        return RetouchMap(width: mapW, height: mapH, data: out, strength: strength)
    }

    /** log2(to / from), limited to ±1 EV; 0 where the pixel is (near) black. */
    private static func logRatio(_ to: Float, _ from: Float) -> Float {
        guard from > 1e-6 else { return 0 }
        return min(1, max(-1, log2(max(to, from / 2) / from)))
    }

    // MARK: - Face regions (work pixels)

    private static func underEyeMask(_ f: FaceShape, _ pt: (FaceShape.Point) -> (Float, Float), _ w: Int, _ h: Int,
                                     _ fw: Float) -> [Float] {
        var m = [Float](repeating: 0, count: w * h)
        let depth: Float = 0.11
        for lid in [f.lowerLidRight, f.lowerLidLeft] {
            let pts = lid.map(pt)
            let cx = pts.reduce(0) { $0 + $1.0 } / Float(pts.count)
            // From just under the lashes to a curve a little wider than the eye, ~0.14 fw down.
            let top = pts.map { ($0.0, $0.1 + 0.035 * fw) }
            let bottom = pts.map { (cx + ($0.0 - cx) * 1.15, $0.1 + (depth + 0.03) * fw) }.reversed()
            fillPolygon(&m, w, h, top + bottom)
        }
        return gauss(m, w, h, 0.02 * fw)
    }

    private static func linesMask(_ f: FaceShape, _ pt: (FaceShape.Point) -> (Float, Float), _ w: Int, _ h: Int,
                                  _ fw: Float) -> [Float] {
        var m = [Float](repeating: 0, count: w * h)
        fillCircle(&m, w, h, pt(f.glabella), 0.09 * fw)  // glabella (frown lines)
        fillCircle(&m, w, h, pt(f.forehead), 0.18 * fw)  // forehead
        fillCircle(&m, w, h, pt(f.nasolabialRight), 0.07 * fw)  // nasolabial
        fillCircle(&m, w, h, pt(f.nasolabialLeft), 0.07 * fw)
        fillCircle(&m, w, h, pt(f.marionetteRight), 0.06 * fw)  // marionette
        fillCircle(&m, w, h, pt(f.marionetteLeft), 0.06 * fw)
        return gauss(m, w, h, 0.03 * fw)
    }

    private static func fillCircle(_ m: inout [Float], _ w: Int, _ h: Int, _ c: (Float, Float), _ r: Float) {
        let rr = Float(Int(r))
        let r2 = rr * rr
        guard h > 0, w > 0 else { return }
        let y0 = max(0, Int((c.1 - r).rounded(.down))), y1 = min(h - 1, Int((c.1 + r).rounded(.up)))
        let x0 = max(0, Int((c.0 - r).rounded(.down))), x1 = min(w - 1, Int((c.0 + r).rounded(.up)))
        guard y0 <= y1, x0 <= x1 else { return }
        for y in y0...y1 {
            for x in x0...x1 where (Float(x) - c.0) * (Float(x) - c.0) + (Float(y) - c.1) * (Float(y) - c.1) <= r2 {
                m[y * w + x] = 1
            }
        }
    }

    /** Even-odd scanline fill of a closed polygon, at pixel centres. */
    static func fillPolygon(_ m: inout [Float], _ w: Int, _ h: Int, _ pts: [(Float, Float)], value: Float = 1) {
        guard let minY = pts.map(\.1).min(), let maxY = pts.map(\.1).max() else { return }
        let y0 = max(0, Int(minY.rounded(.down))), y1 = min(h - 1, Int(maxY.rounded(.up)))
        guard y0 <= y1 else { return }
        for y in y0...y1 {
            let py = Float(y) + 0.5
            var xs: [Float] = []
            for i in 0..<pts.count {
                let (ax, ay) = pts[i]
                let (bx, by) = pts[(i + 1) % pts.count]
                if (ay <= py) != (by <= py) { xs.append(ax + (py - ay) / (by - ay) * (bx - ax)) }
            }
            xs.sort()
            var i = 0
            while i + 1 < xs.count {
                let from = max(0, Int((xs[i] - 0.5).rounded(.up))), to = min(w - 1, Int((xs[i + 1] - 0.5).rounded(.down)))
                if from <= to { for x in from...to { m[y * w + x] = value } }
                i += 2
            }
        }
    }

    private static func maxInto(_ a: inout [Float], _ b: [Float]) {
        for i in a.indices where b[i] > a[i] { a[i] = b[i] }
    }

    private static func sub(_ a: [Float], _ b: [Float]) -> [Float] {
        var out = a
        for i in out.indices { out[i] -= b[i] }
        return out
    }

    private static func mul(_ a: [Float], _ b: [Float]) -> [Float] {
        var out = a
        for i in out.indices { out[i] *= b[i] }
        return out
    }

    // MARK: - Colour

    private static let xn: Float = 0.950456
    private static let zn: Float = 1.088754
    private static func labF(_ t: Float) -> Float { t > 0.008856 ? cbrt(t) : 7.787 * t + 16 / 116 }
    private static func labFInv(_ f: Float) -> Float { f > 0.206893 ? f * f * f : (f - 16 / 116) / 7.787 }

    /** Linear sRGB -> CIE Lab (D65), as OpenCV's float RGB2Lab after its gamma step. */
    static func toLab(_ r: Float, _ g: Float, _ b: Float) -> (Float, Float, Float) {
        let x = (0.412453 * r + 0.35758 * g + 0.180423 * b) / xn
        let y = 0.212671 * r + 0.71516 * g + 0.072169 * b
        let z = (0.019334 * r + 0.119193 * g + 0.950227 * b) / zn
        let fy = labF(y)
        return (y > 0.008856 ? 116 * fy - 16 : 903.3 * y, 500 * (labF(x) - fy), 200 * (fy - labF(z)))
    }

    /** CIE Lab (D65) -> linear sRGB. */
    static func fromLab(_ l: Float, _ a: Float, _ bb: Float) -> (Float, Float, Float) {
        let fy = (l + 16) / 116
        let x = labFInv(fy + a / 500) * xn
        let y = l > 7.9996 ? fy * fy * fy : l / 903.3
        let z = labFInv(fy - bb / 200) * zn
        return (3.240479 * x - 1.53715 * y - 0.498535 * z,
                -0.969256 * x + 1.875991 * y + 0.041556 * z,
                0.055648 * x - 0.204043 * y + 1.057311 * z)
    }

    // MARK: - Image helpers

    /** The work region (x0, y0, w, h) (pixels of a [mapW] x [mapH] map): where [skin] has any skin, grown by [margin], or nil. */
    private static func skinBox(_ skin: SkinMask, _ mapW: Float, _ mapH: Float, _ margin: Float) -> (Int, Int, Int, Int)? {
        var minX = Int.max, minY = Int.max, maxX = Int.min, maxY = Int.min
        for y in 0..<skin.height {
            for x in 0..<skin.width where skin.data[y * skin.width + x] >= 0.05 {
                minX = min(minX, x)
                maxX = max(maxX, x + 1)
                minY = min(minY, y)
                maxY = max(maxY, y + 1)
            }
        }
        if minX > maxX { return nil }
        let W = Int(mapW), H = Int(mapH)
        let sx = mapW / Float(skin.width), sy = mapH / Float(skin.height)
        let x0 = max(0, Int((Float(minX) * sx - margin).rounded(.down)))
        let y0 = max(0, Int((Float(minY) * sy - margin).rounded(.down)))
        let x1 = min(W, Int((Float(maxX) * sx + margin).rounded(.up)))
        let y1 = min(H, Int((Float(maxY) * sy + margin).rounded(.up)))
        return x1 > x0 && y1 > y0 ? (x0, y0, x1 - x0, y1 - y0) : nil
    }

    /** The (x0, y0, w, h) part of [src] (sw x sh) resized bilinearly to [fullW] x [fullH]. */
    private static func resizeRegion(_ src: [Float], _ sw: Int, _ sh: Int, _ fullW: Float, _ fullH: Float, _ x0: Int, _ y0: Int,
                                     _ w: Int, _ h: Int) -> [Float] {
        var out = [Float](repeating: 0, count: w * h)
        let W = Float(Int(fullW)), H = Float(Int(fullH))
        for y in 0..<h {
            let fy = min(Float(sh - 1), max(0, (Float(y0 + y) + 0.5) * Float(sh) / H - 0.5))
            let ya = Int(fy), yb = min(ya + 1, sh - 1)
            let ty = fy - Float(ya)
            for x in 0..<w {
                let fx = min(Float(sw - 1), max(0, (Float(x0 + x) + 0.5) * Float(sw) / W - 0.5))
                let xa = Int(fx), xb = min(xa + 1, sw - 1)
                let tx = fx - Float(xa)
                let top = src[ya * sw + xa] * (1 - tx) + src[ya * sw + xb] * tx
                let bottom = src[yb * sw + xa] * (1 - tx) + src[yb * sw + xb] * tx
                out[y * w + x] = top * (1 - ty) + bottom * ty
            }
        }
        return out
    }

    /** [step] x [step] block averages of [image] from (x0, y0) of the downscaled grid into [out] (RGB floats, w x h). */
    private static func downscale(_ image: PreviewImage, _ step: Int, _ x0: Int, _ y0: Int, _ w: Int, _ h: Int, _ out: inout [Float]) {
        let sw = image.width
        let inv = 1 / Float(step * step)
        image.pixels.withUnsafeBufferPointer { px in
            for y in 0..<h {
                for x in 0..<w {
                    var r: Float = 0, g: Float = 0, b: Float = 0
                    for j in 0..<step {
                        for i in 0..<step {
                            let s = (((y0 + y) * step + j) * sw + (x0 + x) * step + i) * 3
                            r += Float(Float16(bitPattern: px[s]))
                            g += Float(Float16(bitPattern: px[s + 1]))
                            b += Float(Float16(bitPattern: px[s + 2]))
                        }
                    }
                    let o = (y * w + x) * 3
                    out[o] = max(0, r * inv)
                    out[o + 1] = max(0, g * inv)
                    out[o + 2] = max(0, b * inv)
                }
            }
        }
    }

    /** Bilinear resize of a single-channel map (pixel centres aligned). */
    static func resize(_ src: [Float], _ sw: Int, _ sh: Int, _ dw: Int, _ dh: Int) -> [Float] {
        var out = [Float](repeating: 0, count: dw * dh)
        for y in 0..<dh {
            let fy = min(Float(sh - 1), max(0, (Float(y) + 0.5) * Float(sh) / Float(dh) - 0.5))
            let y0 = Int(fy), y1 = min(y0 + 1, sh - 1)
            let ty = fy - Float(y0)
            for x in 0..<dw {
                let fx = min(Float(sw - 1), max(0, (Float(x) + 0.5) * Float(sw) / Float(dw) - 0.5))
                let x0 = Int(fx), x1 = min(x0 + 1, sw - 1)
                let tx = fx - Float(x0)
                let top = src[y0 * sw + x0] * (1 - tx) + src[y0 * sw + x1] * tx
                let bottom = src[y1 * sw + x0] * (1 - tx) + src[y1 * sw + x1] * tx
                out[y * dw + x] = top * (1 - ty) + bottom * ty
            }
        }
        return out
    }

    /** The region (x0, y0, w, h) of [src] resized to a [fullW] x [fullH] grid (as `resizeRegion`). */
    private static func resize(_ src: [Float], _ sw: Int, _ sh: Int, _ w: Int, _ h: Int, x0: Int, y0: Int, fullW: Float,
                               fullH: Float) -> [Float] {
        resizeRegion(src, sw, sh, fullW, fullH, x0, y0, w, h)
    }

    /** Gaussian blurs normalised by a weight map (skin only), caching the blurred weights per sigma. */
    private final class Blur {
        private var weights: [Float: [Float]] = [:]
        private let w: Int, h: Int
        private let weight: [Float]

        init(_ w: Int, _ h: Int, _ weight: [Float]) {
            self.w = w
            self.h = h
            self.weight = weight
        }

        func masked(_ x: [Float], _ sigma: Float) -> [Float] {
            let ws: [Float]
            if let cached = weights[sigma] {
                ws = cached
            } else {
                ws = PortraitRetouch.gauss(weight, w, h, sigma)
                weights[sigma] = ws
            }
            var num = PortraitRetouch.gauss(PortraitRetouch.mul(x, weight), w, h, sigma)
            for i in num.indices { num[i] /= max(ws[i], 1e-4) }
            return num
        }
    }

    /**
     * Gaussian blur, edges clamped: an exact kernel for small sigmas, three box passes (each axis) for larger ones,
     * whose cost doesn't grow with the radius. Wide blurs run at half size.
     */
    static func gauss(_ src: [Float], _ w: Int, _ h: Int, _ sigma: Float) -> [Float] {
        let s = max(0.4, sigma)
        if s >= 6 && w >= 32 && h >= 32 {
            // Wide blurs at half size: the 2x2 averaging and the bilinear way back add about one full-size pixel of blur.
            let hw = (w + 1) / 2, hh = (h + 1) / 2
            return up2(gauss(down2(src, w, h), hw, hh, (s * s - 1).squareRoot() / 2), hw, hh, w, h)
        }
        var a = [Float](repeating: 0, count: src.count)
        var b = [Float](repeating: 0, count: src.count)
        if s < 1.6 {
            let r = Int((3 * s).rounded(.up))
            var kernel = [Float](repeating: 0, count: 2 * r + 1)
            var sum: Float = 0
            for i in -r...r {
                kernel[i + r] = exp(-0.5 * Float(i * i) / (s * s))
                sum += kernel[i + r]
            }
            for i in kernel.indices { kernel[i] /= sum }
            convolveH(src, &b, w, h, kernel)
            convolveV(b, &a, w, h, kernel)
            return a
        }
        var acc = [Double](repeating: 0, count: w)
        var from = src
        for size in boxSizes(s, 3) {
            let r = (size - 1) / 2
            boxH(from, &b, w, h, r)
            boxV(b, &a, w, h, r, &acc)
            from = a
        }
        return a
    }

    /** 2x2 block means (a last odd row or column averages with itself). */
    private static func down2(_ src: [Float], _ w: Int, _ h: Int) -> [Float] {
        let hw = (w + 1) / 2, hh = (h + 1) / 2
        var out = [Float](repeating: 0, count: hw * hh)
        for y in 0..<hh {
            let r0 = 2 * y * w
            let r1 = min(2 * y + 1, h - 1) * w
            for x in 0..<hw {
                let c0 = 2 * x
                let c1 = min(2 * x + 1, w - 1)
                out[y * hw + x] = 0.25 * (src[r0 + c0] + src[r0 + c1] + src[r1 + c0] + src[r1 + c1])
            }
        }
        return out
    }

    /** Bilinear 2x upsampling of `down2`'s grid back to w x h (pixel centres aligned, edges clamped). */
    private static func up2(_ half: [Float], _ hw: Int, _ hh: Int, _ w: Int, _ h: Int) -> [Float] {
        var rows = [Float](repeating: 0, count: hh * w)
        for y in 0..<hh {
            let o = y * hw
            for x in 0..<w {
                let i = x >> 1
                let j = x & 1 != 0 ? min(i + 1, hw - 1) : max(i - 1, 0)
                rows[y * w + x] = 0.75 * half[o + i] + 0.25 * half[o + j]
            }
        }
        var out = [Float](repeating: 0, count: w * h)
        for y in 0..<h {
            let i = y >> 1
            let j = y & 1 != 0 ? min(i + 1, hh - 1) : max(i - 1, 0)
            let a = i * w, b = j * w, o = y * w
            for x in 0..<w { out[o + x] = 0.75 * rows[a + x] + 0.25 * rows[b + x] }
        }
        return out
    }

    /** Widths of [n] box filters whose sum approximates a Gaussian of [sigma]. */
    private static func boxSizes(_ sigma: Float, _ n: Int) -> [Int] {
        var wl = Int((12 * sigma * sigma / Float(n) + 1).squareRoot().rounded(.down))
        if wl % 2 == 0 { wl -= 1 }
        let wu = wl + 2
        let m = Int(((12 * sigma * sigma - Float(n * wl * wl) - Float(4 * n * wl) - Float(3 * n)) / Float(-4 * wl - 4)).rounded())
        return (0..<n).map { $0 < m ? wl : wu }
    }

    private static func convolveH(_ src: [Float], _ dst: inout [Float], _ w: Int, _ h: Int, _ kernel: [Float]) {
        let r = (kernel.count - 1) / 2
        for y in 0..<h {
            let o = y * w
            for x in 0..<w {
                var acc: Float = 0
                if x >= r && x + r < w {
                    for k in 0..<kernel.count { acc += kernel[k] * src[o + x - r + k] }
                } else {
                    for k in 0..<kernel.count {
                        let i = x - r + k
                        acc += kernel[k] * src[o + (i < 0 ? 0 : i >= w ? w - 1 : i)]
                    }
                }
                dst[o + x] = acc
            }
        }
    }

    private static func convolveV(_ src: [Float], _ dst: inout [Float], _ w: Int, _ h: Int, _ kernel: [Float]) {
        let r = (kernel.count - 1) / 2
        for y in 0..<h {
            let o = y * w
            for x in 0..<w { dst[o + x] = 0 }
            for k in 0..<kernel.count {
                let yy = y - r + k
                let so = (yy < 0 ? 0 : yy >= h ? h - 1 : yy) * w
                let kv = kernel[k]
                for x in 0..<w { dst[o + x] += kv * src[so + x] }
            }
        }
    }

    /** Running box mean of radius [r] along rows, edges clamped. */
    private static func boxH(_ src: [Float], _ dst: inout [Float], _ w: Int, _ h: Int, _ r: Int) {
        let inv = 1 / Float(2 * r + 1)
        let last = w - 1
        for y in 0..<h {
            let o = y * w
            var acc = Float(r + 1) * src[o]
            if r >= 1 { for i in 1...r { acc += src[o + (i > last ? last : i)] } }
            for x in 0..<w {
                dst[o + x] = acc * inv
                let add = x + r + 1, rem = x - r
                acc += src[o + (add > last ? last : add)] - src[o + (rem < 0 ? 0 : rem)]
            }
        }
    }

    /** Running box mean of radius [r] down the columns, all columns at once ([acc]: w doubles of scratch). */
    private static func boxV(_ src: [Float], _ dst: inout [Float], _ w: Int, _ h: Int, _ r: Int, _ acc: inout [Double]) {
        let inv = 1 / Double(2 * r + 1)
        let last = h - 1
        for x in 0..<w { acc[x] = Double(r + 1) * Double(src[x]) }
        if r >= 1 {
            for j in 1...r {
                let so = (j > last ? last : j) * w
                for x in 0..<w { acc[x] += Double(src[so + x]) }
            }
        }
        for y in 0..<h {
            let o = y * w
            let add = (y + r + 1 > last ? last : y + r + 1) * w
            let rem = (y - r < 0 ? 0 : y - r) * w
            for x in 0..<w {
                dst[o + x] = Float(acc[x] * inv)
                acc[x] += Double(src[add + x]) - Double(src[rem + x])
            }
        }
    }

    /** Grey erosion with a (2r+1)^2 square (separable running minimum; outside the image doesn't count). */
    static func minFilter(_ src: [Float], _ w: Int, _ h: Int, _ r: Int) -> [Float] {
        if r <= 0 { return src }
        var tmp = [Float](repeating: 0, count: src.count)
        var out = [Float](repeating: 0, count: src.count)
        minPass(src, &tmp, w, h, r, 1, w)
        minPass(tmp, &out, h, w, r, w, 1)
        return out
    }

    /** van Herk / Gil-Werman running minimum along lines. */
    private static func minPass(_ src: [Float], _ dst: inout [Float], _ len: Int, _ lines: Int, _ r: Int, _ step: Int,
                                _ lineStep: Int) {
        let k = 2 * r + 1
        let padded = len + 2 * r
        let n = (padded + k - 1) / k * k
        var v = [Float](repeating: .infinity, count: n)
        var g = [Float](repeating: 0, count: n)
        var hh = [Float](repeating: 0, count: n)
        for l in 0..<lines {
            let o = l * lineStep
            for i in 0..<n { v[i] = .infinity }
            for i in 0..<len { v[i + r] = src[o + i * step] }
            var s = 0
            while s < n {
                g[s] = v[s]
                if s + 1 < s + k { for i in (s + 1)..<(s + k) { g[i] = min(g[i - 1], v[i]) } }
                hh[s + k - 1] = v[s + k - 1]
                if s + k - 2 >= s { for i in stride(from: s + k - 2, through: s, by: -1) { hh[i] = min(hh[i + 1], v[i]) } }
                s += k
            }
            // Window [i, i + 2r] in padded coordinates = source pixels i - r .. i + r.
            for i in 0..<len { dst[o + i * step] = min(hh[i], g[i + 2 * r]) }
        }
    }
}
