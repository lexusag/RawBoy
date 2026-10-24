import { MAX_BRUSH_RADIUS, MAX_LAYERS, MIN_BRUSH_RADIUS, SHAPE_NAMES, type LayerAdjust, type MaskLayer } from '../../engine/develop/Masks';
import { useState } from 'react';
import { ParamSlider, formatEv } from '../common/ParamSlider';
import { useMediaQuery } from '../common/useMediaQuery';
import { Note, SectionLabel } from './Controls';
import type { BrushSettings, MaskTool } from './MaskOverlay';

/** Size slider 0..100 <-> brush radius (fraction of the long side), exponential so small brushes are easy to set. */
export const sizeToRadius = (v: number) => MIN_BRUSH_RADIUS * (MAX_BRUSH_RADIUS / MIN_BRUSH_RADIUS) ** (v / 100);
export const radiusToSize = (r: number) => (100 * Math.log(r / MIN_BRUSH_RADIUS)) / Math.log(MAX_BRUSH_RADIUS / MIN_BRUSH_RADIUS);

const TOOL_KEYS: Record<MaskTool, string> = { move: 'V', brush: 'B', erase: 'E' };

const KIND_LABEL: Record<MaskLayer['shape']['kind'], string> = { linear: 'Linear gradient', radial: 'Radial gradient', brush: 'Brush' };
const subtitle = (l: MaskLayer) =>
  l.shape.kind === 'brush' ? `Brush · ${l.strokes.length} stroke${l.strokes.length === 1 ? '' : 's'}` : `${KIND_LABEL[l.shape.kind]}${l.strokes.length ? ' + brush' : ''}`;

interface Props {
  layers: readonly MaskLayer[];
  selectedId: string | null;
  showMask: boolean;
  onSelect: (id: string) => void;
  onAdd: (kind: MaskLayer['shape']['kind']) => void;
  onUpdate: (id: string, change: (l: MaskLayer) => MaskLayer) => void;
  onRemove: (id: string) => void;
  onShowMask: (on: boolean) => void;
  onDone: () => void;
  tool: MaskTool;
  onTool: (t: MaskTool) => void;
  brush: BrushSettings;
  onBrush: (b: BrushSettings) => void;
  onUndoStroke: (id: string) => void;
  onClearBrush: (id: string) => void;
}

const ADJUST_SLIDERS: readonly { key: keyof LayerAdjust; label: string; min: number; max: number; format?: (v: number) => string }[] = [
  { key: 'exposure', label: 'Exposure', min: -5, max: 5, format: formatEv },
  { key: 'contrast', label: 'Contrast', min: -100, max: 100 },
  { key: 'highlights', label: 'Highlights', min: -100, max: 100 },
  { key: 'shadows', label: 'Shadows', min: -100, max: 100 },
  { key: 'temperature', label: 'Temperature', min: -100, max: 100 },
  { key: 'tint', label: 'Tint', min: -100, max: 100 },
  { key: 'saturation', label: 'Saturation', min: -100, max: 100 },
  { key: 'clarity', label: 'Clarity', min: -100, max: 100 },
  { key: 'lensBlur', label: 'Lens blur', min: 0, max: 100 },
];

/**
 * Mask layers (gradients and brush), each with its own adjustments (Capture One style). A top-bar mode like Crop & rotate.
 * Narrow screens (the panel under the photo) split the selected layer into Mask and Adjust tabs, as the apps do, so the
 * adjustments are one tap away instead of below the mask settings.
 */
