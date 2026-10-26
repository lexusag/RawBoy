# Cloudflare and search engines

How RawBoy Web is hosted on Cloudflare Pages, how the `app.rawboy.link` domain is set up, what the caching and
headers do, and how to get it into Google and Bing. Building and the deploy commands are in [web/README.md](../web/README.md).

## What is set up already

- **Cloudflare Pages project `rawboy`**, served at **`https://app.rawboy.link`** (the main address) and
  `https://rawboy.pages.dev`. It's a *Direct Upload* project: Cloudflare doesn't build anything, the GitHub workflow
  uploads `web/dist/` with Wrangler.
- **Deploys** run from `.github/workflows/release.yml` when a GitHub release is published (job `web`). The
  `web-changes` job skips the deploy when nothing the web build reads changed since the commit the live site was
  built from (`/deployed-commit.txt` on the site). To deploy without a new release: Actions → *Release RawBoy* →
  *Run workflow*, enter an existing tag and tick *Deploy the web build even if unchanged* (and *Skip building the
  APKs* to leave the apps alone). The `apk-changes` job likewise skips the APK build when nothing the apps read changed
  since the last release with APKs, and attaches that release's APKs instead.
- Repository secrets `CLOUDFLARE_API_TOKEN` (token with *Account → Cloudflare Pages → Edit*) and
  `CLOUDFLARE_ACCOUNT_ID`.
- **SEO in the build**: title, description, canonical URL, Open Graph / Twitter card, JSON-LD, a static description of
  the app, `robots.txt` and `sitemap.xml` (see *Search engines* in [web/README.md](../web/README.md)). All absolute
  URLs point at `https://app.rawboy.link`; the `SITE_URL` environment variable (a GitHub repository variable in CI)
  overrides it if the address ever changes.

Nothing in Cloudflare has to change for the SEO part to go live: the next deploy carries it.

## The domain

`app.rawboy.link` is a custom domain of the Pages project (Workers & Pages → `rawboy` → *Custom domains*). If it
ever needs setting up again: *Set up a custom domain* → `app.rawboy.link`; with the `rawboy.link` zone on Cloudflare
the CNAME to `rawboy.pages.dev` and the certificate are created for you. With DNS elsewhere, add the CNAME
`app` → `rawboy.pages.dev` there first.

**One address for search engines.** `rawboy.pages.dev` serves the same site. Its pages already point their canonical
at `app.rawboy.link`, which is enough for Google; a redirect is cleaner and also helps Bing:

- Account home → *Bulk Redirects* → create a list with source `rawboy.pages.dev` → target
  `https://app.rawboy.link`, status **301**, tick *Preserve query string*, *Subpath matching* and *Preserve path
  suffix*, then create a Bulk Redirect rule that uses the list. (Page Rules and Redirect Rules can't act on
  `pages.dev`; Bulk Redirects can.)
- The bare `rawboy.link` (and `www.`): if it has no site of its own, a *Redirect Rule* in the `rawboy.link` zone
  sending it to `https://app.rawboy.link` gives people who type the short name the app. It needs a proxied DNS record
  for the name (e.g. `AAAA rawboy.link 100::`, orange cloud) so the rule has something to act on.
- Preview deployments (`<hash>.rawboy.pages.dev`) don't need a redirect: Cloudflare sends `X-Robots-Tag: noindex`
  on them, so they stay out of search results.

The release workflow follows redirects when it reads `deployed-commit.txt`, so *Skip unchanged web releases* keeps
working after the `pages.dev` redirect.

After the next deploy, check: `curl -s https://app.rawboy.link/ | grep canonical` and
`curl -s https://app.rawboy.link/robots.txt`.

## Caching and headers

`web/public/_headers` is copied into `dist/` and applied by Pages:

