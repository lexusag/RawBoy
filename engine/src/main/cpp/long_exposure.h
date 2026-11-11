#pragma once
// Long exposure stacking (RawBoy Camera's Long exposure mode, LongExposureNative.kt): the raw frames of one long
// exposure are folded into a running result as they arrive, so memory stays at one accumulator however long it runs.
//   Average: a running sum of the raw samples (uint32, 12 MP = 48 MB), divided by the frame count at the end. Raw
//            samples are averaged as they are, with no black subtraction: clipping noise at black would bias a
//            subtracted mean upwards. Smooths water and clouds, and lowers noise by sqrt(frames).
//   Lighten: the per-sample maximum (uint16, 24 MB): moving lights leave trails, stars become star trails.
// All frames come from identical requests, so no per-frame gain is needed and nothing is aligned (the phone is on
// a tripod; this is the point of the mode).
#include <algorithm>
#include <cstddef>
#include <cstdint>
#include <vector>

namespace rawboy {

class LongExposure {
public:
    LongExposure(int width, int height, bool lighten)
        : width_(width), height_(height), lighten_(lighten) {
        const size_t n = static_cast<size_t>(width) * height;
        if (lighten_) max_.assign(n, 0);
        else sum_.assign(n, 0);
    }

    // Folds one RAW_SENSOR plane (16-bit little-endian samples, rowStride bytes per row) in; returns the frame count.
    int addFrame(const uint8_t* plane, int rowStride) {
        for (int y = 0; y < height_; ++y) {
            const uint16_t* row = reinterpret_cast<const uint16_t*>(plane + static_cast<size_t>(y) * rowStride);
            const size_t base = static_cast<size_t>(y) * width_;
            if (lighten_) {
                uint16_t* m = max_.data() + base;
                for (int x = 0; x < width_; ++x) m[x] = std::max(m[x], row[x]);
            } else {
                uint32_t* s = sum_.data() + base;
                for (int x = 0; x < width_; ++x) s[x] += row[x];
            }
        }
        return ++frames_;
    }

    int frames() const { return frames_; }

    // The result as 16-bit samples (valid until the object dies); null before the first frame.
    const uint16_t* finish() {
        if (frames_ == 0) return nullptr;
        if (lighten_) return max_.data();
        if (out_.empty()) {
            out_.resize(sum_.size());
            const uint32_t half = static_cast<uint32_t>(frames_) / 2;
            for (size_t i = 0; i < sum_.size(); ++i) out_[i] = static_cast<uint16_t>((sum_[i] + half) / frames_);
            std::vector<uint32_t>().swap(sum_);  // the sums are 48 MB: free them before the DNG is written
        }
        return out_.data();
    }

private:
    int width_, height_;
    bool lighten_;
    int frames_ = 0;
    std::vector<uint32_t> sum_;
    std::vector<uint16_t> max_;
    std::vector<uint16_t> out_;
};

}  // namespace rawboy
