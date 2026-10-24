import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { PhotoSort } from '../../engine/auto/PhotoOrder';
import { PHOTO_ACCEPT, pickFiles, saveBlob } from '../common/files';
import { isApple } from '../common/HelpDialog';
import { AppSwitcher, HelpButton } from '../common/AppNav';
import { BIN, isArc, photosToSend, type BrowsePhoto, type BrowserStore, type Filter, type SendCriteria } from './BrowserStore';
import type { ViewImage } from './Previews';
import type { EditsSidecar, Flag, Rating } from '../../engine/browse/XmpSidecar';
import { shortcutKey } from '../common/shortcutKey';

type DirectoryPicker = (o?: object) => Promise<FileSystemDirectoryHandle>;
const directoryPicker = () => (window as unknown as { showDirectoryPicker?: DirectoryPicker }).showDirectoryPicker;

/** Opens a folder read-write where the browser can (Chrome, Edge), else picks files. */
export async function openPhotos(store: BrowserStore) {
  const picker = directoryPicker();
  if (!picker) return store.addFiles(await pickFiles(true, `${PHOTO_ACCEPT},.xmp`));
  try {
    await store.openFolder(await picker({ id: 'rawboy-browse', mode: 'readwrite' }));
  } catch (e) {
    if ((e as Error)?.name !== 'AbortError') store.showMessage(`Couldn't open the folder: ${(e as Error)?.message ?? e}`);
  }
}

/**
 * Reopens the last folder (Reopen button): its access is checked and asked for again first. When access is refused or
 * the folder is gone, the folder picker opens instead (in the old folder when there is one).
 */
export async function reopenFolder(store: BrowserStore) {
  const name = store.state.lastFolder;
  const { result, dir } = await store.reopenLastFolder();
  if (result === 'opened') return;
  if (result === 'unanswered') return store.showMessage(`This browser didn’t show its access prompt for ${name}. Reload the page and choose the folder with Open a folder.`);
  const why = result === 'denied' ? `RawBoy has no access to ${name} any more.` : `${name} isn’t there any more (moved, renamed or deleted).`;
  const picker = directoryPicker();
  try {
    if (!picker) throw new Error();
    await store.openFolder(await picker({ id: 'rawboy-browse', mode: 'readwrite', ...(dir ? { startIn: dir } : {}) }));
  } catch (e) {
    // The permission prompt may have used up the click, so the picker can refuse to open: say what to do instead.
    if ((e as Error)?.name !== 'AbortError') store.showMessage(`${why} Choose it with Open a folder.`);
  }
}

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'picks', label: 'Picks' },
  { key: 'unflagged', label: 'Unflagged' },
  { key: 'rejects', label: 'Rejects' },
];

const isTextEntry = (t: EventTarget | null) => t instanceof HTMLInputElement || t instanceof HTMLSelectElement || t instanceof HTMLTextAreaElement;

/**
 * RawBoy Browser: a folder's photos in a grid and one at a time, for culling: stars, pick and reject, written to XMP
 * sidecars; rejects move to a bin folder. [active]: the tab is shown (keyboard shortcuts only work then).
 */
