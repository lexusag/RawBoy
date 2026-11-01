---
target: RawBoy Pro web
total_score: 34
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 0
target_identity: "file:/home/claude/lexusag/rawboy/web/src/ui/pro/ProApp.tsx"
target_fingerprint: "sha256:14be8ed980d9f4d5fe92cb49fea00f79f7737f30cdb55a38d6de08e78e867993"
target_path: /home/claude/lexusag/rawboy/web/src/ui/pro/ProApp.tsx
timestamp: 2026-11-01T13-49-38Z
slug: web-src-ui-pro-proapp-tsx
---
⚠️ DEGRADED: single-context (subagents not used in this project thread)

# Impeccable critique: RawBoy Pro, web (`web/src/ui/pro/`)

Score: **34/40** (Good). Detector: source clean. Evidence: every panel (Light, Color, Detail, LUTs, Lens) at desktop,
tablet, 390 and 360 px phones and phone landscape, with the stub decoder.

Strengths: phone toolbar already tuned (labelled tools, name and shot info scroll sideways on purpose), consistent
slider rows with values, section labels in amber, help text under each group, neutral grey mat round the photo.

## Priority issues
1. **[P2] Phone landscape: "Send to Auto" wraps onto two lines** beside Export, making the top bar taller than the rest.
   *Fix:* the short "To Auto" label in landscape on phones (max-height 500 px), as upright phones already do; no wrap. (adapt)
2. **[P3] Two looks for "selected"**: Pro's chips (AgX, RGB) show the choice with an amber outline, while Auto's and
   Packer's segmented controls fill amber. Left as is: both are in use across three ports; worth one decision for all.
3. **[P3] The "Auto" button is a boxed button among labelled icons** on phones and taller than the tool row. Left as is.

Not changed: masks, crop and leaks overlays (need a real photo to judge), curves (tuned in earlier PRs).
