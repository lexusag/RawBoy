/// <reference types="vite/client" />

/** The release this build belongs to, e.g. 1.7.0 (vite.config.ts). */
declare const __RAWBOY_VERSION__: string;

/** Timestamp of this build (vite.config.ts); version.json on the server carries the newest one. */
declare const __RAWBOY_BUILD__: string;

/** Short git commit of the sources, or empty when the build didn't know it (vite.config.ts). */
declare const __RAWBOY_COMMIT__: string;
