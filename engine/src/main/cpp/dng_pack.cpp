// RawBoy Packer (see dng_pack.h): a camera raw (LibRaw: mosaic, levels, colour, EXIF, in-camera lens data) or a DNG
// (the DNG SDK's own parser) becomes a dng_negative, which the DNG SDK writes as DNG 1.7.
// This product includes DNG technology under license by Adobe.
// Licences: licenses/THIRD_PARTY_NOTICES.txt.

#include "dng_pack.h"

#include "camera_lens_data.h"
#include "libraw_parallel.h"
#include "rawboy.h"

#include <stdexcept>

#include "dng_area_task.h"
#include "dng_auto_ptr.h"
#include "dng_camera_profile.h"
#include "dng_color_space.h"
#include "dng_exceptions.h"
#include "dng_exif.h"
#include "dng_host.h"
#include "dng_image_writer.h"
#include "dng_info.h"
#include "dng_jxl.h"
#include "dng_lens_correction.h"
#include "dng_memory_stream.h"
#include "dng_negative.h"
#include "dng_orientation.h"
#include "dng_pixel_buffer.h"
#include "dng_preview.h"
#include "dng_render.h"
#include "dng_simple_image.h"
#include "dng_stream.h"

#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstring>
#include <ctime>
#include <exception>
#include <memory>
#include <mutex>
#include <new>
#include <thread>

namespace rawboy {

namespace {

// ---- Adobe's per-camera rendering hints ----

/**
 * BaselineSharpness and BaselineExposure from Adobe's own DNGs of these cameras (Lightroom's Convert to DNG, read
 * 2026-11-01). Lightroom scales its default sharpening and exposure by them, so without them a Packer DNG opens softer
 * and darker than the camera's raw. Keyed by LibRaw's normalised "make model" (= DNG UniqueCameraModel).
 */
struct AdobeHints {
    const char* camera;
    double sharpness, exposure;
};
constexpr AdobeHints kAdobeHints[] = {
    {"Fujifilm GFX 50R", 1.9, 0.22},
    {"Sony ILCE-7M3", 1.33, 0.35},
    {"Sony NEX-3", 1.2, 0.35},
    {"Olympus E-PL9", 1.5, 0.5},
    {"Sony ILCE-7CM2", 1.33, 0.35},
    {"Canon EOS RP", 1.25, -0.17},
    {"Canon EOS 6D", 1.25, 0.25},
    {"Fujifilm X-T1", 1.33, 0.15},
    {"Fujifilm X-E5", 1.1, 2.02},
    {"Fujifilm X-T5", 1.1, 0.02},
};

const AdobeHints* adobeHintsFor(const std::string& camera) {
    for (const auto& h : kAdobeHints)
        if (camera == h.camera) return &h;
    return nullptr;
}

// ---- Host: options, threads ----

thread_local bool tInAreaTask = false;

class PackHost : public dng_host {
public:
    explicit PackHost(const PackOptions& o) : options_(o), threads_(static_cast<uint32>(std::max(1, o.threads))) {}

    dng_jxl_encode_settings* MakeJXLEncodeSettings(use_case_enum useCase, const dng_image& image,
                                                   const dng_negative* negative) const override {
        dng_jxl_encode_settings* s = dng_host::MakeJXLEncodeSettings(useCase, image, negative);
        if (useCase == use_case_LossyMosaic || useCase == use_case_ProxyImage || useCase == use_case_MainImage ||
            // A full-size linear DNG (X-Trans Small raw) is encoded as the main image, never lossless there.
            (useCase == use_case_EncodedMainImage && options_.mode != PackMode::LosslessJxl)) {
            s->SetDistance(options_.distance);
        }
        s->SetEffort(static_cast<uint32>(std::clamp(options_.effort, 1, 9)));
        return s;
    }

    uint32 PerformAreaTaskThreads() override { return threads_; }

