# The Tally page: a complete study (04-Nov-2026, next-tally-table)

The owner, on build mw1uewq4-6a2306 (2827a1820): "its still in problem.. now the table is not showing... can you pls study
it completely.. this tally link is the basic page that should work seamlessly". Sentry FINCOM-APP-STAGING-G ("Page
blocked", the hang reporter of 35a2936d5) had 16 events by 11:53 UTC. This page is everything the Tally page reads, every
timer and probe it runs, every way it is drawn, and every way it can show nothing or hold the browser; then what was
measured, what was wrong, and what changed. Every name below is made up.

## 1. What the evidence says

### 1.1 "Page blocked": none of the 16 events was the page blocking

| Browser | Page | where | ms | When |
|---|---|---|---|---|
| Windows, Chrome 156 (the shared server) | home/tally | stall | 6,109 | 09:37:54 |
| same | home/tally | heartbeat | 7,990 | 09:39:41 |
| same | home/tally | stall | 54,103-58,222 | 09:49, 09:59, 10:09, 10:19, 10:29 (every 10 minutes) |
| Mac, Chrome 152 | home/today | stall | 233,586 and 1,033,506 | 09:13-10:47 |
| Mac, Safari 26.6 | home/today | heartbeat / stall | 4,669 ... 474,188 | 11:11-11:53, every 10 minutes |

The cloud's request log for the shared server's browser (one Chrome 156 on Windows) settles it:

- 09:04-09:36: 15-36 requests a minute (the Tally page's beats, summary, checks, books).
- from 09:37: 1-3 a minute. The page reads nothing by itself while the tab is hidden (`pollOk`), so the tab went to the
  background at about 09:36-09:37: a minimised or covered remote-desktop window counts as hidden.
- The two short events (6.1 s, 8.0 s) came in the first two minutes after that; the 55-58 s ones every 10 minutes after.
- The last click before them was at 09:08:35, half an hour earlier. While the tab was in use and seen (09:06-09:36) there
  was no report at all.

Why a hidden tab looked like a hang to the reporter (app/src/hangWatch.js as of 35a2936d5):

- Chrome holds back a hidden tab's timers: at first by a CPU budget (a tab that worked a little waits seconds for its next
  timer), after 5 minutes hidden to once a minute. The page's 1 s heartbeat then came 6-8 s late ("heartbeat 7,990").
- The worker that watches the page is not held back the same way: it counted 6 s, then 55 s, without a word from the page
  ("stall 6,109", "stall 55,133"); its one report per 10 minutes made the 10-minute rhythm.
- On the Macs the computer slept: the worker's own clock jumped 4-17 minutes ("stall 1,033,506").
- No event had any attribution: the frames observer only sees frames over 2 s, which never happened.

So the answer to "what blocked for 6-8 s on home/tally" is: nothing in the page. A background tab's timers were held back
by Chrome, and the reporter counted that as a block.

### 1.2 "The table is not showing"

