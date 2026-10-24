#version 300 es
// Lens blur, pass 2 of 2 (see gl/BokehTexture): a round disc gather over the small premultiplied copy from
// bokeh_prep.glsl (rgb * a, radius in texels). Every texel inside the radius is read, so small bright lights become
// clean discs. A sample spreads only as far as the smaller of its own radius and this texel's: the masks stand in for
// depth with the sharp subject in front, so sharp texels never smear and the blurred background never covers them.
// Output premultiplied (rgb * v, v), v = 0 where no blurred sample reaches, so upsampling never pulls in black.
precision highp float;
precision highp int;
precision highp sampler2D;
uniform sampler2D uSrc;
uniform int uMaxRadius; // ceil(largest radius in texels)
out vec4 o;
void main() {
    ivec2 p = ivec2(gl_FragCoord.xy);
    ivec2 size = textureSize(uSrc, 0);
    float rp = texelFetch(uSrc, p, 0).a;
    int reach = min(int(ceil(rp)) + 1, uMaxRadius + 1);
    vec4 acc = vec4(0.0);
    for (int dy = -reach; dy <= reach; ++dy) {
        for (int dx = -reach; dx <= reach; ++dx) {
            ivec2 q = p + ivec2(dx, dy);
            if (q.x < 0 || q.y < 0 || q.x >= size.x || q.y >= size.y) continue;
            vec4 s = texelFetch(uSrc, q, 0);
            float r = min(s.a, rp);
            // Coverage of this texel by the sample's disc, with a one-texel soft edge.
            float cover = clamp(r - length(vec2(dx, dy)) + 0.5, 0.0, 1.0);
            if (cover <= 0.0) continue;
            // Each disc spreads its light over its area; s.rgb is already weighted by the fade-in (bokehFade).
            float w = cover / max(r * r, 0.25);
            acc += vec4(s.rgb, clamp(s.a / 1.5, 0.0, 1.0)) * w;
        }
    }
    float v = acc.a > 1e-6 ? 1.0 : 0.0;
    o = vec4(v * acc.rgb / max(acc.a, 1e-6), v);
}
