import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { FrameColors } from '../../engine/gl/DevelopRenderer';
import { cropAspectRatio, cropOf, withCrop, withoutCrop, FULL_CROP, cropWithAspect, type CropAspect } from '../../engine/develop/CropMath';
import { pickFiles } from '../common/files';
import { isTabShown } from '../common/tabs';
import { Preview, PreviewLabel, zoomLabel } from '../common/Preview';
import { ControlsPanel, GeometryPanel } from './Controls';
import { CropOverlay } from './CropOverlay';
import { MaskOverlay, type BrushSettings, type MaskTool } from './MaskOverlay';
import { MasksPanel, radiusToSize, sizeToRadius } from './MasksPanel';
import { LeaksPanel } from './LeaksPanel';
import type { LightLeak } from '../../engine/develop/LightLeaks';
import type { MaskShape } from '../../engine/develop/Masks';
import { PresetsPanel, type PresetActions } from './PresetsPanel';
import { ExportDialog } from './ExportDialog';
import type { ProStore } from './ProStore';
import { UndoIcon } from '../common/UndoIcon';
import { AppSwitcher, HelpButton } from '../common/AppNav';
import { useMediaQuery } from '../common/useMediaQuery';
import { HistogramView } from '../common/HistogramView';
import { PresetsIcon } from '../common/PresetsIcon';
import { histogramFromRgba, type Histogram } from '../../engine/develop/Histogram';
import { renderThumbnail } from '../../engine/gl/ThumbnailRenderer';
import { shortcutKey } from '../common/shortcutKey';

/** Frame around the photo in the fit view, CSS pixels (click outside the photo to change its colour). */
const FRAME_WIDTH = 12;
/**
 * Empty space around the frame while the mask or light leak tool is open, so handles beyond the photo stay visible and reachable.
 * Phones get Android's 16 px: 72 left the photo ~60% of the screen's width.
 */
const MASK_MARGIN = 72;
const MASK_MARGIN_NARROW = 16;

const BRUSH_KEY = 'rawboy.brush';
const DEFAULT_BRUSH: BrushSettings = { radius: 0.03, hardness: 50, flow: 100, auto: false };
const loadBrush = (): BrushSettings => {
  try {
    const b = JSON.parse(localStorage.getItem(BRUSH_KEY) ?? 'null') as Partial<BrushSettings> | null;
    return b && typeof b === 'object' ? { ...DEFAULT_BRUSH, ...b } : DEFAULT_BRUSH;
  } catch {
    return DEFAULT_BRUSH;
  }
};
const saveBrush = (b: BrushSettings) => {
  try {
    localStorage.setItem(BRUSH_KEY, JSON.stringify(b));
  } catch {
    // not remembered
  }
};

/**
 * RawBoy (Pro): every control (port of app-pro's EditorScreen.kt). [onSendToAuto] hands the photo and its edits to the
 * Auto tab; [backToAuto]: the photo came from there.
 */
