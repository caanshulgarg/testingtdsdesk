# The test site on Cloudflare (staging.fincom.live)

On 26-Oct-2026 the owner decided "let's move to cloudflare", so the GitHub repository can go private later. This page
covers how the move works, what the owner clicks, how to test it, how to go back, and what changes when the repository goes private.
It covers the **test site only** (staging.fincom.live, built from `main` of caanshulgarg/testingtdsdesk).

## How it works

The owner connected the repository in Cloudflare's **Workers & Pages** flow. It became a **Worker with static assets**
(name `testingtdsdesk`), not a classic Pages project:

- production: `https://testingtdsdesk.anshulggrg.workers.dev` (the branch `main`)
- previews: `https://<version>-testingtdsdesk.anshulggrg.workers.dev` (other branches, while preview builds are on)

Every push to `main` deploys, the same as GitHub Pages does now. That includes `app/publish-preview.sh` (it commits
`review/`), the uptime job (it commits `status/status.json`) and the "Roll back the app" workflow. None of these need to change.

**Only the built site is served, never the whole repository.** With no settings, Cloudflare uploads every file in the
repository root. That would put `connector/signing-key.enc` (the encrypted update-signing key), `server/`, `src/`,
`tests/`, `docs/`, the source maps and `.github/` on the web, which GitHub Pages also does today. Four files on `main` stop this:

