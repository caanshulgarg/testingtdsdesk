# Code review: FinCom Bridge 2.1.5

Range: f21b29f..a6bd835 (bridge-go/, server/tally-cloud/index.ts, migration-35)
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
