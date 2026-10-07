# Code review: FinCom Bridge 2.3.1 (item invoices enter complete; masters by counter; the deferred Lows)

Reviewed: 06-Oct-2026, by the reviewers in the Claude Code session, in three rounds: round 1 (the entry request's
first change), round 2 (parts A, B and C together, with a re-review of its fixes) and round 3 (after the real
TallyPrime 7.1 run and the owner's last change). All High and Medium fixed, each with tests first; round 3 found no
High or Medium. These notes are written from the commits on items-231 (45e23f1..702babf). The sources are read with
`git diff e628ae0 <to> -- bridge-go/ server/ app/ tests/ docs/tally-allowlist.md .github/workflows/`.

## What 2.3.1 does

The branch items-231 (up to 702babf; parts a-231, b-231 and c-231 merged into it), merged into tax-accuracy with a
merge commit (a701880; items-231 already holds tax-accuracy's history up to eeb163e, so a squash would lose the
merge-base):
- **The entry request** (part A, the owner's decisions of 06-Oct-2026): FinComVoucherByMaster and FinComVoucherByNumber
  fetch the whole entry: the ledger lines kept under an invoice's items (ALLINVENTORYENTRIES.ACCOUNTINGALLOCATIONS),
  the items (name, quantity, unit, rate, taxable value, HSN or SAC and GST rate as Tally applied them), bill-wise, TDS,
  cost centres, bank details (with the bank allocation's DATE, NAME and UNIQUEREFERENCENUMBER), narration, reference,
  IRN and acknowledgement, e-way bill, party GSTIN and place of supply; strictly one entry per request, read only,
  the 2-second rule, after postings, the own Windows user's Tally only. A body from it is "full": its blanks pass as
  Tally has them. Migration 57 stores the details for both paths.
- **Masters by counter** (part B): FinComLedgerChanges (ledgers with an AlterID above the last number, 200 a request)
  and FinComLedgerByName (one ledger an entry uses that FinCom does not have, fetched before the entry is asked
  again); FinComLedgers and both ask the party's deductee type (TDSDEDUCTEETYPE). A renamed ledger fetched for an
  unknown name is FinCom's ledger (the owner's decision; migration 59).
- **The deferred Lows** (part C) of the 2.3.0, 2.2.4, 2.2.3 and 2.2.2 reviews (listed below), migrations 58 and 60.
- **The owner's 08:05 report**: TDSDeskCompanies asked in the background goes under the 2 s stop.
- **The owner's accuracy rule**: an entry is held only when its ledger lines do not total zero; every other mismatch
  applies with a note.
- **The owner's last change** (972da2e): a slow or unanswered request never switches reading off; the 2 s stop per
  request stays; one shared retry schedule (15 s, 30 s, 1 min, 2 min, then every 5 min).
- The allow-list: the two changed requests, the two new ones, FinComLedgers' one field more and trial forms A and C
  (byte for byte the two entry requests); B, D, E and F byte for byte as in 2.3.0. The decision line for 2.3.1 names
  the owner's words for each.

## Round 1 (the entry request's first change)

Fixed in 983bb27:
- **H1** (fixed, test first). An item invoice a 2.3.0 bridge already refetched (its ":resolved" held by the guard as
  incomplete) is listed again once and re-sent once under the same id, applied once, both held lines replaced (cloud:
  heldOwnLines; bridge: a sent mark of an older version is not done; no migration).
- **M1** (fixed). The decision line and the notes say what the two requests ask (ByMaster up to 50 entries of one
  day, ByNumber one), "on the stand (not real Tally)", and the 1 MB and HSN limits.
- **M2** (fixed). Trial forms B, D, E and F byte for byte as in 2.3.0; only A and C change.

## Round 2 (parts A, B and C together), with its re-review

- **H1** (fixed, 2fe7a2a, test first: ownlook231_test.go). A slow company list (3,307 ms on NWS144) never loses or
  passes over a line of the own company: the last complete own-company list and the "blind" time are kept across a
  restart; a line written in blind time for a company open at the next complete look is taken; another user's line is
  never sent; with no complete list the lines wait with plain words and one amber alert.
- **H2** (fixed, b54a323, test first: run_recorder_server.py, run_migration59.py). A stale alias no longer puts a new
  ledger's entry on another ledger: aliases are ended when their GUID or name moves, and used only while confirmed and
  not ended (migration 59 gains confirmed_at and ended_at; not yet run).
- **M1** (fixed, c3d06c9, test first: colistbg_test.go). Every background ask of the company list (the ledger-changes
  check, the body fetch, the resolve of held lines, the GUID ask) goes under the 2 s stop (findCompanyPortBg).
- **M2** (fixed, 471d89b, test first: run_migration57.py 2b). A "full" body's details follow Tally exactly (a blank is
  written blank; an empty list marks the rows gone, kept).
- **M3** (fixed, 471d89b, test first: run_parse_parta.mjs 3b). A tax that cannot be checked is a plain note, never a
  hold.
- **L2** (fixed, 52ac79c, test first: TestReTallyExcludesHelpers). The Tally process filter takes tally / TallyPrime
  only, never tallyscheduler.exe.
- **L4** (fixed, b54a323, test first: ledwant_l4_test.go). A ledger name Tally cannot be asked by is held in plain
  words and said once.
- With the round, the owner's review: the accuracy rule (c49f4b0: held only when the lines do not total zero; other
  mismatches apply with a note) and migration 57's "nothing to remove" without an AlterID never re-cancelling for ever
  (e1e8304, test first: run_migration57.py 4c).
