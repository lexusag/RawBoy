#pragma once

#include "rawboy.h"

#include <vector>

namespace rawboy {

/** A detected spot in full-resolution (display-oriented) pixels; higher score = more obvious. */
struct Blemish {
    float x, y, radius, score;
};

/**
 * A spot the user painted with the healing brush, in full-resolution pixels. [radius] is the disk's radius itself (an
 * automatic spot's is half of it). With a source ([hasSource]) the texture comes from the disk centred on ([srcX],
 * [srcY]); without, from the cleanest same-size disk nearby, as automatic spots do. [feather] 0..1 is the part of the
 * radius over which the healed disk fades into the photo.
 */
struct HealStroke {
    float x, y, radius;
    bool hasSource;
    float srcX, srcY;
    float feather;
};

/** The skin probability map (whole image, display orientation). */
struct SkinMaskView {
    const float* data;
    int width, height;
};

std::vector<Blemish> detectBlemishes(const DecodedImage& img, const SkinMaskView& mask, float faceDiameter);

/** Heals one spot in place, recording the original pixels in [backups]. */
void healBlemish(DecodedImage& img, const Blemish& spot, std::vector<HealBackup>& backups);

/** Heals one brush spot in place, recording the original pixels in [backups]. */
void healStroke(DecodedImage& img, const HealStroke& spot, std::vector<HealBackup>& backups);

/** Undoes all healing recorded in [backups]. */
void restoreBackups(DecodedImage& img, std::vector<HealBackup>& backups);

}  // namespace rawboy