export function ProApp({ store, backToAuto, onSendToAuto }: { store: ProStore; backToAuto: boolean; onSendToAuto: () => void }) {
  const state = useSyncExternalStore(store.subscribe, () => store.state);
  const session = useSyncExternalStore(store.session.subscribe, () => store.session.state);
  // Before/after: press and hold the photo, or latch it with the Compare button or the \ key (as in Lightroom).
  const [comparing, setComparing] = useState(false);
  const [compareLatched, setCompareLatched] = useState(false);
  const showOriginal = comparing || compareLatched;
  useEffect(() => setCompareLatched(false), [state.fileName]);
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (shortcutKey(e) !== '\\' || e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
      const t = e.target;
      if (t instanceof HTMLTextAreaElement || (t instanceof HTMLInputElement && t.type !== 'range' && t.type !== 'checkbox')) return;
      if (!isTabShown('pro')) return;
      e.preventDefault();
      setCompareLatched((v) => !v);
    };
    window.addEventListener('keydown', down);
    return () => window.removeEventListener('keydown', down);
  }, []);
  const [geometryMode, setGeometryMode] = useState(false);
  const [presetsMode, setPresetsMode] = useState(false);
  const [masksMode, setMasksMode] = useState(false);
  const [leaksMode, setLeaksMode] = useState(false);
  // White balance picker: armed from the Color tab, the next click on the photo picks.
  const [pickingWhite, setPickingWhite] = useState(false);
  useEffect(() => setPickingWhite(false), [geometryMode, masksMode, leaksMode, presetsMode, state.fileName]);
  const [maskTool, setMaskTool] = useState<MaskTool>('move');
  const [brush, setBrushState] = useState<BrushSettings>(loadBrush);
  const setBrush = (b: BrushSettings) => {
    setBrushState(b);
    saveBrush(b);
  };
  const [spaceHeld, setSpaceHeld] = useState(false);
  /** Last pointer position over the preview and the view size, device pixels (Z zooms at the pointer). */
  const pointer = useRef<[number, number] | null>(null);
  const viewSize = useRef<[number, number]>([0, 0]);
  const [selectedLayer, setSelectedLayer] = useState<string | null>(null);
  const [selectedLeak, setSelectedLeak] = useState<string | null>(null);
  const [showMask, setShowMask] = useState(false);
  const [showExport, setShowExport] = useState(false);
  // Crop shape lock (UI only; the crop itself is in the params). Portrait null = follow the frame.
  const [cropAspect, setCropAspect] = useState<CropAspect>('free');
  const [cropPortrait, setCropPortrait] = useState<boolean | null>(null);
  useEffect(() => {
    setCropAspect('free');
    setCropPortrait(null);
    setSelectedLayer(null);
    setSelectedLeak(null);
  }, [state.fileName]);
  // Keep a layer selected while there are any (after a delete, or a preset brought new ones).
  const layers = state.params.masks;
  const selectedId = layers.some((l) => l.id === selectedLayer) ? selectedLayer : (layers[0]?.id ?? null);
  const leaks = state.params.leaks;
  const leakId = leaks.some((l) => l.id === selectedLeak) ? selectedLeak : (leaks[leaks.length - 1]?.id ?? null);
  // Overlay handles, also beyond the photo, in either tool.
  const shapesMode = masksMode || leaksMode;
  // Crop works on the fit view only; masks work at 100% too (frame-colour clicks stay off while masking).
  const zoomable = !geometryMode;
  const maskMargin = useMediaQuery('(max-width: 560px)') ? MASK_MARGIN_NARROW : MASK_MARGIN;
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
  const zoomExtra = shapesMode ? maskMargin * dpr : 0;
  const hasImage = store.hasImage;
  const busy = store.busy;
  const skinMask = session.skin.kind === 'ready' ? session.skin.mask : null;

  // Compare keeps the current rotation, flips and crop so the frame doesn't jump; the crop tool shows the whole frame.
  const edited = showOriginal
    ? withCrop(
        {
          ...state.defaults,
          rotation: state.params.rotation,
          flipHorizontal: state.params.flipHorizontal,
          flipVertical: state.params.flipVertical,
          straighten: state.params.straighten,
        },
        cropOf(state.params),
      )
    : state.params;
  const shownKey = JSON.stringify(geometryMode ? withoutCrop(edited) : edited);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const shown = useMemo(() => (geometryMode ? withoutCrop(edited) : edited), [shownKey]);
  const frameLens = hasImage ? store.session.lensFor(withoutCrop(state.params)) : null;
  const portrait = cropPortrait ?? (frameLens ? frameLens.frameHeight > frameLens.frameWidth : false);
  const cropRatio = frameLens ? cropAspectRatio(cropAspect, frameLens.frameWidth, frameLens.frameHeight, portrait) : null;
  const chooseAspect = (aspect: CropAspect, toPortrait: boolean) => {
    if (!frameLens) return;
    setCropAspect(aspect);
    setCropPortrait(toPortrait);
    const ratio = cropAspectRatio(aspect, frameLens.frameWidth, frameLens.frameHeight, toPortrait);
    store.setCrop(cropWithAspect(cropOf(state.params), ratio, frameLens.frameWidth, frameLens.frameHeight));
  };
  const maskView = masksMode && showMask && !showOriginal ? selectedId : null;
  const shaderParams = useMemo(
    () => (session.preview ? store.session.shaderParams(shown, state.defaults, session.lutData, maskView, session.filmData) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [shown, state.defaults, session.lutData, session.filmData, session.lensInfo, session.base, session.bloomSources, session.bokehSource, skinMask, session.preview, maskView],
  );

  // Histogram of the edited photo (not the crop tool's whole frame, no mask overlay), from the 512 px base copy,
  // a moment after the edits rest.
  const [histogram, setHistogram] = useState<Histogram | null>(null);
  const [clipWarning, setClipWarning] = useState(false);
  const editedKey = JSON.stringify(edited);
  useEffect(() => {
    const base = session.base;
    if (!session.preview || !base) {
      setHistogram(null);
      return;
    }
    const t = window.setTimeout(() => {
      try {
        const p = store.session.shaderParams(edited, state.defaults, session.lutData, null, session.filmData);
        setHistogram(histogramFromRgba(renderThumbnail(p, base, 256).data));
      } catch {
        setHistogram(null); // the warning stays usable; only the curve is missing
      }
    }, 150);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editedKey, state.defaults, session.lutData, session.filmData, session.base, session.bloomSources, session.bokehSource, skinMask, session.preview]);

  // Z: 100% at the pointer (or the middle of the photo when the pointer isn't on it), again to fit. Every mode but
  // Crop & rotate, which works on the uncropped fit view.
  const zoomKey = useRef({ zoomable, zoomExtra, hasImage });
  zoomKey.current = { zoomable, zoomExtra, hasImage };
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (!isTabShown('pro') || shortcutKey(e) !== 'z' || e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
      const t = e.target;
      if (t instanceof HTMLTextAreaElement || (t instanceof HTMLInputElement && t.type !== 'range' && t.type !== 'checkbox')) return;
      const k = zoomKey.current;
      if (!k.zoomable || !k.hasImage) return;
      e.preventDefault();
      if (store.session.state.zoomCenter) {
        store.session.exitZoom();
        return;
      }
      const p = pointer.current;
      if (p) store.toggleZoom(p[0], p[1], k.zoomExtra);
      if (!store.session.state.zoomCenter) store.toggleZoom(viewSize.current[0] / 2, viewSize.current[1] / 2, k.zoomExtra);
    };
    window.addEventListener('keydown', down);
    return () => window.removeEventListener('keydown', down);
  }, [store]);

  // Ctrl/Cmd+Z undo, Shift+Ctrl/Cmd+Z or Ctrl+Y redo (a stroke is one step), except while typing a name.
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (!isTabShown('pro') || !(e.metaKey || e.ctrlKey) || e.altKey) return;
      const t = e.target;
      if (t instanceof HTMLTextAreaElement || (t instanceof HTMLInputElement && t.type !== 'range' && t.type !== 'checkbox')) return;
      const key = shortcutKey(e);
      if (key === 'z' && !e.shiftKey) store.undo();
      else if ((key === 'z' && e.shiftKey) || (key === 'y' && e.ctrlKey)) store.redo();
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', down);
    return () => window.removeEventListener('keydown', down);
  }, [store]);

  // Mask tool keys: B brush, E erase, V move, [ ] size, Space pan.
  const keys = useRef({ selectedId, brush });
  keys.current = { selectedId, brush };
  useEffect(() => {
    if (!masksMode) return;
    const typing = (t: EventTarget | null) =>
      t instanceof HTMLTextAreaElement || (t instanceof HTMLInputElement && t.type !== 'range' && t.type !== 'checkbox');
    const down = (e: KeyboardEvent) => {
      if (!isTabShown('pro') || typing(e.target)) return;
      const k = keys.current;
      const key = shortcutKey(e);
      if (e.metaKey || e.ctrlKey || e.altKey) {
        return;
      } else if (key === ' ') {
        setSpaceHeld(true);
      } else if (key === 'b' || key === 'e') {
        let id = k.selectedId;
        if (!id) {
          id = store.addLayer('brush');
          if (id) setSelectedLayer(id);
        }
        if (id) setMaskTool(key === 'b' ? 'brush' : 'erase');
      } else if (key === 'v') {
        setMaskTool('move');
      } else if (key === '[' || key === ']') {
        const size = radiusToSize(k.brush.radius) + (key === ']' ? 5 : -5);
        setBrush({ ...k.brush, radius: sizeToRadius(Math.min(100, Math.max(0, size))) });
      } else {
        return;
      }
      e.preventDefault();
    };
    const up = (e: KeyboardEvent) => {
      if (e.key === ' ') setSpaceHeld(false);
    };
    const blur = () => setSpaceHeld(false);
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
      setSpaceHeld(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [masksMode, store]);

  const presetActions = useMemo<PresetActions>(
    () => ({
      apply: store.applyPreset,
      save: store.savePreset,
      update: (p) => store.updatePreset(p.id),
      rename: (p, name) => store.renamePreset(p.id, name),
      delete: (p) => store.deletePreset(p.id),
      export: store.exportPresets,
      import: (f) => void store.importPresets(f),
    }),
    [store],
  );

  const open = async () => {
    const [file] = await pickFiles(false);
    if (file) void store.open(file);
  };

  return (
    <div className="editor">
      <header className="toolbar pro-toolbar">
        <AppSwitcher />
        <div className="title">
          <div className="name">{state.fileName ?? 'RawBoy'}</div>
          {state.info && <div className="info">{state.info}</div>}
        </div>
        <button type="button" className="text open" title="Open" aria-label="Open" onClick={open} disabled={busy}>
          <span className="label-wide">Open</span>
          <span className="icon-narrow"><OpenIcon /></span>
          <span className="tool-label">Open</span>
        </button>
        <button type="button" className={`icon${geometryMode ? ' active' : ''}`} title="Crop & rotate"
          onClick={() => {
            if (!geometryMode && session.zoomCenter) store.session.exitZoom(); // the crop tool works on the fit view
            setGeometryMode(!geometryMode);
            setPresetsMode(false);
            setMasksMode(false);
            setLeaksMode(false);
          }} disabled={!hasImage || busy}>
          <CropRotateIcon />
          <span className="tool-label">Crop</span>
        </button>
        <button
          type="button"
          className={`icon${presetsMode ? ' active' : ''}`}
          title="Presets"
          onClick={() => {
            setPresetsMode(!presetsMode);
            setGeometryMode(false);
            setMasksMode(false);
            setLeaksMode(false);
          }}
          disabled={!hasImage || busy}
        >
          <PresetsIcon />
          <span className="tool-label">Presets</span>
        </button>
        <button
          type="button"
          className={`icon${masksMode ? ' active' : ''}`}
          title="Masks"
          onClick={() => {
            setMasksMode(!masksMode);
            setGeometryMode(false);
            setPresetsMode(false);
            setLeaksMode(false);
          }}
          disabled={!hasImage || busy}
        >
          <MasksIcon />
          <span className="tool-label">Masks</span>
        </button>
        <button
          type="button"
          className={`icon${leaksMode ? ' active' : ''}`}
          title="Light leaks"
          onClick={() => {
            setLeaksMode(!leaksMode);
            setGeometryMode(false);
            setPresetsMode(false);
            setMasksMode(false);
          }}
          disabled={!hasImage || busy}
        >
          <LeakIcon />
          <span className="tool-label">Leaks</span>
        </button>
        <button type="button" className="icon" title="Undo (Ctrl/⌘ Z)" aria-label="Undo" onClick={store.undo} disabled={!state.canUndo || busy}>
          <UndoIcon />
          <span className="tool-label">Undo</span>
        </button>
        <button type="button" className="icon" title="Redo (Shift Ctrl/⌘ Z)" aria-label="Redo" onClick={store.redo} disabled={!state.canRedo || busy}>
          <UndoIcon redo />
          <span className="tool-label">Redo</span>
        </button>
        <button type="button" className="icon" title="Reset all" aria-label="Reset all" onClick={store.reset} disabled={!hasImage || busy}>
          <ResetIcon />
          <span className="tool-label">Reset</span>
        </button>
        <button type="button" className="auto-button" title="Auto light and colour (keeps the LUT)" onClick={store.applyAuto} disabled={!hasImage || busy}>Auto</button>
        <span className="row-break" />
        <button
          type="button"
          className="text to-auto"
          title={backToAuto ? 'Back to the Auto tab with these edits' : 'Add to the Auto tab with these edits'}
          onClick={onSendToAuto}
          disabled={!hasImage || busy}
        >
          <span className="wide-only">{backToAuto ? 'Back to' : 'Send to'}</span><span className="narrow-only">To</span> Auto
        </button>
        <button type="button" className="primary" onClick={() => setShowExport(true)} disabled={!hasImage || busy}>Export</button>
        <HelpButton />
      </header>
      <div className={`workspace${pickingWhite ? ' picking-white' : ''}`}>
        <Preview
          session={session}
          params={shaderParams}
          frame={FRAME_WIDTH}
          frameGrey={FrameColors[state.frameColor].level}
          clipWarning={clipWarning && !showOriginal}
          margin={shapesMode ? maskMargin : 0}
          onViewSize={(w, h, f) => {
            viewSize.current = [w, h];
            store.setViewSize(w, h, f);
          }}
          onPointerAt={(p) => {
            pointer.current = p;
          }}
          // Zoom and frame colour work on the cropped view; the crop tool shows the whole frame.
          onToggleZoom={(x, y) => zoomable && store.toggleZoom(x, y, zoomExtra)}
          onClick={(x, y) => {
            if (!zoomable || shapesMode) return;
            if (pickingWhite) {
              setPickingWhite(false);
              void store.pickWhite(x, y);
            } else {
              store.onPreviewClick(x, y);
            }
          }}
          onPan={(dx, dy) => zoomable && store.pan(dx, dy)}
          onZoomBy={(x, y, f) => zoomable && store.zoomBy(x, y, f, zoomExtra)}
          onCompare={setComparing}
          zoomHint={zoomable}
        >
          {geometryMode && !session.zoomCenter && shaderParams && (
            <CropOverlay
              frameWidth={shaderParams.lens.outputWidth}
              frameHeight={shaderParams.lens.outputHeight}
              crop={cropOf(state.params)}
              ratio={cropRatio}
              frame={FRAME_WIDTH}
              onChange={store.setCrop}
            />
          )}
          {masksMode && !showOriginal && shaderParams && (
            <MaskOverlay
              lens={shaderParams.lens}
              layers={layers}
              selectedId={selectedId}
              frame={FRAME_WIDTH + maskMargin}
              zoomFrame={FRAME_WIDTH}
              zoomCenter={session.zoomCenter}
              zoomScale={session.zoomScale}
              tool={selectedId ? maskTool : 'move'}
              brush={brush}
              passThrough={spaceHeld}
              onSelect={setSelectedLayer}
              onChange={(id, shape) => store.updateLayer(id, (l) => ({ ...l, shape }))}
              onStrokeBegin={store.beginStroke}
              onStrokeExtend={store.extendStroke}
              onStrokeEnd={store.endStroke}
            />
          )}
          {leaksMode && !showOriginal && shaderParams && (
            <MaskOverlay
              lens={shaderParams.lens}
              layers={leaks.map(leakLayer)}
              selectedId={leakId}
              frame={FRAME_WIDTH + maskMargin}
              zoomFrame={FRAME_WIDTH}
              zoomCenter={session.zoomCenter}
              zoomScale={session.zoomScale}
              tool="move"
              brush={brush}
              passThrough={spaceHeld}
              grabInside
              onSelect={setSelectedLeak}
              onChange={(id, shape) => store.updateLeak(id, (l) => withLeakShape(l, shape))}
              onStrokeBegin={() => {}}
              onStrokeExtend={() => {}}
              onStrokeEnd={() => {}}
            />
          )}
          {maskView && !session.zoomCenter && <PreviewLabel>Mask</PreviewLabel>}
          {state.loading && <div className="center"><span className="spinner" /></div>}
          {!session.preview && !state.loading && (
            <div className="center empty">
              <button type="button" className="primary" onClick={open}>Open a RAW file</button>
              <p>or drop one here. Double-click the photo (or press Z) for 100%, drag to pan; press and hold to compare with the as-shot render.</p>
            </div>
          )}
          {session.zoomCenter && !showOriginal && <PreviewLabel>{maskView ? `${zoomLabel(session.zoomScale)} · Mask` : zoomLabel(session.zoomScale)}</PreviewLabel>}
          {showOriginal && session.preview && <PreviewLabel>Original</PreviewLabel>}
          {session.preview && !state.loading && (
            <button
              type="button"
              className={`compare-toggle${compareLatched ? ' active' : ''}`}
              title={'Compare with the as-shot render (\\)'}
              aria-pressed={compareLatched}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => setCompareLatched(!compareLatched)}
            >
              {compareLatched ? 'Original' : 'Compare'}
            </button>
          )}
          {state.exporting && <progress className="export-progress" value={state.exportProgress} max={1} />}
        </Preview>
        {hasImage && (
          <aside className="sidebar">
            {geometryMode ? (
              <GeometryPanel
                params={state.params}
                onChange={store.update}
                onRotate={(q) => {
                  store.rotate(q);
                  if (cropPortrait != null) setCropPortrait(!cropPortrait); // a locked shape turns with the picture
                }}
                onFlip={store.flip}
                aspect={cropAspect}
                portrait={portrait}
                onAspect={chooseAspect}
                onResetCrop={() => {
                  setCropAspect('free');
                  setCropPortrait(null);
                  store.setCrop(FULL_CROP);
                }}
                onDone={() => setGeometryMode(false)}
              />
            ) : masksMode ? (
              <MasksPanel
                layers={layers}
                selectedId={selectedId}
                showMask={showMask}
                onSelect={setSelectedLayer}
                onAdd={(kind) => {
                  const id = store.addLayer(kind);
                  if (id) setSelectedLayer(id);
                  setMaskTool(kind === 'brush' ? 'brush' : 'move');
                }}
                onUpdate={store.updateLayer}
                onRemove={store.removeLayer}
                onShowMask={setShowMask}
                onDone={() => setMasksMode(false)}
                tool={maskTool}
                onTool={setMaskTool}
                brush={brush}
                onBrush={setBrush}
                onUndoStroke={store.undoStroke}
                onClearBrush={store.clearBrush}
              />
            ) : leaksMode ? (
              <LeaksPanel
                leaks={leaks}
                selectedId={leakId}
                onSelect={setSelectedLeak}
                onAdd={(kind) => {
                  const id = store.addLeak(kind);
                  if (id) setSelectedLeak(id);
                }}
                onUpdate={store.updateLeak}
                onRemove={store.removeLeak}
                onDone={() => setLeaksMode(false)}
              />
            ) : presetsMode ? (
              <PresetsPanel
                presets={state.presets}
                actions={presetActions}
                onDone={() => setPresetsMode(false)}
                hasStrokes={layers.some((l) => l.strokes.length > 0)}
              />
            ) : (
              <>
                <HistogramView histogram={histogram} active={clipWarning} onToggle={() => setClipWarning(!clipWarning)} />
                <ControlsPanel
                  params={state.params}
                  defaults={state.defaults}
                  onChange={store.update}
                  lutLoading={state.params.lut != null && session.lutData?.id !== state.params.lut}
                  onSelectLut={store.selectLut}
                  filmLoading={state.params.film != null && session.filmData?.stock.id !== state.params.film}
                  onToneMapper={store.setToneMapper}
                  onFilm={store.useFilm}
                  onSelectFilm={store.selectFilm}
                  lens={session.lensInfo}
                  skin={session.skin}
                  blemish={session.blemish}
                  pickingWhite={pickingWhite}
                  onPickWhite={() => setPickingWhite(!pickingWhite)}
                  onSaveLensPreset={store.saveLensPreset}
                />
              </>
            )}
          </aside>
        )}
      </div>
      {showExport && shaderParams && (
        <ExportDialog
          initial={state.exportSettings}
          sourceName={state.fileName ?? 'image'}
          outputSize={[shaderParams.lens.outputWidth, shaderParams.lens.outputHeight]}
          onDismiss={() => setShowExport(false)}
          onExport={(s) => {
            setShowExport(false);
            void store.export(s);
          }}
        />
      )}
    </div>
  );
}

