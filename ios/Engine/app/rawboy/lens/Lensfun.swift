import Foundation

/**
 * Lens corrections from the Lensfun database (https://lensfun.github.io, database CC BY-SA 3.0; see
 * web/public/lensfun/README.txt). RawBoy does not use Lensfun's LGPL code: this file re-implements the documented
 * calibration models (ptlens / poly3 / poly5 distortion, linear / poly3 lateral CA, "pa" vignetting) and their
 * rescaling to the photo's sensor, then fits the result into the structures the develop shader already has for
 * DNG opcodes (WarpRectilinear per colour plane, FixVignetteRadial), so there is no shader change.
 *
 * Port of web's engine/lens/Lensfun.ts: keep both in step. Data: the bundled lensfun/index.json (cameras, lenses)
 * and calib-<file>.json (calibrations of the lenses of one upstream XML file), made by tools/lensfun/convert.mjs.
 */
public enum Lensfun {
    /** Lens projection types in the database's order (index.json `types`). */
    public enum LensType: String, CaseIterable, Sendable {
        case rectilinear, fisheye, panoramic, equirectangular, orthographic, stereographic, equisolid

        public var isFisheye: Bool { self == .fisheye || self == .orthographic || self == .stereographic || self == .equisolid }
    }

    public struct Camera: Equatable, Sendable {
        public let maker: String
        public let model: String
        public let variant: String
        public let mount: String
        public let crop: Double

        public init(maker: String, model: String, variant: String, mount: String, crop: Double) {
            self.maker = maker
            self.model = model
            self.variant = variant
            self.mount = mount
            self.crop = crop
        }
    }

    public struct Lens: Equatable, Sendable {
        /** Position in the database, the key of its calibrations. */
        public let id: Int
        public let maker: String
        public let model: String
        public let mounts: [String]
        public let crop: Double
        public let aspect: Double
        public let type: LensType
        public let minFocal: Double
        public let maxFocal: Double
        public let minAperture: Double
        public let maxAperture: Double
        public let chunk: Int
        /** Which calibrations exist. */
        public let hasDistortion: Bool
        public let hasTca: Bool
        public let hasVignetting: Bool
    }

    public struct Index: Sendable {
        public let commit: String
        public let date: String
        public let mounts: [String: [String]]
        public let cameras: [Camera]
        public let lenses: [Lens]
        public let chunks: [String]
    }

    public struct DataError: Error, LocalizedError {
        public let message: String
        public var errorDescription: String? { message }
    }

    private static func number(_ v: Any?) -> Double { (v as? NSNumber)?.doubleValue ?? 0 }

