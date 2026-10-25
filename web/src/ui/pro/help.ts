import type { HelpSection } from '../common/HelpDialog';

/** The RawBoy tab's "?" sheet. Keep it in step with the controls (Readme's Controls table). */
export const PRO_HELP: HelpSection[] = [
  {
    title: 'Basics',
    items: [
      { how: 'RawBoy · Auto · Browser', text: 'Switch between the apps (top left; top of the screen on phones).' },
      { how: 'Open, or drop a file', text: 'Opens a RAW file. Dropped .cube and HaldCLUT .png files go to Your LUTs.' },
      { how: 'Tabs', text: 'Light, Color, Detail, LUTs and Lens hold the sliders. Edits carry over to the next photo; crop, rotation and flips don\'t.' },
      { how: 'Lens preset', text: 'Lens tab: name it (the lens by default) and Save lens preset keeps its settings for this photo\'s lens; the Auto tab corrects every photo taken with that lens with it, on top of its look. Manual lenses record no lens: the Auto tab lets you pick their presets by name.' },
      { how: 'Top bar', text: 'Crop & rotate (turn, flip, straighten, crop), Presets, Masks, Light leaks, Undo and Redo (Ctrl/⌘ Z, Shift Ctrl/⌘ Z), Reset all, Auto (automatic light and colour, keeps the LUT) and Export.' },
      { how: 'Back to Auto', text: 'Returns a photo opened from the Auto tab (Edit in RawBoy) there with these edits; Send to Auto adds any other photo to Auto\'s batch with them.' },
    ],
  },
  {
    title: 'Photo',
    items: [
      { keys: ['Z'], how: 'double-click', text: '100% view at the pointer; again to go back to the whole photo. Drag to pan.' },
      { how: 'Mouse wheel over the photo', text: 'Zoom in and out around the pointer, up to 400% (stops once at 100%); out past the whole photo goes back to it. A trackpad pinch works too.' },
      { how: 'Pinch (touch screens)', text: 'Two fingers zoom around their middle, up to 400% (stops once at 100%), and pan with it; the finger left keeps panning. Out past the whole photo goes back to it.' },
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
      { how: 'Pick white balance', text: 'Color tab: click something neutral grey and Temperature and Tint make it grey.' },
      { how: 'Curves', text: 'Light tab: click the box to add a point, drag it, double-click it to remove. On touch, press on the curve or a point; elsewhere the box scrolls. RGB, then Red, Green and Blue.' },
      { how: 'Detail', text: 'Luma and Color denoise work separately. Local contrast brings out texture; High-pass contrast is wider clarity. Tap Grain\'s name for its size, roughness and color.' },
      { how: 'Presets', text: 'Save the edits by group, apply, import and export .rawboy.json files.' },
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
      { how: '+ Streak, + Glow, + Triangle', text: 'Adds a film-style light leak (up to 4), made like a Photoshop one: a white shape with an orange and a red glow, in Screen mode, so the photo shows through the glow and the grain stays on top. Drag it anywhere inside to move it, the dots to resize, the round knob to turn it, the square to bend it. The switch changes the selected leak\'s shape.' },
      { how: 'Intensity', text: 'At 100% the white middle (inside the dashed line) hides what is under it: a tasteful way to cover part of a nude. Lower, the light lets the photo through.' },
      { how: 'Bend, Taper, Warp', text: 'Bend curves the leak into an arc, Taper narrows it towards one end, Warp makes its edge uneven (New warp picks another).' },
      { how: 'Softness, Glow, Colour', text: 'Softness blurs the white core, Glow sets how far the coloured light reaches, Colour goes from magenta-red to amber. Leaks belong to the photo: presets don\'t keep them.' },
    ],
  },
];