/** Material "folder_open" icon (Apache 2.0), as in app-pro: Open on narrow screens. */
function OpenIcon() {
  return (
    <svg width={20} height={20} viewBox="0 0 24 24" fill="currentColor" style={{ display: 'block' }} aria-hidden="true">
      <path d="M20,6h-8l-2,-2H4c-1.1,0 -1.99,0.9 -1.99,2L2,18c0,1.1 0.9,2 2,2h16c1.1,0 2,-0.9 2,-2V8c0,-1.1 -0.9,-2 -2,-2zM20,18H4V8h16v10z" />
    </svg>
  );
}

/** Material "crop_rotate" icon (Apache 2.0), as in app-pro: an arrow glyph looked like Reset next to it. */
function CropRotateIcon() {
  return (
    <svg width={20} height={20} viewBox="0 0 24 24" fill="currentColor" style={{ display: 'block' }} aria-hidden="true">
      <path d="M7.47,21.49C4.2,19.93 1.86,16.76 1.5,13H0c0.51,6.16 5.66,11 11.95,11 0.23,0 0.44,-0.02 0.66,-0.03L8.8,20.15l-1.33,1.34zM12.05,0c-0.23,0 -0.44,0.02 -0.66,0.04l3.81,3.81 1.33,-1.33C19.8,4.07 22.14,7.24 22.5,11H24c-0.51,-6.16 -5.66,-11 -11.95,-11zM16,14h2V8c0,-1.11 -0.9,-2 -2,-2h-6v2h6v6zM8,16V4H6v2H4v2h2v8c0,1.1 0.89,2 2,2h8v2h2v-2h2v-2H8z" />
    </svg>
  );
}

