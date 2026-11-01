---
target: RawBoy Packer
total_score: 29
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 1
target_identity: "file:/home/claude/lexusag/rawboy/web/packer.html"
target_fingerprint: "sha256:90e3022b26b23a3a89e25c9a11f644aea69f16047eb3bfb9e0c9762c7965ef00"
target_path: /home/claude/lexusag/rawboy/web/packer.html
timestamp: 2026-11-01T13-11-44Z
slug: web-packer-html
---
⚠️ DEGRADED: single-context (subagents not used in this project thread; design review done first, detector read afterwards)

# Impeccable critique and audit: RawBoy Packer (`web/packer.html`)

Mode: Operate. Evidence: 18 baseline screenshots (`baseline/`), source (`PackerApp.tsx`, `packer.css`, `styles.css`),
detector on source and on the rendered page.

## Design Health Score

| # | Heuristic | Score | Key issue |
|---|---|---|---|
| 1 | Visibility of system status | 3 | Per-file status, sizes and totals are clear; "Reading…" has no progress. |
| 2 | Match system / real world | 4 | Photographer's words, measured numbers, "opens in" table. |
| 3 | User control and freedom | 3 | Remove per file, "Stop after these", Clear finished. |
| 4 | Consistency and standards | 2 | Segmented controls stretch on some rows and not others; ✓ / ✓? / ✕ glyph marks. |
| 5 | Error prevention | 3 | Summary warns before packing (darktable, Apple Photos). |
| 6 | Recognition rather than recall | 3 | Every choice has a live hint. |
| 7 | Flexibility and efficiency | 3 | Presets plus Advanced; settings remembered. |
| 8 | Aesthetic and minimalist design | 2 | Same facts said three times (hint, summary, files card); dashed card inside card. |
| 9 | Error recovery | 3 | Errors inline per file; engine error shown. |
| 10 | Help and documentation | 3 | Hints are the docs; no link to docs/packer.md. |
| **Total** | | **29/40** | Good |

## Design specificity verdict

**Review:** Authored for this product. The "After packing, the file opens in" table and measured sizes are things a
generic converter page would not have. Visual language matches RawBoy Web (graphite, amber accent).

**Detector:** 1 warning, 1 advisory on the rendered page; source scan clean.
- `nested-cards` on `div.packer-drop`: agrees with the review (dashed box inside the Files card).
- `tiny-text` on `.packer-drop small` (11.7 px): real.

## Priority issues

1. **[P1] On phones the main action is three screens down.** Settings, then the long summary, then Files. Add files and
   Pack sit at the end of the page. *Fix:* below 860 px order the cards Settings, Files, Summary. *Command:* adapt / layout.
2. **[P2] Segmented controls stretch unevenly.** The global `.segmented button { flex: 1 }` leaks into Packer: a wrapped
   option ("Tiny copies for sharing") fills a whole row, and in phone landscape all three presets stack full width.
   *Fix:* natural-width segments in Packer. *Command:* polish.
3. **[P2] Hint text below contrast.** The Advanced intro is Ash Muted at 75% opacity: 3.99:1 on the card (needs 4.5).
   The "originals never changed" line also uses opacity. *Fix:* use the muted colour at full strength. *Command:* audit / polish.
4. **[P2] Nested card for the empty state.** A dashed 12 px box inside a 12 px card; the page already has a full-window
   drop overlay. *Fix:* plain empty state in the card, no inner box; footnote at 13 px. *Command:* polish.
5. **[P3] Controls have no accessible name.** Each segmented `radiogroup` is announced without its row label
   ("Lens corrections"). *Fix:* label the group by the row label. *Command:* harden.

## Persona red flags

- **Casey (distracted mobile user):** opens on a phone, picks photos, then has to scroll past ~2,000 px of text to find Pack.
- **Sam (keyboard / screen reader):** hears "radio group, Keep, checked" with no question; focus ring is the browser default.
- **Jordan (first-timer):** reads "original files are not changed" three times; fine, but it pushes the action further down.

## Minor observations

- ✓, ✓?, ✕ and ▸ are Unicode glyphs, not drawn icons. Acceptable here; consistent SVG marks would read cleaner.
- Summary and files card both state that originals are kept. The Pack as hint and the summary's first line overlap.
- "Files at once" options 1 to 4 have no arrow-key navigation (radio pattern).

## Questions to consider (not acted on in this pass)

- Should "originals are never changed" be said once, in the files card, and dropped from the summary?
- Would a short link to the Packer docs under the summary help, or is the page meant to be self-explanatory?

Questions skipped: you asked to move forward with the planned polish and harden pass; copy changes are left as
questions above because they change wording you just revised.
