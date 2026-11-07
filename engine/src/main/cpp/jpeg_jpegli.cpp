// JPEG encoding with jpegli (libjxl's libjpeg-compatible encoder): adaptive quantisation
// gives fewer artefacts per byte than libjpeg, and it takes 16-bit samples, so the
// developed image is quantised once, by the DCT, instead of first to 8 bits.
//
// Built into librawboyjpeg.so (see jpegli.cmake). Used by Exporter for JPEG when ExportSettings.jpegEncoder is JPEGLI. Rows are streamed in
// bands as the GPU develops them, so no full-size bitmap is needed.

#include <jni.h>
#include <unistd.h>

#include <algorithm>
#include <cstdio>
#include <cstdlib>
#include <memory>
#include <stdexcept>
#include <string>
#include <vector>

#include "jpegli_settings.h"
#include "ultrahdr.h"

namespace {

void throwJava(JNIEnv* env, const std::string& msg) {
    jclass c = env->FindClass("java/io/IOException");
    if (c) env->ThrowNew(c, msg.c_str());
}

/** jpegli reports fatal errors through error_exit, which must not return: turn them into exceptions. */
[[noreturn]] void errorExit(j_common_ptr cinfo) {
    char message[JMSG_LENGTH_MAX];
    (*cinfo->err->format_message)(cinfo, message);
    throw std::runtime_error(message);
}

struct Encoder {
    jpeg_compress_struct cinfo{};
    jpeg_error_mgr err{};
    FILE* file = nullptr;
    int width = 0;
    bool created = false;
    // Gain map mode (Ultra HDR): the SDR picture is encoded into memory, so the container can be put around it at the
    // end, and the gain map is accumulated from the same rows.
    FILE* mem = nullptr;
    char* memBuf = nullptr;
    size_t memSize = 0;
    std::unique_ptr<rawboy::uhdr::GainMapBuilder> gain;

    ~Encoder() {
        if (created) jpegli_destroy_compress(&cinfo);
        if (mem) fclose(mem);
        free(memBuf);
        if (file) fclose(file);
    }
};

/** The 8-bit gain map as a grayscale JPEG (jpegli, in memory). */
std::vector<uint8_t> encodeGainMap(const std::vector<uint8_t>& map, int width, int height) {
    char* buf = nullptr;
    size_t size = 0;
    FILE* mem = open_memstream(&buf, &size);
    if (!mem) throw std::runtime_error("gain map: no memory stream");
    jpeg_compress_struct cinfo{};
    jpeg_error_mgr err{};
    bool created = false;
    try {
        cinfo.err = jpegli_std_error(&err);
        err.error_exit = errorExit;
        jpegli_create_compress(&cinfo);
        created = true;
        jpegli_stdio_dest(&cinfo, mem);
        cinfo.image_width = static_cast<JDIMENSION>(width);
        cinfo.image_height = static_cast<JDIMENSION>(height);
        cinfo.input_components = 1;
        cinfo.in_color_space = JCS_GRAYSCALE;
        jpegli_set_defaults(&cinfo);
        jpegli_set_quality(&cinfo, 85, TRUE);
        jpegli_start_compress(&cinfo, TRUE);
        for (int y = 0; y < height; ++y) {
            JSAMPROW row = const_cast<JSAMPROW>(map.data() + static_cast<size_t>(y) * width);
            jpegli_write_scanlines(&cinfo, &row, 1);
        }
        jpegli_finish_compress(&cinfo);
        jpegli_destroy_compress(&cinfo);
        created = false;
    } catch (...) {
        if (created) jpegli_destroy_compress(&cinfo);
        fclose(mem);
        free(buf);
        throw;
    }
    fclose(mem);
    std::vector<uint8_t> out(buf, buf + size);
    free(buf);
    return out;
}

jlong beginEncoder(JNIEnv* env, jint fd, jint width, jint height, jint quality, bool gainMap) {
    auto enc = std::make_unique<Encoder>();
    const int own = dup(fd);
    if (own < 0 || !(enc->file = fdopen(own, "wb"))) {
        if (own >= 0) close(own);
        throwJava(env, "cannot open output for JPEG");
        return 0;
    }
    try {
        enc->cinfo.err = jpegli_std_error(&enc->err);
        enc->err.error_exit = errorExit;
        jpegli_create_compress(&enc->cinfo);
        enc->created = true;
        if (gainMap) {
            enc->mem = open_memstream(&enc->memBuf, &enc->memSize);
            if (!enc->mem) throw std::runtime_error("no memory stream");
            enc->gain = std::make_unique<rawboy::uhdr::GainMapBuilder>(width, height);
            jpegli_stdio_dest(&enc->cinfo, enc->mem);
        } else {
            jpegli_stdio_dest(&enc->cinfo, enc->file);
        }
        rawboy::configureJpegli(&enc->cinfo, width, height, quality);
        jpegli_start_compress(&enc->cinfo, TRUE);
        enc->width = width;
        return reinterpret_cast<jlong>(enc.release());
    } catch (const std::exception& e) {
        throwJava(env, std::string("JPEG encoder: ") + e.what());
        return 0;
    }
}

Encoder* fromHandle(jlong handle) { return reinterpret_cast<Encoder*>(handle); }

}  // namespace

