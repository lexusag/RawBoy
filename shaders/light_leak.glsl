
// Light leaks (see develop/LightLeaks.kt): film-style warm glows laid over the finished, display-encoded picture,
// after the LUT and curves, so at full intensity their core hides what is under it (Pro's tool for covering parts of
// a photo). Each is an ellipse in image pixels like a radial mask, so it stays on the same content through crop,
// rotation and lens corrections. Every uniform is "off" at 0, so programs that don't bind them render as before.
#define MAX_LEAKS 4
uniform int uLeakCount;
uniform vec4 uLeakGeom[MAX_LEAKS];  // centre.xy (image px), 1/rx, 1/ry
uniform vec4 uLeakShape[MAX_LEAKS]; // cos(angle), sin(angle), softness 0..1, shape seed 0..1
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
        vec2 q = vec2(s.x * d.x + s.y * d.y, -s.y * d.x + s.x * d.y) * g.zw; // 1 on the ellipse
        float r = length(q);
        // Uneven, organic rim: the glow only ever reaches further than the ellipse (never less), so the solid core
        // the handles show is always covered.
        float th = atan(q.y, q.x + 1e-6); // never atan(0, 0), undefined on some GPUs
        float seed = s.w * 6.2832;
        float wob = 0.5 + 0.25 * sin(2.0 * th + seed) + 0.15 * sin(3.0 * th + 7.0 * seed) + 0.1 * sin(5.0 * th + 13.0 * seed);
        r /= 1.0 + 0.18 * wob;
        float soft = max(s.z, 0.02);
        float core = 1.0 - smoothstep(1.0 - soft, 1.0, r);
        // Faint streaks in the fading part, as light fanning out through the gap.
        float streak = 0.8 + 0.2 * sin(7.0 * th + 3.0 * seed) * sin(3.0 * th - 5.0 * seed);
        float glow = core * mix(1.0, streak, smoothstep(1.0 - soft, 1.0, r));
        // A long faint tail beyond the rim, as light spreading through the film base (max: no step at the rim).
        glow = max(glow, exp(-3.0 * max(r - 1.0, 0.0)) * 0.15 * soft);
        // Hot and pale in the middle, the chosen colour towards the rim.
        vec3 tint = mix(LEAK_HOT, col.rgb, smoothstep(0.0, 0.75, r));
        float a = col.a;
        // Glow: a screen blend, as light added to the film; it saturates by about half intensity.
        c = 1.0 - (1.0 - c) * (1.0 - tint * min(glow, 1.0) * min(1.0, a * 1.6));
        // Cover: from half intensity the leak also replaces the picture, fully in its core at 100. Squared, so the
        // fading part stays a glow (a straight mix there dulled light colours into a grey ring).
        c = mix(c, tint, core * core * smoothstep(0.4, 1.0, a));
    }
    return clamp(c, 0.0, 1.0);
}