export function BrowserApp({ store, active, onEditInRawBoy, onSendToAuto }: {
  store: BrowserStore;
  active: boolean;
  /** [sidecar]: where RawBoy keeps the photo's edits (Edits in sidecars on), else null. */
  onEditInRawBoy: (file: File, sidecar: EditsSidecar | null) => void;
  /** [sidecars]: where Auto keeps each photo's settings (Edits in sidecars on), else nulls. */
  onSendToAuto: (files: File[], sidecars: (EditsSidecar | null)[]) => void;
}) {
  const state = useSyncExternalStore(store.subscribe, () => store.state);
  const [confirmBin, setConfirmBin] = useState<'move' | 'restore' | null>(null);
  // Long-press (or Ctrl/Cmd-click) a photo to start selecting, as in Auto; the selection is rated, or goes to Auto, in one go.
  const [selection, setSelection] = useState<ReadonlySet<string>>(new Set());
  const [sending, setSending] = useState(false);
  // What Send to Auto offers first: the last choice, else the picks when there are any.
  const [criteria, setCriteria] = useState<SendCriteria | null>(null);
  const gridScroll = useRef(0);
  const current = state.photos.find((p) => p.id === state.current) ?? null;

  const edit = async (id: string) => onEditInRawBoy(await store.file(id), store.editsSidecar(id));
  const send = async (photos: BrowsePhoto[]) => {
    try {
      onSendToAuto(await Promise.all(photos.map((p) => store.file(p.id))), photos.map((p) => store.editsSidecar(p.id)));
    } catch (e) {
      store.showMessage(`Couldn't read the photos: ${(e as Error)?.message ?? e}`);
    }
  };
  const sendSelection = () => {
    void send(state.photos.filter((p) => selection.has(p.id)));
    setSelection(new Set());
  };

  // A selection only holds photos the grid shows: a filter change or a move to the bin drops the others.
  const shownIds = store.shown().map((p) => p.id).join('\n');
  useEffect(() => {
    const ids = new Set(shownIds.split('\n'));
    if ([...selection].some((id) => !ids.has(id))) setSelection(new Set([...selection].filter((id) => ids.has(id))));
  }, [shownIds, selection]);

  // Shortcuts shared by the grid and the viewer; each view adds its own movement keys.
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (isTextEntry(e.target) || document.querySelector('.dialog')) return;
      const mod = isApple ? e.metaKey : e.ctrlKey;
      if (mod && shortcutKey(e) === 'z' && !e.shiftKey) {
        e.preventDefault();
        void store.undo();
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const id = store.state.current;
      // In the grid, rating keys act on the selection while there is one.
      const many = !store.state.viewing && selection.size > 0;
      const rated = many ? [...selection] : id;
      if (!rated) return;
      const key = shortcutKey(e);
      if (/^[0-5]$/.test(key)) store.setStars(rated, Number(key));
      else if (key === 'p') store.toggleFlag(rated, 'pick');
      else if (key === 'x') store.toggleFlag(rated, 'reject');
      else if (key === 'u') store.clearFlag(rated);
      else if (key === 'e' && id) return void edit(id);
      else return;
      e.preventDefault();
      if (!many) store.advance();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <>
      {state.viewing && current
        ? <Viewer store={store} photo={current} active={active} onEdit={() => edit(current.id)} />
        : (
          <GridView
            store={store}
            active={active}
            scroll={gridScroll}
            selection={selection}
            onSelection={setSelection}
            onBin={setConfirmBin}
            onSendToAuto={() => setSending(true)}
            onSendSelection={sendSelection}
          />
        )}
      {sending && (
        <SendToAutoDialog
          store={store}
          initial={criteria ?? (state.photos.some((p) => p.rating.flag === 'pick') ? { kind: 'picks' } : { kind: 'stars', stars: 5, exact: false })}
          onDismiss={() => setSending(false)}
          onSend={(c, photos) => {
            setCriteria(c);
            setSending(false);
            void send(photos);
          }}
        />
      )}
      {confirmBin && (
        <div className="dialog-backdrop" onClick={() => setConfirmBin(null)}>
          <div className="dialog" role="dialog" onClick={(e) => e.stopPropagation()}>
            {confirmBin === 'move' ? (
              <>
                <h2>Move rejects to the bin?</h2>
                <div className="note">
                  {(() => {
                    const n = state.photos.filter((p) => p.rating.flag === 'reject').length;
                    return `${n} photo${n === 1 ? '' : 's'}, with ${n === 1 ? 'its' : 'their'} sidecars and same-name JPEGs, go into the ${BIN} folder inside ${state.folder?.name}. Nothing is deleted: Undo or Restore brings them back, and you can empty ${BIN} yourself.`;
                  })()}
                </div>
              </>
            ) : (
              <>
                <h2>Restore the bin?</h2>
                <div className="note">{`Moves the ${state.binCount} photo${state.binCount === 1 ? '' : 's'} in ${BIN} back into ${state.folder?.name}.`}</div>
              </>
            )}
            <div className="dialog-actions">
              <button type="button" className="text" onClick={() => setConfirmBin(null)}>Cancel</button>
              <button
                type="button"
                className="primary"
                onClick={() => {
                  void (confirmBin === 'move' ? store.moveRejectsToBin() : store.restoreBin());
                  setConfirmBin(null);
                }}
              >
                {confirmBin === 'move' ? 'Move' : 'Restore'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function GridView({ store, active, scroll, selection, onSelection, onBin, onSendToAuto, onSendSelection }: {
  store: BrowserStore;
  active: boolean;
  scroll: React.MutableRefObject<number>;
  selection: ReadonlySet<string>;
  onSelection: (s: ReadonlySet<string>) => void;
  onBin: (what: 'move' | 'restore') => void;
  onSendToAuto: () => void;
  onSendSelection: () => void;
}) {
  const state = useSyncExternalStore(store.subscribe, () => store.state);
  const gridRef = useRef<HTMLDivElement>(null);
  const shown = store.shown();
  const selecting = selection.size > 0;
  const anchor = useRef<string | null>(null);
  const toggle = (id: string) => {
    const s = new Set(selection);
    if (s.has(id)) s.delete(id);
    else s.add(id);
    anchor.current = id;
    onSelection(s);
  };
  // Shift-click adds the range from the photo last toggled.
  const selectRange = (id: string) => {
    const from = shown.findIndex((p) => p.id === anchor.current);
    const to = shown.findIndex((p) => p.id === id);
    if (from < 0 || to < 0 || !selecting) return toggle(id);
    const s = new Set(selection);
    for (let i = Math.min(from, to); i <= Math.max(from, to); i++) s.add(shown[i].id);
    anchor.current = id;
    onSelection(s);
    window.getSelection()?.removeAllRanges(); // Shift-click also extends the page's text selection
  };
  const counts = {
    all: state.photos.length,
    picks: state.photos.filter((p) => p.rating.flag === 'pick').length,
    unflagged: state.photos.filter((p) => p.rating.flag == null).length,
    rejects: state.photos.filter((p) => p.rating.flag === 'reject').length,
  };
  const writable = state.folder?.writable ?? false;

  useLayoutEffect(() => {
    if (gridRef.current) gridRef.current.scrollTop = scroll.current;
  }, [scroll]);

  // Keeps the current photo in view (by hand: scrollIntoView would also move hidden-overflow ancestors).
  useEffect(() => {
    const el = gridRef.current;
    const cell = state.current ? el?.querySelector<HTMLElement>(`[data-id="${CSS.escape(state.current)}"]`) : null;
    if (!el || !cell) return;
    const g = el.getBoundingClientRect();
    const c = cell.getBoundingClientRect();
    if (c.top < g.top) el.scrollTop += c.top - g.top - 8;
    else if (c.bottom > g.bottom) el.scrollTop += c.bottom - g.bottom + 8;
  }, [state.current]);

  // Thumbnails of the photos in view first.
  useEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => {
      const ids = entries.filter((e) => e.isIntersecting).map((e) => (e.target as HTMLElement).dataset.id!);
      if (ids.length) store.prioritize(ids);
    }, { root: el, rootMargin: '400px' });
    el.querySelectorAll('[data-id]').forEach((c) => io.observe(c));
    return () => io.disconnect();
  }, [store, shown.length, state.filter, state.minStars]);

  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (isTextEntry(e.target) || document.querySelector('.dialog')) return;
      if (shortcutKey(e) === 'a' && (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey) {
        e.preventDefault();
        onSelection(new Set(shown.map((p) => p.id)));
        return;
      }
      if (e.key === 'Escape' && selecting) {
        e.preventDefault();
        onSelection(new Set());
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const columns = gridRef.current ? getComputedStyle(gridRef.current).gridTemplateColumns.split(' ').length : 1;
      const moves: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -columns, ArrowDown: columns };
      if (e.key in moves) {
        e.preventDefault();
        if (!store.state.current && shown[0]) store.select(shown[0].id);
        else store.step(moves[e.key]);
      } else if ((e.key === 'Enter' || e.key === ' ') && store.state.current) {
        e.preventDefault();
        store.open(store.state.current);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const downloadSidecars = async () => {
    const zip = await store.downloadSidecars();
    if (zip) saveBlob('rawboy-ratings.zip', zip);
    else store.showMessage('Rate, pick or reject some photos first');
  };

  return (
    <div className="editor browser">
      {selecting ? (
        <header className="toolbar selection-bar">
          <button type="button" className="icon" title="Cancel selection (Esc)" onClick={() => onSelection(new Set())}>✕</button>
          <div className="title"><div className="name">{selection.size}<span className="wide-only"> selected</span></div></div>
          <button type="button" className="text" title={`Select every photo shown (${isApple ? '⌘' : 'Ctrl+'}A)`} onClick={() => onSelection(new Set(shown.map((p) => p.id)))}>All</button>
          <button type="button" className="primary" title="Add the selected photos to the Auto tab" onClick={onSendSelection}>
            <span className="wide-only">Send to Auto</span>
            <span className="narrow-only">To Auto</span>
          </button>
          <HelpButton />
        </header>
      ) : (
      <header className="toolbar">
        <AppSwitcher />
        <div className="title">
          <div className="name">{state.folder?.name}</div>
          {state.folder && <div className="info">{counts.all} photo{counts.all === 1 ? '' : 's'}{!writable && ' · read-only'}</div>}
        </div>
        <button type="button" className="icon" title={`Undo (${isApple ? '⌘' : 'Ctrl+'}Z)`} disabled={!state.canUndo || state.busy} onClick={() => void store.undo()}>↶</button>
        <button type="button" className="text" disabled={state.busy} onClick={() => void openPhotos(store)}>Open</button>
        {counts.all > 0 && (
          <button type="button" className="text" title="Add the selected, picked or starred photos to the Auto tab" onClick={onSendToAuto}>
            <span className="wide-only">Send to Auto</span>
            <span className="narrow-only">To Auto</span>
          </button>
        )}
        {!writable && counts.all > 0 && (
          <button type="button" className="text" title="The ratings as XMP sidecars in a ZIP, to put next to the raws" onClick={downloadSidecars}>
            Save<span className="wide-only"> ratings</span>
          </button>
        )}
        {/* On phones Bin and To bin take turns (To bin while there are rejects), so the bar stays one row. */}
        {writable && state.binCount > 0 && (
          <button type="button" className={`text${counts.rejects > 0 ? ' wide-only' : ''}`} disabled={state.busy} title={`Move the photos in ${BIN} back`} onClick={() => onBin('restore')}>
            Bin ({state.binCount})
          </button>
        )}
        {writable && (
          <button type="button" className={`primary${counts.rejects === 0 ? ' wide-only' : ''}`} disabled={state.busy || counts.rejects === 0} onClick={() => onBin('move')}>
            <span className="wide-only">Move {counts.rejects > 0 ? `${counts.rejects} ` : ''}reject{counts.rejects === 1 ? '' : 's'} to bin</span>
            <span className="narrow-only">To bin</span>
          </button>
        )}
        <HelpButton />
      </header>
      )}
      {state.photos.length > 0 && (
        <div className="browser-filters">
          <div className="segmented">
            {FILTERS.map((f) => (
              <button key={f.key} type="button" className={state.filter === f.key ? 'active' : ''} onClick={() => store.setFilter(f.key)}>
                {f.label} <span className="count">{counts[f.key]}</span>
              </button>
            ))}
          </div>
          <select value={state.minStars} aria-label="Stars" onChange={(e) => store.setMinStars(Number(e.target.value))}>
            <option value={0}>Any stars</option>
            {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{'★'.repeat(n)}{n < 5 ? ' or more' : ''}</option>)}
          </select>
          <select value={state.sort} aria-label="Sort" title="Order of the grid: when the photos were shot (photos without a date by their file's), or file name" onChange={(e) => store.setSort(e.target.value as PhotoSort)}>
            <option value="date">Shoot date</option>
            <option value="name">File name</option>
          </select>
          <label className="auto-advance" title="After rating in the photo view, go to the next photo">
            <input type="checkbox" checked={state.autoAdvance} onChange={(e) => store.setAutoAdvance(e.target.checked)} />
            Auto-advance
          </label>
          {state.folder?.writable && (
            <label className="edits-in-sidecars" title="RawBoy and Auto save their edits of photos from here in the photos' XMP sidecars; opening the folder again brings them back">
              <input type="checkbox" checked={state.editsInSidecars} onChange={(e) => store.setEditsInSidecars(e.target.checked)} />
              Edits in sidecars
            </label>
          )}
        </div>
      )}
      {state.photos.length === 0 ? (
        <div className="center empty">
          {state.busy ? <span className="spinner" /> : (
            <>
              <p>Cull a shoot: rate, pick and reject, then move the rejects to a bin folder. Thumbnails come from the previews inside the raws, so big folders open fast.</p>
              <button type="button" className="primary" onClick={() => void openPhotos(store)}>{directoryPicker() ? 'Open a folder' : 'Choose photos'}</button>
              {state.lastFolder && directoryPicker() && !isArc() && (
                <button type="button" onClick={() => void reopenFolder(store)}>Reopen {state.lastFolder}</button>
              )}
              <p>
                {directoryPicker()
                  ? 'or drop a folder here. Ratings are saved as XMP sidecars that Lightroom, Capture One and darktable read.'
                  : 'or drop them here. This browser can’t write to folders (Chrome and Edge can), so ratings are saved as a ZIP of XMP sidecars and nothing is moved.'}
              </p>
            </>
          )}
        </div>
      ) : shown.length === 0 ? (
        <div className="center empty"><p>No photos match this filter.</p></div>
      ) : (
        <div className="grid" ref={gridRef} onScroll={(e) => (scroll.current = e.currentTarget.scrollTop)}>
          {shown.map((p) => (
            <Cell
              key={p.id}
              photo={p}
              current={p.id === state.current}
              selected={selection.has(p.id)}
              onClick={(e) => {
                if (e.shiftKey) selectRange(p.id);
                else if (selecting || e.metaKey || e.ctrlKey) toggle(p.id);
                else store.open(p.id);
              }}
              onLongPress={() => toggle(p.id)}
            />
          ))}
        </div>
      )}
      {selecting && (
        <RatingBar
          ratings={shown.filter((p) => selection.has(p.id)).map((p) => p.rating)}
          onStars={(n) => store.setStars([...selection], n)}
          onFlag={(f) => store.toggleFlag([...selection], f)}
        />
      )}
    </div>
  );
}

/**
 * Stars and Pick / Reject for the photo view's photo, or the grid's selection: what they all share shows as set, and
 * a press sets it on every one (or clears it when they all have it already).
 */
function RatingBar({ ratings, onStars, onFlag }: {
  ratings: Rating[];
  onStars: (n: number) => void;
  onFlag: (flag: Exclude<Flag, null>) => void;
}) {
  const shared = <T,>(of: (r: Rating) => T) => (ratings.length && ratings.every((r) => of(r) === of(ratings[0])) ? of(ratings[0]) : null);
  const stars = shared((r) => r.stars) ?? 0;
  const flag = shared((r) => r.flag);
  return (
    <div className="rating-bar">
      <div className="star-buttons" role="group" aria-label="Stars">
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} type="button" className={n <= stars ? 'on' : ''} title={`${n} star${n === 1 ? '' : 's'} (${n})`} onClick={() => onStars(n)}>★</button>
        ))}
      </div>
      <div className="flag-buttons">
        <button type="button" className={flag === 'pick' ? 'pick active' : 'pick'} title="Pick (P)" onClick={() => onFlag('pick')}>⚑ Pick</button>
        <button type="button" className={flag === 'reject' ? 'reject active' : 'reject'} title="Reject (X)" onClick={() => onFlag('reject')}>✕ Reject</button>
      </div>
    </div>
  );
}

