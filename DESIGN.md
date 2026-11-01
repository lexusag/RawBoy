---
name: RawBoy Web
description: Dark, quiet editor UI around a neutral photo area, with one amber accent.
colors:
  ink-black: "#121212"
  graphite-surface: "#1c1c1e"
  graphite-raised: "#26262a"
  hairline: "#333338"
  paper-white: "#ececec"
  ash-muted: "#9a9aa2"
  safelight-amber: "#e8a33d"
  amber-ink: "#1a1206"
  warning-red: "#ff6b6b"
typography:
  display:
    fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
    fontSize: "26px"
    fontWeight: 700
  title:
    fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
    fontSize: "18px"
    fontWeight: 600
  body:
    fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
    fontSize: "14px"
    lineHeight: 1.4
  label:
    fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
    fontSize: "12px"
rounded:
  chip: "6px"
  segment: "7px"
  control: "8px"
  card: "12px"
  pill: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "20px"
  xl: "24px"
components:
  button:
    backgroundColor: "{colors.graphite-raised}"
    textColor: "{colors.paper-white}"
    rounded: "{rounded.control}"
    padding: "6px 12px"
  button-primary:
    backgroundColor: "{colors.safelight-amber}"
    textColor: "{colors.amber-ink}"
    rounded: "{rounded.control}"
    padding: "6px 12px"
  segment-on:
    backgroundColor: "{colors.safelight-amber}"
    textColor: "{colors.amber-ink}"
    rounded: "{rounded.segment}"
  card:
    backgroundColor: "{colors.graphite-surface}"
    rounded: "{rounded.card}"
    padding: "16px"
---

# Design System: RawBoy Web

<!-- Draft from web/src/styles.css and web/src/packer/packer.css for the owner to confirm. The North Star name and
     colour names below are proposals. -->

## Overview

**Creative North Star (proposed): "The Darkroom Bench".** A dark, low-glare workspace where the only warm light is
the safelight amber marking the current choice. Chrome is flat and quiet so the photo and its true colours carry the
page. Dense where the controls are, never decorative. Anti-references: gradients, glows, coloured panels or tinted
backgrounds near the photo, marketing-style hero sections.

## Colors

- **Ink Black** `#121212`: page background.
- **Graphite Surface** `#1c1c1e` and **Graphite Raised** `#26262a`: panels and controls, one step lighter each.
- **Hairline** `#333338`: borders and row dividers.
- **Paper White** `#ececec` text; **Ash Muted** `#9a9aa2` for labels and hints.
- **Safelight Amber** `#e8a33d` with **Amber Ink** `#1a1206` on it: the selected segment, the primary action, links and
  focus. One accent only.
- **Warning Red** `#ff6b6b`: errors and "won't open" marks. Packer also uses green (`#6fcf73`) for "opens".
- The photo area is neutral: no accent or tint touches it.

## Typography

The system font stack throughout (fast, native on each platform; intentional, not a default left in place). Body 14px
at 1.4; labels and hints 12 to 13px in Ash Muted; titles 18px; page title 26px bold. Text below 12px is used only
for badges and is being phased out.

## Layout

Editor: a photo area plus a 340px sidebar on desktop, stacked in portrait. Breakpoints are width based (900, 760,
560, 440, 380px) with orientation rules for phone landscape; `pointer: coarse` enlarges touch targets. Packer is one
scrolling page, max 1180px: settings and summary side by side above 860px, files below.

## Elevation & Depth

Flat, tonal layering (bg → surface → raised) with hairline borders. Shadows only on floating menus and dialogs
(`0 4px 24px rgba(0,0,0,.5)`).

## Shapes

Small, consistent radii: 6px chips, 7px segments inside a 9px segmented track, 8px buttons, 12px cards, pills only
for the import-mode switch. Circles for slider thumbs and handles.

## Components

- **Segmented control** and **chips**: the choice widgets; the selected option fills with amber in both.
- **Buttons**: graphite with a hairline; the single primary action per area is amber; `.text` buttons are amber text.
- **Cards** (Packer): graphite surface, hairline, 12px radius, 16px padding. Rows inside are divided by hairlines,
  not nested cards.
- **Sliders**: centre-filled amber track from the default value; double tap resets.

## Do's and Don'ts

- Do keep one amber thing per decision: the current choice or the main action.
- Do show the effect of a choice in words next to it (hints, live summary).
- Don't tint, glow or colour anything around the photo.
- Don't introduce new fonts, gradients or a second accent.
- Don't nest cards; use spacing and hairlines.
