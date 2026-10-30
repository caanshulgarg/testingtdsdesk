# Code review: FinCom Bridge 2.5.2 (the stock from Tally only on a person's click; cloud migration 134; the stock panel)

Reviewer: independent review sessions run with Claude Code (the code-review tool's forked reviewers, high effort). They
had only the repository and the range; they did not write the change.

Range: 25e694c0a..af92f295b

Scope: bridge-go/stock.go (new), tally.go (requestClass, datedRefused, errStockRefused), pinned.go, cloud.go (the "stock"
wake and the beat's "stock"), allowlist.go and the tests (stock251_test.go; allowlist_test.go's computed-figure exception
and the driven click; the version tests moved to 2.5.2); server/tally-cloud/index.ts (stockWake, stockAnswer, the beat's
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

## Round 1 (25e694c0a to 974c6cda0): 10 findings, all fixed with tests

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

## Round 2 (974c6cda0 to 13c461ee5): 9 findings, fixed in 06eb6f7a6 with tests (or recorded)

1. (High) With "one answer per click", a shared computer's other Windows user's bridge (company not open) could answer
   "not open" before the bridge that asks Tally. Fixed (with round 3's 1): a bridge whose own Tally does not have the
   company open does not answer at all; the cloud also takes the answer of a bridge that asked Tally after a "not asked"
   one. run_migration134.py 2.
2. (Medium) Only the linked computer was woken even when off. Fixed: a computer with the company open first (the linked
   one first among them), then the linked one, then the caller's own key.
3. (Medium) The cloud rewrote the whole device record to drop an answered click (a race with the heartbeat). Fixed: the
   cloud no longer writes it; the bridge keeps the clicks it took on disk (stock-clicks.json), so a restart never takes a
   click twice. TestStock251OncePerPeriod.
4. (Medium) A typed figure was compared with Tally's readAt (the Tally computer's clock). Fixed: with when the page took
   Tally's figures (gotAt, the browser's clock as the typed figure's).
5. (Low) A kept answer older than a typed figure shown but not used after a click. Fixed by 4: a click takes the figures now.
6. (Low) No computer at all: the panel waited 40 s. Fixed: said at once, nothing recorded. run_stock_ingest.py A.
7-9. (Cleanup) A stale comment, a regular expression compiled per answer, the answer's fields built twice: fixed.

## Round 3 (13c461ee5 to 52660a3b5, medium effort): 8 findings

1. (Medium) Beat copies of a click on a shared computer: see round 2's 1 (fixed: no answer from a bridge without the
   company open; such a bridge does not take the click). TestStock251OneInFlightPostingsFirst.
2. (Medium) A failed "Ask Tally again" stamped stale figures as just taken. Fixed: gotAt only for an ok answer.
3. (Medium) No computer: a kept answer was no longer given back. Fixed. run_stock_ingest.py A.
4. (Low) Only ok could follow "not asked". Fixed: ok, slow, none or failed (a bridge that asked Tally). run_migration134.py 2.
5. (Low) The panel's extra wait could run out with an answer in hand. Fixed: the last poll keeps what is there.
6. (Low) The clicks' file written under the lock. Fixed: written after it is let go.
7. (Low, recorded) A bridge killed between taking a click and answering it does not take that click again after its
   restart: the person clicks again (the panel says the computer did not answer). Kept: never two requests for one click.
8. (Low, recorded) Two Windows users' bridges set to the same SyncDir share the clicks' file: not a supported set-up (each
   user's bridge keeps its own folder).


## Round 4 (52660a3b5 to 8c49a469c, medium effort): 8 findings, fixed in af92f295b with tests (or answered)

1. (Medium) The clicks' file written by two goroutines at once. Fixed: one writer at a time, the newest map each time.
2. (Medium) The cloud could still wake a computer without the company open, whose bridge no longer answers. Fixed: only a
   computer whose bridge says the company is open is woken; else said at once ("No computer has this company open in Tally
   just now"), a kept answer still given back. run_stock_ingest.py A.
3. (Medium) An "Ask Tally again" to such a computer left the row "asked". Fixed by 2.
4. (Low) An answer given back again (cached) re-stamped its time over a later typed figure. Fixed: the same answer keeps
   its first time.
5. (Low) A failure could replace "busy" on the same click. Fixed: after "busy" only Tally's figures; after "not open" any
   answer of a bridge that asked Tally. run_migration134.py 2.
6. (Low) The no-computer test passed either way. Fixed: a kept period and an unkept one, each checked.
7. (Low) The open-company look ran before the "taken already" check. Fixed: the click's time first.
8. (Answered) The "not answered here" line is the log's only (liveSayOnce writes no notice).

After round 4: the merge of bridge-dated-ledgers 186067897 (docs and the release check's self-test of 2.5.0 only),
8c49a469c (the self-test reads 2.5.2's decision line) and af92f295b. The whole range was read last: af92f295b is the commit built.
