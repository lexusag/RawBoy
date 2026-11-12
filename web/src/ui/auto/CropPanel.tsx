import { CROP_ASPECTS, cropAspectLabel, type CropAspect } from '../../engine/develop/CropMath';
import { ParamSlider } from '../common/ParamSlider';
import type { AutoPhoto } from './AutoStore';

const formatDegrees = (v: number) => `${v.toFixed(2)}°`;

interface Props {
  photo: AutoPhoto;
  aspect: CropAspect;
  portrait: boolean;
  onAspect: (aspect: CropAspect, portrait: boolean) => void;
  onRotate: (quarterTurns: number) => void;
  onStraighten: (degrees: number) => void;
  onReset: () => void;
  onDone: () => void;
}

/**
 * Auto's Crop & rotate: the aspect shapes, turning in quarter steps and the horizon slider. Drag the frame on the photo
 * for the rest. Flip and perspective stay in the RawBoy tab.
 */
export function CropPanel({ photo, aspect, portrait, onAspect, onRotate, onStraighten, onReset, onDone }: Props) {
  const { crop, straighten } = photo.adjust;
  return (
    <div className="controls geometry">
      <div className="geometry-head">
        <strong>Crop &amp; rotate</strong>
        <span>
          <button type="button" className="text" onClick={onReset} disabled={!crop && straighten === 0 && aspect === 'free'}>
            Reset
          </button>
          <button type="button" className="text" onClick={onDone}>
            Done
          </button>
        </span>
      </div>
      <div className="button-row">
        <button type="button" onClick={() => onRotate(-1)}>↺ Left</button>
        <button type="button" onClick={() => onRotate(1)}>Right ↻</button>
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
      <ParamSlider label="Straighten" value={straighten} min={-45} max={45} step={0.01} defaultValue={0} format={formatDegrees} onChange={onStraighten} />
      <div className="note">Drag the corners, edges or inside of the frame to crop. Straightening crops automatically so no empty corners show. The crop is part of the export.</div>
    </div>
  );
}
