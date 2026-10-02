# Code review: FinCom Bridge 2.1.5

Range: f21b29f..be5542f (bridge-go/, server/tally-cloud/index.ts, migration-35)
Reviewed: 02-Oct-2026, by the code-review skill in the Claude Code session, then re-read after the fixes.

Focus: a request reaching Tally outside the allow-list; postings breaking while reading is stopped; an update installing without approval; a posting lost or sent twice.

## Findings (all fixed, each test-first; evidence in the commit messages)
1. ledgers.go: a refused or held request (read stop, probe hold, backoff) could mark a ledger as one that hangs Tally. Fixed: only a real timeout or cut-off answer counts; keepHold respects the read stop. TestPoisonNotMarkedWhenRefused.
2. reads.go ledgerChunks: FinCom's /ledgers and /ledgernames still asked for a known poison ledger. Fixed: skipped, reported as skipped. TestLedgerChunksSkipPoison.
3. held.go heldLedgerVouchers: ledgers only inside item-invoice allocations were missed. Fixed: one voucherLines() shared with the balance code. TestHeldLedgerVouchersItemInvoice.
4. selfwatch.go: the 2-minute silence rule measured time since the last error. Fixed: real silence while requests are attempted. TestNoSelfStopWhenIdleAfterOneError, TestNoSelfStopFromOldStuckFile, TestSelfStopOnSilence.
5. (added) the measure tool's requests no longer trip the self-stop. TestMeasureDoesNotSelfStop.

## Found safe
Allow-list checked in invokeTally and tallyRaw before anything is sent; read stop exempts only what a posting needs; update gating compares to the signed latest.json version and never downgrades; FinComTag read-back keeps the earlier "unknown outcome" behaviour on a failed read.

## Round 2 (a6bd835..0215ea4: allow-list exception, beat allowlist flag, ledger-list round/count, migration 34, index.ts)
Reviewed 02-Oct-2026 by the code-review skill. 7 findings, all fixed test-first (commits 0aaaf23, be5542f):
1-4. The exact-equality count check (bridge rowsRead vs the cloud's live GUID count) would fail for good after a poison ledger, a twin, or any held deletion, and held deletions were never resent. Replaced: each batch carries the GUIDs seen in the complete round; the cloud works out the unseen live ledgers itself; completeness = every batch arrived (seen count = rowsRead); bulk hold confirmed by the previous complete round; the bridge sends no deleted list.
5. The entries guard missed a ledger renamed then reported gone: guard now also holds a ledger renamed within 30 days or with entries under an old name (renamed_at).
6. A merge in tally_ledger_rename nulled/moved the GUID even when the guard kept the old row: the merge is refused when the old row would be held.
7. release-check.sh check 4 could pass an empty table: it now fails with "no rows parsed".
Round 3 (0aaaf23, be5542f) re-read: no further findings.
