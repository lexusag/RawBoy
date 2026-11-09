// Light leaks (see develop/LightLeaks.kt): film-style light laid over the finished, display-encoded picture, after
// the LUT and curves, built like the owner's Photoshop action: a white shape, Gaussian-blurred, with an orange then a
// red outer glow, all screen-blended. Screen only ever brightens, so the photo shows through the glow, and the white
// core turns what is under it white (at full intensity it hides it: Pro's tool for covering parts of a photo).
// Shapes: a glow (ellipse, reshapable by 8 outline radii), a streak (a straight beam fading out past its ends) and a
// triangle (apex along +x), each bendable (an arc along its length), taperable and warpable (an uneven, organic edge).
// Texture turns the clean layers into film burn: the light is exposed into the picture (per channel, so a strong leak
// burns white through yellow and orange to red at its edges), mottled, streaked and shifting in colour. Cover replaces
// the picture under the shape before the light goes on, so nothing under it shows however the light falls.
// Placed in image pixels, so they stay on the same content through crop, rotation and lens corrections. The photo's
// grain is laid over them again, so a leak sits under the grain like light on the film. Every uniform is "off" at 0,
// so programs that don't bind them (or only the older ones) render as before.
#define MAX_LEAKS 4
uniform int uLeakCount;
uniform vec4 uLeakGeom[MAX_LEAKS];  // centre.xy (image px), 1/rx, 1/ry (image px; streak: half length, half width)
uniform vec4 uLeakShape[MAX_LEAKS]; // cos(angle), sin(angle), softness 0..1, glow size (in shape radii)
uniform vec4 uLeakColor[MAX_LEAKS]; // inner glow colour (display RGB), intensity 0..1
uniform vec4 uLeakOuter[MAX_LEAKS]; // outer glow colour (display RGB), shape seed 0..1
uniform vec4 uLeakForm[MAX_LEAKS];  // kind (0 glow, 1 streak, 2 triangle), bend (1/px), warp 0..1, taper -1..1
uniform vec4 uLeakLook[MAX_LEAKS];  // texture 0..1, cover 0..1, unused, unused
uniform vec4 uLeakRadii[MAX_LEAKS * 2]; // a glow's outline radii at 22.5° + k 45° (its own frame), minus 1

// Pseudo-random 0..1 for a lattice point (Dave Hoskins' hash without sine: the same on every GPU).
float leakHash(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

// Smooth value noise 0..1.
float leakNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = p - i;
    vec2 w = f * f * (3.0 - 2.0 * f);
    float a = leakHash(i);
    float b = leakHash(i + vec2(1.0, 0.0));
    float c = leakHash(i + vec2(0.0, 1.0));
    float d = leakHash(i + vec2(1.0, 1.0));
    return mix(mix(a, b, w.x), mix(c, d, w.x), w.y);
}

// Three octaves of value noise, 0..1 (mean 0.5).
float leakFbm(vec2 p) {
    float n = 0.5 * leakNoise(p);
    n += 0.3 * leakNoise(p * 2.03 + vec2(5.1, 1.7));
    n += 0.2 * leakNoise(p * 4.07 + vec2(2.3, 8.9));
    return n;
}

// A glow's outline radius (shape radii) at angle [t] of its own frame: a closed Catmull-Rom spline through its 8
// control radii, which sit at 22.5° + k 45° so they stay clear of the size handles on the axes.
float leakRadiusAt(int i, int k) {
    int j = (k + 8) - ((k + 8) / 8) * 8;
    vec4 v = uLeakRadii[i * 2 + j / 4];
    int c = j - (j / 4) * 4;
    return 1.0 + (c == 0 ? v.x : c == 1 ? v.y : c == 2 ? v.z : v.w);
}

float leakRadius(int i, float t) {
    float x = t * (4.0 / 3.14159265) - 0.5; // 8 per turn, the first control radius at 22.5°
    float fl = floor(x);
    float f = x - fl;
    int k = int(fl);
    float r0 = leakRadiusAt(i, k - 1);
    float r1 = leakRadiusAt(i, k);
    float r2 = leakRadiusAt(i, k + 1);
    float r3 = leakRadiusAt(i, k + 2);
    float r = 0.5 * (2.0 * r1 + (r2 - r0) * f + (2.0 * r0 - 5.0 * r1 + 4.0 * r2 - r3) * f * f + (3.0 * r1 - r0 - 3.0 * r2 + r3) * f * f * f);
    return max(r, 0.05);
}

