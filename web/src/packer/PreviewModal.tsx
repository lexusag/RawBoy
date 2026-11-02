import { useEffect, useRef, useState } from 'react';
import { findEmbeddedPreview } from '../engine/browse/EmbeddedPreview';
import type { PackItem } from './PackerStore';

interface PreviewModalProps {
  item: PackItem;
  onClose: () => void;
  onPrev?: () => void;
  onNext?: () => void;
  hasPrev?: boolean;
  hasNext?: boolean;
}

interface LoadedPreview {
  url: string;
  width: number;
  height: number;
}

export function PreviewModal({ item, onClose, onPrev, onNext, hasPrev, hasNext }: PreviewModalProps) {
  const [data, setData] = useState<LoadedPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const touchStartX = useRef<number | null>(null);
  const touchStartY = useRef<number | null>(null);

  useEffect(() => {
    let active = true;
    let objectUrl: string | null = null;
    setLoading(true);
    setData(null);

    const load = async () => {
      // 1. Try JXL preview first (for DNGs where JXL preview has the real high-res preview)
      try {
        const { jxlViewImageOf } = await import('../ui/browser/Previews');
        if (!active) return;
        const jxl = await jxlViewImageOf(item.file, 2560);
        if (!active) return;
        if (jxl) {
          objectUrl = URL.createObjectURL(jxl.blob);
          const [w, h] = jxl.size.split(' × ').map(Number);
          setData({ url: objectUrl, width: w || 0, height: h || 0 });
          setLoading(false);
          return;
        }
      } catch {
        // Fall through to standard embedded preview
      }

      // 2. Standard embedded preview
      try {
        const prev = await findEmbeddedPreview(item.file);
        if (!active) return;
        if (prev) {
          objectUrl = URL.createObjectURL(prev.jpeg);
          setData({ url: objectUrl, width: prev.width, height: prev.height });
        }
        setLoading(false);
      } catch {
        if (active) setLoading(false);
      }
    };

    void load();

    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [item.file]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if ((e.key === 'ArrowLeft' || e.key === 'ArrowUp') && hasPrev && onPrev) {
        e.preventDefault();
        onPrev();
      } else if ((e.key === 'ArrowRight' || e.key === 'ArrowDown') && hasNext && onNext) {
        e.preventDefault();
        onNext();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, onPrev, onNext, hasPrev, hasNext]);

  const onTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
  };

  const onTouchEnd = (e: React.TouchEvent) => {
    if (touchStartX.current === null || touchStartY.current === null) return;
    const deltaX = e.changedTouches[0].clientX - touchStartX.current;
    const deltaY = e.changedTouches[0].clientY - touchStartY.current;
    touchStartX.current = null;
    touchStartY.current = null;

    if (Math.abs(deltaX) > 40 && Math.abs(deltaX) > Math.abs(deltaY) * 1.3) {
      if (deltaX < 0 && hasNext && onNext) {
        onNext();
      } else if (deltaX > 0 && hasPrev && onPrev) {
        onPrev();
      }
    }
  };

  const i = item.info;
  const camera = i ? `${i.make} ${i.model}`.trim() : '';

  return (
    <div
      className="dialog-backdrop packer-preview-backdrop"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`Preview of ${item.file.name}`}
    >
      <div className="packer-preview-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="packer-preview-header">
          <div className="packer-preview-meta">
            <span className="packer-preview-name">{item.file.name}</span>
            <span className="packer-preview-sub">
              {camera ? `${camera} · ` : ''}
              {data ? `${data.width} × ${data.height} px · ` : ''}
              {(item.file.size / 1e6).toFixed(1)} MB
            </span>
          </div>
          <button type="button" className="packer-preview-close text" onClick={onClose} aria-label="Close preview">
            ✕
          </button>
        </div>

        <div
          className="packer-preview-body"
          onTouchStart={onTouchStart}
          onTouchEnd={onTouchEnd}
        >
          {loading && <div className="packer-preview-loading">Loading preview…</div>}
          {!loading && data && (
            <img src={data.url} alt={item.file.name} className="packer-preview-image" />
          )}
          {!loading && !data && (
            <div className="packer-preview-empty">No embedded preview found in this file.</div>
          )}

          {hasPrev && onPrev && (
            <button
              type="button"
              className="packer-preview-nav prev"
              onClick={(e) => {
                e.stopPropagation();
                onPrev();
              }}
              aria-label="Previous photo"
            >
              ‹
            </button>
          )}
          {hasNext && onNext && (
            <button
              type="button"
              className="packer-preview-nav next"
              onClick={(e) => {
                e.stopPropagation();
                onNext();
              }}
              aria-label="Next photo"
            >
              ›
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
