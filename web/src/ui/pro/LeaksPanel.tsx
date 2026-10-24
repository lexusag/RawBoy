import { LEAK_HUE_MAX, LEAK_HUE_MIN, MAX_LEAKS, leakCss, type LightLeak } from '../../engine/develop/LightLeaks';
import { ParamSlider, formatPlain } from '../common/ParamSlider';
import { Note } from './Controls';

/** Size slider 0..100 <-> the leak's mean radius (fraction of the long side), exponential so small leaks are easy to set. */
const MIN_SIZE = 0.02;
const MAX_SIZE = 0.8;
const sizeOf = (l: LightLeak) => Math.sqrt(l.rx * l.ry);
const sizeToSlider = (r: number) => (100 * Math.log(Math.min(MAX_SIZE, Math.max(MIN_SIZE, r)) / MIN_SIZE)) / Math.log(MAX_SIZE / MIN_SIZE);
const sliderToSize = (v: number) => MIN_SIZE * (MAX_SIZE / MIN_SIZE) ** (v / 100);
/** Stretch slider -100..100 <-> width / height, 1/4..4. */
const stretchOf = (l: LightLeak) => (100 * Math.log(l.rx / l.ry)) / Math.log(4);

/** Rim colours across the Colour slider. */
const HUE_TRACK = [LEAK_HUE_MIN, -20, 0, 20, 40, LEAK_HUE_MAX].map(leakCss);

const hueName = (h: number) => (h < -15 ? 'Magenta' : h < 10 ? 'Red' : h < 38 ? 'Orange' : 'Amber');

interface Props {
  leaks: readonly LightLeak[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onAdd: () => void;
  onUpdate: (id: string, change: (l: LightLeak) => LightLeak, force?: boolean) => void;
  onRemove: (id: string) => void;
  onDone: () => void;
}

/**
 * Light leaks: film-style warm glows dragged into place on the photo, e.g. to tastefully cover part of a nude. A
 * top-bar mode like Masks; the shapes are moved and sized on the photo (MaskOverlay) or with these sliders.
 */
export function LeaksPanel({ leaks, selectedId, onSelect, onAdd, onUpdate, onRemove, onDone }: Props) {
  const leak = leaks.find((l) => l.id === selectedId) ?? null;
  const set = (change: (l: LightLeak) => LightLeak, force = false) => leak && onUpdate(leak.id, change, force);
  return (
    <div className="controls geometry">
      <div className="geometry-head">
        <button type="button" onClick={onAdd} disabled={leaks.length >= MAX_LEAKS}>+ Light leak</button>
        <button type="button" className="text" onClick={onDone}>
          Done
        </button>
      </div>
      {leaks.length === 0 && (
        <Note>
          Add a film-style light leak, then drag it over the photo. At full intensity its solid middle (inside the dashed ring) hides what is
          under it, so it can cover part of a photo; lower, it is a warm glow. Up to {MAX_LEAKS}; leaks reset for each new photo.
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
              Light leak {i + 1}
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
          <ParamSlider
            label="Intensity"
            value={leak.intensity}
            min={0}
            max={100}
            defaultValue={100}
            format={(v) => `${Math.round(v)}%`}
            onChange={(v) => set((l) => ({ ...l, intensity: v }))}
          />
          <ParamSlider
            label="Size"
            value={sizeToSlider(sizeOf(leak))}
            min={0}
            max={100}
            defaultValue={sizeToSlider(Math.sqrt(0.16 * 0.11))}
            format={(v) => `${Math.round(sliderToSize(v) * 200)}%`}
            onChange={(v) =>
              set((l) => {
                const k = sliderToSize(v) / sizeOf(l);
                return { ...l, rx: l.rx * k, ry: l.ry * k };
              })
            }
          />
          <ParamSlider
            label="Stretch"
            value={stretchOf(leak)}
            min={-100}
            max={100}
            defaultValue={0}
            format={(v) => `${(4 ** (v / 100)).toFixed(2)}:1`}
            onChange={(v) =>
              set((l) => {
                const s = sizeOf(l);
                const ratio = 4 ** (v / 100);
                return { ...l, rx: s * Math.sqrt(ratio), ry: s / Math.sqrt(ratio) };
              })
            }
          />
          <ParamSlider
            label="Rotation"
            value={leak.angle}
            min={-180}
            max={180}
            defaultValue={0}
            format={(v) => `${Math.round(v)}°`}
            onChange={(v) => set((l) => ({ ...l, angle: v }))}
          />
          <ParamSlider
            label="Softness"
            value={leak.softness}
            min={0}
            max={100}
            defaultValue={50}
            format={formatPlain}
            onChange={(v) => set((l) => ({ ...l, softness: v }))}
          />
          <ParamSlider
            label="Colour"
            value={leak.hue}
            min={LEAK_HUE_MIN}
            max={LEAK_HUE_MAX}
            defaultValue={22}
            format={hueName}
            trackGradient={HUE_TRACK}
            onChange={(v) => set((l) => ({ ...l, hue: v }))}
          />
          <div className="button-row">
            <button type="button" className="text" onClick={() => set((l) => ({ ...l, seed: Math.round(Math.random() * 1000) / 1000 }), true)}>
              New shape
            </button>
          </div>
          <Note>
            Drag the leak to move it, the dots to resize, the outer knob to rotate. Inside the dashed ring it is solid at 100% intensity;
            it fades out towards the solid ring. Leaks aren’t saved in presets: they belong to this photo.
          </Note>
        </>
      )}
    </div>
  );
}
