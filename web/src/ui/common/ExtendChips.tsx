import { ALL_SIDES, anySide, NO_SIDES, type ExtendSides } from '../../engine/develop/CropMath';

const SIDES: readonly { key: keyof ExtendSides; label: string; title: string }[] = [
  { key: 'left', label: 'Left', title: 'Extend past the left edge' },
  { key: 'right', label: 'Right', title: 'Extend past the right edge' },
  { key: 'top', label: 'Top', title: 'Extend past the top edge' },
  { key: 'bottom', label: 'Bottom', title: 'Extend past the bottom edge' },
];

/**
 * Crop & rotate's Extend canvas: the first chip turns every side on or off, the four after it (shown while Extend is
 * on) choose which edges the crop may reach past. A side that is off keeps the crop on the photo's edge.
 */
export function ExtendChips({ sides, onSides }: { sides: ExtendSides; onSides: (s: ExtendSides) => void }) {
  const on = anySide(sides);
  return (
    <div className="chips">
      <button type="button" className={on ? 'active' : ''} aria-pressed={on} onClick={() => onSides(on ? NO_SIDES : ALL_SIDES)} title="Let the crop reach past the photo's edges; the new canvas is filled from the picture itself">
        Extend canvas
      </button>
      {on &&
        SIDES.map((s) => (
          <button key={s.key} type="button" className={sides[s.key] ? 'active' : ''} aria-pressed={sides[s.key]} onClick={() => onSides({ ...sides, [s.key]: !sides[s.key] })} title={s.title}>
            {s.label}
          </button>
        ))}
    </div>
  );
}
