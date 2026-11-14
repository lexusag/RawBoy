import { useState } from 'react';
import {
  DATE_STAMP_FORMATS,
  DATE_STAMP_STYLES,
  TIME_STAMP_FORMATS,
  type DateStampFormat,
  type DateStampStyle,
  type TimeStampFormat,
} from '../../engine/export/DateStamp';
import type { ExportSettings } from '../../engine/export/ExportSettings';
import {
  EXPORT_PENTAX645_FIELDS,
  FILM_FRAME_COLORS,
  PENTAX645_FIELD_LABELS,
  PHOTO_FRAMES,
  type FilmFrameColor,
  type Pentax645Field,
  type PhotoFrame,
} from '../../engine/export/Pentax645Frame';

/**
 * Shared frame and date-stamp controls for the Pro and Auto export dialogs.
 * Mirrors Android's `ExportFrameControls.kt` and iOS's `ExportFrameSections.swift`.
 */
export function ExportFrameControls({
  settings,
  onChange,
  disabled = false,
}: {
  settings: ExportSettings;
  onChange: (next: ExportSettings) => void;
  disabled?: boolean;
}) {
  const [dragField, setDragField] = useState<Pentax645Field | null>(null);

  const photoFrame: PhotoFrame = settings.photoFrame ?? 'NONE';
  const dateStampStyle: DateStampStyle = settings.dateStampStyle ?? 'CLASSIC';
  const dateStampFormat: DateStampFormat = settings.dateStampFormat ?? 'DMY';
  const timeStampFormat: TimeStampFormat = settings.timeStampFormat ?? 'H24';
  const frameColor: FilmFrameColor = settings.frameColor ?? 'AMBER';
  const pentax645Flip = Boolean(settings.pentax645Flip);
  const enabledFields = new Set<Pentax645Field>(settings.pentax645Fields ?? EXPORT_PENTAX645_FIELDS);

  const rawOrder = settings.pentax645Order ?? EXPORT_PENTAX645_FIELDS;
  const orderedFields: Pentax645Field[] = [
    ...rawOrder.filter((f) => EXPORT_PENTAX645_FIELDS.includes(f)),
    ...EXPORT_PENTAX645_FIELDS.filter((f) => !rawOrder.includes(f)),
  ];

  const moveField = (fromIdx: number, toIdx: number) => {
    if (toIdx < 0 || toIdx >= orderedFields.length || fromIdx === toIdx) return;
    const next = [...orderedFields];
    const [moved] = next.splice(fromIdx, 1);
    next.splice(toIdx, 0, moved);
    onChange({ ...settings, pentax645Order: next });
  };

  return (
    <div className="export-frame-controls">
      <div className="field">
        <span>Frame</span>
        <div className="segmented">
          {PHOTO_FRAMES.map((f) => (
            <button
              key={f.value}
              type="button"
              className={photoFrame === f.value ? 'active' : ''}
              aria-pressed={photoFrame === f.value}
              disabled={disabled}
              onClick={() => onChange({ ...settings, photoFrame: f.value })}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {photoFrame === 'DATE_STAMP' && (
        <>
          <div className="field">
            <span>Style</span>
            <div className="segmented">
              {DATE_STAMP_STYLES.map((st) => (
                <button
                  key={st.value}
                  type="button"
                  className={dateStampStyle === st.value ? 'active' : ''}
                  aria-pressed={dateStampStyle === st.value}
                  disabled={disabled}
                  onClick={() => onChange({ ...settings, dateStampStyle: st.value })}
                >
                  {st.label}
                </button>
              ))}
            </div>
          </div>
          <label className="field">
            <span>Date format</span>
            <select
              disabled={disabled}
              value={dateStampFormat === 'MMM_YY' ? 'DMY' : dateStampFormat}
              onChange={(e) => onChange({ ...settings, dateStampFormat: e.target.value as DateStampFormat })}
            >
              {DATE_STAMP_FORMATS.filter((f) => f.value !== 'MMM_YY').map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
            </select>
          </label>
        </>
      )}

      {(photoFrame === 'PENTAX_645' || photoFrame === 'CONTAX_645') && (
        <>
          <div className="field">
            <span>Color</span>
            <div className="segmented">
              {FILM_FRAME_COLORS.map((c) => (
                <button
                  key={c.value}
                  type="button"
                  className={frameColor === c.value ? 'active' : ''}
                  aria-pressed={frameColor === c.value}
                  disabled={disabled}
                  onClick={() => onChange({ ...settings, frameColor: c.value })}
                >
                  {c.label}
                </button>
              ))}
            </div>
          </div>

          <label className="switch-row">
            <span>
              Flip info upside down
              <small className="muted" style={{ display: 'block' }}>
                Rotate shoot info 180° like on real film
              </small>
            </span>
            <input
              type="checkbox"
              checked={pentax645Flip}
              disabled={disabled}
              onChange={(e) => onChange({ ...settings, pentax645Flip: e.target.checked })}
            />
          </label>

          {enabledFields.has('date') && (
            <label className="field">
              <span>Date format</span>
              <select
                disabled={disabled}
                value={dateStampFormat}
                onChange={(e) => onChange({ ...settings, dateStampFormat: e.target.value as DateStampFormat })}
              >
                {DATE_STAMP_FORMATS.map((f) => (
                  <option key={f.value} value={f.value}>
                    {f.label}
                  </option>
                ))}
              </select>
            </label>
          )}

          {enabledFields.has('time') && (
            <label className="field">
              <span>Time format</span>
              <select
                disabled={disabled}
                value={timeStampFormat}
                onChange={(e) => onChange({ ...settings, timeStampFormat: e.target.value as TimeStampFormat })}
              >
                {TIME_STAMP_FORMATS.map((f) => (
                  <option key={f.value} value={f.value}>
                    {f.label}
                  </option>
                ))}
              </select>
            </label>
          )}

          <div className="field">
            <span>Shoot info (drag to reorder)</span>
            <div className="export-frame-fields">
              {orderedFields.map((field, idx) => {
                const checked = enabledFields.has(field);
                return (
                  <div
                    key={field}
                    className={`export-frame-field-row${dragField === field ? ' dragging' : ''}`}
                    draggable={!disabled}
                    onDragStart={() => setDragField(field)}
                    onDragEnd={() => setDragField(null)}
                    onDragOver={(e) => {
                      e.preventDefault();
                      if (!dragField || dragField === field) return;
                      const fromIdx = orderedFields.indexOf(dragField);
                      if (fromIdx !== -1 && fromIdx !== idx) moveField(fromIdx, idx);
                    }}
                  >
                    <span className="drag-handle" aria-hidden="true">≡</span>
                    <label className="export-frame-field-label">
                      <span>{PENTAX645_FIELD_LABELS[field]}</span>
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={disabled}
                        onChange={(e) => {
                          const next = new Set(enabledFields);
                          if (e.target.checked) next.add(field);
                          else next.delete(field);
                          onChange({ ...settings, pentax645Fields: [...next] });
                        }}
                      />
                    </label>
                    <div className="reorder-buttons">
                      <button
                        type="button"
                        className="icon"
                        aria-label={`Move ${PENTAX645_FIELD_LABELS[field]} up`}
                        disabled={disabled || idx === 0}
                        onClick={() => moveField(idx, idx - 1)}
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        className="icon"
                        aria-label={`Move ${PENTAX645_FIELD_LABELS[field]} down`}
                        disabled={disabled || idx === orderedFields.length - 1}
                        onClick={() => moveField(idx, idx + 1)}
                      >
                        ↓
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
