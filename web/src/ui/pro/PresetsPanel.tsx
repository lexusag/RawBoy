import { useState } from 'react';
import { DEFAULT_PRESET_GROUPS, PRESET_GROUPS, presetSections, type Preset, type PresetGroup } from '../../engine/develop/Presets';
import { pickFiles } from '../common/files';
import { Note, SectionLabel } from './Controls';

/** What the Presets panel can do (port of app-pro's PresetActions). */
export interface PresetActions {
  apply: (p: Preset) => void;
  save: (name: string, groups: PresetGroup[]) => void;
  update: (p: Preset) => void;
  rename: (p: Preset, name: string) => void;
  delete: (p: Preset) => void;
  export: (list: Preset[]) => void;
  import: (file: File) => void;
}

export const groupSummary = (p: Preset) => PRESET_GROUPS.filter((g) => p.groups.includes(g.key)).map((g) => g.label).join(' · ');

/**
 * Opened from the top bar in place of the slider tabs: saved presets (click to apply, menu to update, rename, export
 * or delete) and saving the current edits (port of app-pro's PresetsPanel.kt).
 */
export function PresetsPanel({ presets, actions, onDone, hasStrokes = false }: {
  presets: Preset[];
  actions: PresetActions;
  onDone: () => void;
  /** The photo has brush strokes (which presets don't keep): the save dialog says so. */
  hasStrokes?: boolean;
}) {
  const [saving, setSaving] = useState(false);
  const [renaming, setRenaming] = useState<Preset | null>(null);
  const [menu, setMenu] = useState<string | null>(null);

  const importFile = async () => {
    const [file] = await pickFiles(false, '.json,application/json');
    if (file) actions.import(file);
  };

  return (
    <div className="controls geometry presets">
      <div className="geometry-head">
        <strong>Presets</strong>
        <button type="button" className="text" onClick={onDone}>
          Done
        </button>
      </div>
      <div className="button-row">
        <button type="button" onClick={() => setSaving(true)}>Save current…</button>
        <button type="button" className="text" onClick={importFile}>Import</button>
        <button type="button" className="text" onClick={() => actions.export(presets)} disabled={presets.length === 0}>
          Export all
        </button>
      </div>
      {presets.length === 0 && (
        <Note>
          No presets yet. Save the current edits (any groups of sliders) to reuse them on other photos. Rotation, flips, straightening and crop are never
          part of a preset.
        </Note>
      )}
      {presetSections(presets).map((section) => (
        <div key={section.label ?? 'all'}>
          {section.label && <SectionLabel>{section.label}</SectionLabel>}
          {section.presets.map((p) => (
            <div key={p.id} className="preset-row">
              <button type="button" className="preset-apply" onClick={() => actions.apply(p)} title="Apply">
                <span className="preset-name">{p.name}</span>
                <span className="preset-groups">{groupSummary(p)}</span>
              </button>
              <div className="preset-menu">
                <button type="button" className="icon" title="Preset options" onClick={() => setMenu(menu === p.id ? null : p.id)}>⋮</button>
                {menu === p.id && (
                  <div className="menu" onMouseLeave={() => setMenu(null)}>
                    <button type="button" onClick={() => { setMenu(null); actions.update(p); }}>Update from current</button>
                    <button type="button" onClick={() => { setMenu(null); setRenaming(p); }}>Rename</button>
                    <button type="button" onClick={() => { setMenu(null); actions.export([p]); }}>Export</button>
                    <button
                      type="button"
                      onClick={() => {
                        setMenu(null);
                        if (window.confirm(`Delete “${p.name}”?`)) actions.delete(p);
                      }}
                    >
                      Delete
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      ))}
      {saving && (
        <PresetDialog
          title="Save preset"
          confirm="Save"
          initialName=""
          withGroups
          hasStrokes={hasStrokes}
          onDismiss={() => setSaving(false)}
          onConfirm={(name, groups) => {
            setSaving(false);
            actions.save(name, groups);
          }}
        />
      )}
      {renaming && (
        <PresetDialog
          title="Rename preset"
          confirm="Rename"
          initialName={renaming.name}
          withGroups={false}
          onDismiss={() => setRenaming(null)}
          onConfirm={(name) => {
            actions.rename(renaming, name);
            setRenaming(null);
          }}
        />
      )}
    </div>
  );
}

function PresetDialog({ title, confirm, initialName, withGroups, hasStrokes = false, onDismiss, onConfirm }: {
  title: string;
  confirm: string;
  initialName: string;
  withGroups: boolean;
  hasStrokes?: boolean;
  onDismiss: () => void;
  onConfirm: (name: string, groups: PresetGroup[]) => void;
}) {
  const [name, setName] = useState(initialName);
  const [groups, setGroups] = useState<PresetGroup[]>([...DEFAULT_PRESET_GROUPS]);
  const valid = name.trim() !== '' && (!withGroups || groups.length > 0);
  const allGroups = groups.length === PRESET_GROUPS.length;
  const submit = () => valid && onConfirm(name, groups);
  return (
    <div className="dialog-backdrop" onClick={onDismiss}>
      <div className="dialog" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={title}>
        <h2>{title}</h2>
        <label className="field">
          <span>Name</span>
          <input type="text" value={name} autoFocus onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} />
        </label>
        {withGroups && (
          <div className="field">
            <div className="preset-include">
              <span>Include</span>
              <button type="button" className="text" onClick={() => setGroups(allGroups ? [] : PRESET_GROUPS.map((g) => g.key))}>
                {allGroups ? 'Deselect all' : 'Select all'}
              </button>
            </div>
            {PRESET_GROUPS.map((g) => (
              <label key={g.key} className="preset-group">
                <input
                  type="checkbox"
                  checked={groups.includes(g.key)}
                  onChange={(e) => setGroups(e.target.checked ? [...groups, g.key] : groups.filter((k) => k !== g.key))}
                />
                {g.label}
              </label>
            ))}
            {hasStrokes && groups.includes('masks') && <small>Brush strokes aren’t saved in presets: they belong to this photo.</small>}
          </div>
        )}
        <div className="dialog-actions">
          <button type="button" className="text" onClick={onDismiss}>Cancel</button>
          <button type="button" className="primary" onClick={submit} disabled={!valid}>{confirm}</button>
        </div>
      </div>
    </div>
  );
}
