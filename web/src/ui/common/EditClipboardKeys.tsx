import { useEffect, useRef, useState, type ReactNode } from 'react';
import { DEFAULT_PRESET_GROUPS, PRESET_GROUPS, type PresetGroup } from '../../engine/develop/Presets';
import { shortcutKey } from './shortcutKey';
import { isTabShown, type TabId } from './tabs';

/** Two presses of Cmd/Ctrl+C within this many ms open the "what to copy" dialog. */
export const DOUBLE_COPY_MS = 600;

function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
  return target instanceof HTMLInputElement && !['button', 'checkbox', 'radio', 'range', 'submit', 'reset', 'file', 'color'].includes(target.type);
}

/**
 * Cmd/Ctrl+C copies the open photo's edits (the preset defaults), pressed again at once it asks which groups, Cmd/Ctrl+V
 * pastes them (see EditClipboard). Left alone while a text field has focus or text is selected, so ordinary copy and
 * paste keep working. [copy] gets the groups to copy (null = the defaults); [paste] pastes. Returns the dialog to render.
 */
export function useEditClipboardKeys(tab: TabId, enabled: boolean, copy: (groups: readonly PresetGroup[] | null) => void, paste: () => void): ReactNode {
  const [asking, setAsking] = useState(false);
  const last = useRef(0);
  const handlers = useRef({ copy, paste, enabled });
  handlers.current = { copy, paste, enabled };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey || e.repeat) return;
      const key = shortcutKey(e);
      if (key !== 'c' && key !== 'v') return;
      if (!isTabShown(tab) || !handlers.current.enabled) return;
      if (isTextEntry(e.target) || document.querySelector('.dialog, [role="dialog"], [aria-modal="true"], dialog[open]')) return;
      if (key === 'c' && !(window.getSelection()?.isCollapsed ?? true)) return; // text is selected: a real copy
      e.preventDefault();
      if (key === 'v') {
        handlers.current.paste();
        return;
      }
      const now = performance.now();
      if (now - last.current < DOUBLE_COPY_MS) {
        last.current = 0;
        setAsking(true);
        return;
      }
      last.current = now;
      handlers.current.copy(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [tab]);
  if (!asking) return null;
  return (
    <CopyGroupsDialog
      onDismiss={() => setAsking(false)}
      onConfirm={(groups) => {
        setAsking(false);
        handlers.current.copy(groups);
      }}
    />
  );
}

/** Which groups of edits to copy (Cmd/Ctrl+C twice), ticked as a new preset's are. */
export function CopyGroupsDialog({ onDismiss, onConfirm }: { onDismiss: () => void; onConfirm: (groups: PresetGroup[]) => void }) {
  const [groups, setGroups] = useState<PresetGroup[]>([...DEFAULT_PRESET_GROUPS]);
  const all = groups.length === PRESET_GROUPS.length;
  const submit = () => groups.length > 0 && onConfirm(groups);
  return (
    <div className="dialog-backdrop" onClick={onDismiss}>
      <div
        className="dialog"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onDismiss();
          else if (e.key === 'Enter') submit();
        }}
        role="dialog"
        aria-label="Copy edits"
      >
        <h2>Copy edits</h2>
        <div className="field">
          <div className="preset-include">
            <span>Include</span>
            <button type="button" className="text" onClick={() => setGroups(all ? [] : PRESET_GROUPS.map((g) => g.key))}>
              {all ? 'Deselect all' : 'Select all'}
            </button>
          </div>
          {PRESET_GROUPS.map((g, i) => (
            <label key={g.key} className="preset-group">
              <input
                type="checkbox"
                autoFocus={i === 0}
                checked={groups.includes(g.key)}
                onChange={(e) => setGroups(e.target.checked ? [...groups, g.key] : groups.filter((k) => k !== g.key))}
              />
              {g.label}
            </label>
          ))}
          <small>Crop, rotation and brush strokes stay with each photo.</small>
        </div>
        <div className="dialog-actions">
          <button type="button" className="text" onClick={onDismiss}>Cancel</button>
          <button type="button" className="primary" onClick={submit} disabled={groups.length === 0}>Copy</button>
        </div>
      </div>
    </div>
  );
}
