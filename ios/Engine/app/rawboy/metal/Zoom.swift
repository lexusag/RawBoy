import Foundation
import Metal

/** A full-resolution region (RGB half floats) used for the zoomed view. */
public struct DetailTile: @unchecked Sendable {
    public let rect: PixelRect
    public let pixels: [UInt16]
    /**
     * The pixels as a texture, made where the tile is loaded: converting ~10 MP to RGBA on the main thread stalled
     * panning at 100%.
     */
    public let texture: MTLTexture
}

public struct PixelRect: Equatable, Hashable, Sendable {
    public let x: Int
    public let y: Int
    public let width: Int
    public let height: Int

    public init(x: Int, y: Int, width: Int, height: Int) {
        self.x = x
        self.y = y
        self.width = width
        self.height = height
    }

    public var right: Int { x + width }
    public var bottom: Int { y + height }

    public func contains(_ o: PixelRect) -> Bool { o.x >= x && o.y >= y && o.right <= right && o.bottom <= bottom }
}

/**
 * Geometry of the zoomed view, centred on (cx, cy) in full-resolution coordinates: [scale] screen pixels per
 * full-resolution pixel, 1 = the 100% view (double tap); a pinch zooms to other scales.
 */
public enum ZoomMath {
    /** Pinch zoom's limit, screen pixels per full-resolution pixel (out past the fit view goes back to it). */
    public static let maxScale: Float = 4

    /** Margin kept around the visible region so denoise has real neighbours. */
    public static let halo = 16
    private static let minTile = 2048
    private static let tileSlack = 512

    /**
     * Keeps the visible region inside the image. [frame]: the band the zoomed view keeps around the photo on every
     * side, pixels, so the photo shows inside the view minus the frame.
     */
    public static func clampCenter(cx: Float, cy: Float, viewW: Int, viewH: Int, imgW: Int, imgH: Int,
                                   scale: Float = 1, frame: Int = 0) -> (Float, Float) {
        let halfW = min(Float(inner(viewW, frame)) / scale, Float(imgW)) / 2
        let halfH = min(Float(inner(viewH, frame)) / scale, Float(imgH)) / 2
        return (cx.clamped(halfW, Float(imgW) - halfW), cy.clamped(halfH, Float(imgH) - halfH))
    }

    /**
     * The full-resolution region visible on screen (inside the [frame], as for [clampCenter]), as [x, y, width,
     * height]: whole pixels at 100%, fractional at other scales (whole ones would make panning jump [scale] screen
     * pixels at a time).
     */
    public static func viewRectF(cx: Float, cy: Float, viewW: Int, viewH: Int, imgW: Int, imgH: Int,
                                 scale: Float = 1, frame: Int = 0) -> [Float] {
        if scale == 1 {
            let v = viewRect(cx: cx, cy: cy, viewW: viewW, viewH: viewH, imgW: imgW, imgH: imgH, frame: frame)
            return [Float(v.x), Float(v.y), Float(v.width), Float(v.height)]
        }
        let w = min(Float(inner(viewW, frame)) / scale, Float(imgW))
        let h = min(Float(inner(viewH, frame)) / scale, Float(imgH))
        return [(cx - w / 2).clamped(0, Float(imgW) - w), (cy - h / 2).clamped(0, Float(imgH) - h), w, h]
    }

    /** [viewRectF] in whole pixels: exact at 100%, the pixels it touches at other scales. */
    public static func viewRect(cx: Float, cy: Float, viewW: Int, viewH: Int, imgW: Int, imgH: Int,
                                scale: Float = 1, frame: Int = 0) -> PixelRect {
        if scale != 1 {
            let v = viewRectF(cx: cx, cy: cy, viewW: viewW, viewH: viewH, imgW: imgW, imgH: imgH, scale: scale, frame: frame)
            let x0 = Int(v[0].rounded(.down)).clamped(0, imgW - 1)
            let y0 = Int(v[1].rounded(.down)).clamped(0, imgH - 1)
            let x1 = Int((v[0] + v[2]).rounded(.up)).clamped(x0 + 1, imgW)
            let y1 = Int((v[1] + v[3]).rounded(.up)).clamped(y0 + 1, imgH)
            return PixelRect(x: x0, y: y0, width: x1 - x0, height: y1 - y0)
        }
        let w = min(inner(viewW, frame), imgW)
        let h = min(inner(viewH, frame), imgH)
        let x = Int((cx - Float(w) / 2).rounded()).clamped(0, imgW - w)
        let y = Int((cy - Float(h) / 2).rounded()).clamped(0, imgH - h)
        return PixelRect(x: x, y: y, width: w, height: h)
    }

