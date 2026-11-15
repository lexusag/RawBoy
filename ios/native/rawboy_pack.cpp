// RawBoy Desktop: the Packer's C API (rawboy_native.h): dng_pack.cpp behind plain C types. macOS builds only (CMake).

#include "rawboy_native.h"

#include "dng_pack.h"

#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <new>
#include <string>

namespace {

void setError(char* error, size_t size, const std::string& message) {
    if (error && size) std::snprintf(error, size, "%s", message.c_str());
}

template <size_t N>
void put(char (&dst)[N], const std::string& src) {
    std::snprintf(dst, N, "%s", src.c_str());
}

void fill(RBPackInfo& o, const rawboy::PackInfo& i) {
    std::memset(&o, 0, sizeof(o));
    put(o.make, i.make);
    put(o.model, i.model);
    put(o.lens, i.lens);
    put(o.format, i.format);
    o.width = i.width;
    o.height = i.height;
    o.dng = i.dng;
    o.mosaic = i.mosaic;
    o.bayer = i.bayer;
    put(o.lensData, i.lensData);
    o.lensDistortion = i.lensDistortion;
    o.lensVignetting = i.lensVignetting;
    o.lensCa = i.lensCa;
    o.adobeHints = i.adobeHints;
    o.bits = i.bits;
    put(o.compression, i.compression);
    put(o.dngVersion, i.dngVersion);
    o.modeUsed = static_cast<int>(i.modeUsed);
    o.linear = i.linear;
    o.lensWritten = i.lensWritten;
    put(o.preview, i.preview);
    o.outWidth = i.outWidth;
    o.outHeight = i.outHeight;
    o.seconds = i.seconds;
}

}  // namespace

extern "C" {

bool rb_pack_inspect(const uint8_t* data, size_t size, RBPackInfo* info, char* error, size_t errorSize) {
    if (!data || size == 0 || !info) {
        setError(error, errorSize, "file is empty");
        return false;
    }
    try {
        rawboy::PackInfo i;
        std::string reason;
        if (!rawboy::inspectForPacking(data, size, i, reason)) {
            setError(error, errorSize, reason);
            return false;
        }
        fill(*info, i);
        return true;
    } catch (const std::bad_alloc&) {
        setError(error, errorSize, "Not enough memory");
    } catch (const std::exception& e) {
        setError(error, errorSize, e.what());
    }
    return false;
}

bool rb_pack(const uint8_t* data, size_t size, const RBPackOptions* options, RBPreviewEncoder encoder, void* context,
             uint8_t** out, size_t* outSize, RBPackInfo* info, char* error, size_t errorSize) {
    if (!data || size == 0 || !options || !out || !outSize) {
        setError(error, errorSize, "nothing to pack");
        return false;
    }
    try {
        rawboy::PackOptions o;
        switch (options->mode) {
            case RB_PACK_LOSSLESS_JPEG: o.mode = rawboy::PackMode::LosslessJpeg; break;
            case RB_PACK_LOSSLESS_JXL: o.mode = rawboy::PackMode::LosslessJxl; break;
            case RB_PACK_MICRO: o.mode = rawboy::PackMode::Micro; break;
            default: o.mode = rawboy::PackMode::SmallRaw; break;
        }
        o.distance = options->distance;
        o.effort = options->effort;
        o.maxSize = options->maxSize;
        o.previewSize = options->previewSize;
        o.lensCorrections = options->lensCorrections;
        o.keepGps = options->keepGps;
        o.threads = options->threads > 0 ? options->threads : 4;
        rawboy::PreviewEncoder preview = [encoder, context](const uint8_t* rgb, int w, int h, std::vector<uint8_t>& jpeg) {
            if (!encoder) return false;
            uint8_t* bytes = nullptr;
            size_t n = 0;
            if (!encoder(rgb, w, h, &bytes, &n, context) || !bytes) return false;
            jpeg.assign(bytes, bytes + n);
            std::free(bytes);
            return true;
        };
        std::vector<uint8_t> dng;
        rawboy::PackInfo i;
        std::string reason;
        if (!rawboy::packDng(data, size, o, preview, dng, i, reason)) {
            setError(error, errorSize, reason);
            return false;
        }
        uint8_t* buffer = static_cast<uint8_t*>(std::malloc(dng.size()));
        if (!buffer) {
            setError(error, errorSize, "Not enough memory for the result");
            return false;
        }
        std::memcpy(buffer, dng.data(), dng.size());
        *out = buffer;
        *outSize = dng.size();
        if (info) fill(*info, i);
        return true;
    } catch (const std::bad_alloc&) {
        setError(error, errorSize, "Not enough memory to pack this file");
    } catch (const std::exception& e) {
        setError(error, errorSize, e.what());
    }
    return false;
}

void rb_pack_free(uint8_t* buffer) { std::free(buffer); }

}  // extern "C"
