import { useEffect, useState, useSyncExternalStore } from 'react';
import { PrimariesTrack, type PrimariesSlider } from '../../engine/color/PrimariesTrack';
import { WhiteBalance } from '../../engine/color/WhiteBalance';
import { CROP_ASPECTS, cropAspectLabel, cropOf, isFullCrop, type CropAspect } from '../../engine/develop/CropMath';
import { ALL_FILM_LOOKS } from '../../engine/auto/looks/FilmLooks';
import { TONE_MAPPERS, effectiveColorDenoise, type DevelopParams, type SliderKey } from '../../engine/develop/DevelopParams';
import type { LensInfo } from '../../engine/lens/LensInfo';
import type { LutEntry } from '../../engine/lut/LutData';
import { LutRepository } from '../../engine/lut/LutRepository';
import type { BlemishState, SkinState } from '../../engine/session/PhotoSession';
import { pickFiles } from '../common/files';
import { ParamSlider, formatDegrees, formatEv, formatPlain } from '../common/ParamSlider';
import { useTabScroll } from '../common/useTabScroll';
import { CurvesPanel } from './CurvesPanel';

const TABS = ['Light', 'Color', 'Detail', 'LUTs', 'Lens'] as const;

/** The Film tone mapper's stocks (Auto's film looks without Natural). */
const FILM_STOCKS = ALL_FILM_LOOKS.filter((l) => l.film != null);
type Tab = (typeof TABS)[number];

interface Props {
  params: DevelopParams;
  defaults: DevelopParams;
  onChange: (p: DevelopParams) => void;
  lutLoading: boolean;
  onSelectLut: (id: string | null) => void;
  filmLoading: boolean;
  onToneMapper: (t: DevelopParams['toneMapper']) => void;
  onFilm: () => void;
  onSelectFilm: (id: string) => void;
  lens: LensInfo;
  skin: SkinState;
  blemish: BlemishState;
  /** White balance picker armed: the next click on the photo sets temperature and tint. */
  pickingWhite: boolean;
  onPickWhite: () => void;
  /** Lens tab: saves its settings as the lens preset for this lens. */
  onSaveLensPreset: () => void;
}

