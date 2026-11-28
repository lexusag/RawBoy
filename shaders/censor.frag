#version 300 es
// Censor pre-pass (Pro's Artistic Paintbrush, see web/src/engine/gl/CensorPass.ts): renders a copy of an image texture
// (the preview, a 100% tile, an export tile, or the 512 px base / bloom halo copies) with the censor layers' areas
// replaced by their effect, before the develop shader reads it. Everything after (sharpening, clarity, bloom, grain,
// LUT, film) only ever sees the censored pixels.
//
// Seamless across preview, 100% view and export: the effect reads only whole-image textures (a mipmapped copy of the
// session preview, the layers' painted coverage) and noise keyed to full-resolution pixel positions; nothing reads the
// input's neighbours, so no spatialMargin.
//
// Our own method (no third-party code): every effect starts from the photo averaged over cells at least the effect's
// Size, so no detail of what is covered survives, then draws its look on top (oil strokes, tiles, smear, glass, print
// dots, hatching, a dry ink brush). The edge falls off smoothly with the brush's own coverage.
precision highp float;
precision highp int;
precision highp sampler2D;

const int MAX_CENSOR = 4;

uniform sampler2D uInput;        // the texture being censored (linear Rec.2020)
uniform sampler2D uCensorSource; // mipmapped whole-image copy (the session preview), linear Rec.2020
uniform sampler2D uCensorMask;   // 2x2 atlas: R paint, G erase, BA axial stroke direction (cos 2a, sin 2a)
uniform sampler2D uCensorColour; // 2x2 atlas: brush colour (display sRGB) and its weight
uniform vec2 uCensorTexel;       // 1 / atlas size
uniform vec4 uInputRect;         // full-res px of the input's texel (0, 0) corner (xy) and full-res px per texel (zw)
uniform vec2 uImageSize;         // full-resolution image size (px)
uniform vec2 uSourceSize;        // uCensorSource level 0 size (texels)
uniform int uCensorCount;
uniform vec4 uCensorSlot[MAX_CENSOR];    // atlas origin.xy, size.zw (uv); size 0 = no strokes
uniform vec4 uCensorKind[MAX_CENSOR];    // effect (0 oil paint, 1 mosaic, 2 smear, 3 glass, 4 halftone, 5 hatching, 6 ink brush), 0, mosaic shape, seed
uniform vec4 uCensorParam[MAX_CENSOR];   // effect size (full-res px), strength 0..1, has ellipse, 0
uniform vec4 uCensorEllipse[MAX_CENSOR]; // centre (full-res px), 1 / radii (px)
uniform vec4 uCensorTurn[MAX_CENSOR];    // ellipse cos, sin of its angle; soft edge (fraction of the radius); 0
uniform vec4 uCensorExtra[MAX_CENSOR];   // mosaic glass colour, halftone/hatching contrast, hatching keep colour (0..1); 0
// The develop's main steps, to turn a picked display colour into the scene light that develops to about it.
uniform mat3 uInvWhiteBalance;
uniform float uExposure;
uniform float uContrast;

out vec4 o;

const vec3 LUMA = vec3(0.2627, 0.6780, 0.0593);
const float PI = 3.14159265;

// ---- hashing and noise (integer hash, no sine: stable across GPUs) ----
uint hashU(uvec3 v) {
    v = v * 1664525u + 1013904223u;
    v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
    v ^= v >> 16u;
    v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
    return v.x ^ v.y ^ v.z;
}
vec4 hash4(vec2 cell, float seed) {
    uvec3 b = uvec3(ivec3(ivec2(floor(cell)) + 32768, int(seed * 100.0)));
    uint h0 = hashU(b);
    uint h1 = hashU(b + uvec3(17u, 59u, 101u));
    return vec4(float(h0 & 65535u), float(h0 >> 16u), float(h1 & 65535u), float(h1 >> 16u)) / 65535.0;
}
float valueNoise(vec2 p, float seed) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash4(i, seed).x;
    float b = hash4(i + vec2(1.0, 0.0), seed).x;
    float c = hash4(i + vec2(0.0, 1.0), seed).x;
    float d = hash4(i + vec2(1.0, 1.0), seed).x;
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float fbm(vec2 p, float seed) {
    return 0.55 * valueNoise(p, seed) + 0.3 * valueNoise(p * 2.03 + 7.1, seed) + 0.15 * valueNoise(p * 4.1 - 3.7, seed);
}

