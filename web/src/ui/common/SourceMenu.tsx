import { useEffect, useRef, useState, type ReactNode } from 'react';
import { driveConfigured } from '../../drive/Drive';

/**
 * Open / Add: with Google Drive set up for the site, a menu of This device and Google Drive; otherwise the plain
 * button. Each item runs from its click, which the Drive window needs (pop-up blockers).
 */
export function SourceMenu({ className, title, label, disabled, alignLeft = false, onDevice, onDrive, children }: {
  className: string;
  /** The menu opens rightwards from the button's left edge (a button near the left of the screen). */
  alignLeft?: boolean;
  title?: string;
  label?: string;
  disabled?: boolean;
  onDevice: () => void;
  onDrive: () => void;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', close);
    window.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', esc);
    };
  }, [open]);
  if (!driveConfigured()) {
    return <button type="button" className={className} title={title} aria-label={label} onClick={onDevice} disabled={disabled}>{children}</button>;
  }
  const choose = (f: () => void) => () => {
    setOpen(false);
    f();
  };
  return (
    <div className="source-menu" ref={ref}>
      <button type="button" className={className} title={title} aria-label={label} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)} disabled={disabled}>
        {children}
      </button>
      {open && (
        <div className={alignLeft ? 'menu align-left' : 'menu'} role="menu">
          <button type="button" role="menuitem" onClick={choose(onDevice)}>From this device</button>
          <button type="button" role="menuitem" onClick={choose(onDrive)}>From Google Drive</button>
        </div>
      )}
    </div>
  );
}
