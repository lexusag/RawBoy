# Cloudflare and search engines

How RawBoy Web is hosted on Cloudflare Pages, how to put it on your own domain, what the caching and headers do, and
how to get it into Google and Bing. Building and the deploy commands are in [web/README.md](../web/README.md).

## What is set up already

- **Cloudflare Pages project `rawboy`**, production at `https://rawboy.pages.dev`. It's a *Direct Upload* project:
  Cloudflare doesn't build anything, the GitHub workflow uploads `web/dist/` with Wrangler.
- **Deploys** run from `.github/workflows/release.yml` when a GitHub release is published (job `web`). The
  `web-changes` job skips the deploy when nothing the web build reads changed since the commit the live site was
  built from (`/deployed-commit.txt` on the site). To deploy without a new release: Actions → *Release RawBoy* →
  *Run workflow*, enter an existing tag and tick *Deploy the web build even if unchanged*.
- Repository secrets `CLOUDFLARE_API_TOKEN` (token with *Account → Cloudflare Pages → Edit*) and
  `CLOUDFLARE_ACCOUNT_ID`.
- **SEO in the build**: title, description, canonical URL, Open Graph / Twitter card, JSON-LD, a static description of
  the app, `robots.txt` and `sitemap.xml` (see *Search engines* in [web/README.md](../web/README.md)). All absolute
  URLs come from `SITE_URL`, which defaults to `https://rawboy.pages.dev`.

Nothing in Cloudflare has to change for the SEO part to go live: the next deploy carries it.

## Custom domain (recommended)

A domain of your own ranks and gets shared better than `*.pages.dev`, which some networks' DNS filters block.

1. **Get the domain onto Cloudflare.** Simplest is to register it with Cloudflare Registrar (at cost), or add an
   existing domain as a zone (*Add a site*, then change the nameservers at your registrar). A subdomain such as
   `rawboy.example.com` also works with DNS elsewhere, as a CNAME to `rawboy.pages.dev`; an apex domain
   (`rawboy.app`) needs the zone on Cloudflare.
2. **Attach it to the project:** Workers & Pages → `rawboy` → *Custom domains* → *Set up a custom domain*, enter
   the name. With the zone on Cloudflare the DNS record and certificate are created for you; it's active within
   minutes. Add `www.` too if you want it, and redirect it (step 5).
3. **Tell the build:** GitHub → repository *Settings → Secrets and variables → Actions → Variables* → *New
   repository variable* `SITE_URL` = `https://your.domain` (no trailing slash). For a local or Docker build:
   `SITE_URL=https://your.domain npm run build:public`, or `docker build --build-arg SITE_URL=...`.
4. **Deploy** with the forced workflow run above, then check that the canonical changed:
   `curl -s https://your.domain/ | grep canonical` and `curl -s https://your.domain/robots.txt`.
5. **Redirect the old addresses** so search engines see one site. `rawboy.pages.dev` keeps working and its pages
   point their canonical at the new domain, which is already enough for Google; a redirect is cleaner:
   - Account home → *Bulk Redirects* → create a list with source `rawboy.pages.dev` → target
     `https://your.domain`, status **301**, tick *Preserve query string*, *Subpath matching* and *Preserve path
     suffix*, then create a Bulk Redirect rule that uses the list. (Page Rules and Redirect Rules can't act on
     `pages.dev`; Bulk Redirects can.)
   - `www` → apex (or the other way): a *Redirect Rule* in the zone (Rules → Redirect Rules → *Redirect from WWW to
     root* template).
   - Preview deployments (`<hash>.rawboy.pages.dev`) don't need a redirect: Cloudflare sends `X-Robots-Tag: noindex`
     on them, so they stay out of search results.

   The release workflow follows the redirect when it reads `deployed-commit.txt`, so *Skip unchanged web releases*
   keeps working.

## Caching and headers

`web/public/_headers` is copied into `dist/` and applied by Pages:

| Path | Headers | Why |
|---|---|---|
| everything | `Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Embedder-Policy: require-corp` | The WASM decoder uses threads (SharedArrayBuffer), which only work on a cross-origin isolated page |
| everything | `Cache-Control: no-cache` | Browsers revalidate (a cheap 304 with Pages' ETags), so a deploy shows up at once. Covers `index.html`, `wasm/`, `models/`, `mediapipe/`: their names have no hash, so a long cache would mix old WASM with new JavaScript |
| `/assets/*` | `Cache-Control: public, max-age=31536000, immutable` | Vite's bundles have content hashes in their names; they never change |

Pages serves every file from Cloudflare's edge and compresses it (Brotli/gzip) by itself; there's nothing to tune for
`pages.dev`. On a custom domain zone, keep these in mind:

- **Don't add a "Cache Everything" rule or Edge Cache TTL for HTML.** Pages already caches at the edge and purges on
  each deploy; a zone cache rule would keep serving the old `index.html` after a deploy.
- **Leave Rocket Loader off** (Speed → Optimization). It rewrites `<script>` tags, which breaks the module scripts
  and `coi-serviceworker`.
- **Cloudflare Web Analytics' automatic injection is blocked by COEP** (its beacon comes from another origin without
  CORP). Use the Pages project's *Metrics*, or the zone's analytics, which need no script.
- *Always Use HTTPS* and *HSTS* (SSL/TLS → Edge Certificates) are good to turn on once the domain works.
- **AI crawlers:** *Block AI bots* and *Managed robots.txt* (Security → Bots) change who may crawl. Search engine
  crawlers (Googlebot, Bingbot) aren't affected; keep the managed robots.txt off if you want the build's own file
  served unchanged.
- **Crawler Hints** (Caching → Configuration) is worth turning on: Cloudflare tells Bing, Yandex and others through
  IndexNow when content changes.

Check the live headers with `curl -sI https://your.domain/ | grep -iE 'cross-origin|cache-control|x-robots'`.

## Google Search Console

1. Open [search.google.com/search-console](https://search.google.com/search-console) and *Add property*.
   - **Custom domain on Cloudflare:** choose *Domain*, enter `your.domain`. Google offers to verify through
     Cloudflare directly (it adds the TXT record after you log in); otherwise copy the TXT record into Cloudflare DNS.
   - **Only `rawboy.pages.dev`:** choose *URL prefix* `https://rawboy.pages.dev/` and verify with *HTML file*:
     put the downloaded `google<code>.html` into `web/public/`, commit, deploy, then press *Verify*. (A
     `<meta name="google-site-verification">` tag in `web/index.html` works too.)
2. *Sitemaps* → enter `sitemap.xml` → *Submit*.
3. *URL inspection* → paste the home page URL → *Request indexing*. *Test live URL* → *View tested page* shows what
   Googlebot rendered.
4. Expect the first appearance in results within days to a couple of weeks. Search for `site:your.domain` to see
   what's indexed.

## Bing Webmaster Tools (also covers DuckDuckGo, Yahoo, Ecosia)

1. Open [bing.com/webmasters](https://www.bing.com/webmasters) and sign in.
2. Quickest: *Import from Google Search Console*, which brings the verified site and its sitemap. Otherwise add
   the site and verify with the XML file (into `web/public/`, like Google's), a meta tag, or a CNAME in Cloudflare DNS.
3. *Sitemaps* → submit `https://your.domain/sitemap.xml` if it isn't listed.
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

- Link to the web app from the GitHub README (top of the page) and the GitHub repository's *Website* field.
- Share it where photographers talk (forums, Reddit, darktable/Fuji communities); each link is a vote.
- Keep the static description in `web/index.html` honest and current; it's what search engines show and match.
