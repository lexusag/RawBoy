// Lens blur radii (mask layers' blur and the portrait depth map) and the fade-in, for main_body.glsl and
// bokeh_prep.glsl. Assembled right after develop.glsl and film_form.glsl (it uses their uniforms); kept apart so
// develop.glsl stays under the JVM's 64 KB string constant (engine's generateShaderSources).

// Portrait depth blur radius in full-resolution pixels at image pixel [p]: zero inside a deadzone around focus depth
// uDepthBlur.y, ramping smoothly with falloff uDepthBlur.z (0 = deep DoF / gentle falloff, 1 = shallow DoF / steep).
float depthBlurOf(float d) {
    float dist = abs(d - uDepthBlur.y);
    float deadzone = 0.04 + 0.16 * (1.0 - uDepthBlur.z);
    float ramp = max(0.15, 0.85 * (1.0 - uDepthBlur.z));
    return uDepthBlur.x * smoothstep(deadzone, deadzone + ramp, dist);
}

float depthBokehRadius(vec2 p) {
    if (uDepthBlur.x <= 0.0) return 0.0;
    return depthBlurOf(texture(uDepthMap, clamp(p / uImageSize, 0.0, 1.0)).r);
}

// The same with the depth map upsampled along the photo's edges (joint bilateral upsampling): the map is ~500 px
// with hard steps, so read bilinearly the sharp/blurred boundary followed its texel grid and notched straight edges
// in stairs (a phone stand's arm, 2026-11-23). Each of the 4x4 depth texels around [p] is weighted by its distance
// and by how close the 512 px base copy at that texel is to this pixel's own colour [guide] (linear, the image's
// units; compared in the sqrt domain), and the pixel takes their weighted **median**: the blur starts just behind
// the focus depth, so a weighted mean that took 20-30% from the background behind a subject's edge already blurred
// it, in lumps. Without a base copy (a 1x1 stand-in) it is the plain lookup.
float depthBokehRadius(vec2 p, vec3 guide) {
    if (uDepthBlur.x <= 0.0) return 0.0;
    ivec2 ds = textureSize(uDepthMap, 0);
    if (ds.x < 2 || textureSize(uBase, 0).x < 64) return depthBokehRadius(p);
    vec2 uv = clamp(p / uImageSize, 0.0, 1.0);
    vec2 c = uv * vec2(ds) - 0.5;
    vec2 f = floor(c);
    float dv[16];
    float wv[16];
    float lo = 1.0, hi = 0.0;
    for (int k = 0; k < 16; ++k) {
        vec2 q = f + vec2(k % 4 - 1, k / 4 - 1);
        dv[k] = texelFetch(uDepthMap, clamp(ivec2(q), ivec2(0), ds - 1), 0).r;
        lo = min(lo, dv[k]);
        hi = max(hi, dv[k]);
    }
    // No edge in the depth here: the plain lookup (most of the picture, and cheaper).
    if (hi - lo < 0.02) return depthBokehRadius(p);
    vec3 g = sqrt(max(guide, 0.0));
    // Tolerance grows with brightness (shot noise); noise alone stays well inside it.
    float sigma = 0.02 + 0.2 * (g.r + g.g + g.b) / 3.0;
    float invRange = 1.0 / (2.0 * sigma * sigma);
    float total = 0.0;
    for (int k = 0; k < 16; ++k) {
        vec2 q = f + vec2(k % 4 - 1, k / 4 - 1);
        vec2 o = c - q;
        float ws = exp(-dot(o, o) * 0.5);  // Gaussian, sigma 1 texel
        vec3 b = sqrt(max(texture(uBase, (q + 0.5) / vec2(ds)).rgb, 0.0)) - g;
        // A floor keeps the spatial weights where no texel looks like this pixel (a line finer than the copy).
        wv[k] = ws * (exp(-dot(b, b) * invRange) + 1e-4);
        total += wv[k];
    }
    // Weighted (lower) median: the largest depth with at most half the weight below it.
    float d = lo, best = -1.0;
    for (int k = 0; k < 16; ++k) {
        float below = 0.0;
        for (int m = 0; m < 16; ++m) below += dv[m] < dv[k] ? wv[m] : 0.0;
        if (below <= 0.5 * total && below > best) {
            best = below;
            d = dv[k];
        }
    }
    return depthBlurOf(d);
}

// Lens blur radius at a pixel in full-resolution pixels: the strongest layer's blur or portrait depth blur.
float layersBokehRadius(float r, float lm[MAX_LAYERS]) {
    for (int i = 0; i < MAX_LAYERS; ++i) r = max(r, i < uLayerCount ? lm[i] * uLayerBlur[i] : 0.0);
    return r;
}

float bokehRadius(float lm[MAX_LAYERS], vec2 p) { return layersBokehRadius(depthBokehRadius(p), lm); }

// As above with the portrait depth map following the photo's edges at this pixel ([guide]: its colour).
float bokehRadius(float lm[MAX_LAYERS], vec2 p, vec3 guide) { return layersBokehRadius(depthBokehRadius(p, guide), lm); }

// How much of the lens blur shows at a radius of [r] bokeh texels: below ~1.5 texels the small texture can't hold
// the blur, so it fades in from the sharp image. The bokeh passes weight their samples by the same ramp.
float bokehFade(float r) { return clamp(r / 1.5, 0.0, 1.0); }
