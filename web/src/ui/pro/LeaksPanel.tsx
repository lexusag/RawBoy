import { useState } from 'react';
import {
  FILM_LEAK_LABELS,
  FILM_LEAK_TYPES,
  FILM_PALETTES,
  FILM_PALETTE_LABELS,
  filmPaletteCss,
  newVariation,
  sideMove,
  type FilmLeak,
  type FilmLeakType,
} from '../../engine/develop/FilmLeaks';
import {
  LEAK_DEFAULTS,
  LEAK_HUE,
  LEAK_HUE_MAX,
  LEAK_HUE_MIN,
  LEAK_KINDS,
  LEAK_TEXTURE,
  LEAK_WARP,
  MAX_LEAKS,
  ROUND_RADII,
  leakCss,
  leakReshaped,
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
  filmLeaks?: readonly FilmLeak[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onAdd: (kind: LeakKind) => void;
  onUpdate: (id: string, change: (l: LightLeak) => LightLeak, force?: boolean) => void;
  onRemove: (id: string) => void;
  onAddFilm?: (type?: FilmLeakType) => void;
  onRollFilm?: (type: FilmLeakType | 'any') => void;
  onUpdateFilm?: (id: string, change: (l: FilmLeak) => FilmLeak, force?: boolean) => void;
  onRemoveFilm?: (id: string) => void;
  onDone: () => void;
}

const SIDE_ARROWS: readonly [number, string, string][] = [
  [0, '←', 'From left edge'],
  [1, '↑', 'From top edge'],
  [2, '→', 'From right edge'],
  [3, '↓', 'From bottom edge'],
];

/**
 * Light leaks: film-style light (streaks, glows, triangles) dragged into place on the photo, e.g. to tastefully cover
 * part of a nude, plus the procedural film leak generator (edge burns, sprocket holes, fog, end/start of roll, film
 * tear, dust & scratches, chemical stains). A top-bar mode like Masks; the shapes are moved and sized on the photo
 * (MaskOverlay) or with these sliders.
 */
export function LeaksPanel({
  leaks,
  filmLeaks = [],
  selectedId,
  onSelect,
  onAdd,
  onUpdate,
  onRemove,
  onAddFilm,
  onRollFilm,
  onUpdateFilm,
  onRemoveFilm,
  onDone,
}: Props) {
  const [genType, setGenType] = useState<FilmLeakType | 'any'>('any');
  const leak = leaks.find((l) => l.id === selectedId) ?? null;
  const filmLeak = filmLeaks.find((l) => l.id === selectedId) ?? null;
  const set = (change: (l: LightLeak) => LightLeak, force = false) => leak && onUpdate(leak.id, change, force);
  const setFilm = (change: (l: FilmLeak) => FilmLeak, force = false) => filmLeak && onUpdateFilm?.(filmLeak.id, change, force);
  const total = leaks.length + filmLeaks.length;
  const full = total >= MAX_LEAKS;
  const canRoll = genType === 'any' ? leaks.length < MAX_LEAKS : !full || filmLeak != null || filmLeaks.length > 0;
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
      {onRollFilm && (
        <div className="leak-generate">
          <div className="section-label">Generate</div>
          <div className="chips">
            <button type="button" className={genType === 'any' ? 'active' : ''} onClick={() => setGenType('any')}>
              Any
            </button>
            {FILM_LEAK_TYPES.map((t) => (
              <button key={t} type="button" className={genType === t ? 'active' : ''} onClick={() => setGenType(t)}>
                {FILM_LEAK_LABELS[t]}
              </button>
            ))}
          </div>
          <div className="button-row">
            <button type="button" className="primary" disabled={!canRoll} onClick={() => onRollFilm(genType)}>
              🎲 Random
            </button>
            {filmLeak && (
              <button type="button" className="text" onClick={() => setFilm((l) => newVariation(l, Math.random()), true)}>
                New variation
              </button>
            )}
            {onAddFilm && (
              <button type="button" className="text" disabled={full} onClick={() => onAddFilm(genType === 'any' ? undefined : genType)}>
                + Add
              </button>
            )}
          </div>
        </div>
      )}
      {total === 0 && (
        <Note>
          Press <strong>🎲 Random</strong> to generate a film leak or defect, or add a hand-placed streak, glow or triangle above, then drag it over the photo.
          The grain stays on top. Up to {MAX_LEAKS} layers; generated leaks can be saved in presets under the Light leaks group.
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
      {filmLeaks.map((l, i) => (
        <div key={l.id} className={`preset-row mask-row${l.id === selectedId ? ' active' : ''}`}>
          <input
            type="checkbox"
            checked={l.enabled}
            title={l.enabled ? 'Hide leak' : 'Show leak'}
            onChange={(e) => onUpdateFilm?.(l.id, (x) => ({ ...x, enabled: e.target.checked }), true)}
          />
          <button type="button" className="preset-apply" onClick={() => onSelect(l.id)}>
            <span className="preset-name">
              <span className="leak-swatch" style={{ background: filmPaletteCss(l.palette) }} />
              {FILM_LEAK_LABELS[l.type]} {i + 1}
            </span>
            <span className="preset-groups">{`${FILM_PALETTE_LABELS[l.palette]} · ${Math.round(l.intensity)}%`}</span>
          </button>
          <button type="button" className="icon" title="Delete leak" onClick={() => onRemoveFilm?.(l.id)}>
            ×
          </button>
        </div>
      ))}
      {filmLeak && (
        <>
          <div className="chips" role="group" aria-label="Leak type">
            {FILM_LEAK_TYPES.map((t) => (
              <button key={t} type="button" className={filmLeak.type === t ? 'active' : ''} onClick={() => setFilm((l) => ({ ...l, type: t }), true)}>
                {FILM_LEAK_LABELS[t]}
              </button>
            ))}
          </div>
          <div className="chips" role="group" aria-label="Palette">
            {FILM_PALETTES.map((p) => (
              <button key={p} type="button" className={filmLeak.palette === p ? 'active' : ''} onClick={() => setFilm((l) => ({ ...l, palette: p }), true)}>
                <span className="leak-swatch" style={{ background: filmPaletteCss(p), marginRight: 5 }} />
                {FILM_PALETTE_LABELS[p]}
              </button>
            ))}
          </div>
          <div className="button-row" role="group" aria-label="Source edge">
            {filmLeak.type === 'scratches' || filmLeak.type === 'dust' ? (
              <>
                <button
                  type="button"
                  title="Horizontal scratches"
                  className={filmLeak.turn % 2 === 1 ? 'primary' : 'text'}
                  onClick={() => setFilm((l) => sideMove(l, 1), true)}
                >
                  ↔ Horizontal
                </button>
                <button
                  type="button"
                  title="Vertical scratches"
                  className={filmLeak.turn % 2 === 0 ? 'primary' : 'text'}
                  onClick={() => setFilm((l) => sideMove(l, 0), true)}
                >
                  ↕ Vertical
                </button>
              </>
            ) : (
              SIDE_ARROWS.map(([t, arrow, title]) => (
                <button
                  key={t}
                  type="button"
                  title={title}
                  className={filmLeak.turn === t ? 'primary' : 'text'}
                  onClick={() => setFilm((l) => sideMove(l, t), true)}
                >
                  {arrow}
                </button>
              ))
            )}
            <button
              type="button"
              className={filmLeak.mirror ? 'primary' : 'text'}
              onClick={() => setFilm((l) => ({ ...l, mirror: !l.mirror }), true)}
            >
              Flip
            </button>
          </div>
          <ParamSlider
            label="Intensity"
            value={filmLeak.intensity}
            min={0}
            max={100}
            defaultValue={85}
            format={(v) => `${Math.round(v)}%`}
            onChange={(v) => setFilm((l) => ({ ...l, intensity: v }))}
          />
          <ParamSlider
            label="Softness"
            value={filmLeak.softness}
            min={0}
            max={100}
            defaultValue={50}
            format={formatPlain}
            onChange={(v) => setFilm((l) => ({ ...l, softness: v }))}
          />
          <ParamSlider
            label="Texture"
            value={filmLeak.texture}
            min={0}
            max={100}
            defaultValue={65}
            format={formatPlain}
            onChange={(v) => setFilm((l) => ({ ...l, texture: v }))}
          />
          <ParamSlider
            label="Amount"
            value={filmLeak.amount}
            min={0}
            max={100}
            defaultValue={55}
            format={formatPlain}
            onChange={(v) => setFilm((l) => ({ ...l, amount: v }))}
          />
          <ParamSlider
            label="Variant"
            value={filmLeak.variant}
            min={0}
            max={100}
            defaultValue={50}
            format={formatPlain}
            onChange={(v) => setFilm((l) => ({ ...l, variant: v }))}
          />
          <div className="section-label">Colour adjustment</div>
          <ParamSlider
            label="Warmth"
            value={filmLeak.warmth}
            min={-100}
            max={100}
            defaultValue={0}
            format={signed}
            onChange={(v) => setFilm((l) => ({ ...l, warmth: v }))}
          />
          <ParamSlider
            label="Tint"
            value={filmLeak.tint}
            min={-100}
            max={100}
            defaultValue={0}
            format={signed}
            onChange={(v) => setFilm((l) => ({ ...l, tint: v }))}
          />
          <ParamSlider
            label="Fade"
            value={filmLeak.fade}
            min={0}
            max={100}
            defaultValue={0}
            format={formatPlain}
            onChange={(v) => setFilm((l) => ({ ...l, fade: v }))}
          />
          <ParamSlider
            label="Contrast"
            value={filmLeak.contrast}
            min={-100}
            max={100}
            defaultValue={0}
            format={signed}
            onChange={(v) => setFilm((l) => ({ ...l, contrast: v }))}
          />
          <Note>
            Drag inside the box to move it, or drag the 8 edge and corner handles to stretch it along x and y. The solid line marks the edge the leak or defect enters from.
          </Note>
        </>
      )}
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
          <ParamSlider label="Warp" value={leak.warp} min={0} max={100} defaultValue={LEAK_WARP} format={formatPlain} onChange={(v) => set((l) => ({ ...l, warp: v }))} />
          <ParamSlider
            label="Texture"
            value={leak.texture}
            min={0}
            max={100}
            defaultValue={LEAK_TEXTURE}
            format={formatPlain}
            onChange={(v) => set((l) => ({ ...l, texture: v }))}
          />
          <ParamSlider
            label="Cover"
            value={leak.cover}
            min={0}
            max={100}
            defaultValue={100}
            format={(v) => `${Math.round(v)}%`}
            onChange={(v) => set((l) => ({ ...l, cover: v }))}
          />
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
          {(leak.warp > 0 || leak.texture > 0 || leakReshaped(leak)) && (
            <div className="button-row">
              {(leak.warp > 0 || leak.texture > 0) && (
                <button type="button" className="text" onClick={() => set((l) => ({ ...l, seed: newLeakSeed() }), true)}>
                  New pattern
                </button>
              )}
              {leakReshaped(leak) && (
                <button type="button" className="text" onClick={() => set((l) => ({ ...l, radii: ROUND_RADII }), true)}>
                  Round outline
                </button>
              )}
            </div>
          )}
          <Note>
            Drag the leak to move it, the dots to resize ({leak.kind === 'streak' ? 'side dots: width, end dots: length' : 'along and across'}),
            {leak.kind === 'glow' ? ' the hollow dots to reshape its outline around what it should hide,' : ''} the round knob to turn it, the square
            to bend it. Warp makes the outline organic (it only grows), Texture burns the light in like film (white, yellow, orange, red; mottled and
            streaked), Cover hides the photo in its whitish middle completely (make the leak a little larger than what it hides). Texture 0 and Warp 0 give the clean Photoshop look. Leaks aren’t saved in
            presets: they belong to this photo.
          </Note>
        </>
      )}
    </div>
  );
}
