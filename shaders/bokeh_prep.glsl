// Lens blur, pass 1 of 2 (see gl/BokehTexture): appended after develop.glsl (and the film formation, as the develop
// shader is assembled) in place of main_body.glsl, so the masks are evaluated by the very same layerMask. Writes the
// highlight-boosted whole image at the bokeh texture's size, premultiplied by the fade-in, with each texel's lens blur
// radius in texels: (rgb * bokehFade(r), r). Row 0 = the top of the image, as every whole-image copy.
uniform sampler2D uBokehSrc;  // highlight-boosted whole image (RGBA, mipmapped)
uniform float uBokehSrcLod;   // its mip level matching the bokeh texture's size
uniform vec2 uBokehSize;      // bokeh texture size

void main() {
    vec2 uv = gl_FragCoord.xy / uBokehSize;
    float lm[MAX_LAYERS];
    for (int i = 0; i < MAX_LAYERS; ++i) lm[i] = i < uLayerCount ? layerMask(i, uv * uImageSize) : 0.0;
    float r = bokehRadius(lm) * uBokehScale;
    vec3 c = textureLod(uBokehSrc, uv, uBokehSrcLod).rgb;
    fragColor = vec4(c * bokehFade(r), r);
}
