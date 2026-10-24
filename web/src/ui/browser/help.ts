import type { HelpSection } from '../common/HelpDialog';

/** The Browser tab's "?" sheet. Keep it in step with the controls (Readme's RawBoy Browser section). */
export const BROWSER_HELP: HelpSection[] = [
  {
    title: 'Basics',
    items: [
      { how: 'Open, or drop a folder', text: 'Shows the folder\'s photos from the previews inside the raws. A RAW + JPEG pair is one photo.' },
      { how: 'Ratings', text: 'Saved as you go in XMP sidecars next to the raws (NAME.xmp), which Lightroom, Capture One and darktable read. Rejects are rating −1.' },
      { how: 'Move rejects to bin', text: 'Moves the rejects, their sidecars and JPEGs into the folder\'s _bin subfolder. Nothing is deleted; Bin restores them.' },
      { how: 'Shoot date, File name', text: 'The grid shows the photos in the order they were shot (each file\'s EXIF date, else its file date), or by file name; remembered in this browser.' },
      { how: 'Send to Auto', text: 'Adds photos to the Auto tab: the picks, those with at least or exactly N stars (rejects left out), or what the grid shows.' },
      { how: 'Edits in sidecars', text: 'Off at first. When on, RawBoy and Auto save their edits of photos from here in the photos\' sidecars; opening the folder again (Reopen) puts the photos Auto edited back into Auto.' },
      { how: 'Safari, Firefox', text: 'They can\'t write to folders: pick the photos (and any .xmp files), and Save ratings downloads the sidecars as a ZIP.' },
    ],
  },
  {
    title: 'Selecting photos',
    items: [
      { how: 'Mod-click or long-press', text: 'Start selecting; then click to add or remove photos.' },
      { how: 'Shift-click', text: 'Select every photo between the last one picked and this one.' },
      { keys: ['Mod+A'], text: 'Select every photo the grid shows' },
      { keys: ['Esc'], text: 'Clear the selection' },
      { how: 'Rate', text: 'Stars, Pick and Reject (the bar below the grid, or the keys) act on every selected photo; the same key again, when they all have it, clears it. One Undo takes it back.' },
      { how: 'Send to Auto', text: 'Add only the selected photos to the Auto tab.' },
    ],
  },
  {
    title: 'Culling',
    items: [
      { keys: ['1', '2', '3', '4', '5'], text: 'Stars (the same number again clears them)' },
      { keys: ['0'], text: 'No stars' },
      { keys: ['P'], text: 'Pick (again: unflag)' },
      { keys: ['X'], text: 'Reject (again: unflag)' },
      { keys: ['U'], text: 'Unflag' },
      { keys: ['Mod+Z'], text: 'Undo the last rating or move to the bin' },
      { how: 'Auto-advance', text: 'In the photo view, rating goes on to the next photo.' },
    ],
  },
  {
    title: 'Moving around',
    items: [
      { keys: ['←', '→', '↑', '↓'], text: 'Move through the grid; in the photo view, previous or next' },
      { keys: ['Enter', 'Space'], how: 'click', text: 'Open the photo' },
      { keys: ['Esc', 'G'], text: 'Back to the grid' },
      { keys: ['Z'], how: 'double-click', text: '1:1 view of the preview at the pointer; drag to pan' },
      { keys: ['E'], text: 'Edit the photo in the RawBoy tab' },
    ],
  },
];