// ---- inputs ----
vec2 atlasUv(int i, vec2 frac) {
    vec4 s = uCensorSlot[i];
    return s.xy + clamp(frac * s.zw, 0.5 * uCensorTexel, s.zw - 0.5 * uCensorTexel);
}
// Painted coverage, smoothed over 4 bilinear taps (a hard brush's edge is a ramp at 100%, not texel stairs).
vec4 maskAt(int i, vec2 frac) {
    if (uCensorSlot[i].z <= 0.0) return vec4(0.0, 0.0, 0.5, 0.5);
    vec2 uv = atlasUv(i, frac);
    vec2 h = 0.5 * uCensorTexel;
    return 0.25 * (texture(uCensorMask, uv + vec2(-h.x, -h.y)) + texture(uCensorMask, uv + vec2(h.x, -h.y)) +
                   texture(uCensorMask, uv + vec2(-h.x, h.y)) + texture(uCensorMask, uv + vec2(h.x, h.y)));
}
vec4 colourAt(int i, vec2 frac) {
    if (uCensorSlot[i].z <= 0.0) return vec4(0.0);
    return texture(uCensorColour, atlasUv(i, frac));
}
// The photo averaged over [px] full-resolution pixels around full-res point [p].
vec3 coarse(vec2 p, float px) {
    float lod = log2(max(px * uSourceSize.x / uImageSize.x, 1.0));
    return max(textureLod(uCensorSource, p / uImageSize, lod).rgb, 0.0);
}
// Stroke direction at full-res point [p] (radians), or the layer's own drifting angle where nothing was painted.
float angleAt(int i, vec2 p, float size, float seed) {
    vec2 d = maskAt(i, p / uImageSize).ba * 2.0 - 1.0;
    float fallback = 0.6 + 2.0 * (fbm(p / (size * 6.0), seed + 3.0) - 0.5);
    if (dot(d, d) < 0.02) return fallback;
    return 0.5 * atan(d.y, d.x);
}
float coverage(int i, vec2 p) {
    vec4 m = maskAt(i, p / uImageSize);
    float cov = m.r;
    if (uCensorParam[i].z > 0.5) {
        vec4 e = uCensorEllipse[i];
        vec4 t = uCensorTurn[i];
        vec2 d = p - e.xy;
        vec2 q = vec2(t.x * d.x + t.y * d.y, -t.y * d.x + t.x * d.y) * e.zw;
        float r = length(q);
        float ell = 1.0 - smoothstep(1.0 - t.z, 1.0, r);
        cov = max(cov, ell * (1.0 - m.g));
    }
    return cov;
}
// A picked display colour (sRGB) as the scene light that develops to about it: the inverse of the develop's
// white balance, exposure, contrast and AgX curve (per channel, without AgX's matrices, LUTs or film).
float agxCurve(float x) {
    float x2 = x * x;
    float x4 = x2 * x2;
    return 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232;
}
float agxInverse(float y) {
    float lo = 0.0;
    float hi = 1.0;
    for (int k = 0; k < 18; k++) {
        float m = 0.5 * (lo + hi);
        if (agxCurve(m) < y) lo = m; else hi = m;
    }
    return 0.5 * (lo + hi);
}
const float MIN_EV = -12.47393;
const float MAX_EV = 4.026069;
const float PIVOT = (-2.4739311883324122 - MIN_EV) / (MAX_EV - MIN_EV);
// "Display" here = the AgX curve's output (Rec.2020, 2.2 encoded): what the print effects draw in.
vec3 dispToScene(vec3 disp) {
    disp = clamp(disp, 0.004, 0.99);
    vec3 x = vec3(agxInverse(disp.r), agxInverse(disp.g), agxInverse(disp.b));
    x = (x - PIVOT) / max(uContrast, 0.05) + PIVOT;
    vec3 scene = exp2(x * (MAX_EV - MIN_EV) + MIN_EV) / max(uExposure, 1e-4);
    return max(uInvWhiteBalance * scene, 0.0);
}
vec3 sceneToDisp(vec3 scene) {
    vec3 c = inverse(uInvWhiteBalance) * scene * uExposure;
    vec3 x = (log2(max(c, vec3(1e-10))) - MIN_EV) / (MAX_EV - MIN_EV);
    x = clamp((x - PIVOT) * uContrast + PIVOT, 0.0, 1.0);
    return clamp(vec3(agxCurve(x.r), agxCurve(x.g), agxCurve(x.b)), 0.0, 1.0);
}
vec3 srgbToDisp(vec3 srgb) {
    vec3 lin = mix(srgb / 12.92, pow((srgb + 0.055) / 1.055, vec3(2.4)), step(0.04045, srgb));
    const mat3 REC709_TO_REC2020 = mat3(
        vec3(0.6274040, 0.0690970, 0.0163916),
        vec3(0.3292820, 0.9195400, 0.0880132),
        vec3(0.0433136, 0.0113612, 0.8955950));
    return pow(max(REC709_TO_REC2020 * lin, 0.0), vec3(1.0 / 2.2));
}
vec3 displayToScene(vec3 srgb) {
    return dispToScene(srgbToDisp(srgb));
}
// Small random shifts of a cell's colour: value +-10%, a little per channel, so cell values aren't a plain average.
vec3 jitter(vec3 c, vec4 h) {
    return c * (0.9 + 0.2 * h.x) * (vec3(0.96) + 0.08 * h.yzw);
}
// A cell's colour: the photo over the cell, pulled a third of the way to its wider surroundings.
vec3 cellColour(vec2 centre, float size) {
    return mix(coarse(centre, size), coarse(centre, size * 4.0), 0.35);
}

