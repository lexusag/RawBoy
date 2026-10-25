# Google Drive (web)

RawBoy Web can open photos from Google Drive and save exports to it. This is in the web app only; the Android and iOS
apps don't have it. Once it's set up:

- **RawBoy** tab: **Open › From Google Drive** picks one photo (RAW, JPEG, HEIC, PNG or TIFF). With no photo open,
  the empty screen also has **Open from Google Drive**.
- **Auto** tab: **Add › From Google Drive** picks several photos. The empty grid has **Choose from Google Drive**.
- Export (both tabs): **Save to: This device / Google Drive**. With Google Drive, you pick a folder after pressing
  Export, and the files go there as `<name>-rawboy.jpg` or `<name>-auto.jpg`. If a name is taken, `-001`, `-002` and
  so on are added, the same as for a local folder. The choice is remembered.

Photos are downloaded into the browser and developed there, the same as local files. Nothing is sent anywhere except
the exports you save to Drive.

Until the site is built with a Google client ID and API key, nothing about Drive shows up in the app.

## How it works

- **Scope `drive.file` only.** RawBoy can see only the files you pick in Google's Picker and the files it creates
  itself. It can't list or read the rest of your Drive. This scope is "non-sensitive", so Google doesn't ask for a
  security assessment, which the full-Drive scopes would need.
- **The Drive window.** The app page is cross-origin isolated (`COOP: same-origin`, `COEP: require-corp`) because
  the WASM decoder uses threads. That blocks Google's Picker iframes, and it also cuts the link to pop-ups. So the
  sign-in and the Picker run in a separate same-origin page, `drive.html`, which is served **without** the isolation
  headers. It talks to the app over a `BroadcastChannel`.
  - Sign-in uses the OAuth token flow inside that window. It redirects to Google and back to `drive.html`, so the
    redirect URI has to be registered.
  - The access token lasts an hour and is kept only in memory while the page is open. After a reload, the window asks
    Google again. That's usually just one click, because Google remembers the consent.
- **Downloads and uploads** happen on the app page through the Drive REST API (`googleapis.com` answers CORS
  requests, which is fine under `require-corp`). Uploads are resumable, sent in one request, so 16-bit TIFFs of
  several hundred MB work.
- Code: `web/src/drive/` (`protocol.ts` for the configuration and messages, `popup.ts` for the Drive window,
  `Drive.ts` for the app side), plus `web/drive.html`.

## Setup (one time, in Google Cloud)

You need a Google account. Everything below is free.

### 1. Project and APIs

1. Open <https://console.cloud.google.com/> and create a project, for example **RawBoy** (project picker at the top,
   then *New project*).
2. Write down the **project number**. It's on the project's *Dashboard* (*Project info*), or under *IAM & Admin →
   Settings*. It's the number, not the project ID. This becomes `GOOGLE_APP_ID`.
3. Go to *APIs & Services → Library* and enable both **Google Drive API** and **Google Picker API**.

### 2. OAuth consent screen (Google Auth Platform)

*APIs & Services → OAuth consent screen* (newer consoles call it *Google Auth Platform*):

