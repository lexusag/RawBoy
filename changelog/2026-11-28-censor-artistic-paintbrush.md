**Censor: an artistic paintbrush that covers parts of a photo (Web, 2026-11-28)**

- New top-bar tool in Pro, **Censor** (`X`): paint over what shouldn't be shown when posting (nudity for social media) with Paint, Mosaic (squares, hexagons, shards), Smear, Frosted glass, Ink or Heal away, or drag out an ellipse. Up to 4 layers, each with Effect size, Strength (100 by default, a warning below), Edge (soft, painted, hard) and New pattern.
- Smooth strokes: every coalesced pointer sample, a Smoothing stabiliser and spline strokes; a pen's pressure sets the brush size, its eraser end erases, Alt erases.
- Brush colour: Auto (the area's own colours), a swatch, hex, an eyedropper on the developed photo, the last 8 colours, and Colour mix.
- The effect replaces the decoded image before any other step (and the whole-image copies for clarity, bloom and lens blur), so nothing brings the original back; preview, 100% and export match. Layers are kept in edits sidecars, never carried over or put in presets; Auto renders them for photos sent with RawBoy edits.
- Code: `engine/develop/Censor.ts`, `CensorRaster.ts`, `CensorColour.ts`, `engine/gl/CensorPass.ts`, `shaders/censor.frag`, `ui/pro/CensorPanel.tsx`, `CensorOverlay.tsx`. Tests: `engine/__tests__/censor.test.ts`.
