#pragma once

// Platform-neutral export helpers: the streaming area downscaler (BandDownscaler.kt is the Kotlin side)
// and the tile repack. Used by band_ops.cpp (JNI) and the web build's wasm bridge.

#include <algorithm>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <vector>

namespace rawboy {

/**
 * Exact area-average downscaler, streamed row by row; see BandDownscaler.kt for the contract.
 * [sharpen] > 0 adds a light unsharp mask on the downscaled rows (luma only, 3x3 binomial blur, so no colour
 * fringes), which holds one output row back: rows come out one push later, all of them by [finish].
 */
class Downscaler {
public:
    Downscaler(int inW, int inH, int outW, int outH, float sharpen = 0.0f)
        : inW_(inW), inH_(inH), outW_(outW), outH_(outH),
          sx_(static_cast<double>(inW) / outW), sy_(static_cast<double>(inH) / outH),
          tapStart_(outW), tapCount_(outW), tapOffset_(outW),
          row_(static_cast<size_t>(outW) * 3), acc_(row_.size()), accNext_(row_.size()), sharpen_(sharpen) {
        if (sharpen_ > 0.0f) {
            for (int i = 0; i < 3; ++i) {
                ring_[i].assign(row_.size(), 0.0f);
                luma_[i].assign(outW, 0.0f);
            }
        }
        for (int x = 0; x < outW; ++x) {
            const double a = x * sx_;
            const double b = std::min(static_cast<double>(inW), (x + 1) * sx_);
            const int first = static_cast<int>(std::floor(a));
            const int last = std::min(inW, static_cast<int>(std::ceil(b)));
            tapStart_[x] = first;
            tapOffset_[x] = static_cast<int>(tapWeights_.size());
            int count = 0;
            for (int ix = first; ix < last; ++ix) {
                const double coverage = std::min(b, ix + 1.0) - std::max(a, static_cast<double>(ix));
                if (coverage <= 0.0) continue;
                if (count == 0) tapStart_[x] = ix;
                tapWeights_.push_back(static_cast<float>(coverage / sx_));
                ++count;
            }
            tapCount_[x] = count;
        }
    }

    /** Adds [rows] input rows; finished output rows are written to [out] from its start. Returns their count. */
    int push(const uint16_t* in, int rows, uint16_t* out) {
        int written = 0;
        for (int r = 0; r < rows; ++r) written += pushRow(in + static_cast<size_t>(r) * inW_ * 3, out + static_cast<size_t>(written) * outW_ * 3);
        return written;
    }

    /** Writes the remaining output rows to [out]; returns their count. */
    int finish(uint16_t* out) {
        int written = 0;
        while (accRow_ < outH_) written += finishRow(out + static_cast<size_t>(written) * outW_ * 3);
        if (sharpen_ > 0.0f && !flushed_ && outH_ > 0) {
            // The last row, now below: its missing row below repeats it.
            sharpenRow(outH_ > 1 ? 1 : 2, 2, 2, out + static_cast<size_t>(written) * outW_ * 3);
            ++written;
            flushed_ = true;
        }
        return written;
    }

    /** Most output rows one push of [inputRows] rows can produce. */
    int maxOutputRows(int inputRows) const {
        return static_cast<int>(std::ceil(inputRows / sy_)) + (sharpen_ > 0.0f ? 3 : 2);
    }

private:
    int pushRow(const uint16_t* in, uint16_t* out) {
        if (inRow_ >= inH_) return 0;
        for (int x = 0; x < outW_; ++x) {
            float r = 0, g = 0, b = 0;
            const uint16_t* p = in + static_cast<size_t>(tapStart_[x]) * 3;
            const float* w = tapWeights_.data() + tapOffset_[x];
            for (int t = 0; t < tapCount_[x]; ++t, p += 3) {
                const float k = w[t];
                r += k * p[0];
                g += k * p[1];
                b += k * p[2];
            }
            row_[x * 3] = r;
            row_[x * 3 + 1] = g;
            row_[x * 3 + 2] = b;
        }
        const double top = inRow_;
        const double bottom = top + 1.0;
        for (int oy = accRow_; oy < outH_ && oy * sy_ < bottom; ++oy) {
            const double coverage = (std::min(bottom, (oy + 1) * sy_) - std::max(top, oy * sy_)) / sy_;
            if (coverage <= 0.0) continue;
            std::vector<float>& target = oy == accRow_ ? acc_ : accNext_;
            const float k = static_cast<float>(coverage);
            for (size_t i = 0; i < row_.size(); ++i) target[i] += k * row_[i];
        }
        ++inRow_;
        int written = 0;
        while (accRow_ < outH_ && (accRow_ + 1) * sy_ <= inRow_ + 1e-6) {
            written += finishRow(out + static_cast<size_t>(written) * outW_ * 3);
        }
        return written;
    }

