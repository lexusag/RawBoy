// Re-saves a DNG as a lossy JPEG XL DNG (DNG 1.7.1, Bayer raw compressed by libjxl) through the Adobe DNG SDK.
// RawBoy Camera uses it on the uncompressed DNGs that Android's DngCreator writes (Settings: "Lossy JPEG XL").
// Compiled only when the SDK is present in third_party/dng_sdk.
// This product includes DNG technology under license by Adobe.
// Licences: licenses/THIRD_PARTY_NOTICES.txt.

#include "rawboy.h"

#include "dng_auto_ptr.h"
#include "dng_exceptions.h"
#include "dng_host.h"
#include "dng_image_writer.h"
#include "dng_info.h"
#include "dng_jxl.h"
#include "dng_memory_stream.h"
#include "dng_negative.h"
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

TranscodeResult transcodeToLossyJxlDng(const uint8_t* data, size_t size, float distance, int effort,
                                       std::vector<uint8_t>& out, std::string& error) {
    try {
        TranscodeHost host(distance, static_cast<uint32>(effort));
        host.SetSaveDNGVersion(dngVersion_SaveDefault);
        host.SetSaveLinearDNG(false);
        host.SetKeepOriginalFile(false);
        host.SetLossyMosaicJXL(true);

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
        negative->BuildStage2Image(host);

        // A DNG that isn't a 2x2 CFA mosaic (or is already lossy JPEG XL) is left as it is.
        if (!negative->NeedLossyCompressMosaicJXL(host)) return TranscodeResult::NotApplicable;

        negative->BuildStage3Image(host);

        dng_image_writer writer;
        negative->LossyCompressMosaicJXL(host, writer);
        if (!negative->RawLossyCompressedImage()) {
            error = "DNG SDK: lossy compression did not apply";
            return TranscodeResult::Failed;
        }

        dng_memory_stream outStream(host.Allocator());
        outStream.SetBigEndian(false);
        // No previews: the SDK build has no libjpeg to encode them (see dng_sdk.cmake).
        writer.WriteDNG(host, outStream, *negative.Get(), nullptr, dngVersion_SaveDefault, false);
        outStream.Flush();

        const uint64 length = outStream.Length();
        out.resize(static_cast<size_t>(length));
        outStream.SetReadPosition(0);
        outStream.Get(out.data(), static_cast<uint32>(length));
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

}  // namespace rawboy
