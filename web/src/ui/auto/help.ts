import type { HelpSection } from '../common/HelpDialog';

/** The Auto tab's "?" sheet. Keep it in step with the controls (Readme's RawBoy Auto section). */
export const AUTO_HELP: HelpSection[] = [
  {
    title: 'Basics',
    items: [
      { how: 'Add, or drop files', text: 'Each photo is developed automatically and gets a film look. JPEG, HEIC, PNG and TIFF work too, at lower quality.' },
      { how: 'Import as', text: 'Looks (a film LUT on the auto develop) or Film (developed as film), for photos added from now on.' },
      { how: 'Export', text: 'JPEG or TIFF and the size, asked when you press Export all, Export on a selection or the photo view\'s Export; remembered.' },
      { how: 'Apply RawBoy preset…', text: 'Develop every photo with a RawBoy preset instead of a look. Remove goes back to the looks.' },
      { how: 'Export all', text: 'Saves every photo into a folder you pick (or one ZIP).' },
    ],
  },
  {
    title: 'Selecting photos',
    items: [
      { how: 'Mod-click or long-press', text: 'Start selecting; then click to add or remove photos.' },
      { how: 'Shift-click', text: 'Select every photo between the last one picked and this one.' },
      { keys: ['Mod+A'], text: 'Select all' },
      { keys: ['Esc'], text: 'Clear the selection' },
      { how: '↺ ↻, Remove (bin)', text: 'Turn the selected photos 90° or take them out of the batch (the files stay).' },
      { how: 'Preset (bookmarks)', text: 'Develop the selected photos with their own RawBoy preset, e.g. one per scene; the rest keep theirs.' },
      { how: 'Export', text: 'Save only the selected photos, with the same format and size choices as Export all.' },
    ],
  },
  {
    title: 'Photo view',
    items: [
      { keys: ['Space', '→'], how: 'swipe left', text: 'Next photo (also right after using a slider)' },
      { keys: ['Backspace', '←'], how: 'swipe right', text: 'Previous photo' },
      { how: 'Tab to a slider', text: 'Then ← / → move the slider instead; Space and Backspace still change the photo.' },
      { keys: ['Esc'], text: 'Back to the grid' },
      { keys: ['Mod+Z'], text: 'Undo this photo\'s last edit; with Shift, Redo (also the arrows in the top bar)' },
      { how: 'Double-click', text: '100% view; drag to pan, double-click again to go back.' },
      { how: 'Click outside the photo', text: 'Change the frame around it: grey, white or black.' },
      { how: 'Press and hold', text: 'See the photo without the look.' },
      { how: 'Look, Adjust', text: 'Look, Strength, Brightness and Warmth; Adjust has the auto develop\'s own sliders.' },
      { how: 'Apply to all', text: 'Copies the look and its settings to every photo (brightness and denoise stay per photo).' },
      { how: 'Edit in RawBoy', text: 'Opens the photo in the RawBoy tab with this look as the starting edits.' },
    ],
  },
];
