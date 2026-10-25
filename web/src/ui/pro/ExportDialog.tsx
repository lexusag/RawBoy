import { useState } from 'react';
import { BandDownscaler } from '../../engine/export/BandDownscaler';
import { DEFAULT_EXPORT, EXTENSIONS, baseNameOf, fileName, type ExportSettings } from '../../engine/export/ExportSettings';
import { ParamSlider, formatPlain } from '../common/ParamSlider';
import { useExportDestination, type ExportDestination } from '../common/ExportDestination';

const SIZES: (number | null)[] = [null, 6000, 4000, 3000, 2048];

/** Format, quality / bit depth and size of the export (port of app-pro's ExportDialog.kt). */
export function ExportDialog({ initial, sourceName, outputSize, onDismiss, onExport }: {
  initial: ExportSettings;
  sourceName: string;
  /** Full output size (after rotation). */
  outputSize: [number, number];
  onDismiss: () => void;
  /** Called from the Export click (Google Drive opens its folder picker from it). */
  onExport: (s: ExportSettings, destination: ExportDestination) => void;
}) {
  const [s, setS] = useState(initial);
  const [destination, destinationRow] = useExportDestination(true);
  const [w, h] = BandDownscaler.outputSize(outputSize[0], outputSize[1], s.maxLongSide);
  return (
    <div className="dialog-backdrop" onClick={onDismiss}>
      <div className="dialog" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Export">
        <h2>Export</h2>
        <div className="segmented">
          {(['jpeg', 'tiff'] as const).map((f) => (
            <button key={f} type="button" className={s.format === f ? 'active' : ''} onClick={() => setS({ ...s, format: f })}>
              {f.toUpperCase()}
            </button>
          ))}
        </div>
        {s.format === 'jpeg' ? (
          <div className="field">
            <ParamSlider
              label="Quality"
              value={s.jpegQuality}
              min={1}
              max={100}
              step={1}
              defaultValue={DEFAULT_EXPORT.jpegQuality}
              format={formatPlain}
              onChange={(v) => setS({ ...s, jpegQuality: v })}
            />
            <small>jpegli, 16-bit input, 4:4:4 colour</small>
          </div>
        ) : (
          <div className="field">
            <span>Bit depth</span>
            <div className="segmented">
              {([8, 16] as const).map((b) => (
                <button key={b} type="button" className={s.tiffBits === b ? 'active' : ''} onClick={() => setS({ ...s, tiffBits: b })}>
                  {b}-bit
                </button>
              ))}
            </div>
          </div>
        )}
        <label className="field">
          <span>Size</span>
          <select value={s.maxLongSide ?? ''} onChange={(e) => setS({ ...s, maxLongSide: e.target.value ? Number(e.target.value) : null })}>
            {SIZES.map((v) => (
              <option key={v ?? 'full'} value={v ?? ''}>
                {v ? `${v} px long side` : 'Full resolution'}
              </option>
            ))}
          </select>
          <small>{w} × {h}</small>
        </label>
        {destinationRow}
        <small className="muted">
          {fileName(baseNameOf(sourceName), EXTENSIONS[s.format], 0, { suffix: 'rawboy' })}
          {destination === 'drive' && ', in a Google Drive folder you pick next'}
        </small>
        <div className="dialog-actions">
          <button type="button" className="text" onClick={onDismiss}>Cancel</button>
          <button type="button" className="primary" onClick={() => onExport(s, destination)}>Export</button>
        </div>
      </div>
    </div>
  );
}
