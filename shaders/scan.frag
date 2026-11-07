#version 300 es
// Film scan upscale: renders a [scale]x larger copy of the image texture that the develop shader reads in place of the
// image (export only, see engine/.../gl/ScanUpscaler.kt and web/src/engine/gl/ScanUpscaler.ts). Complete shader, one
// program for every step (uPass), run on the denoised tile in this order:
//   0 init      bicubic upscale of sqrt(x)                         (A = the source)
//   1 residual  per source pixel: sqrt(x) - the area average of the upscaled image over that pixel   (A = upscaled, B = source)
//   2 update    upscaled += the residual, bilinear   (1 and 2 four times: iterative back projection, so the upscaled
//               image shrinks back to the source exactly and its edges are as sharp as the source allows)
//   3 luma      linear luma of the upscaled image
//   4 blur      horizontal Gaussians over the luma, narrow and wide
//   5 final     vertical Gaussians, then an unsharp mask on the luma as a log ratio (as sharpenGain, but on the upscaled
//               grid and before any grain, so grain is not sharpened); the noise threshold ignores small differences
// The fractions are the published methods, written from their descriptions (back projection: Irani & Peleg 1991).
precision highp float;
precision highp int;
precision highp sampler2D;
uniform int uPass;
uniform sampler2D uA;
uniform sampler2D uB;
uniform vec2 uScale;     // upscaled / source size, per axis
uniform ivec2 uSrcSize;
uniform ivec2 uHrSize;
uniform float uAmount;   // unsharp amount
uniform float uThreshold; // log2 luminance differences below this are left alone
out vec4 o;

const vec3 LUMA = vec3(0.2627, 0.6780, 0.0593); // Rec.2020, as the develop shader's
// Unsharp mask Gaussians, in upscaled pixels. Radius: ceil(2.5 sigma).
const float SIGMA_FINE = 0.8;
const float SIGMA_WIDE = 2.4;
const int R_FINE = 2;
const int R_WIDE = 6;

vec3 srcSqrt(sampler2D src, ivec2 p) {
    return sqrt(max(texelFetch(src, clamp(p, ivec2(0), uSrcSize - 1), 0).rgb, 0.0));
}

// Catmull-Rom weights for the four taps around a position at fraction t.
vec4 cubic(float t) {
    float t2 = t * t, t3 = t2 * t;
    return vec4(-0.5 * t3 + t2 - 0.5 * t, 1.5 * t3 - 2.5 * t2 + 1.0, -1.5 * t3 + 2.0 * t2 + 0.5 * t, 0.5 * t3 - 0.5 * t2);
}

vec3 hr(ivec2 p) {
    return texelFetch(uA, clamp(p, ivec2(0), uHrSize - 1), 0).rgb;
}

float gauss(int i, float sigma) {
    return exp(-0.5 * float(i * i) / (sigma * sigma));
}

void main() {
    ivec2 p = ivec2(gl_FragCoord.xy);
    if (uPass == 0) {
        vec2 f = (vec2(p) + 0.5) / uScale - 0.5;
        ivec2 i0 = ivec2(floor(f));
        vec2 t = f - vec2(i0);
        vec4 wx = cubic(t.x), wy = cubic(t.y);
        vec3 acc = vec3(0.0);
        for (int j = 0; j < 4; ++j) {
            vec3 row = vec3(0.0);
            for (int i = 0; i < 4; ++i) row += wx[i] * srcSqrt(uA, i0 + ivec2(i - 1, j - 1));
            acc += wy[j] * row;
        }
        o = vec4(acc, 1.0);
    } else if (uPass == 1) {
        // Exact area average of the upscaled image over this source pixel [p, p + 1) x uScale.
        vec2 lo = vec2(p) * uScale, hi = vec2(p + 1) * uScale;
        ivec2 j0 = ivec2(floor(lo + 1e-4));
        vec3 acc = vec3(0.0);
        float wsum = 0.0;
        for (int j = 0; j < 3; ++j) {
            for (int i = 0; i < 3; ++i) {
                ivec2 q = j0 + ivec2(i, j);
                vec2 ov = max(min(vec2(q) + 1.0, hi) - max(vec2(q), lo), 0.0);
                float w = ov.x * ov.y;
                acc += w * hr(q);
                wsum += w;
            }
        }
        o = vec4(srcSqrt(uB, p) - acc / wsum, 1.0);
    } else if (uPass == 2) {
        // The residual's texture is linearly filtered: bilinear upsampling at the pixel centre.
        vec3 r = texture(uB, (vec2(p) + 0.5) / vec2(uHrSize)).rgb;
        o = vec4(hr(p) + r, 1.0);
    } else if (uPass == 3) {
        vec3 c = hr(p);
        o = vec4(dot(c * c, LUMA), 0.0, 0.0, 1.0);
    } else if (uPass == 4) {
        float a = 0.0, wa = 0.0, b = 0.0, wb = 0.0;
        for (int i = -R_WIDE; i <= R_WIDE; ++i) {
            float y = texelFetch(uA, clamp(p + ivec2(i, 0), ivec2(0), uHrSize - 1), 0).r;
            float w2 = gauss(i, SIGMA_WIDE);
            b += w2 * y; wb += w2;
            if (abs(i) <= R_FINE) {
                float w1 = gauss(i, SIGMA_FINE);
                a += w1 * y; wa += w1;
            }
        }
        o = vec4(a / wa, b / wb, 0.0, 1.0);
    } else {
        float a = 0.0, wa = 0.0, b = 0.0, wb = 0.0;
        for (int j = -R_WIDE; j <= R_WIDE; ++j) {
            vec2 v = texelFetch(uB, clamp(p + ivec2(0, j), ivec2(0), uHrSize - 1), 0).rg;
            float w2 = gauss(j, SIGMA_WIDE);
            b += w2 * v.g; wb += w2;
            if (abs(j) <= R_FINE) {
                float w1 = gauss(j, SIGMA_FINE);
                a += w1 * v.r; wa += w1;
            }
        }
        float d = log2(max(a / wa, 1e-6)) - log2(max(b / wb, 1e-6));
        d = sign(d) * max(abs(d) - uThreshold, 0.0);
        vec3 c = hr(p);
        o = vec4(c * c * exp2(uAmount * clamp(d, -0.3, 0.3)), 1.0);
    }
}
