import Foundation

/**
 * Steps through a list from the wheel, one item per click (RawBoy Desktop's film stocks; port of `stepWheel` in web's
 * `ParamSlider.ts`). Pure, so it is tested without events. Positive steps go forward (wheel down), negative back.
 *
 * A mouse wheel (`precise` false) steps once per event, however far the system accelerated its delta. A trackpad or
 * Magic Mouse (`precise`, pixel deltas) steps at the start of a gesture and then every `stepPoints` of travel, so a
 * swipe moves through a handful of items, not dozens.
 */
public struct WheelStepper: Equatable, Sendable {
    /** Travel of a precise (trackpad) scroll per step after the first, in points. */
    public static let stepPoints: Double = 40
    /** A pause (seconds) between precise events that starts a new gesture. */
    public static let idleSeconds: TimeInterval = 0.12

    private var acc: Double = 0
    private var lastTime: TimeInterval = -.infinity
    private var dir: Int = 0

    public init() {}

    /** `delta`: points or clicks, positive = forward. Returns the steps to take (0 while a trackpad accumulates). */
    public mutating func step(delta: Double, precise: Bool, time: TimeInterval) -> Int {
        guard delta != 0, delta.isFinite else { return 0 }
        let d = delta > 0 ? 1 : -1
        defer { lastTime = time; dir = d }
        if !precise {
            acc = 0
            return d
        }
        if time - lastTime > Self.idleSeconds || dir != d {
            acc = 0
            return d
        }
        let total = acc + delta
        let steps = Int((total / Self.stepPoints).rounded(.towardZero))
        acc = total - Double(steps) * Self.stepPoints
        return steps
    }

    public mutating func reset() { self = WheelStepper() }

    /** The id `steps` places from `current` in `ids`, clamped to the ends; nil when it would stay where it is. */
    public static func target(in ids: [String], current: String, steps: Int) -> String? {
        guard steps != 0, let i = ids.firstIndex(of: current) else { return nil }
        let j = max(0, min(ids.count - 1, i + steps))
        return j == i ? nil : ids[j]
    }
}
