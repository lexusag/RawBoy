# Pipeline

```mermaid
flowchart TD
    raw[/"RAW file<br/>CR2 · CR3 · NEF · ARW · RAF · RW2 · ORF · DNG"/]

    subgraph CPU["Decode — native C++ (once per photo)"]
        direction TB
        dec["LibRaw 0.21<br/>(Adobe DNG SDK fallback for JPEG XL DNGs)"]
        hot["Defective column + hot pixel removal<br/>(CFA, before demosaic)"]
        gain["DNG gain maps<br/>(lens + colour shading, camera RGB)"]
        lin["Linear Rec.2020 D65 · as-shot WB<br/>oriented · half-float · 1.0 = sensor clip"]
        blem["Blemish healing<br/>(optional, edits the full-res image)"]
        dec --> hot --> gain --> lin --> blem
    end

    subgraph AUX["Small whole-image textures"]
        direction TB
        base["512 px base<br/>(high-pass contrast)"]
        bloomTex["Bloom halo 512 px<br/>+ tail 64 px"]
        skin["Skin mask<br/>(MediaPipe)"]
    end

    subgraph GPU["Develop shader — GLES 3.0 / WebGL2, per output pixel"]
        direction TB
        geo["Geometry: crop → rotate/straighten →<br/>auto-scale → distortion → DNG warp (+ lateral CA)"]
        spatial["Denoise → skin retouch → sharpening →<br/>local contrast → high-pass contrast → bloom"]
        vig["Lens vignetting"]
        light["WB re-balance × RGB primaries →<br/>exposure → shadows/highlights →<br/>purity-limited saturation"]
        agx["Tone mapper: log2 → grain → contrast →<br/>AgX (inset/outset) · Filmic · Sigmoid"]
        levels["Whites / blacks"]
        disp["Soft gamut compression →<br/>Rec.709 / sRGB encode"]
        lut["3D LUT × strength<br/>(film look)"]
        curves["Point curves<br/>(RGB, then R / G / B)"]
        geo --> spatial --> vig --> light --> agx --> levels --> disp --> lut --> curves
    end

    raw --> dec
    blem --> geo
    blem -.-> AUX
    AUX -.-> spatial

    curves --> preview(["Live preview<br/>fit view · 100% view"])
    curves --> export(["Export: full-res tiles →<br/>JPEG (jpegli) / TIFF 8/16-bit"])
```

The same steps as text:

```
raw ──LibRaw (or Adobe DNG SDK)──▶ defective column + hot pixel removal (CFA, before demosaic) ▶ DNG gain maps ▶ linear Rec.2020 (D65), as-shot WB, oriented, half-float
    [blemish healing, when on, edits this full-resolution image]
    ──GPU, per output pixel──▶ crop ▶ rotate/straighten ▶ lens geometry (auto-scale, distortion, DNG warp)
       ▶ denoise ▶ skin retouch ▶ sharpening ▶ local contrast ▶ high-pass contrast ▶ bloom ▶ lens vignetting
       ▶ WB re-balance × RGB primaries ▶ exposure ▶ shadows/highlights ▶ purity-limited saturation
       ▶ tone mapper (AgX: inset ▶ log2 ▶ grain ▶ contrast ▶ sigmoid ▶ outset; Filmic / Sigmoid: log2 ▶ grain ▶ contrast ▶ curve) ▶ whites/blacks ▶ soft gamut compression ▶ Rec.709/sRGB ▶ LUT ▶ point curves
```

- `engine/`: the shared library both apps use
  - `src/main/cpp/`: decoders, JNI bridge, CMake (fetches LibRaw at configure time)
  - `src/main/java/app/rawboy/gl/Shaders.kt`: assembles the develop + AgX shader from `shaders/*.glsl`
  - `src/main/java/app/rawboy/export/`: tiled export, TIFF writer, MediaStore naming
- `shaders/`: the GLSL, compiled into the engine at build time (and shared with a future web build)
- `app-pro/`, `app-auto/`, `app-camera/`: the three apps
- `web/`: RawBoy Web (WASM build of the native code in `web/native`, TypeScript engine port, React UI)
