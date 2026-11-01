---
target: RawBoy Browser web
total_score: 33
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 0
target_identity: "file:/home/claude/lexusag/rawboy/web/src/ui/browser/BrowserApp.tsx"
target_fingerprint: "sha256:fd96f117c162e3f58c4c367013f343fc6f446dc2ccb0d8cca4d884b259885e3e"
target_path: /home/claude/lexusag/rawboy/web/src/ui/browser/BrowserApp.tsx
timestamp: 2026-11-01T13-40-58Z
slug: web-src-ui-browser-browserapp-tsx
---
⚠️ DEGRADED: single-context (subagents not used in this project thread)

# Impeccable critique: RawBoy Browser, web (`web/src/ui/browser/BrowserApp.tsx`)

Score: **33/40** (Good). Detector: source clean. Evidence: baseline screenshots at 6 viewports with a fake 9-file folder.

Strengths: one-row toolbar on phones (Bin and To bin take turns), clear Pick / Reject / stars bar in the viewer,
companion files shown as "+JPG", filter counts.

## Priority issues
1. **[P2] Undo is a Unicode "↶"** while Auto and RawBoy use the drawn Material icon, and it had no accessible name.
   *Fix:* `UndoIcon` + `aria-label`. (polish)
2. **[P2] Phone filter bar is cut off with no cue** ("Any star|"). It scrolls sideways but nothing says so.
   *Fix:* fade the right edge below 560 px, with end padding so the last control clears it. (adapt)
3. **[P3] Square cells letterbox landscape photos** (half of each cell is empty on phones). Left as is: square cells
   show portrait and landscape frames at the same size, the usual culling layout. A question for you, not a fix.
4. **[P3] ✕ / ⚑ glyphs** for reject and pick: consistent within the Browser, left as is.
