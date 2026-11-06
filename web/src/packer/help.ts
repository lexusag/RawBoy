import type { HelpSection } from '../ui/common/HelpDialog';

/** The RawBoy Packer page's "?" sheet. Keep it in step with docs/packer.md. */
export const PACKER_HELP: HelpSection[] = [
  {
    title: 'Basics',
    items: [
      { how: 'Add, or drop files', text: 'Repackages camera raws (ARW, RAF, CR3, NEF, ORF…) and DNGs as smaller DNGs. Runs locally in your browser: no upload.' },
      { how: 'Pack as', text: 'Small raw (lossy JPEG XL, smallest for keeping raws), Lossless (lossless JPEG, maximum compatibility: opens in every raw developer), Micro (resized linear DNG for sharing), or Lossless JPEG XL (bit-exact, smaller).' },
      { how: 'Pack to folder / Downloads', text: 'Pack saves directly into a folder you pick (Chrome, Edge) or downloads files one by one. Original files are never modified.' },
      { how: 'Stop', text: 'Stops after the files currently being packed; finished files stay.' },
    ],
  },
  {
    title: 'Queue and folders',
    items: [
      { how: 'Folder headers', text: 'When folders are added, files are grouped by folder. Click any folder header to collapse or expand it; Expand all and Collapse all toggle every folder.' },
      { how: 'Sort: Shoot date, File name', text: 'Orders the queue by EXIF shoot date (from camera metadata), or alphabetically by file name; remembered in this browser.' },
      { how: 'Thumbnails', text: 'Click any thumbnail to open a full-size preview modal.' },
      { how: 'Clear finished', text: 'Removes completed and failed files from the queue; pending files stay.' },
      { how: '✕ Remove', text: 'Removes an individual file or an entire folder from the list.' },
    ],
  },
  {
    title: 'Photo preview',
    items: [
      { keys: ['Esc'], text: 'Close the preview modal' },
      { keys: ['←', '↑'], how: 'swipe right', text: 'Previous photo in queue' },
      { keys: ['→', '↓'], how: 'swipe left', text: 'Next photo in queue' },
    ],
  },
  {
    title: 'Settings and features',
    items: [
      { how: 'Lens corrections', text: 'Keeps Sony and Fujifilm in-camera distortion, vignetting and chromatic aberration corrections as DNG opcodes.' },
      { how: 'Location', text: 'Keep GPS tags from the raw, or remove them for privacy.' },
      { how: 'Settings in file name', text: 'Appends format and quality to output names (e.g. DSC001-small-high.dng).' },
      { how: 'When done', text: 'Shows a summary pop-up when packing finishes, and a system notification if the tab is in the background.' },
      { how: 'Advanced settings', text: 'Fine-tune JPEG XL quality distance, compression effort, embedded preview size, and parallel worker count.' },
    ],
  },
  {
    title: 'Back to maximum compatibility',
    items: [
      { how: 'JPEG XL DNG to Lossless', text: 'A JPEG XL DNG (Small raw, Lossless JPEG XL, Micro, or from a phone) can be added again and packed as Lossless: the result is a classic lossless JPEG DNG (DNG 1.4) that older Lightroom, darktable and Apple Photos open.' },
    ],
  },
];
