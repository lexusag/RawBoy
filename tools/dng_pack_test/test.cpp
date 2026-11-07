// Small raw (lossy JPEG XL DNG) packed as Lossless (Maximum compatibility): dng_pack_test in.dng.
//
// The lossy mosaic is stored in a non-linear encoding that its OpcodeList2 undoes. The Lossless output (DNG 1.4) must
// hold the decoded, linear pixels and no such opcode: Apple Photos and older software ignore it there, so keeping it
// rendered the picture washed out and magenta. Checks the output's compression, that OpcodeList2 is gone and that its
// raw pixels equal the source's with the opcodes applied.
#include "dng_pack.h"
#include "rawboy.h"

#include "dng_host.h"
#include "dng_ifd.h"
#include "dng_image.h"
#include "dng_info.h"
#include "dng_negative.h"
#include "dng_pixel_buffer.h"
#include "dng_stream.h"

#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <fstream>
#include <iterator>
#include <vector>

namespace {

int failures = 0;
void check(bool ok, const char* what) {
    std::printf("%s: %s\n", ok ? "ok  " : "FAIL", what);
    if (!ok) failures++;
}

// The mean of a 16-bit single-plane image over every 7th row (enough to tell a tone curve from its inverse).
double meanOf(const dng_image& image) {
    const dng_rect b = image.Bounds();
    double sum = 0;
    uint64_t count = 0;
    std::vector<uint16> row(b.W());
    for (int32 y = b.t; y < b.b; y += 7) {
        dng_pixel_buffer buf(dng_rect(y, b.l, y + 1, b.r), 0, 1, ttShort, pcInterleaved, row.data());
        buf.fRowStep = static_cast<int32>(b.W());
        image.Get(buf);
        for (uint16 v : row) sum += v;
        count += row.size();
    }
    return sum / static_cast<double>(count);
}

struct Parsed {
    dng_host host;
    dng_info info;
    AutoPtr<dng_negative> negative;
    const dng_ifd* ifd = nullptr;
    Parsed(const std::vector<uint8_t>& data) {
        host.SetSaveDNGVersion(dngVersion_SaveDefault);
        host.SetSaveLinearDNG(false);
        host.SetKeepOriginalFile(false);
        dng_stream stream(data.data(), static_cast<uint32>(data.size()));
        info.Parse(host, stream);
        info.PostParse(host);
        ifd = info.fIFD[info.fMainIndex];
        negative.Reset(host.Make_dng_negative());
        negative->Parse(host, stream, info);
        negative->PostParse(host, stream, info);
        negative->ReadStage1Image(host, stream, info);
    }
};

}  // namespace

int main(int argc, char** argv) {
    if (argc < 2) {
        std::fprintf(stderr, "usage: %s in.dng\n", argv[0]);
        return 2;
    }
    std::ifstream in(argv[1], std::ios::binary);
    std::vector<uint8_t> source((std::istreambuf_iterator<char>(in)), std::istreambuf_iterator<char>());

    rawboy::PackInfo probe;
    std::string error;
    if (!rawboy::inspectForPacking(source.data(), source.size(), probe, error)) {
        std::printf("FAIL: not readable: %s\n", error.c_str());
        return 1;
    }
    if (probe.compression != "lossy JPEG XL") {
        std::vector<uint8_t> small;
        const auto r = rawboy::transcodeToLossyJxlDng(source.data(), source.size(), 0.2f, 3, small, error);
        if (r != rawboy::TranscodeResult::Done) {
            std::printf("FAIL: could not make a Small raw of the input (%s)\n", error.c_str());
            return 1;
        }
        source.swap(small);
    }

    Parsed src(source);
    check(src.ifd->fCompression == ccJXL && src.ifd->fJXLDistance > 0.0f, "source is a lossy JPEG XL DNG");
    check(src.ifd->fOpcodeList2Count > 0, "source has an OpcodeList2 (the lossy mosaic's tone curve)");
    // Reference: the source's raw pixels with its opcodes applied.
    const double encoded = meanOf(*src.negative->Stage1Image());
    src.negative->OpcodeList2().SetAlwaysApply();  // what the Packer does: build the stage with the list applied
    src.negative->SynchronizeMetadata();
    src.negative->BuildStage2Image(src.host);
    const double reference = meanOf(*src.negative->Stage2Image());
    std::printf("source mean: encoded %.1f, linear %.1f\n", encoded, reference);
    check(std::fabs(encoded - reference) > 0.05 * reference, "the stored pixels are not linear");

    rawboy::PackOptions options;
    options.mode = rawboy::PackMode::LosslessJpeg;
    options.previewSize = 0;
    std::vector<uint8_t> packed;
    rawboy::PackInfo info;
    if (!rawboy::packDng(source.data(), source.size(), options, nullptr, packed, info, error)) {
        std::printf("FAIL: packDng: %s\n", error.c_str());
        return 1;
    }

    Parsed out(packed);
    check(out.ifd->fCompression == ccJPEG, "output is lossless JPEG");
    check(out.ifd->fOpcodeList2Count == 0, "output has no OpcodeList2");
    const double packedMean = meanOf(*out.negative->Stage1Image());
    std::printf("output mean: %.1f\n", packedMean);
    check(std::fabs(packedMean - reference) < 0.01 * reference, "output pixels are the source's with the opcodes applied");
    return failures ? 1 : 0;
}
