// Lens blur radii (mask layers' blur and the portrait depth map) and the fade-in, for main_body.glsl and
// bokeh_prep.glsl. Assembled right after develop.glsl and film_form.glsl (it uses their uniforms); kept apart so
// develop.glsl stays under the JVM's 64 KB string constant (engine's generateShaderSources).

// How much of the lens blur shows at a radius of [r] bokeh texels: below ~1.5 texels the small texture can't hold
// the blur, so it fades in from the sharp image. The bokeh passes weight their samples by the same ramp.
float bokehFade(float r) { return clamp(r / 1.5, 0.0, 1.0); }

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

// The depth map upsampled along the photo's edges (joint bilateral upsampling). The map is ~500 px with hard steps:
// read bilinearly, the sharp/blurred boundary followed its texel grid and notched straight edges in stairs (a phone
// stand's arm, 2026-11-23). Each of the 4x4 depth texels around [p] gets its blur radius in [r] and a weight in [w]:
// its distance (Gaussian, sigma 1 texel) times how close the 512 px base copy at that texel is to this pixel's own
// colour [guide] (linear, the image's units; compared in the sqrt domain). Edge softness (uDepthBlur.w) loosens the
// colour match, so the weights lean on distance and the boundary spreads over the texels around it. False where
// the texels hold one depth (most of the picture) or without a base copy (a 1x1 stand-in): use the plain lookup.
bool depthNeighbours(vec2 p, vec3 guide, out float r[16], out float w[16], out float total) {
    total = 0.0;
    ivec2 ds = textureSize(uDepthMap, 0);
    if (uDepthBlur.x <= 0.0 || ds.x < 2 || textureSize(uBase, 0).x < 64) return false;
    vec2 c = clamp(p / uImageSize, 0.0, 1.0) * vec2(ds) - 0.5;
    vec2 f = floor(c);
    float lo = 1.0, hi = 0.0;
    for (int k = 0; k < 16; ++k) {
        float d = texelFetch(uDepthMap, clamp(ivec2(f + vec2(k % 4 - 1, k / 4 - 1)), ivec2(0), ds - 1), 0).r;
        lo = min(lo, d);
        hi = max(hi, d);
        r[k] = depthBlurOf(d);
    }
    if (hi - lo < 0.02) return false;
    vec3 g = sqrt(max(guide, 0.0));
    // Tolerance grows with brightness (shot noise); noise alone stays well inside it. Softness widens it up to 3x:
    // wider, the weights were mostly distance and the boundary followed the texel grid again.
    float sigma = (0.02 + 0.2 * (g.r + g.g + g.b) / 3.0) * (1.0 + 2.0 * uDepthBlur.w);
    float invRange = 1.0 / (2.0 * sigma * sigma);
    for (int k = 0; k < 16; ++k) {
        vec2 q = f + vec2(k % 4 - 1, k / 4 - 1);
        vec2 o = c - q;
        vec3 b = sqrt(max(texture(uBase, (q + 0.5) / vec2(ds)).rgb, 0.0)) - g;
        // A floor keeps the distance weights where no texel looks like this pixel (a line finer than the copy).
        w[k] = exp(-dot(o, o) * 0.5) * (exp(-dot(b, b) * invRange) + 1e-4);
        total += w[k];
    }
    return true;
}

// Weighted quantiles of [v]: the mean of the values between the fractions [lo] and [hi] of the weight when sorted
// (lo == hi: the value at that fraction; 0.5 = the weighted median). A median, not a mean, at the edge: the blur
// starts just behind the focus depth, so a mean that took 20-30% from the background behind a subject's edge already
// blurred it, in lumps. A band centred on 0.5 fades evenly between the two sides instead.
float weightedBand(float v[16], float w[16], float total, float lo, float hi) {
    float acc = 0.0, accW = 0.0;
    for (int i = 0; i < 16; ++i) {
        float below = 0.0;
        for (int j = 0; j < 16; ++j) below += v[j] < v[i] || (v[j] == v[i] && j < i) ? w[j] : 0.0;
        float a = below / total, b = (below + w[i]) / total;
        if (hi - lo < 1e-4) {
            if (a <= lo && lo < b) return v[i];
        } else {
            float o = max(0.0, min(b, hi) - max(a, lo));
            acc += o * v[i];
            accW += o;
        }
    }
    return accW > 0.0 ? acc / accW : v[15];
}

// Portrait blur radius following the photo's edges, for the blur's own pass (bokeh_prep): the median, or with edge
// softness a higher quantile, so the blurred copy reaches into the subject's edge where main_body fades into it.
float depthBokehRadius(vec2 p, vec3 guide) {
    float r[16], w[16], total;
    if (!depthNeighbours(p, guide, r, w, total)) return depthBokehRadius(p);
    float q = 0.5 + 0.3 * uDepthBlur.w;
    return weightedBand(r, w, total, q, q);
}

// How much of the portrait blur shows at pixel [p] (0..1, as bokehFade), following the photo's edges: the
// weighted median of the neighbours' fades, or with edge softness the mean over a band around it (up to all of
// them), so the boundary fades over a few texels.
float depthBlurMix(vec2 p, vec3 guide) {
    float r[16], w[16], total;
    if (!depthNeighbours(p, guide, r, w, total)) return bokehFade(depthBokehRadius(p) * uBokehScale);
    for (int k = 0; k < 16; ++k) r[k] = bokehFade(r[k] * uBokehScale);
    float band = 0.5 * uDepthBlur.w;
    return weightedBand(r, w, total, 0.5 - band, 0.5 + band);
}

// Lens blur radius at a pixel in full-resolution pixels: the strongest layer's blur or portrait depth blur.
float layersBokehRadius(float r, float lm[MAX_LAYERS]) {
    for (int i = 0; i < MAX_LAYERS; ++i) r = max(r, i < uLayerCount ? lm[i] * uLayerBlur[i] : 0.0);
    return r;
}

float bokehRadius(float lm[MAX_LAYERS], vec2 p) { return layersBokehRadius(depthBokehRadius(p), lm); }

// As above with the portrait depth map following the photo's edges at this pixel ([guide]: its colour).
float bokehRadius(float lm[MAX_LAYERS], vec2 p, vec3 guide) { return layersBokehRadius(depthBokehRadius(p, guide), lm); }

// How much of the lens blur shows at a pixel: the layers' fade or the portrait blur's ([guide]: the pixel's colour).
float bokehMix(float lm[MAX_LAYERS], vec2 p, vec3 guide) {
    return max(depthBlurMix(p, guide), bokehFade(layersBokehRadius(0.0, lm) * uBokehScale));
}