extern "C" {

/**
 * Starts a [width] x [height] RGB JPEG at [quality] (1..100), 4:4:4, written to [fd]
 * (duplicated, so the caller may close its own). Returns a handle for writeRows/finish/abort.
 */
JNIEXPORT jlong JNICALL Java_app_rawboy_export_JpegNative_begin(JNIEnv* env, jclass, jint fd, jint width,
                                                                 jint height, jint quality) {
    return beginEncoder(env, fd, width, height, quality, false);
}

/**
 * As begin, for an Ultra HDR JPEG: the file gets a gain map (see ultrahdr.h) built from the rows written, unless the
 * picture has nothing bright enough to need one, in which case it is the plain JPEG.
 */
JNIEXPORT jlong JNICALL Java_app_rawboy_export_JpegNative_beginGainMap(JNIEnv* env, jclass, jint fd, jint width,
                                                                        jint height, jint quality) {
    return beginEncoder(env, fd, width, height, quality, true);
}

/**
 * Writes an APP1 segment holding [payload] ("Exif\0\0" + TIFF block) right after the header jpegli wrote at begin
 * (SOI, JFIF APP0), so the file needs no EXIF rewrite afterwards. Call before the first writeRows.
 */
JNIEXPORT void JNICALL Java_app_rawboy_export_JpegNative_writeExif(JNIEnv* env, jclass, jlong handle,
                                                                    jbyteArray payload) {
    Encoder* enc = fromHandle(handle);
    const jsize length = env->GetArrayLength(payload);
    if (length <= 0 || length > 65533) {
        throwJava(env, "JPEG encoder: EXIF too large");
        return;
    }
    std::vector<JOCTET> bytes(static_cast<size_t>(length));
    env->GetByteArrayRegion(payload, 0, length, reinterpret_cast<jbyte*>(bytes.data()));
    try {
        jpegli_write_marker(&enc->cinfo, JPEG_APP0 + 1, bytes.data(), static_cast<unsigned int>(length));
    } catch (const std::exception& e) {
        throwJava(env, std::string("JPEG encoder: ") + e.what());
    }
}

/** Appends [rows] rows of interleaved RGB, unsigned 16-bit (0..65535, display-encoded) samples. */
JNIEXPORT void JNICALL Java_app_rawboy_export_JpegNative_writeRows(JNIEnv* env, jclass, jlong handle,
                                                                    jshortArray samples, jint rows) {
    Encoder* enc = fromHandle(handle);
    const size_t needed = static_cast<size_t>(enc->width) * 3 * static_cast<size_t>(rows);
    if (static_cast<size_t>(env->GetArrayLength(samples)) < needed) {
        throwJava(env, "JPEG encoder: band too small");
        return;
    }
    auto* data = static_cast<uint16_t*>(env->GetPrimitiveArrayCritical(samples, nullptr));
    if (!data) return;
    std::string error;
    try {
        std::vector<JSAMPROW> pointers(static_cast<size_t>(rows));
        for (int r = 0; r < rows; ++r) {
            pointers[r] = reinterpret_cast<JSAMPROW>(data + static_cast<size_t>(r) * enc->width * 3);
        }
        JDIMENSION written = 0;
        while (written < static_cast<JDIMENSION>(rows)) {
            written += jpegli_write_scanlines(&enc->cinfo, pointers.data() + written, rows - written);
        }
        if (enc->gain) enc->gain->addRows(data, rows);
    } catch (const std::exception& e) {
        error = e.what();
    }
    env->ReleasePrimitiveArrayCritical(samples, data, JNI_ABORT);
    if (!error.empty()) throwJava(env, "JPEG encoder: " + error);
}

/** Completes the file and frees the encoder; the handle is invalid afterwards. */
JNIEXPORT void JNICALL Java_app_rawboy_export_JpegNative_finish(JNIEnv* env, jclass, jlong handle) {
    std::unique_ptr<Encoder> enc(fromHandle(handle));
    std::string error;
    try {
        jpegli_finish_compress(&enc->cinfo);
        if (enc->mem) {
            // Gain map mode: the SDR picture is in memory. Whatever goes wrong with the gain map, the SDR JPEG is
            // still written as it is.
            fclose(enc->mem);
            enc->mem = nullptr;
            std::vector<uint8_t> out(enc->memBuf, enc->memBuf + enc->memSize);
            try {
                const std::vector<uint8_t> map = enc->gain->finish();
                if (*std::max_element(map.begin(), map.end()) >= rawboy::uhdr::kMinPeak) {
                    const std::vector<uint8_t> gainJpeg = encodeGainMap(map, enc->gain->mapWidth(), enc->gain->mapHeight());
                    std::vector<uint8_t> hdr = rawboy::uhdr::assemble(out, gainJpeg);
                    if (!hdr.empty()) out = std::move(hdr);
                }
            } catch (const std::exception&) {
            }
            if (fwrite(out.data(), 1, out.size(), enc->file) != out.size()) error = "write failed";
        }
    } catch (const std::exception& e) {
        error = e.what();
    }
    const bool flushed = fflush(enc->file) == 0;
    if (!error.empty()) {
        throwJava(env, "JPEG encoder: " + error);
    } else if (!flushed) {
        throwJava(env, "JPEG write failed");
    }
}

/** Frees the encoder without completing the file; the handle is invalid afterwards. */
JNIEXPORT void JNICALL Java_app_rawboy_export_JpegNative_abort(JNIEnv*, jclass, jlong handle) {
    delete fromHandle(handle);
}

}  // extern "C"
