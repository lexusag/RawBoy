import { useState } from 'react';
import {
  CENSOR_EFFECT_NAMES,
  CENSOR_EFFECTS,
  CENSOR_RADIUS_MAX,
  CENSOR_RADIUS_MIN,
  CENSOR_SIZE_MAX,
  CENSOR_SIZE_MIN,
  CENSOR_DEFAULT_SIZES,
  DEFAULT_GLASS_COLOUR,
  DEFAULT_HALFTONE_CONTRAST,
  DEFAULT_HATCHING_CONTRAST,
  DEFAULT_KEEP_COLOUR,
  MAX_CENSOR_LAYERS,
  MAX_CENSOR_STROKES,
  MOSAIC_SHAPES,
  newCensorEllipse,
  newCensorSeed,
  parseColour,
  type CensorEffect,
  type CensorLayer,
  type MosaicShape,
  withCensorEffect,
} from '../../engine/develop/Censor';
import { ParamSlider } from '../common/ParamSlider';
import type { CensorBrush, CensorTool } from './CensorOverlay';
import { Note } from './Controls';

/** Exponential 0..100 slider <-> a value in [lo, hi], so small sizes are easy to set. */
const logScale = (lo: number, hi: number) => ({
  to: (v: number) => (100 * Math.log(Math.min(hi, Math.max(lo, v)) / lo)) / Math.log(hi / lo),
  from: (s: number) => lo * (hi / lo) ** (s / 100),
});
export const censorBrushSize = logScale(CENSOR_RADIUS_MIN, CENSOR_RADIUS_MAX);
const effectSize = logScale(CENSOR_SIZE_MIN, CENSOR_SIZE_MAX);

export const DEFAULT_CENSOR_BRUSH: CensorBrush = {
  radius: 0.03,
  hardness: 50,
  smoothing: 50,
  colour: null,
  colourMix: 100,
};

const SHAPE_NAMES: Record<MosaicShape, string> = {
  square: 'Squares',
  hex: 'Hexagons',
  shards: 'Shards',
};
const TOOL_NAMES: Record<CensorTool, string> = {
  paint: 'Paint',
  erase: 'Erase',
  ellipse: 'Ellipse',
  pick: 'Pick colour',
};
const TOOL_TITLES: Record<CensorTool, string> = {
  paint: 'Paint the effect on (P)',
  erase: 'Take it away again (E, or hold Alt; a pen’s eraser end)',
  ellipse: 'Drag out an ellipse, the quickest cover (Shift: a circle)',
  pick: 'Pick the brush colour from the photo (I)',
};
const RECENT_KEY = 'rawboy.censor.recentColours';
const RECENT_MAX = 8;

const loadRecent = (): string[] => {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((c): c is string => typeof c === 'string' && parseColour(c) != null).slice(0, RECENT_MAX) : [];
  } catch {
    return [];
  }
};

/** Remembers [colour] at the front of the recent colours (this browser). */
export function rememberCensorColour(colour: string) {
  const list = [colour, ...loadRecent().filter((c) => c !== colour)].slice(0, RECENT_MAX);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(list));
  } catch {
    // Storage full or off: recent colours just aren't kept.
  }
}

interface Props {
  layers: readonly CensorLayer[];
  selectedId: string | null;
  tool: CensorTool;
  brush: CensorBrush;
  onSelect: (id: string | null) => void;
  onTool: (tool: CensorTool) => void;
  onBrush: (brush: CensorBrush) => void;
  onAdd: (effect: CensorEffect) => void;
  onUpdate: (id: string, change: (l: CensorLayer) => CensorLayer, force?: boolean) => void;
  onRemove: (id: string) => void;
  onUndoStroke: (id: string) => void;
  onClear: (id: string) => void;
  /** Image fractions of the view's middle, for a new ellipse. */
  viewCentre: () => [number, number];
  onDone: () => void;
}

/**
 * Censor (the Artistic Paintbrush): cover parts of the photo (nudity, for posting) with a painterly effect that hides
 * what is under it completely: oil paint strokes, mosaic, a smear, frosted glass, halftone print, pen hatching or a dry ink brush. Each layer is one
 * effect over what is painted on it (CensorOverlay) and an optional ellipse. A top-bar mode like Healing brush.
 */
