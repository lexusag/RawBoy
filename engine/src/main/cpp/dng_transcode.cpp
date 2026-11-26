// Re-saves a DNG through the Adobe DNG SDK, optionally compressing a 2x2 Bayer mosaic as lossy JPEG XL (DNG 1.7.1,
// RawBoy Camera Settings: "Lossy JPEG XL") and/or embedding an already-encoded upright sRGB JPEG preview (RawBoy
// Camera's developed look preview). Compiled only when the SDK is present in third_party/dng_sdk.
// This product includes DNG technology under license by Adobe.
// Licences: licenses/THIRD_PARTY_NOTICES.txt.

#include "dng_preview_embed.h"
#include "rawboy.h"

#include "dng_auto_ptr.h"
#include "dng_exceptions.h"
#include "dng_host.h"
#include "dng_image_writer.h"
#include "dng_info.h"
#include "dng_jxl.h"
#include "dng_memory_stream.h"
#include "dng_negative.h"
#include "dng_preview.h"
#include "dng_stream.h"

#include <cstring>
#include <new>

namespace rawboy {

namespace {

/** A DNG SDK host that encodes the lossy mosaic with the distance and effort asked for. */
class TranscodeHost : public dng_host {
public:
    TranscodeHost(float distance, uint32 effort) : mDistance(distance), mEffort(effort) {}

    dng_jxl_encode_settings* MakeJXLEncodeSettings(use_case_enum useCase, const dng_image& image,
                                                   const dng_negative* negative) const override {
        dng_jxl_encode_settings* settings = dng_host::MakeJXLEncodeSettings(useCase, image, negative);
        if (useCase == use_case_LossyMosaic) {
            settings->SetDistance(mDistance);
            settings->SetEffort(mEffort);
        }
        return settings;
    }

private:
    float mDistance;
    uint32 mEffort;
};

}  // namespace

TranscodeResult rewriteDng(const uint8_t* data, size_t size, bool lossyJxl, float distance, int effort,
                           const uint8_t* previewJpeg, size_t previewSize, std::vector<uint8_t>& out,
                           std::string& error) {
    const bool wantPreview = previewJpeg != nullptr && previewSize > 0;
    if (!lossyJxl && !wantPreview) return TranscodeResult::NotApplicable;
    try {
        TranscodeHost host(distance, static_cast<uint32>(effort));
        host.SetSaveDNGVersion(dngVersion_SaveDefault);
        host.SetSaveLinearDNG(false);
        host.SetKeepOriginalFile(false);
        host.SetLossyMosaicJXL(lossyJxl);

        dng_stream stream(data, static_cast<uint32>(size));
        dng_info info;
        info.Parse(host, stream);
        info.PostParse(host);
        if (!info.IsValidDNG()) {
            error = "not a DNG";
            return TranscodeResult::Failed;
        }

        AutoPtr<dng_negative> negative(host.Make_dng_negative());
        negative->Parse(host, stream, info);
        negative->PostParse(host, stream, info);
        negative->ReadStage1Image(host, stream, info);
        negative->SynchronizeMetadata();

        dng_image_writer writer;
        bool compressed = false;
        if (lossyJxl) {
            negative->BuildStage2Image(host);
            // A DNG that isn't a 2x2 CFA mosaic (or is already lossy JPEG XL) skips lossy compression; if no preview
            // was requested either, leave the original file untouched.
            if (negative->NeedLossyCompressMosaicJXL(host)) {
                negative->BuildStage3Image(host);
                negative->LossyCompressMosaicJXL(host, writer);
                if (!negative->RawLossyCompressedImage()) {
                    error = "DNG SDK: lossy compression did not apply";
                    return TranscodeResult::Failed;
                }
                compressed = true;
            }
        }

        dng_preview_list previews;
        bool previewAdded = false;
        if (wantPreview) {
            previewAdded = appendJpegPreview(host, previewJpeg, previewSize, "RawBoy Camera", previews);
        }

        if (!compressed && !previewAdded) return TranscodeResult::NotApplicable;

        dng_memory_stream outStream(host.Allocator());
        outStream.SetBigEndian(false);
        writer.WriteDNG(host, outStream, *negative.Get(), previewAdded ? &previews : nullptr, dngVersion_SaveDefault,
                        false);
        outStream.Flush();

        const uint64 length = outStream.Length();
        out.resize(static_cast<size_t>(length));
        outStream.SetReadPosition(0);
        outStream.Get(out.data(), static_cast<uint32>(length));
        copyDngDepthTrailer(data, size, out);
        return TranscodeResult::Done;
    } catch (const dng_exception& e) {
        error = "DNG SDK error " + std::to_string(e.ErrorCode());
    } catch (const std::bad_alloc&) {
        error = "DNG SDK: out of memory";
    } catch (...) {
        error = "DNG SDK: unknown error";
    }
    return TranscodeResult::Failed;
}

TranscodeResult transcodeToLossyJxlDng(const uint8_t* data, size_t size, float distance, int effort,
                                       std::vector<uint8_t>& out, std::string& error) {
    return rewriteDng(data, size, true, distance, effort, nullptr, 0, out, error);
}

}  // namespace rawboy
