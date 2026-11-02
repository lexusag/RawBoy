import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { RAW_ACCEPT, canPickOutputFolder, pickFiles, pickOutputFolder } from '../ui/common/files';
import { PackerStore, type PackItem } from './PackerStore';
import type { PackFormat, PackInfo } from './protocol';
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
  useEffect(() => saveSettings(settings), [settings]);
  // The choice when a run ends counts, not when it started.
  const notifyRef = useRef(settings.notifyWhenDone);
  notifyRef.current = settings.notifyWhenDone;

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
    const drop = (e: DragEvent) => {
      e.preventDefault();
      setDragging(false);
      store.add(Array.from(e.dataTransfer?.files ?? []));
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
            <button onClick={async () => store.add(await pickFiles(true, RAW_ACCEPT))} disabled={state.running}>
              Add files
            </button>
            <span className="spacer" />
            {state.items.some((it) => it.status === 'done' || it.status === 'error') && !state.running && (
              <button className="text" onClick={() => store.clearDone()}>
                Clear finished
              </button>
            )}
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
          {state.items.length === 0 ? (
            <div className="packer-drop">
              Drop raw files or DNGs here, or <button className="text" onClick={async () => store.add(await pickFiles(true, RAW_ACCEPT))}>choose files</button>.
              <small>ARW, RAF, CR2, CR3, NEF, ORF, RW2, PEF, DNG and other raws LibRaw reads.</small>
            </div>
          ) : (
            <>
              <ul className="packer-list">
                {state.items.map((it) => (
                  <FileRow key={it.id} item={it} onRemove={() => store.remove(it.id)} busy={state.running} />
                ))}
              </ul>
              <Totals items={state.items} />
            </>
          )}
        </section>
      </main>

      {state.running && <PackProgress items={state.items} runIds={state.runIds} stopping={state.stopping} />}

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

function FileRow({ item, onRemove, busy }: { item: PackItem; onRemove: () => void; busy: boolean }) {
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
    <div className="packer-progress" role="region" aria-label="Packing progress">
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
