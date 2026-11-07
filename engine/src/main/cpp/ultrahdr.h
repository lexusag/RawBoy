#pragma once

// Writing Ultra HDR JPEGs (Google's JPEG_R: an SDR JPEG plus a gain map JPEG in a Multi-Picture Format container, with
// XMP `hdrgm` and ISO 21496-1 metadata). Header-only and free of jpegli, so a host test can build it with plain g++
// (tools/ultrahdr/run.sh); jpeg_jpegli.cpp does the JPEG encoding around it.
//
// The SDR picture is the file as RawBoy always wrote it. The gain map is derived from that picture alone: a single
// channel (luma) that expands the highlight shoulder of the tone mapper by up to kHeadroomEv stops on an HDR screen and
// leaves everything below kKnee (display-encoded luma) at the SDR value. See docs/camera.md "HDR gain map".
//
// Reader counterpart: decoder_display.cpp (MPF second image, hdrgm XMP, ISO 21496-1); the byte layouts here mirror it.

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <string>
#include <vector>

namespace rawboy::uhdr {

/** log2 of the largest boost the gain map asks for (content boost 4x at display white). First guess: tune on a phone. */
constexpr float kHeadroomEv = 2.0f;
/** Display-encoded luma where the boost starts. */
constexpr float kKnee = 0.75f;
/** The gain map is this many times smaller than the picture on each side. */
constexpr int kScale = 4;
/** hdrgm:OffsetSDR / OffsetHDR (libultrahdr's default). */
constexpr float kOffset = 1.0f / 64.0f;
/** A gain map whose largest value is below this (of 255) asks for nothing visible: the file stays a plain JPEG. */
constexpr int kMinPeak = 3;

/** Share of kHeadroomEv asked for a pixel of display-encoded luma [y] (0..1): 0 below the knee, 1 at white. */
inline float gainWeight(float y) {
    const float t = std::clamp((y - kKnee) / (1.0f - kKnee), 0.0f, 1.0f);
    return t * t * (3.0f - 2.0f * t) * std::sqrt(t);  // smoothstep, eased in a little more
}

/**
 * Accumulates the gain map while the picture's rows stream past: feed the final 16-bit RGB rows (the same ones the
 * SDR JPEG gets, top to bottom, any band sizes), then [finish] for the 8-bit map.
 */
class GainMapBuilder {
public:
    GainMapBuilder(int width, int height)
        : width_(width), height_(height), gw_((width + kScale - 1) / kScale), gh_((height + kScale - 1) / kScale),
          sum_(static_cast<size_t>(gw_) * gh_, 0) {
        for (int i = 0; i < 4096; ++i) lut_[i] = static_cast<uint16_t>(std::lround(gainWeight((i + 0.5f) / 4096.0f) * 4095.0f));
    }

    int mapWidth() const { return gw_; }
    int mapHeight() const { return gh_; }

    /** [rows] rows of interleaved RGB, unsigned 16-bit, display encoded. */
    void addRows(const uint16_t* rgb, int rows) {
        for (int r = 0; r < rows && row_ < height_; ++r, ++row_) {
            uint32_t* acc = &sum_[static_cast<size_t>(row_ / kScale) * gw_];
            const uint16_t* p = rgb + static_cast<size_t>(r) * width_ * 3;
            for (int x = 0; x < width_; ++x, p += 3) {
                const uint32_t luma = (13933u * p[0] + 46871u * p[1] + 4732u * p[2]) >> 16;  // Rec.709 weights /65536
                acc[x / kScale] += lut_[luma >> 4];
            }
        }
    }

