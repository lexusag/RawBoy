/**
 * Google Drive: the app page and the Drive window (drive.html) talk over a BroadcastChannel. The app page is cross-origin
 * isolated (COOP same-origin), which cuts window.opener and would block Google's Picker iframes, so the Picker and the
 * sign-in run in their own same-origin window served without the isolation headers.
 */

/** Built in with the app (Vite env, see docs/google-drive.md); without a client ID and API key Drive is hidden. */
export const DRIVE_CONFIG = {
  clientId: (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined) ?? '',
  apiKey: (import.meta.env.VITE_GOOGLE_API_KEY as string | undefined) ?? '',
  /** The Google Cloud project number: the Picker grants drive.file access to picked files for this app. */
  appId: (import.meta.env.VITE_GOOGLE_APP_ID as string | undefined) ?? '',
};

export const driveConfigured = () => DRIVE_CONFIG.clientId !== '' && DRIVE_CONFIG.apiKey !== '';

/** Only files the user picks or the app creates: no restricted scope, so no Google security review. */
export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';

export const DRIVE_CHANNEL = 'rawboy-drive';

/** 'files': photos to open; 'folder': where exports go. */
export type DriveMode = 'files' | 'folder';

/** What the app asks the Drive window for (its URL hash, then the OAuth state). */
export interface DriveRequest {
  id: string;
  mode: DriveMode;
  multiple: boolean;
}

export interface DriveToken {
  accessToken: string;
  /** ms since the epoch. */
  expiresAt: number;
}

export interface DriveDoc {
  id: string;
  name: string;
  mimeType: string;
  /** Unknown for folders and some shared files. */
  sizeBytes?: number;
  /** ms since the epoch. */
  lastEdited?: number;
}

export type DriveMessage =
  /** Window → app: loaded; the app answers with its token, if it has one that is still good. */
  | { type: 'hello'; id: string }
  | { type: 'token'; id: string; token: DriveToken | null }
  /** Window → app: a token from signing in, for the downloads and uploads that follow. */
  | { type: 'signed-in'; id: string; token: DriveToken }
  | { type: 'picked'; id: string; docs: DriveDoc[] }
  | { type: 'cancel'; id: string; error?: string };

export const encodeRequest = (r: DriveRequest) => btoa(JSON.stringify(r)).replace(/=+$/, '');

export function decodeRequest(s: string | null): DriveRequest | null {
  if (!s) return null;
  try {
    const r = JSON.parse(atob(s)) as DriveRequest;
    return typeof r.id === 'string' && (r.mode === 'files' || r.mode === 'folder') ? r : null;
  } catch {
    return null;
  }
}