| File (at main's root) | What it does |
| --- | --- |
| `wrangler.jsonc` | Tells `wrangler deploy` to run `cloudflare/build-site.sh` first, then serve **only `cf-site/`**. Also sets `html_handling: auto-trailing-slash` and `not_found_handling: 404-page`. |
| `cloudflare/build-site.sh` | Copies an **allow-list** into `cf-site/`: `index.html`, `404.html`, `_headers`, `_redirects`, `.well-known/security.txt`, `status/`, `assets/` (the 1.x bridges' update files), `welcome/`, and every top-level folder holding `legacy.js` and `guard.js` (a `publish-preview.sh` build: `review/`, `react/`), without `*.map` and `README.txt`. A new folder on main is never public unless this script names it. The script stops the deploy if a file is over 25 MiB. |
| `_headers` | The response headers (below). Cloudflare reads it and does not serve it. GitHub Pages ignores it. |
| `404.html` | The not-found page. Without it, every missing address would get the root page with status 200. |

Also add `cf-site/` to `.gitignore`.

`publish-preview.sh` keeps working unchanged: it commits `<folder>/` to main, and the next deploy copies that folder
because it holds `legacy.js` and `guard.js`. The uptime job's `status/` and the bridges' `review/assets/bridge-go/` are
copied too.

### What is served (checked on 26-Oct with `wrangler deploy --dry-run` and `wrangler dev` on a copy of main)

189 files, 72 MB: `index.html`, `404.html`, `.well-known/security.txt`, `status/` (2), `assets/` (13: `connector/latest.json`,
`.sig`, `FinComConnector.exe`, `TDSBridge.ps1`, `bridge-setup.txt`/`.sha256`, pdf/tesseract/xlsx files), `welcome/` (20),
`review/` (130, without `legacy.js.map`), `react/` (20). Every address outside these answers 404, including `/connector/signing-key.enc`,
`/server/`, `/docs/`, `/tests/`, `/README.md`, `/CNAME`, `/build.py`, `/.github/` and `/review/legacy.js.map`.

### Files over 25 MiB

There are none. The largest published files are `review/assets/bridge-go/FinComBridge-2.4.7.exe` (10.8 MiB),
`review/assets/mediapipe/vision_wasm_internal.wasm` (10.6 MiB), `review/legacy.js.map` (4.9 MiB, not served) and
`FinComBridge-Setup-2.4.7.exe` (3.7 MiB). The old setups in `assets-test/bridge-go-old/` are on `staging-next` only and
are never published. If a bridge build ever passes 25 MiB, the deploy stops with the file's name. That file then goes to
an R2 bucket with a public custom domain (for example `downloads.fincom.live`), or to a GitHub Release (only while the
repository is public), and `latest.json` points at that address.

### Source maps

`legacy.js.map` is not served any more. Sentry can then no longer fetch it to show readable stack traces for
`legacy.js`. To keep readable traces, upload the map to Sentry at publish time (`sentry-cli sourcemaps upload`) instead
of serving it.

## The response headers (`_headers`)

| Header | Value and why |
| --- | --- |
| `Permissions-Policy` | `camera`, `microphone`, `display-capture` (screen share), `fullscreen`, `autoplay`, `clipboard-write`, `picture-in-picture` allowed for the site itself (meetings, subtitles, copy buttons). `geolocation`, `payment`, `usb`, `serial`, `hid`, `midi`, sensors, `screen-wake-lock`, `xr-spatial-tracking`, `idle-detection`, `local-fonts`, `window-management`, `encrypted-media`, `publickey-credentials-get`, `otp-credentials` and `browsing-topics` are off. The old file had `microphone=()`, which would have broken meetings. `bluetooth` and `ambient-light-sensor` were removed because Chromium warns about them as unrecognised features. |
| `X-Content-Type-Options` | `nosniff` |
| `Referrer-Policy` | `strict-origin-when-cross-origin`. The app's own `<meta name="referrer" content="no-referrer">` still applies inside the app, so the app sends no referrer at all. |
| `X-Frame-Options` / `frame-ancestors` | `DENY` / `'none'` on every address. No FinCom page is meant to be framed by another site. The guest page is `#/join/…` inside the app, and `remote-help.html` opens as its own page. The app's own frames (the print frame in Notes, the bill viewer, the cash-basis MIS) are `blob:` or `srcdoc` frames, which `frame-ancestors` does not affect. Tested. |
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains`, with no `preload`. |
| `Cross-Origin-Opener-Policy` | `same-origin`. The app's pop-ups (print, PDF export) are same-origin `about:blank` windows. Links to WhatsApp, the GST portal and signed downloads use `noopener`. |
| `Content-Security-Policy` on `/review/*` | **Enforced.** It mirrors the policy the build already writes into `index.html` as a `<meta>` (`app/vite.config.js`, `csp()`), which has run on staging since stability batch 2. On top of that it adds `frame-ancestors 'none'` and `report-uri` (violations go to Sentry's security endpoint). The browser enforces both policies. The `<meta>` allows the one inline boot script by its hash, which changes with every build, so the header has to allow `'unsafe-inline'` scripts and leaves it to the `<meta>` to narrow that. The header also covers what the `<meta>` cannot: the service worker, the PDF module worker and other worker scripts, which take their CSP from their own response headers. Hosts: `https://*.supabase.co` and `wss://*.supabase.co` (API, Realtime), `http://127.0.0.1:*` and `http://localhost:*` (FinCom Bridge), and Sentry's ingest host. Also `blob:` and `data:` for workers, media, images and frames, and `'wasm-unsafe-eval'` for MediaPipe, pdf.js and Tesseract. Groq and Cloudflare Realtime are reached only through FinCom's edge functions; TURN/ICE is not governed by CSP. No fonts or scripts load from a CDN. |
| `Content-Security-Policy` elsewhere | `frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'` only. The root redirect, `welcome/` and `react/` keep their own `<meta>` policies (`welcome/` uses Google Fonts). |
| `Cache-Control` | `review/assets/*`: `public, max-age=31536000, immutable` (file names carry a content hash). The `review/assets` files whose names stay the same across builds (`mediapipe/`, `call-bg/`, `exceljs.min.js`, `docx.iife.js`, `xlsx.js`, `pdf.*`, `tess-*`, `sample-*`, `*.txt`): one day. `no-cache` (asked again every time, 304 when unchanged): `/`, `/review/`, `sw.js`, `build.json`, `legacy.js`, `guard.js`, `oldcheck.js`, `review/assets/bridge-go/*` (the bridge's `latest.json`), `review/assets/connector/*`, `bridge-setup*`, `status/status.json`, and the 1.x bridges' `assets/connector/*`. Everything else gets Cloudflare's default, `public, max-age=0, must-revalidate`. |

How the rules combine: every matching rule applies, in file order. A header set twice is joined with a comma, so a
narrower rule first removes the header (`! Name`) and then sets its own. `wrangler dev` (Miniflare) behaved exactly this way.

One side effect: a missing file under `review/assets/` answers 404 with the one-year cache header, because `_headers`
cannot match on status. Deploys of a Worker switch all files at once, so the app never asks for a hashed file that is
not there yet.

### How it was tested (26-Oct-2026)

1. `tests/cf_pages.py wrap <test>` runs one of the app's own tests with these rules added to every answer, as for the
   file under `/review/`. Every page and worker reports CSP and Permissions-Policy console messages. All of the following were run
   on the published build (main's `review/` at 4c3cea5e7). Results:
   - `run_signin_session.py` (sign-in, session, sign-out): passed
   - `run_react_home.py`: passed
   - `run_react_bank.py` (Bank page): passed
   - `run_react_bill.py`: passed
   - `run_tds_excel.py` (TDS Excel download and upload, checked in LibreOffice): passed
   - `run_boot_watch.py`: passed
   - `run_chunk_heal.py`: passed
   - `run_call_lobby.py` (lobby, camera, microphone): passed
   - `run_calls_meet_ui.py` (meetings, guests, live subtitles): passed
   - `run_video_calls_ui.py` (MediaPipe blur: wasm and worker, screen share, recording): passed
   - `run_react_collect.py`: passed
   - `run_safari_compat.py`: passed
   - `run_react_tds.py`: fails at the same step **without** any headers. The test and this build do not match; this is not caused by the headers.

   Violations: only the two Permissions-Policy warnings above, now fixed. **No CSP violation.** A deliberately narrow
   policy (`CF_HEADERS=…`) produced dozens of `[csp]` lines, which shows the watcher catches them.
2. `tests/run_cf_pages.py DIR` checks the site as a whole. It ran against `wrangler dev` serving the folder
   `cloudflare/build-site.sh` made from a copy of main (`CF_URL=http://127.0.0.1:8790`). It checked the headers, the
   cache rules, the redirects (`/` → `/review/` keeping the `#route`, `/review` → `/review/`,
   `remote-help.html` → `remote-help`), `security.txt`, the 404 page, the addresses that must not be served, the app
   with no CSP message, the service worker taking `/review/`, the page's fetch of `assets/bridge-go/latest.json`, a
   `blob:` print frame, and that another origin cannot frame the app. All passed.
3. pdf.js with its module worker, and ExcelJS writing an `.xlsx`, both ran under the header with no CSP message.

To check again after changing `_headers`:

```sh
git archive origin/main | tar -x -C /tmp/cfmain      # plus the new _headers, 404.html, wrangler.jsonc, cloudflare/
cd /tmp/cfmain && npx wrangler@4 dev --port 8790     # runs cloudflare/build-site.sh, serves cf-site/ as Cloudflare does
CF_URL=http://127.0.0.1:8790 python3 tests/run_cf_pages.py /tmp/cfmain/cf-site
TDSDESK_SITE=/tmp/cfmain/review python3 tests/cf_pages.py wrap tests/run_calls_meet_ui.py
```

## Putting it on main (for review; nobody has pushed to main)

These files are on the branch `next-cf-pages`, at the root, exactly as they go to main. On a fresh checkout of main:

```sh
git fetch origin main next-cf-pages && git switch -c cf-main origin/main
git checkout origin/next-cf-pages -- _headers 404.html wrangler.jsonc cloudflare/build-site.sh
printf '\n# what Cloudflare serves, made by cloudflare/build-site.sh at deploy time\ncf-site/\n' >> .gitignore
git add -A _headers 404.html wrangler.jsonc cloudflare .gitignore
git commit -m "Cloudflare: serve only the built site (allow-list), headers for meetings, a 404 page"
git push origin cf-main:main      # the owner, after review
```

That is one commit touching only main's root and `cloudflare/`. `publish-preview.sh` and the uptime job only change
`review/` and `status/`, so they do not conflict with it. GitHub Pages ignores `_headers`, `wrangler.jsonc` and
`cloudflare/`. `404.html` is also used by GitHub Pages, as its 404 page, which is fine.

## The owner's clicks

### 1. Check the Worker's build settings

dash.cloudflare.com → **Workers & Pages** → `testingtdsdesk` → **Settings** → **Build**:

- **Git repository**: caanshulgarg/testingtdsdesk. **Production branch**: `main`.
- **Build command**: empty. `wrangler.jsonc` runs `cloudflare/build-site.sh` itself.
- **Deploy command**: `npx wrangler deploy` (the default).
- **Root directory**: `/` (empty).
- **Builds for non-production branches**: turn this **off**. Otherwise every push to `staging-next` and the other
  branches makes a public preview. `wrangler.jsonc` also sets `"preview_urls": false`.

The Worker's name must stay `testingtdsdesk`, the same as `"name"` in `wrangler.jsonc`, or the build stops.

After the commit above reaches main, open **Deployments**. The newest build log shows
`[custom build] Running: sh cloudflare/build-site.sh` and `cf-site: … files`. Until then, the workers.dev address
serves the **whole repository**, as GitHub Pages does today.

### 2. Test on the workers.dev address

Open `https://testingtdsdesk.anshulggrg.workers.dev/` in a normal and a private window:

1. It moves on to `/review/` and the sign-in page shows. Press F12 → Console: there is no red "Content Security Policy" line.
2. F12 → Network → click the `review/` document → Response Headers: `content-security-policy`, `permissions-policy`
   (with `microphone=(self)`), `strict-transport-security`, `x-frame-options: DENY`, `cache-control: no-cache`.
3. `…/review/assets/bridge-go/latest.json` shows the bridge's version and has `cache-control: no-cache`.
4. `…/status/` shows the status page. `…/.well-known/security.txt` shows the text.
5. `…/connector/signing-key.enc`, `…/server/`, `…/docs/`, `…/review/legacy.js.map` and `…/README.md` all show
   "This page is not here" (404).
6. F12 → Application → Service workers: `sw.js` is active for `/review/`.

The same checks from a terminal:

```sh
curl -sI https://testingtdsdesk.anshulggrg.workers.dev/review/ | grep -iE 'content-security|permissions|cache-control|strict'
curl -s -o /dev/null -w '%{http_code}\n' https://testingtdsdesk.anshulggrg.workers.dev/connector/signing-key.enc   # 404
```

**What does not work on the workers.dev address.** FinCom's servers and the bridge trust only FinCom's own
addresses, and `*.workers.dev` is not one of them:

- the edge functions that check the caller's site refuse it (admin, signin, the assistant, transcription, calls,
  bill reading through the gateway)
- the bridge refuses to pair
- Sentry stays off (it starts on `staging.fincom.live` only)
- invite and reset links point at staging.fincom.live

Sign-in through Supabase Auth itself works. Test the full app after step 3, on `staging.fincom.live`. To test the
full app on workers.dev first, add `https://testingtdsdesk.anshulggrg.workers.dev` to the `ALLOWED_ORIGINS` secret of
the edge functions (Supabase → Edge Functions → Secrets) for the test, and remove it afterwards.

### 3. Move staging.fincom.live to the Worker

This needs the `fincom.live` zone to be on the same Cloudflare account. Check under dash.cloudflare.com →
**Websites**. If fincom.live's nameservers are elsewhere, move the zone to Cloudflare first (Add a site → fincom.live →
change the nameservers at the registrar), or keep GitHub Pages until then.

1. **DNS** → fincom.live → find the record `staging`. Today it is a `CNAME` to `caanshulgarg.github.io`. Note it down, then delete it.
2. **Workers & Pages** → `testingtdsdesk` → **Settings** → **Domains & Routes** → **Add** → **Custom domain** →
   `staging.fincom.live` → **Add domain**. Cloudflare creates the DNS record and the certificate within a few minutes.
3. Open `https://staging.fincom.live/review/`, repeat the checks of step 2, then sign in, open a client, start a
   meeting with camera and microphone, and pair a bridge.

The site's origin stays `https://staging.fincom.live`. The origin lists that trust it (below) keep working unchanged,
and so do the bridges' update address and the meeting links.

### 4. The way back to GitHub Pages

1. Workers & Pages → `testingtdsdesk` → Settings → Domains & Routes → remove `staging.fincom.live`.
2. DNS → add `CNAME staging → caanshulgarg.github.io`, **DNS only** (grey cloud).
3. GitHub → the repository → Settings → Pages → Source: `main` / root. Custom domain: `staging.fincom.live`. Tick Enforce HTTPS.
   Main still holds the `CNAME` file. GitHub Pages ignores `wrangler.jsonc`, `_headers` and `cloudflare/`.

This works only while the repository is public, or on a paid GitHub plan (Pages from a private repository needs GitHub
Pro or Team).

## When the repository goes private

- **Cloudflare keeps deploying.** The Cloudflare Workers and Pages GitHub app has access to the repository through its installation
  (GitHub → Settings → Applications → Cloudflare Workers and Pages → Repository access). Check that it lists
  `testingtdsdesk`, or "All repositories".
- **Move the DNS first.** GitHub Pages stops serving a private repository on the free plan, so do step 3 before making it private.
- **The uptime job runs every 5 minutes.** For a private repository, GitHub Free includes 2,000 Actions minutes a month,
  and each run counts at least one minute: about 8,600 minutes a month. Before going private, slow it to every 30
  minutes, or move the check to a Cloudflare Worker cron. Its `pages/builds` API call (and the rollback workflow's) can go.
- **Edge functions that import from GitHub.** `fincom-assistant`, `fincom-transcribe` and `mis-run` have a one-line
  `index.ts` that imports their code from GitHub at a pinned commit (`server/_shared/README.md`). Once private, the
  next deploy of these functions cannot fetch that code. Deploy them from the files instead, or check whether a
  deployed bundle keeps working, before going private.
- **`.well-known/security.txt`** and `welcome/security.html` point at GitHub private advisories and a policy file on
  GitHub. Both stop working once private. Replace them with a `mailto:` address chosen by the owner.
- `app/src/screens/gst/BrowserHelper.jsx` links to a how-to on GitHub (branch `next-gst-browser`). It will 404 for users.
- `server/support-mail` defaults `APP_URL` to `https://caanshulgarg.github.io/testingtdsdesk/`. Set its `APP_URL`
  secret to `https://staging.fincom.live/review/`.

## Where FinCom trusts its own addresses (do not change yet)

A move to Cloudflare under the **same name** (`staging.fincom.live`) needs none of these to change. A new address
(the workers.dev one, or a future name) must be added to each list:

| Where | What |
| --- | --- |
| `server/_shared/cors.ts` `ALLOWED_ORIGINS`, plus each function's `ALLOWED_ORIGINS` secret | The sites allowed to call the edge functions from a browser: `caanshulgarg.github.io`, `staging.fincom.live`, `app.fincom.live`, `fincom.live`. Functions marked `*` in `server/_shared/README.md` accept any site. |
| `server/security/functions/admin/index.ts` `safeRedirect` | Invite and reset links may only point at `staging.fincom.live/`, `app.fincom.live/`, `caanshulgarg.github.io/` or `APP_URL`. |
| `server/security/functions/signin` | Has its own copy of the list (`cors.ts` there). |
| Supabase → Authentication → URL Configuration | Site URL and Redirect URLs (in the dashboard, not in the repository). They must include the address the app runs on, for invite, recovery and magic links. |
| `bridge-go/config.go` `AllowedOrigins`, `bridge-go/pairopen.go` `fincomSites` | The pages the Go bridge talks to and pairs with: `app.fincom.live`, `staging.fincom.live`, `caanshulgarg.github.io` (and `fincom.live` for pairing). Already-installed bridges keep their own list until they update. |
| `assets/connector/TDSBridge.ps1` (`AllowedOrigins`, line 63 and 824) | The same for the 1.x PowerShell bridge. |
| `connector/Core.cs` `UpdateHosts`, `DefaultUpdateUrl` | The 1.x connector updates only from `staging.fincom.live` / `app.fincom.live` / `fincom.live`, from `/assets/connector/latest.json`. That is why `assets/` stays public. |
| `bridge-go/mode.go`, `win_tray.go`, `build.sh`, `installer/FinComBridge.nsi` | The address the bridge opens and updates from (`https://staging.fincom.live/review/`, `…/review/assets/bridge-go/latest.json`). |
| `app/src/sentry.js` `STAGING_HOSTS` | Sentry starts only on `staging.fincom.live`. |
| `server/support-mail` `APP_URL` default | `caanshulgarg.github.io/testingtdsdesk/` (see above). |

## Notes

- `CNAME` and `.nojekyll` mean nothing to Cloudflare and are not served. They stay on main for the way back.
- Cloudflare limits: 25 MiB per file, and 20,000 files per version on the free plan. The site has 189.
- Each push to main is one build, about a minute. The uptime job's hourly `status/` commit makes about 24 builds a day,
  well inside the free plan's 3,000 build minutes a month.
- The app's "What is FinCom?" link on the sign-in page is `welcome/` relative to `/review/`. It leads to
  `/review/welcome/`, which does not exist. This is an older bug, the same on GitHub Pages: the link should be `/welcome/`.
