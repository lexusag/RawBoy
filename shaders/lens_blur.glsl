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

// Portrait depth at image pixel [p]: uDepthMap holds the colour guided filter's (a.rgb, b) coefficients (GuidedDepth),
// or (0, 0, 0, d) when no base guide was available. Evaluating a · sqrt(guide) + b at full resolution transfers the
// photo's own edges and anti-aliasing directly into the depth map — no texel stairs, no cutout steps, no foreground
// smear halos, and smooth continuous ramps on receding surfaces.
float depthAt(vec2 p, vec3 guide) {
    vec4 ab = texture(uDepthMap, clamp(p / uImageSize, 0.0, 1.0));
    vec3 g = sqrt(max(guide, 0.0));
    return clamp(dot(ab.rgb, g) + ab.a, 0.0, 1.0);
}

float depthBokehRadius(vec2 p) {
    if (uDepthBlur.x <= 0.0) return 0.0;
    return depthBlurOf(texture(uDepthMap, clamp(p / uImageSize, 0.0, 1.0)).a);
}

float depthBokehRadius(vec2 p, vec3 guide) {
    if (uDepthBlur.x <= 0.0) return 0.0;
    return depthBlurOf(depthAt(p, guide));
}

// Lens blur radius at a pixel in full-resolution pixels: the strongest layer's blur or portrait depth blur.
float layersBokehRadius(float r, float lm[MAX_LAYERS]) {
    for (int i = 0; i < MAX_LAYERS; ++i) r = max(r, i < uLayerCount ? lm[i] * uLayerBlur[i] : 0.0);
    return r;
}

float bokehRadius(float lm[MAX_LAYERS], vec2 p) { return layersBokehRadius(depthBokehRadius(p), lm); }

// As above with the portrait depth map guided by the photo's colour at this pixel ([guide]: linear RGB).
float bokehRadius(float lm[MAX_LAYERS], vec2 p, vec3 guide) { return layersBokehRadius(depthBokehRadius(p, guide), lm); }

// Fill for the canvas a crop extends past the picture: the picture's edge mirrored and stretched outwards, blurred more the farther
// out, from sharp at the edge (a disc of 12 taps, rotated per pixel so the leftover reads as grain), read from the whole-image copy so
// preview, 100% and export tiles agree. Light, not display colour: the rest of the develop runs on it as on any pixel.
// The source position for a pixel outside the picture: mirrored about the edge, but only the first FILL_STRETCH long
// sides of the picture are ever read, the mirror slowing down with distance (d' = L (1 - e^(-d/L))), so the edge is
// stretched outwards, smeared further the farther out, instead of repeated. Per axis, so corners stretch both ways.
const float FILL_STRETCH = 0.1;

vec2 fillReflect(vec2 p) {
    float reach = FILL_STRETCH * max(uImageSize.x, uImageSize.y);
    vec2 lo = max(-p, vec2(0.0));
    vec2 hi = max(p - uImageSize, vec2(0.0));
    vec2 inward = reach * (vec2(1.0) - exp(-(lo + hi) / reach));
    return clamp(p, vec2(0.0), uImageSize) + inward * (vec2(greaterThan(lo, vec2(0.0))) - vec2(greaterThan(hi, vec2(0.0))));
}

vec3 fillTap(vec2 q) {
    if (uBaseTexel.x < 0.5) return texture(uBase, q / uImageSize).rgb;
    return texture(uImage, (q - uInOrigin) / uInSpan).rgb;
}

// How far from the picture's edge the fill takes to go from the mirrored picture itself to the blur, in long sides.
// LensTransform adds the same reach to the source region a tile reads (FILL_RAMP).
const float FILL_RAMP = 0.08;

vec3 fillColour(vec2 p) {
    float away = length(max(max(-p, p - uImageSize), vec2(0.0)));
    float ramp = smoothstep(0.0, FILL_RAMP * max(uImageSize.x, uImageSize.y), away);
    float texel = max(uImageSize.x * uBaseTexel.x, uImageSize.y * uBaseTexel.y);
    float radius = (texel * 1.5 + 0.15 * away) * ramp;
    vec3 h = fract(vec3(p.xyx) * 0.1031);
    h += dot(h, h.yzx + 33.33);
    float turn = fract((h.x + h.y) * h.z) * 6.2831853;
    vec3 sum = vec3(0.0);
    for (int i = 0; i < 12; ++i) {
        float a = turn + float(i) * 2.3999632;
        float r = radius * sqrt((float(i) + 0.5) / 12.0);
        sum += fillTap(fillReflect(p + r * vec2(cos(a), sin(a))));
    }
    vec3 blurred = sum / 12.0;
    if (ramp >= 1.0) return blurred;
    // Next to the edge the mirrored full-resolution picture continues it (same detail and grain), fading to the blur.
    vec3 sharp = texture(uImage, (fillReflect(p) - uInOrigin) / uInSpan).rgb;
    return mix(sharp, blurred, ramp);
}
