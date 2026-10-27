# FinCom never opens blank

## What happened on 27-Oct-2026

After the speed build (ab699ab25) was published at staging.fincom.live/review/, the owner got a white page on Safari 26.
Nothing reached Sentry. That build's service worker installed from what the browser already held (fetch with cache
"only-if-cached"). In Safari such a fetch fails at once for a file that is still downloading, so the install ended in a
few milliseconds. Then skipWaiting() and clients.claim() put the new worker in charge while the new build's first page
was still loading through the previous worker. Safari stops a worker that is replaced, and the requests it was answering
for the page never finished: guard.js and the styles, which hold up the page's drawing and all its scripts. No script ran,
so neither the "did not open" note nor Sentry saw it. Chromium waits for the old worker's requests, so it never showed
there.

## The new build's worker waits

A new build's worker no longer takes over by itself while a FinCom page is open. It waits until a page of its own build
has drawn FinCom and asks (`fincom:take-over` with the build id, `app/src/main.jsx`), or until no FinCom page is open.
The first worker on a computer still starts at once. guard.js and oldcheck.js come from the worker's copy at once, and the
line is asked meanwhile (they held up the page for 3 s and 28 s on office Wi-Fi). Test: `tests/run_sw_webkit.js` runs the
built sw.js as Safari treats it; it fails on ab699ab25.

## The page heals itself

`app/index.html` carries a little script of its own (`fincom-heal`) that runs before anything else and needs nothing else.
It acts when any of these happens:

- the page has not been read to its end 4 s after opening (a file in its head held up; 12 s without a service worker);
- FinCom has not drawn 4 s after all its files came (8 s for the worker's kept copy of the page);
- guard.js finds that the program or the app's first file did not load.

Then it:

1. reports it to Sentry by its own beacon ("FinCom healed itself: <reason>"), on the testing site;
2. unregisters FinCom's service worker for this folder and deletes its caches;
3. opens the previous good build named by `last-good.json` in the same folder, `{"build": "<id>", "path": "../review-prev/", …}`
   (written by `app/promote-next.sh` and by `./publish-preview.sh review`, which keep that build at `review-prev/`:
   docs/RELEASE-FLOW.md; the other fields, `commit`, `stamp`, `how`, are for `app/rollback-review.sh`),
   and says "FinCom updated; opened the last working version". Without that file, or when it names this same build, it
   reloads once from the network.

It does this once per build in a tab. If the page still cannot open, the "FinCom did not open" note comes, with its
"Reload FinCom" button. Writing `last-good.json` and keeping the previous build belong to the publishing step
(`app/release-lib.sh`; checked by `tests/run_release_flow.py`). Test:
`tests/run_self_heal.py` (the upgrade path old worker -> new build -> reload twice, rolling back, a broken build, a page
held up in its head, and no pointer).
