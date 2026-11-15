import Foundation

/**
 * What Portrait retouch needs to know about one face, in fractions of the image (display orientation): the regions
 * it works on hang on these points, and its size scales everything (`width`). Made from MediaPipe's 478-point mesh
 * (`init(mesh:)`, as web's PortraitRetouch indexes it) or from Apple's Vision landmarks (`VisionFaces`, macOS).
 */
public struct FaceShape: Equatable, Sendable {
    public typealias Point = SIMD2<Float>

    /** Lower eyelids from the outer to the inner corner, nine points each. */
    public var lowerLidRight: [Point]
    public var lowerLidLeft: [Point]
    /** Centres of the line areas: frown (between the brows), forehead, nasolabial (each side), marionette (each side). */
    public var glabella: Point
    public var forehead: Point
    public var nasolabialRight: Point
    public var nasolabialLeft: Point
    public var marionetteRight: Point
    public var marionetteLeft: Point
    /** Horizontal extent of the face (fraction of the image width). */
    public var width: Float

    public init(lowerLidRight: [Point], lowerLidLeft: [Point], glabella: Point, forehead: Point, nasolabialRight: Point,
                nasolabialLeft: Point, marionetteRight: Point, marionetteLeft: Point, width: Float) {
        self.lowerLidRight = lowerLidRight
        self.lowerLidLeft = lowerLidLeft
        self.glabella = glabella
        self.forehead = forehead
        self.nasolabialRight = nasolabialRight
        self.nasolabialLeft = nasolabialLeft
        self.marionetteRight = marionetteRight
        self.marionetteLeft = marionetteLeft
        self.width = width
    }

    // MediaPipe face mesh: lower lids (outer to inner corner).
    private static let rightLowerLid = [33, 7, 163, 144, 145, 153, 154, 155, 133]
    private static let leftLowerLid = [263, 249, 390, 373, 374, 380, 381, 382, 362]

    /** From MediaPipe's mesh: [xy] = x, y pairs (478 points) in fractions of the image; the indices are web's. */
    public init?(mesh xy: [Float]) {
        guard xy.count >= 478 * 2 else { return nil }
        func pt(_ i: Int) -> Point { Point(xy[i * 2], xy[i * 2 + 1]) }
        func mid(_ a: Int, _ b: Int) -> Point { (pt(a) + pt(b)) / 2 }
        func toward(_ a: Int, _ b: Int, _ t: Float) -> Point { pt(a) + (pt(b) - pt(a)) * t }
        var lo = Float.infinity, hi = -Float.infinity
        for i in stride(from: 0, to: xy.count, by: 2) {
            lo = min(lo, xy[i])
            hi = max(hi, xy[i])
        }
        self.init(lowerLidRight: Self.rightLowerLid.map(pt), lowerLidLeft: Self.leftLowerLid.map(pt),
                  glabella: mid(9, 8), forehead: toward(151, 9, -0.3), nasolabialRight: mid(205, 216),
                  nasolabialLeft: mid(425, 436), marionetteRight: toward(57, 152, 0.35),
                  marionetteLeft: toward(287, 152, 0.35), width: hi - lo)
    }
}