/** Material "settings_backup_restore" icon (Apache 2.0), as in app-pro: ↺ read as reload. */
function ResetIcon() {
  return (
    <svg width={20} height={20} viewBox="0 0 24 24" fill="currentColor" style={{ display: 'block' }} aria-hidden="true">
      <path d="M14,12c0,-1.1 -0.9,-2 -2,-2s-2,0.9 -2,2 0.9,2 2,2 2,-0.9 2,-2zM12,3c-4.97,0 -9,4.03 -9,9H0l4,4 4,-4H5c0,-3.87 3.13,-7 7,-7s7,3.13 7,7 -3.13,7 -7,7c-1.51,0 -2.91,-0.49 -4.06,-1.3l-1.42,1.44C8.04,20.3 9.94,21 12,21c4.97,0 9,-4.03 9,-9s-4.03,-9 -9,-9z" />
    </svg>
  );
}

/** A light leak as the overlay draws it: a radial shape whose feather is the leak's softness (a streak: a band). */
const leakLayer = (l: LightLeak) => ({
  id: l.id,
  enabled: l.enabled,
  strokes: [],
  band: l.kind === 'streak',
  shape: { kind: 'radial' as const, cx: l.cx, cy: l.cy, rx: l.rx, ry: l.ry, angle: l.angle, feather: Math.max(1, l.softness) },
});

const withLeakShape = (l: LightLeak, s: MaskShape): LightLeak =>
  s.kind === 'radial' ? { ...l, cx: s.cx, cy: s.cy, rx: s.rx, ry: s.ry, angle: s.angle } : l;

/** Light leaks: a diagonal beam of light with a glow either side, film-burn style. */
function LeakIcon() {
  return (
    <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" style={{ display: 'block' }} aria-hidden="true">
      <path d="M3 17L21 7" strokeWidth={8} strokeOpacity={0.3} />
      <path d="M3 17L21 7" strokeWidth={3} />
    </svg>
  );
}

/** Masks: a radial (circle) over a linear gradient (lines fading towards the bottom). */
function MasksIcon() {
  return (
    <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} style={{ display: 'block' }} aria-hidden="true">
      <rect x={3} y={3} width={18} height={18} rx={2} />
      <path d="M3 8h18" />
      <path d="M3 12h18" strokeOpacity={0.6} />
      <path d="M3 16h18" strokeOpacity={0.3} />
      <circle cx={15} cy={14} r={4} fill="currentColor" stroke="none" fillOpacity={0.5} />
    </svg>
  );
}
