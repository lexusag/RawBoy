
// Light leaks (see develop/LightLeaks.kt): film-style light laid over the finished, display-encoded picture, after
// the LUT and curves, built like the owner's Photoshop action: a white shape, Gaussian-blurred, with an orange then a
// red outer glow, all screen-blended. Screen only ever brightens, so the photo shows through the glow, and the white
// core turns what is under it white (at full intensity it hides it: Pro's tool for covering parts of a photo).
// Shapes: a glow (ellipse), a streak (a straight beam fading out past its ends) and a triangle (apex along +x), each
// bendable (an arc along its length), taperable and warpable (an uneven edge). Placed in image pixels, so they stay on
// the same content through crop, rotation and lens corrections. The photo's grain is laid over them again, so a leak
// sits under the grain like light on the film. Every uniform is "off" at 0, so programs that don't bind them render
// as before.
#define MAX_LEAKS 4
uniform int uLeakCount;
uniform vec4 uLeakGeom[MAX_LEAKS];  // centre.xy (image px), 1/rx, 1/ry (image px; streak: half length, half width)
uniform vec4 uLeakShape[MAX_LEAKS]; // cos(angle), sin(angle), softness 0..1, glow size (in shape radii)
uniform vec4 uLeakColor[MAX_LEAKS]; // inner glow colour (display RGB), intensity 0..1
uniform vec4 uLeakOuter[MAX_LEAKS]; // outer glow colour (display RGB), shape seed 0..1
uniform vec4 uLeakForm[MAX_LEAKS];  // kind (0 glow, 1 streak, 2 triangle), bend (1/px), warp 0..1, taper -1..1

// Signed edge distance in shape radii (0 on the outline, negative inside) of point q in the shape's own frame.
// Triangle: apex (1, 0), base corners (-1, +-1); exact Euclidean distance outside (so the glow keeps an even width and
// doesn't spike past the corners), inside scaled by the inradius so its middle is -1 like the other shapes'.
float leakEdge(vec2 q, float kind) {
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
    return length(q) - 1.0;                // glow
}

vec3 applyLeaks(vec3 c, vec2 p, vec2 fullPx) {
    float covered = 0.0; // how much of the picture the leaks replaced, for the grain laid back over them
    for (int i = 0; i < MAX_LEAKS; ++i) {
        if (i >= uLeakCount) break;
        vec4 g = uLeakGeom[i];
        vec4 s = uLeakShape[i];
        vec4 f = uLeakForm[i];
        vec4 tintIn = uLeakColor[i];
        vec4 tintOut = uLeakOuter[i];
        vec2 d = p - g.xy;
        float u = s.x * d.x + s.y * d.y;
        float v = -s.y * d.x + s.x * d.y;
        v -= f.y * u * u;                                     // bend: the axis becomes an arc
        float qx = u * g.z;
        float width = max(1.0 + f.w * clamp(qx, -1.0, 1.0), 0.05); // taper: wider towards one end
        vec2 q = vec2(qx, v * g.w / width);
        float e = leakEdge(q, f.x);
        float along = 1.0;
        if (f.x > 0.5 && f.x < 1.5) along = 1.0 - smoothstep(1.0, 1.6, abs(q.x)); // a streak fades past its ends
        if (f.z > 0.0) {
            // Warp: an uneven, organic edge that only ever reaches further out.
            float seed = tintOut.a * 6.2832;
            float t = f.x > 0.5 && f.x < 1.5 ? q.x * 2.0 : atan(q.y, q.x + 1e-6); // never atan(0, 0)
            float wob = 0.5 + 0.25 * sin(2.0 * t + seed) + 0.15 * sin(3.0 * t + 7.0 * seed) + 0.1 * sin(5.0 * t + 13.0 * seed);
            e -= f.z * 0.6 * wob;
        }
        // Core: the white shape, Gaussian-blurred over the softness (half covered on the outline).
        float blur = 0.03 + 0.6 * s.z;
        float core = 1.0 - smoothstep(-blur, blur, e);
        // Outer glows: the inner colour hugging the shape, the outer one reaching twice as far (Photoshop's two outer
        // glows at 58%).
        float o = max(e, 0.0) / max(s.w, 0.01);
        float glowIn = 0.58 * exp(-4.0 * o * o);
        float glowOut = 0.58 * exp(-o * o);
        float a = tintIn.a * along;
        vec3 before = c;
        c = 1.0 - (1.0 - c) * (1.0 - tintOut.rgb * glowOut * a);
        c = 1.0 - (1.0 - c) * (1.0 - tintIn.rgb * glowIn * a);
        c = 1.0 - (1.0 - c) * (1.0 - vec3(core * a));
        float lit = max(max(c.r - before.r, c.g - before.g), c.b - before.b) / max(1.0 - min(min(before.r, before.g), before.b), 1e-3);
        covered = 1.0 - (1.0 - covered) * (1.0 - clamp(lit, 0.0, 1.0));
    }
    if (uGrain > 0.0 && covered > 0.0) {
        // Screen flattens the grain under the light; lay it back as much as the leaks took away (display units, about
        // the grain's mid-tone strength), so the leak sits under the grain.
        float footprint = max(max(fwidth(fullPx.x), fwidth(fullPx.y)), 1.0);
        c += grainNoise(fullPx) * (uGrain * 0.03 * min(1.0, uGrainSize / footprint) * covered);
    }
    return clamp(c, 0.0, 1.0);
}