// Signed edge distance in shape radii (0 on the outline, negative inside) of point q in the shape's own frame.
// Triangle: apex (1, 0), base corners (-1, +-1); exact Euclidean distance outside (so the glow keeps an even width and
// doesn't spike past the corners), inside scaled by the inradius so its middle is -1 like the other shapes'.
// Glow: the distance to its (reshaped) outline along the ray from the centre.
float leakEdge(vec2 q, float kind, int i, bool shaped) {
    if (kind > 1.5) {
        vec2 a = vec2(1.0, 0.0);
        vec2 b = vec2(-1.0, 1.0);
        vec2 c = vec2(-1.0, -1.0);
        vec2 e0 = b - a, e1 = c - b, e2 = a - c;
        vec2 v0 = q - a, v1 = q - b, v2 = q - c;
        vec2 p0 = v0 - e0 * clamp(dot(v0, e0) / dot(e0, e0), 0.0, 1.0);
        vec2 p1 = v1 - e1 * clamp(dot(v1, e1) / dot(e1, e1), 0.0, 1.0);
        vec2 p2 = v2 - e2 * clamp(dot(v2, e2) / dot(e2, e2), 0.0, 1.0);
        float sd = sign(e0.x * e2.y - e0.y * e2.x);
        vec2 m = min(min(vec2(dot(p0, p0), sd * (v0.x * e0.y - v0.y * e0.x)),
                         vec2(dot(p1, p1), sd * (v1.x * e1.y - v1.y * e1.x))),
                     vec2(dot(p2, p2), sd * (v2.x * e2.y - v2.y * e2.x)));
        float d = -sqrt(m.x) * sign(m.y);
        return d < 0.0 ? d / 0.618 : d; // 0.618: the inradius
    }
    if (kind > 0.5) return abs(q.y) - 1.0; // streak
    if (!shaped) return length(q) - 1.0;   // glow
    float r = leakRadius(i, atan(q.y, q.x + 1e-6)); // never atan(0, 0)
    return (length(q) - r) / sqrt(r);      // a little tighter where the outline is pulled in, wider where pushed out
}

