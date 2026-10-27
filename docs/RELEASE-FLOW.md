# Release flow: try at /next/, promote to /review/, roll back

On 27-Oct-2026 a speed build went straight to staging.fincom.live/review/ and showed a blank page on Safari, so it had to
be rolled back by hand. The owner wants FinCom to be "stable like the Claude app". Since then, a new build goes to a
trial address first. It goes live only after it has been tried there, and the exact files that were tried are what go
live. Going back is one command.

| Address | Folder on `main` | What it is |
|---|---|---|
| staging.fincom.live/review/ | `review/` | the build people use |
| staging.fincom.live/next/   | `next/`   | the next build, on trial; its strip says **TRIAL** |

Both addresses use the staging database, the same Supabase project as before. The scripts are in `app/` and are run
from there. Each script changes exactly one folder on `main` in one commit, then pushes `main`. It refuses if anything
else would change. `DRY=1` in front of any of them commits locally, shows the change, and pushes nothing.

## 1. Publish to next/

```
cd app
./publish-preview.sh next "REVIEW BUILD – Phase 2"
```

This builds the branch checked out here, the same test build as `review/`. It puts the build in `next/` on `main` and
pushes. `review/` is not touched. The banner is the one the build will show once it is live at `/review/`. At `/next/`
the same files show `TRIAL · <banner> · a new build on trial …` in red, and TRIAL under the logo.

## 2. Check it at /next/

Use the computers and browsers the owner uses, Mac Safari included.

1. **A fresh open.** Use a private window, or a browser that has never opened `/next/`. Open staging.fincom.live/next/:
   - the TRIAL strip shows;
   - sign in;
   - open a client, and the pages changed in this build.
2. **The update-and-reload path.** This is what everyone at `/review/` will go through after the promote, and it is
   where the 27-Oct build failed.
   1. Have the **old** build open. If `next/` held an earlier trial, leave that tab open. Otherwise open `/review/` in
      one tab and, before step 2, also open `/next/` once while it still has the previous trial build.
   2. Publish the new build to `next/` (step 1).
   3. In the tab already open on `/next/`, wait about a minute, then **reload, and reload again**.
   4. The page opens on the new build: the stamp at the foot of the sidebar shows the new commit. It is not blank,
      there is no "FinCom did not open", and it does not loop.
   5. Do this in Safari too.
3. **/review/ untouched.** A tab open on `/review/` while all this happens is not reloaded, and gets no "new version"
   bar. It is still the old build.

If anything is wrong, fix it and publish to `next/` again. `/review/` never saw the problem.

What the two addresses share and do not share:

- **Not shared.** Each address has its own service worker, scoped to `/next/` or `/review/`, and its own caches:
  `fincom-shell:/next/:<build>` and `fincom-files:/next/` against `fincom-shell:/review/:<build>` and
  `fincom-files:/review/`. A worker, the chunk heal (`src/staleChunk.js`) and sign-out (`src/js/27`) each clear only
  their own address's caches.
- **Shared.** The browser's storage is per site, not per folder. So `/next/` has the same sign-in and the same work
  kept in this browser as `/review/`, exactly like a second tab of `/review/`. Signing out in one signs out the other.
- **Private window for storage changes.** A trial build that changes how work is kept in the browser (a new
  IndexedDB version, a new localStorage format) is tried in a private window, so the `/review/` copy is not changed
  before the build is promoted.

## 3. Promote

```
cd app
./promote-next.sh
```

This copies the files of `next/` on `main` to `review/`, byte for byte, with no rebuild. What was tried is what goes
live: the test checks the two folders have the same git blobs. Nothing needs rewriting:

- **Base path.** The build asks for every file by a `./` address (Vite `base: "./"`, checked by publish and by promote),
  so it works in any folder.
- **Service worker.** It is registered as `./sw.js` with scope `./`. It takes its scope and its cache names from the
  address it is served at, so at `/review/` the same `sw.js` uses `/review/`'s caches.
- **TRIAL strip.** Only the strip depends on the address. The page's first script marks a page served from `/next/`
  (`data-trial`), and the build's CSS shows TRIAL only there.

The script **refuses** in these cases:

- `next/` holds no complete build;
- `next/` holds the build `review/` already has;
- `next/` holds an **older** build than `review/`, by the time in the build id in `build.json`.

It writes `review/last-good.json`, naming the build that was live until now and the `main` commit that holds it, and
keeps that build's files at `review-prev/` (served at staging.fincom.live/review-prev/). The pointer carries
`"path": "../review-prev/"`, which is what the page's own healer opens when a new build cannot draw
(docs/NEVER-BLANK.md). So a promote changes `review/` and `review-prev/` on `main`, nothing else. People
with `/review/` open get the new build like any publish: the page loads it by itself, or says "A new version of FinCom
is ready · Reload".

After promoting, `next/` still holds the same build, which does no harm. Publish the next build there when it is ready.

## 4. Roll back

```
cd app
./rollback-review.sh
```

This puts `review/` back exactly as it was in the commit named by `review/last-good.json`, which is the build before.
`review-prev/` is put back as in that same commit too (removed when that commit had none), so the pointer and the
folder always agree.
Since that older `review/` has its own `last-good.json`, running it again goes one more build back. `next/` is not
touched.

- **No `last-good.json`.** A `review/` published before this flow has none. The script then lists the recent builds of
  `review/` and asks for one: `./rollback-review.sh <commit of main>`.
- **Writes the pointer too.** A publish straight to `review/` (`./publish-preview.sh review "…"`, for an urgent fix
  only) also writes `last-good.json`, so it can be rolled back the same way.

## Cloudflare

`cloudflare/build-site.sh` on `main` already serves every top-level folder that holds a build (`legacy.js` and
`guard.js`), so it serves `next/` with no change. Like `review/`, its source maps are left out.

`_headers` on `main` needs a `/next/` twin and a `/review-prev/` twin of every `/review/` rule: the same CSP, the same cache rules, and `no-cache`
on the page, `sw.js` and `build.json`. `cloudflare/_headers.main` in this repository is main's `_headers` with those
rules added, 71 rules where Cloudflare allows 100. It goes to `main`'s root by hand: copy it over `_headers` there.

## Tests

- `python3 tests/run_release_flow.py` runs the three scripts against a made-up `main`, in a temporary git repository,
  never the real one. It checks:
  - `next/` and `review/` coexist;
  - promote makes `review/` exactly what was tried;
  - promoting again or promoting an older build is refused;
  - rollback restores the previous `review/`, twice in a row;
  - `last-good.json` has the fields the healer reads (`build`, `path`), and `review-prev/` holds that build;
  - `DRY=1` pushes nothing.
- `flock /tmp/fincom-app.lock python3 tests/run_trial_address.py` serves `app/dist-test` at `/review/` and at `/next/`,
  with `cloudflare/_headers.main` applied (`tests/cf_pages.py`). It checks:
  - both addresses open;
  - each has its own worker and caches;
  - TRIAL shows at `/next/` only;
  - a new build at `/next/`, reloaded twice, never touches a `/review/` tab;
  - the promoted files run at `/review/`;
  - `/next/` gets the same headers as `/review/`.