export function MasksPanel(props: Props) {
  const { layers, selectedId, showMask, onSelect, onAdd, onUpdate, onRemove, onShowMask, onDone, tool, onTool, brush, onBrush } = props;
  const layer = layers.find((l) => l.id === selectedId) ?? null;
  const full = layers.length >= MAX_LAYERS;
  const adjust = (key: keyof LayerAdjust, v: number) => layer && onUpdate(layer.id, (l) => ({ ...l, adjust: { ...l.adjust, [key]: v } }));
  const narrow = useMediaQuery('(max-width: 760px)');
  const [tab, setTab] = useState<'Mask' | 'Adjust'>('Mask');
  const maskPart = !narrow || tab === 'Mask';
  const adjustPart = !narrow || tab === 'Adjust';
  const addButtons = (
    <div className="button-row mask-add">
      <button type="button" onClick={() => onAdd('linear')} disabled={full}>+ Linear</button>
      <button type="button" onClick={() => onAdd('radial')} disabled={full}>+ Radial</button>
      <button type="button" onClick={() => onAdd('brush')} disabled={full}>+ Brush</button>
    </div>
  );

  return (
    <div className="controls geometry">
      {/* Narrow: the add buttons share the heading's row (the top bar already says Masks). */}
      <div className="geometry-head">
        {narrow ? addButtons : <strong>Masks</strong>}
        <button type="button" className="text" onClick={onDone}>
          Done
        </button>
      </div>
      {!narrow && addButtons}
      {layers.length === 0 && (
        <Note>
          Add a linear gradient (a graduated filter, e.g. for the sky), a radial one (a soft ellipse) or a brush layer, then shape it on the photo
          and adjust only that area. Any layer can be painted on or erased from. Up to {MAX_LAYERS} layers; masks reset for each new photo.
        </Note>
      )}
      {layers.map((l) => (
        <div key={l.id} className={`preset-row mask-row${l.id === selectedId ? ' active' : ''}`}>
          <input
            type="checkbox"
            checked={l.enabled}
            title={l.enabled ? 'Hide layer' : 'Show layer'}
            onChange={(e) => onUpdate(l.id, (x) => ({ ...x, enabled: e.target.checked }))}
          />
          <button type="button" className="preset-apply" onClick={() => onSelect(l.id)}>
            <span className="preset-name">{l.name}</span>
            <span className="preset-groups">{subtitle(l)}</span>
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
      {layer && narrow && (
        <nav className="tabs small mask-tabs">
          {(['Mask', 'Adjust'] as const).map((t) => (
            <button key={t} type="button" className={t === tab ? 'active' : ''} onClick={() => setTab(t)}>
              {t}
            </button>
          ))}
        </nav>
      )}
      {layer && maskPart && (
        <>
          {/* The layer's heading is its name, renamed in place. */}
          <input
            type="text"
            className="mask-name"
            value={layer.name}
            title="Rename"
            aria-label="Layer name"
            onChange={(e) => onUpdate(layer.id, (l) => ({ ...l, name: e.target.value }))}
            onBlur={(e) => {
              if (!e.target.value.trim()) onUpdate(layer.id, (l) => ({ ...l, name: SHAPE_NAMES[l.shape.kind] }));
            }}
          />
          <div className="segmented mask-tools" role="group" aria-label="Tool">
            {(['move', 'brush', 'erase'] as const).map((t) => (
              <button key={t} type="button" className={tool === t ? 'active' : ''} onClick={() => onTool(t)} title={TOOL_KEYS[t]}>
                {t === 'move' ? (layer.shape.kind === 'brush' ? 'Select' : 'Move') : t === 'brush' ? 'Brush' : 'Erase'}
              </button>
            ))}
          </div>
          {tool !== 'move' && (
            <>
              <ParamSlider
                label="Size"
                value={radiusToSize(brush.radius)}
                min={0}
                max={100}
                defaultValue={radiusToSize(0.03)}
                format={() => `${(brush.radius * 200).toFixed(brush.radius < 0.05 ? 1 : 0)}%`}
                onChange={(v) => onBrush({ ...brush, radius: sizeToRadius(v) })}
              />
              <ParamSlider label="Hardness" value={brush.hardness} min={0} max={100} defaultValue={50} format={(v) => String(Math.round(v))} onChange={(v) => onBrush({ ...brush, hardness: v })} />
              <ParamSlider label="Flow" value={brush.flow} min={1} max={100} defaultValue={100} format={(v) => String(Math.round(v))} onChange={(v) => onBrush({ ...brush, flow: v })} />
              <label className="preset-group">
                <input type="checkbox" checked={brush.auto} onChange={(e) => onBrush({ ...brush, auto: e.target.checked })} />
                Auto mask (paint only on colours like the one under the brush)
              </label>
            </>
          )}
          <div className="button-row">
            <button type="button" className="text" onClick={() => props.onUndoStroke(layer.id)} disabled={layer.strokes.length === 0} title="Ctrl/⌘ Z">
              Undo stroke
            </button>
            <button type="button" className="text" onClick={() => props.onClearBrush(layer.id)} disabled={layer.strokes.length === 0}>
              Clear brush
            </button>
          </div>
          <label className="preset-group">
            <input type="checkbox" checked={showMask} onChange={(e) => onShowMask(e.target.checked)} />
            Show mask
          </label>
          <label className="preset-group">
            <input type="checkbox" checked={layer.invert} onChange={(e) => onUpdate(layer.id, (l) => ({ ...l, invert: e.target.checked }))} />
            Invert
          </label>
          <ParamSlider
            label="Opacity"
            value={layer.opacity}
            min={0}
            max={100}
            defaultValue={100}
            format={(v) => `${Math.round(v)}%`}
            onChange={(v) => onUpdate(layer.id, (l) => ({ ...l, opacity: v }))}
          />
          {layer.shape.kind === 'linear' && (
            <ParamSlider
              label="Curvature"
              value={layer.shape.curve}
              min={-100}
              max={100}
              defaultValue={0}
              onChange={(v) => onUpdate(layer.id, (l) => (l.shape.kind === 'linear' ? { ...l, shape: { ...l.shape, curve: v } } : l))}
            />
          )}
          {layer.shape.kind === 'radial' && (
            <ParamSlider
              label="Feather"
              value={layer.shape.feather}
              min={0}
              max={100}
              defaultValue={50}
              format={(v) => String(Math.round(v))}
              onChange={(v) => onUpdate(layer.id, (l) => (l.shape.kind === 'radial' ? { ...l, shape: { ...l.shape, feather: v } } : l))}
            />
          )}
        </>
      )}
      {layer && adjustPart && (
        <>
          {!narrow && <SectionLabel>Adjustments</SectionLabel>}
          {ADJUST_SLIDERS.map((s) => (
            <ParamSlider
              key={s.key}
              label={s.label}
              value={layer.adjust[s.key]}
              min={s.min}
              max={s.max}
              defaultValue={0}
              format={s.format}
              onChange={(v) => adjust(s.key, v)}
            />
          ))}
        </>
      )}
      {layer && maskPart && (
        <>
          <Note>
            {tool !== 'move'
              ? 'Paint on the photo (hold Alt to erase). [ ] size · B brush · E erase · V move · Z 100% · hold Space to pan · Ctrl/⌘ Z undo.'
              : layer.shape.kind === 'linear'
                ? 'Solid line: full effect. Dashed line: no effect. Drag the middle line to move the gradient, an outer line to change its width and angle, the square to bend it.'
                : layer.shape.kind === 'radial'
                  ? 'Drag the centre to move, the dots to resize, the outer knob to rotate. The effect fades between the dashed and the solid ellipse.'
                  : 'Pick Brush to paint this layer’s mask.'}
          </Note>
          {layer.strokes.length > 0 && <Note>Brush strokes belong to this photo: presets keep gradients only.</Note>}
        </>
      )}
    </div>
  );
}
