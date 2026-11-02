#include "camera_lens_data.h"

#include <cmath>
#include <cstring>

namespace rawboy {

namespace {

class Tiff {
public:
    Tiff(const uint8_t* data, size_t size) : d_(data), n_(size) {
        if (size >= 8 && data[0] == 'I' && data[1] == 'I') valid_ = true, be_ = false;
        else if (size >= 8 && data[0] == 'M' && data[1] == 'M') valid_ = true, be_ = true;
    }
    bool valid() const { return valid_; }
    bool ok(size_t at, size_t len) const { return at <= n_ && len <= n_ - at; }
    uint16_t u16(size_t at) const {
        return be_ ? static_cast<uint16_t>(d_[at] << 8 | d_[at + 1]) : static_cast<uint16_t>(d_[at + 1] << 8 | d_[at]);
    }
    uint32_t u32(size_t at) const {
        return be_ ? (uint32_t(d_[at]) << 24 | uint32_t(d_[at + 1]) << 16 | uint32_t(d_[at + 2]) << 8 | d_[at + 3])
                   : (uint32_t(d_[at + 3]) << 24 | uint32_t(d_[at + 2]) << 16 | uint32_t(d_[at + 1]) << 8 | d_[at]);
    }
    uint32_t firstIfd() const { return u32(4); }

    struct Entry {
        uint16_t tag = 0, type = 0;
        uint32_t count = 0;
        size_t value = 0;  // offset of the value (inline or pointed to)
    };

    /** Entries of the IFD at [offset]; [next] gets the following IFD's offset. */
    std::vector<Entry> entries(uint32_t offset, uint32_t* next = nullptr) const {
        std::vector<Entry> out;
        if (next) *next = 0;
        if (!ok(offset, 2)) return out;
        const uint16_t count = u16(offset);
        if (!ok(offset + 2, count * 12u + 4)) return out;
        static const int sizes[] = {0, 1, 1, 2, 4, 8, 1, 1, 2, 4, 8, 4, 8, 4};
        for (uint16_t i = 0; i < count; ++i) {
            const size_t e = offset + 2 + i * 12u;
            Entry en;
            en.tag = u16(e);
            en.type = u16(e + 2);
            en.count = u32(e + 4);
            const size_t bytes = size_t(en.count) * (en.type < 14 ? sizes[en.type] : 1);
            en.value = bytes <= 4 ? e + 8 : u32(e + 8);
            if (ok(en.value, bytes)) out.push_back(en);
        }
        if (next) *next = u32(offset + 2 + count * 12u);
        return out;
    }

