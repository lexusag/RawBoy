// Re-saves a DNG as a lossy JPEG XL DNG on the host: dng_jxl_test in.dng out.dng [distance].
// Then parses the result again and reports the main image's compression.
#include "rawboy.h"

#include "dng_host.h"
#include "dng_ifd.h"
#include "dng_info.h"
#include "dng_stream.h"

#include <cstdio>
#include <cstdlib>
#include <fstream>
#include <iterator>
#include <vector>

int main(int argc, char** argv) {
    if (argc < 3) {
        std::fprintf(stderr, "usage: %s in.dng out.dng [distance]\n", argv[0]);
        return 2;
    }
    std::ifstream in(argv[1], std::ios::binary);
    std::vector<uint8_t> data((std::istreambuf_iterator<char>(in)), std::istreambuf_iterator<char>());
    const float distance = argc > 3 ? static_cast<float>(std::atof(argv[3])) : 0.2f;

    std::vector<uint8_t> out;
    std::string error;
    const auto r = rawboy::transcodeToLossyJxlDng(data.data(), data.size(), distance, 5, out, error);
    if (r == rawboy::TranscodeResult::NotApplicable) {
        std::printf("not applicable\n");
        return 0;
    }
    if (r == rawboy::TranscodeResult::Failed) {
        std::printf("FAILED: %s\n", error.c_str());
        return 1;
    }
    std::ofstream(argv[2], std::ios::binary).write(reinterpret_cast<const char*>(out.data()), out.size());
    std::printf("%zu -> %zu bytes (%.1f%%)\n", data.size(), out.size(), 100.0 * out.size() / data.size());

    dng_host host;
    dng_stream stream(out.data(), static_cast<uint32>(out.size()));
    dng_info info;
    info.Parse(host, stream);
    info.PostParse(host);
    std::printf("valid DNG: %d, big endian: %d, ifds: %zu\n", info.IsValidDNG(), stream.BigEndian(), info.fIFD.size());
    if (info.fMainIndex >= 0) {
        const dng_ifd& ifd = *info.fIFD[info.fMainIndex];
        std::printf("main: %ux%u compression %u photometric %u\n", ifd.fImageWidth, ifd.fImageLength, ifd.fCompression,
                    ifd.fPhotometricInterpretation);
    }
    return info.IsValidDNG() ? 0 : 1;
}
