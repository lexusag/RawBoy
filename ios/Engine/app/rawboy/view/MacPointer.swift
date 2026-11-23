#if os(macOS)
import AppKit
import SwiftUI

/**
 * Mouse and trackpad over the photo: where the pointer is (Z zooms there), the wheel zooms around it (a quarter step of
 * 1.25 per notch like the web; Cmd or a trackpad pinch too), the middle button pans. Looks at events with a local monitor,
 * so it needs no hit-testing of its own and the photo's gestures keep working.
 */
public struct PointerSurface: NSViewRepresentable {
    var onMove: (CGPoint?) -> Void
    var onZoom: (CGPoint, CGFloat) -> Void
    var onPan: (CGSize) -> Void

    public init(onMove: @escaping (CGPoint?) -> Void, onZoom: @escaping (CGPoint, CGFloat) -> Void, onPan: @escaping (CGSize) -> Void) {
        self.onMove = onMove
        self.onZoom = onZoom
        self.onPan = onPan
    }

    public func makeNSView(context: Context) -> TrackerView {
        let v = TrackerView()
        v.start()
        return v
    }

    public func updateNSView(_ view: TrackerView, context: Context) {
        view.onMove = onMove
        view.onZoom = onZoom
        view.onPan = onPan
    }

    public static func dismantleNSView(_ view: TrackerView, coordinator: ()) { view.stop() }

    public final class TrackerView: NSView {
        var onMove: (CGPoint?) -> Void = { _ in }
        var onZoom: (CGPoint, CGFloat) -> Void = { _, _ in }
        var onPan: (CGSize) -> Void = { _ in }
        private var monitor: Any?
        private var panning = false

        override public var isFlipped: Bool { true }
        override public func hitTest(_ point: NSPoint) -> NSView? { nil }

        func start() {
            monitor = NSEvent.addLocalMonitorForEvents(matching: [.mouseMoved, .scrollWheel, .otherMouseDown, .otherMouseDragged, .otherMouseUp, .leftMouseDragged]) { [weak self] event in
                self?.handle(event) ?? event
            }
        }

        func stop() {
            if let monitor { NSEvent.removeMonitor(monitor) }
            monitor = nil
        }

        deinit { if let monitor { NSEvent.removeMonitor(monitor) } }

        private func inside(_ event: NSEvent) -> CGPoint? {
            guard let window, event.window === window else { return nil }
            let p = convert(event.locationInWindow, from: nil)
            return bounds.contains(p) ? p : nil
        }

        private func handle(_ event: NSEvent) -> NSEvent? {
            switch event.type {
            case .mouseMoved, .leftMouseDragged:
                onMove(inside(event))
            case .scrollWheel:
                guard let p = inside(event) else { return event }
                var notches = event.scrollingDeltaY * (event.isDirectionInvertedFromDevice ? -1 : 1)
                // A wheel click is about 1 (more when it accelerates); a trackpad sends many small deltas.
                notches = event.hasPreciseScrollingDeltas ? notches / 40 : max(-4, min(4, notches))
                if notches != 0 { onZoom(p, CGFloat(pow(1.25, notches))) }
                return nil
            case .otherMouseDown:
                panning = inside(event) != nil
            case .otherMouseDragged:
                if panning { onPan(CGSize(width: event.deltaX, height: event.deltaY)); return nil }
            case .otherMouseUp:
                panning = false
            default:
                break
            }
            return event
        }
    }
}

/**
 * The mouse wheel over a slider moves it, as on the web (and darktable): 1/200 of the range a notch, Shift 10x coarser, Cmd
 * 10x finer. A trackpad (precise deltas) scrolls the panel instead, unless Option is held. A wheel that was just scrolling the panel keeps scrolling it. One monitor serves all sliders: it finds
 * the slider under the pointer, and notes the scrolls no slider took.
 */
public struct SliderWheel: NSViewRepresentable {
    let range: ClosedRange<Float>
    let value: () -> Float
    let onChange: (Float) -> Void

    public init(range: ClosedRange<Float>, value: @escaping () -> Float, onChange: @escaping (Float) -> Void) {
        self.range = range
        self.value = value
        self.onChange = onChange
    }

    public func makeNSView(context: Context) -> WheelView {
        let v = WheelView()
        WheelView.register(v)
        return v
    }

    public func updateNSView(_ view: WheelView, context: Context) {
        view.range = range
        view.value = value
        view.onChange = onChange
    }

    public static func dismantleNSView(_ view: WheelView, coordinator: ()) { WheelView.unregister(view) }

    public final class WheelView: NSView {
        var range: ClosedRange<Float> = 0...1
        var value: () -> Float = { 0 }
        var onChange: (Float) -> Void = { _ in }
        /** The unsnapped value, so trackpad fractions add up between events. */
        fileprivate var raw: Float?
        fileprivate var rawFor: Float?

        override public var isFlipped: Bool { true }
        override public func hitTest(_ point: NSPoint) -> NSView? { nil }

        private struct Weak { weak var view: WheelView? }
        nonisolated(unsafe) private static var views: [Weak] = []
        nonisolated(unsafe) private static var monitor: Any?
        /** When a scroll that no slider took last happened: a wheel still scrolling the panel keeps doing so. */
        nonisolated(unsafe) private static var lastPanelScroll: TimeInterval = 0

        static func register(_ v: WheelView) {
            views.removeAll { $0.view == nil }
            views.append(Weak(view: v))
            if monitor == nil {
                monitor = NSEvent.addLocalMonitorForEvents(matching: .scrollWheel) { handle($0) }
            }
        }

        static func unregister(_ v: WheelView) { views.removeAll { $0.view == nil || $0.view === v } }

