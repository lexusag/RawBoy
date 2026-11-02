#include "color_math.h"

#include <cassert>
#include <cmath>
#include <cstdio>

using rawboy::blendClipped;

int main() {
    // Typical daylight white balance clip levels (Green is lowest):
    const float clip[3] = {64000.0f, 38580.0f, 65535.0f};

    // 1. Fully blown white highlight: all channels at their clip level.
    // Must come out perfectly neutral at the mean of clip, with no channel clamped.
    {
        float c[3] = {clip[0], clip[1], clip[2]};
        blendClipped(c, clip);
        const float expectedMean = (clip[0] + clip[1] + clip[2]) / 3.0f;
        assert(std::fabs(c[0] - expectedMean) < 1.0f);
        assert(std::fabs(c[1] - expectedMean) < 1.0f);
        assert(std::fabs(c[2] - expectedMean) < 1.0f);
        assert(c[1] > clip[1]);  // Green blends above its clip to match Red and Blue
    }

    // 2. Near-white highlight: Green clips at lowest, Red and Blue are brighter.
    // Must blend all three channels to their mean (44860) without holding Green at its clip (producing magenta).
    {
        float c[3] = {48000.0f, 38580.0f, 48000.0f};
        blendClipped(c, clip);
        const float expectedMean = (48000.0f + 38580.0f + 48000.0f) / 3.0f;
        assert(std::fabs(c[0] - expectedMean) < 1.0f);
        assert(std::fabs(c[1] - expectedMean) < 1.0f);
        assert(std::fabs(c[2] - expectedMean) < 1.0f);
        assert(c[1] > clip[1]);  // Green blends above its clip to avoid magenta cast
    }

    // 3. Saturated coloured light: Red clips, Green and Blue are dark (e.g. red gels / studio light).
    // Must remain untouched: no green/blue fill injected, no red desaturation.
    {
        float c[3] = {64000.0f, 1000.0f, 800.0f};
        const float orig[3] = {c[0], c[1], c[2]};
        blendClipped(c, clip);
        assert(c[0] == orig[0]);
        assert(c[1] == orig[1]);
        assert(c[2] == orig[2]);
    }

    // 4. Midtones: all channels below 0.9 of their clip level.
    // Must remain untouched.
    {
        float c[3] = {30000.0f, 20000.0f, 25000.0f};
        const float orig[3] = {c[0], c[1], c[2]};
        blendClipped(c, clip);
        assert(c[0] == orig[0]);
        assert(c[1] == orig[1]);
        assert(c[2] == orig[2]);
    }

    std::printf("All blendClipped tests passed.\n");
    return 0;
}
