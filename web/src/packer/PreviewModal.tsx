import { useEffect, useState } from 'react';
import { findEmbeddedPreview, type EmbeddedPreview } from '../engine/browse/EmbeddedPreview';
import type { PackItem } from './PackerStore';

interface PreviewModalProps {
  item: PackItem;
  onClose: () => void;
  onPrev?: () => void;
  onNext?: () => void;
  hasPrev?: boolean;
  hasNext?: boolean;
}

export function PreviewModal({ item, onClose, onPrev, onNext, hasPrev, hasNext }: PreviewModalProps) {
  const [data, setData] = useState<{ url: string; preview: EmbeddedPreview } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    let objectUrl: string | null = null;
    setLoading(true);
    setData(null);

    findEmbeddedPreview(item.file).then(
      (prev) => {
        if (!active) return;
        if (prev) {
          objectUrl = URL.createObjectURL(prev.jpeg);
          setData({ url: objectUrl, preview: prev });
        }
        setLoading(false);
      },
      () => {
        if (active) setLoading(false);
      },
    );

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

  const i = item.info;
  const camera = i ? `${i.make} ${i.model}`.trim() : '';

  return (
    <div className="dialog-backdrop packer-preview-backdrop" onClick={onClose} role="dialog" aria-modal="true" aria-label={`Preview of ${item.file.name}`}>
      <div className="packer-preview-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="packer-preview-header">
          <div className="packer-preview-meta">
            <span className="packer-preview-name">{item.file.name}</span>
            <span className="packer-preview-sub">
              {camera ? `${camera} · ` : ''}
              {data ? `${data.preview.width} × ${data.preview.height} px · ` : ''}
              {(item.file.size / 1e6).toFixed(1)} MB
            </span>
          </div>
          <button type="button" className="packer-preview-close text" onClick={onClose} aria-label="Close preview">
            ✕
          </button>
        </div>

        <div className="packer-preview-body">
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