/** The editor's tabs Light, Color, Detail, LUTs, Lens (port of app-pro's Controls.kt). */
export function ControlsPanel({
  params, defaults, onChange, lutLoading, onSelectLut, filmLoading, onToneMapper, onFilm, onSelectFilm, lens, skin, blemish,
  pickingWhite, onPickWhite, onSaveLensPreset,
}: Props) {
  const [chosenTab, setTab] = useState<Tab>('Light');
  // Film replaces the tone mapper and the user LUT (kept, but not rendered), so the LUTs tab hides while Film is on.
  const filmOn = params.film != null;
  const tab: Tab = filmOn && chosenTab === 'LUTs' ? 'Light' : chosenTab;
  const shownTabs = TABS.filter((t) => !(filmOn && t === 'LUTs'));
  const scroll = useTabScroll(tab);
  useEffect(() => {
    if (tab === 'LUTs') void LutRepository.rescan(); // pick up changes in the user's folder
  }, [tab]);

  const slider = (label: string, key: SliderKey, min: number, max: number, format?: (v: number) => string, def = defaults[key]) => (
    <ParamSlider key={key} label={label} value={params[key]} min={min} max={max} defaultValue={def} format={format} onChange={(v) => onChange({ ...params, [key]: v })} />
  );

  /** A primaries slider whose track shows the colour it gives at each position. */
  const primaries = (label: string, key: PrimariesSlider, min: number, max: number, format?: (v: number) => string) => (
    <ParamSlider
      key={key}
      label={label}
      value={params[key]}
      min={min}
      max={max}
      defaultValue={0}
      format={format}
      trackGradient={PrimariesTrack.colors(params, key, min, max).map((c) => `rgb(${c.map((v) => Math.round(v * 255)).join(' ')})`)}
      onChange={(v) => onChange({ ...params, [key]: v })}
    />
  );

  const skinNote = (amount: number) => {
    if (amount <= 0) return null;
    if (skin.kind === 'computing') return 'Finding skin…';
    if (skin.kind === 'failed') return 'Skin detection failed';
    if (skin.kind === 'ready' && !skin.mask.hasSkin) return 'No skin found in this photo';
    return null;
  };
  const blemishNote =
    skinNote(params.blemishRemoval) ??
    (params.blemishRemoval <= 0 ? null : blemish.working ? 'Removing blemishes…' : blemish.healed === 1 ? '1 spot removed' : `${blemish.healed} spots removed`);

  return (
    <div className="controls">
      <nav className="tabs small">
        {shownTabs.map((t) => (
          <button key={t} type="button" className={t === tab ? 'active' : ''} onClick={() => setTab(t)}>
            {t}
          </button>
        ))}
      </nav>
      <div className="controls-body" ref={scroll.ref} onScroll={scroll.onScroll}>
        {tab === 'Light' && (
          <>
            <SectionLabel>Tone mapper</SectionLabel>
            <div className="chips">
              {TONE_MAPPERS.map((m) => (
                <button key={m.key} type="button" className={!params.film && m.key === params.toneMapper ? 'active' : ''} onClick={() => onToneMapper(m.key)}>
                  {m.label}
                </button>
              ))}
              <button type="button" className={params.film ? 'active' : ''} onClick={onFilm}>Film</button>
            </div>
            {params.film && (
              <>
                <label className="film-stock">
                  <span>Stock</span>
                  <select value={params.film} onChange={(e) => onSelectFilm(e.target.value)}>
                    {FILM_STOCKS.map((l) => (
                      <option key={l.id} value={l.id}>{l.name}</option>
                    ))}
                  </select>
                  {filmLoading && <span className="note">Loading…</span>}
                </label>
                {params.lut && <Note>Your LUT is off while Film is on; it returns with another tone mapper.</Note>}
                {slider('Film strength', 'filmAmount', 0, 100, formatPlain, 100)}
                {slider('Film grain', 'filmGrain', 0, 200, formatPlain, 100)}
                {slider('Halation', 'halation', 0, 200, formatPlain, 100)}
              </>
            )}
            {slider('Exposure', 'exposure', -5, 5, formatEv)}
            {slider('Contrast', 'contrast', -100, 100)}
            {slider('Highlights', 'highlights', -100, 100)}
            {slider('Shadows', 'shadows', -100, 100)}
            {slider('Whites', 'whites', -100, 100)}
            {slider('Blacks', 'blacks', -100, 100)}
            <SectionLabel>Curves</SectionLabel>
            <CurvesPanel curves={params.curves} onChange={(curves) => onChange({ ...params, curves })} />
          </>
        )}
        {tab === 'Color' && (
          <>
            <div className="chips">
              <button type="button" className={pickingWhite ? 'active' : ''} onClick={onPickWhite}>
                {pickingWhite ? 'Click something neutral grey' : 'Pick white balance'}
              </button>
            </div>
            <TemperatureSlider kelvin={params.temperature} defaultKelvin={defaults.temperature} onChange={(t) => onChange({ ...params, temperature: t })} />
            {slider('Tint', 'tint', -WhiteBalance.MAX_TINT, WhiteBalance.MAX_TINT)}
            {slider('Saturation', 'saturation', -100, 100)}
            <SectionLabel>RGB primaries</SectionLabel>
            {primaries('Red hue', 'redHue', -30, 30, formatDegrees)}
            {primaries('Red purity', 'redPurity', -100, 100)}
            {primaries('Green hue', 'greenHue', -30, 30, formatDegrees)}
            {primaries('Green purity', 'greenPurity', -100, 100)}
            {primaries('Blue hue', 'blueHue', -30, 30, formatDegrees)}
            {primaries('Blue purity', 'bluePurity', -100, 100)}
            {primaries('Tint hue', 'tintHue', -180, 180, formatDegrees)}
            {primaries('Tint purity', 'tintPurity', 0, 100, formatPlain)}
            <Note>Hue: red → yellow, green → cyan, blue → magenta for positive values.</Note>
          </>
        )}
        {tab === 'Detail' && (
          <>
            {/* Colour denoise follows luma until set (edits and presets from before the split); moving luma pins it. */}
            <ParamSlider
              key="denoise"
              label="Luma denoise"
              value={params.denoise}
              min={0}
              max={100}
              defaultValue={defaults.denoise}
              format={formatPlain}
              onChange={(v) => onChange({ ...params, denoise: v, colorDenoise: effectiveColorDenoise(params) })}
            />
            <ParamSlider
              key="colorDenoise"
              label="Color denoise"
              value={effectiveColorDenoise(params)}
              min={0}
              max={100}
              defaultValue={effectiveColorDenoise(defaults)}
              format={formatPlain}
              onChange={(v) => onChange({ ...params, colorDenoise: v })}
            />
            {slider('Sharpening', 'sharpening', 0, 100, formatPlain)}
            {slider('Local contrast', 'localContrast', -100, 100)}
            {slider('High-pass contrast', 'highpassContrast', -100, 100)}
            {slider('Skin retouch', 'skinRetouch', 0, 100, formatPlain)}
            {skinNote(params.skinRetouch) && <Note>{skinNote(params.skinRetouch)}</Note>}
            {slider('Blemish removal', 'blemishRemoval', 0, 100, formatPlain)}
            {blemishNote && <Note>{blemishNote}</Note>}
            {slider('Bloom', 'bloom', 0, 100, formatPlain)}
            {slider('Grain', 'grain', 0, 100, formatPlain)}
            <Note>Denoise and grain are sized in full-resolution pixels: judge them in the 100% view (double-click the photo).</Note>
          </>
        )}
        {tab === 'LUTs' && <LutPanel params={params} loading={lutLoading} onChange={onChange} onSelect={onSelectLut} />}
        {tab === 'Lens' && (
          <>
            <SectionLabel>Lens profile</SectionLabel>
            <div>{lens.lensName.trim() || 'Unknown lens'}</div>
            <Note>{lens.profileSummary ? `Embedded in file: ${lens.profileSummary}` : 'No lens correction data in this file'}</Note>
            <label className="switch-row">
              <span>Use embedded profile</span>
              <input
                type="checkbox"
                checked={params.lensProfile && lens.hasProfile}
                disabled={!lens.hasProfile}
                onChange={(e) => onChange({ ...params, lensProfile: e.target.checked })}
              />
            </label>
            <SectionLabel>Manual</SectionLabel>
            {slider('Distortion', 'lensDistortion', -100, 100)}
            {slider('Vignetting', 'vignetteAmount', -100, 100)}
            {slider('Vignette radius', 'vignetteMidpoint', 0, 100, formatPlain)}
            <Note>Distortion crops automatically so no empty edges show.</Note>
            <SectionLabel>Lens preset</SectionLabel>
            <Note>
              Saves these settings for {lens.lensName.trim() || 'photos with no lens name'}. The Auto tab applies them to every photo
              taken with it, on top of its look; only the lens settings change.
            </Note>
            <button type="button" onClick={onSaveLensPreset}>Save lens preset</button>
          </>
        )}
      </div>
    </div>
  );
}

