# Writing and running the tests

Every build is checked three ways before it goes to the test site:

1. **Rule tests (Node):** the app's own modules are loaded into Node and run on a real client's Tally files. They check figures that can be worked out another way.
2. **Screen tests (Chromium):** the built page is opened in a real browser, the books are loaded, and the screens are clicked through.
3. **Bridge tests (PowerShell):** the bridge runs against a stand-in Tally made from the same client files.

## What you need

| | |
|---|---|
| Node 20 or later | rule tests |
| Python 3.10+, `pip install playwright`, `python -m playwright install chromium` | screen tests |
| PowerShell 7 (`pwsh`) | bridge tests; the bridge itself runs on Windows PowerShell 5.1 |
| A JDK (only for the stand-in FVU) | `python tests/make_fake_fvu.py` |
| A client's `DayBook.xml` and `Master.xml` | exported from Tally; kept out of the repository |

## Settings

| Variable | Default | What |
|---|---|---|
| `TDSDESK_DATA` | `tests/data` | the folder with `DayBook.xml`, `Master.xml`, and any 2B JSON |
| `TDSDESK_CACHE` | `tests/data/books-cache.json` | the day book read once and kept, so tests start in seconds |
| `TDSDESK_HTML` | `site-test/index.html` | the build under test |
| `TDSDESK_OLD_HTML` | same | an older build, for `run_regress.js` |
| `TDSDESK_SITE` | `site-test` | the folder the screen tests serve |
| `TDSDESK_OUT` | `tests/out` | screenshots, PDFs, files the tests make |
| `PWSH` | `/opt/pwsh/pwsh` | PowerShell for the bridge tests |

## Running them

```
python3 build.py                              # makes site/ and site-test/
cd tests
node run_adv.js "$TDSDESK_HTML" --fresh       # reads the day book once and writes the cache
for t in run_*.js; do node $t | tail -1; done
for t in run_*_ui.py run_ui.py; do python3 $t | tail -1; done
python3 make_fake_fvu.py && python3 run_bridge.py && python3 run_tally_ui.py
```

Each prints `ok` or `FAIL` per check and ends with `all passed` or `N FAILED`; the exit code is non-zero on a failure.

## Writing a rule test

Load only the parts you need with the harness, give it the books, and check something you can work out independently:

```js
const {load, openBlob, HTML, DATA, CACHE} = require("./harness");
const {ctx, x} = load(HTML, ["num", "r2", "Books", "GSTR", "INR"]);   // top-level names from src/js
const b = JSON.parse(require("fs").readFileSync(CACHE, "utf8"));
b.map = x.Books.mapLedgers(b.vouchers, {}); ctx.S.books = b;
const t = x.GSTR.threeB("202506", "07");
ok(Math.abs(t.itc.igst - expected) < 0.01, "June ITC equals the input IGST ledger's debits");
```

Good checks, in order of strength:

- **Two routes to one figure.** MIS sales against GST outward supplies; cost centres plus what is not allocated against the profit and loss; net cash flow against every cash and bank movement.
- **Plant a fault and find it.** Change one voucher (raise an invoice 10%, delete one, remove a GSTIN) and check the right finding appears, with the right amount. `run_2b.js` builds a 2B from the books and plants ten faults this way.
- **Same books, same result.** Run twice and compare the result code.
- **Old against new.** `run_regress.js` runs the same books through an earlier build; only intended differences may appear.

Avoid checks that only restate the code (`x === x`). If a check needs a figure from the real books, print it as well, so a failure shows what changed.

## Writing a screen test

Copy one of the `run_*_ui.py` files. The pattern:

1. Serve `TDSDESK_SITE` on a free port and open it.
2. Click "Use it here without an account" (offline mode, no Supabase).
3. Create a client with `newCompany(...)`, put the cached books in `S.books`, render, and set `S.books` again after a moment (opening a client loads from the browser's store).
4. Click, type and choose through `data-*` selectors; read `#app` text or the state `S`.
5. Collect page errors; ignore only Supabase network errors.

Table headers are shown in capitals by the stylesheet, so compare header text in lower case. Downloads: replace `window.saveFile` to capture file names; PDFs open in a new page (`ctx.expect_page()`).

## Writing a bridge test

`tests/fake_tally.py` answers the bridge the way TallyPrime does, from `DayBook.xml` and `Master.xml`: the company list, Day Book exports by date, ledger balances and the ledger list. `tests/fake.json` makes the bridge believe one Tally runs in the current Windows session. Start the bridge with `pwsh -File TDSBridge.ps1`, read its key from `tds-bridge.config.json`, and call it over HTTP. Before any change to the bridge ships, run `pwsh bridge/ps5check.ps1 -File bridge/TDSBridge.ps1`; it fails on syntax Windows PowerShell 5.1 cannot run.

## Portal files

`run_r1layout.js` checks the GSTR-1 JSON against a GSTR-1 downloaded from the portal (`TDSDESK_R1`, default `returns_25092026_R1_09AASCA7501M2Z4_offline_others_0-2.json` in `TDSDESK_DATA`) field for field, and reads any `returns_R2B_09AASCA7501M2Z4_<MMYYYY>.json` there against the portal's own 2B summary. Like the Tally files, these stay out of the repository.
