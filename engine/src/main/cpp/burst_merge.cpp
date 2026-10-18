#include "burst_merge.h"

#include "rawboy.h"  // parallelRows

#include <algorithm>
#include <cmath>
#include <cstring>
#include <limits>

namespace rawboy {

namespace {

constexpr float PI_F = 3.14159265358979f;

/** Box-downsampled copy, [f] x [f] pixels -> 1 (edge pixels repeat where the size isn't a multiple). */
template <typename P>
P downsample(const P& in, int f) {
    P out;
    out.w = std::max(1, (in.w + f - 1) / f);
    out.h = std::max(1, (in.h + f - 1) / f);
    out.px.assign(static_cast<size_t>(out.w) * out.h, 0.0f);
    const float inv = 1.0f / static_cast<float>(f * f);
    parallelRows(out.h, [&](int y0, int y1) {
        for (int y = y0; y < y1; ++y) {
            for (int x = 0; x < out.w; ++x) {
                float s = 0.0f;
                for (int j = 0; j < f; ++j) {
                    for (int i = 0; i < f; ++i) s += in.at(x * f + i, y * f + j);
                }
                out.px[static_cast<size_t>(y) * out.w + x] = s * inv;
            }
        }
    });
    return out;
}

/** Raised-cosine window over one merge tile; overlapping tiles at half stride sum to exactly 1. */
float window(int u) {
    const float s = std::sin(PI_F * (static_cast<float>(u) + 0.5f) / BurstMerger::MERGE_TILE);
    return s * s;
}

}  // namespace

BurstMerger::BurstMerger(int width, int height, const float black[4], float white, float noiseScale, float noiseOffset)
    : width_(width), height_(height), white_(white), noiseScale_(noiseScale), noiseOffset_(noiseOffset) {
    std::memcpy(black_, black, sizeof black_);
}

void BurstMerger::addFrame(const uint8_t* data, int rowStride, double gain) {
    std::vector<uint16_t> f(static_cast<size_t>(width_) * height_);
    for (int y = 0; y < height_; ++y) {
        std::memcpy(f.data() + static_cast<size_t>(y) * width_, data + static_cast<size_t>(y) * rowStride,
                    static_cast<size_t>(width_) * sizeof(uint16_t));
    }
    frames_.push_back(std::move(f));
    gains_.push_back(gain > 0.0 ? gain : 1.0);
}

BurstMerger::Plane BurstMerger::grey(int frame) const {
    // Mean of each 2x2 CFA block, black subtracted, in units of the white-black range, at the reference's exposure.
    const float meanBlack = (black_[0] + black_[1] + black_[2] + black_[3]) * 0.25f;
    const float scale = static_cast<float>(gains_[0] / gains_[frame]) / std::max(1.0f, white_ - meanBlack) * 0.25f;
    const uint16_t* raw = frames_[frame].data();
    Plane p;
    p.w = width_ / 2;
    p.h = height_ / 2;
    p.px.resize(static_cast<size_t>(p.w) * p.h);
    const float blackSum = black_[0] + black_[1] + black_[2] + black_[3];
    parallelRows(p.h, [&](int y0, int y1) {
        for (int y = y0; y < y1; ++y) {
            const uint16_t* r0 = raw + static_cast<size_t>(2 * y) * width_;
            const uint16_t* r1 = r0 + width_;
            for (int x = 0; x < p.w; ++x) {
                const float s = static_cast<float>(r0[2 * x]) + r0[2 * x + 1] + r1[2 * x] + r1[2 * x + 1] - blackSum;
                p.px[static_cast<size_t>(y) * p.w + x] = s * scale;
            }
        }
    });
    return p;
}

std::vector<BurstMerger::Shift> BurstMerger::align(const std::vector<Plane>& ref, const std::vector<Plane>& alt) const {
    // Coarse to fine: levels 3, 2, 1 use 8 px tiles side by side; level 0 uses the merge tiles (16 grey px, stride 8,
    // starting half a tile before the edge, as the merge does).
    struct Grid { int originOffset, size, stride, nx, ny; };
    auto gridFor = [&](int level) {
        const Plane& p = ref[level];
        if (level == 0) return Grid{-GREY_STRIDE, GREY_TILE, GREY_STRIDE, tilesX, tilesY};
        return Grid{0, 8, 8, (p.w + 7) / 8, (p.h + 7) / 8};
    };
    static constexpr int FACTOR[4] = {1, 2, 4, 4};  // level L is FACTOR[L] x smaller than level L-1
    static constexpr int RADIUS[4] = {1, 4, 4, 4};

    // Sum of squared differences of one tile at a displacement; reads clamp at the edges.
    auto error = [](const Plane& r, const Plane& a, int ox, int oy, int size, int dx, int dy, float bound) {
        float e = 0.0f;
        if (ox >= 0 && oy >= 0 && ox + size <= r.w && oy + size <= r.h && ox + dx >= 0 && oy + dy >= 0 &&
            ox + dx + size <= a.w && oy + dy + size <= a.h) {
            // Inside both planes (most tiles): no clamping.
            for (int y = 0; y < size; ++y) {
                const float* rp = &r.px[static_cast<size_t>(oy + y) * r.w + ox];
                const float* ap = &a.px[static_cast<size_t>(oy + y + dy) * a.w + ox + dx];
                for (int x = 0; x < size; ++x) {
                    const float d = ap[x] - rp[x];
                    e += d * d;
                }
                if (e >= bound) break;
            }
            return e;
        }
        for (int y = 0; y < size; ++y) {
            for (int x = 0; x < size; ++x) {
                const float d = a.at(ox + x + dx, oy + y + dy) - r.at(ox + x, oy + y);
                e += d * d;
            }
            if (e >= bound) break;
        }
        return e;
    };

    std::vector<Shift> coarse;
    Grid coarseGrid{};
    for (int level = 3; level >= 0; --level) {
        const Grid g = gridFor(level);
        const Plane& r = ref[level];
        const Plane& a = alt[level];
        std::vector<Shift> shifts(static_cast<size_t>(g.nx) * g.ny);
        const int f = level < 3 ? FACTOR[level + 1] : 1;
        const int radius = RADIUS[level];
        parallelRows(g.ny, [&](int j0, int j1) {
            for (int j = j0; j < j1; ++j) {
                for (int i = 0; i < g.nx; ++i) {
                    const int ox = g.originOffset + i * g.stride;
                    const int oy = g.originOffset + j * g.stride;
                    // Candidates from the coarser level: the tile under this one's centre and its nearest neighbours
                    // in x and y (helps at the edges of moving things).
                    Shift guess;
                    if (!coarse.empty()) {
                        const float cx = (static_cast<float>(ox) + g.size * 0.5f) / f;
                        const float cy = (static_cast<float>(oy) + g.size * 0.5f) / f;
                        const float tx = (cx - coarseGrid.originOffset) / coarseGrid.stride - 0.5f;
                        const float ty = (cy - coarseGrid.originOffset) / coarseGrid.stride - 0.5f;
                        const int ci = std::clamp(static_cast<int>(std::lround(tx)), 0, coarseGrid.nx - 1);
                        const int cj = std::clamp(static_cast<int>(std::lround(ty)), 0, coarseGrid.ny - 1);
                        const int ni = std::clamp(ci + (tx > ci ? 1 : -1), 0, coarseGrid.nx - 1);
                        const int nj = std::clamp(cj + (ty > cj ? 1 : -1), 0, coarseGrid.ny - 1);
                        const Shift cands[3] = {coarse[static_cast<size_t>(cj) * coarseGrid.nx + ci],
                                                coarse[static_cast<size_t>(cj) * coarseGrid.nx + ni],
                                                coarse[static_cast<size_t>(nj) * coarseGrid.nx + ci]};
                        float best = std::numeric_limits<float>::max();
                        for (const Shift& c : cands) {
                            const float e = error(r, a, ox, oy, g.size, c.dx * f, c.dy * f, best);
                            if (e < best) {
                                best = e;
                                guess = {c.dx * f, c.dy * f};
                            }
                        }
                    }
                    Shift found = guess;
                    float best = std::numeric_limits<float>::max();
                    for (int dy = -radius; dy <= radius; ++dy) {
                        for (int dx = -radius; dx <= radius; ++dx) {
                            const float e = error(r, a, ox, oy, g.size, guess.dx + dx, guess.dy + dy, best);
                            // Ties go to the smaller shift (flat tiles stay put).
                            if (e < best || (e == best && std::abs(guess.dx + dx) + std::abs(guess.dy + dy) <
                                                              std::abs(found.dx) + std::abs(found.dy))) {
                                best = e;
                                found = {guess.dx + dx, guess.dy + dy};
                            }
                        }
                    }
                    shifts[static_cast<size_t>(j) * g.nx + i] = found;
                }
            }
        });
        coarse = std::move(shifts);
        coarseGrid = g;
    }
    return coarse;
}

float BurstMerger::estimateNoise(const Plane& a, const Plane& b) const {
    // Grey noise variance from the difference of two aligned-ish frames in flat blocks: per 8x8 block the variance of
    // (b - a) minus its mean, the 10th percentile over blocks (texture and motion only add), halved (two frames).
    std::vector<float> vars;
    for (int by = 0; by + 8 <= a.h; by += 8) {
        for (int bx = 0; bx + 8 <= a.w; bx += 8) {
            float s = 0.0f, s2 = 0.0f;
            for (int y = 0; y < 8; ++y) {
                for (int x = 0; x < 8; ++x) {
                    const float d = b.at(bx + x, by + y) - a.at(bx + x, by + y);
                    s += d;
                    s2 += d * d;
                }
            }
            vars.push_back(std::max(0.0f, s2 / 64.0f - (s / 64.0f) * (s / 64.0f)));
        }
    }
    if (vars.empty()) return 1e-6f;
    const size_t k = vars.size() / 10;
    std::nth_element(vars.begin(), vars.begin() + k, vars.end());
    return std::max(1e-8f, vars[k] * 0.5f);
}

void BurstMerger::merge(uint16_t* out) {
    const int n = frames();
    tilesX = (width_ + MERGE_STRIDE - 1) / MERGE_STRIDE + 1;
    tilesY = (height_ + MERGE_STRIDE - 1) / MERGE_STRIDE + 1;
    shifts.assign(n, std::vector<Shift>(static_cast<size_t>(tilesX) * tilesY));
    frameWeights_.assign(n > 0 ? n - 1 : 0, 0.0f);
    if (n == 0) return;
    if (n == 1) {
        std::memcpy(out, frames_[0].data(), frames_[0].size() * sizeof(uint16_t));
        return;
    }

    auto pyramid = [](Plane l0) {
        std::vector<Plane> p(4);
        p[0] = std::move(l0);
        p[1] = downsample(p[0], 2);
        p[2] = downsample(p[1], 4);
        p[3] = downsample(p[2], 4);
        return p;
    };
    const std::vector<Plane> ref = pyramid(grey(0));
    std::vector<Plane> alts;  // level 0 of each alternate frame, for the merge
    for (int f = 1; f < n; ++f) {
        std::vector<Plane> alt = pyramid(grey(f));
        shifts[f] = align(ref, alt);
        alts.push_back(std::move(alt[0]));
    }

    // Grey noise variance at a grey level: the sensor's model (per sample) / 4 for the 2x2 mean.
    float flatVar = 0.0f;
    if (!(noiseScale_ > 0.0f || noiseOffset_ > 0.0f)) flatVar = estimateNoise(ref[0], alts[0]);
    auto greyVar = [&](float level) {
        if (flatVar > 0.0f) return flatVar;
        return std::max(1e-9f, (noiseScale_ * std::max(0.0f, level) + noiseOffset_) * 0.25f);
    };

    const Plane& r0 = ref[0];
    std::vector<float> acc(static_cast<size_t>(width_) * height_, 0.0f);
    std::vector<double> weightSums(n, 0.0);
    std::vector<float> win(MERGE_TILE);
    for (int u = 0; u < MERGE_TILE; ++u) win[u] = window(u);
    const float sat = white_ - 2.0f;  // samples this close to the clip count as clipped
    std::vector<float> gainOf(n);
    for (int f = 0; f < n; ++f) gainOf[f] = static_cast<float>(gains_[0] / gains_[f]);

    // Tiles overlap their neighbours by half; rows two apart don't, so even and odd tile rows run in two passes.
    for (int parity = 0; parity < 2; ++parity) {
        const int rows = (tilesY - parity + 1) / 2;
        std::vector<std::vector<double>> rowWeights(rows, std::vector<double>(n, 0.0));
        parallelRows(rows, [&](int k0, int k1) {
            std::vector<float> tileW(n), pixW(static_cast<size_t>(n) * GREY_TILE * GREY_TILE);
            std::vector<float> diff((GREY_TILE + 2) * (GREY_TILE + 2));
            for (int k = k0; k < k1; ++k) {
                const int tj = parity + 2 * k;
                const int oy = -MERGE_STRIDE + tj * MERGE_STRIDE;
                for (int ti = 0; ti < tilesX; ++ti) {
                    const int ox = -MERGE_STRIDE + ti * MERGE_STRIDE;
                    const int gx = ox / 2, gy = oy / 2;
                    const size_t tile = static_cast<size_t>(tj) * tilesX + ti;

                    // Mean grey level of the reference tile (inside the image) sets the noise.
                    float mean = 0.0f;
                    int count = 0;
                    for (int y = std::max(0, gy); y < std::min(r0.h, gy + GREY_TILE); ++y) {
                        for (int x = std::max(0, gx); x < std::min(r0.w, gx + GREY_TILE); ++x) {
                            mean += r0.px[static_cast<size_t>(y) * r0.w + x];
                            ++count;
                        }
                    }
                    if (count == 0) continue;
                    const float var = greyVar(mean / count);
                    const float pixelVar = pixelSigmas * pixelSigmas * 2.0f * var / 9.0f;

                    for (int f = 1; f < n; ++f) {
                        const Shift s = shifts[f][tile];
                        const Plane& a = alts[f - 1];
                        // Tile weight: the aligned tile's mean squared difference beyond the noise of two frames.
                        float d2 = 0.0f;
                        int m = 0;
                        for (int y = -1; y <= GREY_TILE; ++y) {
                            for (int x = -1; x <= GREY_TILE; ++x) {
                                const float d = a.at(gx + x + s.dx, gy + y + s.dy) - r0.at(gx + x, gy + y);
                                diff[(y + 1) * (GREY_TILE + 2) + (x + 1)] = d;
                                const int px = gx + x, py = gy + y;
                                if (x >= 0 && y >= 0 && x < GREY_TILE && y < GREY_TILE && px >= 0 && py >= 0 &&
                                    px < r0.w && py < r0.h) {
                                    d2 += d * d;
                                    ++m;
                                }
                            }
                        }
                        const float excess = std::max(0.0f, d2 / std::max(1, m) - 2.0f * var);
                        tileW[f] = 1.0f / (1.0f + excess / (tileK * var));
                        rowWeights[k][f] += tileW[f];
                        // Pixel weight: the 3x3 mean difference against its own noise.
                        for (int y = 0; y < GREY_TILE; ++y) {
                            for (int x = 0; x < GREY_TILE; ++x) {
                                float md = 0.0f;
                                for (int j = 0; j < 3; ++j) {
                                    for (int i = 0; i < 3; ++i) md += diff[(y + j) * (GREY_TILE + 2) + (x + i)];
                                }
                                md /= 9.0f;
                                const float q = md * md / pixelVar;
                                pixW[(static_cast<size_t>(f) * GREY_TILE + y) * GREY_TILE + x] = 1.0f / (1.0f + q * q);
                            }
                        }
                    }

                    for (int y = std::max(0, oy); y < std::min(height_, oy + MERGE_TILE); ++y) {
                        const float wy = win[y - oy];
                        for (int x = std::max(0, ox); x < std::min(width_, ox + MERGE_TILE); ++x) {
                            const int cfa = (y & 1) * 2 + (x & 1);
                            const float b = black_[cfa];
                            const uint16_t refRaw = frames_[0][static_cast<size_t>(y) * width_ + x];
                            float sum = static_cast<float>(refRaw) - b;
                            float wsum = 1.0f;
                            if (refRaw < sat) {
                                const size_t gi = static_cast<size_t>((y - oy) >> 1) * GREY_TILE + ((x - ox) >> 1);
                                for (int f = 1; f < n; ++f) {
                                    const Shift s = shifts[f][tile];
                                    const int ax = x + 2 * s.dx, ay = y + 2 * s.dy;
                                    if (ax < 0 || ay < 0 || ax >= width_ || ay >= height_) continue;
                                    const uint16_t v = frames_[f][static_cast<size_t>(ay) * width_ + ax];
                                    if (v >= sat) continue;
                                    const float w = tileW[f] * pixW[static_cast<size_t>(f) * GREY_TILE * GREY_TILE + gi];
                                    sum += w * (static_cast<float>(v) - b) * gainOf[f];
                                    wsum += w;
                                }
                            }
                            acc[static_cast<size_t>(y) * width_ + x] += wy * win[x - ox] * (sum / wsum);
                        }
                    }
                }
            }
        });
        for (const auto& rw : rowWeights) {
            for (int f = 1; f < n; ++f) weightSums[f] += rw[f];
        }
    }
    for (int f = 1; f < n; ++f) frameWeights_[f - 1] = static_cast<float>(weightSums[f] / (tilesX * tilesY));

    const float top = std::min(white_, 65535.0f);
    parallelRows(height_, [&](int y0, int y1) {
        for (int y = y0; y < y1; ++y) {
            for (int x = 0; x < width_; ++x) {
                const float v = acc[static_cast<size_t>(y) * width_ + x] + black_[(y & 1) * 2 + (x & 1)];
                out[static_cast<size_t>(y) * width_ + x] = static_cast<uint16_t>(std::clamp(std::lround(v), 0L, static_cast<long>(top)));
            }
        }
    });
}

}  // namespace rawboy