    std::vector<double> numbers(const Entry& e) const {
        std::vector<double> v;
        for (uint32_t i = 0; i < e.count && i < 64; ++i) {
            switch (e.type) {
                case 3: v.push_back(u16(e.value + i * 2)); break;
                case 8: v.push_back(static_cast<int16_t>(u16(e.value + i * 2))); break;
                case 4: v.push_back(u32(e.value + i * 4)); break;
                case 9: v.push_back(static_cast<int32_t>(u32(e.value + i * 4))); break;
                case 5:
                case 10: {
                    const uint32_t a = u32(e.value + i * 8), b = u32(e.value + i * 8 + 4);
                    const double num = e.type == 10 ? double(static_cast<int32_t>(a)) : double(a);
                    const double den = e.type == 10 ? double(static_cast<int32_t>(b)) : double(b);
                    v.push_back(den != 0 ? num / den : 0);
                    break;
                }
                default: return {};
            }
        }
        return v;
    }

private:
    const uint8_t* d_;
    size_t n_;
    bool valid_ = false, be_ = false;
};

// Sony: VignettingCorrParams 0x7032, ChromaticAberrationCorrParams 0x7035, DistortionCorrParams 0x7037 (int16s, the
// first value is the knot count), in the raw's SubIFD (A7 III) or IFD0. Decoding as darktable's and ExifTool's
// documentation describe.
bool readSony(const Tiff& t, CameraLensData& out) {
    std::vector<double> vig, ca, dist;
    std::vector<uint32_t> ifds;
    for (uint32_t offset = t.firstIfd(); offset && ifds.size() < 4;) {
        ifds.push_back(offset);
        t.entries(offset, &offset);
    }
    for (size_t i = 0; i < ifds.size() && i < 16; ++i) {
        for (const auto& e : t.entries(ifds[i])) {
            if (e.tag == 0x7032) vig = t.numbers(e);
            else if (e.tag == 0x7035) ca = t.numbers(e);
            else if (e.tag == 0x7037) dist = t.numbers(e);
            else if (e.tag == 0x014A && (e.type == 4 || e.type == 13))
                for (uint32_t k = 0; k < e.count && k < 4; ++k) ifds.push_back(t.u32(e.value + k * 4));
        }
    }
    if (dist.size() < 3) return false;
    const int n = static_cast<int>(dist[0]);
    if (n < 2 || static_cast<int>(dist.size()) < n + 1) return false;
    const bool hasVig = static_cast<int>(vig.size()) >= n + 1 && static_cast<int>(vig[0]) == n;
    const bool hasCa = static_cast<int>(ca.size()) >= 2 * n + 1 && static_cast<int>(ca[0]) == 2 * n;
    out.maker = "Sony";
    for (int i = 0; i < n; ++i) {
        out.knots.push_back(double(i) / (n - 1));
        out.dist.push_back(dist[1 + i] * std::pow(2.0, -14) + 1);
        out.vig.push_back(hasVig ? std::pow(2.0, 0.5 - std::pow(2.0, vig[1 + i] * std::pow(2.0, -13) - 1)) : 1.0);
        out.caR.push_back(hasCa ? ca[1 + i] * std::pow(2.0, -21) + 1 : 1.0);
        out.caB.push_back(hasCa ? ca[1 + n + i] * std::pow(2.0, -21) + 1 : 1.0);
    }
    return true;
}

// Fujifilm: the RAF's raw section starts with a little TIFF whose only tag, 0xF000, points to the FujiIFD:
// GeometricDistortionParams 0xF00B, ChromaticAberrationParams 0xF00F, VignettingParams 0xF010 (SRATIONALs). Each is a
// header (a lens constant), n knot radii, then the values: n percentages (distortion, vignetting brightness) or
// n red and n blue ratios offsets (CA). The GFX stores 8 knots from 0.35, shared by the three; the X-T1 11 (distortion,
// vignetting) or 10 (CA) knots from 0 / 0.1; the X-T5 10 knots at
// sqrt(i / 8) (0, 0.354, 0.5 ... 1.061); the X-E5 9 knots and zeros (no data).
struct FujiCurve {
    std::vector<double> knots;
    std::vector<std::vector<double>> values;
};

FujiCurve fujiCurve(const std::vector<double>& v, int channels) {
    FujiCurve c;
    const int n = static_cast<int>(v.size() - 1) / (1 + channels);
    if (v.size() < 3 || n < 2) return c;
    for (int i = 0; i < n; ++i) c.knots.push_back(v[1 + i]);
    for (int k = 0; k < channels; ++k) c.values.emplace_back(v.begin() + 1 + n * (1 + k), v.begin() + 1 + n * (2 + k));
    // Knots must rise, from a radius under 1.2 (an X-E5 tail holds a stray header repeat).
    for (int i = 0; i < n; ++i)
        if (!(c.knots[i] >= 0 && c.knots[i] < 1.5) || (i && c.knots[i] <= c.knots[i - 1])) return {};
    return c;
}

// Linear interpolation of a curve at r; before the first knot it ramps from `atZero`, past the last it holds.
double fujiAt(const FujiCurve& c, int ch, double r, double atZero) {
    const auto& k = c.knots;
    const auto& v = c.values[ch];
    if (r <= 0) return atZero;
    if (r <= k.front()) return atZero + (v.front() - atZero) * r / k.front();
    for (size_t i = 1; i < k.size(); ++i)
        if (r <= k[i]) return v[i - 1] + (v[i] - v[i - 1]) * (r - k[i - 1]) / (k[i] - k[i - 1]);
    return v.back();
}

bool readFuji(const uint8_t* data, size_t size, CameraLensData& out) {
    if (size < 108) return false;
    auto be32 = [&](size_t at) {
        return uint32_t(data[at]) << 24 | uint32_t(data[at + 1]) << 16 | uint32_t(data[at + 2]) << 8 | data[at + 3];
    };
    const uint32_t rawOffset = be32(100);
    if (rawOffset >= size) return false;
    const Tiff t(data + rawOffset, size - rawOffset);
    if (!t.valid()) return false;
    std::vector<double> dist, ca, vig;
    for (const auto& e : t.entries(t.firstIfd())) {
        if (e.tag != 0xF000) continue;
        const uint32_t sub = e.type == 13 || e.type == 4 ? t.u32(e.value) : 0;
        for (const auto& f : t.entries(sub)) {
            if (f.tag == 0xF00B) dist = t.numbers(f);
            else if (f.tag == 0xF00F) ca = t.numbers(f);
            else if (f.tag == 0xF010) vig = t.numbers(f);
        }
    }
    const FujiCurve d = fujiCurve(dist, 1), c = fujiCurve(ca, 2), g = fujiCurve(vig, 1);
    if (d.knots.empty()) return false;
    out.maker = "Fujifilm";
    // The shared knots are the distortion's. The centre may not be stored (GFX): extrapolate the first two radii in
    // r^2 (the curves are even and smooth); the brightness is 1 there by definition.
    std::vector<double> knots = d.knots;
    const bool hasZero = knots.front() <= 0;
    for (double r : knots) {
        out.knots.push_back(r);
        out.dist.push_back(d.values[0][out.knots.size() - 1] / 100 + 1);
    }
    for (double r : out.knots) {
        out.vig.push_back(g.knots.empty() ? 1.0 : fujiAt(g, 0, r, 100.0) / 100);
        out.caR.push_back(c.knots.empty() ? 1.0 : fujiAt(c, 0, r, 0.0) + 1);
        out.caB.push_back(c.knots.empty() ? 1.0 : fujiAt(c, 1, r, 0.0) + 1);
    }
    if (!hasZero && out.knots.size() >= 2) {
        const double k1 = out.knots[0] * out.knots[0], k2 = out.knots[1] * out.knots[1];
        for (auto* v : {&out.dist, &out.caR, &out.caB}) v->insert(v->begin(), (*v)[0] - ((*v)[1] - (*v)[0]) * k1 / (k2 - k1));
        out.vig.insert(out.vig.begin(), 1.0);
        out.knots.insert(out.knots.begin(), 0.0);
    }
    return true;
}

bool flat(const std::vector<double>& v, double tolerance) {
    for (double x : v)
        if (std::fabs(x - 1) > tolerance) return false;
    return true;
}

}  // namespace

bool CameraLensData::hasDistortion() const { return !dist.empty() && !flat(dist, 1e-4); }
bool CameraLensData::hasVignetting() const { return !vig.empty() && !flat(vig, 1e-3); }
bool CameraLensData::hasChromaticAberration() const { return !caR.empty() && !(flat(caR, 1e-5) && flat(caB, 1e-5)); }

bool readCameraLensData(const uint8_t* data, size_t size, CameraLensData& out) {
    out = CameraLensData();
    if (size >= 16 && std::memcmp(data, "FUJIFILMCCD-RAW", 15) == 0) return readFuji(data, size, out);
    const Tiff t(data, size);
    if (!t.valid()) return false;
    return readSony(t, out);
}

}  // namespace rawboy