/** Send to Auto: picks which photos join Auto's batch (photos already there are skipped by Auto). */
function SendToAutoDialog({ store, initial, onDismiss, onSend }: {
  store: BrowserStore;
  initial: SendCriteria;
  onDismiss: () => void;
  onSend: (criteria: SendCriteria, photos: BrowsePhoto[]) => void;
}) {
  const state = useSyncExternalStore(store.subscribe, () => store.state);
  const [kind, setKind] = useState<SendCriteria['kind']>(initial.kind);
  const [stars, setStars] = useState(initial.kind === 'stars' ? initial.stars : 5);
  const [exact, setExact] = useState(initial.kind === 'stars' ? initial.exact : false);
  const criteriaOf = (k: SendCriteria['kind']): SendCriteria => (k === 'stars' ? { kind: k, stars, exact } : { kind: k });
  const count = (k: SendCriteria['kind']) => photosToSend(state.photos, criteriaOf(k), state.filter, state.minStars).length;
  const chosen = photosToSend(state.photos, criteriaOf(kind), state.filter, state.minStars);
  const filtered = state.filter !== 'all' || state.minStars > 0;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onDismiss();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onDismiss]);

  return (
    <div className="dialog-backdrop" onClick={onDismiss}>
      <div className="dialog send-to-auto" role="dialog" aria-label="Send to Auto" onClick={(e) => e.stopPropagation()}>
        <h2>Send to Auto</h2>
        <div className="send-options" role="radiogroup">
          <label className="send-option">
            <input type="radio" name="send" checked={kind === 'picks'} onChange={() => setKind('picks')} />
            <span>Picks</span>
            <span className="count">{count('picks')}</span>
          </label>
          <label className="send-option">
            <input type="radio" name="send" checked={kind === 'stars'} onChange={() => setKind('stars')} />
            <span className="send-stars">
              <select
                value={exact ? 'exact' : 'min'}
                aria-label="Star match"
                onChange={(e) => {
                  setExact(e.target.value === 'exact');
                  setKind('stars');
                }}
              >
                <option value="min">At least</option>
                <option value="exact">Exactly</option>
              </select>
              <select
                value={stars}
                aria-label="Stars"
                onChange={(e) => {
                  setStars(Number(e.target.value));
                  setKind('stars');
                }}
              >
                {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{'★'.repeat(n)}</option>)}
              </select>
            </span>
            <span className="count">{count('stars')}</span>
          </label>
          <label className="send-option">
            <input type="radio" name="send" checked={kind === 'shown'} onChange={() => setKind('shown')} />
            <span>{filtered ? 'What the grid shows now' : 'Every photo'}</span>
            <span className="count">{count('shown')}</span>
          </label>
        </div>
        <small className="muted">
          {kind === 'stars' ? 'Rejects are left out. ' : ''}
          To send a hand-picked set, long-press a photo (or {isApple ? '⌘' : 'Ctrl+'}click) to select, then Send to Auto.
        </small>
        <div className="dialog-actions">
          <button type="button" className="text" onClick={onDismiss}>Cancel</button>
          <button type="button" className="primary" disabled={chosen.length === 0} onClick={() => onSend(criteriaOf(kind), chosen)}>
            Add {chosen.length} to Auto
          </button>
        </div>
      </div>
    </div>
  );
}

