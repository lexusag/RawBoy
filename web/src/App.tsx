import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { rawWorker } from './engine/raw/RawWorker';
import { LutRepository } from './engine/lut/LutRepository';
import { AutoApp } from './ui/auto/AutoApp';
import { AutoStore } from './ui/auto/AutoStore';
import { ProApp } from './ui/pro/ProApp';
import { ProStore } from './ui/pro/ProStore';
import { isLensPreset } from './engine/develop/Presets';
import { LicensesDialog } from './ui/common/LicensesDialog';
import { HelpDialog, isHelpShortcut } from './ui/common/HelpDialog';
import { AppNavContext } from './ui/common/AppNav';
import { PRO_HELP } from './ui/pro/help';
import { AUTO_HELP } from './ui/auto/help';
import { BrowserApp } from './ui/browser/BrowserApp';
import { BrowserStore } from './ui/browser/BrowserStore';
import type { EditsSidecar } from './engine/browse/XmpSidecar';
import { BROWSER_HELP } from './ui/browser/help';
import type { TabId } from './ui/common/tabs';

const TABS: TabId[] = ['pro', 'auto', 'browser'];
const TAB_KEY = 'rawboy.tab';

// One store per tab for the page's lifetime: switching tabs keeps each tab's photo and batch.
const pro = new ProStore();
const auto = new AutoStore();
const browser = new BrowserStore();
// A folder opened again brings the photos Auto edited back into Auto, with their settings (Edits in sidecars).
browser.onAutoEdited = (photos) => {
  const added = auto.add(photos.map((p) => p.file), photos.map((p) => p.sidecar));
  if (added) browser.showMessage(`${added} photo${added === 1 ? ' is' : 's are'} back in Auto with ${added === 1 ? 'its' : 'their'} edits`);
};
// Edits waiting for a photo's sidecar are written before the page may go away.
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) return;
  void pro.flushSidecar();
  void auto.flushSidecars();
});
// Lens presets live with the RawBoy tab's presets; the Auto tab applies them by lens.
auto.saveLensPresets = pro.putLensPresets;
let presets = pro.state.presets;
pro.subscribe(() => {
  if (pro.state.presets === presets) return;
  presets = pro.state.presets;
  auto.setLensPresets(presets.filter(isLensPreset));
});
const stores = { pro, auto, browser };
// The Auto photo the RawBoy tab's photo came from (Edit in RawBoy): "Back to Auto" gives that photo the edits.
let proFromAuto: { id: string; file: File } | null = null;

const isLutFile = (f: File) => /\.(cube|png)$/i.test(f.name);