        private static func handle(_ event: NSEvent) -> NSEvent? {
            guard event.scrollingDeltaY != 0 else { return event }
            // A trackpad (or Magic Mouse) scrolls the panel: a slider under the pointer would catch the scroll and the
            // panel would stop. Option hands the gesture to the slider on purpose.
            if event.hasPreciseScrollingDeltas && !event.modifierFlags.contains(.option) {
                lastPanelScroll = event.timestamp
                return event
            }
            let hit = views.compactMap(\.view).first { v in
                guard let w = v.window, w === event.window, !v.isHiddenOrHasHiddenAncestor else { return false }
                return v.bounds.contains(v.convert(event.locationInWindow, from: nil))
            }
            // Momentum, and a scroll the panel was just taking, carry on scrolling the panel.
            guard let v = hit, event.momentumPhase == [], event.timestamp - lastPanelScroll > 0.2 else {
                if hit == nil || event.momentumPhase != [] { lastPanelScroll = event.timestamp }
                return event
            }
            var notches = Float(event.scrollingDeltaY * (event.isDirectionInvertedFromDevice ? -1 : 1))
            notches = event.hasPreciseScrollingDeltas ? notches / 12 : max(-4, min(4, notches))
            let span = v.range.upperBound - v.range.lowerBound
            let perNotch = event.modifierFlags.contains(.command) ? span / 2000
                : event.modifierFlags.contains(.shift) ? span / 20 : span / 200
            let current = v.value()
            if v.raw == nil || v.rawFor != current { v.raw = current }
            let next = min(v.range.upperBound, max(v.range.lowerBound, v.raw! + notches * perNotch))
            v.raw = next
            v.rawFor = next
            v.onChange(next)
            return nil
        }
    }
}

/**
 * The wheel over this area steps through a list, one item per mouse click (a trackpad swipe a few; `WheelStepper`), as the
 * web does for film stocks. The scroll is taken, so the panel doesn't move under the pointer; a wheel that was just
 * scrolling the panel keeps scrolling it, and so does momentum. `onStep` gets the steps (positive = forward, wheel down).
 */
public struct StepWheel: NSViewRepresentable {
    let enabled: Bool
    let onStep: (Int) -> Void

    public init(enabled: Bool = true, onStep: @escaping (Int) -> Void) {
        self.enabled = enabled
        self.onStep = onStep
    }

    public func makeNSView(context: Context) -> StepView {
        let v = StepView()
        StepView.register(v)
        return v
    }

    public func updateNSView(_ view: StepView, context: Context) {
        view.enabled = enabled
        view.onStep = onStep
    }

    public static func dismantleNSView(_ view: StepView, coordinator: ()) { StepView.unregister(view) }

    public final class StepView: NSView {
        var enabled = true
        var onStep: (Int) -> Void = { _ in }
        fileprivate var stepper = WheelStepper()

        override public var isFlipped: Bool { true }
        override public func hitTest(_ point: NSPoint) -> NSView? { nil }

        private struct Weak { weak var view: StepView? }
        nonisolated(unsafe) private static var views: [Weak] = []
        nonisolated(unsafe) private static var monitor: Any?
        /** When a scroll that no stepping area took last happened: a wheel still scrolling the panel keeps doing so. */
        nonisolated(unsafe) private static var lastPanelScroll: TimeInterval = 0

        static func register(_ v: StepView) {
            views.removeAll { $0.view == nil }
            views.append(Weak(view: v))
            if monitor == nil {
                monitor = NSEvent.addLocalMonitorForEvents(matching: .scrollWheel) { handle($0) }
            }
        }

        static func unregister(_ v: StepView) { views.removeAll { $0.view == nil || $0.view === v } }

        private static func handle(_ event: NSEvent) -> NSEvent? {
            guard event.scrollingDeltaY != 0 else { return event }
            // A trackpad scrolls the panel (a stepping area under the pointer would catch it); Option steps on purpose.
            if event.hasPreciseScrollingDeltas && !event.modifierFlags.contains(.option) {
                lastPanelScroll = event.timestamp
                return event
            }
            let hit = views.compactMap(\.view).first { v in
                guard v.enabled, let w = v.window, w === event.window, !v.isHiddenOrHasHiddenAncestor else { return false }
                return v.bounds.contains(v.convert(event.locationInWindow, from: nil))
            }
            guard let v = hit else {
                lastPanelScroll = event.timestamp
                return event
            }
            // The panel's own momentum, or a scroll it was just taking, carries on in the panel.
            if event.momentumPhase != [] && event.timestamp - lastPanelScroll < 0.5 {
                lastPanelScroll = event.timestamp
                return event
            }
            if event.momentumPhase == [] && event.timestamp - lastPanelScroll < 0.2 && !v.stepping {
                lastPanelScroll = event.timestamp
                return event
            }
            // Momentum after our own swipe is swallowed without stepping, so the stocks don't run on.
            if event.momentumPhase != [] { return nil }
            v.stepping = true
            // Wheel down = forward; scrollingDeltaY is positive for a wheel pushed away, and flips with natural scrolling.
            let physical = Double(event.scrollingDeltaY) * (event.isDirectionInvertedFromDevice ? -1 : 1)
            let steps = v.stepper.step(delta: -physical, precise: event.hasPreciseScrollingDeltas, time: event.timestamp)
            if steps != 0 { v.onStep(steps) }
            if event.phase == .ended || event.phase == .cancelled { v.stepping = false }
            return nil
        }

        /** True once this area has taken the current scroll, so a short pause doesn't hand it back to the panel. */
        fileprivate var stepping = false
    }
}
#endif
