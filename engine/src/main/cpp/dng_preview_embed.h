// Shared Adobe DNG SDK helper for embedding an already-encoded sRGB JPEG as a DNG preview IFD.
// Used by both RawBoy Packer (dng_pack.cpp) and RawBoy Camera's DNG preview / lossy JXL writer (dng_transcode.cpp).
// This product includes DNG technology under license by Adobe.
// Licences: licenses/THIRD_PARTY_NOTICES.txt.
#pragma once

#include "dng_auto_ptr.h"
#include "dng_host.h"
#include "dng_preview.h"

#include <cstddef>
#include <cstdint>
#include <cstring>

namespace rawboy {

class ReadyJpegPreview : public dng_jpeg_preview {
public:
    void Setup(uint32 w, uint32 h, uint32 subH, uint32 subV) {
        fIFD.fNewSubFileType = sfPreviewImage;
        fIFD.fImageWidth = w;
        fIFD.fImageLength = h;
        fIFD.fSamplesPerPixel = 3;
        for (int i = 0; i < 3; ++i) {
            fIFD.fBitsPerSample[i] = 8;
            fIFD.fSampleFormat[i] = sfUnsignedInteger;
        }
        fIFD.SetSingleStrip();
        fIFD.fCompression = ccJPEG;
        SetYCbCr(subH, subV);
    }
};

/** Size and luma subsampling from a baseline/progressive 3-channel JPEG's SOF marker. */
inline bool parseJpegFrame(const uint8_t* d, size_t n, uint32& w, uint32& h, uint32& sh, uint32& sv) {
    if (!d || n < 4 || d[0] != 0xFF || d[1] != 0xD8) return false;
    for (size_t i = 2; i + 4 < n;) {
        if (d[i] != 0xFF) return false;
        while (i < n && d[i] == 0xFF) ++i;
        if (i >= n) return false;
        const int m = d[i++];
        if (m == 0xD9 || m == 0xDA) return false;  // EOI or SOS before SOF
        if (m == 0x01 || (m >= 0xD0 && m <= 0xD7)) continue;  // standalone markers
        if (i + 2 > n) return false;
        const size_t len = (size_t(d[i]) << 8) | d[i + 1];
        if (len < 2 || i + len > n) return false;
        if (m == 0xC0 || m == 0xC1 || m == 0xC2) {
            if (len < 11) return false;
            h = (uint32(d[i + 3]) << 8) | d[i + 4];
            w = (uint32(d[i + 5]) << 8) | d[i + 6];
            if (d[i + 7] != 3) return false;  // grey or CMYK previews: not as YCbCr
            sh = d[i + 9] >> 4;
            sv = d[i + 9] & 15;
            return w > 0 && h > 0 && sh > 0 && sv > 0;
        }
        i += len;
    }
    return false;
}

/**
 * Wraps an already-encoded sRGB JPEG (in the negative's native/sensor orientation, matching IFD0's Orientation tag)
 * as a primary DNG preview and appends it to [previews].
 */
inline bool appendJpegPreview(dng_host& host, const uint8_t* jpeg, size_t size, const char* appName,
                              dng_preview_list& previews) {
    uint32 w = 0, h = 0, sh = 1, sv = 1;
    if (!parseJpegFrame(jpeg, size, w, h, sh, sv)) return false;
    AutoPtr<ReadyJpegPreview> p(new ReadyJpegPreview);
    p->fInfo.fApplicationName.Set(appName);
    p->fInfo.fColorSpace = previewColorSpace_sRGB;
    p->fInfo.fIsPrimary = true;
    p->Setup(w, h, sh, sv);
    AutoPtr<dng_memory_block> block(host.Allocate(static_cast<uint32>(size)));
    std::memcpy(block->Buffer(), jpeg, size);
    p->SetCompressedData(block);
    AutoPtr<dng_preview> base(p.Release());
    previews.Append(base);
    return true;
}

}  // namespace rawboy
