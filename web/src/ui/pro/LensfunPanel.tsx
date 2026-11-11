import { useState, useSyncExternalStore } from 'react';
import type { DevelopParams } from '../../engine/develop/DevelopParams';
import {
  FISHEYE_TYPES, LENS_TYPES, compatibleMounts, cropFactorOf, searchByWords,
  type LensfunCamera, type LensfunIndex, type LensfunLens, type LensType,
} from '../../engine/lens/Lensfun';
import type { LensfunMode, LensfunStore } from './LensfunStore';

const MODES: { mode: LensfunMode; label: string; title: string }[] = [
  { mode: 'auto', label: 'Auto', title: "Match the photo's camera and lens from its EXIF" },
  { mode: 'manual', label: 'Pick lens', title: 'Choose the camera and lens from the database' },
  { mode: 'generic', label: 'Generic', title: 'Describe a lens that is not in the database' },
];

const TYPE_LABELS: Record<LensType, string> = {
  rectilinear: 'Rectilinear (normal)',
  fisheye: 'Fisheye, equidistant',
  equisolid: 'Fisheye, equisolid angle',
  stereographic: 'Fisheye, stereographic',
  orthographic: 'Fisheye, orthographic',
  panoramic: 'Panoramic',
  equirectangular: 'Equirectangular',
};
const GENERIC_TYPES = LENS_TYPES.filter((t) => t === 'rectilinear' || FISHEYE_TYPES.includes(t));

const lensLabel = (l: LensfunLens) => (l.model.toLowerCase().startsWith(l.maker.toLowerCase()) ? l.model : `${l.maker} ${l.model}`);
const cameraLabel = (c: LensfunCamera) => `${c.model.toLowerCase().startsWith(c.maker.toLowerCase()) ? c.model : `${c.maker} ${c.model}`}${c.variant ? ` (${c.variant})` : ''}`;