- 3eebfb1: TestPartATurnTimeUsedNextTurn gives each entry request its real time on the stand after M1. No finding.

The re-review of the fixes (5c4bec9, tests first):
- **M-A** (fixed). An alias never maps by itself: an entry naming an aliased name is held and the ledger fetched by
  name; it is mapped only when a fetch made after the hold gave the alias's GUID (run_recorder_server.py,
  ledwant_l4_test.go).
- **M-B** (fixed). "Nothing to remove" re-deletes always (Tally never brings a deleted GUID back) and re-cancels only up
  to Tally's voucher counter at the cancel (read with the existing FinComCompany request, no new or changed request;
  run_migration57.py 4c, cancelcounter_test.go).

## The real TallyPrime 7.1 run (run 37435532807)

Fixed in 81d10ee and 1840b8c, tests first on the run's captures (tests/run_parse_real231.mjs, bridge-go/real231_test.go,
bridge-go/testdata/real-tally-7.1/231): an item invoice's lines read once (Tally gives them in ALLLEDGERENTRIES and again
in LEDGERENTRIES plus the items' allocations); each GST head to its own slot ("State Cess" no longer matched as SGST);
the bank allocation's DATE, NAME and UNIQUEREFERENCENUMBER fetched (same path; allow-list shapes and hash updated).

## The owner's last change (972da2e)

A slow or unanswered request never switches reading off; a 2.3.0 self-stop saved on disk is cleared at start; the 2 s
stop per request stays; every background request waits for one shared retry schedule (retry.go); postings and a
person's actions never wait. Tests first: retry231_test.go; the self-stop and switch-off tests changed to the new
behaviour. No Tally request changed.

## Round 3 (after the real-Tally run and the owner's last change)

**No High, no Medium.**
- **L1** (fixed, 702babf, test first: run_parse_real231.mjs). An empty ALLINVENTORYENTRIES.LIST (real 7.1, entries
  without items) is no item line; the Day Book md5 72deb549 unchanged.

## The deferred Lows fixed in 2.3.1 (part C), each test first

- 2.3.0 round 1: L2/L3 recorder-guids.json saved at most every 30 s (309ab4c); bridge L1 the bind check fails closed
  on a database error (6d45a08); the cloud Lows (7cba0b8, b16bb02, 0fcd23d); privileges on 54/55's tables (migration
  58, f73351e).
- 2.3.0 round 2: L1 the keeper's cleanup releases only its own read leases (8672c24).
- 2.3.0 round 3: L1 parse.js's tag pattern linear (0e155ba); L2 the refetch lookup 60 ids at a time (4e7f573); L3 a
  self-closed CMPINFO with attributes dropped alone, cloud and bridge (679aaca, 2c12f3f).
- 2.2.4: L2 a ">" inside a quoted attribute (66533fc); L3 the voucher count (8b0b6fe); L4 a typed GUID in useKeepPosted
  (d74f005); L5 measureFieldState (a325b54); L6 renameKeepLedger's regex cache (b01cecc); L7 the typed stand's CMPINFO
  (dc8906b).
- 2.2.3: L1 the test's ended wait said so (62b1346); L3 the tray's input box limit (b1dc4b6); L4 comments (3d90359).
- 2.2.2: L-F a held line already resolved is not listed again (9821f7f).
- Migration 50 review: L7 a day with entries the reader leaves out is no short read (04e5303); R3-L1..L3 (migration 60,
  4e26a98, 8e834a5).

## After the rounds

a701880 merges items-231 (702babf) into tax-accuracy; the tax-accuracy-only changes since the merge-base (1a15f40,
05be946: docs/HANDOVER.md) merged without conflict. The range also holds the keep-fields-230 commits merged into
tax-accuracy after 2.3.0 was published (migration 56 and the blank-value guard, 27de563..24f9a35), reviewed on their own
(migration 56's review and re-review). No bridge code changed after a701880.


Range: e628ae0..a701880
