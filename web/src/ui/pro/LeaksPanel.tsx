import {
  LEAK_DEFAULTS,
  LEAK_HUE,
  LEAK_HUE_MAX,
  LEAK_HUE_MIN,
  LEAK_KINDS,
  MAX_LEAKS,
  leakCss,
  newLeakSeed,
  withLeakKind,
  type LeakKind,
  type LightLeak,
} from '../../engine/develop/LightLeaks';
import { ParamSlider, formatPlain } from '../common/ParamSlider';
import { Note } from './Controls';

/** Exponential slider 0..100 <-> [min]..[max], so small sizes are easy to set. */
const expSlider = (min: number, max: number) => ({
  to: (r: number) => (100 * Math.log(Math.min(max, Math.max(min, r)) / min)) / Math.log(max / min),
  from: (v: number) => min * (max / min) ** (v / 100),
});
/** A glow's or triangle's mean radius; a streak's half width and half length (fractions of the long side). */
const SIZE = expSlider(0.02, 0.8);
const WIDTH = expSlider(0.003, 0.3);
const LENGTH = expSlider(0.1, 1.5);
const sizeOf = (l: LightLeak) => Math.sqrt(l.rx * l.ry);
/** Stretch slider -100..100 <-> rx / ry, 1/4..4. */
const stretchOf = (l: LightLeak) => (100 * Math.log(l.rx / l.ry)) / Math.log(4);
const percent = (r: number) => `${(r * 200).toFixed(r < 0.05 ? 1 : 0)}%`;
const signed = (v: number) => (Math.round(v) > 0 ? `+${Math.round(v)}` : String(Math.round(v)));

/** Inner glow colours across the Colour slider. */
const HUE_TRACK = [LEAK_HUE_MIN, -20, 0, 20, 40, LEAK_HUE_MAX].map(leakCss);

const hueName = (h: number) => (h < -15 ? 'Magenta' : h < 10 ? 'Red' : h < 45 ? 'Orange' : 'Amber');

const KIND_NAMES: Record<LeakKind, string> = { streak: 'Streak', glow: 'Glow', triangle: 'Triangle' };

