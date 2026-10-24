import { useEffect, type ReactNode } from 'react';
import { shortcutKey } from './shortcutKey';

/** One line of a help sheet: the keys (each a combination such as "Mod+Z"), or the gesture, and what it does. */
export interface HelpItem {
  /** Alternative key combinations; "Mod" is ⌘ on Apple devices and Ctrl elsewhere. */
  keys?: string[];
  /** A mouse or touch action, or the control's name, shown where the keys would be ("Mod" as in keys). */
  how?: string;
  text: string;
}

export interface HelpSection {
  title: string;
  items: HelpItem[];
}

/** ⌘ instead of Ctrl, as macOS and iPadOS keyboards label it. */
export const isApple = /Mac|iPhone|iPad|iPod/.test(
  (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform || navigator.platform || navigator.userAgent,
);

const keyLabel = (k: string) => (k === 'Mod' ? (isApple ? '⌘' : 'Ctrl') : k);

/** The shortcut that opens and closes the help: Ctrl+/ (⌘/ on Apple devices), as in Google's apps. */
export const isHelpShortcut = (e: KeyboardEvent) => shortcutKey(e) === '/' && (isApple ? e.metaKey : e.ctrlKey) && !e.altKey;

/** The shortcut's label for the "?" button's tooltip. */
export const HELP_SHORTCUT = isApple ? '⌘/' : 'Ctrl+/';

function Keys({ combos }: { combos: string[] }) {
  return (
    <>
      {combos.map((combo, i) => (
        <span key={combo} className="help-combo">
          {i > 0 && <span className="help-or">or</span>}
          {combo.split('+').map((k) => <kbd key={k}>{keyLabel(k)}</kbd>)}
        </span>
      ))}
    </>
  );
}

/**
 * The "?" sheet: what the tab does, its mouse and touch gestures and its keyboard shortcuts. Esc or the shortcut
 * closes it; while it is open other shortcuts (Z, arrows, mask keys) don't reach the page.
 */
export function HelpDialog({ title, sections, onDismiss, about }: { title: string; sections: HelpSection[]; onDismiss: () => void; about?: ReactNode }) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Tab') return;
      e.stopPropagation();
      if (e.key === 'Escape' || isHelpShortcut(e)) {
        e.preventDefault();
        onDismiss();
      }
    };
    // Capture on window runs before the page's own window listeners.
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, [onDismiss]);
  return (
    <div className="dialog-backdrop" onClick={onDismiss}>
      <div className="dialog help" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={`${title} help`}>
        <div className="help-header">
          <h2>{title}</h2>
          <button type="button" className="text" onClick={onDismiss} autoFocus>Close</button>
        </div>
        <div className="help-body">
          {sections.map((s) => (
            <section key={s.title}>
              <h3>{s.title}</h3>
              <dl>
                {s.items.map((item) => (
                  <div key={item.text} className="help-row">
                    <dt>
                      {item.keys && <Keys combos={item.keys} />}
                      {item.keys && item.how && <span className="help-or">or</span>}
                      {item.how?.replace(/\bMod\b/g, keyLabel('Mod'))}
                    </dt>
                    <dd>{item.text}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
        {about && <div className="help-about">{about}</div>}
        <p className="muted help-footer">
          Press <kbd>{isApple ? '⌘' : 'Ctrl'}</kbd><kbd>/</kbd> to show or hide this, <kbd>Esc</kbd> to close it.
        </p>
      </div>
    </div>
  );
}
