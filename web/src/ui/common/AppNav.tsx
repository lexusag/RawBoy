import { createContext, useContext } from 'react';
import { HELP_SHORTCUT } from './HelpDialog';
import type { TabId } from './tabs';

export const TAB_NAMES: Record<TabId, string> = { pro: 'RawBoy', auto: 'Auto', browser: 'Browser' };

interface AppNav {
  tab: TabId;
  setTab: (tab: TabId) => void;
  openHelp: () => void;
}

/** App's tab and help, for the switcher and "?" each tab puts in its own tool bar (one bar instead of two). */
export const AppNavContext = createContext<AppNav>({ tab: 'pro', setTab: () => {}, openHelp: () => {} });

/**
 * Every app by name in one segmented control, so it's plain the page holds three apps (a "RawBoy ▾" menu went
 * unnoticed). Phones give it a line of its own at the top of the tool bar.
 */
export function AppSwitcher() {
  const { tab, setTab } = useContext(AppNavContext);
  return (
    <nav className="app-switcher" aria-label="Apps">
      {(Object.keys(TAB_NAMES) as TabId[]).map((t) => (
        <button
          key={t}
          type="button"
          className={t === tab ? 'active' : ''}
          aria-current={t === tab ? 'page' : undefined}
          title={t === 'pro' ? 'RawBoy: develop one photo' : `RawBoy ${TAB_NAMES[t]}`}
          onClick={() => setTab(t)}
        >
          {TAB_NAMES[t]}
        </button>
      ))}
    </nav>
  );
}

/**
 * The "?" that opens the tab's help (also Ctrl/⌘+/), with the decoder and Licences at its end. [wideOnly]: hidden on
 * narrow screens, for photo views whose bar is full there (the tab's main bar keeps it).
 */
export function HelpButton({ wideOnly = false }: { wideOnly?: boolean }) {
  const { openHelp } = useContext(AppNavContext);
  return (
    <button type="button" className={`help-button${wideOnly ? ' wide-only' : ''}`} title={`Help and shortcuts (${HELP_SHORTCUT})`} aria-label="Help and shortcuts" onClick={openHelp}>?</button>
  );
}
