import MetalKit
import SwiftUI

/** The live camera preview, developed by a ViewfinderRenderer the caller owns (it also receives the frames). */
public struct Viewfinder: UIViewRepresentable {
    let renderer: ViewfinderRenderer
    let paused: Bool

    public init(renderer: ViewfinderRenderer, paused: Bool = false) {
        self.renderer = renderer
        self.paused = paused
    }

    public func makeUIView(context: Context) -> MTKView {
        let view = MTKView()
        renderer.paused = paused
        renderer.attach(view)
        return view
    }

    public func updateUIView(_ view: MTKView, context: Context) {
        renderer.paused = paused
    }
}