    /** The mapWidth() x mapHeight() 8-bit map: 0 = no boost, 255 = the full kHeadroomEv. */
    std::vector<uint8_t> finish() const {
        std::vector<uint8_t> out(sum_.size());
        for (int by = 0; by < gh_; ++by) {
            const int rows = std::min(kScale, height_ - by * kScale);
            for (int bx = 0; bx < gw_; ++bx) {
                const int cols = std::min(kScale, width_ - bx * kScale);
                const double mean = double(sum_[static_cast<size_t>(by) * gw_ + bx]) / (double(rows) * cols * 4095.0);
                out[static_cast<size_t>(by) * gw_ + bx] = static_cast<uint8_t>(std::lround(std::clamp(mean, 0.0, 1.0) * 255.0));
            }
        }
        return out;
    }

private:
    int width_, height_, gw_, gh_;
    int row_ = 0;
    std::vector<uint32_t> sum_;
    uint16_t lut_[4096];
};

namespace detail {

inline void put16(std::vector<uint8_t>& v, uint32_t x) { v.push_back(uint8_t(x >> 8)); v.push_back(uint8_t(x)); }
inline void put32(std::vector<uint8_t>& v, uint32_t x) { put16(v, x >> 16); put16(v, x & 0xFFFF); }
inline void putStr(std::vector<uint8_t>& v, const std::string& s) { v.insert(v.end(), s.begin(), s.end()); }

/** A marker segment: FF [marker] [length incl. itself] [payload]. */
inline std::vector<uint8_t> segment(uint8_t marker, const std::vector<uint8_t>& payload) {
    std::vector<uint8_t> s{0xFF, marker};
    put16(s, static_cast<uint32_t>(payload.size() + 2));
    s.insert(s.end(), payload.begin(), payload.end());
    return s;
}

inline std::string num(double v) {
    char b[32];
    std::snprintf(b, sizeof b, "%.6g", v);
    return b;
}

inline std::vector<uint8_t> xmpSegment(const std::string& body) {
    std::vector<uint8_t> p;
    putStr(p, "http://ns.adobe.com/xap/1.0/");
    p.push_back(0);
    putStr(p, "<?xpacket begin=\"\xEF\xBB\xBF\" id=\"W5M0MpCehiHzreSzNTczkc9d\"?>\n" + body + "\n<?xpacket end=\"w\"?>");
    return segment(0xE1, p);
}

/** Primary image: the container directory that lists the gain map ([gainLength] bytes). */
inline std::vector<uint8_t> primaryXmp(size_t gainLength) {
    return xmpSegment(
        "<x:xmpmeta xmlns:x=\"adobe:ns:meta/\" x:xmptk=\"Adobe XMP Core 5.1.2\">\n"
        " <rdf:RDF xmlns:rdf=\"http://www.w3.org/1999/02/22-rdf-syntax-ns#\">\n"
        "  <rdf:Description rdf:about=\"\"\n"
        "    xmlns:Container=\"http://ns.google.com/photos/1.0/container/\"\n"
        "    xmlns:Item=\"http://ns.google.com/photos/1.0/container/item/\"\n"
        "    xmlns:hdrgm=\"http://ns.adobe.com/hdr-gain-map/1.0/\"\n"
        "    hdrgm:Version=\"1.0\">\n"
        "   <Container:Directory>\n"
        "    <rdf:Seq>\n"
        "     <rdf:li rdf:parseType=\"Resource\">\n"
        "      <Container:Item Item:Semantic=\"Primary\" Item:Mime=\"image/jpeg\"/>\n"
        "     </rdf:li>\n"
        "     <rdf:li rdf:parseType=\"Resource\">\n"
        "      <Container:Item Item:Semantic=\"GainMap\" Item:Mime=\"image/jpeg\" Item:Length=\"" + std::to_string(gainLength) + "\"/>\n"
        "     </rdf:li>\n"
        "    </rdf:Seq>\n"
        "   </Container:Directory>\n"
        "  </rdf:Description>\n"
        " </rdf:RDF>\n"
        "</x:xmpmeta>");
}

/** Gain map image: the parameters that turn its pixels into a boost. One channel, gamma 1. */
inline std::vector<uint8_t> gainXmp() {
    return xmpSegment(
        "<x:xmpmeta xmlns:x=\"adobe:ns:meta/\" x:xmptk=\"Adobe XMP Core 5.1.2\">\n"
        " <rdf:RDF xmlns:rdf=\"http://www.w3.org/1999/02/22-rdf-syntax-ns#\">\n"
        "  <rdf:Description rdf:about=\"\"\n"
        "    xmlns:hdrgm=\"http://ns.adobe.com/hdr-gain-map/1.0/\"\n"
        "    hdrgm:Version=\"1.0\"\n"
        "    hdrgm:GainMapMin=\"0\"\n"
        "    hdrgm:GainMapMax=\"" + num(kHeadroomEv) + "\"\n"
        "    hdrgm:Gamma=\"1\"\n"
        "    hdrgm:OffsetSDR=\"" + num(kOffset) + "\"\n"
        "    hdrgm:OffsetHDR=\"" + num(kOffset) + "\"\n"
        "    hdrgm:HDRCapacityMin=\"0\"\n"
        "    hdrgm:HDRCapacityMax=\"" + num(kHeadroomEv) + "\"\n"
        "    hdrgm:BaseRenditionIsHDR=\"False\"/>\n"
        " </rdf:RDF>\n"
        "</x:xmpmeta>");
}

inline std::vector<uint8_t> isoSegment(bool withParams) {
    std::vector<uint8_t> p;
    putStr(p, "urn:iso:std:iso:ts:21496:-1");
    p.push_back(0);
    put16(p, 0);  // minimum version
    put16(p, 0);  // writer version
    if (withParams) {
        const uint32_t den = 64000;  // 1/64 and whole stops are exact
        p.push_back(0x08);            // one channel, common denominator, base is the SDR picture
        put32(p, den);
        put32(p, 0);                                          // base HDR headroom (log2): SDR
        put32(p, static_cast<uint32_t>(kHeadroomEv * den));   // alternate HDR headroom
        put32(p, 0);                                          // gain map min (log2)
        put32(p, static_cast<uint32_t>(kHeadroomEv * den));   // gain map max (log2)
        put32(p, den);                                        // gamma 1
        put32(p, static_cast<uint32_t>(kOffset * den));       // offset SDR
        put32(p, static_cast<uint32_t>(kOffset * den));       // offset HDR
    }
    return segment(0xE2, p);
}

/** Multi-Picture Format index (CIPA DC-007), big endian: two images, the second at [secondOffset] from the TIFF header. */
inline std::vector<uint8_t> mpfSegment(size_t primaryLength, size_t gainLength, size_t secondOffset) {
    std::vector<uint8_t> p;
    putStr(p, "MPF");
    p.push_back(0);
    putStr(p, "MM");
    put16(p, 0x002A);
    put32(p, 8);  // first IFD
    put16(p, 3);
    put16(p, 0xB000); put16(p, 7); put32(p, 4); putStr(p, "0100");  // MPFVersion
    put16(p, 0xB001); put16(p, 4); put32(p, 1); put32(p, 2);        // NumberOfImages
    put16(p, 0xB002); put16(p, 7); put32(p, 32); put32(p, 50);      // MPEntry list at 8 + 2 + 36 + 4
    put32(p, 0);                                                    // no next IFD
    put32(p, 0x20030000); put32(p, static_cast<uint32_t>(primaryLength)); put32(p, 0); put16(p, 0); put16(p, 0);
    put32(p, 0); put32(p, static_cast<uint32_t>(gainLength)); put32(p, static_cast<uint32_t>(secondOffset)); put16(p, 0); put16(p, 0);
    return segment(0xE2, p);
}

/** Offset just after SOI and the run of APPn segments that follows it; 0 if [j] isn't a JPEG. */
inline size_t afterHeaders(const std::vector<uint8_t>& j) {
    if (j.size() < 4 || j[0] != 0xFF || j[1] != 0xD8) return 0;
    size_t p = 2;
    while (p + 4 <= j.size() && j[p] == 0xFF && j[p + 1] >= 0xE0 && j[p + 1] <= 0xEF) {
        const size_t len = (size_t(j[p + 2]) << 8) | j[p + 3];
        if (len < 2 || p + 2 + len > j.size()) return 0;
        p += 2 + len;
    }
    return p;
}

inline void insertAt(std::vector<uint8_t>& v, size_t pos, const std::vector<uint8_t>& s) {
    v.insert(v.begin() + static_cast<std::ptrdiff_t>(pos), s.begin(), s.end());
}

}  // namespace detail

/**
 * The Ultra HDR file: [primary] (the finished SDR JPEG, EXIF already in it) with the XMP, ISO 21496-1 and MPF
 * segments added after its leading APP segments, followed by [gain] (the gain map as a JPEG). Empty if either input
 * isn't a JPEG.
 */
inline std::vector<uint8_t> assemble(const std::vector<uint8_t>& primary, const std::vector<uint8_t>& gain) {
    using namespace detail;
    const size_t primaryAt = afterHeaders(primary), gainAt = afterHeaders(gain);
    if (!primaryAt || !gainAt) return {};

    std::vector<uint8_t> gainFile = gain;
    insertAt(gainFile, gainAt, isoSegment(true));
    insertAt(gainFile, gainAt, gainXmp());

    const std::vector<uint8_t> xmp = primaryXmp(gainFile.size());
    const std::vector<uint8_t> iso = isoSegment(false);
    const size_t mpfSize = mpfSegment(0, 0, 0).size();
    const size_t primaryLength = primary.size() + xmp.size() + iso.size() + mpfSize;
    const size_t tiffAt = primaryAt + xmp.size() + iso.size() + 8;  // marker, length and "MPF\0" come before the TIFF header
    const std::vector<uint8_t> mpf = mpfSegment(primaryLength, gainFile.size(), primaryLength - tiffAt);

    std::vector<uint8_t> out = primary;
    insertAt(out, primaryAt, mpf);
    insertAt(out, primaryAt, iso);
    insertAt(out, primaryAt, xmp);
    out.insert(out.end(), gainFile.begin(), gainFile.end());
    return out;
}

}  // namespace rawboy::uhdr