// ---- effects: the colour, and the detail factor the brush colour keeps ----
// Rounded rectangle distance (negative inside).
float sdBox(vec2 q, vec2 b, float r) {
    vec2 d = abs(q) - b + r;
    return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0) - r;
}
// Direction along the picture's contours (across its coarse light gradient), radians.
float flowAngle(vec2 p, float s) {
    float gx = log2(dot(coarse(p + vec2(s, 0.0), s), LUMA) + 1e-4) - log2(dot(coarse(p - vec2(s, 0.0), s), LUMA) + 1e-4);
    float gy = log2(dot(coarse(p + vec2(0.0, s), s), LUMA) + 1e-4) - log2(dot(coarse(p - vec2(0.0, s), s), LUMA) + 1e-4);
    return atan(gy, gx) + 0.5 * PI;
}
// Oil paint: two coats of long bristle strokes laid along the form, the top-most stroke covering the pixel wins; their
// ends break up like a dry brush.
vec4 paint(vec2 p, float size, float seed) {
    vec3 col = cellColour(p, size * 2.0);
    float detail = 1.0;
    for (int layer = 0; layer < 2; layer++) {
        float cs = size * (layer == 0 ? 1.0 : 0.65);
        float hl = cs * 1.2;  // half length
        float hw = cs * 0.375; // half width
        float ls = seed + float(layer) * 31.0;
        vec2 cell = floor(p / cs);
        float best = -1.0;
        for (int dy = -2; dy <= 2; dy++) {
            for (int dx = -2; dx <= 2; dx++) {
                vec2 id = cell + vec2(float(dx), float(dy));
                vec4 h = hash4(id, ls);
                if (h.w <= best) continue;
                vec2 c = (id + h.xy) * cs;
                if (distance(p, c) > hl + hw) continue;
                float a = flowAngle(c, cs * 2.0) + (h.z - 0.5) * 0.5;
                vec2 d = p - c;
                vec2 q = vec2(cos(a) * d.x + sin(a) * d.y, -sin(a) * d.x + cos(a) * d.y);
                float t = q.x / hl;
                if (sdBox(q, vec2(hl, hw * (1.0 - 0.25 * t * t)), hw * 0.9) > 0.5) continue;
                float bristle = valueNoise(vec2(q.y / (hw * 0.14), h.y * 50.0), ls + 3.0);
                if (smoothstep(0.55, 1.0, abs(t)) * (1.0 - bristle) > 0.35) continue;
                best = h.w;
                col = jitter(cellColour(c, cs * 0.9), h.wzyx);
                detail = 0.9 + 0.2 * bristle;
            }
        }
    }
    return vec4(col * detail, detail);
}

