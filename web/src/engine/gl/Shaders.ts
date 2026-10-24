// The develop pipeline's GLSL, shared with Android: <repo>/shaders is the single source of truth.
// WebGL2 is GLSL ES 3.00, the same dialect as Android's GLES 3.0, so the files are used unchanged.
import DEVELOP from '../../../../shaders/develop.glsl?raw';
import DEVELOP_VERT from '../../../../shaders/develop.vert?raw';
import FILM_FORM from '../../../../shaders/film_form.glsl?raw';
import LIGHT_LEAK from '../../../../shaders/light_leak.glsl?raw';
import MAIN_BODY from '../../../../shaders/main_body.glsl?raw';

/** Same assembly as engine/.../gl/Shaders.kt. */
export const Shaders = {
  VERTEX: DEVELOP_VERT,

  fragment(forExport: boolean): string {
    // highp int: fragment shaders default ints to mediump (16-bit on some GPUs), which breaks the 32-bit grain hash.
    let s = '#version 300 es\nprecision highp float;\nprecision highp int;\nprecision highp sampler2D;\nprecision highp sampler3D;\n';
    s += forExport ? 'out uvec4 fragColor;\n' : 'out vec4 fragColor;\n';
    s += DEVELOP;
    s += FILM_FORM;
    s += LIGHT_LEAK;
    s += MAIN_BODY;
    s += '    if (uLutAmount > 0.0) c = clamp(applyLut(c), 0.0, 1.0);\n';
    s += '    if (uCurveOn > 0.0) c = applyCurves(c);\n';
    s += '    if (uLeakCount > 0) c = applyLeaks(c, srcG);\n';
    // 16-bit unsigned integer target for export: exact, core in WebGL2.
    s += forExport
      ? '    fragColor = uvec4(uvec3(c * 65535.0 + 0.5), 65535u);\n'
      : '    if (uClipWarn > 0.0) c = clipWarning(c);\n    fragColor = vec4(c, 1.0);\n';
    s += '}\n';
    return s;
  },
};