    /** index.json as written by the converter. */
    public static func parseIndex(_ data: Data) throws -> Index {
        guard let raw = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw DataError(message: "The Lensfun database is not readable")
        }
        let source = raw["source"] as? [String: Any] ?? [:]
        let cameras: [Camera] = (raw["cameras"] as? [[Any]] ?? []).compactMap { c in
            guard c.count >= 5 else { return nil }
            return Camera(maker: c[0] as? String ?? "", model: c[1] as? String ?? "", variant: c[2] as? String ?? "",
                          mount: c[3] as? String ?? "", crop: number(c[4]))
        }
        var lenses: [Lens] = []
        for (id, l) in (raw["lenses"] as? [[Any]] ?? []).enumerated() {
            // Lenses keep their position as the id, so a short entry still takes its place.
            let at: (Int) -> Any? = { $0 < l.count ? l[$0] : nil }
            let type = Int(number(at(5)))
            let flags = Int(number(at(11)))
            lenses.append(Lens(
                id: id, maker: at(0) as? String ?? "", model: at(1) as? String ?? "", mounts: at(2) as? [String] ?? [],
                crop: number(at(3)), aspect: number(at(4)),
                type: LensType.allCases.indices.contains(type) ? LensType.allCases[type] : .rectilinear,
                minFocal: number(at(6)), maxFocal: number(at(7)), minAperture: number(at(8)), maxAperture: number(at(9)),
                chunk: Int(number(at(10))),
                hasDistortion: flags & 1 != 0, hasTca: flags & 2 != 0, hasVignetting: flags & 4 != 0))
        }
        return Index(
            commit: source["commit"] as? String ?? "", date: source["date"] as? String ?? "",
            mounts: raw["mounts"] as? [String: [String]] ?? [:], cameras: cameras, lenses: lenses,
            chunks: raw["chunks"] as? [String] ?? [])
    }

    /** One calibration set of a lens (a crop factor and aspect ratio it was measured with). */
    public struct CalibrationSet: Equatable, Sendable {
        public var crop: Double
        public var aspect: Double
        /** [focal, realFocal (0 = focal), model 0 poly3 / 1 poly5 / 2 ptlens, terms...] */
        public var distortion: [[Double]]
        /** [focal, model 0 linear / 1 poly3, vr, vb, cr, cb, br, bb] (linear: [focal, 0, kr, kb]) */
        public var tca: [[Double]]
        /** [focal, aperture, distance, k1, k2, k3] */
        public var vignetting: [[Double]]

        public init(crop: Double, aspect: Double, distortion: [[Double]] = [], tca: [[Double]] = [], vignetting: [[Double]] = []) {
            self.crop = crop
            self.aspect = aspect
            self.distortion = distortion
            self.tca = tca
            self.vignetting = vignetting
        }
    }

    private static func rows(_ v: Any?) -> [[Double]] {
        (v as? [[Any]] ?? []).map { $0.map { number($0) } }
    }

    /** The calibration sets of lens [lensId] in a calib-<file>.json. */
    public static func calibrations(_ chunk: Data, lensId: Int) throws -> [CalibrationSet] {
        guard let raw = try JSONSerialization.jsonObject(with: chunk) as? [String: Any] else {
            throw DataError(message: "The Lensfun database is not readable")
        }
        return (raw["\(lensId)"] as? [[Any]] ?? []).compactMap { s in
            guard s.count >= 5 else { return nil }
            return CalibrationSet(crop: number(s[0]), aspect: number(s[1]), distortion: rows(s[2]), tca: rows(s[3]), vignetting: rows(s[4]))
        }
    }

    // -----------------------------------------------------------------------------------------------------------------
    // Matching

    private static let stopWords: Set<String> = ["lens", "the", "for"]

    private static func isLetter(_ c: UInt8) -> Bool { c >= 97 && c <= 122 }
    private static func isDigit(_ c: UInt8) -> Bool { c >= 48 && c <= 57 }

    /** Lowercase letters and digits only: "XF18-55mmF2.8-4 R LM OIS" and "XF 18-55mm f/2.8-4 R LM OIS" both give the same. */
    public static func squash(_ s: String) -> String {
        String(decoding: s.lowercased().utf8.filter { isLetter($0) || isDigit($0) }, as: UTF8.self)
    }

    /** Runs of letters, and numbers with an optional decimal part (the web's /[a-z]+|\d+(?:\.\d+)?/g), without stop words. */
    static func tokens(_ s: String) -> [String] {
        let b = Array(s.lowercased().utf8)
        var out: [String] = []
        var i = 0
        while i < b.count {
            let start = i
            if isLetter(b[i]) {
                while i < b.count, isLetter(b[i]) { i += 1 }
            } else if isDigit(b[i]) {
                while i < b.count, isDigit(b[i]) { i += 1 }
                if i + 1 < b.count, b[i] == 46, isDigit(b[i + 1]) {
                    i += 1
                    while i < b.count, isDigit(b[i]) { i += 1 }
                }
            } else {
                i += 1
                continue
            }
            let t = String(decoding: b[start..<i], as: UTF8.self)
            if !stopWords.contains(t) { out.append(t) }
        }
        return out
    }

    private static let makers = [
        "canon", "nikon", "sony", "fuji", "olympus", "panasonic", "pentax", "ricoh", "leica", "sigma", "tamron", "tokina",
        "samsung", "kodak", "casio", "hasselblad", "zeiss", "samyang", "konica", "minolta", "om digital", "om system",
        "apple", "google",
    ]

    /** Makers' names as cameras write them in EXIF versus the database ("NIKON CORPORATION" → "nikon"). */
    static func makerKey(_ maker: String) -> String {
        let m = maker.lowercased()
        return makers.first { m.contains($0) } ?? squash(maker)
    }

    /** The database camera for the EXIF make and model, or nil. */
    public static func matchCamera(_ index: Index, make: String, model: String) -> Camera? {
        if model.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { return nil }
        let mk = makerKey(make)
        let sq = squash(model)
        let sqMake = squash(make)
        let sqNoMaker = sq.hasPrefix(sqMake) ? String(sq.dropFirst(sqMake.count)) : sq
        var best: Camera?
        var bestScore = 0.0
        for c in index.cameras {
            if makerKey(c.maker) != mk && mk != "" { continue }
            let cm = squash(c.model)
            var score = 0.0
            if cm == sq || cm == sqNoMaker {
                score = 3
            } else if squash(c.maker + c.model) == sq {
                score = 3
            }
            if score > 0 && !c.variant.isEmpty { score -= 0.1 }
            if score > bestScore {
                best = c
                bestScore = score
            }
        }
        return best
    }

    /** Mounts a lens of [mount] fits: the mount itself and the ones the database lists as compatible. */
    public static func compatibleMounts(_ index: Index, _ mount: String) -> [String] {
        [mount] + (index.mounts[mount] ?? [])
    }

    /**
     * The database lens for the EXIF lens make/model on [camera] (its mount decides which lenses can be on it), or nil.
     * [focal] (mm) must lie in the lens's range when it is known. Names are compared with punctuation and spaces removed,
     * then by shared words; below a score of 0.6 nothing is returned, because a wrong profile is worse than none.
     */
    public static func matchLens(_ index: Index, lensMake: String, lensModel: String, camera: Camera?, focal: Double = 0) -> Lens? {
        let name = lensModel.trimmingCharacters(in: .whitespacesAndNewlines)
        if name.isEmpty { return nil }
        let mounts = camera.map { compatibleMounts(index, $0.mount) }
        let sq = squash(name)
        let want = tokens(name)
        let wantMaker = lensMake.isEmpty ? nil : makerKey(lensMake)
        var best: Lens?
        var bestScore = 0.0
        for l in index.lenses {
            if let mounts, !l.mounts.contains(where: { mounts.contains($0) }) { continue }
            var score: Double
            let lm = squash(l.model)
            let full = squash(l.maker + l.model)
            if lm == sq || full == sq {
                score = 1
            } else if lm.isEmpty || sq.isEmpty || sq.contains(lm) || lm.contains(sq) {
                // An empty database name is "contained" in everything on the web (score 0.1); the same here.
                score = 0.9 * Double(min(lm.count, sq.count)) / Double(max(lm.count, sq.count, 1)) + 0.1
            } else {
                let have = tokens("\(l.maker) \(l.model)")
                let common = want.filter { have.contains($0) }.count
                score = Double(common) / Double(max(want.count, have.count, 1))
            }
            if let wantMaker { score += makerKey(l.maker) == wantMaker ? 0.05 : -0.35 }
            if focal > 0 && l.maxFocal > 0 && (focal < l.minFocal - 0.5 || focal > l.maxFocal + 0.5) { score -= 0.5 }
            if let camera, abs(log(camera.crop / l.crop)) < 0.05 { score += 0.03 }
            if score > bestScore {
                best = l
                bestScore = score
            }
        }
        return bestScore >= 0.6 ? best : nil
    }

    /** Case-insensitive search by words, for the pickers: every word must appear in "maker model". */
    public static func searchByWords<T>(_ items: [T], _ query: String, limit: Int = 50, text: (T) -> String) -> [T] {
        let words = query.lowercased().split(whereSeparator: { $0.isWhitespace }).map(String.init)
        var out: [T] = []
        for item in items {
            let t = text(item).lowercased()
            if words.allSatisfy({ t.contains($0) }) {
                out.append(item)
                if out.count >= limit { break }
            }
        }
        return out
    }

    // -----------------------------------------------------------------------------------------------------------------
    // Correction

    /** The photo a profile is worked out for. */
    public struct Shot: Sendable {
        /** Crop factor of the sensor (35 mm frame = 1): sets the sensor's size, and so what a pixel is in millimetres. */
        public var crop: Double
        /** Focal length in mm (as the lens reports it, not 35 mm equivalent). */
        public var focal: Double
        public var aperture: Double
        /** Focus distance in metres (1000 = infinity). */
        public var distance: Double

        public init(crop: Double, focal: Double, aperture: Double, distance: Double = 1000) {
            self.crop = crop
            self.focal = focal
            self.aperture = aperture
            self.distance = distance
        }
    }

    static let halfDiagonal35mm = hypot(36.0, 24.0) / 2

    /** The calibration set of the closest crop factor that is not much smaller than the lens's (Lensfun's rule), or nil. */
    private static func pickSet(_ sets: [CalibrationSet], _ crop: Double, _ has: (CalibrationSet) -> Bool) -> CalibrationSet? {
        var best: CalibrationSet?
        var ratio = 1e6
        for s in sets {
            let r = crop / s.crop
            if has(s) && r >= 0.96 && r < ratio {
                ratio = r
                best = s
            }
        }
        return best
    }

    /** Linear interpolation weights of [focal] between the entries of a list sorted by focal (index 0 of each entry). */
    private static func bracket(_ entries: [[Double]], _ focal: Double) -> ([Double], [Double], Double) {
        let sorted = entries.sorted { $0[0] < $1[0] }
        if focal <= sorted[0][0] { return (sorted[0], sorted[0], 0) }
        let last = sorted[sorted.count - 1]
        if focal >= last[0] { return (last, last, 0) }
        var i = 0
        while sorted[i + 1][0] < focal { i += 1 }
        let a = sorted[i]
        let b = sorted[i + 1]
        return (a, b, (focal - a[0]) / (b[0] - a[0]))
    }

    /** Term [i] of an entry, 0 when the entry is shorter. */
    private static func term(_ e: [Double], _ i: Int) -> Double { i < e.count ? e[i] : 0 }

    /**
     * Distortion as a function of the normalised radius: the multiplier of the position (output → source), with u = 1 at
     * the corner of the sensor. Evaluates a calibration entry the way Lensfun does after "rescale_polynomial_coefficients":
     * Terms are put on the photo's sensor and the real focal length, and the ptlens/poly3 constant is moved into the
     * other terms (so the corrected picture is enlarged by it).
     */
    public static func distortionFactor(_ entry: [Double], _ set: CalibrationSet, shotCrop: Double, realFocal: Double) -> (Double) -> Double {
        let model = Int(term(entry, 2))
        let t0 = term(entry, 3), t1 = term(entry, 4), t2 = term(entry, 5)
        // Hugin's unit: half the calibration sensor's short side, in mm.
        let huginMm = halfDiagonal35mm / set.crop / hypot(set.aspect, 1)
        let hs = realFocal / huginMm
        // u = 1 is the corner of this photo's sensor.
        let s = halfDiagonal35mm / shotCrop / realFocal
        if model == 0 {
            let d = 1 - t0
            let k = (t0 * hs * hs) / (d * d * d)
            return { u in 1 + k * (u * s) * (u * s) }
        }
        if model == 1 {
            let k1 = t0 * pow(hs, 2)
            let k2 = t1 * pow(hs, 4)
            return { u in
                let r2 = (u * s) * (u * s)
                return 1 + r2 * (k1 + r2 * k2)
            }
        }
        let d = 1 - t0 - t1 - t2
        let a = (t0 * pow(hs, 3)) / pow(d, 4)
        let b = (t1 * pow(hs, 2)) / pow(d, 3)
        let c = (t2 * hs) / pow(d, 2)
        return { u in
            let r = u * s
            return 1 + r * (c + r * (b + r * a))
        }
    }

    /** Lateral CA of one plane (0 red, 2 blue): the extra multiplier at the radius the distortion left the point at. */
    private static func tcaFactor(_ entry: [Double], _ set: CalibrationSet, shotCrop: Double, realFocal: Double, plane: Int) -> (Double) -> Double {
        let huginMm = halfDiagonal35mm / set.crop / hypot(set.aspect, 1)
        let hs = realFocal / huginMm
        let s = halfDiagonal35mm / shotCrop / realFocal
        if term(entry, 1) == 0 {
            let k = plane == 0 ? term(entry, 2) : term(entry, 3)
            return { _ in k }
        }
        let v = plane == 0 ? term(entry, 2) : term(entry, 3)
        let c = (plane == 0 ? term(entry, 4) : term(entry, 5)) * hs
        let b = (plane == 0 ? term(entry, 6) : term(entry, 7)) * hs * hs
        return { rd in
            let r = rd * s
            return b * r * r + c * r + v
        }
    }

    /** Vignetting gain 1 / (1 + k1 r² + k2 r⁴ + k3 r⁶) of one "pa" entry; r = 1 at the corner of the photo's sensor. */
    private static func vignetteGain(_ entry: [Double], _ set: CalibrationSet, shotCrop: Double) -> (Double) -> Double {
        let scale = set.crop / shotCrop
        let k1 = term(entry, 3), k2 = term(entry, 4), k3 = term(entry, 5)
        return { u in
            let r2 = (u * scale) * (u * scale)
            return 1 / (1 + r2 * (k1 + r2 * (k2 + r2 * k3)))
        }
    }

    private static let sampleCount = 41
    private static let samples: [Double] = (0..<sampleCount).map { Double($0) / Double(sampleCount - 1) }

    /** Weighted least squares fit of f(u) ≈ Σ c_i u^(2 i + 2 * first) over the samples; [first] 0 includes the constant term. */
    public static func fitEven(_ f: (Double) -> Double, terms n: Int, first: Int, weight: (Double) -> Double = { _ in 1 }) -> [Double] {
        var A = [[Double]](repeating: [Double](repeating: 0, count: n + 1), count: n)
        for u in samples {
            let basis = (0..<n).map { pow(u, Double(2 * ($0 + first))) }
            let y = f(u) - (first == 1 ? 1 : 0)
            let w = weight(u)
            for i in 0..<n {
                for j in 0..<n { A[i][j] += w * basis[i] * basis[j] }
                A[i][n] += w * basis[i] * y
            }
        }
        for i in 0..<n {
            var p = i
            for r in (i + 1)..<n where abs(A[r][i]) > abs(A[p][i]) { p = r }
            A.swapAt(i, p)
            for r in (i + 1)..<n {
                let m = A[r][i] / A[i][i]
                for c in i...n { A[r][c] -= m * A[i][c] }
            }
        }
        var x = [Double](repeating: 0, count: n)
        for i in stride(from: n - 1, through: 0, by: -1) {
            var sum = A[i][n]
            for j in (i + 1)..<n { sum -= A[i][j] * x[j] }
            x[i] = sum / A[i][i]
        }
        return x
    }

    public struct Correction: Sendable {
        /** Distortion and lateral CA as a DNG-style warp (3 planes with CA data, else 1), in sensor coordinates; nil = none. */
        public let warp: LensInfo.Warp?
        public let vignette: LensInfo.RadialVignette?
        /** What was found for this lens, e.g. "distortion, chromatic aberration, vignetting"; empty = nothing. */
        public let summary: String
        /** Largest deviation of the fitted warp from the model over the frame, as a fraction of the half diagonal. */
        public let warpError: Double
        /** The real focal length used (mm). */
        public let realFocal: Double
    }

    /**
     * The correction of a lens [sets] for [shot]. The lens's calibrations are interpolated linearly between the two
     * nearest focal lengths (Lensfun uses a spline), vignetting by inverse distance weights over focal length, aperture
     * and distance as Lensfun does. [lens] gives the focal range the vignetting's distances are normalised by.
     */
    public static func correction(_ sets: [CalibrationSet], _ shot: Shot, lens: Lens? = nil) -> Correction {
        var found: [String] = []
        let dset = pickSet(sets, shot.crop) { !$0.distortion.isEmpty }
        let tset = pickSet(sets, shot.crop) { !$0.tca.isEmpty }
        let vset = pickSet(sets, shot.crop) { !$0.vignetting.isEmpty }

        // Distortion, with the real focal length it implies.
        var realFocal = shot.focal
        var dist: ((Double) -> Double)?
        if let dset {
            let (a, b, w) = bracket(dset.distortion, shot.focal)
            let ra = term(a, 1) != 0 ? term(a, 1) : a[0]
            let rb = term(b, 1) != 0 ? term(b, 1) : b[0]
            // The real focal length follows the nominal one's ratio, interpolated.
            realFocal = ra + (rb - ra) * w
            let fa = distortionFactor(a, dset, shotCrop: shot.crop, realFocal: realFocal)
            let fb = distortionFactor(b, dset, shotCrop: shot.crop, realFocal: realFocal)
            dist = { u in fa(u) + (fb(u) - fa(u)) * w }
            found.append("distortion")
        }

        // Lateral CA.
        var tca: (r: (Double) -> Double, b: (Double) -> Double)?
        if let tset {
            let (a, b, w) = bracket(tset.tca, shot.focal)
            let focal = realFocal
            func lerp(_ plane: Int) -> (Double) -> Double {
                let fa = tcaFactor(a, tset, shotCrop: shot.crop, realFocal: focal, plane: plane)
                let fb = tcaFactor(b, tset, shotCrop: shot.crop, realFocal: focal, plane: plane)
                return { x in fa(x) + (fb(x) - fa(x)) * w }
            }
            tca = (r: lerp(0), b: lerp(2))
            found.append("chromatic aberration")
        }

        var warp: LensInfo.Warp?
        var warpError = 0.0
        if dist != nil || tca != nil {
            let fd: (Double) -> Double = dist ?? { _ in 1 }
            var planes: [(Double) -> Double] = [fd]
            if let tca {
                planes = [{ u in fd(u) * tca.r(u * fd(u)) }, fd, { u in fd(u) * tca.b(u * fd(u)) }]
            }
            var coefficients: [Double] = []
            for f in planes {
                // Weighted by u²: the error that shows is the position's (u f(u)), which the centre barely has.
                let k = fitEven(f, terms: 4, first: 0, weight: { u in u * u + 0.02 })
                coefficients += k + [0, 0]
                for u in samples {
                    let fit = k[0] + u * u * (k[1] + u * u * (k[2] + u * u * k[3]))
                    warpError = max(warpError, abs(fit - f(u)) * u)
                }
            }
            // LensInfo's warp always carries three planes' worth of terms (18), as the native bridge fills it.
            while coefficients.count < 18 { coefficients.append(0) }
            warp = LensInfo.Warp(planes: planes.count, coefficients: coefficients, centerX: 0.5, centerY: 0.5)
        }

        // Vignetting: inverse distance weighting (power 3.5) over focal length, aperture and distance, as Lensfun.
        var vignette: LensInfo.RadialVignette?
        if let vset {
            let lo = lens?.minFocal ?? 0
            let df = (lens?.maxFocal ?? 0) - lo
            let norm: (Double) -> Double = { f in df > 0 ? (f - lo) / df : f }
            var gains: [(w: Double, g: (Double) -> Double)] = []
            for e in vset.vignetting {
                let dFocal = norm(e[0]) - norm(shot.focal)
                let dAperture = 4 / term(e, 1) - 4 / shot.aperture
                let dDistance = 0.1 / term(e, 2) - 0.1 / shot.distance
                let d = (dFocal * dFocal + dAperture * dAperture + dDistance * dDistance).squareRoot()
                let g = vignetteGain(e, vset, shotCrop: shot.crop)
                if d < 1e-4 {
                    gains = [(w: 1.0, g: g)]
                    break
                }
                gains.append((w: 1 / pow(d, 3.5), g: g))
            }
            let total = gains.reduce(0) { $0 + $1.w }
            let all = gains
            let gain: (Double) -> Double = { u in all.reduce(0) { $0 + $1.w * $1.g(u) } / total }
            vignette = LensInfo.RadialVignette(k: fitEven(gain, terms: 5, first: 1), centerX: 0.5, centerY: 0.5)
            found.append("vignetting")
        }
        return Correction(warp: warp, vignette: vignette, summary: found.joined(separator: ", "), warpError: warpError, realFocal: realFocal)
    }

    // -----------------------------------------------------------------------------------------------------------------
    // Generic lenses

    /** A lens that is not in the database, described by hand. */
    public struct GenericLens: Equatable, Codable, Sendable {
        /** Crop factor of the sensor (35 mm frame = 1). */
        public var crop = 1.0
        /** Focal length, mm. */
        public var focal = 50.0
        public var aperture = 2.8
        public var type = LensType.rectilinear.rawValue
        /** Optional PTLens distortion coefficients (Rd = Ru (a Ru³ + b Ru² + c Ru + 1 - a - b - c), Ru in half-short-side units). */
        public var a = 0.0
        public var b = 0.0
        public var c = 0.0
        /** Optional vignetting terms (gain 1 / (1 + k1 r² + k2 r⁴ + k3 r⁶), r = 1 at the corner). */
        public var k1 = 0.0
        public var k2 = 0.0
        public var k3 = 0.0

        public init() {}

        public var lensType: LensType {
            get { LensType(rawValue: type) ?? .rectilinear }
            set { type = newValue.rawValue }
        }
    }

    /** Crop factor of a sensor [width] x [height] mm (the 35 mm frame is 36 x 24). */
    public static func cropFactor(width: Double, height: Double) -> Double {
        width > 0 && height > 0 ? hypot(36.0, 24.0) / hypot(width, height) : 1
    }

    /** Calibration sets for [g]'s coefficients: the same data a database lens has, at its one focal length and aperture. */
    public static func genericCalibration(_ g: GenericLens) -> [CalibrationSet] {
        let hasDist = g.a != 0 || g.b != 0 || g.c != 0
        let hasVig = g.k1 != 0 || g.k2 != 0 || g.k3 != 0
        if !hasDist && !hasVig { return [] }
        return [CalibrationSet(
            crop: g.crop, aspect: 1.5,
            distortion: hasDist ? [[g.focal, 0, 2, g.a, g.b, g.c]] : [],
            tca: [],
            vignetting: hasVig ? [[g.focal, g.aperture, 1000, g.k1, g.k2, g.k3]] : [])]
    }

    /**
     * Field of view across the sensor diagonal, degrees, of a fisheye of [type] and [focal] mm on a sensor of [crop]:
     * equidistant r = f θ ("fisheye"), equisolid r = 2 f sin(θ/2), stereographic r = 2 f tan(θ/2), orthographic r = f sin θ.
     * 0 for a type that is not a fisheye.
     */
    public static func fisheyeFov(_ type: LensType, focal: Double, crop: Double) -> Double {
        if !(focal > 0) || !(crop > 0) { return 0 }
        let r = halfDiagonal35mm / crop
        let theta: Double
        switch type {
        case .fisheye: theta = r / focal
        case .equisolid: theta = 2 * asin(min(1, r / (2 * focal)))
        case .stereographic: theta = 2 * atan(r / (2 * focal))
        case .orthographic: theta = asin(min(1, r / focal))
        default: return 0
        }
        return 2 * theta * 180 / .pi
    }
}