    // The SDK's own host runs every area task (demosaic, JPEG XL tiles, lossless JPEG) on one thread. Bands of whole
    // tile rows go to their own threads; a task started from inside one (libjxl's runner) stays on its thread, so the
    // thread count never multiplies (the web build has a fixed pool).
    void PerformAreaTask(dng_area_task& task, const dng_rect& area, dng_area_task_progress* progress) override {
        const dng_point tile = task.FindTileSize(area);
        const uint32 tileRows = (area.H() + tile.v - 1) / std::max<int32>(1, tile.v);
        const uint32 n = std::min({task.MaxThreads(), threads_, tileRows});
        if (n <= 1 || tInAreaTask) {
            dng_host::PerformAreaTask(task, area, progress);
            return;
        }
        task.Start(n, area, tile, &Allocator(), Sniffer());
        std::vector<std::thread> threads;
        std::exception_ptr failure;
        std::mutex lock;
        const uint32 rowsPer = (tileRows + n - 1) / n;
        for (uint32 i = 0; i < n; ++i) {
            dng_rect band = area;
            band.t = area.t + int32(i * rowsPer) * tile.v;
            band.b = std::min<int32>(area.b, band.t + int32(rowsPer) * tile.v);
            if (band.IsEmpty()) continue;
            threads.emplace_back([&, i, band]() {
                tInAreaTask = true;
                try {
                    task.ProcessOnThread(i, band, tile, Sniffer(), progress);
                } catch (...) {
                    std::lock_guard<std::mutex> g(lock);
                    if (!failure) failure = std::current_exception();
                }
                tInAreaTask = false;
            });
        }
        for (auto& t : threads) t.join();
        task.Finish(n);
        if (failure) std::rethrow_exception(failure);
    }

private:
    PackOptions options_;
    uint32 threads_;
};

// ---- Lens corrections: camera curves -> DNG opcodes ----

double interp(const std::vector<double>& x, const std::vector<double>& y, double r) {
    if (r <= x.front()) return y.front();
    for (size_t i = 1; i < x.size(); ++i)
        if (r <= x[i]) return y[i - 1] + (y[i] - y[i - 1]) * (r - x[i - 1]) / (x[i] - x[i - 1]);
    return y.back();
}

/** Least squares fit of y(r) by sum_k c_k r^(2k), k < terms; [pixelWeighted]: weights grow with r (warp errors do). */
std::vector<double> fitEven(const std::vector<double>& rs, const std::vector<double>& ys, int terms, bool pixelWeighted) {
    std::vector<double> a(terms * terms, 0), b(terms, 0);
    for (size_t s = 0; s < rs.size(); ++s) {
        std::vector<double> p(terms);
        const double r2 = rs[s] * rs[s];
        p[0] = 1;
        for (int k = 1; k < terms; ++k) p[k] = p[k - 1] * r2;
        const double wt = pixelWeighted ? r2 + 1e-4 : 1.0;
        for (int i = 0; i < terms; ++i) {
            b[i] += wt * p[i] * ys[s];
            for (int j = 0; j < terms; ++j) a[i * terms + j] += wt * p[i] * p[j];
        }
    }
    for (int i = 0; i < terms; ++i) {
        int piv = i;
        for (int r = i + 1; r < terms; ++r)
            if (std::fabs(a[r * terms + i]) > std::fabs(a[piv * terms + i])) piv = r;
        for (int j = 0; j < terms; ++j) std::swap(a[i * terms + j], a[piv * terms + j]);
        std::swap(b[i], b[piv]);
        for (int r = 0; r < terms; ++r) {
            if (r == i) continue;
            const double f = a[r * terms + i] / a[i * terms + i];
            for (int j = 0; j < terms; ++j) a[r * terms + j] -= f * a[i * terms + j];
            b[r] -= f * b[i];
        }
    }
    for (int i = 0; i < terms; ++i) b[i] /= a[i * terms + i];
    return b;
}

/**
 * WarpRectilinear (OpcodeList3, distortion and lateral CA per plane) and FixVignetteRadial (OpcodeList2), laid out as
 * Adobe's DNG of the same RAF: the warp is scaled to the widest view that still fills the frame (k0 1.044 for the
 * GF20-35 at 20 mm in both), vignetting before demosaicing. Both are marked optional, as Adobe marks them.
 */
void addLensOpcodes(dng_negative& negative, const CameraLensData& c, uint32 width, uint32 height) {
    const double hw = width / 2.0, hh = height / 2.0, hd = std::hypot(hw, hh);
    if (c.hasDistortion() || c.hasChromaticAberration()) {
        double scale = 0;
        for (int i = 0; i <= 100; ++i) {
            const double t = i / 100.0;
            const double pts[2][2] = {{hw, hh * t}, {hw * t, hh}};
            for (const auto& p : pts) {
                const double r = std::hypot(p[0], p[1]) / hd;
                const double d = interp(c.knots, c.dist, r);
                scale = std::max({scale, d, d * interp(c.knots, c.caR, r), d * interp(c.knots, c.caB, r)});
            }
        }
        dng_warp_params_radial radial;
        dng_vector tan[kMaxColorPlanes];
        const std::vector<double>* planeCa[3] = {&c.caR, nullptr, &c.caB};
        for (uint32 p = 0; p < 3; ++p) {
            // Fitted at the knots themselves: interpolating between them would add kinks the lens doesn't have.
            std::vector<double> ys;
            for (size_t i = 0; i < c.knots.size(); ++i)
                ys.push_back(c.dist[i] * (planeCa[p] ? (*planeCa[p])[i] : 1.0) / scale);
            const std::vector<double> k = fitEven(c.knots, ys, 4, true);
            dng_vector v(4);
            for (int i = 0; i < 4; ++i) v[i] = k[i];
            radial.SetWarpRectilinear_1_3(p, v);
            tan[p] = dng_vector(2);
        }
        dng_warp_params_rectilinear warp(3, radial, tan, dng_point_real64(0.5, 0.5));
        AutoPtr<dng_opcode> op(new dng_opcode_WarpRectilinear(warp, dng_opcode::kFlag_Optional));
        negative.OpcodeList3().Append(op);
    }
    if (c.hasVignetting()) {
        std::vector<double> rs, gains;
        for (int i = 0; i <= 200; ++i) {
            rs.push_back(i / 200.0);
            gains.push_back(1.0 / std::max(0.05, interp(c.knots, c.vig, rs.back())));
        }
        const std::vector<double> g = fitEven(rs, gains, 6, false);
        dng_std_vector<real64> k;
        for (int i = 1; i < 6; ++i) k.push_back(g[i] / g[0]);
        dng_vignette_radial_params params(k, dng_point_real64(0.5, 0.5));
        AutoPtr<dng_opcode> op(new dng_opcode_FixVignetteRadial(params, dng_opcode::kFlag_Optional));
        negative.OpcodeList2().Append(op);
    }
}

// ---- Previews ----

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

/** Size and luma subsampling from a baseline/progressive JPEG's SOF. */
bool jpegFrame(const uint8_t* d, size_t n, uint32& w, uint32& h, uint32& sh, uint32& sv) {
    if (n < 4 || d[0] != 0xFF || d[1] != 0xD8) return false;
    for (size_t i = 2; i + 12 < n;) {
        if (d[i] != 0xFF) return false;
        const int m = d[i + 1];
        const size_t len = (size_t(d[i + 2]) << 8) | d[i + 3];
        if (m == 0xC0 || m == 0xC1 || m == 0xC2) {
            h = (uint32(d[i + 5]) << 8) | d[i + 6];
            w = (uint32(d[i + 7]) << 8) | d[i + 8];
            if (d[i + 9] != 3) return false;  // grey or CMYK previews: not as YCbCr
            sh = d[i + 11] >> 4;
            sv = d[i + 11] & 15;
            return w > 0 && h > 0;
        }
        i += 2 + len;
    }
    return false;
}

void appendJpegPreview(dng_host& host, const uint8_t* jpeg, size_t size, dng_preview_list& previews, bool ownData) {
    uint32 w = 0, h = 0, sh = 1, sv = 1;
    if (!jpegFrame(jpeg, size, w, h, sh, sv)) return;
    AutoPtr<ReadyJpegPreview> p(new ReadyJpegPreview);
    p->fInfo.fApplicationName.Set("RawBoy Packer");
    p->fInfo.fColorSpace = previewColorSpace_sRGB;
    p->fInfo.fIsPrimary = true;
    p->Setup(w, h, sh, sv);
    AutoPtr<dng_memory_block> block(host.Allocate(static_cast<uint32>(size)));
    std::memcpy(block->Buffer(), jpeg, size);
    p->SetCompressedData(block);
    AutoPtr<dng_preview> base(p.Release());
    previews.Append(base);
    (void)ownData;
}

/** The SDK's reference render of the negative at [maxSide], as a JPEG preview. */
bool appendRenderedPreview(dng_host& host, dng_negative& negative, int maxSide, const PreviewEncoder& encode,
                           dng_preview_list& previews) {
    if (maxSide <= 0 || !encode || !negative.Stage3Image()) return false;
    dng_render render(host, negative);
    render.SetFinalSpace(dng_space_sRGB::Get());
    render.SetFinalPixelType(ttByte);
    render.SetMaximumSize(static_cast<uint32>(maxSide));
    AutoPtr<dng_image> img(render.Render());
    const uint32 w = img->Width(), h = img->Height();
    std::vector<uint8_t> rgb(size_t(w) * h * 3);
    dng_pixel_buffer buf(img->Bounds(), 0, 3, ttByte, pcInterleaved, rgb.data());
    img->Get(buf);
    std::vector<uint8_t> jpeg;
    if (!encode(rgb.data(), static_cast<int>(w), static_cast<int>(h), jpeg) || jpeg.empty()) return false;
    appendJpegPreview(host, jpeg.data(), jpeg.size(), previews, true);
    return previews.Count() > 0;
}

// ---- EXIF ----

void setRational(dng_urational& r, double v, uint32 den) {
    if (std::isfinite(v) && v > 0) r.Set_real64(v, den);
}

void fillExif(dng_exif& exif, const PhotoMetadata& m, bool keepGps) {
    exif.fMake.Set(m.make.c_str());
    exif.fModel.Set(m.model.c_str());
    if (!m.lensModel.empty()) exif.fLensName.Set(m.lensModel.c_str());
    if (!m.lensMake.empty()) exif.fLensMake.Set(m.lensMake.c_str());
    if (!m.artist.empty()) exif.fArtist.Set(m.artist.c_str());
    if (!m.copyright.empty()) exif.fCopyright.Set(m.copyright.c_str());
    if (std::isfinite(m.exposureTime) && m.exposureTime > 0) {
        // 1/n s as such (1/250), longer times in tenths.
        if (m.exposureTime < 1) exif.fExposureTime.Set_real64(m.exposureTime, static_cast<uint32>(std::round(1 / m.exposureTime)) * 10);
        else exif.fExposureTime.Set_real64(m.exposureTime, 10);
        exif.fExposureTime.ReduceByFactor(10);
    }
    setRational(exif.fFNumber, m.fNumber, 100);
    setRational(exif.fFocalLength, m.focalLength, 100);
    if (std::isfinite(m.focalLength35mm) && m.focalLength35mm > 0)
        exif.fFocalLengthIn35mmFilm = static_cast<uint32>(std::lround(m.focalLength35mm));
    if (m.iso > 0) exif.fISOSpeedRatings[0] = static_cast<uint32>(std::lround(m.iso));
    if (m.dateTimeOriginal.size() >= 19) {
        int y, mo, d, h, mi, s;
        if (std::sscanf(m.dateTimeOriginal.c_str(), "%d:%d:%d %d:%d:%d", &y, &mo, &d, &h, &mi, &s) == 6) {
            dng_date_time_info info;
            info.SetDateTime(dng_date_time(y, mo, d, h, mi, s));
            exif.fDateTimeOriginal = info;
            exif.fDateTimeDigitized = info;
        }
    }
    if (keepGps && m.hasGps) {
        exif.fGPSVersionID = 0x02030000;
        exif.fGPSLatitudeRef.Set(m.gpsLatitudeRef == 'S' ? "S" : "N");
        exif.fGPSLongitudeRef.Set(m.gpsLongitudeRef == 'W' ? "W" : "E");
        for (int i = 0; i < 3; ++i) {
            exif.fGPSLatitude[i].Set_real64(m.gpsLatitude[i], 10000);
            exif.fGPSLongitude[i].Set_real64(m.gpsLongitude[i], 10000);
        }
        if (std::isfinite(m.gpsAltitude)) {
            exif.fGPSAltitudeRef = m.gpsBelowSeaLevel ? 1 : 0;
            exif.fGPSAltitude.Set_real64(std::fabs(m.gpsAltitude), 100);
        }
    }
}

void stripGps(dng_exif& exif) {
    exif.fGPSVersionID = 0;
    exif.fGPSLatitudeRef.Clear();
    exif.fGPSLongitudeRef.Clear();
    exif.fGPSAltitudeRef = 0xFFFFFFFF;
    for (int i = 0; i < 3; ++i) {
        exif.fGPSLatitude[i].Clear();
        exif.fGPSLongitude[i].Clear();
        exif.fGPSTimeStamp[i].Clear();
        exif.fGPSDestLatitude[i].Clear();
        exif.fGPSDestLongitude[i].Clear();
    }
    exif.fGPSAltitude.Clear();
    exif.fGPSDateStamp.Clear();
    exif.fGPSMapDatum.Clear();
    exif.fGPSSatellites.Clear();
    exif.fGPSProcessingMethod.Clear();
    exif.fGPSAreaInformation.Clear();
}

// ---- LibRaw -> dng_negative ----

const char* formatOf(const uint8_t* data, size_t size, const libraw_data_t* d) {
    if (size >= 15 && std::memcmp(data, "FUJIFILMCCD-RAW", 15) == 0) return "RAF";
    if (!d) return "";
    const std::string make = d->idata.normalized_make;
    if (make == "Sony") return "ARW";
    if (make == "Canon") return size > 8 && std::memcmp(data + 4, "ftypcrx", 7) == 0 ? "CR3" : "CR2";
    if (make == "Nikon") return "NEF";
    if (make == "Olympus" || make == "OM Digital") return "ORF";
    if (make == "Panasonic" || make == "Leica") return "RW2";
    if (make == "Pentax" || make == "Ricoh") return "PEF";
    return "RAW";
}

// ---- Fujifilm geometry ----

/** The camera's own crop from a RAF header (raw-area coordinates), as Adobe's converter uses it. */
struct FujiCrop {
    uint32 top = 0, left = 0, width = 0, height = 0;
};

/**
 * RawImageCropTopLeft 0x0110 and RawImageCroppedSize 0x0111 from the RAF header's directory (pointer at byte 92: a
 * count, then tag / length / big-endian values). LibRaw reads them too but moves an X-Trans crop to a multiple of 6
 * (X-T5: top 21 → 24, 5152 → 5149 rows; X-T1: 16 → 18); Adobe's DNGs keep the camera's crop exactly.
 */
bool readFujiCrop(const uint8_t* data, size_t size, FujiCrop& crop) {
    if (size < 96 || std::memcmp(data, "FUJIFILMCCD-RAW", 15) != 0) return false;
    auto be16 = [&](size_t at) { return uint32(data[at]) << 8 | data[at + 1]; };
    auto be32 = [&](size_t at) { return be16(at) << 16 | be16(at + 2); };
    size_t at = be32(92);
    if (at + 4 > size) return false;
    uint32 entries = be32(at);
    at += 4;
    bool topLeft = false, cropped = false;
    for (; entries > 0 && entries < 256 && at + 4 <= size; --entries) {
        const uint32 tag = be16(at), len = be16(at + 2);
        at += 4;
        if (at + len > size) break;
        if (tag == 0x0110 && len >= 4) {
            crop.top = be16(at);
            crop.left = be16(at + 2);
            topLeft = true;
        } else if (tag == 0x0111 && len >= 4) {
            crop.height = be16(at);
            crop.width = be16(at + 2);
            cropped = true;
        }
        at += len;
    }
    return topLeft && cropped && crop.width && crop.height;
}

/**
 * LibRaw 0.21 doesn't know the 40 MP X-Trans 5 HR sensor (X-T5, X-E5; raw 7872 x 5196) and centres its visible area
 * at column 60: 60 columns of picture lost on the left, 60 of zeros (below black) on the right. LibRaw 0.22's own
 * geometry for it (identify.cpp, case 7872), checked against Adobe's DNGs of an X-T5 and an X-E5 raw. Drop this when
 * LibRaw is updated.
 */
void fixLibRawGeometry(libraw_data_t& d) {
    libraw_image_sizes_t& s = d.sizes;
    if (d.idata.filters != 9 || s.raw_width != 7872 || s.raw_height != 5196 || s.left_margin != 60) return;
    s.top_margin = 6;
    s.left_margin = 0;
    s.width = s.iwidth = 7752;
    s.height = s.iheight = 5178;
    for (int r = 0; r < 6; ++r)
        for (int c = 0; c < 6; ++c)
            d.idata.xtrans[r][c] = d.idata.xtrans_abs[(r + s.top_margin) % 6][(c + s.left_margin) % 6];
}

void infoFromLibRaw(const libraw_data_t& d, PackInfo& info) {
    info.make = d.idata.normalized_make;
    info.model = d.idata.normalized_model;
    info.lens = d.lens.Lens;
    info.width = d.sizes.width;
    info.height = d.sizes.height;
    info.mosaic = d.idata.filters != 0 && d.idata.colors == 3;
    info.bayer = info.mosaic && d.idata.filters > 1000;
    info.adobeHints = adobeHintsFor(info.make + " " + info.model) != nullptr;
}

dng_negative* negativeFromLibRaw(dng_host& host, RawBoyLibRaw& raw, const uint8_t* data, size_t size,
                                 const PackOptions& opt, PackInfo& info, dng_preview_list& previews) {
    const libraw_data_t& d = raw.imgdata;
    if (!d.rawdata.raw_image) ThrowProgramError("not a single-plane raw (sRAW, Foveon or linear): not supported yet");
    if (d.idata.colors != 3) ThrowProgramError("not an RGB colour filter (CYGM): not supported");
    const uint32 w = d.sizes.width, h = d.sizes.height;
    AutoPtr<dng_negative> neg(host.Make_dng_negative());

    const std::string unique = info.make + " " + info.model;
    neg->SetModelName(unique.c_str());
    neg->SetLocalName(unique.c_str());
    neg->SetRGB();
    if (const AdobeHints* hints = adobeHintsFor(unique)) {
        neg->SetBaselineSharpness(hints->sharpness);
        neg->SetBaselineExposure(hints->exposure);
    }

    // CFA, at the visible area's origin. LibRaw's colours: 0 R, 1 G, 2 B, 3 G2.
    auto colorAt = [&](int r, int c) {
        const int k = raw.COLOR(r, c);
        return k == 3 ? 1 : k;
    };
    if (d.idata.filters == 9) {
        // X-Trans: 6x6, as LibRaw's xtrans table (visible-area coordinates).
        // The SDK knows the layout as one fixed pattern shifted by a phase: find the phase equal to LibRaw's table.
        // Overriding the pattern instead left the SDK's demosaic (Small raw / Micro on X-Trans) out of memory.
        bool found = false;
        for (uint32 phase = 0; phase < 36 && !found; ++phase) {
            neg->SetFujiMosaic6x6(phase);
            const dng_mosaic_info* mi = neg->GetMosaicInfo();
            found = true;
            for (int r = 0; r < 6 && found; ++r)
                for (int c = 0; c < 6; ++c)
                    if (mi->fCFAPattern[r][c] != static_cast<uint8>(d.idata.xtrans[r][c])) {
                        found = false;
                        break;
                    }
        }
        if (!found) throw std::runtime_error("unsupported X-Trans layout");
    } else {
        const int c00 = colorAt(0, 0), c01 = colorAt(0, 1);
        const uint32 phase = c00 == 1 ? (c01 == 0 ? 0 : 3) : (c00 == 0 ? 1 : 2);  // GRBG, GBRG, RGGB, BGGR
        neg->SetBayerMosaic(phase);
    }
    neg->SetColorChannels(3);

    // The visible area only (LibRaw's masked margins dropped).
    dng_rect bounds(h, w);
    AutoPtr<dng_image> image(host.Make_dng_image(bounds, 1, ttShort));
    {
        std::vector<uint16> rows(size_t(w) * 64);
        const size_t pitch = d.sizes.raw_pitch / 2;
        for (uint32 r0 = 0; r0 < h; r0 += 64) {
            const uint32 n = std::min<uint32>(64, h - r0);
            for (uint32 r = 0; r < n; ++r)
                std::memcpy(&rows[size_t(r) * w],
                            d.rawdata.raw_image + (r0 + r + d.sizes.top_margin) * pitch + d.sizes.left_margin, w * 2);
            dng_pixel_buffer buf(dng_rect(r0, 0, r0 + n, w), 0, 1, ttShort, pcInterleaved, rows.data());
            image->Put(buf);
        }
    }
    neg->SetStage1Image(image);

    // Levels: black per CFA position (black + cblack[colour] + the cblack[6..] pattern), white.
    const unsigned* cb = d.color.cblack;
    auto blackAt = [&](int r, int c) {
        double b = d.color.black + cb[raw.COLOR(r, c)];
        if (cb[4] && cb[5]) b += cb[6 + (r % cb[4]) * cb[5] + (c % cb[5])];
        return b;
    };
    if (d.idata.filters == 9) {
        real64 blacks[36];
        for (int i = 0; i < 36; ++i) blacks[i] = blackAt(i / 6, i % 6);
        neg->Set6x6Blacks(blacks);
    } else {
        neg->SetQuadBlacks(blackAt(0, 0), blackAt(0, 1), blackAt(1, 0), blackAt(1, 1));
    }
    neg->SetWhiteLevel(d.color.maximum);

    // Colour: LibRaw's Adobe-derived D65 ColorMatrix (Lightroom swaps in its own camera profiles by
    // UniqueCameraModel), as-shot white balance.
    const float(*xyz)[3] = d.color.cam_xyz;
    dng_matrix_3by3 m(xyz[0][0], xyz[0][1], xyz[0][2], xyz[1][0], xyz[1][1], xyz[1][2], xyz[2][0], xyz[2][1], xyz[2][2]);
    if (m.MaxEntry() == 0) {
        // Cameras newer than LibRaw's table: Adobe's D65 matrices, read from its own DNGs. The X-T5 and X-E5 share
        // the 40 MP X-Trans 5 HR sensor, and Adobe gives them the same matrix.
        static const struct { const char* model; double v[9]; } kMatrices[] = {
            {"X-E5", {1.1809, -0.5358, -0.1141, -0.4248, 1.2164, 0.2343, -0.0514, 0.1097, 0.5848}},
            {"X-T5", {1.1809, -0.5358, -0.1141, -0.4248, 1.2164, 0.2343, -0.0514, 0.1097, 0.5848}},
        };
        for (const auto& k : kMatrices)
            if (std::string(d.idata.normalized_model) == k.model || std::string(d.idata.model) == k.model)
                m = dng_matrix_3by3(k.v[0], k.v[1], k.v[2], k.v[3], k.v[4], k.v[5], k.v[6], k.v[7], k.v[8]);
        if (m.MaxEntry() == 0)
            throw std::runtime_error(std::string("this camera (") + d.idata.make + " " + d.idata.model +
                                     ") is newer than the raw library's colour table");
    }
    AutoPtr<dng_camera_profile> profile(new dng_camera_profile);
    profile->SetName("RawBoy Packer");
    profile->SetColorMatrix1(m);
    profile->SetCalibrationIlluminant1(lsD65);
    neg->AddProfile(profile);
    const float* mul = d.color.cam_mul;
    if (mul[0] > 0 && mul[1] > 0 && mul[2] > 0) neg->SetCameraNeutral(dng_vector_3(mul[1] / mul[0], 1.0, mul[1] / mul[2]));

    switch (d.sizes.flip) {
        case 3: neg->SetBaseOrientation(dng_orientation::Rotate180()); break;
        case 5: neg->SetBaseOrientation(dng_orientation::Rotate90CCW()); break;
        case 6: neg->SetBaseOrientation(dng_orientation::Rotate90CW()); break;
        default: break;
    }
    // The camera's own crop inside the visible area (Fuji: 8256x6192 of 8280x6208; Sony 6000x4000 of 6024x4024).
    // Fujifilm's straight from the RAF header (LibRaw's is moved to a multiple of 6 on X-Trans).
    libraw_raw_inset_crop_t ic = d.sizes.raw_inset_crops[0];
    FujiCrop fuji;
    if (readFujiCrop(data, size, fuji) && fuji.left >= d.sizes.left_margin && fuji.top >= d.sizes.top_margin &&
        fuji.left - d.sizes.left_margin + fuji.width <= w && fuji.top - d.sizes.top_margin + fuji.height <= h) {
        ic.cleft = static_cast<ushort>(fuji.left);
        ic.ctop = static_cast<ushort>(fuji.top);
        ic.cwidth = static_cast<ushort>(fuji.width);
        ic.cheight = static_cast<ushort>(fuji.height);
    }
    const uint32 cl = ic.cleft >= d.sizes.left_margin ? ic.cleft - d.sizes.left_margin : 0;
    const uint32 ct = ic.ctop >= d.sizes.top_margin ? ic.ctop - d.sizes.top_margin : 0;
    if (ic.cwidth && ic.cheight && ic.cwidth != 0xffff && cl + ic.cwidth <= w && ct + ic.cheight <= h) {
        neg->SetDefaultCropOrigin(cl, ct);
        neg->SetDefaultCropSize(ic.cwidth, ic.cheight);
    } else {
        neg->SetDefaultCropOrigin(0u, 0u);
        neg->SetDefaultCropSize(w, h);
    }

    PhotoMetadata meta;
    readLibRawMetadata(d, meta);
    fillExif(*neg->GetExif(), meta, opt.keepGps);

    if (opt.lensCorrections) {
        CameraLensData lens;
        if (readCameraLensData(data, size, lens) && lens.any()) {
            addLensOpcodes(*neg, lens, w, h);
            info.lensWritten = true;
        }
    }

    // The camera's JPEG as the preview, when it is one.
    if (opt.previewSize > 0 && raw.unpack_thumb() == LIBRAW_SUCCESS && d.thumbnail.tformat == LIBRAW_THUMBNAIL_JPEG) {
        appendJpegPreview(host, reinterpret_cast<const uint8_t*>(d.thumbnail.thumb), d.thumbnail.tlength, previews,
                          false);
        if (previews.Count()) info.preview = "camera";
    }
    return neg.Release();
}

bool looksLikeDng(dng_host& host, const uint8_t* data, size_t size, dng_info& info) {
    try {
        dng_stream stream(data, static_cast<uint32>(size));
        info.Parse(host, stream);
        info.PostParse(host);
        return info.IsValidDNG();
    } catch (...) {
        return false;
    }
}

void infoFromDng(const dng_info& dinfo, PackInfo& info) {
    info.dng = true;
    info.format = "DNG";
    info.model = dinfo.fShared->fUniqueCameraModel.Get();
    if (dinfo.fMainIndex >= 0) {
        const dng_ifd& ifd = *dinfo.fIFD[dinfo.fMainIndex];
        info.width = static_cast<int>(ifd.fImageWidth);
        info.height = static_cast<int>(ifd.fImageLength);
        info.mosaic = ifd.fPhotometricInterpretation == piCFA;
        info.bayer = info.mosaic && ifd.fCFARepeatPatternRows == 2 && ifd.fCFARepeatPatternCols == 2;
        // The DNG's own lens corrections (Adobe's, the camera's or a phone's opcodes) are carried over as they are.
        if (ifd.fOpcodeList2Count || ifd.fOpcodeList3Count) info.lensData = "DNG";
    }
}

}  // namespace

bool inspectForPacking(const uint8_t* data, size_t size, PackInfo& info, std::string& error) {
    info = PackInfo();
    try {
        dng_host host;
        dng_info dinfo;
        if (looksLikeDng(host, data, size, dinfo)) {
            infoFromDng(dinfo, info);
            // Make, model and lens from LibRaw, which reads the EXIF without the image.
            // On the heap: a LibRaw object is far larger than a web worker's 2 MB stack.
            auto raw = std::make_unique<LibRaw>();
            if (raw->open_buffer(data, size) == LIBRAW_SUCCESS) {
                info.make = raw->imgdata.idata.normalized_make;
                info.model = raw->imgdata.idata.normalized_model;
                info.lens = raw->imgdata.lens.Lens;
            }
            return true;
        }
    } catch (...) {
    }
    auto raw = std::make_unique<LibRaw>();
    const int rc = raw->open_buffer(data, size);
    if (rc != LIBRAW_SUCCESS) {
        error = std::string("not a raw file LibRaw knows (") + libraw_strerror(rc) + ")";
        return false;
    }
    fixLibRawGeometry(raw->imgdata);
    infoFromLibRaw(raw->imgdata, info);
    info.format = formatOf(data, size, &raw->imgdata);
    CameraLensData lens;
    if (readCameraLensData(data, size, lens) && lens.any()) {
        info.lensData = lens.maker;
        info.lensDistortion = lens.hasDistortion();
        info.lensVignetting = lens.hasVignetting();
        info.lensCa = lens.hasChromaticAberration();
    }
    return true;
}

bool packDng(const uint8_t* data, size_t size, const PackOptions& options, const PreviewEncoder& encodePreview,
             std::vector<uint8_t>& out, PackInfo& info, std::string& error) {
    const auto t0 = std::chrono::steady_clock::now();
    if (!inspectForPacking(data, size, info, error)) return false;
    try {
        PackHost host(options);
        host.SetSaveDNGVersion(dngVersion_SaveDefault);
        host.SetSaveLinearDNG(false);
        host.SetKeepOriginalFile(false);

        AutoPtr<dng_negative> negative;
        dng_preview_list previews;
        info.preview = "none";
        dng_info dinfo;
        if (looksLikeDng(host, data, size, dinfo)) {
            dng_stream stream(data, static_cast<uint32>(size));
            negative.Reset(host.Make_dng_negative());
            negative->Parse(host, stream, dinfo);
            negative->PostParse(host, stream, dinfo);
            negative->ReadStage1Image(host, stream, dinfo);
            if (!options.keepGps) stripGps(*negative->GetExif());
            info.lensWritten = !info.lensData.empty();
        } else {
            auto raw = std::make_unique<RawBoyLibRaw>();
            int rc = raw->openBuffer(data, size);
            if (rc == LIBRAW_SUCCESS) {
                fixLibRawGeometry(raw->imgdata);
                rc = raw->unpack();
            }
            if (rc != LIBRAW_SUCCESS) {
                error = std::string("LibRaw: ") + libraw_strerror(rc);
                return false;
            }
            negative.Reset(negativeFromLibRaw(host, *raw, data, size, options, info, previews));
        }

        // What the source allows: lossy raw needs a 2x2 mosaic; anything else is saved demosaiced at full size.
        PackMode mode = options.mode;
        const bool bayer = negative->GetMosaicInfo() && negative->GetMosaicInfo()->IsColorFilterArray() &&
                           negative->GetMosaicInfo()->fCFAPatternSize == dng_point(2, 2);
        host.SetLossyMosaicJXL(mode == PackMode::SmallRaw && bayer);
        host.SetLosslessJXL(mode == PackMode::LosslessJxl);

        negative->SynchronizeMetadata();
        negative->BuildStage2Image(host);
        // The demosaiced image (300 MB for 50 MP) only for a rendered preview and the linear (proxy) outputs.
        const bool renderPreview = options.previewSize > 0 && previews.Count() == 0 && encodePreview;
        const bool linearOut = mode == PackMode::Micro || (mode == PackMode::SmallRaw && !negative->NeedLossyCompressMosaicJXL(host));
        if (renderPreview || linearOut) negative->BuildStage3Image(host);
        if (renderPreview && appendRenderedPreview(host, *negative, options.previewSize, encodePreview, previews)) {
            info.preview = "rendered";
        }

        dng_image_writer writer;
        if (mode == PackMode::Micro) {
            negative->ConvertToProxy(host, writer, static_cast<uint32>(std::max(256, options.maxSize)));
            info.linear = true;
        } else if (mode == PackMode::SmallRaw) {
            if (negative->NeedLossyCompressMosaicJXL(host)) {
                negative->LossyCompressMosaicJXL(host, writer);
            } else {
                // X-Trans, linear (ProRAW) or already lossy: a full-size lossy JPEG XL linear DNG.
                negative->ConvertToProxy(host, writer, kMaxImageSide);
                info.linear = true;
            }
        } else if (mode == PackMode::LosslessJxl) {
            negative->LosslessCompressJXL(host, writer);
        }
        info.modeUsed = mode;

        dng_memory_stream stream(host.Allocator());
        stream.SetLittleEndian();
        writer.WriteDNG(host, stream, *negative.Get(), previews.Count() ? &previews : nullptr, dngVersion_SaveDefault,
                        false);
        stream.Flush();
        out.resize(static_cast<size_t>(stream.Length()));
        stream.SetReadPosition(0);
        stream.Get(out.data(), static_cast<uint32>(out.size()));
        const dng_rect crop = negative->DefaultCropArea();
        info.outWidth = crop.W();
        info.outHeight = crop.H();
        info.seconds = std::chrono::duration<double>(std::chrono::steady_clock::now() - t0).count();
        return true;
    } catch (const dng_exception& e) {
        error = e.ErrorCode() == dng_error_memory ? "out of memory" : "DNG SDK error " + std::to_string(e.ErrorCode());
    } catch (const std::bad_alloc&) {
        error = "out of memory";
    } catch (const std::exception& e) {
        error = e.what();
    } catch (...) {
        error = "unknown error";
    }
    return false;
}

}  // namespace rawboy
