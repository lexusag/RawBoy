import Foundation

/**
 * Pro's white balance picker (port of WhitePicker.kt): the user taps something neutral grey and the temperature and
 * tint are set so it renders grey. Samples the decoded image (linear, as-shot balanced, before any develop step),
 * averaged over a small square so noise and texture don't decide the result.
 */
public enum WhitePicker {
    /** Side of the averaged square, as a fraction of the image's short side (~40 px on a 24 MP photo). */
    public static let spotSize: Float = 0.01
    /** Pixels with a channel at or above this (1.0 = sensor clip) are left out: blown highlights aren't neutral. */
    public static let clip: Float = 0.95

    public enum Pick: Equatable, Sendable {
        case white(kelvin: Float, tint: Float)
        /** Every pixel in the square is clipped. */
        case clipped
        /** No white balance makes the spot grey (black, or a strongly saturated colour). */
        case notNeutral
    }

    /** Full-resolution box [x0, x1) × [y0, y1) to sample around image pixel (x, y), kept inside the image. */
    public static func box(_ x: Float, _ y: Float, _ width: Int, _ height: Int) -> (x0: Int, x1: Int, y0: Int, y1: Int) {
        MeterArea.spot(x: x / Float(width), y: y / Float(height), size: spotSize).box(width, height)
    }

    /** rgb: the box's pixels (RGB triplets, linear Rec.2020 as decoded); as-shot white from the photo's defaults. */
    public static func pick(_ rgb: [Float], asShotKelvin: Float, asShotTint: Float) -> Pick {
        var sum = [0.0, 0.0, 0.0]
        var n = 0
        for i in 0..<(rgb.count / 3) {
            let r = rgb[i * 3]
            let g = rgb[i * 3 + 1]
            let b = rgb[i * 3 + 2]
            if r >= clip || g >= clip || b >= clip { continue }
            sum[0] += Double(r)
            sum[1] += Double(g)
            sum[2] += Double(b)
            n += 1
        }
        return pickFromSum(sum, n, asShotKelvin: asShotKelvin, asShotTint: asShotTint)
    }

    /** Solves for the white balance from summed RGB of [n] unclipped samples (none = clipped). */
    public static func pickFromSum(_ sum: [Double], _ n: Int, asShotKelvin: Float, asShotTint: Float) -> Pick {
        if n == 0 { return .clipped }
        let mean = sum.map { $0 / Double(n) }
        guard let wb = WhiteBalance.neutralTempTint(asShotKelvin: Double(asShotKelvin), asShotTint: Double(asShotTint), rgb: mean)
        else { return .notNeutral }
        return .white(kelvin: Float(wb[0]), tint: Float(wb[1]))
    }

    /**
     * Auto white balance for an area of the photo ([rect], fractions 0..1 of [lens]'s output picture), sampled from the
     * 512 px [base] copy before any develop step; nil for an empty area. Web: PhotoSession.ts autoWhiteArea.
     */
    public static func area(base: PreviewImage, imageWidth: Int, imageHeight: Int, lens: LensTransform, rect: CropRect,
                            asShotKelvin: Float, asShotTint: Float) -> Pick? {
        let w = Double(lens.outputWidth)
        let h = Double(lens.outputHeight)
        func unit(_ v: Float) -> Double { Double(min(max(v, 0), 1)) }
        let minX = unit(rect.left) * w
        let maxX = unit(rect.right) * w
        let minY = unit(rect.top) * h
        let maxY = unit(rect.bottom) * h
        if maxX <= minX || maxY <= minY { return nil }
        let stepsX = max(1, min(64, Int(maxX - minX)))
        let stepsY = max(1, min(64, Int(maxY - minY)))
        let dx = (maxX - minX) / Double(stepsX)
        let dy = (maxY - minY) / Double(stepsY)
        let iw = Double(imageWidth)
        let ih = Double(imageHeight)
        var sum = [0.0, 0.0, 0.0]
        var n = 0
        for iy in 0...stepsY {
            let outY = minY + Double(iy) * dy
            for ix in 0...stepsX {
                let src = lens.source(minX + Double(ix) * dx, outY)
                if lens.clipFrame && (src[0] < 0 || src[1] < 0 || src[0] > iw || src[1] > ih) { continue }
                guard src[0].isFinite, src[1].isFinite else { continue }
                let bx = min(max(Int(src[0] / iw * Double(base.width)), 0), base.width - 1)
                let by = min(max(Int(src[1] / ih * Double(base.height)), 0), base.height - 1)
                let i = (by * base.width + bx) * 3
                let r = Float(Float16(bitPattern: base.pixels[i]))
                let g = Float(Float16(bitPattern: base.pixels[i + 1]))
                let b = Float(Float16(bitPattern: base.pixels[i + 2]))
                if r < 0 || g < 0 || b < 0 || r >= clip || g >= clip || b >= clip { continue }
                sum[0] += Double(r)
                sum[1] += Double(g)
                sum[2] += Double(b)
                n += 1
            }
        }
        return pickFromSum(sum, n, asShotKelvin: asShotKelvin, asShotTint: asShotTint)
    }
}
