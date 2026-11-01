#pragma once

// RawBoy Packer: camera raws (through LibRaw) and DNGs re-saved as DNG 1.7 through the Adobe DNG SDK.
// Only built with the SDK (RAWBOY_WITH_DNG_SDK). This product includes DNG technology under license by Adobe.

#include <cstddef>
#include <cstdint>
#include <functional>
#include <string>
#include <vector>

namespace rawboy {

enum class PackMode {
    LosslessJpeg,  // raw data, lossless JPEG (DNG 1.4): bit-exact, opens everywhere
    LosslessJxl,   // raw data, lossless JPEG XL (DNG 1.7): bit-exact, Adobe and RawBoy only
    SmallRaw,      // raw data, lossy JPEG XL (DNG 1.7.1); non-Bayer sources become full-size linear
    Micro,         // demosaiced (linear) and downscaled to maxSize, lossy JPEG XL
};

struct PackOptions {
    PackMode mode = PackMode::SmallRaw;
    float distance = 0.2f;  // libjxl distance for the lossy modes
    int effort = 5;         // libjxl effort 1..9
    int maxSize = 4000;     // Micro: long side in pixels
    int previewSize = 1024; // rendered previews' long side (when the camera's JPEG can't be used); 0 = no preview
    bool lensCorrections = true;
    bool keepGps = true;
    int threads = 4;
};

/** What a file is, and what packing it does: for the UI's summary (inspect) and the result (pack). */
struct PackInfo {
    std::string make, model, lens, format;  // format: "ARW", "RAF", "DNG"...
    int width = 0, height = 0;
    bool dng = false;      // the source is a DNG (re-encoded through the SDK)
    bool mosaic = true;    // the source holds raw CFA data (false: linear, e.g. iPhone ProRAW)
    bool bayer = true;     // 2x2 CFA (false: X-Trans and others)
    std::string lensData;  // "Sony", "Fujifilm" (corrections in the file), "" (none)
    bool lensDistortion = false, lensVignetting = false, lensCa = false;
    bool adobeHints = false;  // Adobe's BaselineSharpness/Exposure known for this camera
    // pack() only:
    PackMode modeUsed = PackMode::SmallRaw;
    bool linear = false;        // the output is demosaiced
    bool lensWritten = false;   // corrections written as DNG opcodes
    std::string preview;        // "camera", "rendered", "none"
    int outWidth = 0, outHeight = 0;
    double seconds = 0;
};

/** Encodes 8-bit sRGB RGB ([width] x [height]) as a JPEG; returns false when it can't. */
using PreviewEncoder = std::function<bool(const uint8_t* rgb, int width, int height, std::vector<uint8_t>& jpeg)>;

/** Reads what [data] is without decoding the image (fast). */
bool inspectForPacking(const uint8_t* data, size_t size, PackInfo& info, std::string& error);

/** Packs [data] (a camera raw or a DNG) into a DNG in [out]. */
bool packDng(const uint8_t* data, size_t size, const PackOptions& options, const PreviewEncoder& encodePreview,
             std::vector<uint8_t>& out, PackInfo& info, std::string& error);

}  // namespace rawboy
