import RawBoyEngine
import SwiftUI
#if canImport(AppKit)
import AppKit
#endif

/**
 * What the menu bar, the keyboard and the pointer ask of the editor (RawBoy Desktop). The editor's own state (open tool,
 * Compare, the export sheet) lives in `EditorScreen`, so these go through [EditorCommands]; iOS never sends any.
 */
enum EditorAction: Equatable {
    case export
    /** Opens the tool, or closes it when it is the open one. */
    case toggleMode(EditorMode)
    case toggleCompare
    /** 100% at the pointer, or back to the whole photo. */
    case zoom100AtPointer
    case zoomFit
    case cycleFrame
    case maskTool(MaskTool)
    /** Brush size, +1 larger / -1 smaller. */
    case brushSize(Int)
    /** Removes the selected healing stroke (Delete). */
    case deleteSelection
    /** Closes the open tool (Esc, Return). */
    case done
    /** The "?" sheet. */
    case help
}

/** Host hooks for [EditorScreen]: actions to run, the pointer's position over the photo, and the export destination. */
@MainActor
final class EditorCommands: ObservableObject {
    @Published private(set) var serial = 0
    private(set) var action: EditorAction?
    /** Where the pointer is over the photo, in the preview's points (nil: outside it). Not published. */
    var pointer: CGPoint?
    /** Space held: a drag pans the zoomed photo instead of painting. */
    var spaceHeld = false

    /** RawBoy Desktop: a section for the export sheet choosing the folder, the file written there, and the folder chosen. */
    var exportDestination: AnyView?
    @Published var exportFolder: URL?
    var exportHandler: ((ExportSettings) -> Void)?
    /** RawBoy Desktop: adds the open photo to Auto's batch and shows Auto (nil elsewhere: no button). */
    var sendToAuto: (() -> Void)?
    /** The line under the export options: where the file goes. */
    var exportNote: ((URL?) -> String)?

    func send(_ a: EditorAction) {
        action = a
        serial += 1
    }
}

#if os(macOS)
/**
 * Mouse and trackpad over the photo: where the pointer is (Z zooms there), the wheel zooms around it (a quarter step of
 * 1.25 per notch like the web; Cmd or a trackpad pinch too), the middle button pans. Looks at events with a local monitor,
 * so it needs no hit-testing of its own and the photo's gestures keep working.
 */
struct PointerSurface: NSViewRepresentable {
    var onMove: (CGPoint?) -> Void
    var onZoom: (CGPoint, CGFloat) -> Void
    var onPan: (CGSize) -> Void

    func makeNSView(context: Context) -> TrackerView {
        let v = TrackerView()
        v.start()
        return v
    }

    func updateNSView(_ view: TrackerView, context: Context) {
        view.onMove = onMove
        view.onZoom = onZoom
        view.onPan = onPan
    }

    static func dismantleNSView(_ view: TrackerView, coordinator: ()) { view.stop() }

    final class TrackerView: NSView {
        var onMove: (CGPoint?) -> Void = { _ in }
        var onZoom: (CGPoint, CGFloat) -> Void = { _, _ in }
        var onPan: (CGSize) -> Void = { _ in }
        private var monitor: Any?
        private var panning = false

        override var isFlipped: Bool { true }
        override func hitTest(_ point: NSPoint) -> NSView? { nil }

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
 * The wheel over a slider moves it, as on the web (and darktable): 1/200 of the range a notch, Shift 10x coarser, Cmd
 * 10x finer. A wheel that was just scrolling the panel keeps scrolling it. One monitor serves all sliders: it finds
 * the slider under the pointer, and notes the scrolls no slider took.
 */
struct SliderWheel: NSViewRepresentable {
    let range: ClosedRange<Float>
    let value: () -> Float
    let onChange: (Float) -> Void

    func makeNSView(context: Context) -> WheelView {
        let v = WheelView()
        WheelView.register(v)
        return v
    }

    func updateNSView(_ view: WheelView, context: Context) {
        view.range = range
        view.value = value
        view.onChange = onChange
    }

    static func dismantleNSView(_ view: WheelView, coordinator: ()) { WheelView.unregister(view) }

    final class WheelView: NSView {
        var range: ClosedRange<Float> = 0...1
        var value: () -> Float = { 0 }
        var onChange: (Float) -> Void = { _ in }
        /** The unsnapped value, so trackpad fractions add up between events. */
        fileprivate var raw: Float?
        fileprivate var rawFor: Float?

        override var isFlipped: Bool { true }
        override func hitTest(_ point: NSPoint) -> NSView? { nil }

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
#endif
