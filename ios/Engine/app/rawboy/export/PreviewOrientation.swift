import Foundation

/**
 * EXIF/TIFF orientation helpers for DNG embedded previews.
 *
 * Per the DNG specification, IFD0's Orientation tag (274) applies to both the raw SubIFD and every embedded preview
 * IFD. RawBoy renders developed previews upright (display orientation), so before embedding a preview into a DNG with
 * IFD0 orientation `o`, the preview pixels must be transformed by `inverse(o)` back into sensor orientation.
 */
public enum PreviewOrientation {
    /** TIFF orientation 1..8 that undoes [orientation] (so applying [orientation] afterwards recovers the original). */
    public static func inverse(_ orientation: Int) -> Int {
        switch orientation {
        case 6: return 8
        case 8: return 6
        case 1...8: return orientation
        default: return 1
        }
    }

    /** Output `(width, height)` after applying TIFF [orientation] to a `[width] x [height]` image. */
    public static func outputSize(width: Int, height: Int, orientation: Int) -> (Int, Int) {
        (5...8).contains(orientation) ? (height, width) : (width, height)
    }

    /**
     * Scatters [rows] rows of 16-bit unsigned RGB [band] (starting at row [y] of a `[srcWidth] x [srcHeight]` image)
     * into 8-bit RGB [dst] after applying TIFF [orientation] (1..8). [dst] must have size `srcWidth * srcHeight * 3`.
     */
    public static func scatterBandToRgb8(
        band: UnsafePointer<UInt16>,
        y: Int,
        rows: Int,
        srcWidth: Int,
        srcHeight: Int,
        orientation: Int,
        dst: UnsafeMutablePointer<UInt8>
    ) {
        let dstWidth = (5...8).contains(orientation) ? srcHeight : srcWidth
        var s = 0
        for row in 0..<rows {
            let sy = y + row
            let start = destOffset(sx: 0, sy: sy, w: srcWidth, h: srcHeight, dstW: dstWidth, o: orientation)
            let step = srcWidth > 1
                ? destOffset(sx: 1, sy: sy, w: srcWidth, h: srcHeight, dstW: dstWidth, o: orientation) - start
                : 3
            var d = start
            for _ in 0..<srcWidth {
                dst[d] = to8(band[s])
                dst[d + 1] = to8(band[s + 1])
                dst[d + 2] = to8(band[s + 2])
                s += 3
                d += step
            }
        }
    }

    private static func destOffset(sx: Int, sy: Int, w: Int, h: Int, dstW: Int, o: Int) -> Int {
        let dx: Int
        let dy: Int
        switch o {
        case 2: dx = w - 1 - sx; dy = sy
        case 3: dx = w - 1 - sx; dy = h - 1 - sy
        case 4: dx = sx; dy = h - 1 - sy
        case 5: dx = sy; dy = sx
        case 6: dx = h - 1 - sy; dy = sx
        case 7: dx = h - 1 - sy; dy = w - 1 - sx
        case 8: dx = sy; dy = w - 1 - sx
        default: dx = sx; dy = sy
        }
        return (dy * dstW + dx) * 3
    }

    private static func to8(_ s: UInt16) -> UInt8 {
        UInt8((Int(s) * 255 + 32767) / 65535)
    }
}
