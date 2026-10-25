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
 * robots.txt and sitemap.xml into the build. SITE_URL is the production origin; set it when a custom domain is the
 * main address (see docs/cloudflare.md).
 */
function seo(): Plugin {
  const site = (process.env.SITE_URL || 'https://rawboy.pages.dev').replace(/\/+$/, '');
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
          `  <url><loc>${site}/</loc><lastmod>${today}</lastmod></url>\n</urlset>\n`,
      });
    },
  };
}

const version = (JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf8')) as { version: string }).version;

// Threads in the WASM decoder need SharedArrayBuffer, i.e. a cross-origin isolated page.
const isolation = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

export default defineConfig({
  base: './',
  plugins: [react(), copyModels(), seo()],
  server: { headers: isolation, fs: { allow: [repo] } },
  preview: { headers: isolation },
  worker: { format: 'es' },
  define: { __RAWBOY_VERSION__: JSON.stringify(version) },
});
