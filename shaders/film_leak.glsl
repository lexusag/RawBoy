// Film leaks (generated; see web/src/engine/develop/FilmLeaks.ts): procedural film light and damage laid over the
// finished, display-encoded picture after the hand-made light leaks (light_leak.glsl, whose leakHash/leakNoise/leakFbm
// this file reuses, so it is assembled after it) and before the light effects.
//
// Every layer lives in an axis-aligned box in image pixels (dragged and stretched along x and y only). Inside the box
// the pattern is drawn in its own frame q = -1..1, turned in 90° steps and optionally mirrored, so "the source edge"
// (where light enters, where the roll ends, where the film tore) is always q.x = -1 and the pattern only stretches
// with the box. Placed in image pixels, so it follows crop, rotation and lens corrections and is seam-free in tiles.
//
// Stages, each over all layers: colour grade (global) -> light (per-channel exposure burn 1 - (1 - c) e^-E, so a
// strong leak burns white through yellow and orange to red; the palette's exposure ratios decide which channel fills
// first) -> opaque damage (end of roll, tear) -> dust, scratches and stains -> grain laid back over what changed.
// Every uniform is "off" at 0, so programs that don't bind them render as before.
#define MAX_FILM_LEAKS 4
uniform int uFlCount;
uniform vec4 uFlBox[MAX_FILM_LEAKS];    // centre.xy (image px), 1/half width, 1/half height (image px)
uniform vec4 uFlForm[MAX_FILM_LEAKS];   // type, quarter turns 0..3, mirror 0/1, seed 0..1
uniform vec4 uFlTint[MAX_FILM_LEAKS];   // palette exposure ratios (rgb, the first channel to fill is 1), intensity 0..1
uniform vec4 uFlTint2[MAX_FILM_LEAKS];  // second palette colour (rgb; flare: unused), variant 0..1 (per-type shape knob)
uniform vec4 uFlLook[MAX_FILM_LEAKS];   // softness 0..1, texture 0..1, amount 0..1 (per-type: reach / count / position), unused
uniform vec4 uFlGrade[MAX_FILM_LEAKS];  // warmth -1..1, tint -1..1, fade 0..1, contrast -1..1 (the whole photo)

const int FL_EDGE = 0;
const int FL_BLOB = 1;
const int FL_STREAK = 2;
const int FL_SPROCKET = 3;
const int FL_FOG = 4;
const int FL_REBATE = 5;
const int FL_FLARE = 6;
const int FL_START = 7;
const int FL_END = 8;
const int FL_TEAR = 9;
const int FL_DUST = 10;
const int FL_STAIN = 11;
const int FL_SCRATCH = 12;

// The point's place in layer i's own frame: q = -1..1 inside the box, the source edge at q.x = -1.
vec2 flFrame(int i, vec2 p) {
    vec4 b = uFlBox[i];
    vec2 q = (p - b.xy) * b.zw;
    int turns = int(uFlForm[i].y + 0.5);
    // Turn the frame so the source edge is left (0), top (1), right (2) or bottom (3) of the box.
    if (turns == 1) q = vec2(q.y, -q.x);
    else if (turns == 2) q = -q;
    else if (turns == 3) q = vec2(-q.y, q.x);
    if (uFlForm[i].z > 0.5) q.y = -q.y;
    return q;
}

// The box's size in image px along the frame's x (across from the source edge) and y (along it).
vec2 flSpan(int i) {
    vec2 h = 1.0 / max(uFlBox[i].zw, vec2(1e-6));
    int turns = int(uFlForm[i].y + 0.5);
    return (turns == 1 || turns == 3) ? h.yx : h;
}

// Fades the pattern out at the box's own edges (other than where it is meant to touch), so a stretched box never
// shows a hard rectangle: soft along y, and past x = +1.
float flBoxFade(vec2 q, float soft) {
    float fy = 1.0 - smoothstep(1.0 - soft, 1.0 + soft * 0.5, abs(q.y));
    float fx = 1.0 - smoothstep(1.0 - soft, 1.0 + soft * 0.5, q.x);
    return fy * fx;
}

// Four-octave fbm, -0.5..0.5 mean 0, for edges that should look torn or burnt.
float flRough(vec2 p) {
    float n = 0.5 * leakNoise(p) + 0.25 * leakNoise(p * 2.07 + 3.1) + 0.15 * leakNoise(p * 4.13 + 7.7) + 0.1 * leakNoise(p * 8.31 + 1.9);
    return n - 0.5;
}

// A rounded box's signed distance.
float flRoundBox(vec2 p, vec2 b, float r) {
    vec2 d = abs(p) - b + r;
    return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0) - r;
}

// Spectral tint for the flare's fringe, t 0..1 red -> violet.
vec3 flSpectrum(float t) {
    return clamp(vec3(1.5 - abs(4.0 * t - 1.0), 1.5 - abs(4.0 * t - 2.0), 1.5 - abs(4.0 * t - 3.0)), 0.0, 1.0);
}

