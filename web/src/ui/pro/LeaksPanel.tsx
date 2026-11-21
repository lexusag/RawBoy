import { useEffect, useState } from 'react';
import {
  FILM_LEAK_LABELS,
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

/** Procedural film leak types grouped for the type dropdowns. */
const FILM_LEAK_GROUPS: readonly { label: string; types: readonly FilmLeakType[] }[] = [
  { label: 'Light', types: ['edge', 'blob', 'streak', 'rebate', 'flare', 'fog'] },
  { label: 'Roll & frame', types: ['sprocket', 'start', 'end', 'tear'] },
  { label: 'Damage', types: ['dust', 'scratches', 'stain'] },
];

interface Props {
  leaks: readonly LightLeak[];
  filmLeaks?: readonly FilmLeak[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onAdd: (kind: LeakKind) => void;
  onUpdate: (id: string, change: (l: LightLeak) => LightLeak, force?: boolean) => void;
  onRemove: (id: string) => void;
  onAddFilm?: (type?: FilmLeakType, shortSideSprockets?: boolean) => void;
  onRollFilm?: (type: FilmLeakType | 'any', shortSideSprockets?: boolean) => void;
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

const hasColourGrade = (l: FilmLeak | null) =>
  l != null && (l.warmth !== 0 || l.tint !== 0 || l.fade !== 0 || l.contrast !== 0);

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
  const [shortSideSprockets, setShortSideSprockets] = useState(false);
  const leak = leaks.find((l) => l.id === selectedId) ?? null;
  const filmLeak = filmLeaks.find((l) => l.id === selectedId) ?? null;
  const gradeEdited = hasColourGrade(filmLeak);
  const [gradeOpen, setGradeOpen] = useState(gradeEdited);
  useEffect(() => {
    setGradeOpen(hasColourGrade(filmLeaks.find((l) => l.id === selectedId) ?? null));
    // Only reset collapse state when switching to a different layer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  const set = (change: (l: LightLeak) => LightLeak, force = false) => leak && onUpdate(leak.id, change, force);
  const setFilm = (change: (l: FilmLeak) => FilmLeak, force = false) => filmLeak && onUpdateFilm?.(filmLeak.id, change, force);
  const total = leaks.length + filmLeaks.length;
  const full = total >= MAX_LEAKS;
  const canRoll = genType === 'any' ? leaks.length < MAX_LEAKS : !full || filmLeak != null || filmLeaks.length > 0;
  const showSprocketOption = genType === 'any' || genType === 'sprocket';
  const isLinearDefect = filmLeak?.type === 'scratches' || filmLeak?.type === 'dust';

  return (
    <div className="controls geometry leaks-panel">
      <div className="geometry-head">
        <strong>Light leaks</strong>
        <button type="button" className="text" onClick={onDone}>
          Done
        </button>
      </div>

      <div className="leak-create">
        {onRollFilm && (
          <>
            <div className="leak-gen-row">
              <select
                aria-label="Film leak type to generate"
                value={genType}
                onChange={(e) => setGenType(e.target.value as FilmLeakType | 'any')}
              >
                <option value="any">Any film leak</option>
                {FILM_LEAK_GROUPS.map((g) => (
                  <optgroup key={g.label} label={g.label}>
                    {g.types.map((t) => (
                      <option key={t} value={t}>
                        {FILM_LEAK_LABELS[t]}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
              <button
                type="button"
                className="primary"
                disabled={!canRoll}
                onClick={() => onRollFilm(genType, shortSideSprockets)}
                title="Roll a random film leak"
              >
                🎲 Random
              </button>
              {onAddFilm && (
                <button
                  type="button"
                  disabled={full}
                  onClick={() => onAddFilm(genType === 'any' ? undefined : genType, shortSideSprockets)}
                  title="Add as a new film leak layer"
                >
                  + Add
                </button>
              )}
            </div>
            {showSprocketOption && (
              <label
                className="leak-option"
                title="Also generate sprocket holes on the short edges; off keeps them on the long edges only"
              >
                <input
                  type="checkbox"
                  checked={shortSideSprockets}
                  onChange={(e) => setShortSideSprockets(e.target.checked)}
                />
                Short-side sprockets
              </label>
            )}
          </>
        )}

        <div className="leak-manual-row">
          <span className="leak-inline-label">Manual</span>
          <div className="leak-manual-buttons">
            {LEAK_KINDS.map((k) => (
              <button key={k} type="button" onClick={() => onAdd(k)} disabled={full}>
                + {KIND_NAMES[k]}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="leak-layers">
        {total === 0 ? (
          <Note>
            Press <strong>🎲 Random</strong> for a procedural film leak, or add a manual shape above. Up to {MAX_LEAKS} layers; generated leaks save in presets.
          </Note>
        ) : (
          <>
            <div className="leak-section-head">
              <span className="section-label">Layers</span>
              <span className="leak-count">
                {total} / {MAX_LEAKS}
              </span>
            </div>
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
          </>
        )}
      </div>

      {filmLeak && (
        <div className="leak-inspector">
          <div className="leak-inspector-head">
            <select
              aria-label="Selected leak type"
              value={filmLeak.type}
              onChange={(e) => setFilm((l) => ({ ...l, type: e.target.value as FilmLeakType }), true)}
            >
              {FILM_LEAK_GROUPS.map((g) => (
                <optgroup key={g.label} label={g.label}>
                  {g.types.map((t) => (
                    <option key={t} value={t}>
                      {FILM_LEAK_LABELS[t]}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            <button
              type="button"
              onClick={() => setFilm((l) => newVariation(l, Math.random()), true)}
              title="Generate a new random variation of this leak"
            >
              New variation
            </button>
          </div>

          <div className="leak-palette">
            <div className="leak-section-head">
              <span className="leak-inline-label">Palette</span>
              <span className="leak-palette-name">{FILM_PALETTE_LABELS[filmLeak.palette]}</span>
            </div>
            <div className="leak-palette-dots" role="radiogroup" aria-label="Palette">
              {FILM_PALETTES.map((p) => (
                <button
                  key={p}
                  type="button"
                  role="radio"
                  aria-checked={filmLeak.palette === p}
                  aria-label={FILM_PALETTE_LABELS[p]}
                  title={FILM_PALETTE_LABELS[p]}
                  className={`leak-swatch-btn${filmLeak.palette === p ? ' active' : ''}`}
                  onClick={() => setFilm((l) => ({ ...l, palette: p }), true)}
                >
                  <span className="leak-swatch-dot" style={{ background: filmPaletteCss(p) }} />
                </button>
              ))}
            </div>
          </div>

          <div className="leak-placement">
            <span className="leak-inline-label">{isLinearDefect ? 'Direction' : 'Edge'}</span>
            <div className="segmented leak-dir" role="group" aria-label={isLinearDefect ? 'Direction' : 'Source edge'}>
              {isLinearDefect ? (
                <>
                  <button
                    type="button"
                    title="Horizontal scratches"
                    className={filmLeak.turn % 2 === 1 ? 'active' : ''}
                    onClick={() => setFilm((l) => sideMove(l, 1), true)}
                  >
                    ↔ Horiz
                  </button>
                  <button
                    type="button"
                    title="Vertical scratches"
                    className={filmLeak.turn % 2 === 0 ? 'active' : ''}
                    onClick={() => setFilm((l) => sideMove(l, 0), true)}
                  >
                    ↕ Vert
                  </button>
                </>
              ) : (
                SIDE_ARROWS.map(([t, arrow, title]) => (
                  <button
                    key={t}
                    type="button"
                    title={title}
                    className={filmLeak.turn === t ? 'active' : ''}
                    onClick={() => setFilm((l) => sideMove(l, t), true)}
                  >
                    {arrow}
                  </button>
                ))
              )}
            </div>
            <button
              type="button"
              className={`leak-flip${filmLeak.mirror ? ' active' : ''}`}
              aria-pressed={filmLeak.mirror}
              onClick={() => setFilm((l) => ({ ...l, mirror: !l.mirror }), true)}
            >
              Flip
            </button>
          </div>

          <div className="section-label">Look</div>
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

          <button
            type="button"
            className="leak-disclosure"
            aria-expanded={gradeOpen}
            onClick={() => setGradeOpen((o) => !o)}
          >
            <span className="section-label">Colour grade</span>
            <span className="leak-disclosure-meta">
              {gradeEdited && <span className="leak-edited-dot" title="Colour grade adjusted" />}
              <span className="leak-chevron" aria-hidden="true">
                {gradeOpen ? '▾' : '▸'}
              </span>
            </span>
          </button>
          {gradeOpen && (
            <div className="leak-grade-sliders">
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
            </div>
          )}

          <Note>
            Drag the box to move, or its 8 handles to stretch. The solid edge marks where the leak enters.
          </Note>
        </div>
      )}

      {leak && (
        <div className="leak-inspector">
          <div className="segmented" role="group" aria-label="Shape">
            {LEAK_KINDS.map((k) => (
              <button key={k} type="button" className={leak.kind === k ? 'active' : ''} onClick={() => set((l) => withLeakKind(l, k), true)}>
                {KIND_NAMES[k]}
              </button>
            ))}
          </div>

          <div className="section-label">Look</div>
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
            label="Cover"
            value={leak.cover}
            min={0}
            max={100}
            defaultValue={100}
            format={(v) => `${Math.round(v)}%`}
            onChange={(v) => set((l) => ({ ...l, cover: v }))}
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

          <div className="section-label">Shape</div>
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

          <div className="section-label">Detail</div>
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
          {(leak.warp > 0 || leak.texture > 0 || leakReshaped(leak)) && (
            <div className="button-row">
              {(leak.warp > 0 || leak.texture > 0) && (
                <button type="button" onClick={() => set((l) => ({ ...l, seed: newLeakSeed() }), true)}>
                  New pattern
                </button>
              )}
              {leakReshaped(leak) && (
                <button type="button" onClick={() => set((l) => ({ ...l, radii: ROUND_RADII }), true)}>
                  Round outline
                </button>
              )}
            </div>
          )}

          <Note>
            Drag on the photo to move, dots to resize, round knob to turn, square to bend.
            {leak.kind === 'glow' ? ' Hollow dots reshape the outline.' : ''} Manual leaks stay on this photo only.
          </Note>
        </div>
      )}
    </div>
  );
}
