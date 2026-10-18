import { decodePresets, encodePresets, type Preset } from '../../engine/develop/Presets';

const KEY = 'rawboy.presets';

/** The user's presets in localStorage, as a preset file (the same format as exported files; port of PresetStore.kt). */
export const PresetStore = {
  load(): Preset[] {
    try {
      const text = localStorage.getItem(KEY);
      return text ? decodePresets(text) : [];
    } catch {
      return [];
    }
  },

  /** False when the browser won't store them (private window, quota). */
  save(presets: readonly Preset[]): boolean {
    try {
      // Always an array, so one preset doesn't change the stored shape.
      localStorage.setItem(KEY, presets.length === 1 ? `[${encodePresets(presets)}]` : encodePresets(presets));
      return true;
    } catch {
      return false;
    }
  },
};