No render error reached Sentry from this build (a failing part of the page shows "This part of the page could not be shown"
and is reported). Locally, with made-up copies of staging's data, the live build drew the table every time, in every case
of section 4 (this login's 2.5.3 bridge, none, a port that hangs, only old bridges, everything hanging, a slow cloud, the
browser's Local Network Access check on, the bridge remembered, a paired browser), and with the cloud's real answers of the
Tally page's functions (section 2). The ways the page can show no table, or a table that looks empty, are listed in section
5. Three of them are real and are fixed (5.2, 5.3, 5.4); one thing seen on the shared server is not explained (5.8).

## 2. Every data source the page reads

The page is `screens/Tally.jsx` (TallyHome) drawing `parts/TallySimple.jsx` above For support (closed). Its rows are made
in `lib/tallySimple.js` (`tableRows`, since this change `rowsFor`).

| What | Where it comes from | How often | Used for |
|---|---|---|---|
| The firm's clients | `S.companies`, from FinCom's cloud (`cloudSync`: `clients`, `records` since the last read) and this browser's own copy | first sync on open, then every 45 s while seen | one row per live client |
| The firm's Tally companies and links | `TLight.st.cos` (`tally_companies`), else `TCloud.pane.companies` | every 5 min (TLight's slow read), at once after a link | Connected to Tally?, the company rows, the strip |
| The computers and their beats | `TLight.st.devs` (`tally_devices`, the beat `info.beat`, `info.bridges`) | every 30 s while seen | Open in Tally right now? (from the beat), the computers line |
| The Tally page's own reads | `TCloud.refreshPane`: about 15 reads one after another (devices, trial tools, recorder source, bridge prefs, member links, bridge alerts, companies, removed clients, read stops, releases, rollbacks, sync cursors, books, self-checks) | on opening the page, every 5 min while seen (`GuideRefresh` asks every 30 s, the pane answers every 5 min), and on Check Tally now | the header's readiness, the guided box, For support |
| Each linked client's books | `TCloud.status(cid)` (`tally_status`), `booksLoad` | up to 25 at once, each kept 5 min | Ledgers received?, All entries received? |
| Each linked client's ledger count | `cloudLedgerCount` (`tally_ledgers`, counted) | each kept 5 min, asked at most once a minute | "2,455 ledgers" |
| The firm's summary | `tally_fetch_summary` (TallyFetch `SUM`) | every 30 s while seen | entries being brought, Check Tally now |
| The checks | `tally_check_ask_status` (TallyFetch `ASK`) | every 30 s, 10 s while one runs | "FinCom is checking them with Tally now", missing days being brought |
| Held lines | `tally_held_status` (HeldBlock `HS`), `AlertHub` over `tally_recorder_lines` | every 20 s while shown | All entries received? No, Upload Day Book |
| Opening balances | `tally_openings_decide` status (migration 138, `OPEN`) | every 5 min, at once after a choice | the line under Ledgers received?, its filter |
| The link records | `LinkRec` (`tally_links`, `tally_link_places`) | with the companies | names that changed in Tally, the same company under two names |
| This browser's bridge | `Bridge.st` (this browser's paired bridge, `/status`) | every 30 s while paired (`useLocalRead`) | Open in Tally right now? from here |
| This login's bridge | the look on 127.0.0.1 (`LOCALB`, `/ping`) | once per tab (`lookOnce`), again on Connect / I have opened it | which bridge is this Windows login's (sameSession) |
| The bridge found here before | `localStorage` `…ownbridge` | read at each drawing | "Shown: what that bridge last sent to FinCom's cloud" |
| The setup | `assets/bridge-go/latest.json` | once per page open | Download FinCom Bridge, the old-bridge words |
| The page's own state | `S.tsm` (search, filter, steps open), `S.tallyGuide`, `S.tallyFocus`, `S.tcoSync` (a first sync) | — | the filters, the guided box, the marked row, "Coming in now" |

## 3. Every timer and probe

| What | Interval | Waits | Notes |
|---|---|---|---|
| `GuideRefresh` → `TCloud.paneTick` | 30 s, only while the page is shown and nobody types | — | the pane itself reads every 5 min (`SLOW_MS`) |
| `TLight.refresh` | 25-30 s while seen | — | called from `tallyLinkOf`, i.e. from every row of every drawing (it returns at once when not due) |
| `cloudSync` | 45 s while seen | — | the clients and records |
| TallyFetch summary and checks | 30 s (10 s while a check runs) | — | each answer drew the page |
| `HeldBlock` | 20 s | — | draws only when its answer changed |
| `syncPoll` in a row | 10 s while that client's first sync runs | — | |
| The look on 127.0.0.1 (`look`) | once per tab | 900 ms each port, all at once: 9100-9110, 9103, and the beats' bridge ports | since this change: a 5 s watchdog, and an error in its last step can no longer leave it "busy" |
| `lookHere` (For support's card, `useHereProbe`) | every 2 min when this browser is not paired | 2.5 s each, all 100 ports 9100-9199 | asynchronous; its answer is drawn with the next drawing (this change) |
| `useLocalRead` (`Bridge.refresh`) | every 30 s when paired | 15 s | |
| `useRefusedCheck` | every 2 min | — | |
| The hang reporter | 1 s heartbeat, 1 s worker | — | Sentry chunk only |

No probe gates the table: the rows never wait for 127.0.0.1. "Open in Tally right now?" says "Checking your FinCom Bridge…"
only while the first look runs (at most 900 ms, now never more than 5 s).

## 4. How the page is drawn, and what it cost

Every drawing of FinCom is one synchronous `render()`: the old pieces (`legacyRender`), then the whole React tree
(`flushSync`), then `padForBars` at the next frame. Anything may call it: a click, a cloud answer, a timer.

Measured on a local copy with made-up data in staging's shapes (12 clients, 20 companies, 5,272-5,308 ledgers, the 2,455-
ledger client, 684 lines from Tally, 8 computers, the member's link) and the cloud's real answers of `tally_fetch_summary`,
`tally_check_ask_status`, `tally_held_status` and `tally_openings_decide`, in Chromium at a 4x slower CPU (the busy shared
server), fake bridges on 127.0.0.1. Live = build mw1uewq4-6a2306; new = this change.

| At a 4x slower CPU | Live | New |
|---|---|---|
| One working-out of every row (`tableRows`), caches warm | 16-18 ms | 16-18 ms, but off the drawing |
| The same, first time on the page (caches cold) | 100-200 ms, inside the drawing | off the drawing, in 25 ms pieces |
| One drawing of the Tally page, settled | 47-57 ms | the rows are read, not worked out; the work: this login's bridge 0-1 ms, the companies 6-14 ms, then 12-26 ms pieces |
| The first drawing of the page (Today → Tally), real answers | 417-577 ms (one task) | 60-126 ms; every column filled 475-730 ms after opening |
| Every client's row after Today → Tally (`run_tally_table_first.py`, 5 bridge cases) | 108-245 ms | 60-126 ms |
| Every client's row, the page opened first (cold load) | 1.6-1.7 s after the start (the app's own start) | 1.5-2.0 s, and never "No client yet" while the clients come |
| Longest frame in the 40 s after Today → Tally (real answers) | 271-322 ms | 168-191 ms (none of its tasks over 170 ms) |
| Longest task on the page at 4x (`run_tally_table_first.py`) | 281 ms in 2 min, 15 tasks over 50 ms (139-281 ms over five runs) | 164-167 ms in 5 min, 12 tasks over 50 ms (two runs) |

