/**
 * The Drive window (drive.html): signs in with Google (OAuth token flow, redirecting back to this page), shows
 * Google's Picker and hands what was picked to the app page over the channel (see protocol.ts). Served without the
 * cross-origin isolation headers, which would block the Picker's iframes.
 */
import {
  DRIVE_CHANNEL, DRIVE_CONFIG, DRIVE_SCOPE, decodeRequest, encodeRequest, type DriveDoc, type DriveMessage,
  type DriveRequest, type DriveToken,
} from './protocol';

// The parts of Google's Picker API used here (https://developers.google.com/drive/picker/reference).
interface PickerView {
  setIncludeFolders(on: boolean): PickerView;
  setSelectFolderEnabled(on: boolean): PickerView;
  setMimeTypes(types: string): PickerView;
  setParent(id: string): PickerView;
  setEnableDrives(on: boolean): PickerView;
  setLabel(label: string): PickerView;
}
interface PickerBuilder {
  addView(v: PickerView): PickerBuilder;
  setOAuthToken(t: string): PickerBuilder;
  setDeveloperKey(k: string): PickerBuilder;
  setAppId(id: string): PickerBuilder;
  setOrigin(o: string): PickerBuilder;
  setTitle(t: string): PickerBuilder;
  setSize(w: number, h: number): PickerBuilder;
  enableFeature(f: string): PickerBuilder;
  setCallback(cb: (data: PickerResponse) => void): PickerBuilder;
  build(): { setVisible(on: boolean): void };
}
interface PickerResponse {
  action: string;
  docs?: { id: string; name: string; mimeType: string; sizeBytes?: number | string; lastEditedUtc?: number }[];
}
interface GooglePicker {
  PickerBuilder: new () => PickerBuilder;
  DocsView: new (viewId?: string) => PickerView;
  ViewId: { DOCS: string; FOLDERS: string };
  Feature: { MULTISELECT_ENABLED: string; SUPPORT_DRIVES: string; NAV_HIDDEN: string };
  Action: { PICKED: string; CANCEL: string };
}
declare global {
  interface Window {
    gapi?: { load(api: string, cb: () => void): void };
    google?: { picker: GooglePicker };
  }
}

const FOLDER_MIME = 'application/vnd.google-apps.folder';
const channel = new BroadcastChannel(DRIVE_CHANNEL);
const status = document.getElementById('status')!;
let request: DriveRequest | null = null;
let finished = false;
let leaving = false;

const post = (m: DriveMessage) => channel.postMessage(m);

function show(text: string, error = false) {
  status.textContent = text;
  status.className = error ? 'error' : '';
}

/** Tells the app and closes; a tab the browser won't let close says it's done instead. */
function finish(m: DriveMessage, text: string) {
  finished = true;
  post(m);
  show(text);
  window.close();
}

function fail(error: string) {
  if (request) post({ type: 'cancel', id: request.id, error });
  finished = true;
  show(error, true);
}

/** The redirect URI is this page as the host serves it (Cloudflare Pages drops ".html"). */
const redirectUri = () => `${location.origin}${location.pathname}`;

function signIn(r: DriveRequest) {
  const q = new URLSearchParams({
    client_id: DRIVE_CONFIG.clientId,
    redirect_uri: redirectUri(),
    response_type: 'token',
    scope: DRIVE_SCOPE,
    include_granted_scopes: 'true',
    state: encodeRequest(r),
  });
  leaving = true;
  show('Signing in to Google…');
  location.replace(`https://accounts.google.com/o/oauth2/v2/auth?${q}`);
}

/** Waits briefly for the app's token (signed in earlier on this page load); null = sign in. */
function askAppForToken(r: DriveRequest): Promise<DriveToken | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => done(null), 1500);
    const listener = (e: MessageEvent<DriveMessage>) => {
      if (e.data.type === 'token' && e.data.id === r.id) done(e.data.token);
    };
    const done = (t: DriveToken | null) => {
      clearTimeout(timer);
      channel.removeEventListener('message', listener);
      resolve(t && t.expiresAt - Date.now() > 5 * 60_000 ? t : null);
    };
    channel.addEventListener('message', listener);
    post({ type: 'hello', id: r.id });
  });
}

