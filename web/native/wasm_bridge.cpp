// RawBoy Web: embind API over the engine's native code, the web counterpart of jni_bridge.cpp,
// band_ops.cpp and jpeg_jpegli.cpp. Runs in a Web Worker (web/src/worker/decoder.worker.ts).
//
// Images are integer handles (pointers into the WASM heap). Typed arrays passed in are copied into the heap;
// arrays returned are copies owned by JavaScript, so they stay valid when the heap grows.

#include "band_ops.h"
#include "blemish.h"
#include "jpegli_settings.h"
#include "rawboy.h"

#include <emscripten/bind.h>
#include <emscripten/val.h>

#if RAWBOY_WITH_DNG_SDK
#include <jxl/decode_cxx.h>
#include <jxl/thread_parallel_runner_cxx.h>
#endif

#include <cstdlib>
#include <memory>
#include <stdexcept>
#include <string>
#include <vector>

using emscripten::val;
using rawboy::DecodedImage;

namespace {

std::string lastError;

DecodedImage* fromHandle(uintptr_t handle) { return reinterpret_cast<DecodedImage*>(handle); }

template <typename T>
std::vector<T> fromTyped(const val& array) {
    std::vector<T> v(array["length"].as<size_t>());
    if (!v.empty()) val(emscripten::typed_memory_view(v.size(), v.data())).call<void>("set", array);
    return v;
}

template <typename T>
val toTyped(const T* data, size_t n) {
    return val(emscripten::typed_memory_view(n, data)).call<val>("slice");
}

/**
 * Decodes the file bytes; returns a handle, or 0 with the reason in lastError(). [draft]: a half-size decode for small
 * copies and the noise level only (DecodedImage::fullWidth).
 */
uintptr_t open(const val& bytes, float extraBlack, bool draft) {
    lastError.clear();
    try {
        const std::vector<uint8_t> data = fromTyped<uint8_t>(bytes);
        if (data.empty()) {
            lastError = "file is empty";
            return 0;
        }
        auto image = std::make_unique<DecodedImage>();
        std::string error;
        if (!rawboy::decodeAny(data.data(), data.size(), *image, error, extraBlack, draft)) {
            lastError = "Cannot decode file: " + error;
            return 0;
        }
        return reinterpret_cast<uintptr_t>(image.release());
    } catch (const std::bad_alloc&) {
        lastError = "Not enough memory to decode this file";
    } catch (const std::exception& e) {
        lastError = e.what();
    }
    return 0;
}

/**
 * A HEIC or PNG the browser decoded: [rgba] canvas bytes, sRGB or Display P3 ([p3]), already upright; [file] the
 * file, for its EXIF. Returns a handle, or 0 with the reason in lastError().
 */
uintptr_t openPixels(const val& rgba, int w, int h, bool p3, const val& file) {
    lastError.clear();
    try {
        const std::vector<uint8_t> pixels = fromTyped<uint8_t>(rgba);
        const std::vector<uint8_t> data = fromTyped<uint8_t>(file);
        if (pixels.size() < size_t(w) * h * 4) {
            lastError = "pixel buffer too small";
            return 0;
        }
        auto image = std::make_unique<DecodedImage>();
        std::string error;
        const auto format = p3 ? rawboy::DisplayPixels::DisplayP3_8 : rawboy::DisplayPixels::Srgb8;
        if (!rawboy::decodeDisplayPixels(pixels.data(), format, w, h, size_t(w) * 4, 1, data.data(), data.size(),
                                         *image, error)) {
            lastError = "Cannot decode file: " + error;
            return 0;
        }
        return reinterpret_cast<uintptr_t>(image.release());
    } catch (const std::bad_alloc&) {
        lastError = "Not enough memory to decode this file";
    } catch (const std::exception& e) {
        lastError = e.what();
    }
    return 0;
}

void close(uintptr_t h) { delete fromHandle(h); }

std::string getLastError() { return lastError; }
bool hasDngSdk() { return RAWBOY_WITH_DNG_SDK != 0; }

/**
 * A JPEG XL image (a DNG 1.7 preview: codestream or container) as 8-bit sRGB RGBA, for RawBoy Browser:
 * {width, height, rgba}, or null with the reason in lastError(). Needs libjxl (rawboy-full).
 */
val decodeJxl(const val& bytes) {
    lastError.clear();
#if RAWBOY_WITH_DNG_SDK
    try {
        const std::vector<uint8_t> data = fromTyped<uint8_t>(bytes);
        auto decoder = JxlDecoderMake(nullptr);
        // A pool made per call: a lasting one would hold threads parallelRows needs (PTHREAD_POOL_SIZE_STRICT).
        auto runner = JxlThreadParallelRunnerMake(nullptr, 4);
        const JxlPixelFormat format{4, JXL_TYPE_UINT8, JXL_NATIVE_ENDIAN, 0};
        JxlBasicInfo info{};
        std::vector<uint8_t> rgba;
        if (JxlDecoderSubscribeEvents(decoder.get(), JXL_DEC_BASIC_INFO | JXL_DEC_COLOR_ENCODING | JXL_DEC_FULL_IMAGE) != JXL_DEC_SUCCESS ||
            JxlDecoderSetParallelRunner(decoder.get(), JxlThreadParallelRunner, runner.get()) != JXL_DEC_SUCCESS ||
            JxlDecoderSetInput(decoder.get(), data.data(), data.size()) != JXL_DEC_SUCCESS) {
            lastError = "JPEG XL decoder setup failed";
            return val::null();
        }
        JxlDecoderCloseInput(decoder.get());
        for (;;) {
            const JxlDecoderStatus status = JxlDecoderProcessInput(decoder.get());
            if (status == JXL_DEC_BASIC_INFO) {
                if (JxlDecoderGetBasicInfo(decoder.get(), &info) != JXL_DEC_SUCCESS) break;
            } else if (status == JXL_DEC_COLOR_ENCODING) {
                // Lossy (XYB) images convert to it; lossless ones keep their own space (DNG previews are sRGB).
                JxlColorEncoding srgb{};
                srgb.color_space = JXL_COLOR_SPACE_RGB;
                srgb.white_point = JXL_WHITE_POINT_D65;
                srgb.primaries = JXL_PRIMARIES_SRGB;
                srgb.transfer_function = JXL_TRANSFER_FUNCTION_SRGB;
                srgb.rendering_intent = JXL_RENDERING_INTENT_PERCEPTUAL;
                JxlDecoderSetPreferredColorProfile(decoder.get(), &srgb);
            } else if (status == JXL_DEC_NEED_IMAGE_OUT_BUFFER) {
                size_t size = 0;
                if (JxlDecoderImageOutBufferSize(decoder.get(), &format, &size) != JXL_DEC_SUCCESS) break;
                rgba.resize(size);
                if (JxlDecoderSetImageOutBuffer(decoder.get(), &format, rgba.data(), rgba.size()) != JXL_DEC_SUCCESS) break;
            } else if (status == JXL_DEC_FULL_IMAGE) {
                val out = val::object();
                out.set("width", info.xsize);
                out.set("height", info.ysize);
                out.set("rgba", toTyped(rgba.data(), rgba.size()));
                return out;
            } else {
                break;  // error, or the input ended early
            }
        }
        lastError = "Cannot decode the JPEG XL preview";
    } catch (const std::bad_alloc&) {
        lastError = "Not enough memory to decode the JPEG XL preview";
    }
    return val::null();
#else
    (void)bytes;
    lastError = "JPEG XL needs the build with the Adobe DNG SDK";
    return val::null();
#endif
}
int width(uintptr_t h) { return fromHandle(h)->width; }
int height(uintptr_t h) { return fromHandle(h)->height; }
/** The photo's size at full resolution: width/height unless the handle is a draft. */
int fullWidth(uintptr_t h) { return fromHandle(h)->fullWidth ? fromHandle(h)->fullWidth : fromHandle(h)->width; }
int fullHeight(uintptr_t h) { return fromHandle(h)->fullHeight ? fromHandle(h)->fullHeight : fromHandle(h)->height; }
float iso(uintptr_t h) { return fromHandle(h)->iso; }
float baselineExposure(uintptr_t h) { return fromHandle(h)->baselineExposure; }
float clipLevel(uintptr_t h) { return fromHandle(h)->clipLevel; }
bool displayReferred(uintptr_t h) { return fromHandle(h)->displayReferred; }
std::string lensName(uintptr_t h) { return fromHandle(h)->lensName; }
std::string camera(uintptr_t h) { return fromHandle(h)->camera; }

val asShotWhite(uintptr_t h) {
    const DecodedImage* img = fromHandle(h);
    const double xy[2] = {img->whiteX, img->whiteY};
    return toTyped(xy, 2);
}

std::string describe(uintptr_t h) {
    const DecodedImage* img = fromHandle(h);
    return img->camera + " · " + std::to_string(fullWidth(h)) + "×" + std::to_string(fullHeight(h)) + " · " + img->decoder;
}

/** The photo's EXIF essentials (PhotoMetadata) as a plain object; unknown numbers are NaN, unknown strings empty. */
val metadata(uintptr_t h) {
    const rawboy::PhotoMetadata& m = fromHandle(h)->metadata;
    val o = val::object();
    o.set("make", m.make);
    o.set("model", m.model);
    o.set("lensMake", m.lensMake);
    o.set("lensModel", m.lensModel);
    o.set("artist", m.artist);
    o.set("copyright", m.copyright);
    o.set("dateTimeOriginal", m.dateTimeOriginal);
    o.set("subSecTimeOriginal", m.subSecTimeOriginal);
    o.set("offsetTimeOriginal", m.offsetTimeOriginal);
    o.set("exposureTime", m.exposureTime);
    o.set("fNumber", m.fNumber);
    o.set("exposureBias", m.exposureBias);
    o.set("focalLength", m.focalLength);
    o.set("focalLength35mm", m.focalLength35mm);
    o.set("iso", m.iso);
    if (m.hasGps) {
        val gps = val::object();
        gps.set("latitude", toTyped(m.gpsLatitude, 3));
        gps.set("longitude", toTyped(m.gpsLongitude, 3));
        gps.set("latitudeRef", std::string(1, m.gpsLatitudeRef));
        gps.set("longitudeRef", std::string(1, m.gpsLongitudeRef));
        gps.set("altitude", m.gpsAltitude);
        gps.set("belowSeaLevel", m.gpsBelowSeaLevel);
        if (std::isfinite(m.gpsTimeStamp[0]) && std::isfinite(m.gpsTimeStamp[1]) && std::isfinite(m.gpsTimeStamp[2]))
            gps.set("timeStamp", toTyped(m.gpsTimeStamp, 3));
        gps.set("dateStamp", m.gpsDateStamp);
        o.set("gps", gps);
    } else {
        o.set("gps", val::null());
    }
    return o;
}

/** Same 41-double layout as RawNative.lensInfo (see jni_bridge.cpp). */
val lensInfo(uintptr_t h) {
    const DecodedImage* img = fromHandle(h);
    const rawboy::LensOpcodes& l = img->lens;
    double v[41] = {};
    v[0] = img->orientation;
    v[1] = img->sensorWidth;
    v[2] = img->sensorHeight;
    v[3] = l.hasWarp;
    v[4] = l.warp.planes;
    for (int p = 0; p < 3; ++p)
        for (int k = 0; k < 6; ++k) v[5 + p * 6 + k] = l.warp.coef[p][k];
    v[23] = l.warp.centerX;
    v[24] = l.warp.centerY;
    v[25] = l.hasVignette;
    for (int k = 0; k < 5; ++k) v[26 + k] = l.vignette.k[k];
    v[31] = l.vignette.centerX;
    v[32] = l.vignette.centerY;
    const rawboy::ShadingGrid& s = img->shading;
    v[33] = !s.empty();
    v[34] = s.pointsV;
    v[35] = s.pointsH;
    v[36] = s.originV;
    v[37] = s.originH;
    v[38] = s.spacingV;
    v[39] = s.spacingH;
    v[40] = static_cast<double>(l.gainMaps.size());
    return toTyped(v, 41);
}

val lensShading(uintptr_t h) {
    const rawboy::ShadingGrid& s = fromHandle(h)->shading;
    return toTyped(s.gains.data(), s.gains.size());
}

/** [dstW] x [dstH] RGB half floats (Uint16Array), area-averaged; see rawboy::downsample. */
val downsample(uintptr_t h, int dstW, int dstH, bool boostHighlights) {
    std::vector<uint16_t> out(static_cast<size_t>(dstW) * dstH * 3);
    rawboy::downsample(*fromHandle(h), dstW, dstH, out.data(), boostHighlights);
    return toTyped(out.data(), out.size());
}

/** A full-resolution tile as RGB half floats (Uint16Array). */
val copyTile(uintptr_t h, int x, int y, int w, int tileH) {
    const DecodedImage* img = fromHandle(h);
    if (x < 0 || y < 0 || w <= 0 || tileH <= 0 || x + w > img->width || y + tileH > img->height) {
        throw std::invalid_argument("invalid tile");
    }
    std::vector<uint16_t> out(static_cast<size_t>(w) * tileH * 3);
    rawboy::copyTile(*img, x, y, w, tileH, out.data());
    return toTyped(out.data(), out.size());
}

/** [luma, chroma] noise std in the denoise domain (rawboy::estimateNoise); zeros if not measured. */
val noiseLevel(uintptr_t h) {
    const rawboy::NoiseLevel n = rawboy::estimateNoise(*fromHandle(h));
    const float v[2] = {n.luma, n.chroma};
    return toTyped(v, 2);
}

/** Blemish candidates (x, y, radius, score)* on skin, most obvious first; [mask] is a Float32Array. */
val detectBlemishes(uintptr_t h, const val& mask, int maskW, int maskH, float faceDiameter) {
    const std::vector<float> m = fromTyped<float>(mask);
    if (m.size() < static_cast<size_t>(maskW) * maskH) throw std::invalid_argument("invalid skin mask");
    const auto spots = rawboy::detectBlemishes(*fromHandle(h), {m.data(), maskW, maskH}, faceDiameter);
    std::vector<float> flat;
    flat.reserve(spots.size() * 4);
    for (const auto& s : spots) flat.insert(flat.end(), {s.x, s.y, s.radius, s.score});
    return toTyped(flat.data(), flat.size());
}

/** Undoes any previous healing, then heals the given spots (x, y, radius, score)*n. */
void healBlemishes(uintptr_t h, const val& spots) {
    DecodedImage* img = fromHandle(h);
    rawboy::restoreBackups(*img, img->healBackups);
    const std::vector<float> v = fromTyped<float>(spots);
    for (size_t i = 0; i + 3 < v.size(); i += 4) rawboy::healBlemish(*img, {v[i], v[i + 1], v[i + 2], v[i + 3]}, img->healBackups);
}

/** The streaming area downscaler of the export path (BandDownscaler); 16-bit RGB in and out. */
class Downscaler {
public:
    Downscaler(int inW, int inH, int outW, int outH) : impl_(inW, inH, outW, outH), inW_(inW), outW_(outW) {}

