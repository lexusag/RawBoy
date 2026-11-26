// RawBoy iOS: C API over the engine's decoder (RawBoyNative.framework), the iOS counterpart of jni_bridge.cpp and
// the web build's wasm_bridge.cpp. Swift calls it directly (ios/Engine/app/rawboy/raw/RawNative.swift).
//
// Strings and arrays returned by an RBImage are owned by it and valid until rb_close. Nothing here throws:
// failures return NULL/false with the reason in [error].

#pragma once

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

#define RB_API __attribute__((visibility("default")))

typedef struct RBImage RBImage;

/** The photo's EXIF essentials (rawboy::PhotoMetadata); unknown numbers are NaN (iso 0), unknown strings empty. */
typedef struct {
    const char* make;
    const char* model;
    const char* lensMake;
    const char* lensModel;
    const char* artist;
    const char* copyright;
    const char* dateTimeOriginal;  // "YYYY:MM:DD HH:MM:SS"
    const char* subSecTimeOriginal;
    const char* offsetTimeOriginal;
    double exposureTime;  // seconds
    double fNumber;
    double exposureBias;  // EV
    double focalLength;   // mm
    double focalLength35mm;
    float iso;
    bool hasGps;
    double gpsLatitude[3], gpsLongitude[3];  // degrees, minutes, seconds
    char gpsLatitudeRef, gpsLongitudeRef;
    double gpsAltitude;  // metres
    bool gpsBelowSeaLevel;
    double gpsTimeStamp[3];  // the fix's UTC hours, minutes, seconds (NaN if unknown)
    const char* gpsDateStamp;  // the fix's UTC date, "YYYY:MM:DD" (empty if unknown)
} RBMetadata;

/** True when the Adobe DNG SDK (DNG 1.7 / JPEG XL) is built in. */
RB_API bool rb_has_dng_sdk(void);

/**
 * Decodes a raw file's bytes into linear Rec.2020 half floats (see rawboy::decodeAny). [extraBlack]: black to
 * subtract beyond the file's, as a fraction of the white range (Camera only; 0 elsewhere).
 */
RB_API RBImage* rb_open(const uint8_t* data, size_t size, float extraBlack, char* error, size_t errorSize);
/**
 * A HEIC or PNG decoded by ImageIO: [rgba] half-float RGBA in extended linear sRGB, [rowBytes] apart. [orientation] (1..8)
 * is applied here; [file] (optional) is the HEIF file, for its EXIF.
 */
RB_API RBImage* rb_open_pixels(const uint16_t* rgba, int width, int height, size_t rowBytes, int orientation,
                               const uint8_t* file, size_t fileSize, char* error, size_t errorSize);
RB_API void rb_close(RBImage* image);
/** A JPEG/HEIC (taken back to scene light by the decoder), not a raw. */
RB_API bool rb_display_referred(const RBImage* image);

RB_API int rb_width(const RBImage* image);
RB_API int rb_height(const RBImage* image);
/** As-shot white chromaticity (CIE xy) into out[2]. */
RB_API void rb_as_shot_white(const RBImage* image, double* out);
RB_API float rb_iso(const RBImage* image);
/** DNG BaselineExposure in EV (already applied), NaN when the file has none. */
RB_API float rb_baseline_exposure(const RBImage* image);
/** Value of a photosite clipped in every channel (blown highlights), 0 when unknown (see DecodedImage::clipLevel). */
RB_API float rb_clip_level(const RBImage* image);
RB_API const char* rb_camera(const RBImage* image);
RB_API const char* rb_decoder(const RBImage* image);
RB_API const char* rb_lens_name(const RBImage* image);
RB_API void rb_metadata(const RBImage* image, RBMetadata* out);

/** Lens data for the GPU: 41 doubles, the layout of RawNative.lensInfo (see jni_bridge.cpp). */
RB_API void rb_lens_info(const RBImage* image, double* out);
/** Luminance shading gains (pointsV x pointsH), *count = 0 when there are none. */
RB_API const float* rb_lens_shading(const RBImage* image, size_t* count);

/**
 * The RawBoy Camera depth map in the file's "RBDP" trailer (DecodedImage::depth): false when there is none, else
 * out[0..4] = width, height, hardware (0/1), subject detected (0/1), focus depth (0..65535 = 0..1).
 */
RB_API bool rb_depth_info(const RBImage* image, int32_t* out);
/** The 8-bit map (width x height, 0 = near, 255 = far), valid while the image is open; *count = 0 when there is none. */
RB_API const uint8_t* rb_depth_data(const RBImage* image, size_t* count);
/** Distance per map pixel in millimetres (0 unknown, 65535 farther), version 2 trailers only; *count = 0 otherwise. */
RB_API const uint16_t* rb_depth_millimetres(const RBImage* image, size_t* count);