function Stars({ n }: { n: number }) {
  return n > 0 ? <span className="stars">{'★'.repeat(n)}</span> : null;
}

function FlagBadge({ photo }: { photo: BrowsePhoto }) {
  const f = photo.rating.flag;
  if (f === 'pick') return <span className="flag pick" title="Pick">⚑</span>;
  if (f === 'reject') return <span className="flag reject" title="Reject">✕</span>;
  return null;
}

function Cell({ photo, current, selected, onClick, onLongPress }: {
  photo: BrowsePhoto;
  current: boolean;
  selected: boolean;
  onClick: (e: React.MouseEvent) => void;
  onLongPress: () => void;
}) {
  const timer = useRef(0);
  const longPressed = useRef(false);
  return (
    <button
      type="button"
      data-id={photo.id}
      className={`cell${current ? ' current' : ''}${selected ? ' selected' : ''}${photo.rating.flag === 'reject' ? ' rejected' : ''}`}
      onPointerDown={() => {
        longPressed.current = false;
        timer.current = window.setTimeout(() => {
          longPressed.current = true;
          onLongPress();
        }, 500);
      }}
      onPointerUp={() => clearTimeout(timer.current)}
      onPointerLeave={() => clearTimeout(timer.current)}
      onPointerCancel={() => clearTimeout(timer.current)}
      onContextMenu={(e) => e.preventDefault()}
      onClick={(e) => {
        if (!longPressed.current) onClick(e);
      }}
    >
      <div className="thumb">
        {photo.thumbnail && <img src={photo.thumbnail} alt={photo.main} loading="lazy" />}
        {photo.status === 'queued' && <span className="spinner" />}
        {photo.status === 'failed' && <span className="badge error" title={photo.error ?? undefined}>{photo.error?.startsWith('HEIC') ? photo.error : 'Can’t show this photo'}</span>}
        <FlagBadge photo={photo} />
        {selected && <span className="check">✓</span>}
      </div>
      <div className="cell-name">
        {photo.main}
        {photo.companions.length > 0 && <span className="muted"> +{photo.companions.map((c) => c.slice(c.lastIndexOf('.') + 1).toUpperCase()).join(' ')}</span>}
      </div>
      <div className="cell-rating"><Stars n={photo.rating.stars} /></div>
    </button>
  );
}

