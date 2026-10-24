import type { HelpSection } from '../common/HelpDialog';

/** The Auto tab's "?" sheet. Keep it in step with the controls (Readme's RawBoy Auto section). */
export const AUTO_HELP: HelpSection[] = [
  {
    title: 'Basics',
    items: [
      { how: 'Add, or drop files', text: 'Each photo is developed automatically and gets a film look. JPEG, HEIC, PNG and TIFF work too, at lower quality.' },
      { how: 'Import as', text: 'Looks (a film LUT on the auto develop), Film (developed as film) or As is (no automatic edits and no look, a faster import for finished files such as TIFFs: add only a preset, e.g. grain), for photos added from now on.' },
      { how: 'Export', text: 'JPEG or TIFF and the size, asked when you press Export all, Export on a selection or the photo view\'s Export; remembered.' },
      { how: 'Apply RawBoy preset…', text: 'Develop every photo with a RawBoy preset instead of a look. A preset without Light (e.g. only Detail) changes just its own settings, on top of each photo\'s look, preset or RawBoy edits. Remove goes back to the looks.' },
      { how: 'Lens presets', text: 'Lens presets saved in the RawBoy tab\'s Lens tab correct every photo taken with their lens, on top of its look or preset; only the lens settings change. The Lens menu in the grid picks one for every photo (by lens, none, or a named preset, for manual lenses that record no lens); the one in the selection bar for the selected photos, and the one in the photo view for that photo. Manage… removes one.' },
      { how: 'Sort', text: 'Photos are in the order they were shot (from each file\'s EXIF date; a photo without one by its file\'s date). Sort: File name orders them by name instead; remembered in this browser.' },
      { how: 'Auto denoise all', text: 'Once a series is done: every photo gets the denoise and sharpening measured on it (its noise and ISO), in place of what a preset, RawBoy edits or its Denoise slider set. Looks, presets, lens corrections and the other settings stay; Undo in a photo takes it back for that photo.' },
      { how: 'Export all', text: 'Saves every photo into a folder you pick (or one ZIP; on iPhone and iPad, to Photos through the share sheet). Stop ends it after the current photo; saved ones stay.' },
      { how: 'Click a waiting photo', text: 'It\'s analysed next, ahead of the rest (marked Next), and opens when it\'s ready.' },
      { how: 'ISO', text: 'Each photo shows its ISO (from the file) beside its name in the grid and in the bottom-left corner of the photo view, to judge its noise without zooming in.' },
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
      { how: 'Mouse wheel over a slider', text: 'Move it without clicking; with Shift in big steps, with Ctrl/⌘ in fine ones.' },
      { keys: ['Delete'], how: 'Remove (bin)', text: 'Take this photo out of the batch (the file stays) and go on to the next.' },
      { keys: ['Esc'], text: 'Back to the grid' },
      { keys: ['Mod+Z'], text: 'Undo this photo\'s last edit; with Shift, Redo (also the arrows in the top bar)' },
      { how: 'Double-click', text: '100% view; drag to pan, double-click again to go back.' },
      { how: 'Mouse wheel over the photo', text: 'Zoom in and out around the pointer, up to 400%; out past the whole photo goes back to it.' },
      { how: 'Click outside the photo', text: 'Change the frame around it: grey, white or black.' },
      { how: 'Press and hold', text: 'See the photo without the look.' },
      { how: 'Look, Adjust', text: 'Look, Strength, Brightness and Warmth; Adjust has the auto develop\'s own sliders.' },
      { how: 'Apply to all', text: 'Copies the look and its settings to every photo (brightness and denoise stay per photo).' },
      { keys: ['C'], how: 'Copy previous', text: 'Gives this photo the look, brightness and settings of the photo before it (denoise stays).' },
      { how: 'Edit in RawBoy', text: 'Opens the photo in the RawBoy tab with this look as the starting edits. Back to Auto there brings it back with your RawBoy edits, the sliders here adjust on top, and Use a look drops them.' },
    ],
  },
];
