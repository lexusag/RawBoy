/**
 * Google Drive on the app page: asks the Drive window (drive.html, see protocol.ts) for photos or a folder, then
 * downloads and uploads with the Drive REST API, which answers cross-origin requests (fine under require-corp).
 */
import type { OutputFolder } from '../ui/common/files';
import {
  DRIVE_CHANNEL, driveConfigured, encodeRequest, type DriveDoc, type DriveMessage, type DriveMode, type DriveToken,
} from './protocol';

export { driveConfigured };

const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';

/** Kept for this page load only; the Drive window gets a fresh one when it runs out. */
let token: DriveToken | null = null;
let channel: BroadcastChannel | null = null;
/** The request waiting for the Drive window; a new one replaces it (a window closed during sign-in never answers). */
let pending: { id: string; settle: (docs: DriveDoc[] | null, error?: string) => void } | null = null;

function listen() {
  if (channel) return;
  channel = new BroadcastChannel(DRIVE_CHANNEL);
  channel.onmessage = (e: MessageEvent<DriveMessage>) => {
    const m = e.data;
    if (!pending || m.id !== pending.id) return;
    if (m.type === 'hello') {
      helloTimer.clear();
      channel!.postMessage({ type: 'token', id: m.id, token } satisfies DriveMessage);
    } else if (m.type === 'signed-in') {
      token = m.token;
    } else if (m.type === 'picked') {
      pending.settle(m.docs);
    } else if (m.type === 'cancel') {
      pending.settle(null, m.error);
    }
  };
}

const helloTimer = (() => {
  let t: ReturnType<typeof setTimeout> | undefined;
  return {
    start(f: () => void) {
      clearTimeout(t);
      t = setTimeout(f, 20_000);
    },
    clear: () => clearTimeout(t),
  };
})();

/**
 * Opens the Drive window for [mode]. Call straight from a click, before any await, or the browser blocks the window.
 * Resolves to the picked documents, or null when cancelled; rejects when the window couldn't open or failed.
 */
function pick(mode: DriveMode, multiple: boolean): Promise<DriveDoc[] | null> {
  listen();
  pending?.settle(null);
  const id = crypto.randomUUID();
  const url = new URL('drive.html', document.baseURI);
  url.hash = encodeRequest({ id, mode, multiple });
  const w = Math.min(1080, screen.availWidth);
  const h = Math.min(720, screen.availHeight);
  const opened = window.open(url, 'rawboy-drive', `popup,width=${w},height=${h},left=${(screen.availWidth - w) / 2},top=${(screen.availHeight - h) / 2}`);
  return new Promise((resolve, reject) => {
    const settle = (docs: DriveDoc[] | null, error?: string) => {
      if (pending?.id !== id) return;
      pending = null;
      helloTimer.clear();
      if (error) reject(new Error(error));
      else resolve(docs);
    };
    pending = { id, settle };
    if (!opened) return settle(null, 'Allow pop-ups for this site to use Google Drive');
    // COOP cuts the link to the window, so a blocked one only shows as silence.
    helloTimer.start(() => settle(null, 'Google Drive didn’t open. Allow pop-ups for this site and try again'));
  });
}

async function api(url: string, init: RequestInit = {}): Promise<Response> {
  if (!token) throw new Error('Not signed in to Google Drive');
  const res = await fetch(url, { ...init, headers: { ...init.headers, Authorization: `Bearer ${token.accessToken}` } });
  if (res.ok) return res;
  let detail = '';
  try {
    detail = ((await res.json()) as { error?: { message?: string } }).error?.message ?? '';
  } catch {
    // no JSON body
  }
  if (res.status === 401) token = null;
  throw new Error(res.status === 401 ? 'Google Drive sign-in expired; try again' : detail || `Google Drive error ${res.status}`);
}

/**
 * Picks photos in Google Drive and downloads them (one after another, as Files for the decoders). [onProgress] gets
 * a line to show while downloading. Call from a click (see pick). Files that fail are skipped and reported.
 */
export async function openFromDrive(multiple: boolean, onProgress: (message: string) => void): Promise<File[]> {
  const docs = (await pick('files', multiple))?.filter((d) => d.mimeType !== 'application/vnd.google-apps.folder');
  if (!docs?.length) return [];
  const files: File[] = [];
  const failed: string[] = [];
  for (const [i, d] of docs.entries()) {
    onProgress(docs.length === 1 ? `Downloading ${d.name} from Google Drive…` : `Downloading ${i + 1} of ${docs.length} from Google Drive…`);
    try {
      if (d.mimeType.startsWith('application/vnd.google-apps.')) throw new Error('not a photo');
      const res = await api(`${API}/files/${encodeURIComponent(d.id)}?alt=media&supportsAllDrives=true`);
      const blob = await res.blob();
      files.push(new File([blob], d.name, { type: blob.type || d.mimeType, lastModified: d.lastEdited ?? Date.now() }));
    } catch (e) {
      failed.push(`${d.name} (${e instanceof Error ? e.message : String(e)})`);
    }
  }
  if (failed.length) onProgress(`Couldn’t download ${failed.join(', ')}`);
  return files;
}

/** Picks a Google Drive folder for exports; null when cancelled. Call from a click (see pick). */
export async function pickDriveFolder(): Promise<OutputFolder | null> {
  const [folder] = (await pick('folder', false)) ?? [];
  return folder ? driveFolder(folder.id, folder.name) : null;
}

const quote = (s: string) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

function driveFolder(id: string, name: string): OutputFolder {
  return {
    name: `Google Drive · ${name}`,
    async write(nameFor, blob) {
      for (let counter = 0; counter <= 999; counter++) {
        const fileName = nameFor(counter);
        if (await exists(id, fileName)) continue;
        await upload(id, fileName, blob);
        return fileName;
      }
      throw new Error(`Too many files named ${nameFor(0)}`);
    },
  };
}

/** Whether [folder] holds [name] (among the files this app can see: those it wrote, with drive.file). */
async function exists(folder: string, name: string): Promise<boolean> {
  const q = new URLSearchParams({
    q: `${quote(folder)} in parents and name = ${quote(name)} and trashed = false`,
    fields: 'files(id)',
    pageSize: '1',
    supportsAllDrives: 'true',
    includeItemsFromAllDrives: 'true',
  });
  const res = await api(`${API}/files?${q}`);
  return ((await res.json()) as { files: unknown[] }).files.length > 0;
}

/** A resumable upload in one request: exports reach hundreds of MB (16-bit TIFF), past multipart's limit. */
async function upload(folder: string, name: string, blob: Blob) {
  const type = blob.type || 'application/octet-stream';
  const start = await api(`${UPLOAD}/files?uploadType=resumable&supportsAllDrives=true&fields=id`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': type },
    body: JSON.stringify({ name, parents: [folder], mimeType: type }),
  });
  const session = start.headers.get('Location');
  if (!session) throw new Error('Google Drive didn’t start the upload');
  await api(session, { method: 'PUT', headers: { 'Content-Type': type }, body: blob });
}
