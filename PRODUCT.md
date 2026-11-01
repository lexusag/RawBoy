# Product

<!-- impeccable:product-schema 1 -->

<!-- Draft written from CLAUDE.md, Readme.md and docs/ for the owner to confirm; not yet from an init interview.
     Scope: RawBoy Web (web/: RawBoy, RawBoy Auto, RawBoy Browser, RawBoy Packer). The Android and iOS apps are
     separate native ports that follow accepted web changes by hand. -->

## Platform

web

## Users

Photographers who shoot raw (Fujifilm, Sony, Canon, Nikon, Olympus, phone ProRAW/DNG) and want to develop or repackage
their files without a desktop raw developer or an upload. The owner is the first user: a hobby photographer who tests
on a Pixel 9 Pro and a Mac. RawBoy Packer's users want smaller DNGs for archiving or sharing and need to know which
apps will still open the result.

## Product Purpose

RawBoy develops raw files with an AgX tone mapper and film looks; RawBoy Auto does it automatically, one photo or a
batch; RawBoy Browser culls a folder of raws; RawBoy Packer repackages raws and DNGs as smaller DNGs (JPEG XL or
lossless) and keeps Sony and Fujifilm lens corrections. Success: the photo looks right, the export is exact, and the
user understood what each choice does before pressing the button.

## Positioning

Everything runs locally in the browser (WASM: LibRaw, the Adobe DNG SDK, the same GLSL develop shader as the Android
app). Nothing is uploaded. Packer says plainly, per format, which apps open the result, with numbers measured on real
files.

## Operating Context

Used on desktop browsers (Chrome, Safari) and on phones (Chrome on Android, Safari on iPhone), in portrait and
landscape. Files arrive by file picker, drag and drop, a folder (File System Access) or Google Drive. Packing and
exports can take seconds to minutes per file and run several files at once.

## Capabilities and Constraints

- Three ports (Kotlin, Swift, TypeScript) of RawBoy and RawBoy Auto are kept in step; Packer is web only.
- Web pages need cross-origin isolation (COOP/COEP) for WASM threads; the Google Drive window runs without it.
- Phone layouts at 360 to 412 px and phone landscape were each tuned in separate changes; they must not regress.
- User-visible changes update `docs/` and `CHANGELOG.md`.

## Brand Commitments

- Name: RawBoy (RawBoy Auto, RawBoy Browser, RawBoy Packer). Never "spektrafilm" in branding.
- Dark UI. The photo area stays neutral grey so it doesn't bias colour judgement.
- One amber accent for the current choice and primary action.
- Voice: plain, short, factual British English ("colour"), no marketing claims; numbers over adjectives.

## Evidence on Hand

Measured sizes per format (A7 III, GFX 50R, E-PL9) in `docs/packer.md`; app support table in `web/src/packer/settings.ts`.
No testimonials, user counts or press exist: never invent them.

## Product Principles

1. The photo comes first: chrome stays quiet around it.
2. Say what a choice does before it happens (live summaries, hints), and never hide a loss of quality.
3. Works the same on a phone as on a desktop; the main action is always within reach.
4. Local and private: nothing leaves the device unless the user sends it.