1. **Branding**:
   - App name: `RawBoy`.
   - User support email: your address.
   - App home page: `https://app.rawboy.link`.
   - Authorized domain: `rawboy.link` (add `pages.dev` only if you'll use `rawboy.pages.dev` directly).
   - Developer contact: your address.
   - A privacy policy URL is needed before you publish to everyone (step 4). A short page saying that photos are
     processed in the browser and only the files you pick or save are accessed is enough.
2. **Audience**: *External*.
3. **Data access**: *Add or remove scopes*, then tick `.../auth/drive.file` ("See, edit, create and delete only the
   specific Google Drive files you use with this app"). Don't add any other Drive scope.
4. **Publishing status**:
   - **Just for you (and a few others)**: leave it in *Testing* and add your Google account (and up to 100 others) under
     *Test users*. Anyone else gets "access blocked".
   - **For everyone**: *Publish app*. With only `drive.file`, there is no security review. Google may still ask to
     verify the brand: domain ownership of `rawboy.link` through Google Search Console, plus the privacy policy link.
     Until that's done, users may see the app name without a logo, but it works.

### 3. OAuth client ID

*APIs & Services → Credentials → Create credentials → OAuth client ID*:

- Application type: **Web application**, name `RawBoy Web`.
- **Authorized JavaScript origins**:
  ```
  https://app.rawboy.link
  https://rawboy.pages.dev
  http://localhost:5173
  ```
- **Authorized redirect URIs**. Cloudflare Pages serves `drive.html` at `/drive`, while Vite and nginx keep `.html`:
  ```
  https://app.rawboy.link/drive
  https://rawboy.pages.dev/drive
  http://localhost:5173/drive.html
  ```
  Add `http://localhost:4173/drive.html` for `npm run preview` and `http://localhost:8080/drive.html` for the Docker
  image if you use them.
- *Create*, then copy the **Client ID** (`….apps.googleusercontent.com`). This becomes `GOOGLE_CLIENT_ID`. RawBoy doesn't
  use the client secret.

Changes to origins and redirect URIs can take a few minutes to apply.

### 4. API key (for the Picker)

*Credentials → Create credentials → API key*, then *Edit API key*:

- **Application restrictions → Websites**:
  ```
  https://app.rawboy.link/*
  https://rawboy.pages.dev/*
  http://localhost:5173/*
  ```
- **API restrictions → Restrict key → Google Picker API**.
- Copy the key. This becomes `GOOGLE_API_KEY`.

### 5. Build it in

The three values end up in the public JavaScript. That's normal: a client ID and a website-restricted API key aren't
secrets. So they're GitHub repository **variables**, not secrets.

- **Releases (Cloudflare Pages)**: GitHub repo → *Settings → Secrets and variables → Actions → Variables* → *New
  repository variable*, three times:

  | Name | Value |
  |---|---|
  | `GOOGLE_CLIENT_ID` | the OAuth client ID |
  | `GOOGLE_API_KEY` | the API key |
  | `GOOGLE_APP_ID` | the project number |

  The `web` job in `.github/workflows/release.yml` passes them to Vite as `VITE_GOOGLE_*`. Deploy as usual with a
  release, or *Actions → Release RawBoy → Run workflow* with an existing tag and *Deploy the web build even if
  unchanged* ticked. Variables alone don't change any file, so the "skip unchanged" check wouldn't notice them.
- **Locally**: create `web/.env.local` (git-ignored):
  ```
  VITE_GOOGLE_CLIENT_ID=….apps.googleusercontent.com
  VITE_GOOGLE_API_KEY=…
  VITE_GOOGLE_APP_ID=123456789012
  ```
  Then run `npm run dev` as usual.
- **Docker**: `docker build -f web/Dockerfile --build-arg VITE_GOOGLE_CLIENT_ID=… --build-arg VITE_GOOGLE_API_KEY=…
  --build-arg VITE_GOOGLE_APP_ID=… -t rawboy-web .`

### 6. Check

1. `curl -sI https://app.rawboy.link/drive | grep -i cross-origin` should print **nothing**. The Drive window has to be
   served without the isolation headers (`web/public/_headers`). `curl -sI https://app.rawboy.link/ | grep -i
   cross-origin` should still print both headers.
2. In the app: **Open › From Google Drive**. A window opens, asks you to pick a Google account and allow access to
   "files you use with this app", then shows the Picker. Pick a RAW and it opens.
3. Export with *Save to: Google Drive*, pick a folder, and the file appears there.

## Troubleshooting

| What you see | Fix |
|---|---|
| `Error 400: redirect_uri_mismatch` | The error page shows the URI it got. Add it exactly to the client's *Authorized redirect URIs* (step 3), then wait a few minutes |
| `Error 403: access_denied`, "has not completed the Google verification process" | The app is in *Testing* and the account isn't a test user. Add it (step 2.4) or publish the app |
| "Google Drive didn't open. Allow pop-ups…" | The browser blocked the window. Allow pop-ups for the site. On phones it opens as a tab and closes itself when done |
| The Picker says the API developer key is invalid, or stays blank | The API key's website restrictions don't include this address, or the Picker API isn't enabled (steps 1 and 4) |
| The Picker shows, but downloads fail with "File not found" | `GOOGLE_APP_ID` isn't this project's **number**, so the Picker didn't grant this app access to the picked files |
| The Drive window shows nothing, and the console has COEP or COOP errors | The host sends the isolation headers on `/drive` too. Check `_headers` (Cloudflare), `nginx.conf`, or the host's own header settings |
| "Google Drive sign-in expired" during a long export | Tokens last an hour. Export again; photos already saved stay |

Hosts that can't send headers at all, such as GitHub Pages, rely on `coi-serviceworker`, which adds the isolation
headers to every page, including the Drive window. Drive doesn't work there. Netlify reads `_headers` too, but it
can't take a header off a single path, so Drive doesn't work there either. Use Cloudflare Pages, nginx (the Docker
image), or a host where you can leave the headers off `/drive`.