vec4 mosaic(vec2 p, float size, float seed, float shape, float texel, float glassColour) {
    vec2 centre;
    float edge;
    vec4 h;
    if (shape < 0.5) {
        vec2 id = floor(p / size);
        centre = (id + 0.5) * size;
        vec2 l = p - id * size;
        edge = min(min(l.x, size - l.x), min(l.y, size - l.y));
        h = hash4(id, seed);
    } else {
        // Hexagons (a staggered lattice) or shards (a jittered one): nearest centre, edge = the bisector distance.
        float d1 = 1e9;
        float d2 = 1e9;
        vec2 c1 = vec2(0.0);
        vec2 c2 = vec2(0.0);
        vec2 id1 = vec2(0.0);
        float rowH = shape < 1.5 ? size * 0.8660254 : size;
        vec2 cell = vec2(floor(p.x / size), floor(p.y / rowH));
        for (int dy = -2; dy <= 2; dy++) {
            for (int dx = -2; dx <= 2; dx++) {
                vec2 id = cell + vec2(float(dx), float(dy));
                vec4 hh = hash4(id, seed);
                vec2 c = shape < 1.5
                    ? vec2((id.x + 0.5 + 0.5 * mod(id.y, 2.0)) * size, (id.y + 0.5) * rowH)
                    : (id + 0.15 + 0.7 * hh.xy) * size;
                float d = distance(p, c);
                if (d < d1) { d2 = d1; c2 = c1; d1 = d; c1 = c; id1 = id; }
                else if (d < d2) { d2 = d; c2 = c; }
            }
        }
        centre = c1;
        edge = (d2 * d2 - d1 * d1) / (2.0 * max(distance(c1, c2), 1e-3));
        h = hash4(id1, seed);
    }
    vec3 col = jitter(cellColour(centre, size), h);
    if (glassColour > 0.0) {
        // Coloured glass: each piece tinted its own vivid hue at the same brightness, like stained glass over the photo.
        float hue = fract(h.x * 7.13 + h.w * 3.7);
        vec3 k = clamp(abs(mod(hue * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
        vec3 tint = pow(mix(vec3(1.0), k, 0.75 + 0.2 * h.z), vec3(2.2));
        tint = min(tint / max(dot(tint, LUMA), 0.05), vec3(4.0));
        col *= mix(vec3(1.0), tint, glassColour);
        col *= 0.95 + 0.1 * valueNoise(p / max(size * 0.22, 1.0), seed + 9.0 + h.z * 10.0);
    }
    // Grout between tiles (anti-aliased over a texel), a slight glaze towards each tile's middle, fine texture.
    float aa = max(texel, 1.0);
    float grout = smoothstep(size * 0.035, size * 0.035 + aa, edge);
    float glaze = 1.0 + 0.06 * smoothstep(0.0, size * 0.5, edge);
    float grain = 0.97 + 0.06 * valueNoise(p / max(size * 0.08, 1.0), seed + 11.0);
    float detail = mix(0.42, 1.0, grout) * glaze * grain;
    return vec4(col * detail, detail);
}

vec4 smear(int i, vec2 p, float size, float seed) {
    // The stroke direction averaged around the pixel, so overlapping strokes blend instead of meeting in seams.
    vec2 acc2 = vec2(0.0);
    for (int k = 0; k < 9; k++) {
        vec2 o2 = vec2(float(k % 3) - 1.0, float(k / 3) - 1.0) * size * 0.9;
        float ak = angleAt(i, p + o2, size, seed);
        acc2 += vec2(cos(2.0 * ak), sin(2.0 * ak));
    }
    float a = 0.5 * atan(acc2.y, acc2.x);
    vec2 dir = vec2(cos(a), sin(a));
    vec2 across = vec2(-dir.y, dir.x);
    float len = size * 2.5;
    // Wobble the line a little so the smear isn't ruler straight.
    float wob = (fbm(p / (size * 3.0), seed + 9.0) - 0.5) * size * 0.6;
    vec3 acc = vec3(0.0);
    float wsum = 0.0;
    for (int k = 0; k < 10; k++) {
        float t = (float(k) / 9.0 - 0.35) * len;
        float w = 1.0 - abs(float(k) / 9.0 - 0.35);
        acc += coarse(p + dir * t + across * wob, size * 0.7) * w;
        wsum += w;
    }
    vec3 col = mix(acc / wsum, cellColour(p, size * 1.5), 0.3);
    float streak = valueNoise(vec2(dot(p, across) / (size * 0.05), dot(p, dir) / (size * 2.0)), seed + 2.0);
    float fine = valueNoise(vec2(dot(p, across) / (size * 0.015), dot(p, dir) / (size * 0.8)), seed + 4.0);
    float detail = (0.92 + 0.12 * streak) * (0.97 + 0.06 * fine);
    return vec4(col * detail, detail);
}

vec4 glass(vec2 p, float size, float seed) {
    vec2 n = vec2(fbm(p / (size * 0.7), seed), fbm(p / (size * 0.7), seed + 17.0)) - 0.5;
    vec2 off = n * size * 1.5;
    vec3 col = mix(coarse(p + off, size * 0.9), cellColour(p, size * 2.0), 0.2);
    float y = dot(col, LUMA);
    col = mix(col, vec3(y), 0.06) * 1.015 + 0.002;
    // Glints where the frosting bends the light most.
    float g = smoothstep(0.78, 0.95, valueNoise(p / (size * 0.12), seed + 23.0)) * smoothstep(0.05, 0.25, length(n));
    float detail = 1.0 + 0.12 * g;
    return vec4(col * detail, detail);
}

// Halftone: the area printed as CMYK dots on paper (screens at their usual angles), [contrast] = how far from the
// area's own colour the print goes. Drawn in display values, so the dots look like print.
vec4 halftone(vec2 p, float size, float contrast) {
    float cs = size * 0.5;
    vec3 outc = srgbToDisp(vec3(0.97, 0.95, 0.9));
    for (int k = 0; k < 4; k++) {
        float ang = k == 0 ? 0.26 : k == 1 ? 1.31 : k == 2 ? 0.0 : 0.785;
        float ca = cos(ang);
        float sa = sin(ang);
        vec2 q = vec2(ca * p.x + sa * p.y, -sa * p.x + ca * p.y);
        vec2 id = floor(q / cs);
        vec2 qc = (id + 0.5) * cs;
        vec2 cc = vec2(ca * qc.x - sa * qc.y, sa * qc.x + ca * qc.y);
        vec3 s = sceneToDisp(cellColour(cc, cs));
        float K = (1.0 - max(s.r, max(s.g, s.b))) * 0.6;
        vec3 cmy = (1.0 - s - K) / max(1.0 - K, 1e-3);
        float ink = k == 0 ? cmy.r : k == 1 ? cmy.g : k == 2 ? cmy.b : K;
        float r = sqrt(clamp(ink, 0.0, 1.0)) * cs * 0.58;
        float a = smoothstep(r + 1.0, r - 1.0, distance(q, qc));
        vec3 inkc = k == 0 ? vec3(0.0, 0.68, 0.94) : k == 1 ? vec3(0.93, 0.0, 0.55) : k == 2 ? vec3(1.0, 0.92, 0.0) : vec3(0.15);
        outc *= mix(vec3(1.0), srgbToDisp(inkc), a);
    }
    vec3 area = sceneToDisp(cellColour(p, cs * 2.0));
    vec3 d = mix(area, outc, contrast);
    return vec4(dispToScene(d), clamp(dot(d, LUMA) / max(dot(area, LUMA), 0.05), 0.2, 1.2));
}
// Hatching: pen lines in up to three directions, more of them where the area is darker. [contrast] = how dark the lines
// are, [keep] = how much of the area's colour the paper and the lines keep (0: dark ink on light paper).
vec4 hatching(vec2 p, float size, float seed, float contrast, float keep) {
    vec3 c = sceneToDisp(cellColour(p, size * 0.9));
    float L = dot(c, LUMA);
    vec3 cream = 1.0 - (1.0 - sceneToDisp(coarse(p, size * 4.0))) * 0.3;
    vec3 paper = mix(cream, 1.0 - (1.0 - sceneToDisp(coarse(p, size * 2.0))) * 0.8, keep);
    vec3 inkc = mix(srgbToDisp(vec3(0.12, 0.1, 0.1)), c * c * 0.6, keep);
    float sp = size * 0.28;
    float ink = 0.0;
    for (int k = 0; k < 3; k++) {
        float th = k == 0 ? 0.8 : k == 1 ? 0.55 : 0.32;
        if (L > th) continue;
        float ang = k == 0 ? 0.785 : k == 1 ? -0.785 : 0.0;
        vec2 q = vec2(cos(ang) * p.x + sin(ang) * p.y, -sin(ang) * p.x + cos(ang) * p.y);
        float wob = (valueNoise(vec2(q.x / (size * 1.5), floor(q.y / sp)), seed + float(k)) - 0.5) * sp * 0.4;
        float v = abs(fract((q.y + wob) / sp) - 0.5) * sp;
        float w = sp * 0.16 * (1.0 + (th - L) * 1.5);
        ink = max(ink, smoothstep(w + 1.0, w - 1.0, v));
    }
    vec3 d = mix(paper, inkc, ink * contrast);
    return vec4(dispToScene(d), clamp(dot(d, LUMA) / max(dot(paper, LUMA), 0.05), 0.2, 1.2));
}
// Ink brush: a flat coat of ink (near black, or the brush colour) with dry-brush streaks along the stroke; the streaks
// open up where the coverage falls off, so the edge breaks into bristle marks instead of fading.
vec4 inkBrush(int i, vec2 p, float size, float seed, float cov, out float alpha) {
    float a = angleAt(i, p, size, seed);
    vec2 dir = vec2(cos(a), sin(a));
    vec2 across = vec2(-dir.y, dir.x);
    float streak = valueNoise(vec2(dot(p, across) / (size * 0.05), dot(p, dir) / (size * 6.0)), seed);
    float fine = valueNoise(vec2(dot(p, across) / (size * 0.015), dot(p, dir) / (size * 2.0)), seed + 3.0);
    float dry = 1.0 - smoothstep(0.0, 0.9, cov);
    alpha = smoothstep(dry - 0.05, dry + 0.05, streak * 0.7 + fine * 0.3 + 0.1);
    float detail = 0.9 + 0.2 * fine;
    return vec4(displayToScene(vec3(0.05)) * detail, detail);
}

void main() {
    ivec2 texel = ivec2(gl_FragCoord.xy);
    vec4 orig = texelFetch(uInput, texel, 0);
    vec2 p = uInputRect.xy + gl_FragCoord.xy * uInputRect.zw; // full-resolution position
    vec3 c = orig.rgb;
    for (int i = 0; i < MAX_CENSOR; i++) {
        if (i >= uCensorCount) break;
        float cov = coverage(i, p);
        if (cov <= 0.002) continue;
        vec4 kind = uCensorKind[i];
        vec4 par = uCensorParam[i];
        float size = par.x;
        float seed = kind.w;
        vec4 extra = uCensorExtra[i];
        float alpha = cov;
        vec4 e;
        if (kind.x < 0.5) e = paint(p, size, seed);
        else if (kind.x < 1.5) e = mosaic(p, size, seed, kind.z, uInputRect.z, extra.x);
        else if (kind.x < 2.5) e = smear(i, p, size, seed);
        else if (kind.x < 3.5) e = glass(p, size, seed);
        else if (kind.x < 4.5) e = halftone(p, size, extra.y);
        else if (kind.x < 5.5) e = hatching(p, size, seed, extra.y, extra.z);
        else e = inkBrush(i, p, size, seed, cov, alpha);
        alpha *= par.y;
        if (alpha <= 0.0) continue;
        vec3 eff = e.rgb;
        vec4 brush = colourAt(i, p / uImageSize);
        if (brush.a > 0.002) {
            // The picked colour, with the effect's own light and shade (bristles, grout, paper) on it.
            eff = mix(eff, displayToScene(brush.rgb) * e.a, brush.a);
        }
        c = mix(c, eff, alpha);
    }
    o = vec4(c, 1.0);
}
