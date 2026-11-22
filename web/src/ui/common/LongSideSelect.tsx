import { useState } from 'react';
import { MAX_LONG_SIDE, MIN_LONG_SIDE, parseLongSide } from '../../engine/export/ExportSettings';

const CUSTOM = 'custom';

/**
 * Export size: a preset long side (null = full resolution) or a custom one typed in pixels. Only a valid custom value
 * reaches onChange; an invalid one shows the allowed range and leaves the last good size.
 */
export function LongSideSelect({ value, presets, fullLabel, label, disabled, onChange }: {
  value: number | null;
  presets: (number | null)[];
  fullLabel: string;
  /** aria-label of the select */
  label?: string;
  disabled?: boolean;
  onChange: (v: number | null) => void;
}) {
  const isCustomValue = value !== null && !presets.includes(value);
  const [custom, setCustom] = useState(isCustomValue);
  const [text, setText] = useState(isCustomValue ? String(value) : '');
  const showCustom = custom || isCustomValue;
  const invalid = showCustom && text !== '' && parseLongSide(text) === null;
  return (
    <>
      <select
        aria-label={label}
        disabled={disabled}
        value={showCustom ? CUSTOM : (value ?? '')}
        onChange={(e) => {
          if (e.target.value === CUSTOM) {
            setCustom(true);
            setText(value !== null ? String(value) : '');
            return;
          }
          setCustom(false);
          onChange(e.target.value ? Number(e.target.value) : null);
        }}
      >
        {presets.map((v) => (
          <option key={v ?? 'full'} value={v ?? ''}>{v ? `${v} px` : fullLabel}</option>
        ))}
        <option value={CUSTOM}>Custom…</option>
      </select>
      {showCustom && (
        <span className="long-side-custom">
          <input
            type="text"
            inputMode="numeric"
            aria-label="Custom long side in pixels"
            aria-invalid={invalid}
            placeholder="px"
            size={6}
            disabled={disabled}
            value={text}
            onChange={(e) => {
              const t = e.target.value;
              setText(t);
              const n = parseLongSide(t);
              if (n !== null) onChange(n);
            }}
          />
          <small className={invalid ? 'error' : 'muted'}>
            {invalid ? `${MIN_LONG_SIDE}–${MAX_LONG_SIDE} px` : 'px long side'}
          </small>
        </span>
      )}
    </>
  );
}
