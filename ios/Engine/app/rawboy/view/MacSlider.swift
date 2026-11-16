#if os(macOS)
import AppKit
import SwiftUI

/**
 * The Mac's develop slider: the system NSSlider (so clicks, drags of the thumb, keyboard and VoiceOver stay native) with
 * its own drawing. A hairline track, a tick at the default, and amber only between the default and the value, so a
 * slider at its default has no colour and the ones that were moved stand out (the system slider filled from its left
 * end: a signed slider at 0 was half amber). Double-click resets.
 *
 * Hand-drawn SwiftUI tracks didn't take the mouse, and a nearly transparent system slider over one couldn't be
 * dragged by its thumb (see ParamSlider), hence a cell subclass rather than a SwiftUI view.
 */
public struct MacSlider: NSViewRepresentable {
    let value: Float
    let range: ClosedRange<Float>
    let defaultValue: Float
    /** Colours painted along the track in place of the hairline (e.g. the RGB primaries' hue tracks). */
    var gradient: [Color]? = nil
    let onChange: (Float) -> Void

    public init(value: Float, range: ClosedRange<Float>, defaultValue: Float, gradient: [Color]? = nil,
                onChange: @escaping (Float) -> Void) {
        self.value = value
        self.range = range
        self.defaultValue = defaultValue
        self.gradient = gradient
        self.onChange = onChange
    }

    public func makeNSView(context: Context) -> Slider {
        let s = Slider()
        s.cell = Cell()
        s.isContinuous = true
        s.target = s
        s.action = #selector(Slider.moved)
        s.controlSize = .regular
        s.setContentHuggingPriority(.defaultLow, for: .horizontal)
        s.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        return s
    }

    public func updateNSView(_ s: Slider, context: Context) {
        s.onChange = onChange
        s.onReset = { [defaultValue, onChange] in onChange(defaultValue) }
        s.minValue = Double(range.lowerBound)
        s.maxValue = Double(range.upperBound)
        let clamped = Double(min(max(value, range.lowerBound), range.upperBound))
        // While the thumb is being dragged the slider already shows where it is; setting it back from the model
        // (which may round) would make it jitter.
        if !s.tracking, s.doubleValue != clamped { s.doubleValue = clamped }
        if let cell = s.cell as? Cell {
            let origin = Double(min(max(defaultValue, range.lowerBound), range.upperBound))
            let colours = gradient?.map { NSColor($0) }
            if cell.origin != origin || cell.gradient != colours {
                cell.origin = origin
                cell.gradient = colours
                s.needsDisplay = true
            }
        }
    }

    public func sizeThatFits(_ proposal: ProposedViewSize, nsView: Slider, context: Context) -> CGSize? {
        CGSize(width: proposal.width ?? 120, height: 20)
    }

    public final class Slider: NSSlider {
        var onChange: (Float) -> Void = { _ in }
        var onReset: () -> Void = {}
        fileprivate(set) var tracking = false

        @objc fileprivate func moved() { onChange(Float(doubleValue)) }

        public override func mouseDown(with event: NSEvent) {
            if event.clickCount == 2 {
                onReset()
                return
            }
            tracking = true
            super.mouseDown(with: event)  // runs the whole drag
            tracking = false
        }
    }

    final class Cell: NSSliderCell {
        /** The default value: the fill runs from here to the value. */
        var origin: Double = 0
        var gradient: [NSColor]?

        static let amber = NSColor(srgbRed: 0xE8 / 255, green: 0xA3 / 255, blue: 0x3D / 255, alpha: 1)
        static let track = NSColor(srgbRed: 0x4A / 255, green: 0x4A / 255, blue: 0x52 / 255, alpha: 1)
        static let tick = NSColor(srgbRed: 0x6A / 255, green: 0x6A / 255, blue: 0x72 / 255, alpha: 1)
        static let knobOn = NSColor(srgbRed: 0xE4 / 255, green: 0xE4 / 255, blue: 0xE8 / 255, alpha: 1)
        static let knobOff = NSColor(srgbRed: 0x8E / 255, green: 0x8E / 255, blue: 0x96 / 255, alpha: 1)

        private var changed: Bool { abs(doubleValue - origin) > (maxValue - minValue) * 1e-6 }

        /** x of a value along the track, where the system puts the thumb's centre for it. */
        private func x(_ v: Double, in bar: NSRect) -> CGFloat {
            let knob = knobRect(flipped: controlView?.isFlipped ?? false)
            let inset = knob.width / 2
            let span = maxValue - minValue
            let t = span > 0 ? CGFloat((v - minValue) / span) : 0
            return bar.minX + inset + t * (bar.width - 2 * inset)
        }

        override func drawBar(inside rect: NSRect, flipped: Bool) {
            let bounds = controlView?.bounds ?? rect
            let midY = bounds.midY
            let line = NSRect(x: rect.minX, y: midY - 0.5, width: rect.width, height: 1)
            if let gradient, gradient.count > 1, let g = NSGradient(colors: gradient) {
                g.draw(in: NSBezierPath(roundedRect: line.insetBy(dx: 0, dy: -1), xRadius: 1.5, yRadius: 1.5), angle: 0)
            } else {
                Self.track.setFill()
                line.fill()
            }
            // The default's tick, unless it sits at an end (one-sided sliders: Denoise, Bloom…).
            let ox = x(origin, in: rect)
            if origin > minValue && origin < maxValue {
                Self.tick.setFill()
                NSRect(x: ox - 0.5, y: midY - 4, width: 1, height: 8).fill()
            }
            if changed && gradient == nil {
                let vx = x(doubleValue, in: rect)
                Self.amber.setFill()
                NSBezierPath(roundedRect: NSRect(x: min(ox, vx), y: midY - 1.5, width: abs(vx - ox), height: 3),
                             xRadius: 1.5, yRadius: 1.5).fill()
            }
        }

        override func drawKnob(_ knobRect: NSRect) {
            let d: CGFloat = 12
            let bounds = controlView?.bounds ?? knobRect
            let r = NSRect(x: knobRect.midX - d / 2, y: bounds.midY - d / 2, width: d, height: d)
            NSGraphicsContext.saveGraphicsState()
            let shadow = NSShadow()
            shadow.shadowColor = NSColor.black.withAlphaComponent(0.6)
            shadow.shadowOffset = NSSize(width: 0, height: -1)
            shadow.shadowBlurRadius = 2
            shadow.set()
            (changed || gradient != nil ? Self.knobOn : Self.knobOff).setFill()
            NSBezierPath(ovalIn: r).fill()
            NSGraphicsContext.restoreGraphicsState()
        }
    }
}

/** A value that differs from its default: plain white on the Mac, where the slider's amber fill already marks it. */
public let changedValueColor = Color.primary

public extension View {
    /**
     * Segmented pickers on the Mac fill the selected segment with the tint; the window's tint is amber, which made every
     * tab and mode switch amber. Graphite instead: amber stays for the primary action and for values that changed.
     */
    func neutralSegments() -> some View {
        tint(Color(red: 0x4A / 255, green: 0x4A / 255, blue: 0x52 / 255))
    }
}
#else
import SwiftUI

/** A value that differs from its default (the phones colour it amber). */
public let changedValueColor = Color.accentColor

public extension View {
    /** The Mac's graphite segments (see the macOS version); the phones keep theirs. */
    func neutralSegments() -> some View { self }
}
#endif