    // Same rounding as Kotlin's roundToInt (half up).
    static uint16_t toSample(float v) { return static_cast<uint16_t>(std::clamp(std::floor(v + 0.5f), 0.0f, 65535.0f)); }

    /** Completes output row accRow_; returns how many rows it wrote to [out] (0 while sharpening holds row 0). */
    int finishRow(uint16_t* out) {
        int written = 0;
        if (sharpen_ > 0.0f) {
            // ring_ = rows above, middle, below the one to sharpen; the finished row moves in below.
            std::swap(ring_[0], ring_[1]);
            std::swap(ring_[1], ring_[2]);
            std::swap(ring_[2], acc_);
            std::swap(luma_[0], luma_[1]);
            std::swap(luma_[1], luma_[2]);
            const float* p = ring_[2].data();
            for (int x = 0; x < outW_; ++x, p += 3) luma_[2][x] = 0.25f * p[0] + 0.5f * p[1] + 0.25f * p[2];
            if (accRow_ > 0) {
                // The first row: its missing row above repeats it.
                sharpenRow(accRow_ > 1 ? 0 : 1, 1, 2, out);
                written = 1;
            }
        } else {
            for (size_t i = 0; i < acc_.size(); ++i) out[i] = toSample(acc_[i]);
            written = 1;
        }
        ++accRow_;
        std::swap(acc_, accNext_);
        std::fill(accNext_.begin(), accNext_.end(), 0.0f);
        return written;
    }

    /**
     * Writes ring row [mid] plus [sharpen_] x its luma detail (luma minus its 3x3 binomial blur, rows [above] and
     * [below] around it, edge columns repeated) to [out]. The detail is capped at kMaxDetail so hard edges
     * (lights, window frames) don't get bright halos.
     */
    void sharpenRow(int above, int mid, int below, uint16_t* out) const {
        static constexpr float kMaxDetail = 0.04f * 65535.0f;
        const float* la = luma_[above].data();
        const float* lm = luma_[mid].data();
        const float* lb = luma_[below].data();
        const float* p = ring_[mid].data();
        for (int x = 0; x < outW_; ++x, p += 3, out += 3) {
            const int l = x > 0 ? x - 1 : 0;
            const int r = x + 1 < outW_ ? x + 1 : x;
            const auto column = [&](int i) { return la[i] + 2.0f * lm[i] + lb[i]; };
            const float blur = (column(l) + 2.0f * column(x) + column(r)) / 16.0f;
            const float detail = sharpen_ * std::clamp(lm[x] - blur, -kMaxDetail, kMaxDetail);
            out[0] = toSample(p[0] + detail);
            out[1] = toSample(p[1] + detail);
            out[2] = toSample(p[2] + detail);
        }
    }

    int inW_, inH_, outW_, outH_;
    double sx_, sy_;
    std::vector<int> tapStart_, tapCount_, tapOffset_;
    std::vector<float> tapWeights_;
    std::vector<float> row_, acc_, accNext_;
    float sharpen_;
    std::vector<float> ring_[3], luma_[3];  // sharpening only: finished rows (above, middle, below) and their luma
    bool flushed_ = false;
    int accRow_ = 0;
    int inRow_ = 0;
};

/**
 * Copies a developed tile ([cols] x [rows] RGBA samples in 0..65535, read back from the GPU as uint16 or uint32,
 * [bytesPerSample] 2 or 4) into a band of interleaved RGB 16-bit samples [bandWidth] pixels wide, from column [x].
 */
template <typename T>
void pack(const T* src, int cols, int rows, uint16_t* dst, int bandWidth, int x) {
    for (int r = 0; r < rows; ++r) {
        const T* s = src + static_cast<size_t>(r) * cols * 4;
        uint16_t* d = dst + (static_cast<size_t>(r) * bandWidth + x) * 3;
        for (int c = 0; c < cols; ++c, s += 4, d += 3) {
            d[0] = static_cast<uint16_t>(s[0]);
            d[1] = static_cast<uint16_t>(s[1]);
            d[2] = static_cast<uint16_t>(s[2]);
        }
    }
}

}  // namespace rawboy
