#pragma once

// In-camera lens correction data from Sony ARW and Fujifilm RAF files, as radial curves. RawBoy Packer writes them
// into DNGs as WarpRectilinear / FixVignetteRadial opcodes (dng_pack.cpp).

#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>

namespace rawboy {

/**
 * Radial lens corrections at [knots] (radius as a fraction of the half diagonal, 0 = centre, 1 = corner):
 * - dist: source radius / corrected radius (the camera's model: source = r * dist(r)), 1 = none;
 * - caR, caB: red and blue scale on top of dist (lateral chromatic aberration), 1 = none;
 * - vig: brightness relative to the centre (0.5 = a stop darker), 1 = none.
 * Checked against the cameras' own JPEGs (A7 III FE 24/1.4 GM, GFX 50R GF20-35) and Adobe's DNG of the same RAF.
 */
struct CameraLensData {
    std::string maker;  // "Sony", "Fujifilm"; empty when the file has none
    std::vector<double> knots, dist, caR, caB, vig;

    bool hasDistortion() const;
    bool hasVignetting() const;
    bool hasChromaticAberration() const;
    /** Anything worth writing (adapted and manual lenses store flat curves). */
    bool any() const { return hasDistortion() || hasVignetting(); }
};

/** Reads Sony (ARW IFD0 tags 0x7032/0x7035/0x7037) or Fujifilm (RAF FujiIFD 0xF00B/0xF00F/0xF010) lens data. */
bool readCameraLensData(const uint8_t* data, size_t size, CameraLensData& out);

}  // namespace rawboy
