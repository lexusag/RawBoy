Lensfun lens database (RawBoy Web's lens corrections)
=====================================================

These files are a reformatted copy of the Lensfun lens database
(https://lensfun.github.io, https://github.com/lensfun/lensfun, data/db/*.xml),
made by tools/lensfun/convert.mjs in the RawBoy repository:

  index.json        cameras and lenses (names, mounts, crop factors, lens types, which corrections exist)
  calib-<file>.json calibrations (distortion, lateral chromatic aberration, vignetting) of the lenses of one
                    upstream XML file, in the same order and values; fetched only for the lens in use

Upstream commit: 52cf1a7b0e82e07e0ecaa3391ee5106a6dd1ee54 (2026-11-04)

The database is the work of the Lensfun project and its contributors, licensed under the
Creative Commons Attribution-ShareAlike 3.0 licence (LICENSE-CC-BY-SA-3.0.txt, https://creativecommons.org/licenses/by-sa/3.0/).
RawBoy's changes: the XML is converted to compact JSON (language variants of names reduced to the original,
comments and the mount/compat lists kept in a reduced form, numbers unchanged). These JSON files are
distributed under the same licence, CC BY-SA 3.0. The licence of the data does not extend to RawBoy's code that reads it.

Lensfun's code (LGPL-3.0) is NOT used: RawBoy re-implements the published calibration models in
web/src/engine/lens/Lensfun.ts.

To update: check out Lensfun, then
  node tools/lensfun/convert.mjs <lensfun>/data/db web/public/lensfun <commit> <date>
and update the commit above.
