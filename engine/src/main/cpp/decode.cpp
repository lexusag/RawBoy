#include "exif_reader.h"
#include "rawboy.h"

namespace rawboy {

namespace {

bool looksLikeTiff(const uint8_t* d, size_t size) {
    return size > 8 && ((d[0] == 'I' && d[1] == 'I' && d[2] == 42 && d[3] == 0) ||
                        (d[0] == 'M' && d[1] == 'M' && d[2] == 0 && d[3] == 42));
}

constexpr size_t DEPTH_FOOTER_SIZE = 20;

uint16_t readLe16(const uint8_t* p) {
    return static_cast<uint16_t>(p[0]) | (static_cast<uint16_t>(p[1]) << 8);
}

uint32_t readLe32(const uint8_t* p) {
    return static_cast<uint32_t>(p[0]) | (static_cast<uint32_t>(p[1]) << 8) |
           (static_cast<uint32_t>(p[2]) << 16) | (static_cast<uint32_t>(p[3]) << 24);
}

bool parseDepthFooter(const uint8_t* data, size_t size, int& w, int& h, uint8_t& flags, uint16_t& focusU16,
                      size_t& payloadOffset) {
    if (!data || size <= DEPTH_FOOTER_SIZE + 8) return false;
    const uint8_t* f = data + size - DEPTH_FOOTER_SIZE;
    if (std::memcmp(f, "RBDP", 4) != 0 || std::memcmp(f + 16, "RBDP", 4) != 0) return false;
    if (f[4] != 1) return false;  // version 1
    flags = f[5];
    w = readLe16(f + 6);
    h = readLe16(f + 8);
    focusU16 = readLe16(f + 10);
    const uint32_t payloadSize = readLe32(f + 12);
    if (w <= 0 || h <= 0 || w > 4096 || h > 4096) return false;
    if (payloadSize != static_cast<uint32_t>(w) * static_cast<uint32_t>(h)) return false;
    const size_t total = static_cast<size_t>(payloadSize) + DEPTH_FOOTER_SIZE;
    if (total >= size) return false;
    payloadOffset = size - total;
    return true;
}

}  // namespace

bool readDngDepth(const uint8_t* data, size_t size, DecodedImage::DepthData& out) {
    int w = 0, h = 0;
    uint8_t flags = 0;
    uint16_t focusU16 = 0;
    size_t payloadOffset = 0;
    if (!parseDepthFooter(data, size, w, h, flags, focusU16, payloadOffset)) return false;
    const size_t n = static_cast<size_t>(w) * static_cast<size_t>(h);
    out.width = w;
    out.height = h;
    out.hardware = (flags & 1) != 0;
    out.subjectDetected = (flags & 2) != 0;
    out.focusDepth = static_cast<float>(focusU16) / 65535.0f;
    out.data.assign(data + payloadOffset, data + payloadOffset + n);
    return true;
}

void copyDngDepthTrailer(const uint8_t* src, size_t srcSize, std::vector<uint8_t>& dst) {
    int w = 0, h = 0;
    uint8_t flags = 0;
    uint16_t focusU16 = 0;
    size_t payloadOffset = 0;
    if (!parseDepthFooter(src, srcSize, w, h, flags, focusU16, payloadOffset)) return;
    dst.insert(dst.end(), src + payloadOffset, src + srcSize);
}

bool decodeAny(const uint8_t* data, size_t size, DecodedImage& out, std::string& error, float extraBlack, bool draft,
               const BlackFix& black) {
    // JPEGs first: LibRaw would refuse them (or misread a camera's embedded preview structure).
    if (looksLikeJpeg(data, size)) return decodeJpeg(data, size, out, error);
    // LibRaw first: it handles every camera raw and most DNGs, and its path carries
    // RawBoy's own lens-correction handling. DNGs it can't read (DNG 1.7 JPEG XL,
    // and other newer encodings) fall back to the Adobe DNG SDK.
    bool ok = decodeWithLibRaw(data, size, out, error, extraBlack, draft, black);
    if (ok && out.metadata.hasGps && looksLikeTiff(data, size)) readGpsStamps(data, size, out.metadata);
    if (ok) fillMissingMetadata(data, size, out.metadata);
    std::string dngError;
#if RAWBOY_WITH_DNG_SDK
    if (!ok && looksLikeTiff(data, size)) {
        out = DecodedImage();
        ok = decodeWithDngSdk(data, size, out, dngError);
    }
#endif
    if (!ok && !dngError.empty() && dngError != "not a DNG") error = dngError + "; " + error;
    if (!ok && looksLikeTiff(data, size)) {
        // A TIFF no raw decoder takes: an ordinary image (scans, exports from other editors).
        DecodedImage image;
        std::string tiffError;
        if (decodeTiff(data, size, image, tiffError)) {
            out = std::move(image);
            readDngDepth(data, size, out.depth);
            return true;
        }
        error += "; as an image TIFF: " + tiffError;
    }
    if (ok) readDngDepth(data, size, out.depth);
    return ok;
}

}  // namespace rawboy
