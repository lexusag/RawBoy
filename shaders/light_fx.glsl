// Light effects (see web/src/engine/develop/LightEffects.ts): procedural light (lightning, sparks, light trails,
// neon swirls) laid over the finished, display-encoded picture after the light leaks, like a double exposure of light
// on film. Each effect is a list of glowing line segments in its own frame (a data texture of chunk rows), drawn
// analytically, so it stays sharp at any export size and moves, scales and turns by uniforms alone:
//   core  a white-hot line (Gaussian across, at least a pixel wide so thin forks don't alias, dimmer instead),
//   glow  the line's colour around it, a few core widths wide,
//   halo  a wide soft bloom over the whole effect.
// Glow and halo are Gaussian line integrals along each segment (erf), so a polyline of many short pieces glows
// evenly, with no beads at its joints. The light is exposed into the picture per channel (1 - (1 - c) e^-L), so a
// strong core burns to white and its edge keeps the colour, and the photo's grain is laid back over it like a leak's.
// Web only for now: every uniform is "off" at 0 and programs that don't include this file render as before.
#define MAX_FX 4
#define FX_CHUNK 16
uniform int uFxCount;
uniform highp sampler2D uFx;      // RGBA32F, a row per chunk: bbox (own frame), then (x0, y0, x1, y1), (w0, w1, b, hue) x 16
uniform vec4 uFxGeom[MAX_FX];     // centre.xy (image px), rx, ry (image px)
uniform vec4 uFxShape[MAX_FX];    // cos(angle), sin(angle), width scale (px per unit width), glow radius (core widths)
uniform vec4 uFxColor[MAX_FX];    // hue 0..1, colour spread 0..1, intensity 0..1, halo radius (px)
uniform vec4 uFxRange[MAX_FX];    // first row, rows, reach (px), jag 0..1 (fine kinks within each segment)

// erf, within ~3e-4 (tanh form).
float fxErf(float x) {
    x = clamp(x, -3.0, 3.0); // tanh of a large argument is NaN on some GPUs
    return tanh(1.12838 * x * (1.0 + 0.0890 * x * x));
}

// A Gaussian of radius r integrated along the segment from a (direction dir, length len), seen from q; an infinite
// line through q gives 1.
float fxLine(vec2 q, vec2 a, vec2 dir, float len, float r) {
    vec2 aq = q - a;
    float t = dot(aq, dir);
    float n = aq.x * dir.y - aq.y * dir.x;
    return exp(-(n * n) / (r * r)) * 0.5 * (fxErf(t / r) - fxErf((t - len) / r));
}

// Pseudo-random 0..1 (Dave Hoskins' hash without sine, as light_leak.glsl's).
float fxHash(float p) {
    p = fract(p * 0.1031);
    p *= p + 33.33;
    p *= p + p;
    return fract(p);
}

// Neon light of a hue (0..1): saturation 0.8, value 1 (LightEffects.ts' fxColor).
vec3 fxHue(float h) {
    vec3 k = mod(vec3(5.0, 3.0, 1.0) + fract(h) * 6.0, 6.0);
    return 1.0 - 0.8 * clamp(min(k, 4.0 - k), 0.0, 1.0);
}