// Light (exposure, >= 0) layer i adds at frame point q, before the palette, and how far its colour shifts to the
// palette's second (redder) colour there (y: 0..1; light on film is reddest where it is weakest, at its edges).
// so = the seed's patch of noise.
vec2 flLight(int type, vec2 q, vec2 so, float soft, float tex, float amount, float variant, vec2 aspect) {
    float x = q.x * 0.5 + 0.5; // 0 at the source edge, 1 at the far side
    float y = q.y;
    // Coordinates in a common scale (box px / mean size), so noise isn't squashed by stretching.
    vec2 pn = vec2(x * aspect.x, y * 0.5 * aspect.y);
    float mottle = mix(1.0, 0.6 + 0.8 * leakFbm(pn * 2.2 + so), tex);
    float rays = mix(1.0, 0.8 + 0.4 * leakFbm(vec2(pn.x * 0.6, pn.y * 7.0) + so + 4.4), tex); // streaks along the light
    float L = 0.0;
    float shift = 0.0;
    if (type == FL_EDGE || type == FL_START) {
        // Back-door leak / fogged first frames: a band from the edge, burnt yellow-white at the edge and falling off to
        // a saturated orange-red at its ragged inner boundary, then a soft red glow past it. amount = how far it
        // reaches; the start of a roll has a solid blown-out leader slab ending in a fiery ragged seam.
        bool start = type == FL_START;
        float reach = start ? 0.25 + 0.6 * amount : 0.15 + 0.7 * amount;
        float rough = flRough(vec2(y * (start ? 1.8 : 1.3) * aspect.y, start ? 5.0 : 0.3) + so) * (start ? 0.14 : 0.1 * (0.4 + tex));
        float edge = reach + rough;
        float hard = (start ? 0.008 : 0.015) + (start ? 0.08 : 0.12) * soft;
        float band = 1.0 - smoothstep(edge - hard, edge + hard, x);
        float depth = clamp(x / max(edge, 1e-3), 0.0, 1.0);
        float peak = start ? 6.5 : 3.2;
        float inside = start
            ? mix(peak, 0.9, smoothstep(0.45, 1.0, depth))
            : mix(peak, 0.45, pow(depth, 0.8 + variant));
        float r2 = edge + 0.05 + 0.11 * variant;                    // a fainter second band / seam behind it
        float band2 = (1.0 - smoothstep(r2 - 0.02 - 0.06 * soft, r2 + 0.03 + 0.08 * soft, x)) * (1.0 - band) * (start ? 0.55 : 0.35 * variant);
        float tail = exp(-max(x - edge, 0.0) * (9.0 - 6.0 * soft)) * (start ? 0.45 : 0.3) * (1.0 - band);
        L = (band * inside + band2 + tail) * (start ? mix(1.0, mottle, 0.45) : mottle) * rays;
        shift = mix(smoothstep(start ? 0.55 : 0.35, 1.0, depth), 1.0, 1.0 - band);
    } else if (type == FL_BLOB) {
        // A diffuse mass entering from the source edge (a corner if variant pushes it along).
        vec2 c0 = vec2(-0.85, (variant - 0.5) * 1.6);
        vec2 d = (q - c0) * vec2(1.0, 0.8);
        d += (vec2(leakFbm(pn * 1.6 + so), leakFbm(pn * 1.6 + so + 5.2)) - 0.5) * (0.5 + 0.6 * tex);
        float r = length(d) / (0.55 + 0.9 * amount);
        L = (2.6 * exp(-r * r * (2.4 - 1.2 * soft)) + 0.35 * exp(-r * 1.6)) * mottle;
        shift = smoothstep(0.15, 1.1, r);
    } else if (type == FL_STREAK) {
        // A soft beam across the box along x, wandering and swelling, fading past its ends.
        float wander = (leakFbm(vec2(pn.x * 1.4, 0.7) + so) - 0.5) * 0.6 * (0.3 + variant);
        float w = (0.15 + 0.5 * amount) * (0.7 + 0.6 * leakFbm(vec2(pn.x * 2.3, 2.1) + so));
        float d = (y - wander) / w;
        float along = smoothstep(-1.05, -0.5, q.x) * (1.0 - smoothstep(0.5, 1.05, q.x));
        L = (2.4 * exp(-d * d * (2.2 - 1.2 * soft)) + 0.3 * exp(-abs(d) * 1.2)) * along * mottle * rays;
        shift = smoothstep(0.2, 1.4, abs(d));
    } else if (type == FL_SPROCKET) {
        // Light through the perforations: a row of rounded slots along the source edge with light needles shooting
        // inward from each perforation and a warm bleed along the margin.
        float n = floor(6.0 + 8.0 * amount); // perforations along the box
        float cell = 2.0 / n;
        float k = floor((y + 1.0) / cell);
        float fy = ((y + 1.0) - (k + 0.5) * cell) / cell; // -0.5..0.5 within the perforation's cell
        float jit = leakHash(vec2(k, 3.0) + so * 13.0);
        vec2 sp = vec2((x - 0.16) / 0.12, fy / 0.28);
        float dslot = flRoundBox(sp, vec2(1.0, 1.0), 0.45);
        float slot = 1.0 - smoothstep(-0.4 - 0.5 * soft, 0.35 + 1.2 * soft, dslot);
        float needle = exp(-max(x - 0.12, 0.0) * mix(7.0, 2.2, variant * jit)) * exp(-fy * fy * mix(28.0, 8.0, soft));
        float bleed = exp(-x * 3.5) * 0.55;
        L = (slot * (2.2 + 1.4 * jit) + needle * (0.8 + 1.4 * variant) * (0.4 + 0.8 * jit) + bleed) * mottle;
        shift = clamp(1.0 - slot * 0.85 + x * 0.5, 0.0, 1.0);
    } else if (type == FL_FOG) {
        // Uneven fogging over the whole box, denser towards the source edge.
        float density = leakFbm(pn * (0.9 + 1.5 * variant) + so);
        float grad = mix(1.0, exp(-x * 2.0), 0.6);
        L = (0.2 + 1.0 * amount) * (0.35 + density * 1.3) * grad * mix(1.0, 0.85 + 0.3 * leakFbm(pn * 6.0 + so + 2.0), tex);
        shift = 1.0 - density;
    } else if (type == FL_REBATE) {
        // A thin glow hugging the source edge (halation at the rebate), broken in places.
        float w = 0.03 + 0.12 * amount;
        float broken = mix(1.0, smoothstep(0.25, 0.6, leakFbm(vec2(y * 3.0 * aspect.y, 1.0) + so)), variant);
        L = (2.6 * exp(-max(x, 0.0) / w) + 0.5 * exp(-max(x, 0.0) / (w * 4.0 * (0.5 + soft)))) * broken * rays;
        shift = smoothstep(0.0, w * 2.0, x);
    } else if (type == FL_FLARE) {
        // A soft diagonal beam from the source edge, its fringe handled by the caller (spectral tint).
        float ang = (variant - 0.5) * 1.2;
        vec2 dir = vec2(cos(ang), sin(ang));
        vec2 rel = vec2(q.x + 1.0, q.y);
        float along = dot(rel, dir);
        float across = dot(rel, vec2(-dir.y, dir.x));
        float w = 0.15 + 0.5 * amount;
        L = (2.2 * exp(-across * across / (w * w) * (1.4 - soft)) * exp(-along * 0.9) + 0.7 * exp(-length(rel) * 2.2)) * mottle;
    }
    return vec2(max(L, 0.0), clamp(shift, 0.0, 1.0));
}