/** A searchable list: type words to filter, tap to pick; the pick is shown on top with a way to clear it. */
function SearchPick<T>({ label, items, text, selected, onPick, placeholder, extra }: {
  label: string;
  items: readonly T[];
  text: (t: T) => string;
  selected: T | null;
  onPick: (t: T | null) => void;
  placeholder: string;
  extra?: React.ReactNode;
}) {
  const [query, setQuery] = useState('');
  const hits = query.trim() ? searchByWords(items, query, text, 40) : [];
  return (
    <div className="lensfun-pick">
      <div className="lensfun-pick-head">
        <span>{label}</span>
        {selected && (
          <button type="button" className="link" onClick={() => onPick(null)}>
            Clear
          </button>
        )}
      </div>
      {selected && <div className="lensfun-selected">{text(selected)}</div>}
      <input type="search" aria-label={`Search ${label.toLowerCase()}`} placeholder={placeholder} value={query} onChange={(e) => setQuery(e.target.value)} />
      {extra}
      {query.trim() !== '' && (
        <div className="lensfun-hits" role="listbox" aria-label={`${label} results`}>
          {hits.length === 0 && <div className="note">Nothing found</div>}
          {hits.map((t) => (
            <button
              key={text(t)}
              type="button"
              role="option"
              aria-selected={t === selected}
              className={t === selected ? 'active' : ''}
              onClick={() => {
                onPick(t);
                setQuery('');
              }}
            >
              {text(t)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** A number box that accepts what is typed and commits valid numbers. */
function NumberField({ label, value, min, max, step, onChange, unit }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; unit?: string }) {
  const [text, setText] = useState<string | null>(null);
  return (
    <label className="lensfun-field">
      <span>{unit ? `${label} (${unit})` : label}</span>
      <input
        type="number"
        inputMode="decimal"
        min={min}
        max={max}
        step={step}
        value={text ?? (value === 0 ? '' : String(value))}
        onChange={(e) => {
          setText(e.target.value);
          const v = Number(e.target.value);
          if (e.target.value !== '' && Number.isFinite(v) && v >= min && v <= max) onChange(v);
        }}
        onBlur={() => setText(null)}
      />
    </label>
  );
}

/** The Lens tab's Lensfun section: switch, auto-match, manual pick and generic lens. */
export function LensfunPanel({ store, params, onChange, hasFileProfile }: { store: LensfunStore; params: DevelopParams; onChange: (p: DevelopParams) => void; hasFileProfile: boolean }) {
  const s = useSyncExternalStore(store.subscribe, () => store.state);
  const [allMounts, setAllMounts] = useState(false);
  const db: LensfunIndex | null = s.db;
  const lensItems = (() => {
    if (!db) return [];
    if (s.mode !== 'manual' || !s.camera || allMounts) return db.lenses;
    const mounts = compatibleMounts(db, s.camera.mount);
    return db.lenses.filter((l) => l.mounts.some((m) => mounts.includes(m)));
  })();
  const g = s.generic;
  const straighten = () => onChange({ ...params, lensFisheye: 100, lensFisheyeFov: Math.min(220, Math.max(90, Math.round(s.fisheyeFov))) });

  return (
    <>
      <div className="section-label">Lensfun lens database</div>
      <label className="switch-row">
        <span>Use Lensfun profile</span>
        <input type="checkbox" checked={s.enabled} onChange={(e) => store.setEnabled(e.target.checked)} />
      </label>
      {!s.enabled && <div className="note">Distortion, chromatic aberration and vignetting from the Lensfun database. Loaded only when switched on.</div>}
      {s.enabled && (
        <>
          <div className="segmented" role="group" aria-label="Lens source">
            {MODES.map((m) => (
              <button key={m.mode} type="button" title={m.title} className={s.mode === m.mode ? 'active' : ''} onClick={() => store.setMode(m.mode)}>
                {m.label}
              </button>
            ))}
          </div>
          {s.loading && <div className="note">Loading the lens database…</div>}
          {s.error && <div className="note error">{s.error}</div>}

          {s.mode === 'auto' && db && (
            <div className="note">
              {s.lens
                ? `Matched ${s.camera ? `${cameraLabel(s.camera)}, ` : ''}${lensLabel(s.lens)}`
                : s.exifLens
                  ? `No profile found for “${s.exifLens}”${s.exifCamera ? ` on ${s.exifCamera}` : ''}. Pick the lens, or describe it under Generic.`
                  : `This photo records no lens${s.exifCamera ? ` (${s.exifCamera})` : ''}. Pick the lens, or describe it under Generic.`}
            </div>
          )}

          {s.mode === 'manual' && db && (
            <>
              <SearchPick
                label="Camera"
                items={db.cameras}
                text={cameraLabel}
                selected={s.camera}
                onPick={store.pickCamera}
                placeholder="Search cameras, e.g. fujifilm x-t3"
              />
              <SearchPick
                label="Lens"
                items={lensItems}
                text={lensLabel}
                selected={s.lens}
                onPick={store.pickLens}
                placeholder="Search lenses, e.g. 18-55 f/2.8"
                extra={
                  s.camera && (
                    <label className="lensfun-check">
                      <input type="checkbox" checked={allMounts} onChange={(e) => setAllMounts(e.target.checked)} />
                      <span>Lenses of every mount (adapted lenses)</span>
                    </label>
                  )
                }
              />
              {!s.camera && <div className="note">Without a camera the sensor size comes from the photo’s 35 mm equivalent focal length, else the lens’s own.</div>}
            </>
          )}

          {s.mode !== 'generic' && s.lens && (
            <div className="lensfun-fields">
              <NumberField label="Focal length" value={Math.round(s.focal * 10) / 10} min={1} max={2000} step={0.1} unit="mm" onChange={store.setFocal} />
              <NumberField label="Aperture" value={Math.round(s.aperture * 10) / 10} min={0.5} max={64} step={0.1} unit="f/" onChange={store.setAperture} />
            </div>
          )}

          {s.mode === 'generic' && (
            <>
              <div className="lensfun-fields">
                <NumberField label="Crop factor" value={g.crop} min={0.2} max={10} step={0.01} onChange={(v) => store.setGeneric({ crop: v })} />
                <NumberField label="Focal length" value={g.focal} min={1} max={2000} step={0.1} unit="mm" onChange={(v) => store.setGeneric({ focal: v })} />
                <NumberField label="Aperture" value={g.aperture} min={0.5} max={64} step={0.1} unit="f/" onChange={(v) => store.setGeneric({ aperture: v })} />
              </div>
              <SensorSize onCrop={(c) => store.setGeneric({ crop: c })} />
              <label className="lensfun-field wide">
                <span>Lens type</span>
                <select value={g.type} onChange={(e) => store.setGeneric({ type: e.target.value as LensType })}>
                  {GENERIC_TYPES.map((t) => (
                    <option key={t} value={t}>{TYPE_LABELS[t]}</option>
                  ))}
                </select>
              </label>
              <details className="lensfun-advanced">
                <summary>Known coefficients (optional)</summary>
                <div className="lensfun-fields">
                  <NumberField label="a" value={g.a} min={-1} max={1} step={0.0001} onChange={(v) => store.setGeneric({ a: v })} />
                  <NumberField label="b" value={g.b} min={-1} max={1} step={0.0001} onChange={(v) => store.setGeneric({ b: v })} />
                  <NumberField label="c" value={g.c} min={-1} max={1} step={0.0001} onChange={(v) => store.setGeneric({ c: v })} />
                </div>
                <div className="note">Distortion in PTLens’ terms (as Hugin or the Lensfun database list them). Leave at 0 for none.</div>
                <div className="lensfun-fields">
                  <NumberField label="k1" value={g.k1} min={-5} max={5} step={0.001} onChange={(v) => store.setGeneric({ k1: v })} />
                  <NumberField label="k2" value={g.k2} min={-5} max={5} step={0.001} onChange={(v) => store.setGeneric({ k2: v })} />
                  <NumberField label="k3" value={g.k3} min={-5} max={5} step={0.001} onChange={(v) => store.setGeneric({ k3: v })} />
                </div>
                <div className="note">Vignetting (Lensfun’s “pa” terms, r = 1 at the corner). Leave at 0 for none.</div>
              </details>
            </>
          )}

          {s.applied != null && s.applied !== '' && <div className="note">Applying: {s.applied}{hasFileProfile ? ' (replaces the file’s own profile)' : ''}</div>}
          {s.applied === '' && (s.lens || s.mode === 'generic') && (
            <div className="note">{s.mode === 'generic' ? 'A generic lens has no corrections unless you enter coefficients.' : 'The database has no corrections for this lens at this sensor size.'}</div>
          )}
          {s.fisheyeFov > 0 && (
            <>
              <div className="button-row">
                <button type="button" onClick={straighten} disabled={params.lensFisheye === 100 && Math.round(s.fisheyeFov) === params.lensFisheyeFov}>
                  Straighten fisheye ({Math.round(s.fisheyeFov)}° diagonal)
                </button>
              </div>
              <div className="note">Sets the Fisheye slider and its field of view from the focal length and sensor. It assumes an equidistant projection, so other fisheye types are approximate.</div>
            </>
          )}
          {db && <div className="note">Lens data: Lensfun database ({db.source.date}), CC BY-SA 3.0.</div>}
        </>
      )}
    </>
  );
}

/** Crop factor from a sensor's size in mm, for the generic lens. */
function SensorSize({ onCrop }: { onCrop: (crop: number) => void }) {
  const [w, setW] = useState(0);
  const [h, setH] = useState(0);
  return (
    <details className="lensfun-advanced">
      <summary>Sensor size instead of crop factor</summary>
      <div className="lensfun-fields">
        <NumberField label="Width" value={w} min={1} max={200} step={0.1} unit="mm" onChange={(v) => { setW(v); if (h > 0) onCrop(Math.round(cropFactorOf(v, h) * 1000) / 1000); }} />
        <NumberField label="Height" value={h} min={1} max={200} step={0.1} unit="mm" onChange={(v) => { setH(v); if (w > 0) onCrop(Math.round(cropFactorOf(w, v) * 1000) / 1000); }} />
      </div>
      <div className="note">Full frame is 36 × 24 mm, APS-C about 23.5 × 15.6, Micro Four Thirds 17.3 × 13.</div>
    </details>
  );
}