function LutPanel({ params, loading, onChange, onSelect }: { params: DevelopParams; loading: boolean; onChange: (p: DevelopParams) => void; onSelect: (id: string | null) => void }) {
  const lib = useSyncExternalStore(LutRepository.subscribe, LutRepository.library);
  const row = (name: string, id: string | null) => (
    <label key={id ?? 'none'} className="lut-row">
      <input type="radio" name="lut" checked={params.lut === id} onChange={() => onSelect(id)} />
      <span>{name}</span>
      {loading && params.lut === id && id != null && <span className="spinner small" />}
    </label>
  );
  const canPickFolder = 'showDirectoryPicker' in window;
  return (
    <>
      {params.lut != null && (
        <ParamSlider label="Strength" value={params.lutAmount} min={0} max={100} defaultValue={100} format={formatPlain} onChange={(v) => onChange({ ...params, lutAmount: v })} />
      )}
      {row('No LUT', null)}
      <SectionLabel>Included</SectionLabel>
      {lib.bundled.map((e: LutEntry) => row(e.name, e.id))}
      <SectionLabel>Your LUTs{lib.folder ? ` · ${lib.folder}` : ''}</SectionLabel>
      {lib.user.length === 0 && <Note>Add your own .cube and HaldCLUT .png files.</Note>}
      {lib.user.map((e: LutEntry) => row(e.name, e.id))}
      <div className="button-row">
        <button type="button" onClick={async () => LutRepository.addFiles(await pickFiles(true, '.cube,.png'))}>
          Add files
        </button>
        {canPickFolder && (
          <button type="button" onClick={() => LutRepository.chooseFolder().catch(() => undefined)}>
            {lib.folder ? 'Change folder' : 'Choose folder'}
          </button>
        )}
      </div>
    </>
  );
}