function loadPicker(): Promise<GooglePicker> {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://apis.google.com/js/api.js';
    script.onload = () => window.gapi!.load('picker', () => resolve(window.google!.picker));
    script.onerror = () => reject(new Error("Couldn't load Google's file picker"));
    document.head.appendChild(script);
  });
}

async function showPicker(r: DriveRequest, token: DriveToken) {
  show('Opening Google Drive…');
  const picker = await loadPicker();
  const folders = r.mode === 'folder';
  // My Drive by folders, then shared drives. Folder mode lists only folders, and a folder is what gets picked.
  const myDrive = new picker.DocsView(folders ? picker.ViewId.FOLDERS : picker.ViewId.DOCS)
    .setIncludeFolders(true)
    .setParent('root')
    .setLabel('My Drive');
  const shared = new picker.DocsView(folders ? picker.ViewId.FOLDERS : picker.ViewId.DOCS)
    .setIncludeFolders(true)
    .setEnableDrives(true)
    .setLabel('Shared drives');
  if (folders) for (const v of [myDrive, shared]) v.setSelectFolderEnabled(true).setMimeTypes(FOLDER_MIME);
  const builder = new picker.PickerBuilder()
    .addView(myDrive)
    .addView(shared)
    .setOAuthToken(token.accessToken)
    .setDeveloperKey(DRIVE_CONFIG.apiKey)
    .setOrigin(location.origin)
    .setTitle(folders ? 'Save exports to' : r.multiple ? 'Add photos' : 'Open a photo')
    .setSize(Math.max(320, innerWidth), Math.max(320, innerHeight))
    .enableFeature(picker.Feature.SUPPORT_DRIVES)
    .setCallback((data) => {
      if (data.action === picker.Action.PICKED) {
        const docs: DriveDoc[] = (data.docs ?? []).map((d) => ({
          id: d.id,
          name: d.name,
          mimeType: d.mimeType,
          sizeBytes: d.sizeBytes != null ? Number(d.sizeBytes) : undefined,
          lastEdited: d.lastEditedUtc,
        }));
        finish({ type: 'picked', id: r.id, docs }, 'Done. You can close this window.');
      } else if (data.action === picker.Action.CANCEL) {
        finish({ type: 'cancel', id: r.id }, 'Cancelled. You can close this window.');
      }
    });
  if (DRIVE_CONFIG.appId) builder.setAppId(DRIVE_CONFIG.appId);
  if (r.multiple && !folders) builder.enableFeature(picker.Feature.MULTISELECT_ENABLED);
  builder.build().setVisible(true);
  show('');
}

async function start() {
  // Back from Google: #access_token=...&state=... (or #error=...).
  const back = new URLSearchParams(location.hash.slice(1));
  const fromGoogle = back.has('state');
  request = decodeRequest(fromGoogle ? back.get('state') : location.hash.slice(1));
  // The token shouldn't stay in the address bar or history.
  if (fromGoogle) history.replaceState(null, '', location.pathname);
  if (!request) return show('Open Google Drive from RawBoy.', true);
  const r = request;
  if (!DRIVE_CONFIG.clientId || !DRIVE_CONFIG.apiKey) return fail('Google Drive isn’t set up for this site.');
  if (fromGoogle) {
    const accessToken = back.get('access_token');
    if (!accessToken) {
      const error = back.get('error');
      return error === 'access_denied' ? finish({ type: 'cancel', id: r.id }, 'Cancelled. You can close this window.') : fail(`Google sign-in failed${error ? ` (${error})` : ''}.`);
    }
    const token = { accessToken, expiresAt: Date.now() + Number(back.get('expires_in') ?? 3600) * 1000 };
    post({ type: 'hello', id: r.id });
    post({ type: 'signed-in', id: r.id, token });
    return showPicker(r, token);
  }
  const token = await askAppForToken(r);
  if (token) return showPicker(r, token);
  signIn(r);
}

// Closing the window (or the tab) before picking anything cancels; going to Google's sign-in doesn't.
addEventListener('pagehide', () => {
  if (request && !finished && !leaving) post({ type: 'cancel', id: request.id });
});

start().catch((e: unknown) => fail(e instanceof Error ? e.message : String(e)));
