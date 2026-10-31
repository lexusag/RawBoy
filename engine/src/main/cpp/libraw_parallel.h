// LibRaw's single-threaded steps run on all cores. Android's LibRaw is built with OpenMP and runs its own parallel
// loops (demosaic, strip and plane decoding); the web's and iOS's have none, so there this class shares those out.

#pragma once

#include <libraw/libraw.h>

#include <memory>

namespace rawboy {

/**
 * LibRaw with RawBoy's processing steps hooked in, only through the extension points LibRaw offers for this (its
 * callbacks, virtual decode loops and lockable streams; LibRaw itself stays unmodified):
 * - Bayer AHD demosaic: LibRaw's own tile steps, tiles shared out over threads (as its OpenMP loop does);
 * - X-Trans demosaic: LibRaw's own Markesteijn on horizontal bands;
 * - Fujifilm compressed RAF: the file's vertical strips decoded side by side;
 * - Canon CR3: the colour planes decoded side by side;
 * - white balance scaling in bands (all platforms; LibRaw runs it on one thread even with OpenMP), and no histogram
 *   (it only feeds auto brightness, which RawBoy turns off).
 */
class RawBoyLibRaw : public LibRaw {
public:
    RawBoyLibRaw();
    ~RawBoyLibRaw() override;

    /** LibRaw::open_buffer through a stream whose reads several decoder threads can take turns at. */
    int openBuffer(const void* data, size_t size);

protected:
    void scale_colors_loop(float scaleMul[4]) override;
    void convert_to_rgb_loop(float outCam[3][4]) override;
#ifndef _OPENMP
    void fuji_decode_loop(::fuji_compressed_params* params, int count, INT64* offsets, unsigned* sizes,
                          uchar* qBases) override;
    void crxLoadDecodeLoop(void* image, int planes) override;

private:
    static void interpolateBayer(void* self);
    void parallelAhd();
#endif

private:
    std::unique_ptr<LibRaw_abstract_datastream> stream_;
};

}  // namespace rawboy