    private static func inner(_ size: Int, _ frame: Int) -> Int { max(1, size - 2 * frame) }

    /**
     * Where the whole output image sits in the zoomed view ([scale] view pixels per image pixel), as [left, top,
     * width, height] in view pixels: the visible region is centred like DevelopRenderer.drawZoomed's quad.
     */
    public static func zoomedRect(cx: Float, cy: Float, viewW: Int, viewH: Int, imgW: Int, imgH: Int,
                                  scale: Float = 1, frame: Int = 0) -> [Float] {
        let v = viewRectF(cx: cx, cy: cy, viewW: viewW, viewH: viewH, imgW: imgW, imgH: imgH, scale: scale, frame: frame)
        return [(Float(viewW) - v[2] * scale) / 2 - v[0] * scale, (Float(viewH) - v[3] * scale) / 2 - v[1] * scale,
                Float(imgW) * scale, Float(imgH) * scale]
    }

    /** The zoomed view's label: "100%", or a pinch's scale in percent. */
    public static func label(_ scale: Float) -> String { scale == 1 ? "100%" : "\(Int((scale * 100).rounded()))%" }

    /** The fit view's scale: view pixels per full-resolution pixel. */
    public static func fitScale(viewW: Int, viewH: Int, imgW: Int, imgH: Int, frame: Int) -> Float {
        fitRect(viewW: viewW, viewH: viewH, imgW: imgW, imgH: imgH, frame: frame)[2] / Float(imgW)
    }

    /**
     * Whether the downscaled preview is sharp enough at [scale] (a pinch between fit and 100%): at most a quarter
     * upsampled. Above it the view needs a full-resolution tile.
     */
    public static func previewSuffices(_ scale: Float, previewWidth: Int, fullWidth: Int) -> Bool {
        scale <= 1.25 * Float(previewWidth) / Float(fullWidth)
    }

    /** A tile around [needed] (source pixels), large enough that panning rarely reloads. */
    public static func tileAround(_ needed: PixelRect, imgW: Int, imgH: Int) -> PixelRect {
        let w = min(imgW, max(minTile, needed.width + tileSlack))
        let h = min(imgH, max(minTile, needed.height + tileSlack))
        let x = (needed.x + needed.width / 2 - w / 2).clamped(0, imgW - w)
        let y = (needed.y + needed.height / 2 - h / 2).clamped(0, imgH - h)
        return PixelRect(x: x, y: y, width: w, height: h)
    }

    /**
     * Where the photo sits in the fit view: aspect-fit inside the view minus a [frame]
     * on every side, centred. Returns (left, top, width, height) in view pixels.
     */
    public static func fitRect(viewW: Int, viewH: Int, imgW: Int, imgH: Int, frame: Int) -> [Float] {
        let availW = Float(max(1, viewW - 2 * frame))
        let availH = Float(max(1, viewH - 2 * frame))
        let scale = min(availW / Float(imgW), availH / Float(imgH))
        let w = Float(imgW) * scale
        let h = Float(imgH) * scale
        return [(Float(viewW) - w) / 2, (Float(viewH) - h) / 2, w, h]
    }

    /** Maps a point in the fit view to full-resolution coordinates, or nil if outside the photo. */
    public static func fitToImage(px: Float, py: Float, viewW: Int, viewH: Int, imgW: Int, imgH: Int,
                                  frame: Int) -> (Float, Float)? {
        let r = fitRect(viewW: viewW, viewH: viewH, imgW: imgW, imgH: imgH, frame: frame)
        let x = (px - r[0]) / r[2] * Float(imgW)
        let y = (py - r[1]) / r[3] * Float(imgH)
        return (0...Float(imgW)).contains(x) && (0...Float(imgH)).contains(y) ? (x, y) : nil
    }
}