vec3 applyFilmLeaks(vec3 c, vec2 p, vec2 fullPx) {
    vec3 before = c;
    // 1. Colour grade: the whole photo, as the film / lab would have shifted it.
    for (int i = 0; i < MAX_FILM_LEAKS; ++i) {
        if (i >= uFlCount) break;
        vec4 g = uFlGrade[i];
        if (g == vec4(0.0)) continue;
        c *= vec3(1.0 + 0.12 * g.x - 0.04 * g.y, 1.0 + 0.08 * g.y, 1.0 - 0.14 * g.x - 0.04 * g.y);
        c = mix(vec3(0.5), c, 1.0 + 0.35 * g.w);                     // contrast around mid grey
        c = c * (1.0 - 0.22 * g.z) + vec3(0.2, 0.18, 0.16) * 0.22 * g.z * (1.0 + 0.5 * g.x); // faded, warm-lifted blacks
        c = clamp(c, 0.0, 1.0);
    }
    // 2. Light.
    for (int i = 0; i < MAX_FILM_LEAKS; ++i) {
        if (i >= uFlCount) break;
        int type = int(uFlForm[i].x + 0.5);
        if (type > FL_START) continue;
        vec2 q = flFrame(i, p);
        if (any(greaterThan(abs(q), vec2(1.6)))) continue;
        vec4 tint = uFlTint[i];
        vec4 look = uFlLook[i];
        vec2 span = flSpan(i);
        vec2 aspect = span / (0.5 * (span.x + span.y));
        vec2 so = vec2(37.0, 17.0) * uFlForm[i].w + vec2(3.1, 7.3);
        float fade = type == FL_FOG || type == FL_START ? flBoxFade(q, 0.25) : flBoxFade(q, 0.12 + 0.3 * look.x);
        vec2 ls = flLight(type, q, so, look.x, look.y, look.z, uFlTint2[i].w, aspect);
        float L = ls.x * tint.a * fade;
        if (L <= 0.0) continue;
        vec3 ratio = tint.rgb;
        if (type == FL_FLARE) {
            // Rainbow fringe across the beam, white-warm in its middle.
            float ang = (uFlTint2[i].w - 0.5) * 1.2;
            float across = dot(vec2(q.x + 1.0, q.y), vec2(-sin(ang), cos(ang)));
            ratio = mix(vec3(1.0, 0.7, 0.35), flSpectrum(clamp(0.5 + across * 0.9, 0.0, 1.0)), 0.3);
        } else {
            // The palette drifts towards its second colour in places (texture).
            float drift = smoothstep(0.3, 0.8, leakFbm(q * 1.3 + so + 8.3)) * look.y;
            ratio = mix(ratio, uFlTint2[i].rgb, clamp(ls.y * 0.9 + drift * 0.5, 0.0, 1.0));
            if (type == FL_FOG) ratio = mix(ratio, vec3(1.0), 0.55); // fog is a milky veil, only faintly coloured
        }
        c = 1.0 - (1.0 - c) * exp(-L * ratio * 1.6 - L * 0.03);
    }
    // 3. Opaque damage: the end of the roll (unexposed, clear base: black in the positive) and tears.
    for (int i = 0; i < MAX_FILM_LEAKS; ++i) {
        if (i >= uFlCount) break;
        int type = int(uFlForm[i].x + 0.5);
        if (type != FL_END && type != FL_TEAR) continue;
        vec2 q = flFrame(i, p);
        if (any(greaterThan(abs(q), vec2(1.6)))) continue;
        vec4 look = uFlLook[i];
        vec2 span = flSpan(i);
        vec2 aspect = span / (0.5 * (span.x + span.y));
        vec2 so = vec2(37.0, 17.0) * uFlForm[i].w + vec2(3.1, 7.3);
        float x = q.x * 0.5 + 0.5;
        float soft = look.x;
        float fy = 1.0 - smoothstep(1.0, 1.15, abs(q.y)); // ends with the box along the edge
        float a = uFlTint[i].a;
        float variant = uFlTint2[i].w;
        if (type == FL_END) {
            // The frame cut short: a bowed, slightly ragged boundary (the gate's shadow on the last frame), black
            // film base past it with a faint warm fog, and a fiery light-creep seam right along the boundary.
            float bow = (variant - 0.3) * 0.14 * (1.0 - q.y * q.y);
            float edge = 0.22 + 0.55 * look.z + bow + 0.03 * flRough(vec2(q.y * 3.5 * aspect.y, 2.0) + so) * (0.4 + look.y);
            float px = 1.5 / max(span.x, 1.0); // keep the boundary at least ~1.5 px soft
            float m = (1.0 - smoothstep(edge - px - 0.03 * soft, edge + px + 0.03 * soft, x)) * fy * a;
            vec3 base = vec3(0.025, 0.022, 0.02) + vec3(0.05, 0.028, 0.012) * leakFbm(q * 3.0 + so) * look.y;
            float seam = exp(-max(x - edge + 0.015, 0.0) * (28.0 - 16.0 * soft)) * smoothstep(edge - 0.04, edge, x) * fy * a * (0.5 + 0.7 * look.y);
            c = mix(c, base, m);
            c = 1.0 - (1.0 - c) * exp(-seam * uFlTint[i].rgb * 2.4);
        } else {
            // A torn film edge (see foto125.jpg, Lomography 21659984 / 26313485):
            // - Rips diagonally inward from one end of the edge (a wedge/corner tear that tapers back to the border)
            //   with sudden step-fractures where the acetate shear jumps.
            // - Asymmetric, sharp fibrous teeth where the gelatin emulsion snapped (domain-warped ridge noise),
            //   alternating with cleaner sheared stretches.
            // - A thin, intermittent bright silver-white emulsion-separation rim (0.5..3.5 px) along parts of the
            //   fracture, and a light-leak fog bloom strongest where the tear opens widest (as in foto125.jpg), so the
            //   black torn silhouette reads clearly even against dark scenes.
            float y = q.y;
            float sgn = leakHash(so + 1.1) < 0.5 ? -1.0 : 1.0;
            // t runs 0 at the deep end of the tear -> 1 where the tear tapers back to the frame edge.
            float t = clamp((y * sgn + 1.0) * 0.5, 0.0, 1.0);
            float spanT = 0.65 + 0.55 * variant;
            float wedge = (0.22 + 0.55 * look.z) * pow(clamp(1.0 - t * spanT, 0.0, 1.0), 1.25);
            // Step-fractures: sudden sideways jumps in the tear trajectory (like the notch at y ~ 0.3 in foto125.jpg).
            float y1 = -0.35 + 0.7 * leakHash(so + 2.3);
            float y2 = -0.55 + 1.1 * leakHash(so + 4.7);
            float step1 = (1.0 - smoothstep(y1 - 0.018, y1 + 0.018, y * sgn)) * (0.04 + 0.07 * leakHash(so + 3.1));
            float step2 = (1.0 - smoothstep(y2 - 0.008, y2 + 0.008, y * sgn)) * (leakHash(so + 5.9) - 0.4) * 0.05;
            // Domain-warped ridge noise for sharp, asymmetric fibrous teeth along the ragged sections.
            float wy = y * aspect.y + 0.08 * (leakNoise(vec2(y * 6.0 * aspect.y, 1.3) + so) - 0.5);
            float chew = smoothstep(0.28, 0.68, leakFbm(vec2(wy * 2.4, 1.7) + so)) * clamp((1.05 - t * spanT) * 2.0, 0.0, 1.0);
            float r1 = abs(leakNoise(vec2(wy * 9.0, 3.1) + so) - 0.5) * 2.0;
            float r2 = abs(leakNoise(vec2(wy * 32.0, 5.7) + so) - 0.5) * 2.0;
            float r3 = abs(leakNoise(vec2(wy * 95.0, 8.3) + so) - 0.5) * 2.0;
            float teeth = ((0.5 - r1) * 0.032 + (0.5 - r2) * 0.013 + (0.5 - r3) * 0.005) * (0.25 + 0.95 * chew);
            float edge = wedge + step1 + step2 + teeth;
            float d = (x - edge) * span.x; // px from the fracture line, + on the remaining film side
            float hasTear = step(0.002, edge);
            float edgeBlur = max(0.55, 0.45 + 1.1 * soft);
            float gone = (1.0 - smoothstep(-edgeBlur, edgeBlur, d)) * fy * a * hasTear;
            // Light leak / stress fog entering through the torn opening, strongest at the deep end (t ~ 0) and along
            // the fracture seam, fading out smoothly before the box's inner edge (x = 1).
            float fogEnv = (1.0 - smoothstep(0.55, 0.96, x)) * fy * a * hasTear;
            float fogReach = span.x * (0.16 + 0.32 * soft);
            float cornerBloom = exp(-length(vec2(max(x - edge * 0.5, 0.0) * 1.8, t * 1.1)) * 2.6) * (0.5 + 0.9 * look.y);
            float edgeFog = exp(-max(d, 0.0) / max(fogReach, 14.0)) * (0.25 + 0.55 * (1.0 - t));
            float mottle = 0.65 + 0.7 * leakFbm(q * 2.2 + so + 6.0);
            float L = (cornerBloom * 1.35 + edgeFog * 0.65) * mottle * fogEnv;
            vec3 fogTint = mix(uFlTint[i].rgb, vec3(0.96, 0.94, 0.9), 0.45);
            c = 1.0 - (1.0 - c) * exp(-L * fogTint);
            // Thin, intermittent white/silver emulsion-separation rim where the gelatin tore slightly wider than the
            // black missing base (0.4..3.2 px wide, fibrous, broken along y).
            float rimOn = smoothstep(0.36, 0.66, leakFbm(vec2(wy * 4.8, 2.5) + so));
            float fibre = leakNoise(vec2(wy * 140.0, d * 0.35) + so);
            float rimW = (0.6 + 2.8 * chew * rimOn) * (0.55 + 0.7 * fibre);
            float rim = smoothstep(-0.4, 0.35, d) * (1.0 - smoothstep(rimW * 0.45, rimW + 0.6, d)) * rimOn * fy * a * hasTear;
            c = mix(c, vec3(0.9, 0.89, 0.86) * (0.8 + 0.2 * fibre), rim * (0.55 + 0.45 * look.y));
            c = mix(c, vec3(0.012, 0.012, 0.014), gone);
        }
    }
    // 4. Dust, scratches and chemical stains.
    for (int i = 0; i < MAX_FILM_LEAKS; ++i) {
        if (i >= uFlCount) break;
        int type = int(uFlForm[i].x + 0.5);
        if (type != FL_DUST && type != FL_STAIN && type != FL_SCRATCH) continue;
        vec2 q = flFrame(i, p);
        if (any(greaterThan(abs(q), vec2(1.05)))) continue;
        vec4 look = uFlLook[i];
        vec2 span = flSpan(i);
        vec2 so = vec2(37.0, 17.0) * uFlForm[i].w + vec2(3.1, 7.3);
        float a = uFlTint[i].a * flBoxFade(q, 0.05);
        // Work in box pixels (frame x across, y along), so specks stay round however the box is stretched.
        vec2 bp = (q * 0.5 + 0.5) * span;
        float scale = 0.5 * (span.x + span.y);
        if (type == FL_DUST || type == FL_SCRATCH) {
            // Authentic film dust, lint fibres and horizontal/vertical scratches (turn 0/2 vs 1/3 rotates the frame
            // 90°, so transport scratches run vertically or horizontally depending on the chosen edge):
            // - FL_DUST: cloudy swaths of grain-scale micro-flecks, crooked lint hairs and 2..5 transport scratches.
            // - FL_SCRATCH: dedicated horizontal or vertical film scratches combining:
            //   (a) long wavering/kinked white hairline scratches (often in small parallel groups, like grass ref),
            //   (b) razor-thin tramline tracks with intermittent dark gouge ticks, tiny burr pinholes and a faint
            //       adjacent bright ridge glint (like spider & forest refs),
            //   (c) shorter angled scuff scratches.
            bool scratchOnly = type == FL_SCRATCH;
            float white = 0.0;
            float black = 0.0;
            float pxUnit = max(1.0, scale * 0.00055);
            float var = uFlTint2[i].w;
            float swath = smoothstep(0.32, 0.78, leakFbm(q * 1.35 + so))
                        * smoothstep(0.24, 0.76, leakFbm(q * 3.1 + so + 5.7));
            float density = scratchOnly ? (0.35 + 0.65 * swath) : (0.04 + 0.96 * pow(swath, 1.5));
            if (!scratchOnly) {
                // 1) Fine pixel-scale dust clouds: high-frequency noise thresholded inside the swaths.
                vec2 dp = bp / pxUnit;
                vec2 warp = vec2(leakNoise(dp * 0.07 + so), leakNoise(dp * 0.07 + so + 9.1)) * 6.0;
                float fine1 = leakNoise((dp + warp) * 0.42 + so * 13.0);
                float fine2 = leakNoise((dp - warp * 0.7) * 0.78 + so * 29.0);
                float fineProd = fine1 * fine2;
                float thFine = mix(0.76, 0.52, density * (0.35 + 0.65 * look.z));
                float micro = smoothstep(thFine, thFine + 0.08, fineProd)
                            * (0.12 + 0.55 * pow(leakNoise(dp * 0.19 + so), 2.0));
                white = max(white, micro);
                // 2) Sparse larger irregular dust specks (0.7..2.0 px) with rough warped outlines.
                for (int pass = 0; pass < 2; ++pass) {
                    float fp = float(pass);
                    float ang = 0.53 + fp * 0.81 + so.x * 0.1;
                    float ca = cos(ang), sa = sin(ang);
                    vec2 rp = vec2(ca * bp.x - sa * bp.y, sa * bp.x + ca * bp.y);
                    float cellPx = scale * (pass == 0 ? mix(0.055, 0.022, look.z) : mix(0.032, 0.013, look.z));
                    vec2 cell = floor(rp / cellPx);
                    vec2 f = rp / cellPx - cell;
                    vec2 ps = so * (19.0 + fp * 13.0) + fp * 31.7;
                    float h = leakHash(cell + ps);
                    float keep = (0.015 + 0.22 * density) * (0.35 + 0.65 * look.z);
                    if (h < keep) {
                        vec2 ctr = vec2(0.2 + 0.6 * leakHash(cell + ps + 1.7), 0.2 + 0.6 * leakHash(cell + ps + 4.1));
                        vec2 dv = (f - ctr) * cellPx / pxUnit;
                        float fa = leakHash(cell + ps + 6.3) * 6.28318;
                        float cfa = cos(fa), sfa = sin(fa);
                        dv = vec2(cfa * dv.x - sfa * dv.y, sfa * dv.x + cfa * dv.y);
                        dv.x /= 1.0 + 1.2 * pow(leakHash(cell + ps + 8.1), 2.0);
                        dv += (vec2(leakNoise(dv * 0.9 + cell), leakNoise(dv * 0.9 + cell + 3.7)) - 0.5) * 0.9;
                        float r = 0.4 + (pass == 0 ? 1.25 : 0.75) * pow(leakHash(cell + ps + 9.3), 3.0);
                        float m = 1.0 - smoothstep(r * 0.5, r + 0.45, length(dv));
                        float op = 0.2 + 0.75 * pow(leakHash(cell + ps + 12.9), 1.8);
                        if (leakHash(cell + ps + 14.2) < 0.14) black = max(black, m * op * 0.75);
                        else white = max(white, m * op);
                    }
                }
            } else {
                // Fine sub-pixel emulsion grit scattered sparsely in the scratch swaths.
                vec2 dp = bp / pxUnit;
                float g1 = leakNoise(dp * 0.55 + so * 13.0) * leakNoise(dp * 0.92 + so * 29.0);
                float grit = smoothstep(0.71 - 0.1 * density * look.y, 0.79 - 0.1 * density * look.y, g1)
                           * (0.15 + 0.45 * pow(leakNoise(dp * 0.23 + so), 2.0));
                white = max(white, grit);
            }
            // 3) Chaotic multi-scale stray scratches, V-nicks and splintered hairlines (3 rotated cell passes from
            //    fine 8..35 px scuffs up to 50..220 px crossing scratches at varied angles, like Image 1 & Image 3).
            int nPasses = scratchOnly ? 3 : 2;
            for (int pass = 0; pass < 3; ++pass) {
                if (pass >= nPasses) break;
                float fp = float(pass);
                float ang = 0.77 + fp * 0.93 + so.y * 0.07;
                float ca = cos(ang), sa = sin(ang);
                vec2 rp = vec2(ca * bp.x - sa * bp.y, sa * bp.x + ca * bp.y);
                float cellPx = scale * (pass == 0 ? mix(0.14, 0.055, look.z) : pass == 1 ? mix(0.075, 0.030, look.z) : mix(0.038, 0.016, look.z));
                vec2 cell = floor(rp / cellPx);
                vec2 f = rp / cellPx - cell;
                vec2 ps = so * (23.0 + fp * 17.0) + fp * 47.3;
                float h = leakHash(cell + ps);
                float keep = (scratchOnly ? (0.14 + 0.28 * density) : (0.04 + 0.16 * density)) * (0.35 + 0.65 * look.y);
                if (h < keep) {
                    vec2 ctr = vec2(0.2 + 0.6 * leakHash(cell + ps + 2.1), 0.2 + 0.6 * leakHash(cell + ps + 5.3));
                    vec2 dh = (f - ctr) * cellPx / pxUnit;
                    // Mix transport-biased angles (+-35°) with completely arbitrary angles (0..360°).
                    float ha = leakHash(cell + ps + 6.1) < 0.55
                        ? (1.5708 + (leakHash(cell + ps + 7.7) - 0.5) * 1.2) - ang
                        : leakHash(cell + ps + 7.7) * 6.28318;
                    float cha = cos(ha), sha = sin(ha);
                    dh = vec2(cha * dh.x - sha * dh.y, sha * dh.x + cha * dh.y);
                    float hlen = (cellPx / pxUnit) * (0.16 + 0.36 * pow(leakHash(cell + ps + 9.9), 1.1));
                    float t = clamp(dh.x / max(hlen, 1e-3), -1.0, 1.0);
                    // Piecewise-linear sharp kinks + high-frequency pixel chatter along the scratch.
                    float k1 = (leakHash(cell + ps + 11.3) - 0.5) * 0.7;
                    float k2 = (leakHash(cell + ps + 12.7) - 0.5) * 0.7;
                    float path = (leakHash(cell + ps + 13.1) - 0.5) * hlen * 0.14 * abs(t - k1)
                               + (leakHash(cell + ps + 14.7) - 0.5) * hlen * 0.09 * abs(t - k2)
                               + (leakNoise(vec2(dh.x * 0.22, h * 31.0) + ps) - 0.5) * 1.6
                               + (leakNoise(vec2(dh.x * 0.85, h * 53.0) + ps) - 0.5) * 0.55;
                    float hd = abs(dh.y - path);
                    // Optional secondary splinter branching off at an acute angle (like lower-right of Image 3).
                    if (scratchOnly && leakHash(cell + ps + 16.3) < 0.35) {
                        float brSlope = (leakHash(cell + ps + 18.1) - 0.5) * 0.45;
                        float br = abs(dh.y - path - (dh.x - k1 * hlen) * brSlope) + step(dh.x, k1 * hlen) * 99.0;
                        hd = min(hd, br);
                    }
                    // Razor-thin sub-pixel core with intermittent stipple/skip along its length.
                    float hw = 0.08 + 0.18 * leakHash(cell + ps + 15.7);
                    float taper = 1.0 - smoothstep(0.72, 1.0, abs(t));
                    float chatter = smoothstep(0.22, 0.55, leakNoise(vec2(dh.x * 0.18, h * 19.0) + ps))
                                  * (0.4 + 0.6 * leakNoise(vec2(dh.x * 0.75, h * 41.0) + ps));
                    float nick = (1.0 - smoothstep(hw, hw + 0.38 + 0.2 * look.x, hd)) * taper * chatter;
                    float op = 0.28 + 0.65 * leakHash(cell + ps + 17.9);
                    if (leakHash(cell + ps + 19.1) < 0.22) black = max(black, nick * op * 0.75);
                    else white = max(white, nick * op);
                }
            }
            // 4) Long erratic, kinked hairline scratches roughly along the transport axis (bp.y), wandering,
            //    jerking sideways at sharp kinks, and skipping intermittently (like Image 1 & Image 3).
            float nWave = scratchOnly
                ? floor(4.0 + 10.0 * look.z * (1.0 - 0.45 * smoothstep(0.7, 1.0, var)) + 0.5)
                : floor(1.0 + 4.0 * look.z * (0.4 + 0.6 * (1.0 - var)) + 0.5);
            for (int k = 0; k < 14; ++k) {
                if (float(k) >= nWave) break;
                float fk = float(k);
                vec2 ks = so * 11.0 + vec2(fk * 7.3, fk * 3.1);
                // Group some scratches into irregular 2-4 line swaths, leave others isolated.
                float baseFrac = mod(fk, 3.0) > 0.5 && fk > 0.0
                    ? fract(leakHash(ks - vec2(7.3, 3.1)) + (leakHash(ks + 0.5) - 0.5) * 0.055)
                    : (0.04 + 0.92 * leakHash(ks));
                float sx = baseFrac * span.x;
                float y0 = (0.02 + 0.72 * leakHash(ks + 1.2)) * span.y;
                float lenY = (0.08 + 0.65 * pow(leakHash(ks + 2.4), 1.4)) * span.y;
                float relY = (bp.y - y0) / max(lenY, 1.0);
                if (relY < -0.02 || relY > 1.02) continue;
                float envY = smoothstep(0.0, 0.06, relY) * (1.0 - smoothstep(0.92, 1.0, relY));
                float yPx = bp.y / pxUnit;
                // Stronger random tilt + sharp piecewise-linear kinks + high-frequency micro-jitter.
                float tilt = (leakHash(ks + 3.6) - 0.5) * 0.16 * (bp.y - y0);
                float k1 = 0.2 + 0.6 * leakHash(ks + 5.1);
                float k2 = 0.15 + 0.7 * leakHash(ks + 6.3);
                float kinks = (abs(relY - k1) - 0.3) * (leakHash(ks + 7.4) - 0.5) * pxUnit * 32.0
                            + (abs(relY - k2) - 0.3) * (leakHash(ks + 8.8) - 0.5) * pxUnit * 16.0;
                float wav = (leakFbm(vec2(bp.y / scale * 5.5, fk * 4.7) + so) - 0.5) * pxUnit * 18.0
                          + (leakNoise(vec2(yPx * 0.06, fk * 9.1) + so) - 0.5) * pxUnit * 4.2
                          + (leakNoise(vec2(yPx * 0.35, fk * 13.7) + so) - 0.5) * pxUnit * 1.1
                          + kinks;
                float distPx = abs(bp.x - sx - tilt - wav) / pxUnit;
                if (distPx > 2.5) continue;
                float w = 0.07 + 0.16 * leakHash(ks + 4.8);
                // Broken, stippled skips along the scratch so it isn't a continuous vector stroke.
                float skipCoarse = smoothstep(0.26, 0.58, leakFbm(vec2(bp.y / scale * 9.0, fk * 3.7) + so));
                float skipFine = 0.3 + 0.7 * smoothstep(0.32, 0.68, leakNoise(vec2(yPx * 0.14, fk * 17.3) + so));
                float op = (0.28 + 0.65 * leakHash(ks + 6.0)) * envY * skipCoarse * skipFine;
                float line = (1.0 - smoothstep(w, w + 0.36 + 0.22 * look.x, distPx)) * op;
                if (leakHash(ks + 9.5) < 0.15) black = max(black, line * 0.7);
                else white = max(white, line);
            }
            // 5) Ultra-fine, pitted tramline / roller scratches along bp.y (like Image 2 spider & Image 4 trees):
            //    - Sub-pixel (0.35..0.7 px) irregular pitted track with sharp black gouge dashes, high-frequency
            //      micro-dots, tiny grit specks alongside the groove, and a crisp 0.6 px refraction highlight lip.
            float nTram = scratchOnly
                ? floor(1.0 + 13.0 * look.z * smoothstep(0.1, 0.9, var) + 0.5)
                : floor(0.5 + 3.0 * look.z * var + 0.5);
            for (int k = 0; k < 14; ++k) {
                if (float(k) >= nTram) break;
                float fk = float(k);
                vec2 ks = so * 17.0 + vec2(fk * 5.9, fk * 11.3);
                float bandCenter = 0.08 + 0.84 * leakHash(vec2(floor(fk / 3.0) * 13.0, 1.0) + so * 9.0);
                float bandSpread = (leakHash(ks) - 0.5) * 0.16;
                float sx = clamp(bandCenter + bandSpread, 0.03, 0.97) * span.x;
                float tilt = (leakHash(ks + 1.4) - 0.5) * 0.012 * (bp.y - 0.5 * span.y);
                float yCoord = bp.y / pxUnit;
                // High-frequency micro-chatter along the track so it isn't dead ruler-straight.
                float wob = (leakNoise(vec2(bp.y / scale * 3.8, fk * 6.1) + so) - 0.5) * pxUnit * 1.4
                          + (leakNoise(vec2(yCoord * 0.25, fk * 15.3) + so) - 0.5) * pxUnit * 0.55;
                float signedPx = (bp.x - sx - tilt - wob) / pxUnit;
                float distPx = abs(signedPx);
                if (distPx > 3.2) continue;
                float reach = smoothstep(0.18, 0.52, leakFbm(vec2(bp.y / scale * 2.5 + fk * 1.9, fk * 4.3) + so));
                // Unequal gouge dashes + high-frequency pitted micro-ticks (yCoord * 0.65 and * 0.12).
                float dashes = smoothstep(0.57, 0.64, leakFbm(vec2(yCoord * 0.035, fk * 5.1) + so))
                             * smoothstep(0.35, 0.55, leakNoise(vec2(yCoord * 0.22, fk * 9.7) + so));
                float microTicks = smoothstep(0.54, 0.68, leakNoise(vec2(yCoord * 0.68, fk * 11.3) + so))
                                 * smoothstep(0.38, 0.62, leakNoise(vec2(yCoord * 0.09, fk * 3.7) + so));
                float ticks = max(dashes, microTicks * 0.92);
                float baseLine = (0.08 + 0.22 * look.y) * (0.4 + 0.6 * leakNoise(vec2(yCoord * 0.35, fk * 7.1) + so));
                float grooveW = 0.08 + 0.24 * dashes + 0.14 * microTicks;
                float groove = (1.0 - smoothstep(grooveW, grooveW + 0.34 + 0.18 * look.x, distPx))
                             * reach * (baseLine + (1.0 - baseLine) * ticks);
                // Tiny asymmetric grit / burr pinholes along the track.
                float burrCell = floor(yCoord / 42.0);
                float burrH = leakHash(vec2(burrCell, fk * 19.0) + so * 23.0);
                if (burrH < 0.055 * reach) {
                    float burrY = (burrCell + 0.2 + 0.6 * leakHash(vec2(burrCell + 1.0, fk))) * 42.0;
                    float burrX = (leakHash(vec2(burrCell + 2.0, fk)) - 0.5) * 1.2;
                    float burrR = 0.55 + 1.15 * pow(leakHash(vec2(burrCell + 3.0, fk) + so), 2.0);
                    float bd = length(vec2(signedPx - burrX, (yCoord - burrY) * 0.8));
                    groove = max(groove, 1.0 - smoothstep(burrR * 0.4, burrR + 0.45, bd));
                }
                // Fine 0.65 px bright refraction lip right beside the dark groove.
                float ridge = (1.0 - smoothstep(0.08, 0.45, abs(signedPx - 0.68)))
                            * reach * (0.12 + 0.58 * ticks) * (1.0 - 0.35 * var);
                bool darkTrack = var > 0.28 || mod(fk, 2.0) < 0.5;
                if (darkTrack) {
                    black = max(black, groove * (0.58 + 0.4 * leakHash(ks + 7.1)));
                    white = max(white, ridge * 0.78);
                } else {
                    white = max(white, groove * (0.42 + 0.48 * leakHash(ks + 7.1)));
                }
            }
            vec3 dustColor = mix(vec3(0.94, 0.95, 0.97), min(c + vec3(0.45, 0.48, 0.52), vec3(1.0)), 0.4);
            c = mix(c, dustColor, clamp(white, 0.0, 1.0) * a);
            c = mix(c, vec3(0.03), clamp(black, 0.0, 1.0) * a);
        } else {
            // Chemical stains ("film soup"): cellular blotches where developer pooled or dried, with a coloured dye
            // wash inside and a concentrated tide-line rim around the boundary. Radial falloff inside the box keeps
            // blotches organic with no rectangular boundary.
            vec2 pn = bp / scale * (1.8 + 2.4 * uFlTint2[i].w);
            float boxEnv = 1.0 - smoothstep(0.45, 0.98, length(q));
            float n = (leakFbm(pn + so) * 0.8 + leakFbm(pn * 2.9 + so + 2.0) * 0.35) * (0.65 + 0.45 * boxEnv);
            float th = 0.54 - 0.2 * look.z;
            float softEdge = 0.018 + 0.07 * look.x;
            float m = smoothstep(th - softEdge, th + softEdge, n) * boxEnv;
            float rim = smoothstep(th - 0.035, th, n) * (1.0 - smoothstep(th, th + 0.045, n)) * boxEnv;
            vec3 dye = mix(uFlTint[i].rgb, uFlTint2[i].rgb, smoothstep(th, th + 0.25, n));
            vec3 washed = 1.0 - (1.0 - c) * exp(-dye * (0.55 + 0.45 * m));
            c = mix(c, washed, m * a * 0.85);
            // Tide-line rim: darker, saturated dye ring where the droplet dried.
            vec3 rimColor = c * mix(vec3(0.45), dye * 0.65, 0.7);
            c = mix(c, rimColor, rim * a * (0.45 + 0.55 * look.y));
        }
    }
    // 5. Grain back over what the leaks replaced, as the hand-made leaks do (the develop's grain is under them).
    // fwidth outside any branch that depends on the pixel (derivatives are undefined in non-uniform control flow).
    float footprint = max(max(fwidth(fullPx.x), fwidth(fullPx.y)), 1.0);
    if (uGrain > 0.0) {
        float changed = max(max(abs(c.r - before.r), abs(c.g - before.g)), abs(c.b - before.b));
        if (changed > 0.0) {
            c += grainNoise(fullPx, (c.r + c.g + c.b) * (1.0 / 3.0)) * (uGrain * 0.03 * min(1.0, uGrainSize / footprint) * clamp(changed * 3.0, 0.0, 1.0));
        }
    }
    return clamp(c, 0.0, 1.0);
}