vec3 applyLeaks(vec3 c, vec2 p, vec2 fullPx) {
    float covered = 0.0; // how much of the picture the leaks replaced, for the grain laid back over them
    for (int i = 0; i < MAX_LEAKS; ++i) {
        if (i >= uLeakCount) break;
        vec4 g = uLeakGeom[i];
        vec4 s = uLeakShape[i];
        vec4 f = uLeakForm[i];
        vec4 look = uLeakLook[i];
        vec4 tintIn = uLeakColor[i];
        vec4 tintOut = uLeakOuter[i];
        bool streak = f.x > 0.5 && f.x < 1.5;
        bool shaped = f.x < 0.5 && (any(notEqual(uLeakRadii[i * 2], vec4(0.0))) || any(notEqual(uLeakRadii[i * 2 + 1], vec4(0.0))));
        vec2 d = p - g.xy;
        float u = s.x * d.x + s.y * d.y;
        float v = -s.y * d.x + s.x * d.y;
        v -= f.y * u * u;                                     // bend: the axis becomes an arc
        float qx = u * g.z;
        float width = max(1.0 + f.w * clamp(qx, -1.0, 1.0), 0.05); // taper: wider towards one end
        vec2 q = vec2(qx, v * g.w / width);
        float e = leakEdge(q, f.x, i, shaped);
        float reach = max(s.w, 0.01);
        // Far outside everything this leak can light (its glow, lumps and warp): skip the noise.
        if (e - f.z * 1.2 > reach * 3.2 + 0.7) continue;
        // Noise coordinates in length radii, the same scale along and across (a streak's width is a small part).
        vec2 pn = vec2(u, v) * g.z;
        vec2 so = vec2(37.0, 17.0) * tintOut.a + vec2(3.1, 7.3); // the seed picks a patch of noise
        float along = 1.0;
        if (streak) along = 1.0 - smoothstep(1.0, 1.6, abs(q.x)); // a streak fades past its ends
        if (f.z > 0.0) {
            // Warp: an organic outline. The shape is pushed around by low-frequency noise and grows lumps, but only ever
            // reaches further out (the union with the clean shape), so whatever it covered stays covered.
            float ew;
            if (streak) {
                // A wandering beam, wider and narrower along its length.
                float wander = (leakFbm(vec2(pn.x * 1.6, 0.5) + so) - 0.5) * 2.0;
                float swell = leakFbm(vec2(pn.x * 2.7, 3.5) + so);
                ew = abs(q.y - f.z * 1.6 * wander) / (1.0 + f.z * 1.4 * swell) - 1.0;
            } else {
                vec2 dw = vec2(leakFbm(pn * 1.4 + so), leakFbm(pn * 1.4 + so + vec2(5.2, 1.3))) - 0.5;
                ew = leakEdge(q + dw * (f.z * 1.1), f.x, i, shaped) - f.z * 0.45 * leakFbm(pn * 2.6 + so + vec2(9.4, 4.1));
            }
            e = min(e, ew);
        }
        float eShape = e; // the outline the cover follows: texture never frays it inwards
        float tex = look.x;
        float mottle = 0.5;
        float rays = 0.5;
        float hueVar = 0.5;
        if (tex > 0.0) {
            mottle = leakFbm(pn * 1.3 + so + vec2(1.7, 9.2));
            rays = leakFbm(vec2(pn.x * 0.5, pn.y * 5.0) + so + vec2(4.4, 2.2)); // fine streaks along the leak's length
            hueVar = leakFbm(pn * 1.1 + so + vec2(8.3, 6.6));
            e += tex * 0.35 * (0.5 - mottle); // the burnt core's edge frays
        }
        float a = tintIn.a * along;
        float blur = 0.03 + 0.6 * s.z;
        vec3 before = c;
        // Cover: the picture under the shape is replaced by a dim wash of the leak's colours before the light goes on,
        // solid inside the outline whatever the softness, so the light over it never lets the picture through.
        float cover = 0.0;
        if (look.y > 0.0) {
            float cb = 0.03 + 0.25 * s.z;
            cover = look.y * a * (1.0 - smoothstep(-cb, cb, eShape - cb));
            vec3 wash = mix(tintOut.rgb, tintIn.rgb, 0.35 + 0.5 * hueVar) * (0.32 + 0.25 * mottle) + 0.06;
            c = mix(c, wash, cover);
        }
        // Core: the white shape, Gaussian-blurred over the softness (half covered on the outline).
        float core = 1.0 - smoothstep(-blur, blur, e);
        // Outer glows: the inner colour hugging the shape, the outer one reaching twice as far (Photoshop's two outer
        // glows at 58%).
        float o = max(e, 0.0) / reach;
        float glowIn = 0.58 * exp(-4.0 * o * o);
        float glowOut = 0.58 * exp(-o * o);
        vec3 lit = c;
        if (tex < 1.0) {
            // Clean layers, screen-blended (Photoshop's action).
            lit = 1.0 - (1.0 - lit) * (1.0 - tintOut.rgb * glowOut * a);
            lit = 1.0 - (1.0 - lit) * (1.0 - tintIn.rgb * glowIn * a);
            lit = 1.0 - (1.0 - lit) * (1.0 - vec3(core * a));
        }
        if (tex > 0.0) {
            // Film burn: the light is exposed into the picture per channel (1 - (1 - c) e^-E), its colour drifting
            // between the two hues, mottled and streaked. Red fills first, then green, then blue, so the leak burns
            // white in the middle, yellow and orange around it and red at the edge, like light on a negative.
            float bright = (0.35 + 1.3 * mottle) * (0.75 + 0.5 * rays);
            vec3 hue = mix(tintIn.rgb, tintOut.rgb, smoothstep(0.25, 0.75, hueVar) * 0.8);
            vec3 tint = mix(hue * vec3(1.0, 0.8, 0.6), vec3(1.0), 0.08);
            float light = a * (core * 5.0 * mix(1.0, bright, 0.5) + (1.6 * glowIn + 0.9 * glowOut) * bright);
            vec3 burnt = 1.0 - (1.0 - c) * exp(-light * (tint * 1.7 + vec3(0.04)));
            lit = mix(lit, burnt, tex);
        }
        c = lit;
        float changed = max(max(abs(c.r - before.r), abs(c.g - before.g)), abs(c.b - before.b)) / max(1.0 - min(min(before.r, before.g), before.b), 1e-3);
        covered = 1.0 - (1.0 - covered) * (1.0 - clamp(max(changed, cover), 0.0, 1.0));
    }
    if (uGrain > 0.0 && covered > 0.0) {
        // Screen flattens the grain under the light; lay it back as much as the leaks took away (display units, about
        // the grain's mid-tone strength), so the leak sits under the grain.
        float footprint = max(max(fwidth(fullPx.x), fwidth(fullPx.y)), 1.0);
        c += grainNoise(fullPx) * (uGrain * 0.03 * min(1.0, uGrainSize / footprint) * covered);
    }
    return clamp(c, 0.0, 1.0);
}