vec3 applyLightFx(vec3 c, vec2 p, vec2 fullPx) {
    // Image pixels per output pixel (derivatives outside the loops: they need uniform control flow).
    float footprint = max(max(fwidth(p.x), fwidth(p.y)), 1e-3);
    float fp = max(max(fwidth(fullPx.x), fwidth(fullPx.y)), 1.0);
    float covered = 0.0;
    for (int i = 0; i < MAX_FX; ++i) {
        if (i >= uFxCount) break;
        vec4 g = uFxGeom[i];
        vec4 s = uFxShape[i];
        vec4 col = uFxColor[i];
        vec4 rg = uFxRange[i];
        vec2 d = p - g.xy;
        vec2 q = vec2(s.x * d.x + s.y * d.y, -s.y * d.x + s.x * d.y); // own frame, image px
        vec2 scale = g.zw;
        float reach = rg.z;
        vec3 base = fxHue(col.x);
        float core = 0.0;
        vec3 coreCol = vec3(0.0);
        vec3 glow = vec3(0.0);
        vec3 halo = vec3(0.0);
        int first = int(rg.x);
        int rows = int(rg.y);
        for (int r = 0; r < 128; ++r) {
            if (r >= rows) break;
            int row = first + r;
            vec4 bb = texelFetch(uFx, ivec2(0, row), 0);
            vec2 out2 = max(max(bb.xy * scale - q, q - bb.zw * scale), 0.0);
            if (dot(out2, out2) > reach * reach) continue;
            for (int k = 0; k < FX_CHUNK; ++k) {
                vec4 A = texelFetch(uFx, ivec2(1 + 2 * k, row), 0);
                vec4 B = texelFetch(uFx, ivec2(2 + 2 * k, row), 0);
                if (B.z <= 0.0) break;
                vec2 a = A.xy * scale;
                vec2 b = A.zw * scale;
                vec2 ab = b - a;
                float len = length(ab);
                vec2 dir = len > 1e-4 ? ab / len : vec2(1.0, 0.0);
                float tu = dot(q - a, dir);
                float t = clamp(tu, 0.0, len);
                float n = (q.x - a.x) * dir.y - (q.y - a.y) * dir.x;
                if (rg.w > 0.0 && len > 1e-4) {
                    // Jag: the core zigzags within the segment (3 straight kinks of random size, none at its ends), so
                    // a bolt stays jagged at full resolution, finer than its generated points.
                    float u = t / len * 3.0;
                    float fl = min(floor(u), 2.0);
                    float seed = A.x * 1931.7 + A.y * 2713.3;
                    float j0 = fl < 0.5 ? 0.0 : fxHash(seed + fl) - 0.5;
                    float j1 = fl > 1.5 ? 0.0 : fxHash(seed + fl + 1.0) - 0.5;
                    n += mix(j0, j1, u - fl) * len * 0.35 * rg.w;
                }
                float dist2 = n * n + (tu - t) * (tu - t);
                float w = mix(B.x, B.y, len > 1e-4 ? t / len : 0.0) * s.z;
                float wAvg = 0.5 * (B.x + B.y) * s.z;
                vec3 tint = col.y > 0.0 ? fxHue(col.x + B.w * col.y * 0.18) : base;
                // Core: never thinner than ~a pixel; a thinner line is dimmer instead of aliased.
                float we = max(w, footprint * 0.7);
                float cv = B.z * (w / we) * exp(-dist2 / (we * we));
                if (cv > core) {
                    core = cv;
                    coreCol = tint;
                }
                // Glow and halo along the segment; a dot (or a piece shorter than its width) counts as 2 widths long.
                float gl = max(len, 2.0 * wAvg);
                vec2 ga = a - dir * (0.5 * (gl - len));
                float gr = max(wAvg * s.w, footprint);
                glow += tint * (B.z * fxLine(q, ga, dir, gl, gr));
                halo += tint * (B.z * fxLine(q, ga, dir, gl, col.w) * min(1.5, (B.x + B.y) * 80.0)); // thick lines bloom more
            }
        }
        vec3 light = core * mix(coreCol, vec3(1.0), 0.75) * 4.0 + glow * 0.9 + halo * 0.3;
        light *= col.z;
        vec3 before = c;
        c = 1.0 - (1.0 - c) * exp(-light * 1.6);
        float changed = max(max(c.r - before.r, c.g - before.g), c.b - before.b) / max(1.0 - min(min(before.r, before.g), before.b), 1e-3);
        covered = 1.0 - (1.0 - covered) * (1.0 - clamp(changed, 0.0, 1.0));
    }
    if (uGrain > 0.0 && covered > 0.0) {
        // The light flattens the grain under it; lay it back as much as the light took away, so it sits under the grain.
        c += grainNoise(fullPx) * (uGrain * 0.03 * min(1.0, uGrainSize / fp) * covered);
    }
    return clamp(c, 0.0, 1.0);
}