export function CensorPanel(props: Props) {
  const { layers, selectedId, tool, brush, onSelect, onTool, onBrush, onAdd, onUpdate, onRemove } = props;
  const layer = layers.find((l) => l.id === selectedId) ?? null;
  const [recent, setRecent] = useState(loadRecent);
  const [hexText, setHexText] = useState<string | null>(null);
  const full = layers.length >= MAX_CENSOR_LAYERS;

  const set = (change: (l: CensorLayer) => CensorLayer, force = false) => layer && onUpdate(layer.id, change, force);
  const pickColour = (c: string | null) => {
    onBrush({ ...brush, colour: c });
    if (c) {
      rememberCensorColour(c);
      setRecent(loadRecent());
    }
  };

  return (
    <div className="controls geometry censor-panel">
      <div className="geometry-head">
        <strong className="heal-title">Censor</strong>
        <button type="button" className="text" onClick={props.onDone}>
          Done
        </button>
      </div>
      {layers.length === 0 && (
        <Note>
          Cover parts of the photo before you post it: add a layer, then paint over the area on the photo, or drag out an ellipse. The effect replaces
          what is underneath completely, before any other edit, so nothing (sharpening, clarity, bloom) can bring it back. It changes only what you
          export; the original file is untouched.
        </Note>
      )}
      {layers.map((l) => (
        <div key={l.id} className={`preset-row mask-row${l.id === selectedId ? ' active' : ''}`}>
          <input
            type="checkbox"
            checked={l.enabled}
            title={l.enabled ? 'Hide layer' : 'Show layer'}
            onChange={(e) => onUpdate(l.id, (x) => ({ ...x, enabled: e.target.checked }), true)}
          />
          <button type="button" className="preset-apply" onClick={() => onSelect(l.id)}>
            <span className="preset-name">{l.name}</span>
            <span className="preset-groups">
              {CENSOR_EFFECT_NAMES[l.effect]} · {l.strokes.length} {l.strokes.length === 1 ? 'stroke' : 'strokes'}
              {l.ellipse ? ' · ellipse' : ''}
              {l.strength < 100 ? ` · ${Math.round(l.strength)}%` : ''}
            </span>
          </button>
          <button
            type="button"
            className="icon"
            title="Delete layer"
            onClick={() => {
              if (window.confirm(`Delete “${l.name}”?`)) onRemove(l.id);
            }}
          >
            ×
          </button>
        </div>
      ))}
      <div className="button-row">
        <button
          type="button"
          className="text"
          disabled={full}
          onClick={() => onAdd(layer?.effect ?? 'paint')}
          title={full ? `Up to ${MAX_CENSOR_LAYERS} layers` : undefined}
        >
          + Layer
        </button>
      </div>

      {layer && (
        <>
          <div className="chips" role="group" aria-label="Effect">
            {CENSOR_EFFECTS.map((e) => (
              <button
                key={e}
                type="button"
                className={`chip${layer.effect === e ? ' active' : ''}`}
                aria-pressed={layer.effect === e}
                onClick={() => set((l) => withCensorEffect(l, e), true)}
              >
                {CENSOR_EFFECT_NAMES[e]}
              </button>
            ))}
          </div>
          {layer.effect === 'mosaic' && (
            <div className="segmented" role="group" aria-label="Mosaic shape">
              {MOSAIC_SHAPES.map((s) => (
                <button
                  key={s}
                  type="button"
                  className={layer.mosaicShape === s ? 'active' : ''}
                  onClick={() => set((l) => ({ ...l, mosaicShape: s }), true)}
                >
                  {SHAPE_NAMES[s]}
                </button>
              ))}
            </div>
          )}
          <>
            <ParamSlider
              label="Effect size"
              value={effectSize.to(layer.size)}
              min={0}
              max={100}
              defaultValue={effectSize.to(CENSOR_DEFAULT_SIZES[layer.effect])}
              format={(v) => `${(effectSize.from(v) * 100).toFixed(1)}%`}
              onChange={(v) => set((l) => ({ ...l, size: effectSize.from(v) }))}
            />
            <ParamSlider
              label="Strength"
              value={layer.strength}
              min={0}
              max={100}
              defaultValue={100}
              format={(v) => `${Math.round(v)}`}
              onChange={(v) => set((l) => ({ ...l, strength: v }))}
            />
            {layer.strength < 100 && <Note>Below 100 some of what is underneath shows through. Keep Strength at 100 for a cover that hides it.</Note>}
            {layer.effect === 'mosaic' && (
              <ParamSlider
                label="Glass colour"
                value={layer.glassColour}
                min={0}
                max={100}
                defaultValue={DEFAULT_GLASS_COLOUR}
                format={(v) => `${Math.round(v)}`}
                onChange={(v) => set((l) => ({ ...l, glassColour: v }))}
              />
            )}
            {(layer.effect === 'halftone' || layer.effect === 'hatching') && (
              <ParamSlider
                label="Contrast"
                value={layer.contrast}
                min={0}
                max={100}
                defaultValue={layer.effect === 'hatching' ? DEFAULT_HATCHING_CONTRAST : DEFAULT_HALFTONE_CONTRAST}
                format={(v) => `${Math.round(v)}`}
                onChange={(v) => set((l) => ({ ...l, contrast: v }))}
              />
            )}
            {layer.effect === 'hatching' && (
              <ParamSlider
                label="Keep colour"
                value={layer.keepColour}
                min={0}
                max={100}
                defaultValue={DEFAULT_KEEP_COLOUR}
                format={(v) => `${Math.round(v)}`}
                onChange={(v) => set((l) => ({ ...l, keepColour: v }))}
              />
            )}
            <div className="button-row">
              <button
                type="button"
                className="text"
                onClick={() => set((l) => ({ ...l, seed: newCensorSeed() }), true)}
                title="The same effect laid out anew"
              >
                New pattern
              </button>
              {layer.ellipse ? (
                <button type="button" className="text" onClick={() => set((l) => ({ ...l, ellipse: null }), true)}>
                  Remove ellipse
                </button>
              ) : (
                <button
                  type="button"
                  className="text"
                  onClick={() => {
                    const [x, y] = props.viewCentre();
                    set((l) => ({ ...l, ellipse: newCensorEllipse(x, y) }), true);
                  }}
                >
                  + Ellipse
                </button>
              )}
            </div>
          </>

          <div className="segmented mask-tools" role="group" aria-label="Tool">
            {(['paint', 'erase', 'ellipse', 'pick'] as const).map((t) => (
              <button key={t} type="button" className={tool === t ? 'active' : ''} onClick={() => onTool(t)} title={TOOL_TITLES[t]}>
                {TOOL_NAMES[t]}
              </button>
            ))}
          </div>
          <ParamSlider
            label="Brush size"
            value={censorBrushSize.to(brush.radius)}
            min={0}
            max={100}
            defaultValue={censorBrushSize.to(DEFAULT_CENSOR_BRUSH.radius)}
            format={(v) => `${(censorBrushSize.from(v) * 200).toFixed(1)}%`}
            onChange={(v) => onBrush({ ...brush, radius: censorBrushSize.from(v) })}
          />
          {
            <ParamSlider
              label="Hardness"
              value={brush.hardness}
              min={0}
              max={100}
              defaultValue={DEFAULT_CENSOR_BRUSH.hardness}
              format={(v) => `${Math.round(v)}`}
              onChange={(v) => onBrush({ ...brush, hardness: v })}
            />
          }
          <ParamSlider
            label="Smoothing"
            value={brush.smoothing}
            min={0}
            max={100}
            defaultValue={DEFAULT_CENSOR_BRUSH.smoothing}
            format={(v) => `${Math.round(v)}`}
            onChange={(v) => onBrush({ ...brush, smoothing: v })}
          />

          {
            <div className="censor-colour">
              <div className="censor-colour-row">
                <span className="censor-colour-label">Colour</span>
                <button
                  type="button"
                  className={`chip${brush.colour == null ? ' active' : ''}`}
                  onClick={() => pickColour(null)}
                  title="The area’s own colours"
                >
                  Auto
                </button>
                <input
                  type="color"
                  aria-label="Brush colour"
                  value={brush.colour ?? '#c8a088'}
                  onChange={(e) => onBrush({ ...brush, colour: e.target.value.toLowerCase() })}
                  onBlur={(e) => brush.colour && pickColour(e.target.value.toLowerCase())}
                />
                <input
                  className="censor-hex"
                  aria-label="Colour as hex"
                  spellCheck={false}
                  value={hexText ?? brush.colour ?? ''}
                  placeholder="#rrggbb"
                  onChange={(e) => {
                    const v = e.target.value.trim();
                    setHexText(v);
                    const c = v.startsWith('#') ? v : `#${v}`;
                    if (parseColour(c)) onBrush({ ...brush, colour: c.toLowerCase() });
                  }}
                  onBlur={() => {
                    setHexText(null);
                    if (brush.colour) pickColour(brush.colour);
                  }}
                />
                <button
                  type="button"
                  className={`text${tool === 'pick' ? ' active' : ''}`}
                  onClick={() => onTool(tool === 'pick' ? 'paint' : 'pick')}
                  title={TOOL_TITLES.pick}
                >
                  Pick
                </button>
              </div>
              {recent.length > 0 && (
                <div className="censor-recent" role="group" aria-label="Recent colours">
                  {recent.map((c) => (
                    <button
                      key={c}
                      type="button"
                      className={`censor-swatch${brush.colour === c ? ' active' : ''}`}
                      style={{ background: c }}
                      title={c}
                      aria-label={c}
                      onClick={() => pickColour(c)}
                    />
                  ))}
                </div>
              )}
              {brush.colour && (
                <ParamSlider
                  label="Colour mix"
                  value={brush.colourMix}
                  min={0}
                  max={100}
                  defaultValue={100}
                  format={(v) => `${Math.round(v)}`}
                  onChange={(v) => onBrush({ ...brush, colourMix: v })}
                />
              )}
            </div>
          }

          <div className="button-row">
            <button
              type="button"
              className="text"
              onClick={() => props.onUndoStroke(layer.id)}
              disabled={layer.strokes.length === 0}
              title="Ctrl/⌘ Z"
            >
              Undo stroke
            </button>
            <button type="button" className="text" onClick={() => props.onClear(layer.id)} disabled={layer.strokes.length === 0 && !layer.ellipse}>
              Clear
            </button>
          </div>
          {layer.strokes.length >= MAX_CENSOR_STROKES && <Note>That is the most strokes a layer takes; add another layer to paint more.</Note>}
          <Note>
            Brush settings and colour apply to new strokes. [ and ] change the brush size, P paints, E erases, I picks a colour, Alt erases while
            held; a pen’s pressure changes the brush size. Zoom (double-click or Z) for edges; Space pans.
          </Note>
        </>
      )}
    </div>
  );
}
