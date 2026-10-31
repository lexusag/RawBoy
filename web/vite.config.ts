import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

const repo = resolve(__dirname, '..');

/**
 * Copies the MediaPipe models from the engine's assets (like the Android build packages them) and MediaPipe's
 * WASM runtime into public/, so they are served from the same origin (needed under cross-origin isolation).
 */
function copyModels(): Plugin {
  return {
    name: 'rawboy-copy-models',
    // In config(), not buildStart(): the dev server indexes public/ when it starts.
    config() {
      const models = resolve(__dirname, 'public/models');
      mkdirSync(models, { recursive: true });
      for (const f of ['selfie_multiclass_256x256.tflite', 'face_landmarker.task']) {
        const src = resolve(repo, 'engine/src/main/assets/models', f);
        if (existsSync(src)) cpSync(src, resolve(models, f));
      }
      cpSync(resolve(__dirname, 'node_modules/@mediapipe/tasks-vision/wasm'), resolve(__dirname, 'public/mediapipe'), { recursive: true });
      // Static hosts (GitHub Pages...) can't send the isolation headers; this service worker adds them.
      cpSync(resolve(__dirname, 'node_modules/coi-serviceworker/coi-serviceworker.min.js'), resolve(__dirname, 'public/coi-serviceworker.min.js'));
      // Third-party licences, shown by the Licences dialog (the Android apps package the same file).
      cpSync(resolve(repo, 'licenses/THIRD_PARTY_NOTICES.txt'), resolve(__dirname, 'public/third_party_notices.txt'));
    },
  };
}

/**
 * Search engines and link previews: fills %SITE_URL% in index.html (canonical, Open Graph, JSON-LD) and writes
 * robots.txt and sitemap.xml into the build. SITE_URL overrides the main address (see docs/cloudflare.md).
 */
function seo(): Plugin {
  const site = (process.env.SITE_URL || 'https://app.rawboy.link').replace(/\/+$/, '');
  return {
    name: 'rawboy-seo',
    // 'pre': before Vite parses the HTML, which rejects the placeholder in URLs.
    transformIndexHtml: { order: 'pre', handler: (html) => html.replaceAll('%SITE_URL%', site) },
    generateBundle() {
      const today = new Date().toISOString().slice(0, 10);
      this.emitFile({ type: 'asset', fileName: 'robots.txt', source: `User-agent: *\nAllow: /\n\nSitemap: ${site}/sitemap.xml\n` });
      this.emitFile({
        type: 'asset',
        fileName: 'sitemap.xml',
        source:
          '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
          [`${site}/`, `${site}/about`, `${site}/privacy`, `${site}/privacy-android`].map((u) => `  <url><loc>${u}</loc><lastmod>${today}</lastmod></url>\n`).join('') +
          '</urlset>\n',
      });
    },
  };
}

/**
 * The release this build belongs to, shown in the "?" sheets: RAWBOY_VERSION (the release workflow passes the tag,
 * v1.7.0 → 1.7.0, as the Android builds get it), else the newest tag git can see, else package.json's version.
 */
const version =
  process.env.RAWBOY_VERSION?.trim().replace(/^v/, '') ||
  git('describe', '--tags', '--abbrev=0')?.replace(/^v/, '') ||
  (JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf8')) as { version: string }).version;

/** Short commit of the sources: RAWBOY_COMMIT (Docker builds have no .git), else git; empty when neither is known. */
const commit = (process.env.RAWBOY_COMMIT?.trim() || git('rev-parse', 'HEAD') || '').slice(0, 7);

/** A git command's output, or undefined outside a checkout (or when it fails, e.g. no tags in a shallow clone). */
function git(...args: string[]): string | undefined {
  try {
    return execFileSync('git', args, { cwd: __dirname, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || undefined;
  } catch {
    return undefined;
  }
}

// Identifies this build: the running app compares it with version.json on the server (src/ui/common/UpdateBanner.tsx).
const build = new Date().toISOString();

/** Writes version.json, which the installed app polls to learn that a newer build was deployed. */
function versionFile(): Plugin {
  return {
    name: 'rawboy-version-file',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ build, version, commit }) + '\n' });
    },
  };
}


// Threads in the WASM decoder need SharedArrayBuffer, i.e. a cross-origin isolated page.
const isolation = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

/**
 * Sends the isolation headers on every page but the Google Drive window (drive.html), whose Picker iframes
 * require-corp would block (as public/_headers and nginx.conf do in production).
 */
function isolationHeaders(): Plugin {
  const middleware = (req: { url?: string }, res: { setHeader(k: string, v: string): void }, next: () => void) => {
    if (!/^\/drive(\.html)?([?#]|$)/.test(req.url ?? '')) for (const [k, v] of Object.entries(isolation)) res.setHeader(k, v);
    next();
  };
  return {
    name: 'rawboy-isolation-headers',
    configureServer: (server) => void server.middlewares.use(middleware),
    configurePreviewServer: (server) => void server.middlewares.use(middleware),
  };
}

export default defineConfig({
  base: './',
  plugins: [react(), copyModels(), seo(), versionFile(), isolationHeaders()],
  server: { fs: { allow: [repo] } },
  // The app, and the Google Drive window (src/drive/popup.ts).
  build: { rollupOptions: { input: { main: resolve(__dirname, 'index.html'), drive: resolve(__dirname, 'drive.html') } } },
  worker: { format: 'es' },
  define: { __RAWBOY_VERSION__: JSON.stringify(version), __RAWBOY_BUILD__: JSON.stringify(build), __RAWBOY_COMMIT__: JSON.stringify(commit) },
});
