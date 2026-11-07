// The DNG SDK decoder against LibRaw: dng_decode_test in.dng.
//
// A Packer Small raw (lossy JPEG XL) is decoded by the DNG SDK, the same photo's original DNG by LibRaw. Both must put
// the scene at the same level: the SDK path once left green at 1 where LibRaw normalises its white balance to the
// largest multiplier, so a Small raw opened a stop or more brighter in Auto (a Pixel 9 Pro's blue multiplier is 2).
// Compares the mean of both images and the clip levels (the original's gain maps lift its corners a little, so the
// means may differ by a few percent; a DNG with only AsShotWhiteXY, like a Pixel night shot, gets a slightly different
// white balance from LibRaw than from the SDK, which moves the clip level by about 9%).
#include "rawboy.h"

#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <fstream>
#include <iterator>
#include <vector>

namespace {

int failures = 0;
void check(bool ok, const char* what) {
    std::printf("%s: %s\n", ok ? "ok  " : "FAIL", what);
    if (!ok) failures++;
}

float halfToFloat(uint16_t h) {
    const int e = (h >> 10) & 0x1f, f = h & 0x3ff;
    if (e == 0) return static_cast<float>(f) / 16777216.0f;
    if (e == 31) return INFINITY;
    return std::ldexp(1.0f + static_cast<float>(f) / 1024.0f, e - 15);
}

double meanOf(const rawboy::DecodedImage& image) {
    double sum = 0;
    uint64_t count = 0;
    for (size_t i = 0; i < image.rgb.size(); i += 97) {
        sum += halfToFloat(image.rgb[i]);
        count++;
    }
    return sum / static_cast<double>(count);
}

}  // namespace

int main(int argc, char** argv) {
    if (argc < 2) {
        std::fprintf(stderr, "usage: %s in.dng\n", argv[0]);
        return 2;
    }
    std::ifstream in(argv[1], std::ios::binary);
    std::vector<uint8_t> original((std::istreambuf_iterator<char>(in)), std::istreambuf_iterator<char>());

    std::string error;
    std::vector<uint8_t> small;
    if (rawboy::transcodeToLossyJxlDng(original.data(), original.size(), 0.2f, 3, small, error) !=
        rawboy::TranscodeResult::Done) {
        std::printf("FAIL: could not make a Small raw of the input (%s)\n", error.c_str());
        return 1;
    }
    rawboy::DecodedImage libraw, sdk;
    if (!rawboy::decodeWithLibRaw(original.data(), original.size(), libraw, error, 0.0f, true)) {
        std::printf("FAIL: LibRaw: %s\n", error.c_str());
        return 1;
    }
    if (!rawboy::decodeWithDngSdk(small.data(), small.size(), sdk, error)) {
        std::printf("FAIL: DNG SDK: %s\n", error.c_str());
        return 1;
    }
    const double a = meanOf(libraw), b = meanOf(sdk);
    std::printf("mean: LibRaw %.4f, DNG SDK %.4f; clip level: LibRaw %.3f, DNG SDK %.3f\n", a, b, libraw.clipLevel,
                sdk.clipLevel);
    check(std::fabs(b / a - 1.0) < 0.15, "the mean level matches (within 15%)");
    check(std::fabs(sdk.clipLevel / libraw.clipLevel - 1.0) < 0.12, "the clip level matches (within 12%)");
    return failures ? 1 : 0;
}