/** Log-scaled Kelvin slider: equal travel per ratio of temperature. */
function TemperatureSlider({ kelvin, defaultKelvin, onChange }: { kelvin: number; defaultKelvin: number; onChange: (k: number) => void }) {
  const min = WhiteBalance.MIN_KELVIN;
  const max = WhiteBalance.MAX_KELVIN;
  const ratio = Math.log(max / min);
  const toPosition = (k: number) => Math.log(Math.min(max, Math.max(min, k)) / min) / ratio;
  const fromPosition = (t: number) => min * (max / min) ** t;
  return (
    <ParamSlider
      label="Temperature"
      value={toPosition(kelvin)}
      min={0}
      max={1}
      defaultValue={toPosition(defaultKelvin)}
      format={(t) => `${Math.round(fromPosition(t) / 10) * 10} K`}
      onChange={(t) => onChange(t === toPosition(defaultKelvin) ? defaultKelvin : fromPosition(t))}
    />
  );
}

interface GeometryProps {
  params: DevelopParams;
  onChange: (p: DevelopParams) => void;
  onRotate: (q: number) => void;
  onFlip: (vertical: boolean) => void;
  aspect: CropAspect;
  portrait: boolean;
  onAspect: (aspect: CropAspect, portrait: boolean) => void;
  onResetCrop: () => void;
  onDone: () => void;
}

/**
 * Rotate in 90 degree steps, flip, straighten the horizon (auto-cropped) and crop, optionally to a fixed aspect ratio.
 */
export function GeometryPanel({ params, onChange, onRotate, onFlip, aspect, portrait, onAspect, onResetCrop, onDone }: GeometryProps) {
  return (
    <div className="controls geometry">
      <div className="geometry-head">
        <strong>Crop &amp; rotate</strong>
        <span>
          <button type="button" className="text" onClick={onResetCrop} disabled={isFullCrop(cropOf(params)) && aspect === 'free'}>
            Reset crop
          </button>
          <button type="button" className="text" onClick={onDone}>
            Done
          </button>
        </span>
      </div>
      <div className="button-row">
        <button type="button" onClick={() => onRotate(-1)}>↺ Left</button>
        <button type="button" onClick={() => onRotate(1)}>Right ↻</button>
        <button type="button" onClick={() => onFlip(false)} title="Flip horizontally (mirror left-right)">⇆ Flip</button>
        <button type="button" onClick={() => onFlip(true)} title="Flip vertically (mirror top-bottom)">⇅ Flip</button>
        <button type="button" onClick={() => onAspect(aspect, !portrait)} disabled={aspect === 'free' || aspect === '1:1'}>
          {portrait ? 'Portrait' : 'Landscape'}
        </button>
      </div>
      <div className="chips">
        {CROP_ASPECTS.map((a) => (
          <button key={a} type="button" className={a === aspect ? 'active' : ''} onClick={() => onAspect(a, portrait)}>
            {cropAspectLabel(a, portrait)}
          </button>
        ))}
      </div>
      <ParamSlider
        label="Straighten"
        value={params.straighten}
        min={-45}
        max={45}
        step={0.1}
        defaultValue={0}
        format={formatDegrees}
        onChange={(v) => onChange({ ...params, straighten: Math.round(v * 10) / 10 })}
      />
      <Note>Drag the corners, edges or inside of the frame to crop. Straightening crops automatically so no empty corners show. Resets for each new photo.</Note>
    </div>
  );
}

export const SectionLabel = ({ children }: { children: React.ReactNode }) => <div className="section-label">{children}</div>;
export const Note = ({ children }: { children: React.ReactNode }) => <div className="note">{children}</div>;
