# Security review: FinCom Bridge 2.3.1 (item invoices enter complete; masters by counter; the deferred Lows)

Reviewed: 06-Oct-2026, alongside the code review of the same range (bridge-2.3.1-code-review.md), which has the
details and the commits, in three rounds. Written from the commits on items-231 (45e23f1..702babf). The sources are
read with `git diff e628ae0 <to> -- bridge-go/ server/ app/ docs/tally-allowlist.md`.

## What 2.3.1 does

The entry request fetches the whole entry, strictly one entry per request (part A); ledgers kept current by Tally's
master counter and an unknown ledger fetched first (part B); the deferred Lows (part C); the background company list
under the 2 s stop; held only when the lines do not total zero; a slow or unanswered request never switches reading off
(one shared retry schedule).

## What holds

- **Only the requests the owner approved changed.** The entry request (FinComVoucherByMaster, FinComVoucherByNumber)
  and masters by counter (FinComLedgerChanges, FinComLedgerByName, and TDSDEDUCTEETYPE in FinComLedgers), and trial
  forms A and C byte for byte the two entry requests (the owner's approval of 2026-10-06); B, D, E and F unchanged.
  Every request is on the allow-list with its shape; an unknown request is refused; nothing asks Tally to compute a
  figure. No new host.
- **Read only, the 2-second rule, after postings.** Every new or changed request is read only, stops hard at 2 s and
  never runs during a posting; TDSDeskCompanies asked in the background stops at 2 s too (its shape unchanged).
- **Each bridge on its own Windows user's Tally only.** A line from another user's session is never sent, also while
  the company list is slow (round 2 H1).
- **The books stay right.** An entry is held only when its lines do not total zero; a ledger an entry names that FinCom
  does not have is fetched before the entry is applied; an alias maps only after a fetch made after the hold (M-A);
  "nothing to remove" never re-cancels a later real entry (M-B). Database changes are add-only (57, 58, 59, 60).

## Round 1

- **H1** (fixed): an item invoice already refetched by a 2.3.0 bridge is listed and re-sent once, applied once.
- **M1** (fixed): the decision line and notes say exactly what the two requests ask, and that the measure is on the
  stand (not real Tally).
- **M2** (fixed): only trial forms A and C change.

## Round 2, with its re-review

- **H1** (fixed): a slow company list never loses or passes over an own line; another user's line is never sent.
- **H2** (fixed): a stale alias cannot put a new ledger's entry on another ledger.
- **M1** (fixed): every background ask of the company list goes under the 2 s stop.
- **M2** (fixed): a "full" body's details follow Tally exactly.
- **M3** (fixed): a tax that cannot be checked is a plain note.
- **L2** (fixed): the Tally process filter never takes tallyscheduler.exe or another helper.
- **L4** (fixed): a name Tally cannot be asked by is never put into a request; held in plain words.
- Re-review: **M-A** (fixed) an alias never maps by itself; **M-B** (fixed) "nothing to remove" bounded by Tally's
  counter, read with the existing FinComCompany request (no new or changed request).

## The real TallyPrime 7.1 run and the owner's last change

The real run's findings (81d10ee) fixed with the run's captures; the bank allocation's three fields added on the same
path (allow-list shapes and hash updated, inside the owner's approved entry request). The owner's last change (972da2e):
no request changed; postings and a person's actions never wait; FinCom's own stop still stops.

## Round 3

**No High, no Medium.** L1 (fixed, 702babf): an empty inventory block is no item line.

All High and Medium findings are fixed, each with tests. No High or Medium open. The deferred Lows of earlier reviews
fixed in 2.3.1 are listed in the code review (part C), among them the bind check failing closed on a database error
and migration 58's privileges on 54/55's tables.

## After the rounds

a701880 merges items-231 (702babf) into tax-accuracy (a merge commit; no conflict). No bridge code changed after it.


Range: e628ae0..a701880