export function App() {
  const [tab, setTab] = useState<TabId>(() => {
    try {
      const saved = localStorage.getItem(TAB_KEY) as TabId;
      return TABS.includes(saved) ? saved : 'pro';
    } catch {
      return 'pro';
    }
  });
  const [engine, setEngine] = useState<string>('Loading decoder…');
  const [dragging, setDragging] = useState(false);
  const [showLicenses, setShowLicenses] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const proState = useSyncExternalStore(pro.subscribe, () => pro.state);
  const autoState = useSyncExternalStore(auto.subscribe, () => auto.state);
  const browserState = useSyncExternalStore(browser.subscribe, () => browser.state);
  const message = { pro: proState, auto: autoState, browser: browserState }[tab].message;

  useEffect(() => {
    document.body.dataset.tab = tab;
    if (tab === 'auto') auto.resume();
    try {
      localStorage.setItem(TAB_KEY, tab);
    } catch {
      // not remembered
    }
  }, [tab]);

  useEffect(() => {
    rawWorker().ready.then(
      (r) => setEngine(`LibRaw${r.dngSdk ? ' + Adobe DNG SDK (JPEG XL)' : ''}${r.threads ? '' : ' · single-threaded'}`),
      (e: unknown) => setEngine(`Decoder failed to load: ${e instanceof Error ? e.message : String(e)}`),
    );
  }, []);

  // Ctrl+/ (⌘/ on Apple devices) opens the help, as in Google's apps; the open dialog handles closing it.
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (!isHelpShortcut(e)) return;
      e.preventDefault();
      setShowHelp(true);
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);

  // Messages disappear after a few seconds, like Android's snackbar.
  useEffect(() => {
    if (!message) return;
    const t = setTimeout(() => stores[tab].consumeMessage(), 4000);
    return () => clearTimeout(t);
  }, [message, tab]);

  // Drop raws onto the window: Pro opens the first, Auto adds them all; LUT files go to "Your LUTs".
  useEffect(() => {
    const over = (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes('Files')) return;
      e.preventDefault();
      setDragging(true);
    };
    const leave = (e: DragEvent) => {
      if (e.relatedTarget == null) setDragging(false);
    };
    const drop = (e: DragEvent) => {
      e.preventDefault();
      setDragging(false);
      // Browser: a dropped folder opens read-write where the browser hands out handles (Chrome, Edge). The handles
      // must be asked for during the event.
      const items = Array.from(e.dataTransfer?.items ?? []) as (DataTransferItem & { getAsFileSystemHandle?: () => Promise<FileSystemHandle | null> })[];
      const handles = tab === 'browser' ? items.map((i) => i.getAsFileSystemHandle?.()).filter((h) => h != null) : [];
      const files = Array.from(e.dataTransfer?.files ?? []);
      if (tab === 'browser') {
        void Promise.all(handles).then((hs) => {
          const dir = hs.find((h): h is FileSystemDirectoryHandle => h?.kind === 'directory');
          if (dir) return browser.openFolder(dir);
          const photos = files.filter((f) => !isLutFile(f) || /\.png$/i.test(f.name));
          if (photos.length) return browser.addFiles(photos);
        });
        return;
      }
      const luts = files.filter(isLutFile);
      const raws = files.filter((f) => !isLutFile(f));
      if (luts.length) LutRepository.addFiles(luts);
      if (!raws.length) return;
      if (tab === 'pro') void pro.open(raws[0]);
      else auto.add(raws);
    };
    window.addEventListener('dragover', over);
    window.addEventListener('dragleave', leave);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragover', over);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('drop', drop);
    };
  }, [tab]);

  const closeHelp = useCallback(() => setShowHelp(false), []);
  const nav = useMemo(() => ({ tab, setTab, openHelp: () => setShowHelp(true) }), [tab]);

  // Browser → RawBoy: one photo as shot; Browser → Auto: the chosen photos join Auto's batch.
  const browserEdit = (file: File, sidecar: EditsSidecar | null) => {
    if (pro.busy) return browser.showMessage('RawBoy is busy; try again when it has finished');
    void pro.open(file, undefined, sidecar);
    setTab('pro');
  };
  const browserToAuto = (files: File[], sidecars: (EditsSidecar | null)[] = []) => {
    const note = auto.state.message;
    const added = auto.add(files, sidecars);
    const skipped = files.length - added;
    // Auto's own note (such as JPEGs being lower quality than raws) wins over the count.
    if (auto.state.message === note) {
      auto.showMessage(added === 0
        ? 'Already in Auto'
        : `Added ${added} photo${added === 1 ? '' : 's'} to Auto${skipped ? ` (${skipped} already there)` : ''}`);
    }
    setTab('auto');
  };

  // Auto's detail view hands a photo to the RawBoy tab with its current look as the starting edits.
  const editInRawBoy = (id: string) => {
    if (pro.busy) return auto.showMessage('RawBoy is busy; try again when it has finished');
    const handoff = auto.editInRawBoy(id);
    if (!handoff) return;
    proFromAuto = { id, file: handoff.file };
    void pro.open(handoff.file, handoff.params);
    setTab('pro');
  };

  // And back: the RawBoy tab's edits develop the photo in Auto (the one it came from, else it joins the batch).
  const fromAuto = proFromAuto != null && pro.file === proFromAuto.file;
  const sendToAuto = () => {
    const file = pro.file;
    if (!file || pro.busy) return;
    if (!auto.receiveEdits(file, proState.params, fromAuto ? proFromAuto!.id : null)) {
      return pro.showMessage('Auto is exporting; try again when it has finished');
    }
    setTab('auto');
  };

  return (
    <AppNavContext.Provider value={nav}>
      <div className="app">
        <main>
          <section className={tab === 'pro' ? 'page' : 'page hidden'}>
            <ProApp store={pro} backToAuto={fromAuto} onSendToAuto={sendToAuto} />
          </section>
          <section className={tab === 'auto' ? 'page' : 'page hidden'}>
            <AutoApp store={auto} onEditInRawBoy={editInRawBoy} />
          </section>
          <section className={tab === 'browser' ? 'page' : 'page hidden'}>
            <BrowserApp store={browser} active={tab === 'browser' && !showHelp && !showLicenses} onEditInRawBoy={browserEdit} onSendToAuto={browserToAuto} />
          </section>
        </main>
        {message && <Toast message={message} onDismiss={() => stores[tab].consumeMessage()} />}
        {showLicenses && <LicensesDialog onDismiss={() => setShowLicenses(false)} />}
        {showHelp && (
          <HelpDialog
            title={{ pro: 'RawBoy', auto: 'RawBoy Auto', browser: 'RawBoy Browser' }[tab]}
            sections={{ pro: PRO_HELP, auto: AUTO_HELP, browser: BROWSER_HELP }[tab]}
            onDismiss={closeHelp}
            about={
              <>
                <span>Decoder: {engine}</span>
                <button
                  type="button"
                  className="text"
                  onClick={() => {
                    setShowHelp(false);
                    setShowLicenses(true);
                  }}
                >
                  Licences
                </button>
              </>
            }
          />
        )}
        {dragging && (
          <div className="drop-hint">
            {{ pro: 'Drop a RAW file to open it', auto: 'Drop RAW files to add them', browser: 'Drop a folder or photos to browse them' }[tab]}
          </div>
        )}
      </div>
    </AppNavContext.Provider>
  );
}

/**
 * The message toast: at the window's foot, or, with a photo on screen, at the top of the photo. On phones the controls
 * sit under the photo, where a toast at the foot covered the sliders (Auto's "… applied to all photos" over Warmth).
 */
function Toast({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  // After every render: App renders on each store change, so opening or closing a photo moves a toast already shown.
  useLayoutEffect(() => {
    const place = () => {
      const el = ref.current;
      if (!el) return;
      const r = document.querySelector('.page:not(.hidden) .preview')?.getBoundingClientRect();
      if (r && r.width > 0 && r.height > 0) {
        Object.assign(el.style, { left: `${r.left + r.width / 2}px`, top: `${r.top + 12}px`, bottom: 'auto', maxWidth: `${r.width - 24}px` });
      } else {
        el.removeAttribute('style');
      }
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  });
  return (
    <div className="toast" role="status" ref={ref} onClick={onDismiss}>
      {message}
    </div>
  );
}