/** Area-average downscale into dst (dstW x dstH RGB half floats); see rawboy::downsample. */
RB_API void rb_downsample(const RBImage* image, int dstW, int dstH, uint16_t* dst, bool boostHighlights);
/** Copies a full-resolution tile (RGB half floats, tightly packed); false if it's out of bounds. */
RB_API bool rb_copy_tile(const RBImage* image, int x, int y, int width, int height, uint16_t* dst);
/** Luma and colour noise std in the denoise domain (rawboy::estimateNoise) into out[2]; zeros if not measured. */
RB_API void rb_noise_level(const RBImage* image, float* out);

/**
 * Blemish candidates on skin, (x, y, radius, score) per spot, most obvious first; [mask] holds maskW x maskH skin
 * probabilities. Returns a malloc'd array of *count floats (free with rb_free_floats), NULL when there are none.
 */
RB_API float* rb_detect_blemishes(const RBImage* image, const float* mask, int maskW, int maskH, float faceDiameter,
                                  size_t* count);
RB_API void rb_free_floats(float* values);
/** Undoes any previous healing, then heals the given spots (x, y, radius, score) * (count / 4). */
RB_API void rb_heal_blemishes(RBImage* image, const float* spots, size_t count);
/**
 * As rb_heal_blemishes, plus the healing brush's disks: (x, y, radius, srcX, srcY, feather) * (strokeCount / 6) in
 * full-resolution pixels; srcX < 0 = no source (the engine picks the texture donor), feather 0..1.
 */
RB_API void rb_heal(RBImage* image, const float* spots, size_t count, const float* strokes, size_t strokeCount);


// ---- RawBoy Packer (macOS builds only: dng_pack.cpp needs the Adobe DNG SDK; the iOS slices don't have these) ----

/** What a file is and what packing it did (rawboy::PackInfo); strings are NUL-terminated and may be empty. */
typedef struct {
    char make[64], model[64], lens[96], format[16];
    int width, height;
    bool dng, mosaic, bayer;
    char lensData[16];  // "Sony", "Fujifilm" or ""
    bool lensDistortion, lensVignetting, lensCa, adobeHints;
    int bits;
    char compression[48], dngVersion[16];
    // rb_pack only:
    int modeUsed;  // RBPackMode
    bool linear, lensWritten;
    char preview[16];  // "camera", "rendered", "none"
    int outWidth, outHeight;
    double seconds;
} RBPackInfo;

typedef enum { RB_PACK_LOSSLESS_JPEG = 0, RB_PACK_LOSSLESS_JXL = 1, RB_PACK_SMALL_RAW = 2, RB_PACK_MICRO = 3 } RBPackMode;

typedef struct {
    int mode;  // RBPackMode
    float distance;
    int effort, maxSize, previewSize;
    bool lensCorrections, keepGps;
    int threads;
} RBPackOptions;

/** Encodes 8-bit sRGB RGB as a JPEG: on success *jpeg is a malloc'd buffer (the packer frees it) and true is returned. */
typedef bool (*RBPreviewEncoder)(const uint8_t* rgb, int width, int height, uint8_t** jpeg, size_t* size, void* context);

/** Reads what [data] (a camera raw or a DNG) is without decoding the image. false with [error] when it can't. */
RB_API bool rb_pack_inspect(const uint8_t* data, size_t size, RBPackInfo* info, char* error, size_t errorSize);

/**
 * Packs [data] into a DNG: *out is a malloc'd buffer of *outSize bytes (free with rb_pack_free). Blocks until done
 * (seconds, 100+ MB of memory): run it on its own thread, with a big stack. false with [error] when it fails.
 */
RB_API bool rb_pack(const uint8_t* data, size_t size, const RBPackOptions* options, RBPreviewEncoder encoder, void* context,
                    uint8_t** out, size_t* outSize, RBPackInfo* info, char* error, size_t errorSize);

RB_API void rb_pack_free(uint8_t* buffer);

// ---- DNG preview embedding (RawBoy Camera; needs Adobe DNG SDK) ----

/**
 * Re-saves [dng] with [previewJpeg] (an upright sRGB JPEG) embedded as its primary DNG preview.
 * Returns 0 on success (*out is a malloc'd buffer of *outSize bytes, free with rb_dng_free),
 * 1 if unchanged, 2 if built without the Adobe DNG SDK, or -1 on error (with [error] populated).
 */
RB_API int rb_dng_embed_preview(const uint8_t* dng, size_t dngSize, const uint8_t* previewJpeg, size_t previewSize,
                                uint8_t** out, size_t* outSize, char* error, size_t errorSize);

RB_API void rb_dng_free(uint8_t* buffer);

#ifdef __cplusplus
}
#endif