| Path | Headers | Why |
|---|---|---|
| everything | `Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Embedder-Policy: require-corp` | The WASM decoder uses threads (SharedArrayBuffer), which only work on a cross-origin isolated page |
| everything | `Cache-Control: no-cache` | Browsers revalidate (a cheap 304 with Pages' ETags), so a deploy shows up at once. Covers `index.html`, `wasm/`, `models/`, `mediapipe/`: their names have no hash, so a long cache would mix old WASM with new JavaScript |
| `/assets/*` | `Cache-Control: public, max-age=31536000, immutable` | Vite's bundles have content hashes in their names; they never change |
| `/drive`, `/drive.html` | isolation headers taken off (`! Name`) | The Google Drive window: Google's Picker iframes don't load under `require-corp` (see [Google Drive](google-drive.md)) |

Pages serves every file from Cloudflare's edge and compresses it (Brotli/gzip) by itself. In the `rawboy.link` zone,
keep these in mind:

- **Don't add a "Cache Everything" rule or Edge Cache TTL for HTML.** Pages already caches at the edge and purges on
  each deploy; a zone cache rule would keep serving the old `index.html` after a deploy.
- **Leave Rocket Loader off** (Speed → Optimization). It rewrites `<script>` tags, which breaks the module scripts
  and `coi-serviceworker`.
- **Cloudflare Web Analytics' automatic injection is blocked by COEP** (its beacon comes from another origin without
  CORP). Use the Pages project's *Metrics*, or the zone's analytics, which need no script.
- *Always Use HTTPS* and *HSTS* (SSL/TLS → Edge Certificates) are good to turn on.
- **AI crawlers:** *Block AI bots* and *Managed robots.txt* (Security → Bots) change who may crawl. Search engine
  crawlers (Googlebot, Bingbot) aren't affected; keep the managed robots.txt off if you want the build's own file
  served unchanged.
- **Crawler Hints** (Caching → Configuration) is worth turning on: Cloudflare tells Bing, Yandex and others through
  IndexNow when content changes.

Check the live headers with `curl -sI https://app.rawboy.link/ | grep -iE 'cross-origin|cache-control|x-robots'`.

## Google Search Console

1. Open [search.google.com/search-console](https://search.google.com/search-console) and *Add property*.
   - Recommended: *Domain* property `rawboy.link` (covers `app.` and any other subdomain). Google offers to verify
     through Cloudflare directly (it adds the TXT record after you log in); otherwise copy the TXT record into the
     zone's DNS.
   - Or a *URL prefix* property `https://app.rawboy.link/`, verified with *HTML file*: put the downloaded
     `google<code>.html` into `web/public/`, commit, deploy, then press *Verify*. (A
     `<meta name="google-site-verification">` tag in `web/index.html` works too.)
2. *Sitemaps* → enter `sitemap.xml` → *Submit*.
3. *URL inspection* → paste the home page URL → *Request indexing*. *Test live URL* → *View tested page* shows what
   Googlebot rendered.
4. Expect the first appearance in results within days to a couple of weeks. Search for `site:app.rawboy.link` to see
   what's indexed.

## Bing Webmaster Tools (also covers DuckDuckGo, Yahoo, Ecosia)

1. Open [bing.com/webmasters](https://www.bing.com/webmasters) and sign in.
2. Quickest: *Import from Google Search Console*, which brings the verified site and its sitemap. Otherwise add
   `https://app.rawboy.link/` and verify with the XML file (into `web/public/`, like Google's), a meta tag, or a CNAME
   in the zone's DNS.
3. *Sitemaps* → submit `https://app.rawboy.link/sitemap.xml` if it isn't listed.
4. *URL Inspection* → *Request indexing* for the home page.

## Checking the result

- [Rich Results Test](https://search.google.com/test/rich-results) / [Schema validator](https://validator.schema.org):
  the JSON-LD `WebApplication`.
- Link previews: [opengraph.xyz](https://www.opengraph.xyz), Facebook's
  [Sharing Debugger](https://developers.facebook.com/tools/debug/) and LinkedIn's
  [Post Inspector](https://www.linkedin.com/post-inspector/) (they also refresh a cached preview). Telegram:
  send the link to `@WebpageBot` to refresh its cache.
- PageSpeed Insights / Lighthouse *SEO* category.

## Getting found, beyond the tags

Search engines rank a one-page app mostly on links to it and the words on the page. What helps most:

- The README links to `https://app.rawboy.link`; also put it in the GitHub repository's *Website* field (About → ⚙).
- Share it where photographers talk (forums, Reddit, darktable/Fuji communities); each link is a vote.
- Keep the static description in `web/index.html` honest and current; it's what search engines show and match.
