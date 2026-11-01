---
target: RawBoy Auto web
total_score: 32
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 1
target_identity: "file:/home/claude/lexusag/rawboy/web/src/ui/auto/AutoApp.tsx"
target_fingerprint: "sha256:f6938b99cb256b4769fb92056bd8ad689b97654e6ae6263ae7e7cdf149de9440"
target_path: /home/claude/lexusag/rawboy/web/src/ui/auto/AutoApp.tsx
timestamp: 2026-11-01T13-32-55Z
slug: web-src-ui-auto-autoapp-tsx
---
⚠️ DEGRADED: single-context (subagents not used in this project thread; design review done first, detector read afterwards)

# Impeccable critique: RawBoy Auto, web (`web/src/ui/auto/AutoApp.tsx`)

Mode: Operate. Evidence: 18 baseline screenshots (`baseline/`, desktop, tablet, 412/390/360 phones, phone landscape;
empty, grid with 6 photos, photo view), stand-in decoder (one synthetic image for every file), source, detector.

## Design Health Score

| # | Heuristic | Score | Key issue |
|---|---|---|---|
| 1 | Visibility of system status | 3 | ISO badge, 1 / 6, Suggested look marked; look thumbnails fill in slowly with no hint. |
| 2 | Match system / real world | 4 | Film stock names, ISO, "Import as Looks / Film / As is". |
| 3 | User control and freedom | 4 | Undo/redo, Copy previous, remove keeps the file. |
| 4 | Consistency and standards | 3 | Phone photo bar wraps differently from the grid's bar. |
| 5 | Error prevention | 3 | Apply to all has no confirmation but is undoable. |
| 6 | Recognition rather than recall | 3 | Look and Adjust both hold Brightness and Warmth (backlog A3). |
| 7 | Flexibility and efficiency | 4 | Keyboard shortcuts, swipe between photos. |
| 8 | Aesthetic and minimalist design | 2 | Phone photo bar on three lines; name cut to "DSCF1…". |
| 9 | Error recovery | 3 | Errors shown per thumbnail. |
| 10 | Help and documentation | 3 | ? help, gesture hint. |
| **Total** | | **32/40** | Good |

## Design specificity verdict

**Review:** Authored for photographers: neutral grey mat round the photo, ISO for judging noise, film looks with
"Suggested". Consistent with Packer and RawBoy (graphite, one amber accent).

**Detector:** source scan clean; rendered empty page has 1 advisory (`straggler`: "render." alone on the empty
state's last line). The rendered scan can't open photos, so the grid and photo view were reviewed from screenshots only.

## Priority issues

1. **[P1] Phone photo bar takes three lines.** At 390 px: app switcher; back, name, undo, redo, delete, Apply to all;
   then Edit and Export on a third line. The name shows as "DSCF1…" and the photo loses ~100 px. Backlog A4.
   *Fix:* below 560 px, Apply to all, Edit in RawBoy and Remove from batch go into a ⋯ menu next to Export.
   *Command:* adapt.
2. **[P2] Gesture hint covers the ISO badge on phones.** "Double-tap for 100% · pinch to zoom · drag to pan" is ~300 px
   wide, centred at the same height as the badge. *Fix:* lift the hint above the badge below 560 px. *Command:* polish.
3. **[P2] Brightness and Warmth in both Look and Adjust tabs** (backlog A3). Not changed here: it touches all three
   ports and the store. *Command:* distill.
4. **[P3] Grid bar on phones wraps into three rows** (Apply RawBoy preset…, Sort, Auto denoise all). Left as is: the
   rows are 44 px touch targets by design; a ⋯ there would hide Sort.
5. **[P3] Empty-state straggler.** *Fix:* `text-wrap: pretty`. *Command:* typeset.

## Persona red flags

- **Casey (distracted mobile user):** to export one photo, finds Export on the third toolbar line under the name.
- **Alex (power user):** fine on desktop (keyboard, swipe, Copy previous).

## Not acted on

- A3 (one list of adjustments) and the grid's phone bar: bigger changes for their own PR, with Android and iOS.
- Android and iOS already have a ⋮ / … menu for Remove from batch; whether Apply to all and Edit belong there too is
  listed in UI.md A4.
