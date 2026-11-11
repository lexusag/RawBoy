// Host test for long_exposure.h: averages and lighten of synthetic frames, with a padded row stride.
#include "long_exposure.h"
#include <cstdio>
#include <cstdlib>

static int fails = 0;
#define CHECK(c) do { if (!(c)) { std::printf("FAIL %s:%d %s\n", __FILE__, __LINE__, #c); ++fails; } } while (0)

static std::vector<uint8_t> frame(int w, int h, int stride, uint16_t (*f)(int, int, int), int n) {
    std::vector<uint8_t> b(static_cast<size_t>(stride) * h, 0);
    for (int y = 0; y < h; ++y)
        for (int x = 0; x < w; ++x) reinterpret_cast<uint16_t*>(b.data() + static_cast<size_t>(y) * stride)[x] = f(x, y, n);
    return b;
}
static uint16_t ramp(int x, int y, int n) { return static_cast<uint16_t>(100 + x * 3 + y + (n % 2 ? 7 : -7)); }
static uint16_t mover(int x, int, int n) { return x == n ? 1000 : 64; }  // a light moving one pixel per frame

int main() {
    const int w = 16, h = 8, stride = w * 2 + 6;
    rawboy::LongExposure avg(w, h, false);
    for (int n = 0; n < 4; ++n) avg.addFrame(frame(w, h, stride, ramp, n).data(), stride);
    const uint16_t* a = avg.finish();
    CHECK(a && avg.frames() == 4);
    for (int y = 0; y < h; ++y) for (int x = 0; x < w; ++x) CHECK(a[y * w + x] == 100 + x * 3 + y);  // +-7 cancels

    rawboy::LongExposure lt(w, h, true);
    for (int n = 0; n < w; ++n) lt.addFrame(frame(w, h, stride, mover, n).data(), stride);
    const uint16_t* l = lt.finish();
    for (int y = 0; y < h; ++y) for (int x = 0; x < w; ++x) CHECK(l[y * w + x] == 1000);  // the whole trail

    rawboy::LongExposure none(w, h, false);
    CHECK(none.finish() == nullptr);
    std::printf(fails ? "FAILED\n" : "ok\n");
    return fails ? 1 : 0;
}
