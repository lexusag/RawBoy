import { capturePreset, DEFAULT_PRESET_GROUPS, type Preset, type PresetGroup } from '../../engine/develop/Presets';
import type { DevelopParams } from '../../engine/develop/DevelopParams';

/**
 * The edits Cmd/Ctrl+C took, for Cmd/Ctrl+V. It is a preset made of the chosen groups (by default the ones a new preset
 * ticks: not Lens, Masks, Denoise, Detail or generated leaks; geometry is never in a group), so pasting is applying a
 * preset. Shared by Pro and Auto: edits copied in one can be pasted in the other.
 */
let clipboard: Preset | null = null;

export const COPIED_NAME = 'Copied edits';

/** Copies [params]' [groups] (the preset defaults when omitted); null when no group is chosen. */
export function copyEdits(params: DevelopParams, groups: readonly PresetGroup[] = DEFAULT_PRESET_GROUPS): Preset | null {
  if (groups.length === 0) return null;
  clipboard = capturePreset(COPIED_NAME, params, groups);
  return clipboard;
}

export const copiedEdits = (): Preset | null => clipboard;

/** For tests. */
export const clearCopiedEdits = () => {
  clipboard = null;
};
