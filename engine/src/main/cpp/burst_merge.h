#pragma once

// Burst merge for RawBoy Camera: several Bayer raw frames of one scene -> one cleaner Bayer frame, written as a DNG
// by the caller (DngCreator). Platform-neutral (host-tested, see tools/burst_merge/); JNI in jni_bridge.cpp.
//
// The method follows Hasinoff et al., "Burst photography for high dynamic range and low-light imaging on mobile
// cameras" (SIGGRAPH Asia 2016), reimplemented here and simplified:
// - align: each frame against the first (the reference) on a 2x2-averaged grey copy, coarse to fine over a 4-level
//   pyramid, one integer displacement per tile. Displacements are whole grey pixels = even raw pixels, so the Bayer
//   phase is kept and no resampling is needed.
// - merge: overlapping 32 px raw tiles (stride 16, raised-cosine windows that sum to 1). Per tile and frame, a weight
//   from how much the aligned tile differs from the reference beyond what noise explains, times a per-pixel weight
//   from the local difference, so moving things fall back to the reference instead of ghosting. HDR+ merges in the
//   frequency domain; this is the spatial-domain counterpart.

#include <cstddef>
#include <cstdint>
#include <vector>

namespace rawboy {

class BurstMerger {
public:
    /**
     * [black]: per position of the 2x2 CFA block, row-major (SENSOR_DYNAMIC_BLACK_LEVEL order). [white]: clip level.
     * [noiseScale]/[noiseOffset]: the sensor's noise model in units of the white-black range, variance =
     * scale * signal + offset (SENSOR_NOISE_PROFILE, averaged over the channels); <= 0 if unknown (then estimated).
     */
    BurstMerger(int width, int height, const float black[4], float white, float noiseScale, float noiseOffset);

    /**
     * Copies one frame: 16-bit samples, [rowStride] bytes per row. [gain]: its exposure (time x ISO); frames are
     * scaled to the first frame's. The first frame added is the reference.
     */
    void addFrame(const uint8_t* data, int rowStride, double gain);

    int frames() const { return static_cast<int>(frames_.size()); }

    /** Replaces a frame's exposure (time x ISO) when it is only known after the frame was added. */
    void setGain(int frame, double gain) {
        if (frame >= 0 && frame < frames() && gain > 0.0) gains_[frame] = gain;
    }

    /** Replaces the black levels (null: keep) and the noise model given at construction, before [merge]. */
    void setLevels(const float* black, float noiseScale, float noiseOffset) {
        if (black) for (int i = 0; i < 4; ++i) black_[i] = black[i];
        noiseScale_ = noiseScale;
        noiseOffset_ = noiseOffset;
    }

    /** Aligns, merges and writes width x height 16-bit samples (tightly packed) to [out]. Needs at least one frame. */
    void merge(uint16_t* out);

    /** Frees the frames (after [merge]). */
    void dropFrames() { std::vector<std::vector<uint16_t>>().swap(frames_); }

    /** Per merged alternate frame (in order after the reference): mean tile weight 0..1, for the log. */
    const std::vector<float>& frameWeights() const { return frameWeights_; }

    // Tuning, exposed for the host test.
    /** Tile weight: 1 / (1 + excess / (tileK x noise variance)); lower rejects misaligned tiles harder. */
    float tileK = 4.0f;
    /** Pixel weight: rejects where the 3x3 mean grey difference exceeds ~pixelSigmas x its noise. */
    float pixelSigmas = 3.0f;

    // Displacement of each frame's merge tiles, in grey (half-res) pixels: [frame][tile] = (dx, dy). Host test only.
    struct Shift { int dx = 0, dy = 0; };
    std::vector<std::vector<Shift>> shifts;
    int tilesX = 0, tilesY = 0;

    static constexpr int MERGE_TILE = 32;              // raw px
    static constexpr int MERGE_STRIDE = MERGE_TILE / 2;
    static constexpr int GREY_TILE = MERGE_TILE / 2;   // the merge tile in grey px
    static constexpr int GREY_STRIDE = GREY_TILE / 2;

private:
    struct Plane {
        int w = 0, h = 0;
        std::vector<float> px;
        float at(int x, int y) const {
            x = x < 0 ? 0 : (x >= w ? w - 1 : x);
            y = y < 0 ? 0 : (y >= h ? h - 1 : y);
            return px[static_cast<size_t>(y) * w + x];
        }
    };

    Plane grey(int frame) const;
    std::vector<Shift> align(const std::vector<Plane>& ref, const std::vector<Plane>& alt) const;
    float estimateNoise(const Plane& a, const Plane& b) const;

    int width_, height_;
    float black_[4];
    float white_;
    float noiseScale_, noiseOffset_;
    std::vector<std::vector<uint16_t>> frames_;
    std::vector<double> gains_;
    std::vector<float> frameWeights_;
};

}  // namespace rawboy
