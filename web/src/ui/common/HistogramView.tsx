import { HISTOGRAM_BINS, type Histogram } from '../../engine/develop/Histogram';

/** Shown as clipped from this share of the photo (0.1%): a few stray pixels aren't worth a warning. */
const CLIP_SHOWN = 0.001;

const W = 256;
const H = 64;

function area(bins: Uint32Array, peak: number): string {
  const step = W / (HISTOGRAM_BINS - 1);
  let d = `M0 ${H}`;
  for (let i = 0; i < HISTOGRAM_BINS; i++) d += ` L${(i * step).toFixed(1)} ${(H - Math.min(1, bins[i] / peak) * H).toFixed(1)}`;
  return `${d} L${W} ${H} Z`;
}

const percent = (f: number) => (f >= 0.1 ? `${Math.round(f * 100)}%` : `${(f * 100).toFixed(1)}%`);

/**
 * The developed photo's red, green and blue levels, with the share of crushed shadows (left) and clipped highlights
 * (right). Clicking it toggles the clipping warning on the photo ([active]).
 */
export function HistogramView({ histogram, active, onToggle }: { histogram: Histogram | null; active: boolean; onToggle: () => void }) {
  const shadows = histogram ? histogram.shadows : 0;
  const highlights = histogram ? histogram.highlights : 0;
  return (
    <button
      type="button"
      className={`histogram${active ? ' active' : ''}`}
      aria-pressed={active}
      title={active ? 'Hide the clipping warning' : 'Show clipped highlights (red) and shadows (blue) on the photo'}
      onClick={onToggle}
    >
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
        {histogram && (
          <g style={{ mixBlendMode: 'screen' }}>
            <path d={area(histogram.red, histogram.peak)} fill="rgb(230, 70, 60)" fillOpacity={0.75} />
            <path d={area(histogram.green, histogram.peak)} fill="rgb(70, 200, 90)" fillOpacity={0.75} />
            <path d={area(histogram.blue, histogram.peak)} fill="rgb(70, 120, 240)" fillOpacity={0.75} />
          </g>
        )}
      </svg>
      <span className={`clip shadows${shadows > CLIP_SHOWN ? ' on' : ''}`}>{shadows > CLIP_SHOWN ? percent(shadows) : ''}</span>
      <span className={`clip highlights${highlights > CLIP_SHOWN ? ' on' : ''}`}>{highlights > CLIP_SHOWN ? percent(highlights) : ''}</span>
    </button>
  );
}
