import { useState } from 'react';
import {
  DEFAULT_EXPORT,
  EXTENSIONS,
  baseNameOf,
  exportOutputSize,
  fileName,
  type ExportSettings,
} from '../../engine/export/ExportSettings';
import { ExportFrameControls } from '../common/ExportFrameControls';
import { ParamSlider, formatPlain } from '../common/ParamSlider';
import { useExportDestination, type ExportDestination } from '../common/ExportDestination';

const SIZES: (number | null)[] = [null, 6000, 4000, 3000, 2048];

/** Format, quality / bit depth, size and frame of the export (port of app-pro's ExportDialog.kt). */
export function ExportDialog({ initial, sourceName, outputSize, film, onDismiss, onExport }: {
  initial: ExportSettings;
  sourceName: string;
  /** Full output size (after rotation). */
  outputSize: [number, number];
  /** A film look is on (the Film tone mapper): the Film scan option applies. */
  film: boolean;
  onDismiss: () => void;
  /** Called from the Export click (Google Drive opens its folder picker from it). */
  onExport: (s: ExportSettings, destination: ExportDestination) => void;
}) {
  const [s, setS] = useState(initial);
  const [destination, destinationRow] = useExportDestination(true);
  const scan = film && s.filmScan;
  const [w, h] = exportOutputSize(outputSize[0], outputSize[1], s, scan);
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
        {film && (
          <div className="field">
            <span>Film scan</span>
            <div className="segmented">
              {([false, true] as const).map((on) => (
                <button key={String(on)} type="button" className={s.filmScan === on ? 'active' : ''} onClick={() => setS({ ...s, filmScan: on })}>
                  {on ? '1.5× size' : 'Off'}
                </button>
              ))}
            </div>
            <small>Upscales the photo and grows the grain on a finer pitch, as a finer scan of the negative</small>
          </div>
        )}
        <label className="field">
          <span>Size</span>
          <select disabled={scan} value={s.maxLongSide ?? ''} onChange={(e) => setS({ ...s, maxLongSide: e.target.value ? Number(e.target.value) : null })}>
            {SIZES.map((v) => (
              <option key={v ?? 'full'} value={v ?? ''}>
                {v ? `${v} px long side` : 'Full resolution'}
              </option>
            ))}
          </select>
          <small>{w} × {h}</small>
        </label>
        <ExportFrameControls settings={s} onChange={setS} />
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