interface Props {
  leaks: readonly LightLeak[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onAdd: (kind: LeakKind) => void;
  onUpdate: (id: string, change: (l: LightLeak) => LightLeak, force?: boolean) => void;
  onRemove: (id: string) => void;
  onDone: () => void;
}

/**
 * Light leaks: film-style light (streaks, glows, triangles) dragged into place on the photo, e.g. to tastefully cover
 * part of a nude. A top-bar mode like Masks; the shapes are moved, sized, turned and bent on the photo (MaskOverlay) or
 * with these sliders.
 */
export function LeaksPanel({ leaks, selectedId, onSelect, onAdd, onUpdate, onRemove, onDone }: Props) {
  const leak = leaks.find((l) => l.id === selectedId) ?? null;
  const set = (change: (l: LightLeak) => LightLeak, force = false) => leak && onUpdate(leak.id, change, force);
  const full = leaks.length >= MAX_LEAKS;
  return (
    <div className="controls geometry">
      <div className="geometry-head">
        <div className="button-row leak-add">
          {LEAK_KINDS.map((k) => (
            <button key={k} type="button" onClick={() => onAdd(k)} disabled={full}>
              + {KIND_NAMES[k]}
            </button>
          ))}
        </div>
        <button type="button" className="text" onClick={onDone}>
          Done
        </button>
      </div>
      {leaks.length === 0 && (
        <Note>
          Add a film-style light leak (a streak of light, a round glow or a triangle), then drag it over the photo. It is added in Screen mode,
          so the photo shows through its glow; at full intensity its white middle (inside the dashed line) hides what is under it, so it can
          cover part of a photo. The grain stays on top. Up to {MAX_LEAKS}; leaks reset for each new photo.
        </Note>
      )}
      {leaks.map((l, i) => (
        <div key={l.id} className={`preset-row mask-row${l.id === selectedId ? ' active' : ''}`}>
          <input
            type="checkbox"
            checked={l.enabled}
            title={l.enabled ? 'Hide leak' : 'Show leak'}
            onChange={(e) => onUpdate(l.id, (x) => ({ ...x, enabled: e.target.checked }), true)}
          />
          <button type="button" className="preset-apply" onClick={() => onSelect(l.id)}>
            <span className="preset-name">
              <span className="leak-swatch" style={{ background: leakCss(l.hue) }} />
              {KIND_NAMES[l.kind]} {i + 1}
            </span>
            <span className="preset-groups">{`${hueName(l.hue)} · ${Math.round(l.intensity)}%`}</span>
          </button>
          <button type="button" className="icon" title="Delete leak" onClick={() => onRemove(l.id)}>
            ×
          </button>
        </div>
      ))}
      {leak && (
        <>
          <div className="segmented" role="group" aria-label="Shape">
            {LEAK_KINDS.map((k) => (
              <button key={k} type="button" className={leak.kind === k ? 'active' : ''} onClick={() => set((l) => withLeakKind(l, k), true)}>
                {KIND_NAMES[k]}
              </button>
            ))}
          </div>
          <ParamSlider
            label="Intensity"
            value={leak.intensity}
            min={0}
            max={100}
            defaultValue={100}
            format={(v) => `${Math.round(v)}%`}
            onChange={(v) => set((l) => ({ ...l, intensity: v }))}
          />
          {leak.kind === 'streak' ? (
            <>
              <ParamSlider
                label="Width"
                value={WIDTH.to(leak.ry)}
                min={0}
                max={100}
                defaultValue={WIDTH.to(LEAK_DEFAULTS.streak.ry)}
                format={(v) => percent(WIDTH.from(v))}
                onChange={(v) => set((l) => ({ ...l, ry: WIDTH.from(v) }))}
              />
              <ParamSlider
                label="Length"
                value={LENGTH.to(leak.rx)}
                min={0}
                max={100}
                defaultValue={LENGTH.to(LEAK_DEFAULTS.streak.rx)}
                format={(v) => percent(LENGTH.from(v))}
                onChange={(v) => set((l) => ({ ...l, rx: LENGTH.from(v) }))}
              />
            </>
          ) : (
            <>
              <ParamSlider
                label="Size"
                value={SIZE.to(sizeOf(leak))}
                min={0}
                max={100}
                defaultValue={SIZE.to(Math.sqrt(LEAK_DEFAULTS[leak.kind].rx * LEAK_DEFAULTS[leak.kind].ry))}
                format={(v) => percent(SIZE.from(v))}
                onChange={(v) =>
                  set((l) => {
                    const k = SIZE.from(v) / sizeOf(l);
                    return { ...l, rx: l.rx * k, ry: l.ry * k };
                  })
                }
              />
              <ParamSlider
                label="Stretch"
                value={stretchOf(leak)}
                min={-100}
                max={100}
                defaultValue={stretchOf({ ...leak, ...LEAK_DEFAULTS[leak.kind] })}
                format={(v) => `${(4 ** (v / 100)).toFixed(2)}:1`}
                onChange={(v) =>
                  set((l) => {
                    const s = sizeOf(l);
                    const ratio = 4 ** (v / 100);
                    return { ...l, rx: s * Math.sqrt(ratio), ry: s / Math.sqrt(ratio) };
                  })
                }
              />
            </>
          )}
          <ParamSlider
            label="Rotation"
            value={leak.angle}
            min={-180}
            max={180}
            defaultValue={LEAK_DEFAULTS[leak.kind].angle}
            format={(v) => `${Math.round(v)}°`}
            onChange={(v) => set((l) => ({ ...l, angle: v }))}
          />
          <ParamSlider label="Bend" value={leak.bend} min={-100} max={100} defaultValue={0} format={signed} onChange={(v) => set((l) => ({ ...l, bend: v }))} />
          <ParamSlider label="Taper" value={leak.taper} min={-100} max={100} defaultValue={0} format={signed} onChange={(v) => set((l) => ({ ...l, taper: v }))} />
          <ParamSlider label="Warp" value={leak.warp} min={0} max={100} defaultValue={0} format={formatPlain} onChange={(v) => set((l) => ({ ...l, warp: v }))} />
          <ParamSlider
            label="Softness"
            value={leak.softness}
            min={0}
            max={100}
            defaultValue={LEAK_DEFAULTS[leak.kind].softness}
            format={formatPlain}
            onChange={(v) => set((l) => ({ ...l, softness: v }))}
          />
          <ParamSlider
            label="Glow"
            value={leak.glow}
            min={0}
            max={100}
            defaultValue={LEAK_DEFAULTS[leak.kind].glow}
            format={formatPlain}
            onChange={(v) => set((l) => ({ ...l, glow: v }))}
          />
          <ParamSlider
            label="Colour"
            value={leak.hue}
            min={LEAK_HUE_MIN}
            max={LEAK_HUE_MAX}
            defaultValue={LEAK_HUE}
            format={hueName}
            trackGradient={HUE_TRACK}
            onChange={(v) => set((l) => ({ ...l, hue: v }))}
          />
          {leak.warp > 0 && (
            <div className="button-row">
              <button type="button" className="text" onClick={() => set((l) => ({ ...l, seed: newLeakSeed() }), true)}>
                New warp
              </button>
            </div>
          )}
          <Note>
            Drag the leak to move it, the dots to resize ({leak.kind === 'streak' ? 'side dots: width, end dots: length' : 'along and across'}),
            the round knob to turn it, the square to bend it. Inside the dashed line it is pure white at full intensity; the glow around it is
            added in Screen mode. Leaks aren’t saved in presets: they belong to this photo.
          </Note>
        </>
      )}
    </div>
  );
}
