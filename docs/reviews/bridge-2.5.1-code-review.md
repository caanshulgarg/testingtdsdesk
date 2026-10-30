# Code review: FinCom Bridge 2.5.1 (the stock from Tally only on a person's click; cloud migration 134; the stock panel)

Reviewer: independent review sessions run with Claude Code (the code-review tool's forked reviewers, high effort). They
had only the repository and the range; they did not write the change.

Range: RANGE_PLACEHOLDER

Scope: bridge-go/stock.go (new), tally.go (requestClass, datedRefused, errStockRefused), pinned.go, cloud.go (the "stock"
wake and the beat's "stock"), allowlist.go and the tests (stock251_test.go; allowlist_test.go's computed-figure exception
and the driven click; the version tests moved to 2.5.1); server/tally-cloud/index.ts (stockWake, stockAnswer, the beat's
"stock") and migration-134-stock-from-tally.sql; src/js/88-fin-statements.js (stockFromTally, stockOn);
app/src/screens/books/fin/Stock.jsx; tests/run_migration134.py, tests/run_stock_ingest.py, tests/run_fs_stock_tally_ui.py.
Checked against the owner's decision of 30-Oct-2026 ("1": C1 exactly; a person's click only; once per company and period;
2 s hard stop; one in flight, postings first; stop on overrun until the next click with the owner's words; the allow-list
line; the narrow computed-figure and ReadDays exceptions for exactly this id).

## Checks run

- `go vet .` and `GOOS=windows go vet .`: clean.
- `flock /tmp/fincom-app.lock go test -count=1 -timeout 40m .`: the whole suite.
- `python3 tests/run_migration134.py` (pg_stand, PostgreSQL 16; RED_WITHOUT_134=1 fails), `python3 tests/run_stock_ingest.py`
  (tally-ingest under Deno against fake_supabase.py), `python3 tests/run_fs_stock_tally_ui.py` (Playwright on app/dist-test).

## Round 1 (origin/bridge-dated-ledgers..974c6cda0): 10 findings, all fixed with tests

1. (High) A click for a company already being answered was marked taken and then dropped with no answer; the cloud's 30 s
   "on its way" window was shorter than the bridge's 30 s posting wait. Fixed: such a click is answered "busy" at once
   (the words say so); the bridge's posting wait is 20 s and the cloud's window 60 s. TestStock251OneInFlightPostingsFirst.
2. (High) One click could wake several computers (the company's own, one with it open, the caller's own keys), each asking
   its Tally; the panel took the first answer. Fixed: ONE computer is woken (the company's own, else one with it open,
   else the caller's own key); tally_stock_answer refuses a second answer to the same click. run_stock_ingest.py A, C;
   run_migration134.py 2.
3. (Medium) The panel saved an answer into whatever client was open when the poll ended. Fixed: kept only in the books
   of the client clicked for.
4. (Medium) The "pending" answer (a click already on its way) never polled for the answer. Fixed: it waits for the answer
   as a fresh click does. run_fs_stock_tally_ui.py 4.
5. (Medium) The ReadDays exemption was one global request string, and did not require the 2 s stop. Fixed: a set of the
   requests in flight; only a copier read with its hard stop of 2 s or less, never a person's request (no stop).
   TestStock251ClickOnly.
6. (Medium) A bridge started again within 10 minutes would take the beat's click again and ask Tally once more. Fixed: the
   cloud stops carrying a click in the beat once it is answered. run_stock_ingest.py C, D.
7. (Medium) Tally's figure outranked a figure typed later and its cell could not be typed. Fixed: the cell stays typeable
   and a figure typed after Tally's answer is used over it (the later word); Tally's still outranks last year's balance
   sheet and an earlier typed figure (the owner: "uses them, with the existing typed/PY-balance fallback").
   run_fs_stock_tally_ui.py 3.
8. (Medium) A missing or self-closing OPENINGBALANCE / CLOSINGBALANCE was read as a nil stock. Fixed: no figure ("none");
   an empty element (Tally's nil) is nil. TestStock251FiguresAndExceptions.
9. (Low) The cloud took 30-Feb as a date and failed with a 500. Fixed: a real day only (400, plain words).
   run_stock_ingest.py E.
10. (Low, cleanup) Test-only state in the production struct, an impossible fallback, duplicated date helpers. Fixed:
    removed; the cloud and the app use their existing iso helpers.

ROUNDS_PLACEHOLDER