What made the long blocks (CPU profiles, mapped to the source):

1. Each answer drew the whole app. A client's ledger count (`countLedgers` in TallySimple.jsx), the summary and the checks
   (TallyFetch `redraw`), the books (`booksLoad`), the opening balances, the look: each called `render()` itself. When
   several came in one task (they do: the cloud answers together), that was several full drawings in a row: 63% of a 577 ms
   task was `countLedgers`' drawings.
2. Every drawing worked out every row again (`tableRows` inside `SimpleTally`): with the held lines, the checks and the
   opening balances, `tallyLinkOf` (which also asks `TLight.refresh`), `heldFor`, `heldDays`, `needDays`, `companyRows` with
   `tallyCoState` for every company, the name rules for the alike clients: 100-200 ms the first time, 16 ms after.
3. `padForBars` read the computed style of every element of the page, at every drawing's next frame (twice or three times
   a frame when drawings came together): 40-80 ms a frame.
4. The app's own start (legacy.js and the first file, about 1.2 s at 4x) is the same for every page and is not the Tally
   page's.

## 5. Every way the page can show nothing, or hold the browser

| # | How | Before | Now |
|---|---|---|---|
| 5.1 | A part of the page throws while drawing | the whole Tally screen became "This part of the page could not be shown" (one Guard for the screen) | each part on its own: the header, the strip, the guided box and the computers line show nothing; the table shows every client and its Tally company (`PlainTable`); reported, tried again at the next drawing |
| 5.2 | One client's row throws (a state FinCom did not expect) | the whole table, and so the screen, was lost | that row shows its name and Tally company, the rest "—", "FinCom could not read this client's Tally state just now"; reported once |
| 5.3 | The clients are not read yet in this tab (a fresh browser profile: each Windows login has its own; a slow cloud; a failed first sync) | "No client yet." where the table should be, for as long as the read took (0.6-2.2 s locally with a slow cloud or a paired browser; on the shared server longer), for good when the read failed | "Reading your clients from FinCom's cloud…", or "FinCom's cloud did not answer (…). Your clients show here as soon as it does." |
| 5.4 | The look on 127.0.0.1 never finishes (an error in its last step; a browser that holds the request while it asks the person) | every row "Checking your FinCom Bridge…" for the rest of the tab | an error ends the look; after 5 s it counts as nothing found and the page says why |
| 5.5 | A filter or search left on | "No client matches." with Show all | the same (by design) |
| 5.6 | Signed out of the firm account (`TCloud.on()` false) | "Sign in to the firm account first" instead of the page | the same (by design) |
| 5.7 | The main thread held by the page's own work | 300-580 ms blocks at 4x, several a minute (section 4) | no task over 200 ms in 5 minutes at 4x (section 7) |
| 5.8 | Check Tally now sends nothing | on the shared server at 09:08 two presses sent no check (the cloud log has the page's refresh and the summary for each press, and no `tally_check_request`), i.e. that browser's table had no row connected to Tally with a book in the summary, though the firm has 7 links and their books | not reproduced with the same data (7 checks sent); kept open: the page now draws every row from the cloud's links even when the rest fails (5.1, 5.2), so the next report says which |
| 5.9 | A background tab reported as a hang | 16 false "Page blocked" | not reported (section 6) |

## 6. The hang reporter

Kept: a frame over 2 s, a heartbeat 3 s late, the worker's report while stuck 6 s, one incident per tab per 10 minutes,
code names only, the one scrubber. Changed:

- Only a page that is seen counts. The worker is told at once when the tab is hidden or shown and counts nothing while
  hidden; a heartbeat or a frame is reported only when the page was seen from its start to its end.
- A computer that slept is not a hang: the worker's own one-second clock coming over 3 s late starts it again and tells
  the page; the page's late heartbeat is not reported then, nor when the wall clock moved on more than the page's own (a
  Mac's stops while asleep), nor when it is over a minute (a page truly stuck that long is told by the worker while stuck).
- What ran: the long frames (over 150 ms) of the last minute are kept with their scripts; a late heartbeat sends the
  frames of its gap as the stack, the longest script as tag `script` (`Tally-Ab12.js:clientRow`), how many as `frames`.
- The last UI step: tag `last_ui` (the code name of the last click, as the breadcrumbs) and `ui_s` (seconds since); the
  worker's report carries them too. Tag `vis` (seen).
- The scrubber keeps exactly these shapes (`server/_shared/sentry-scrub.js`).

## 7. The change, and the numbers after it

- `lib/tallySimple.js`: `rowsFor` gives the drawing the rows last worked out (the first drawing: `quickRows`, each client
  with its Tally company, at once) and asks for them again; the work runs when the browser is free (`requestIdleCallback`),
  25 ms of clients at a time with a pause between, never while the tab is hidden, and draws the page again only when what
  it shows changed. The same rows as `tableRows()` (kept for the tests). A row that throws: `safeRow`. The look: an error
  ends it, a 5 s watchdog.
- `lib/soonDraw.js`: one drawing at the next frame for every answer that came; used by the ledger counts, the ledger
  changes, the books, the summary and checks, the opening balances, the look, and For support's background checks. A hidden
  tab draws nothing; it draws once when shown again.
- `lib/quietReads.js`: the page's own reads (summary, checks, held lines, opening balances) still start from the drawing,
  at its moment, as before; the rows' working-out starts none, so the page asks FinCom's cloud as often as before (5
  requests in 20 s on the Tally page, both builds). `tests/run_tally_poll.py`'s 2-minute budget is 21, the page's own
  cadences (it was 20 against 19 measured, where the first reads happened to fall late in the window).
- `src/js/63-alerts.js`: the bridge-identity alerts were read every 5 minutes from any drawing, also in a hidden tab
  (a first-link check draws on its own timer); now never from a hidden tab, as every other read.
- `parts/TallySimple.jsx`: each part drawn on its own (`Part`); the table's fallback `PlainTable`; "Reading your clients…".
- `src/js/01`: `padForBars` once a frame, and only for the elements that can be fixed (an element with an offsetParent never
  is): the same padding.
- `app/src/hangWatch.js`, `server/_shared/sentry-scrub.js`: section 6.
- Kept as they were: sameSession, the plain words of 2827a1820 (old bridge, another login, no bridge, the other-login
  client), Bring ledgers from Tally, every request to the bridge and to Tally (no new request XML), the bridge itself.

The numbers before and after are in section 4.

## 8. Tests

- `tests/run_tally_table_first.py` (new; made-up firm in staging's shapes: `tests/tally_shapes.py`): Today → Tally at 4x,
  every client's row within 1 s with this login's 2.5.3 bridge, with none, with this login's port hanging, with only old
  bridges, with every port hanging; "Open in Tally right now?" never stays "Checking…"; never "No client yet"; the page
  opened first, every client within 1 s of the page; five minutes on the page at 4x, no task over 200 ms.
- `tests/run_hang_worker.mjs` (new): the reporter's worker on a made-up clock: seen and stuck 7 s reported; hidden 60 s,
  asleep 17 minutes: nothing (2827a1820's worker: both reported, as Sentry got).
- `tests/run_hang_watch.py` 4 (new): a hidden page stuck 9 s sends nothing; seen again, a 2.5 s block says vis seen and the
  last click's code name.
- `tests/run_sentry_scrub.mjs`: the new tags' shapes kept, any other shape dropped.
