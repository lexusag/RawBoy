import type { HelpSection } from '../common/HelpDialog';
import { driveConfigured } from '../../drive/protocol';

/** The RawBoy tab's "?" sheet. Keep it in step with the controls (Readme's Controls table). */
export const PRO_HELP: HelpSection[] = [
  {
    title: 'Basics',
    items: [
      { how: 'RawBoy · Auto · Browser', text: 'Switch between the apps (top left; top of the screen on phones).' },
      { how: 'Open, or drop a file', text: 'Opens a RAW file, or a JPEG, HEIC, PNG or TIFF (lower quality than RAW). Dropped .cube and HaldCLUT .png files go to Your LUTs.' },
      ...(driveConfigured() ? [{ how: 'Google Drive', text: 'Open › From Google Drive picks a photo in your Drive; Export › Save to Google Drive puts the export in a Drive folder you pick. RawBoy only sees the files you pick and the ones it saves.' }] : []),
      { how: 'Tabs', text: 'Light, Color, Detail, LUTs and Lens hold the sliders. Edits carry over to the next photo; crop, rotation, flips and scale don\'t.' },
      { how: 'Lens preset', text: 'Lens tab: name it (the lens by default) and Save lens preset keeps its settings for this photo\'s lens; the Auto tab corrects every photo taken with that lens with it, on top of its look. Manual lenses record no lens: the Auto tab lets you pick their presets by name.' },
      { how: 'Top bar', text: 'Crop & rotate (turn, flip, straighten, Vertical and Horizontal perspective, scale, crop), Presets, Masks, Light leaks, Effects, Undo and Redo (Ctrl/⌘ Z, Shift Ctrl/⌘ Z), Reset all, Auto Dev (automatic light and colour, keeps the LUT) and Export.' },
      { how: 'Looks', text: 'Click the photo to see the area there through every LUT and film stock as vertical stripes; click a stripe to use that LUT (Film off) or stock (Film on). Drag the window to look elsewhere, also past the photo\'s edges (it shows a quick copy while moving and the exact pixels once it rests). Several pages when the looks do not fit (‹ ›, or the arrow keys), at most 8 looks a page. Esc closes it.' },
      { how: 'Back to Auto', text: 'Returns a photo opened from the Auto tab (Edit in RawBoy) there with these edits; Send to Auto adds any other photo to Auto\'s batch with them.' },
    ],
  },
  {
    title: 'Photo',
    items: [
      { keys: ['Z'], how: 'double-click', text: '100% view at the pointer; again to go back to the whole photo. Drag to pan.' },
      { how: 'Mouse wheel over the photo', text: 'Zoom in and out around the pointer, from a quarter of the whole photo (stops once at the whole photo, so masks and light leaks can be placed outside its edges) up to 400% (stops once at 100%). A trackpad pinch works too; double-click goes back to the whole photo.' },
      { how: 'Pinch (touch screens)', text: 'Two fingers zoom around their middle, up to 400% (stops once at 100%), and pan with it; the finger left keeps panning. Out past the whole photo shrinks it to a quarter; a double-tap goes back to the whole photo.' },
      { how: 'Press and hold', text: 'Compare with the as-shot render.' },
      { keys: ['\\'], how: 'or Compare', text: 'Show the as-shot render until pressed again.' },
      { how: 'Click outside the photo', text: 'Change the frame around it: grey, white or black.' },
      { how: 'Histogram', text: 'Above the tabs: red, green and blue levels of the developed photo, with the share of crushed shadows (left) and clipped highlights (right). Click it to mark them blue and red on the photo.' },
    ],
  },
  {
    title: 'Sliders and tools',
    items: [
      { how: 'Double-click a slider', text: 'Reset it (clicking its value does too).' },
      { how: 'Mouse wheel over a slider', text: 'Move it without clicking; with Shift in big steps, with Ctrl/⌘ in fine ones. A wheel that is scrolling the panel keeps scrolling it.' },
      { how: 'Mouse wheel over Film or stock', text: 'Step through the film stocks without clicking. A wheel scrolling the panel leaves it alone.' },
      { how: 'Pick white balance', text: 'Color tab: click something neutral grey and Temperature and Tint make it grey. Auto WB solves them for a draggable extendable rectangle; Reset WB returns to as-shot defaults.' },
      { how: 'Curves', text: 'Light tab: click the box to add a point, drag it, double-click it to remove. On touch, press on the curve or a point; elsewhere the box scrolls. RGB, then Red, Green and Blue.' },
      { how: 'Detail', text: 'Luma and Color denoise work separately. Local contrast brings out texture; High-pass contrast is wider clarity. Portrait retouch cleans up skin like Reblum\'s Natural (40 is about Reblum Natural 40): spots, under-eyes, lines and unevenness, pores kept. Fake anamorphic flare adds horizontal cinema streaks (Neutral, Blue, Golden or Magenta, with optional faint Ghosts; big lit windows and signs do not flare). Tap Grain\'s name for its size, roughness and color.' },
      { how: 'Lens', text: 'Embedded profile, Distortion, Horizontal distortion (bows verticals like an anamorphic lens), Crop (0 auto-crops empty edges; negative shows the curved edges, positive crops tighter), Fisheye (straightens a fisheye lens towards rectilinear; set the lens field of view, and for a circular fisheye the size and centre of its image circle), Vignetting and Chromatic aberration.' },
      { how: 'Presets', text: 'Save the edits by group, apply, import and export .rawboy.json files. Select to batch-delete or export.' },
    ],
  },
  {
    title: 'Masks',
    items: [
      { keys: ['B'], text: 'Brush (adds a brush layer if none is selected)' },
      { keys: ['E'], text: 'Erase' },
      { keys: ['V'], text: 'Move: drag a gradient\'s or stripe\'s lines and handles' },
      { keys: ['[', ']'], text: 'Smaller or larger brush' },
      { keys: ['Space'], text: 'Hold to pan while zoomed' },
      { keys: ['Mod+Z'], text: 'Undo (each stroke is one step); with Shift, Redo' },
    ],
  },
  {
    title: 'Light leaks',
    items: [
      { how: '+ Streak, + Glow, + Triangle', text: 'Adds a film-style light leak (up to 4), made like a Photoshop one: a white shape with an orange and a red glow, in Screen mode, so the photo shows through the glow and the grain stays on top. Drag it anywhere inside to move it, the dots to resize, a glow\'s hollow dots to reshape its outline (Round outline undoes it), the round knob to turn it, the square to bend it. The switch changes the selected leak\'s shape.' },
      { how: 'Intensity, Cover', text: 'Cover at 100% hides everything in the leak\'s whitish middle (about half way out to its outline), however the light falls on it; make the leak a little larger than what it hides: a natural-looking way to cover part of a nude for social media. Cover 0 lets the photo show through the light; Intensity fades the whole leak.' },
      { how: 'Bend, Taper, Warp, Texture', text: 'Bend curves the leak into an arc, Taper narrows it towards one end, Warp makes its outline organic (it only grows). Texture burns the light in like film: white in the middle, yellow, orange and red towards the edge, mottled and streaked. New pattern picks another warp and texture.' },
      { how: 'Softness, Glow, Colour', text: 'Softness blurs the white core, Glow sets how far the coloured light reaches, Colour goes from magenta-red to amber. Leaks belong to the photo: presets don\'t keep them.' },
    ],
  },
  {
    title: 'Effects',
    items: [
      { how: '+ Lightning, + Sparks, + Trails, + Swirl', text: 'Adds a lomo light effect (up to 4): a forked lightning bolt, an electric spark cluster, streaks of moving light or neon swirls, a new random one each press. It glows into the photo like light double-exposed onto film and the grain stays on top. Drag inside it to move it, the dots to size it, the round knob to turn it; the switch changes the selected effect\'s kind.' },
      { how: 'New random', text: 'Draws a new random pattern with the same size, colour and settings: press it until you like one.' },
      { how: 'Branches, Thickness, Glow, Colour, Colour mix', text: 'Branches (Sparks, Strands) sets how much there is, Thickness the line width, Glow how far the coloured glow and soft halo reach, Colour the hue and Colour mix how far each line may drift from it (sparks in blue, violet and green). Effects belong to the photo: presets don\'t keep them.' },
    ],
  },
];