function Viewer({ store, photo, active, onEdit }: { store: BrowserStore; photo: BrowsePhoto; active: boolean; onEdit: () => void }) {
  useSyncExternalStore(store.subscribe, () => store.state); // the filtered list below follows the store
  const [view, setView] = useState<{ id: string; url: string; image: ViewImage } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const shown = store.shown();
  const index = shown.findIndex((p) => p.id === photo.id);

  useEffect(() => {
    let url: string | null = null;
    let cancelled = false;
    setError(null);
    store.viewImage(photo.id).then(
      (image) => {
        if (cancelled) return;
        url = URL.createObjectURL(image.blob);
        setView({ id: photo.id, url, image });
      },
      (e: unknown) => !cancelled && setError(e instanceof Error ? e.message : String(e)),
    );
    // The next photos load while this one is looked at.
    const next = shown.slice(Math.max(0, index - 1), index + 3).map((p) => p.id);
    for (const id of next) void store.viewImage(id).catch(() => undefined);
    store.prioritize(next);
    return () => {
      cancelled = true;
      if (url) setTimeout(() => URL.revokeObjectURL(url!), 1000);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, photo.id]);

  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (isTextEntry(e.target) || document.querySelector('.dialog') || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') store.step(-1);
      else if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === ' ') store.step(1);
      else if (e.key === 'Escape' || e.key === 'Enter' || shortcutKey(e) === 'g') store.closeViewer();
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const swipe = useRef<{ x: number; y: number } | null>(null);
  const [zoomed, setZoomed] = useState(false);
  const current = view?.id === photo.id ? view : null;
  const sourceLabel = current?.image.source === 'embedded' ? 'camera preview' : current?.image.source === 'decoded' ? 'developed as shot' : '';
  const rate = (fn: () => void) => {
    fn();
    store.advance();
  };

  return (
    <div className="editor browser">
      <header className="toolbar">
        <button type="button" className="icon" title="Back to the grid (Esc)" onClick={() => store.closeViewer()}>←</button>
        <div className="title">
          <div className="name">{photo.main}</div>
          <div className="info">
            {index >= 0 ? `${index + 1} / ${shown.length}` : 'Not in the filter'}
            {current?.image.size && ` · ${current.image.size}`}
            {sourceLabel && ` · ${sourceLabel}`}
          </div>
        </div>
        <button type="button" className="text" title="Open in the RawBoy tab (E)" onClick={onEdit}>Edit<span className="wide-only"> in RawBoy</span></button>
        <HelpButton />
      </header>
      <div
        className="viewer"
        onTouchStart={(e) => (swipe.current = { x: e.touches[0].clientX, y: e.touches[0].clientY })}
        onTouchEnd={(e) => {
          const s = swipe.current;
          swipe.current = null;
          if (!s || zoomed) return;
          const dx = e.changedTouches[0].clientX - s.x;
          const dy = e.changedTouches[0].clientY - s.y;
          if (Math.abs(dx) > 60 && Math.abs(dx) > 2 * Math.abs(dy)) store.step(dx < 0 ? 1 : -1);
        }}
      >
        {current ? (
          <ZoomImage key={current.url} url={current.url} alt={photo.main} active={active} onZoom={setZoomed} />
        ) : (
          <>
            {photo.thumbnail && <img className="viewer-placeholder" src={photo.thumbnail} alt="" />}
            <div className="center">{error ? <span className="badge error">{error}</span> : <span className="spinner" />}</div>
          </>
        )}
        {zoomed && <span className="preview-label">1:1</span>}
        {index > 0 && !zoomed && <button type="button" className="nav prev" onClick={() => store.step(-1)} title="Previous (←)">‹</button>}
        {index < shown.length - 1 && !zoomed && <button type="button" className="nav next" onClick={() => store.step(1)} title="Next (→)">›</button>}
      </div>
      <RatingBar
        ratings={[photo.rating]}
        onStars={(n) => rate(() => store.setStars(photo.id, n))}
        onFlag={(f) => rate(() => store.toggleFlag(photo.id, f))}
      />
    </div>
  );
}

/**
 * The photo fitted to the view, or at 1:1 (one image pixel per screen pixel) around the point double-clicked or
 * under the pointer when Z is pressed; drag to pan.
 */
function ZoomImage({ url, alt, active, onZoom }: { url: string; alt: string; active: boolean; onZoom: (zoomed: boolean) => void }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const pointer = useRef<{ x: number; y: number } | null>(null);
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null);

  useEffect(() => onZoom(pos != null), [pos, onZoom]);

  const size = () => {
    const img = imgRef.current!;
    const dpr = window.devicePixelRatio || 1;
    return { w: img.naturalWidth / dpr, h: img.naturalHeight / dpr };
  };

  const clamp = (x: number, y: number) => {
    const box = boxRef.current!.getBoundingClientRect();
    const { w, h } = size();
    return {
      x: w <= box.width ? (box.width - w) / 2 : Math.min(0, Math.max(box.width - w, x)),
      y: h <= box.height ? (box.height - h) / 2 : Math.min(0, Math.max(box.height - h, y)),
    };
  };

  /** Zooms to 1:1 keeping the image point under ([cx], [cy]) (client coordinates) in place, or back to fit. */
  const toggle = (cx?: number, cy?: number) => {
    const img = imgRef.current;
    const boxEl = boxRef.current;
    if (!img?.naturalWidth || !boxEl) return;
    if (pos) return setPos(null);
    const box = boxEl.getBoundingClientRect();
    const px = (cx ?? box.left + box.width / 2) - box.left;
    const py = (cy ?? box.top + box.height / 2) - box.top;
    const fit = Math.min(box.width / img.naturalWidth, box.height / img.naturalHeight);
    const fw = img.naturalWidth * fit;
    const fh = img.naturalHeight * fit;
    const fx = Math.min(1, Math.max(0, (px - (box.width - fw) / 2) / fw));
    const fy = Math.min(1, Math.max(0, (py - (box.height - fh) / 2) / fh));
    const { w, h } = size();
    setPos(clamp(px - fx * w, py - fy * h));
  };

  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (shortcutKey(e) !== 'z' || e.metaKey || e.ctrlKey || e.altKey || isTextEntry(e.target)) return;
      e.preventDefault();
      toggle(pointer.current?.x, pointer.current?.y);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <div
      ref={boxRef}
      className={`zoom-box${pos ? ' zoomed' : ''}`}
      onDoubleClick={(e) => toggle(e.clientX, e.clientY)}
      onPointerMove={(e) => {
        pointer.current = { x: e.clientX, y: e.clientY };
        const d = drag.current;
        if (d && pos) setPos(clamp(d.px + e.clientX - d.x, d.py + e.clientY - d.y));
      }}
      onPointerLeave={() => (pointer.current = null)}
      onPointerDown={(e) => {
        if (!pos) return;
        drag.current = { x: e.clientX, y: e.clientY, px: pos.x, py: pos.y };
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerUp={() => (drag.current = null)}
    >
      <img
        ref={imgRef}
        src={url}
        alt={alt}
        draggable={false}
        style={pos ? { left: pos.x, top: pos.y, width: size().w, height: size().h } : undefined}
      />
    </div>
  );
}
