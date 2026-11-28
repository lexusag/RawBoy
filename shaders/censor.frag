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
// Size, so no detail of what is covered survives, then draws its look on top (paint dabs, tiles, smear, glass, ink).
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
uniform vec4 uCensorKind[MAX_CENSOR];    // effect (0 paint, 1 mosaic, 2 smear, 3 glass, 4 ink), edge (0 soft, 1 painted, 2 hard), mosaic shape, seed
uniform vec4 uCensorParam[MAX_CENSOR];   // effect size (full-res px), strength 0..1, has ellipse, 0
uniform vec4 uCensorEllipse[MAX_CENSOR]; // centre (full-res px), 1 / radii (px)
uniform vec4 uCensorTurn[MAX_CENSOR];    // ellipse cos, sin of its angle; soft edge (fraction of the radius); 0
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
vec3 displayToScene(vec3 srgb) {
    vec3 lin = mix(srgb / 12.92, pow((srgb + 0.055) / 1.055, vec3(2.4)), step(0.04045, srgb));
    const mat3 REC709_TO_REC2020 = mat3(
        vec3(0.6274040, 0.0690970, 0.0163916),
        vec3(0.3292820, 0.9195400, 0.0880132),
        vec3(0.0433136, 0.0113612, 0.8955950));
    vec3 c = REC709_TO_REC2020 * lin;
    vec3 disp = clamp(pow(max(c, 0.0), vec3(1.0 / 2.2)), 0.004, 0.99);
    const float MIN_EV = -12.47393;
    const float MAX_EV = 4.026069;
    const float PIVOT = (-2.4739311883324122 - MIN_EV) / (MAX_EV - MIN_EV);
    vec3 x = vec3(agxInverse(disp.r), agxInverse(disp.g), agxInverse(disp.b));
    x = (x - PIVOT) / max(uContrast, 0.05) + PIVOT;
    vec3 scene = exp2(x * (MAX_EV - MIN_EV) + MIN_EV) / max(uExposure, 1e-4);
    return max(uInvWhiteBalance * scene, 0.0);
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
vec4 paint(int i, vec2 p, float size, float seed) {
    vec3 col = cellColour(p, size * 2.0);
    float detail = 1.0;
    // Two coats: big strokes, then smaller ones over them; the top-most dab covering the pixel wins.
    for (int layer = 0; layer < 2; layer++) {
        float cs = size * (layer == 0 ? 1.3 : 0.85);
        float ls = seed + float(layer) * 31.0;
        vec2 cell = floor(p / cs);
        float best = -1.0;
        vec3 bestCol = vec3(0.0);
        float bestDetail = 1.0;
        for (int dy = -1; dy <= 1; dy++) {
            for (int dx = -1; dx <= 1; dx++) {
                vec2 id = cell + vec2(float(dx), float(dy));
                vec4 h = hash4(id, ls);
                vec2 c = (id + 0.3 + 0.4 * h.xy) * cs;
                float a = angleAt(i, c, size, seed) + (h.z - 0.5) * 0.5;
                vec2 d = p - c;
                vec2 q = vec2(cos(a) * d.x + sin(a) * d.y, -sin(a) * d.x + cos(a) * d.y);
                float hl = cs * (0.9 + 0.2 * h.w);
                float hw = cs * (0.42 + 0.16 * h.z);
                // A dab: square-ish body, round ends, a bristle-ragged tail.
                float bristle = valueNoise(vec2(q.y / (hw * 0.25), h.x * 40.0), ls);
                float u = q.x / hl;
                float v = q.y / hw;
                float e = pow(abs(u), 2.5) * (1.0 + 0.45 * bristle) + pow(abs(v), 2.2);
                if (e >= 1.0) continue;
                float pr = h.w + float(layer);
                if (pr <= best) continue;
                best = pr;
                bestCol = jitter(cellColour(c, cs), h.wzyx) * (vec3(0.95) + 0.1 * h.xzy);
                // Bristle streaks along the dab, a light impasto ridge at its rim, a value shift per dab.
                float streak = valueNoise(vec2(q.x / (hl * 0.7), q.y / (hw * 0.12)), ls + 5.0);
                float ridge = smoothstep(0.6, 1.0, e);
                bestDetail = (0.94 + 0.12 * streak) * (1.0 - 0.06 * ridge) * (0.92 + 0.16 * h.y);
            }
        }
        if (best >= 0.0) {
            col = bestCol;
            detail = bestDetail;
        }
    }
    return vec4(col * detail, detail);
}

vec4 mosaic(vec2 p, float size, float seed, float shape, float texel) {
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

vec4 ink(vec2 p, float size, float seed) {
    vec3 col = mix(coarse(p, size * 4.0), coarse(p, size * 12.0), 0.5);
    float density = 0.95 + 0.1 * fbm(p / (size * 2.0), seed + 5.0);
    float paper = 0.97 + 0.06 * fbm(p / max(size * 0.06, 1.0), seed + 8.0);
    float detail = density * paper;
    return vec4(col * detail, detail);
}

// How much of the layer shows at coverage [cov]: plain (soft), thresholded against paper-and-bristle noise (painted:
// a dry-brush rim), or a crisp anti-aliased edge (hard).
float edgeAlpha(float cov, float edge, vec2 p, float size, float seed) {
    if (cov <= 0.0) return 0.0;
    if (edge < 0.5) return cov;
    if (edge > 1.5) return smoothstep(0.42, 0.58, cov);
    float n = fbm(p / (size * 0.35), seed + 41.0) * 0.7 + valueNoise(p / max(size * 0.05, 1.0), seed + 43.0) * 0.3;
    float t = 0.12 + 0.76 * n;
    return smoothstep(t - 0.06, t + 0.06, cov);
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
        float alpha = edgeAlpha(cov, kind.y, p, size, seed) * par.y;
        if (alpha <= 0.0) continue;
        vec4 e;
        if (kind.x < 0.5) e = paint(i, p, size, seed);
        else if (kind.x < 1.5) e = mosaic(p, size, seed, kind.z, uInputRect.z);
        else if (kind.x < 2.5) e = smear(i, p, size, seed);
        else if (kind.x < 3.5) e = glass(p, size, seed);
        else e = ink(p, size, seed);
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
