# RawBoy Packer

A web page that repackages camera raws and DNGs as DNGs, like Adobe DNG Converter, with plain controls and a live
summary of what each choice does. Everything runs in the browser (WASM: LibRaw and the Adobe DNG SDK); files are never
uploaded. Deployed as its own Cloudflare Pages project, `rawboy-packer` (see [Cloudflare](cloudflare.md)).

## Formats

| Format | What is stored | Size vs the camera raw* | Opens in |
| --- | --- | --- | --- |
| **Small raw** (default) | Raw data (every photosite), lossy JPEG XL (DNG 1.7.1) | 25–50% at High | RawBoy, Lightroom, Apple Photos. Not darktable (purple) |
| **Lossless** | Raw data, bit-exact, classic lossless JPEG (DNG 1.4) | 70–100% | Everything that reads DNG |
| **Lossless JPEG XL** | Raw data, bit-exact, lossless JPEG XL (DNG 1.7) | 40–100%, slow | RawBoy, Lightroom. Black in Apple Photos |
| **Micro** | Demosaiced, resized to a max size (linear DNG), lossy JPEG XL | 5–20% | RawBoy, Lightroom |

\* Measured on an A7 III, GFX 50R and E-PL9 (2026-11-01). The page shows the measured size of each file once packed.

Small raw saves X-Trans and already demosaiced sources (phone ProRAW) demosaiced at full size instead, and says so.

**Quality** (Small raw, Micro) is the JPEG XL distance: Archive 0.1, **High 0.2** (default; visually the same as the raw on
correctly exposed photos), Good 0.5, Compact 1.0. **Speed** is the encoder effort (3, 5, 7).

## Back to maximum compatibility

A JPEG XL DNG (Small raw, Lossless JPEG XL, Micro, or one from Adobe's converter or a phone) can be added to the Packer
again and packed as **Lossless** (*Maximum compatibility*): the result is a classic lossless JPEG DNG (DNG 1.4, readable
by DNG 1.3 readers) that older Lightroom/Camera Raw, darktable and Apple Photos open. The pixels are exactly those of
the JPEG XL file (checked bit for bit on GFX 50R, X-T5 and Pixel DNGs, 2026-11-02):

- Lossless JPEG XL → Lossless gives back the camera's raw data exactly.
- Small raw and Micro stay what they are: what the lossy compression or resizing discarded doesn't come back, and an
  X-Trans or phone Small raw, or a Micro, stays a demosaiced (linear) DNG.
- The files get big, because lossy-decoded data no longer compresses well: a GFX 50R Small raw went from 32 MB to
  91 MB (the RAF is 48 MB), an X-T5 Small raw (linear) from 21 MB to 174 MB, a 4000 px Micro from 2 MB to 43 MB.
  Keep the camera raw if you may need a small, widely readable file later.

## Lens corrections

Sony (ARW SubIFD tags 0x7032/0x7035/0x7037) and Fujifilm (RAF tags 0xF00B/0xF00F/0xF010; the GFX, X-T1, X-T5 and X-E5 layouts differ, the X-E5 stores none) store the camera's own
distortion, colour fringing and vignetting corrections. The Packer turns them into DNG opcodes as Adobe's converter
does (WarpRectilinear, FixVignetteRadial); checked against Adobe's DNG of the same GFX file.

- Lossless formats: kept as instructions that RawBoy and Lightroom apply (and can switch off).
- Small raw: the same, but vignetting is applied to the raw data itself (the SDK does that for lossy raw data).
- Micro: everything is applied to the pixels.
- Olympus, Canon, Nikon and Panasonic raws hold no corrections the Packer can read: Lightroom applies its own profiles.
- DNG sources keep their own corrections.

Turning *Lens corrections* off drops them.

## Lightroom match

Lightroom scales its default sharpening and exposure by hints that Adobe's own DNGs carry per camera. The Packer knows
them for the GFX 50R, X-T1, X-T5, X-E5, A7 III, A7C II, NEX-3, E-PL9, EOS RP and EOS 6D; for other cameras the summary warns that Lightroom may open the DNG a
little softer and darker than its own conversion.

## File list

Each file shows its camera and lens, the format (DNGs with their version, e.g. DNG 1.7), whether it holds lens
corrections, and a line about its raw data: bit depth (from the white level, so a Pixel's 16-bit samples read 10-bit),
compression, colour filter (Bayer, X-Trans, or linear for demosaiced DNGs) and megapixels.

- Camera raws: Sony and Nikon from their maker notes (uncompressed, lossless or lossy compressed, Nikon's High
  Efficiency); Fujifilm from the RAF's compressed-data header (lossless or lossy compressed); otherwise from the
  decoder LibRaw picks, and plain "compressed" when that doesn't say which.
- DNGs: uncompressed, lossless JPEG, lossy JPEG, Deflate, or JPEG XL (lossless when JXLDistance is 0, lossy when it is
  set higher, plain "JPEG XL" when the file doesn't say).

## Other settings

- **Location**: keep or remove GPS tags.
- **Preview**: the camera's own JPEG is used when the raw has one; otherwise (DNGs, phones) a 1024 or 2048 px render, or none.
- **Files at once**: Auto (default: a third of the cores, one on phones and machines under 8 GB) or 1 to 4 files in parallel, each in its own worker. A 50 MP photo needs up to 1 GB.
- **Settings in file name** (off by default): adds the settings to the name, e.g. `DSC001-small-high.dng`, `DSC001-micro4000-good.dng`,
  `DSC001-lossless.dng`; for DNG sources it replaces `-packed`.
- **When done** (off by default): *Pop-up* shows a message when every file is packed (count, sizes, failures). When the
  tab is in the background, a system notification too, if the browser allows notifications for the page (it asks when
  the option is turned on; Android Chrome shows only the pop-up).
- Output: a folder (Chrome, Edge) or the browser's downloads. Names are the source's with `.dng`; DNG sources get
  `-packed`. Originals are never changed.

## Standard and Advanced

The page opens in a plain view: **Pack as** (Smallest files, Maximum compatibility, Tiny copies for sharing), the
longest side for tiny copies, lens corrections, location, the file-name option and *When done*. *Advanced settings* (collapsed)
holds file type, quality, compression effort, preview and files at once. Picking a *Pack as* choice fills the advanced
values once; changing an advanced row never changes another row. The *After packing, the file opens in* list describes
the packed file.

Settings are remembered in the browser (localStorage).