    /** Adds [rows] input rows; returns the finished output rows (Uint16Array, possibly empty). */
    val push(const val& in, int rows) {
        const std::vector<uint16_t> src = fromTyped<uint16_t>(in);
        if (src.size() < static_cast<size_t>(inW_) * 3 * rows) throw std::invalid_argument("band too small");
        std::vector<uint16_t> out(static_cast<size_t>(impl_.maxOutputRows(rows)) * outW_ * 3);
        const int n = impl_.push(src.data(), rows, out.data());
        return toTyped(out.data(), static_cast<size_t>(n) * outW_ * 3);
    }

    val finish() {
        std::vector<uint16_t> out(static_cast<size_t>(impl_.maxOutputRows(1)) * outW_ * 3);
        const int n = impl_.finish(out.data());
        return toTyped(out.data(), static_cast<size_t>(n) * outW_ * 3);
    }

private:
    rawboy::Downscaler impl_;
    int inW_, outW_;
};

/** jpegli reports fatal errors through error_exit, which must not return: turn them into exceptions. */
[[noreturn]] void errorExit(j_common_ptr cinfo) {
    char message[JMSG_LENGTH_MAX];
    (*cinfo->err->format_message)(cinfo, message);
    throw std::runtime_error(message);
}

/** RawBoy's jpegli JPEG (16-bit RGB in, 4:4:4), written to memory; rows are streamed in bands. */
class JpegEncoder {
public:
    JpegEncoder(int width, int height, int quality) : width_(width) {
        cinfo_.err = jpegli_std_error(&err_);
        err_.error_exit = errorExit;
        jpegli_create_compress(&cinfo_);
        created_ = true;
        jpegli_mem_dest(&cinfo_, &buffer_, &size_);
        rawboy::configureJpegli(&cinfo_, width, height, quality);
        jpegli_start_compress(&cinfo_, TRUE);
    }

