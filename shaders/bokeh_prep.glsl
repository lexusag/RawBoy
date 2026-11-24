// Lens blur, pass 1 of 2 (see gl/BokehTexture): appended after develop.glsl (and the film formation, as the develop
// shader is assembled) in place of main_body.glsl, so the masks are evaluated by the very same layerMask. Writes the
// whole image at the bokeh texture's size, premultiplied by the fade-in, with each texel's lens blur radius in texels:
// (rgb * bokehFade(r), r). Row 0 = the top of the image, as every whole-image copy.
uniform sampler2D uBokehSrc;  // whole-image copy (RGBA, mipmapped)
uniform float uBokehSrcLod;   // its mip level matching the bokeh texture's size
uniform vec2 uBokehSize;      // bokeh texture size

void main() {
    vec2 uv = gl_FragCoord.xy / uBokehSize;
    float lm[MAX_LAYERS];
    vec2 p = uv * uImageSize;
    for (int i = 0; i < MAX_LAYERS; ++i) lm[i] = i < uLayerCount ? layerMask(i, p) : 0.0;
    vec3 c = textureLod(uBokehSrc, uv, uBokehSrcLod).rgb;
    // The depth map follows the photo's edges here too (its own colour as the guide):
    // texels of a sharp subject read as background would be spread around it in steps.
    float r = bokehRadius(lm, p, c) * uBokehScale;
    fragColor = vec4(c * bokehFade(r), r);
}
