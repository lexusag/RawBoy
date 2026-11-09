import { FX_DEFAULTS, FX_KINDS, MAX_EFFECTS, fxCss, newFxSeed, withFxKind, type FxKind, type LightEffect } from '../../engine/develop/LightEffects';
import { ParamSlider, formatPlain } from '../common/ParamSlider';
import { Note } from './Controls';

/** Exponential slider 0..100 <-> [min]..[max], so small sizes are easy to set. */
const expSlider = (min: number, max: number) => ({
  to: (r: number) => (100 * Math.log(Math.min(max, Math.max(min, r)) / min)) / Math.log(max / min),
  from: (v: number) => min * (max / min) ** (v / 100),
});
/** The effect's mean radius (fraction of the long side). */
const SIZE = expSlider(0.03, 1);
const sizeOf = (e: LightEffect) => Math.sqrt(e.rx * e.ry);
/** Stretch slider -100..100 <-> rx / ry, 1/4..4. */
const stretchOf = (e: Pick<LightEffect, 'rx' | 'ry'>) => (100 * Math.log(e.rx / e.ry)) / Math.log(4);
const percent = (r: number) => `${Math.round(r * 200)}%`;

/** The full hue circle for the Colour slider. */
const HUE_TRACK = [0, 60, 120, 180, 240, 300, 360].map(fxCss);
const hueName = (h: number) => {
  const d = ((h % 360) + 360) % 360;
  return d < 15 ? 'Red' : d < 45 ? 'Orange' : d < 70 ? 'Yellow' : d < 160 ? 'Green' : d < 200 ? 'Cyan' : d < 250 ? 'Blue' : d < 290 ? 'Violet' : d < 335 ? 'Magenta' : 'Red';
};

export const FX_NAMES: Record<FxKind, string> = { lightning: 'Lightning', sparks: 'Sparks', trails: 'Trails', swirl: 'Swirl' };
const AMOUNT_NAMES: Record<FxKind, string> = { lightning: 'Branches', sparks: 'Sparks', trails: 'Strands', swirl: 'Strands' };

