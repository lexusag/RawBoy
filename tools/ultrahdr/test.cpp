// Host harness for engine/src/main/cpp/ultrahdr.h (see run.sh):
//   test map W H out.pgm          gain map of a synthetic picture (left to right ramp, black to white, in bands of 7 rows)
//   test assemble primary gain out   the Ultra HDR container around two JPEG files
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <fstream>
#include <iterator>

#include "../../engine/src/main/cpp/ultrahdr.h"

static std::vector<uint8_t> readAll(const char* path) {
    std::ifstream f(path, std::ios::binary);
    return {std::istreambuf_iterator<char>(f), std::istreambuf_iterator<char>()};
}

int main(int argc, char** argv) {
    if ((argc == 5 || argc == 6) && !strcmp(argv[1], "map")) {
        const int w = atoi(argv[2]), h = atoi(argv[3]);
        const float whiteY = argc == 6 ? float(atof(argv[5])) : 1.0f;
        rawboy::uhdr::GainMapBuilder b(w, h, whiteY);
        std::vector<uint16_t> band(size_t(w) * 7 * 3);
        for (int y = 0; y < h; y += 7) {
            const int rows = std::min(7, h - y);
            for (int r = 0; r < rows; ++r)
                for (int x = 0; x < w; ++x)
                    for (int c = 0; c < 3; ++c) band[(size_t(r) * w + x) * 3 + c] = uint16_t(65535.0 * whiteY * x / (w - 1));
            b.addRows(band.data(), rows);
        }
        const auto m = b.finish();
        FILE* f = fopen(argv[4], "wb");
        fprintf(f, "P5\n%d %d\n255\n", b.mapWidth(), b.mapHeight());
        fwrite(m.data(), 1, m.size(), f);
        fclose(f);
        return 0;
    }
    if (argc == 5 && !strcmp(argv[1], "assemble")) {
        const auto out = rawboy::uhdr::assemble(readAll(argv[2]), readAll(argv[3]));
        if (out.empty()) { fprintf(stderr, "assemble failed\n"); return 1; }
        FILE* f = fopen(argv[4], "wb");
        fwrite(out.data(), 1, out.size(), f);
        fclose(f);
        return 0;
    }
    return 2;
}