    ~JpegEncoder() {
        if (created_) jpegli_destroy_compress(&cinfo_);
        std::free(buffer_);
    }

    /** Appends [rows] rows of interleaved RGB, unsigned 16-bit (0..65535, display-encoded) samples. */
    void writeRows(const val& samples, int rows) {
        std::vector<uint16_t> data = fromTyped<uint16_t>(samples);
        if (data.size() < static_cast<size_t>(width_) * 3 * rows) throw std::invalid_argument("band too small");
        std::vector<JSAMPROW> pointers(static_cast<size_t>(rows));
        for (int r = 0; r < rows; ++r) {
            pointers[r] = reinterpret_cast<JSAMPROW>(data.data() + static_cast<size_t>(r) * width_ * 3);
        }
        JDIMENSION written = 0;
        while (written < static_cast<JDIMENSION>(rows)) {
            written += jpegli_write_scanlines(&cinfo_, pointers.data() + written, rows - written);
        }
    }

    /** Completes the file and returns its bytes (Uint8Array). */
    val finish() {
        jpegli_finish_compress(&cinfo_);
        return toTyped(buffer_, size_);
    }

private:
    jpeg_compress_struct cinfo_{};
    jpeg_error_mgr err_{};
    unsigned char* buffer_ = nullptr;
    unsigned long size_ = 0;
    int width_;
    bool created_ = false;
};

}  // namespace

