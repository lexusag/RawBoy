import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import type { PhotoSort } from '../engine/auto/PhotoOrder';
import { RAW_ACCEPT, canPickFolder, canPickOutputFolder, isRawFileName, pickFiles, pickFolderFiles, pickOutputFolder, readDroppedFiles } from '../ui/common/files';
import { groupByFolder, PackerStore, type PackItem } from './PackerStore';
import type { PackFormat, PackInfo } from './protocol';
import { ItemThumbnail, releaseThumbnail } from './ItemThumbnail';
import { PreviewModal } from './PreviewModal';
import {
  FORMAT_LABEL,
  MAX_FILES_AT_ONCE,
  MAX_SIZES,
  PREVIEW_LABEL,
  PRESETS,
  PRESET_HINT,
  PRESET_LABEL,
  QUALITY_LABEL,
  SPEED_LABEL,
  appSupport,
  autoFilesAtOnce,
  loadSettings,
  presetOf,
  runMessage,
  saveSettings,
  summarize,
  usesQuality,
  usesSpeed,
  type PackRun,
  type PackSettings,
  type Preset,
  type PreviewSize,
  type Quality,
  type Speed,
  settingsSuffix,
} from './settings';

const store = new PackerStore();

const canNotify = () => typeof Notification !== 'undefined';

/** The system notification's state, for the "When done" hint. */
const notifyPermission = (): NotificationPermission | 'unsupported' => (canNotify() ? Notification.permission : 'unsupported');

/** A system notification for a run that finished while the tab was in the background; false when it can't be shown. */
function systemNotify(title: string, body: string): boolean {
  if (!canNotify() || Notification.permission !== 'granted') return false;
  try {
    const n = new Notification(title, { body, icon: new URL('favicon.svg', document.baseURI).href, tag: 'rawboy-packer' });
    n.onclick = () => {
      window.focus();
      n.close();
    };
    return true;
  } catch {
    return false; // Android Chrome only shows notifications from a service worker
  }
}

const FORMAT_HINT: Record<PackFormat, string> = {
  small: 'Raw data, lossy JPEG XL. The best size for keeping raws.',
  micro: 'A resized copy with the colours already worked out (demosaiced). For sharing and casual archives.',
  losslessJpeg: 'Raw data, bit-exact. Opens in every raw developer.',
  losslessJxl: 'Raw data, bit-exact, smaller. Slow; not for Apple Photos.',
};
const QUALITY_HINT: Record<Quality, string> = {
  archive: 'JPEG XL distance 0.1: for photos you may push hard later.',
  high: 'Distance 0.2: indistinguishable from the raw on correctly exposed photos.',
  good: 'Distance 0.5: fine for normal edits.',
  compact: 'Distance 1.0: smallest; loss shows at 100% and with strong edits.',
};
const SPEED_HINT: Record<Speed, string> = {
  fast: 'How hard the packer works to shrink each file; the picture quality is the same. Quick: finishes sooner, files a few percent larger.',
  normal: 'How hard the packer works to shrink each file; the picture quality is the same. Balanced is a good middle.',
  best: 'Thorough: takes longer on your computer, files a few percent smaller. The picture quality is the same.',
};

