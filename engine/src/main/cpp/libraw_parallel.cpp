// See libraw_parallel.h. LibRaw's AHD tile steps are only declared for its own build (LIBRAW_LIBRARY_BUILD), which
// adds member function declarations to LibRaw and nothing else; this file uses them as LibRaw's OpenMP loop does.
#define LIBRAW_LIBRARY_BUILD
#include "libraw_parallel.h"

#include "rawboy.h"

#include <algorithm>
#include <atomic>
#include <cstring>
#include <exception>
#include <mutex>
#include <thread>
#include <vector>

namespace rawboy {
namespace {

/** LibRaw's buffer stream with lock()/unlock(), which LibRaw's strip and plane decoders take around every read. */
class LockedBufferStream : public LibRaw_buffer_datastream {
public:
    using LibRaw_buffer_datastream::LibRaw_buffer_datastream;
    int lock() override {
        mutex_.lock();
        return 1;
    }
    void unlock() override { mutex_.unlock(); }

private:
    std::mutex mutex_;
};

int taskThreads(int tasks) {
    return std::max(1, std::min({8, tasks, static_cast<int>(std::thread::hardware_concurrency())}));
}

/**
 * Runs task(i, worker) for i in [0, count) on [workers] threads, each taking the next task when it is done (tiles and
 * strips differ in cost). The first exception is rethrown once all threads are done: dcraw_process and unpack turn
 * LibRaw's exceptions into its error codes.
 */
template <typename Fn>
void runTasks(int count, int workers, Fn&& task) {
    std::atomic<int> next{0};
    std::mutex errorLock;
    std::exception_ptr error;
    auto work = [&](int worker) {
        for (int i; (i = next.fetch_add(1)) < count;) {
            try {
                task(i, worker);
            } catch (...) {
                std::lock_guard<std::mutex> lock(errorLock);
                if (!error) error = std::current_exception();
                next = count;  // the others stop after their current task
            }
        }
    };
    std::vector<std::thread> pool;
    for (int t = 1; t < workers; ++t) pool.emplace_back(work, t);
    work(0);
    for (auto& th : pool) th.join();
    if (error) std::rethrow_exception(error);
}

/** Rows [first, last) of another LibRaw's image, for LibRaw's own per-image loops. */
class ImageRows : public LibRaw {
public:
    ImageRows(const libraw_data_t& data, int first, int last) {
        imgdata.sizes = data.sizes;
        imgdata.sizes.height = imgdata.sizes.iheight = static_cast<ushort>(last - first);
        std::memcpy(imgdata.color.cblack, data.color.cblack, sizeof imgdata.color.cblack);
        imgdata.idata.colors = data.idata.colors;
        imgdata.image = data.image + static_cast<size_t>(first) * data.sizes.iwidth;
    }
    ~ImageRows() override { imgdata.image = nullptr; }  // borrowed
    void scaleColors(float scaleMul[4]) { LibRaw::scale_colors_loop(scaleMul); }
};

#ifndef _OPENMP
/**
 * Fuji X-Trans demosaic (LibRaw's 3-pass Markesteijn): 14.6 s on one thread for a 26 MP frame vs 2.4 s for AHD on a
 * Bayer frame of the same size (x86, -O3).
 *
 * The frame is cut into horizontal bands with kMargin rows of context on each side; each band is demosaiced by
 * LibRaw's own xtrans_interpolate on a private copy (a LibRaw instance that only holds the band), and its inner rows
 * are written back. Margins come from a snapshot taken before any band runs, so every band sees the raw CFA data.
 * Bands start on multiples of 6, so the 6×6 X-Trans pattern (and its 3-row green phase) is the same in every band.
 * LibRaw's tiles look at most 8 + 3 rows past what they write, so 36 rows of context leave the inner rows as a
 * single pass computes them, except where LibRaw's own tile seams fall (its tiles read rows their neighbour has
 * already written, which OpenMP's order changes as well).
 */
class XTransBand : public LibRaw {
public:
    void demosaic(const LibRaw& full, ushort (*band)[4], int rows, int passes) {
        imgdata.sizes.width = full.imgdata.sizes.width;
        imgdata.sizes.height = static_cast<ushort>(rows);
        imgdata.sizes.iwidth = imgdata.sizes.width;
        imgdata.sizes.iheight = imgdata.sizes.height;
        imgdata.idata.filters = 9;
        imgdata.idata.colors = full.imgdata.idata.colors;
        std::memcpy(imgdata.idata.xtrans, full.imgdata.idata.xtrans, sizeof imgdata.idata.xtrans);
        std::memcpy(imgdata.color.rgb_cam, full.imgdata.color.rgb_cam, sizeof imgdata.color.rgb_cam);
        imgdata.image = band;
        try {
            xtrans_interpolate(passes);
        } catch (...) {
            imgdata.image = nullptr;  // the band belongs to the caller
            throw;
        }
        imgdata.image = nullptr;
    }
};

void parallelXTrans(void* ctx) {
    constexpr int kMargin = 36;      // context rows on each side of a band; a multiple of 6
    constexpr int kMinRows = 500;    // band rows written; LibRaw needs at least LIBRAW_AHD_TILE (512) with margins
    auto& raw = *static_cast<LibRaw*>(ctx);
    const int w = raw.imgdata.sizes.width;
    const int h = raw.imgdata.sizes.height;
    const int passes = raw.imgdata.params.user_qual > 2 ? 3 : 1;  // as dcraw_process would ask
    const int bands = std::min(taskThreads(h), h / kMinRows);
    ushort(*image)[4] = raw.imgdata.image;
    if (bands < 2) {
        XTransBand().demosaic(raw, image, h, passes);
        return;
    }
    // Band k writes rows [starts[k], starts[k + 1]).
    std::vector<int> starts(bands + 1);
    for (int k = 0; k <= bands; ++k) starts[k] = k == bands ? h : (h * k / bands) / 6 * 6;
    // The CFA rows around each inner boundary, before any band overwrites them. 4 values per pixel, as LibRaw's image.
    using Pixel = ushort[4];
    const size_t rowValues = static_cast<size_t>(w) * 4;
    const ushort* src = image[0];
    std::vector<std::vector<ushort>> seams(bands);
    for (int k = 1; k < bands; ++k)
        seams[k].assign(src + (starts[k] - kMargin) * rowValues, src + (starts[k] + kMargin) * rowValues);
    runTasks(bands, bands, [&](int k, int) {
        const int top = k == 0 ? 0 : starts[k] - kMargin;
        const int bottom = k == bands - 1 ? h : starts[k + 1] + kMargin;
        std::vector<ushort> band(static_cast<size_t>(bottom - top) * rowValues);
        // Inner rows from the image (only this band writes them), margins from the seams.
        const int innerTop = k == 0 ? 0 : starts[k] + kMargin;
        const int innerBottom = k == bands - 1 ? h : starts[k + 1] - kMargin;
        if (k > 0) std::copy(seams[k].begin(), seams[k].end(), band.begin());
        std::copy(src + innerTop * rowValues, src + innerBottom * rowValues, band.begin() + (innerTop - top) * rowValues);
        if (k < bands - 1)
            std::copy(seams[k + 1].begin(), seams[k + 1].end(), band.begin() + (innerBottom - top) * rowValues);
        auto lib = std::make_unique<XTransBand>();  // LibRaw is large; keep it off the stack
        lib->demosaic(raw, reinterpret_cast<Pixel*>(band.data()), bottom - top, passes);
        std::copy(band.begin() + (starts[k] - top) * rowValues, band.begin() + (starts[k + 1] - top) * rowValues,
                  image[0] + starts[k] * rowValues);
    });
}

/**
 * Decodes Fujifilm compressed strips for another LibRaw: LibRaw's allocator bookkeeping is only thread safe with
 * OpenMP, so each thread decodes through an instance of its own, sharing the file stream (locked) and the raw image
 * (strips write their own columns).
 */
class FujiStrips : public LibRaw {
public:
    FujiStrips(const libraw_internal_data_t& internal, const libraw_data_t& data) {
        libraw_internal_data.unpacker_data = internal.unpacker_data;
        libraw_internal_data.internal_data.input = internal.internal_data.input;
        imgdata.sizes = data.sizes;
        imgdata.idata.filters = data.idata.filters;
        imgdata.idata.colors = data.idata.colors;
        std::memcpy(imgdata.idata.xtrans_abs, data.idata.xtrans_abs, sizeof imgdata.idata.xtrans_abs);
        imgdata.rawdata.raw_image = data.rawdata.raw_image;
    }
    ~FujiStrips() override {
        // Borrowed: recycle() must not free them.
        libraw_internal_data.internal_data.input = nullptr;
        imgdata.rawdata.raw_image = nullptr;
    }
    void decode(::fuji_compressed_params* params, int block, INT64 offset, unsigned size, uchar* qBases) {
        fuji_decode_strip(params, block, offset, size, qBases);
    }
    int dataErrors() const { return libraw_internal_data.unpacker_data.data_error; }
};
#endif

}  // namespace

RawBoyLibRaw::RawBoyLibRaw() {
#ifndef _OPENMP
    callbacks.interpolate_bayer_cb = interpolateBayer;
    callbacks.interpolate_xtrans_cb = parallelXTrans;
#endif
}

RawBoyLibRaw::~RawBoyLibRaw() {
    recycle();  // while stream_ still exists
}

int RawBoyLibRaw::openBuffer(const void* data, size_t size) {
    // As LibRaw::open_buffer, except that the stream is ours (LibRaw doesn't delete streams it didn't create).
    if (!data) return LIBRAW_IO_ERROR;
    if (size > static_cast<size_t>(LIBRAW_MAX_DNG_RAW_FILE_SIZE) &&
        size > static_cast<size_t>(LIBRAW_MAX_NONDNG_RAW_FILE_SIZE))
        return LIBRAW_TOO_BIG;
    recycle();
    stream_ = std::make_unique<LockedBufferStream>(data, size);
    if (!stream_->valid()) return LIBRAW_IO_ERROR;
    return open_datastream(stream_.get());
}

void RawBoyLibRaw::scale_colors_loop(float scaleMul[4]) {
    // Bands start on a multiple of the black level pattern's height (cblack[4]), which LibRaw indexes from row 0.
    const int rows = imgdata.sizes.iheight;
    const int period = imgdata.color.cblack[4] && imgdata.color.cblack[5] ? imgdata.color.cblack[4] : 1;
    const int bands = std::min(taskThreads(rows), rows / 256);
    if (bands < 2) {
        LibRaw::scale_colors_loop(scaleMul);
        return;
    }
    runTasks(bands, bands, [&](int k, int) {
        const int first = rows * k / bands / period * period;
        const int last = k == bands - 1 ? rows : rows * (k + 1) / bands / period * period;
        ImageRows(imgdata, first, last).scaleColors(scaleMul);
    });
}

void RawBoyLibRaw::convert_to_rgb_loop(float outCam[3][4]) {
    // Camera RGB out (output_color 0) leaves only LibRaw's histogram to build, for auto brightness: skipped when that's
    // off (it took 0.3 s on a 50 MP frame).
    if (libraw_internal_data.internal_output_params.raw_color && imgdata.params.no_auto_bright) {
        std::memset(libraw_internal_data.output_data.histogram, 0, sizeof(int) * LIBRAW_HISTOGRAM_SIZE * 4);
        return;
    }
    LibRaw::convert_to_rgb_loop(outCam);
}

#ifndef _OPENMP
void RawBoyLibRaw::fuji_decode_loop(::fuji_compressed_params* params, int count, INT64* offsets, unsigned* sizes,
                                    uchar* qBases) {
    // GFX 50R: 11 strips of 768 columns, ~0.3 s each on one thread.
    const int lineStep = (libraw_internal_data.unpacker_data.fuji_total_lines + 0xF) & ~0xF;
    const int workers = taskThreads(count);
    std::vector<std::unique_ptr<FujiStrips>> decoders;
    for (int t = 0; t < workers; ++t)
        decoders.push_back(std::make_unique<FujiStrips>(libraw_internal_data, imgdata));
    runTasks(count, workers, [&](int block, int worker) {
        decoders[worker]->decode(params, block, offsets[block], sizes[block], qBases ? qBases + block * lineStep : nullptr);
    });
    for (const auto& d : decoders) libraw_internal_data.unpacker_data.data_error += d->dataErrors();
}

void RawBoyLibRaw::crxLoadDecodeLoop(void* image, int planes) {
    // One task per colour plane (4 for Bayer CR3), as LibRaw's OpenMP loop; the planes only share the locked stream.
    int failed[4] = {0, 0, 0, 0};
    const int n = std::min(planes, 4);
    runTasks(n, taskThreads(n), [&](int plane, int) {
        try {
            failed[plane] = crxDecodePlane(image, static_cast<uint32_t>(plane));
        } catch (...) {
            failed[plane] = 1;
        }
    });
    for (int plane = 0; plane < n; ++plane)
        if (failed[plane]) derror();
}

void RawBoyLibRaw::interpolateBayer(void* self) {
    auto& raw = *static_cast<RawBoyLibRaw*>(self);
    // dcraw_process's own choice for the quality RawBoy asks for (user_qual 3): VNG for four-colour sensors, else AHD.
    if (raw.imgdata.idata.colors > 3)
        raw.vng_interpolate();
    else
        raw.parallelAhd();
}

void RawBoyLibRaw::parallelAhd() {
    // LibRaw's ahd_interpolate, with its tiles shared out over threads one by one (its OpenMP loop hands out rows of
    // tiles: 12 for a 50 MP frame). Tiles read only each pixel's own CFA colour from the image and write disjoint
    // pixels, so the result doesn't depend on their order. A tile also reads a few pixels into its neighbours, whose
    // writes leave those values as they were; tiles run in four rounds (by row and column parity), so neighbours never
    // run at the same time and no pixel is read while it is written.
    constexpr int T = LIBRAW_AHD_TILE;
    const int height = imgdata.sizes.height;
    const int width = imgdata.sizes.width;
    cielab(nullptr, nullptr);
    border_interpolate(5);
    std::vector<std::pair<int, int>> rounds[4];
    for (int top = 2, i = 0; top < height - 5; top += T - 6, ++i)
        for (int left = 2, j = 0; left < width - 5; left += T - 6, ++j) rounds[(i % 2) * 2 + j % 2].emplace_back(top, left);
    const int workers = taskThreads(static_cast<int>(rounds[0].size()));
    std::vector<std::vector<char>> buffers(workers, std::vector<char>(26 * T * T));  // as LibRaw's per-thread buffer
    for (const auto& tiles : rounds)
        runTasks(static_cast<int>(tiles.size()), workers, [&](int i, int worker) {
            const auto [top, left] = tiles[i];
            char* buffer = buffers[worker].data();
            auto rgb = reinterpret_cast<ushort(*)[T][T][3]>(buffer);
            auto lab = reinterpret_cast<short(*)[T][T][3]>(buffer + 12 * T * T);
            auto homo = reinterpret_cast<char(*)[T][2]>(buffer + 24 * T * T);
            ahd_interpolate_green_h_and_v(top, left, rgb);
            ahd_interpolate_r_and_b_and_convert_to_cielab(top, left, rgb, lab);
            ahd_interpolate_build_homogeneity_map(top, left, lab, homo);
            ahd_interpolate_combine_homogeneous_pixels(top, left, rgb, homo);
        });
}
#endif

}  // namespace rawboy
