
// Light leaks (see develop/LightLeaks.kt): film-style warm light laid over the finished, display-encoded picture,
// after the LUT and curves, so at full intensity their core hides what is under it (Pro's tool for covering parts of
// a photo). Two kinds: a glow (an ellipse in image pixels like a radial mask) and a streak (a straight beam with a
// white-hot middle line and coloured edges, as light through a gap in the camera back). Both are placed in image
// pixels, so they stay on the same content through crop, rotation and lens corrections. Every uniform is "off" at 0,
// so programs that don't bind them render as before.
#define MAX_LEAKS 4
uniform int uLeakCount;
uniform vec4 uLeakGeom[MAX_LEAKS];  // centre.xy (image px), 1/rx, 1/ry (streak: half length, half width)
uniform vec4 uLeakShape[MAX_LEAKS]; // cos(angle), sin(angle), softness 0..1, shape seed 0..1 (+ 2 for a streak)
uniform vec4 uLeakColor[MAX_LEAKS]; // rim colour (display RGB), intensity 0..1

// The leak's hot middle: a pale warm white, as where a real leak burns the film most.
const vec3 LEAK_HOT = vec3(1.0, 0.94, 0.80);

vec3 applyLeaks(vec3 c, vec2 p) {
    for (int i = 0; i < MAX_LEAKS; ++i) {
        if (i >= uLeakCount) break;
        vec4 g = uLeakGeom[i];
        vec4 s = uLeakShape[i];
        vec4 col = uLeakColor[i];
        vec2 d = p - g.xy;
        vec2 q = vec2(s.x * d.x + s.y * d.y, -s.y * d.x + s.x * d.y) * g.zw; // 1 on the ellipse / band edge
        bool streak = s.w >= 2.0;
        float seed = (streak ? s.w - 2.0 : s.w) * 6.2832;
        float soft = max(s.z, 0.02);
        float core, glow, r;
        if (streak) {
            // Across the beam: 1 at its edge. The width breathes a little along the length, only ever wider than
            // the band the handles show, so the solid part they mark is always covered.
            float u = abs(q.x);
            float wob = 0.5 + 0.3 * sin(1.7 * q.x + seed) + 0.2 * sin(4.3 * q.x + 5.0 * seed);
            r = abs(q.y) / (1.0 + 0.2 * wob);
            // Along it: full strength between the length handles, fading out beyond them.
            float along = 1.0 - smoothstep(1.0, 1.6, u);
            core = (1.0 - smoothstep(1.0 - soft, 1.0, r)) * along;
            // Faint parallel striations in the fading edges, as light spilling past the film's edge.
            float striae = 0.8 + 0.2 * sin(11.0 * q.y + 3.0 * seed) * sin(5.0 * q.y - 7.0 * seed);
            glow = core * mix(1.0, striae, smoothstep(1.0 - soft, 1.0, r));
            // A wide soft halo either side of the beam.
            glow = max(glow, exp(-1.6 * max(r - 1.0, 0.0)) * (0.2 + 0.25 * soft) * along);
        } else {
            r = length(q);
            // Uneven, organic rim: the glow only ever reaches further than the ellipse (never less), so the solid
            // core the handles show is always covered.
            float th = atan(q.y, q.x + 1e-6); // never atan(0, 0), undefined on some GPUs
            float wob = 0.5 + 0.25 * sin(2.0 * th + seed) + 0.15 * sin(3.0 * th + 7.0 * seed) + 0.1 * sin(5.0 * th + 13.0 * seed);
            r /= 1.0 + 0.18 * wob;
            core = 1.0 - smoothstep(1.0 - soft, 1.0, r);
            // Faint streaks in the fading part, as light fanning out through the gap.
            float rays = 0.8 + 0.2 * sin(7.0 * th + 3.0 * seed) * sin(3.0 * th - 5.0 * seed);
            glow = core * mix(1.0, rays, smoothstep(1.0 - soft, 1.0, r));
            // A long faint tail beyond the rim, as light spreading through the film base (max: no step at the rim).
            glow = max(glow, exp(-3.0 * max(r - 1.0, 0.0)) * 0.15 * soft);
        }
        // Hot and pale in the middle, the chosen colour towards the rim (a streak's white line is narrower).
        vec3 tint = mix(LEAK_HOT, col.rgb, smoothstep(0.0, streak ? 0.55 : 0.75, r));
        float a = col.a;
        // Glow: a screen blend, as light added to the film; it saturates by about half intensity.
        c = 1.0 - (1.0 - c) * (1.0 - tint * min(glow, 1.0) * min(1.0, a * 1.6));
        // Cover: from half intensity the leak also replaces the picture, fully in its core at 100. Squared, so the
        // fading part stays a glow (a straight mix there dulled light colours into a grey ring).
        c = mix(c, tint, core * core * smoothstep(0.4, 1.0, a));
    }
    return clamp(c, 0.0, 1.0);
}