interface Props {
  effects: readonly LightEffect[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onAdd: (kind: FxKind) => void;
  onUpdate: (id: string, change: (e: LightEffect) => LightEffect, force?: boolean) => void;
  onRemove: (id: string) => void;
  onDone: () => void;
}

/**
 * Light effects ("lomo" effects): lightning, electric sparks, light trails and neon swirls, generated at random and
 * dragged into place on the photo like light leaks. A top-bar mode like Leaks; the effect's box is moved, sized and
 * turned on the photo (MaskOverlay) or with these sliders.
 */
export function FxPanel({ effects, selectedId, onSelect, onAdd, onUpdate, onRemove, onDone }: Props) {
  const fx = effects.find((e) => e.id === selectedId) ?? null;
  const set = (change: (e: LightEffect) => LightEffect, force = false) => fx && onUpdate(fx.id, change, force);
  const full = effects.length >= MAX_EFFECTS;
  return (
    <div className="controls geometry">
      <div className="geometry-head">
        <div className="fx-add">
          {FX_KINDS.map((k) => (
            <button key={k} type="button" onClick={() => onAdd(k)} disabled={full} title={`Add ${FX_NAMES[k].toLowerCase()} (a new random one each time)`}>
              + {FX_NAMES[k]}
            </button>
          ))}
        </div>
        <button type="button" className="text" onClick={onDone}>
          Done
        </button>
      </div>
      {effects.length === 0 && (
        <Note>
          Add lightning, electric sparks, light trails or a neon swirl: each press makes a new random one. Drag it over the photo, size and turn
          it with its dots, and press New random until you like it. The light glows into the photo like a double exposure and the grain stays on
          top. Up to {MAX_EFFECTS}; effects reset for each new photo.
        </Note>
      )}
      {effects.map((e, i) => (
        <div key={e.id} className={`preset-row mask-row${e.id === selectedId ? ' active' : ''}`}>
          <input
            type="checkbox"
            checked={e.enabled}
            title={e.enabled ? 'Hide effect' : 'Show effect'}
            onChange={(ev) => onUpdate(e.id, (x) => ({ ...x, enabled: ev.target.checked }), true)}
          />
          <button type="button" className="preset-apply" onClick={() => onSelect(e.id)}>
            <span className="preset-name">
              <span className="leak-swatch" style={{ background: fxCss(e.hue) }} />
              {FX_NAMES[e.kind]} {i + 1}
            </span>
            <span className="preset-groups">{`${hueName(e.hue)} · ${Math.round(e.intensity)}%`}</span>
          </button>
          <button type="button" className="icon" title="Delete effect" onClick={() => onRemove(e.id)}>
            ×
          </button>
        </div>
      ))}
      {fx && (
        <>
          <div className="button-row fx-random">
            <button type="button" onClick={() => set((e) => ({ ...e, seed: newFxSeed() }), true)} title="A new random pattern, same size and colour">
              <DiceIcon /> New random
            </button>
          </div>
          <div className="segmented" role="group" aria-label="Effect">
            {FX_KINDS.map((k) => (
              <button key={k} type="button" className={fx.kind === k ? 'active' : ''} onClick={() => set((e) => withFxKind(e, k), true)}>
                {FX_NAMES[k]}
              </button>
            ))}
          </div>
          <ParamSlider
            label="Intensity"
            value={fx.intensity}
            min={0}
            max={100}
            defaultValue={100}
            format={(v) => `${Math.round(v)}%`}
            onChange={(v) => set((e) => ({ ...e, intensity: v }))}
          />
          <ParamSlider
            label={AMOUNT_NAMES[fx.kind]}
            value={fx.amount}
            min={0}
            max={100}
            defaultValue={FX_DEFAULTS[fx.kind].amount}
            format={formatPlain}
            onChange={(v) => set((e) => ({ ...e, amount: v }))}
          />
          <ParamSlider
            label="Size"
            value={SIZE.to(sizeOf(fx))}
            min={0}
            max={100}
            defaultValue={SIZE.to(Math.sqrt(FX_DEFAULTS[fx.kind].rx * FX_DEFAULTS[fx.kind].ry))}
            format={(v) => percent(SIZE.from(v))}
            onChange={(v) =>
              set((e) => {
                const k = SIZE.from(v) / sizeOf(e);
                return { ...e, rx: e.rx * k, ry: e.ry * k };
              })
            }
          />
          <ParamSlider
            label="Stretch"
            value={stretchOf(fx)}
            min={-100}
            max={100}
            defaultValue={stretchOf(FX_DEFAULTS[fx.kind])}
            format={(v) => `${(4 ** (v / 100)).toFixed(2)}:1`}
            onChange={(v) =>
              set((e) => {
                const s = sizeOf(e);
                const ratio = 4 ** (v / 100);
                return { ...e, rx: s * Math.sqrt(ratio), ry: s / Math.sqrt(ratio) };
              })
            }
          />
          <ParamSlider
            label="Rotation"
            value={fx.angle}
            min={-180}
            max={180}
            defaultValue={FX_DEFAULTS[fx.kind].angle}
            format={(v) => `${Math.round(v)}°`}
            onChange={(v) => set((e) => ({ ...e, angle: v }))}
          />
          <ParamSlider
            label="Thickness"
            value={fx.thickness}
            min={0}
            max={100}
            defaultValue={FX_DEFAULTS[fx.kind].thickness}
            format={formatPlain}
            onChange={(v) => set((e) => ({ ...e, thickness: v }))}
          />
          <ParamSlider
            label="Glow"
            value={fx.glow}
            min={0}
            max={100}
            defaultValue={FX_DEFAULTS[fx.kind].glow}
            format={formatPlain}
            onChange={(v) => set((e) => ({ ...e, glow: v }))}
          />
          <ParamSlider
            label="Colour"
            value={fx.hue}
            min={0}
            max={360}
            defaultValue={FX_DEFAULTS[fx.kind].hue}
            format={hueName}
            trackGradient={HUE_TRACK}
            onChange={(v) => set((e) => ({ ...e, hue: v }))}
          />
          <ParamSlider
            label="Colour mix"
            value={fx.spread}
            min={0}
            max={100}
            defaultValue={FX_DEFAULTS[fx.kind].spread}
            format={formatPlain}
            onChange={(v) => set((e) => ({ ...e, spread: v }))}
          />
          <Note>
            Drag inside the box to move the effect, the dots to size it along and across, the round knob to turn it. New random draws a new pattern
            with the same settings. Colour mix lets each line drift from the colour (sparks in blue, violet and green). Effects aren’t saved in
            presets: they belong to this photo.
          </Note>
        </>
      )}
    </div>
  );
}

function DiceIcon() {
  return (
    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} style={{ verticalAlign: '-3px', marginRight: 4 }} aria-hidden="true">
      <rect x={3} y={3} width={18} height={18} rx={4} />
      <circle cx={8} cy={8} r={1.3} fill="currentColor" stroke="none" />
      <circle cx={16} cy={16} r={1.3} fill="currentColor" stroke="none" />
      <circle cx={12} cy={12} r={1.3} fill="currentColor" stroke="none" />
      <circle cx={16} cy={8} r={1.3} fill="currentColor" stroke="none" />
      <circle cx={8} cy={16} r={1.3} fill="currentColor" stroke="none" />
    </svg>
  );
}
