import { HEAL_RADIUS_MAX, HEAL_RADIUS_MIN, MAX_HEAL_SPOTS, type HealSpot } from '../../engine/develop/HealSpots';
import { ParamSlider } from '../common/ParamSlider';
import { Note } from './Controls';

/** Brush size slider 0..100 <-> radius, exponential so small spots are easy to set. */
export const healSize = {
  to: (r: number) => (100 * Math.log(Math.min(HEAL_RADIUS_MAX, Math.max(HEAL_RADIUS_MIN, r)) / HEAL_RADIUS_MIN)) / Math.log(HEAL_RADIUS_MAX / HEAL_RADIUS_MIN),
  from: (v: number) => HEAL_RADIUS_MIN * (HEAL_RADIUS_MAX / HEAL_RADIUS_MIN) ** (v / 100),
};

/** What new strokes start with: the Size and Feather sliders set this and never touch strokes already painted. */
export interface HealBrush {
  radius: number;
  feather: number;
  /** New spots clone from a source circle you place (otherwise the engine picks the texture donor). */
  chooseSource: boolean;
  /** Where a new stroke's source lies relative to its start (image fractions), when [chooseSource]. */
  offset: readonly [number, number];
}

interface Props {
  spots: readonly HealSpot[];
  selectedId: string | null;
  brush: HealBrush;
  /** The photo is being healed (the full-resolution image is redone and its previews rebuilt). */
  working: boolean;
  onSelect: (id: string | null) => void;
  onBrush: (brush: HealBrush) => void;
  onUpdate: (id: string, change: (s: HealSpot) => HealSpot, force?: boolean) => void;
  onRemove: (id: string) => void;
  onClear: () => void;
  onDone: () => void;
}

/**
 * Healing brush: click, tap or paint over a dust spot, blemish or small object on the photo (HealOverlay) and it is
 * healed away: seamless cloning, the tone from around it, the detail borrowed from a nearby clean area that the engine
 * picks, or from a source you drag into place (clone-stamp style). A top-bar mode like Masks and Light leaks.
 */
export function HealPanel({ spots, selectedId, brush, working, onSelect, onBrush, onUpdate, onRemove, onClear, onDone }: Props) {
  const spot = spots.find((s) => s.id === selectedId) ?? null;
  // Size and Feather belong to the brush: they only apply to strokes painted afterwards, never to ones already there.
  const radius = brush.radius;
  const feather = brush.feather;
  const chooseSource = spot ? spot.source != null : brush.chooseSource;
  const full = spots.length >= MAX_HEAL_SPOTS;

  const setRadius = (r: number) => {
    onBrush({ ...brush, radius: r });
  };
  const setFeather = (f: number) => {
    onBrush({ ...brush, feather: f });
  };
  const setChoose = (choose: boolean) => {
    onBrush({ ...brush, chooseSource: choose });
    if (!spot) return;
    onUpdate(
      spot.id,
      (s) => ({ ...s, source: choose ? [Math.min(1, Math.max(0, s.x + brush.offset[0])), Math.min(1, Math.max(0, s.y + brush.offset[1]))] : null }),
      true,
    );
  };

  return (
    <div className="controls geometry">
      <div className="geometry-head">
        <strong className="heal-title">Healing brush</strong>
        <button type="button" className="text" onClick={onDone}>
          Done
        </button>
      </div>
      {spots.length === 0 && (
        <Note>
          Paint over a dust spot, blemish or small object on the photo to heal it away: click for one spot, drag to paint a stroke (zoom to 100%
          for the fine ones: double-click or Z; Space pans). The tone is filled in from around it and the detail borrowed from a nearby clean
          area. Up to {MAX_HEAL_SPOTS} strokes; they belong to this photo and aren’t kept in presets.
        </Note>
      )}
      <ParamSlider
        label="Size"
        value={healSize.to(radius)}
        min={0}
        max={100}
        defaultValue={healSize.to(0.008)}
        format={(v) => `${(healSize.from(v) * 200).toFixed(1)}%`}
        onChange={(v) => setRadius(healSize.from(v))}
      />
      <ParamSlider label="Feather" value={feather} min={0} max={100} defaultValue={80} format={(v) => `${Math.round(v)}`} onChange={setFeather} />
      <div className="segmented" role="group" aria-label="Texture from">
        <button type="button" className={!chooseSource ? 'active' : ''} onClick={() => setChoose(false)} title="The engine picks the cleanest nearby area">
          Auto source
        </button>
        <button type="button" className={chooseSource ? 'active' : ''} onClick={() => setChoose(true)} title="A dashed circle you drag to the area to copy from">
          Choose source
        </button>
      </div>
      {working && <Note>Healing…</Note>}
      {full && <Note>That is the most strokes a photo takes; delete one to add another.</Note>}
      {spots.map((s, i) => (
        <div key={s.id} className={`preset-row mask-row${s.id === selectedId ? ' active' : ''}`}>
          <button type="button" className="preset-apply" onClick={() => onSelect(s.id === selectedId ? null : s.id)}>
            <span className="preset-name">{s.path.length ? 'Stroke' : 'Spot'} {i + 1}</span>
            <span className="preset-groups">{`${s.source ? 'Chosen source' : 'Auto source'} · ${(s.radius * 200).toFixed(1)}%`}</span>
          </button>
          <button type="button" className="icon" title="Delete" onClick={() => onRemove(s.id)}>
            ×
          </button>
        </div>
      ))}
      {spots.length > 0 && (
        <>
          <div className="button-row">
            <button type="button" className="text" onClick={onClear}>
              Clear all
            </button>
          </div>
          <Note>
            Pick a stroke in the list to change its size, feather or source. With Choose source, drag the dashed copy onto clean skin, sky or
            background of the same kind as the surroundings; new strokes keep that offset. Undo removes the last stroke, Delete the selected
            one, [ and ] change the size.
          </Note>
        </>
      )}
    </div>
  );
}