EMSCRIPTEN_BINDINGS(rawboy) {
    using namespace emscripten;
    function("open", &open);
    function("openPixels", &openPixels);
    function("displayReferred", &displayReferred);
    function("close", &close);
    function("lastError", &getLastError);
    function("hasDngSdk", &hasDngSdk);
    function("decodeJxl", &decodeJxl);
    function("width", &width);
    function("height", &height);
    function("fullWidth", &fullWidth);
    function("fullHeight", &fullHeight);
    function("iso", &iso);
    function("baselineExposure", &baselineExposure);
    function("clipLevel", &clipLevel);
    function("lensName", &lensName);
    function("camera", &camera);
    function("asShotWhite", &asShotWhite);
    function("describe", &describe);
    function("lensInfo", &lensInfo);
    function("metadata", &metadata);
    function("lensShading", &lensShading);
    function("downsample", &downsample);
    function("copyTile", &copyTile);
    function("noiseLevel", &noiseLevel);
    function("detectBlemishes", &detectBlemishes);
    function("healBlemishes", &healBlemishes);
    class_<Downscaler>("Downscaler")
        .constructor<int, int, int, int>()
        .function("push", &Downscaler::push)
        .function("finish", &Downscaler::finish);
    class_<JpegEncoder>("JpegEncoder")
        .constructor<int, int, int>()
        .function("writeRows", &JpegEncoder::writeRows)
        .function("finish", &JpegEncoder::finish);
}