export function PackerApp() {
  const state = useSyncExternalStore(store.subscribe, store.getState);
  const [settings, setSettings] = useState<PackSettings>(loadSettings);
  const [dragging, setDragging] = useState(false);
  const [finished, setFinished] = useState<{ title: string; body: string } | null>(null);
  const [permission, setPermission] = useState(notifyPermission);
  const [scrolled, setScrolled] = useState(false);
  const [skippedNote, setSkippedNote] = useState<string | null>(null);
  const noteTimerRef = useRef<number | null>(null);

  const showSkipped = (count: number) => {
    if (count <= 0) return;
    const text = count === 1 ? '1 non-raw file skipped' : `${count} non-raw files skipped`;
    setSkippedNote(text);
    if (noteTimerRef.current) window.clearTimeout(noteTimerRef.current);
    noteTimerRef.current = window.setTimeout(() => setSkippedNote(null), 5000);
  };

  useEffect(() => () => {
    if (noteTimerRef.current) window.clearTimeout(noteTimerRef.current);
  }, []);

  useEffect(() => saveSettings(settings), [settings]);
  // The choice when a run ends counts, not when it started.
  const notifyRef = useRef(settings.notifyWhenDone);
  notifyRef.current = settings.notifyWhenDone;

  useEffect(() => {
    const onScroll = () => setScrolled((window.scrollY || document.documentElement.scrollTop) > 200);
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const scrollToTop = () => {
    const reduceMotion =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    try {
      window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' });
    } catch {
      window.scrollTo(0, 0);
    }
  };

  const setNotify = async (notifyWhenDone: boolean) => {
    change({ notifyWhenDone });
    // Ask once, from the click: browsers only show the prompt after a user gesture.
    if (notifyWhenDone && canNotify() && Notification.permission === 'default') {
      try {
        setPermission(await Notification.requestPermission());
      } catch {
        setPermission(notifyPermission());
      }
    }
  };

  const [previewId, setPreviewId] = useState<number | null>(null);

  // Follow folder group presentation order so prev/next navigation matches visual queue order
  const orderedItems = useMemo(() => groupByFolder(state.items, state.sort).flatMap((g) => g.items), [state.items, state.sort]);
  const previewItem = previewId !== null ? state.items.find((it) => it.id === previewId) ?? null : null;
  const previewIndex = previewItem ? orderedItems.findIndex((it) => it.id === previewItem.id) : -1;

  const removeItem = (id: number) => {
    const it = state.items.find((item) => item.id === id);
    if (it) releaseThumbnail(it.id, it.file);
    if (previewId === id) setPreviewId(null);
    store.remove(id);
  };

  const removeFolder = (folder: string | null | undefined) => {
    const target = folder ?? undefined;
    for (const it of state.items) {
      if ((it.folder ?? undefined) === target && it.status !== 'packing') {
        releaseThumbnail(it.id, it.file);
        if (previewId === it.id) setPreviewId(null);
      }
    }
    store.removeFolder(folder);
  };

  const clearDone = () => {
    for (const it of state.items) {
      if (it.status === 'done' || it.status === 'error') {
        releaseThumbnail(it.id, it.file);
        if (previewId === it.id) setPreviewId(null);
      }
    }
    store.clearDone();
  };

  useEffect(() => {
    if (!finished) return;
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setFinished(null);
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [finished]);

  const onFinished = (run: PackRun | null) => {
    if (!run || !notifyRef.current) return;
    const message = runMessage(run);
    setFinished(message);
    if (document.hidden) systemNotify(message.title, message.body);
  };

  const change = (patch: Partial<PackSettings>) => setSettings((s) => ({ ...s, ...patch }));
  const preset = presetOf(settings);
  const infos = useMemo(() => state.items.map((it) => it.info).filter((i): i is PackInfo => !!i), [state.items]);
  const summary = useMemo(() => summarize(settings, infos), [settings, infos]);
  const packable = state.items.filter((it) => it.status === 'inspecting' || it.info);

  useEffect(() => {
    // Drop files anywhere on the page.
    const over = (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes('Files')) return;
      e.preventDefault();
      setDragging(true);
    };
    const leave = (e: DragEvent) => {
      if (!e.relatedTarget) setDragging(false);
    };
    const drop = async (e: DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const { files, skipped } = await readDroppedFiles(e.dataTransfer);
      if (files.length) store.add(files);
      if (skipped > 0) showSkipped(skipped);
    };
    window.addEventListener('dragover', over);
    window.addEventListener('dragleave', leave);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragover', over);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('drop', drop);
    };
  }, []);

  const addFiles = async () => {
    const picked = await pickFiles(true, RAW_ACCEPT);
    const valid = picked.filter((f) => !f.name.startsWith('.') && isRawFileName(f.name));
    const skipped = picked.length - valid.length;
    if (valid.length) store.add(valid);
    if (skipped > 0) showSkipped(skipped);
  };

  const addFolder = async () => {
    const { files, skipped } = await pickFolderFiles();
    if (files.length) store.add(files);
    if (skipped > 0) showSkipped(skipped);
  };

  const pack = async (toFolder: boolean) => {
    if (toFolder) {
      let dir: FileSystemDirectoryHandle | null = null;
      try {
        dir = await pickOutputFolder();
      } catch {
        return; // cancelled
      }
      if (!dir) return;
      onFinished(await store.start(settings, { kind: 'folder', dir }));
    } else {
      onFinished(await store.start(settings, { kind: 'downloads' }));
    }
  };

  return (
    <div className={`packer${dragging ? ' dragging' : ''}${state.running ? ' running' : ''}`}>
      <header className="packer-header">
        <h1>RawBoy Packer</h1>
        <p>Repackage camera raws and DNGs as smaller DNGs, in your browser. Nothing is uploaded.</p>
      </header>

      <main className="packer-main">
        <section className="packer-settings" aria-label="Settings">
          <Row label="Pack as" hint={PRESET_HINT[preset]}>
            <Segmented<Preset>
              value={preset}
              options={(['small', 'lossless', 'micro'] as Preset[]).map((p) => ({ value: p, label: PRESET_LABEL[p] }))}
              onChange={(p) => p !== 'custom' && change(PRESETS[p])}
            />
          </Row>

          {settings.format === 'micro' && (
            <Row label="Longest side" hint={`${((settings.maxSize * settings.maxSize * 2) / 3 / 1e6).toFixed(0)} megapixels for a 3:2 photo. Smaller photos keep their size.`}>
              <Segmented<number>
                value={settings.maxSize}
                options={MAX_SIZES.map((v) => ({ value: v, label: `${v} px` }))}
                onChange={(maxSize) => change({ maxSize })}
              />
            </Row>
          )}

          <Row
            label="Lens corrections"
            hint={settings.lensCorrections ? 'Sony and Fujifilm corrections stored in the raw are written into the DNG.' : 'Dropped: the DNG opens uncorrected unless the app has its own profile.'}
          >
            <Toggle on={settings.lensCorrections} onChange={(lensCorrections) => change({ lensCorrections })} />
          </Row>

          <Row label="Location" hint={settings.keepGps ? 'GPS tags kept.' : 'GPS tags removed.'}>
            <Segmented<boolean>
              value={settings.keepGps}
              options={[
                { value: true, label: 'Keep' },
                { value: false, label: 'Remove' },
              ]}
              onChange={(keepGps) => change({ keepGps })}
            />
          </Row>

          <Row
            label="Add settings to file name"
            hint={settings.nameSuffix ? `Example: DSC001-${settingsSuffix(settings)}.dng` : 'Off: DSC001.ARW becomes DSC001.dng.'}
          >
            <Segmented<boolean>
              value={settings.nameSuffix}
              options={[
                { value: false, label: 'No' },
                { value: true, label: 'Yes' },
              ]}
              onChange={(nameSuffix) => change({ nameSuffix })}
            />
          </Row>

          <Row
            label="When done"
            hint={
              !settings.notifyWhenDone
                ? 'Off: check the file list for progress.'
                : permission === 'granted'
                  ? 'A pop-up here, and a system notification when this tab is in the background.'
                  : permission === 'denied'
                    ? 'A pop-up here. System notifications are blocked for this site in the browser settings.'
                    : 'A pop-up here when every file is packed.'
            }
          >
            <Segmented<boolean>
              value={settings.notifyWhenDone}
              options={[
                { value: false, label: 'Nothing' },
                { value: true, label: 'Pop-up' },
              ]}
              onChange={(v) => void setNotify(v)}
            />
          </Row>

          <button
            className="text packer-advanced-toggle"
            aria-expanded={settings.advanced}
            onClick={() => change({ advanced: !settings.advanced })}
          >
            {settings.advanced ? '▾ Advanced settings' : '▸ Advanced settings'}
            {preset === 'custom' && ' (custom)'}
          </button>

          {settings.advanced && (
            <div className="packer-advanced">
              <p className="hint">Changing one of these never changes the others. The choice above only fills them in once.</p>

              <Row label="File type" hint={FORMAT_HINT[settings.format]}>
                <Segmented<PackFormat>
                  value={settings.format}
                  options={(['small', 'losslessJpeg', 'losslessJxl', 'micro'] as PackFormat[]).map((f) => ({ value: f, label: FORMAT_LABEL[f] }))}
                  onChange={(format) => change({ format })}
                />
              </Row>

              {usesQuality(settings.format) && (
                <Row label="Quality" hint={QUALITY_HINT[settings.quality]}>
                  <Segmented<Quality>
                    value={settings.quality}
                    options={(['archive', 'high', 'good', 'compact'] as Quality[]).map((q) => ({ value: q, label: QUALITY_LABEL[q] }))}
                    onChange={(quality) => change({ quality })}
                  />
                </Row>
              )}

              {usesSpeed(settings.format) && (
                <Row label="Compression effort" hint={SPEED_HINT[settings.speed]}>
                  <Segmented<Speed>
                    value={settings.speed}
                    options={(['fast', 'normal', 'best'] as Speed[]).map((s) => ({ value: s, label: SPEED_LABEL[s] }))}
                    onChange={(speed) => change({ speed })}
                  />
                </Row>
              )}

              <Row label="Preview" hint="Used when the camera's own preview can't be (DNGs, phones). Thumbnails in Finder and photo browsers.">
                <Segmented<PreviewSize>
                  value={settings.preview}
                  options={(['standard', 'large', 'none'] as PreviewSize[]).map((p) => ({ value: p, label: PREVIEW_LABEL[p] }))}
                  onChange={(preview) => change({ preview })}
                />
              </Row>

              <Row
                label="Files at once"
                hint={`Auto picks ${autoFilesAtOnce()} for this computer. More is faster on many cores, but each 50 MP photo needs up to 1 GB of memory.`}
              >
                <Segmented<number>
                  value={settings.filesAtOnce}
                  options={[
                    { value: 0, label: 'Auto' },
                    ...Array.from({ length: MAX_FILES_AT_ONCE }, (_, i) => ({ value: i + 1, label: String(i + 1) })),
                  ]}
                  onChange={(filesAtOnce) => change({ filesAtOnce })}
                />
              </Row>
            </div>
          )}
        </section>

        <section className="packer-summary" aria-label="What this does" aria-live="polite">
          <h2>{FORMAT_LABEL[settings.format]}</h2>
          {summary.map((line, i) => (
            <p key={i}>
              {line.map((span, j) => (span.bold ? <strong key={j}>{span.text}</strong> : <span key={j}>{span.text}</span>))}
            </p>
          ))}
          <h3>After packing, the file opens in</h3>
          <ul className="packer-apps">
            {appSupport(settings.format).map((a) => (
              <li key={a.app} className={`support-${a.support}`} title={a.note}>
                <span className="mark">{a.support === 'yes' ? '✓' : a.support === 'no' ? '✕' : a.support === 'likely' ? '✓?' : '?'}</span>
                <span className="app">{a.app}</span>
                <span className="note">{a.note}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="packer-files" aria-label="Files">
          <p className="packer-safe">Your original files are never changed: packed copies are new files.</p>
          <div className="packer-actions">
            <button onClick={addFiles} disabled={state.running}>
              Add files
            </button>
            {canPickFolder() && (
              <button onClick={addFolder} disabled={state.running}>
                Add folder
              </button>
            )}
            <span className="spacer" />
            {state.items.length > 0 && (
              <button
                type="button"
                className="text"
                disabled={state.running}
                title={state.sort === 'date' ? 'Photos in the order they were shot. Click to sort by file name.' : 'Photos by file name. Click to sort by shoot date.'}
                onClick={() => store.setSort(state.sort === 'date' ? 'name' : 'date')}
              >
                Sort: {state.sort === 'date' ? 'Shoot date' : 'File name'}
              </button>
            )}
            <button
              className="text"
              onClick={clearDone}
              disabled={state.running || !state.items.some((it) => it.status === 'done' || it.status === 'error')}
              title={state.running ? 'Available when packing has stopped' : 'Remove packed and failed files from the list'}
            >
              Clear finished
            </button>
            {state.running ? (
              <button onClick={() => store.cancel()} disabled={state.stopping}>
                {state.stopping ? 'Stopping…' : 'Stop after these'}
              </button>
            ) : canPickOutputFolder() ? (
              <>
                <button onClick={() => pack(false)} disabled={!packable.length} title="Each DNG goes to the browser's downloads">
                  Download
                </button>
                <button className="primary" onClick={() => pack(true)} disabled={!packable.length}>
                  Pack {packable.length || ''} to a folder…
                </button>
              </>
            ) : (
              <button className="primary" onClick={() => pack(false)} disabled={!packable.length}>
                Pack {packable.length || ''} and download
              </button>
            )}
          </div>
          {state.engineError && <p className="packer-error">The packer couldn't start: {state.engineError}</p>}
          {skippedNote && <p className="packer-note" role="status">{skippedNote}</p>}
          {state.items.length === 0 ? (
            <div className="packer-drop">
              Drop raw files or folders here, or <button className="text" onClick={addFiles}>choose files</button>
              {canPickFolder() && (
                <> or <button className="text" onClick={addFolder}>a folder</button></>
              )}.
              <small>ARW, RAF, CR2, CR3, NEF, ORF, RW2, PEF, DNG and other raws LibRaw reads.</small>
            </div>
          ) : (
            <>
              <QueueView
                items={state.items}
                sort={state.sort}
                running={state.running}
                onRemove={removeItem}
                onRemoveFolder={removeFolder}
                onPreview={(item) => setPreviewId(item.id)}
              />
              <Totals items={state.items} />
            </>
          )}
        </section>
      </main>

      {state.running && <PackProgress items={state.items} runIds={state.runIds} stopping={state.stopping} />}

      <button
        type="button"
        className={`packer-jump-top${scrolled ? ' visible' : ''}`}
        onClick={scrollToTop}
        aria-label="Jump to top"
      >
        ↑ Jump to top
      </button>

      {previewItem && (
        <PreviewModal
          item={previewItem}
          onClose={() => setPreviewId(null)}
          hasPrev={previewIndex > 0}
          hasNext={previewIndex >= 0 && previewIndex < orderedItems.length - 1}
          onPrev={() => previewIndex > 0 && setPreviewId(orderedItems[previewIndex - 1].id)}
          onNext={() => previewIndex >= 0 && previewIndex < orderedItems.length - 1 && setPreviewId(orderedItems[previewIndex + 1].id)}
        />
      )}

      {finished && (
        <div className="dialog-backdrop" onClick={() => setFinished(null)}>
          <div className="dialog packer-done" role="alertdialog" aria-labelledby="packer-done-title" aria-describedby="packer-done-body" onClick={(e) => e.stopPropagation()}>
            <h2 id="packer-done-title">{finished.title}</h2>
            <p id="packer-done-body">{finished.body}</p>
            <div className="dialog-actions">
              <button className="primary" autoFocus onClick={() => setFinished(null)}>
                OK
              </button>
            </div>
          </div>
        </div>
      )}

      <footer className="packer-footer">
        RawBoy Packer uses LibRaw and the Adobe DNG SDK. This product includes DNG technology under license by Adobe.{' '}
        <a href="https://app.rawboy.link/" target="_blank" rel="noopener">
          RawBoy Web
        </a>
      </footer>
    </div>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  const id = useId();
  return (
    <div className="packer-row">
      <div className="label" id={id}>
        {label}
      </div>
      <div className="control" role="group" aria-labelledby={id}>
        {children}
        {hint && <div className="hint">{hint}</div>}
      </div>
    </div>
  );
}

function Segmented<T extends string | number | boolean>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string; disabled?: boolean }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="segmented" role="radiogroup">
      {options.map((o) => (
        <button
          key={String(o.value)}
          role="radio"
          aria-checked={o.value === value}
          className={o.value === value ? 'on' : ''}
          disabled={o.disabled && o.value !== value}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <Segmented<boolean>
      value={on}
      options={[
        { value: true, label: 'Keep' },
        { value: false, label: 'Drop' },
      ]}
      onChange={onChange}
    />
  );
}

/**
 * The source's raw data in one short line: bit depth, compression, colour filter and size, e.g.
 * "14-bit · lossless compressed · X-Trans · 40.2 MP". The full pixel size is in the tooltip.
 */
function rawDetails(i: PackInfo): { parts: string[]; title: string } {
  const parts: string[] = [];
  if (i.bits > 0) parts.push(`${i.bits}-bit`);
  if (i.compression) parts.push(i.compression);
  parts.push(!i.mosaic ? 'linear' : i.bayer ? 'Bayer' : 'X-Trans');
  if (i.width > 0 && i.height > 0) parts.push(`${((i.width * i.height) / 1e6).toFixed(1)} MP`);
  const title = i.width > 0 && i.height > 0 ? `${i.width} × ${i.height} px` : '';
  return { parts, title };
}

const mb = (bytes: number) => `${(bytes / 1e6).toFixed(bytes < 10e6 ? 1 : 0)} MB`;

function QueueView({
  items,
  sort,
  running,
  onRemove,
  onRemoveFolder,
  onPreview,
}: {
  items: PackItem[];
  sort: PhotoSort;
  running: boolean;
  onRemove: (id: number) => void;
  onRemoveFolder: (folder: string | null | undefined) => void;
  onPreview: (item: PackItem) => void;
}) {
  const groups = useMemo(() => groupByFolder(items, sort), [items, sort]);
  const hasFolders = groups.some((g) => g.folder != null);

  return (
    <div className="packer-queue">
      {groups.map((group) => {
        const key = group.folder === null ? ':loose:' : `dir:${group.folder}`;
        const folderName = group.folder ?? 'Other files';
        return (
          <div key={key} className="packer-folder-group">
            {hasFolders && (
              <div className="packer-folder-header">
                <span className="packer-folder-title">
                  {group.folder ? <FolderIcon /> : <FilesIcon />}
                  <span className="packer-folder-name" title={folderName}>
                    {folderName}
                  </span>
                  <span className="packer-folder-count">({group.items.length})</span>
                </span>
                <button
                  type="button"
                  className="packer-folder-remove text"
                  onClick={() => onRemoveFolder(group.folder)}
                  disabled={running && group.items.every((it) => it.status === 'packing')}
                  title={`Remove ${folderName}`}
                  aria-label={`Remove folder ${folderName}`}
                >
                  ✕
                </button>
              </div>
            )}
            <ul className="packer-list">
              {group.items.map((it) => (
                <FileRow key={it.id} item={it} onRemove={() => onRemove(it.id)} onPreview={() => onPreview(it)} busy={running} />
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

function FolderIcon() {
  return (
    <svg className="packer-folder-icon" width={16} height={16} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z" />
    </svg>
  );
}

function FilesIcon() {
  return (
    <svg className="packer-folder-icon" width={16} height={16} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M4 6H2v14c0 1.1.9 2 2 2h14v-2H4V6zm16-4H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H8V4h12v12z" />
    </svg>
  );
}

function FileRow({ item, onRemove, onPreview, busy }: { item: PackItem; onRemove: () => void; onPreview: () => void; busy: boolean }) {
  const i = item.info;
  const camera = i ? `${i.make} ${i.model}`.trim() : '';
  const tags: string[] = [];
  if (i) {
    tags.push(i.dng && i.dngVersion ? `DNG ${i.dngVersion}` : i.format);
    if (i.lensData) tags.push(i.lensData === 'DNG' ? 'lens opcodes' : `${i.lensData} lens data`);
  }
  const raw = i ? rawDetails(i) : null;
  let status: ReactNode;
  switch (item.status) {
    case 'inspecting':
      status = 'Reading…';
      break;
    case 'ready':
      status = mb(item.file.size);
      break;
    case 'waiting':
      status = 'Waiting';
      break;
    case 'packing':
      status = <span className="busy">Packing…</span>;
      break;
    case 'done':
      status = (
        <span title={`${item.outName} · ${item.result?.seconds.toFixed(1)} s`}>
          {mb(item.file.size)} → <strong>{mb(item.outSize ?? 0)}</strong> ({Math.round(((item.outSize ?? 0) / item.file.size) * 100)}%)
        </span>
      );
      break;
    case 'error':
      status = <span className="packer-error">{item.error}</span>;
      break;
  }
  const r = item.result;
  const notes: string[] = [];
  if (r) {
    if (r.modeUsed === 'small' && r.linear) notes.push('saved demosaiced (not a Bayer raw)');
    if (r.lensWritten) notes.push('lens corrections kept');
    if (r.preview === 'none') notes.push('no preview');
  }
  return (
    <li className={`packer-item status-${item.status}`}>
      <ItemThumbnail item={item} onClick={onPreview} />
      <div className="name">
        <span className="file">{item.file.name}</span>
        <span className="meta">
          {camera}
          {i?.lens ? ` · ${i.lens}` : ''}
          {tags.map((t) => (
            <span key={t} className="tag">
              {t}
            </span>
          ))}
        </span>
        {raw && (
          <span className="meta raw" title={raw.title}>
            {/* Each part stays on one line with the dot after it, so a narrow row breaks only between parts. */}
            {raw.parts.map((p, n) => (
              <span key={p}>
                {n > 0 && ' '}
                <span className="nowrap">{n < raw.parts.length - 1 ? `${p} ·` : p}</span>
              </span>
            ))}
          </span>
        )}
        {notes.length > 0 && <span className="meta">{notes.join(' · ')}</span>}
      </div>
      <div className="status">{status}</div>
      <button className="remove" onClick={onRemove} disabled={busy && item.status === 'packing'} aria-label={`Remove ${item.file.name}`}>
        ✕
      </button>
    </li>
  );
}

/** Pinned to the bottom of the screen while a run packs, so it stays in view however long the file list is. */
function PackProgress({ items, runIds, stopping }: { items: PackItem[]; runIds: number[]; stopping: boolean }) {
  const startRef = useRef(performance.now());
  // The Jump to top button sits above this bar, whatever height it has (wrapped text, safe area).
  const barRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = barRef.current;
    if (!el) return;
    const root = document.documentElement;
    const publish = () => root.style.setProperty('--packer-progress-h', `${el.offsetHeight}px`);
    publish();
    if (typeof ResizeObserver === 'undefined') return () => root.style.removeProperty('--packer-progress-h');
    const ro = new ResizeObserver(publish);
    ro.observe(el);
    return () => {
      ro.disconnect();
      root.style.removeProperty('--packer-progress-h');
    };
  }, []);
  const ids = new Set(runIds);
  const run = items.filter((it) => ids.has(it.id)); // files removed during the run drop out
  const finished = run.filter((it) => it.status === 'done' || it.status === 'error');
  const failed = finished.filter((it) => it.status === 'error').length;
  const packing = run.filter((it) => it.status === 'packing').length;
  const total = run.reduce((s, it) => s + it.file.size, 0);
  const doneBytes = finished.reduce((s, it) => s + it.file.size, 0);
  // By size: a 60 MB file takes longer than a 20 MB one. Files being packed count half, so the bar moves from the start.
  const packingBytes = run.filter((it) => it.status === 'packing').reduce((s, it) => s + it.file.size, 0);
  const fraction = total ? Math.min(1, (doneBytes + packingBytes / 2) / total) : 0;
  const elapsed = (performance.now() - startRef.current) / 1000;
  const left = doneBytes > 0 && finished.length < run.length ? (elapsed * (total - doneBytes)) / doneBytes : null;
  const parts = [`${finished.length - failed} of ${run.length} packed`];
  if (failed) parts.push(`${failed} failed`);
  if (stopping) parts.push(packing ? `stopping after ${packing === 1 ? 'this file' : `these ${packing}`}` : 'stopping');
  else if (left !== null) parts.push(`about ${duration(left)} left`);
  return (
    <div className="packer-progress" role="region" aria-label="Packing progress" ref={barRef}>
      <div className="packer-progress-inner">
        <div className="packer-progress-text" aria-live="polite">
          {parts.join(' · ')}
        </div>
        <button onClick={() => store.cancel()} disabled={stopping}>
          {stopping ? 'Stopping…' : 'Stop'}
        </button>
        <div
          className="packer-progress-bar"
          role="progressbar"
          aria-label="Packed"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(fraction * 100)}
        >
          <div style={{ width: `${fraction * 100}%` }} />
        </div>
      </div>
    </div>
  );
}

const duration = (s: number) => (s < 60 ? `${Math.max(5, Math.round(s / 5) * 5)} s` : s < 3600 ? `${Math.round(s / 60)} min` : `${(s / 3600).toFixed(1)} h`);

function Totals({ items }: { items: PackItem[] }) {
  const done = items.filter((it) => it.status === 'done');
  if (!done.length) {
    const total = items.reduce((s, it) => s + it.file.size, 0);
    return <p className="packer-totals">{items.length} files, {mb(total)}</p>;
  }
  const before = done.reduce((s, it) => s + it.file.size, 0);
  const after = done.reduce((s, it) => s + (it.outSize ?? 0), 0);
  return (
    <p className="packer-totals">
      {done.length} of {items.length} packed: {mb(before)} → <strong>{mb(after)}</strong> ({Math.round((after / before) * 100)}%), {mb(before - after)} saved
    </p>
  );
}
