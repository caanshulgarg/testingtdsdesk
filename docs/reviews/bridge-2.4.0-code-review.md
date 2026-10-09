# Code review: FinCom Bridge 2.4.0 (2.3.4 and 2.3.5 with the 2.4.0 items, one release from 2.3.3)

Reviewed: 09-Oct-2026, an independent review of origin/release-240 against origin/tax-accuracy (the published 2.3.3),
then three re-reviews of the fixes. Read with `git diff 2bf4011d eed48720 -- bridge-go/ server/ src/ app/src/ docs/tally-allowlist.md`.

## What 2.4.0 does

- The fast entry request FinComVoucherObject (2.3.4) with the company check before every entry request, the
  leading-zero refusal and the "asked twice, company open" delete proof; one more ask after a 2 s stop.
- Held lines under FinCom's read stop (2.3.5); clear notifications in the app and the tray (migrations 68, 70).
- Each Windows user's own recorder file (`|w=`; the add-on's one new formula `$$SysInfo:WindowsUser`).
- The whole TDS list in the entry requests (FinComVoucherByNumber's shape 111afcb61eb9 -> 2167477221dc, the owner's
  decision of 2026-10-07; FinComVoucherObject unchanged, ce0e72f74e72); the rate worked out where Tally stores 0, exempt
  lines kept as Tally has them (migration 62).
- The outbox: lines FinCom answered 'failed' kept and sent again (30 minutes at most), no duplicates after a restart
  (migration 63's repeat check). Renumbering (migration 67), bank dates (the nightly list at 10 s outside office hours,
  the owner's decision of 2026-10-09), the nightly self-check (migration 65), the pages live (migration 64), Sentry on
  staging only (scrubbed), the simpler Tally, ledgers and upload pages. No master form hooked in the add-on.

## Checked

- **Requests.** Only FinComVoucherByNumber's row changed (the owner's decision of 2026-10-07, option A); no request
  added. The add-on's events are 2.3.3's; FinComRecorder.tdl adds only the formula FCRWinUser.
- **2-second rule.** Every background read through recorderTC (RecorderLimitMs, capped at 2,000 ms); only the nightly
  bank list uses BankNightLimitMs (capped at 10,000 ms), never sent inside office hours (PC time or IST, start and end).
- **Company check.** FinComVoucherObject and FinComVoucherByNumber go only right after a fresh TDSDeskCompanies names
  the company; the company list is not counted as the entry's ask, and a real Tally failure of it still is.
- **Own Tally only.** The bank route (small list, nightly list, entry reads), renumbering, the self-check and the ledger
  changes ask only this bridge's own Windows user's Tally (ledOwnPort).
- **SQL 62-70 (69 not in this release).** Add-only: no drop, truncate or delete; RLS on every new table; every SECURITY
  DEFINER function sets search_path; grants minimal (70 revokes INSERT on app_alert_dismissals).
- **Figures.** The books' own ledger map counts as in 2.3.3 (the owner's decision of 09-Oct-2026, "Keep today's
  figures"); the ledger check's suggestions count in no figure until confirmed; who and when kept.
- **Notifications.** A cleared notice stays cleared for that person on every device and after a reload; a new problem
  (a new line, another computer or kind, a wait reason that started again) is a new notice.
- **Sentry.** Staging only; events rebuilt from an allow-list; no request bodies, no user, no breadcrumbs but named pages
  and scrubbed console errors; only code identifiers kept from free text (no snake_case, lower-case dotted or file names).

## The independent review (09-Oct-2026), range 2bf4011d..29932a53

1 High, 7 Medium, Lows. Fixed in 859004e4, af074f55, 54090886, d29106ed, f06d2998, 5930b690:
- H1: the ledger page said unconfirmed answers count in no return while they counted; decided by the owner as "Keep
  today's figures" (tests/run_ledger_pending.py against tests/fixtures/figures-2.3.3-fixture.json).
- M1: renumbering called FinCom's cloud every second after a failure and blocked the other jobs; now backs off (30 s
  doubling to 30 minutes) and a waiting job goes last (TestRenumberCloudFailureBacksOff).
- M2: cleared notifications came back (fingerprints over 2,000 characters cut, Clear all over 500 refused, day-keyed
  ownwait / selftest / tray notices); hashes for long items, rows split, calls of 500, start-keyed keys.
- M3: Sentry kept snake_case and dotted lower-case words (file and firm names); only code identifiers now.
- M4: TDSDeskCompanies alone spent a held line's ask (TestHeldAskNotUsedByCompanyListAlone).
- M5: "Keep as confirmed" was not saved.
- M6: the bank route and renumbering could ask another Windows user's Tally (TestBankAndRenumberOwnTallyOnly).
- Lows: the two limits capped (TestLimitsCapped); the self-check's header.

## The re-review of the fixes (09-Oct-2026), range 29932a53..5930b690

All fixed but two Mediums, fixed in 24a6e7e0, 7c0e5e46 and c4b8c5c5:
- M2 remainder: the "changes wait" notice was keyed on when this browser first saw it; now on the beat's
  recorderWaitSince (an ISO time, checked by tally-ingest; no Tally request).
- M6 remainder: the bank route's small list went to the port the light check passed; it now asks only the own Tally
  (TestBankSmallListOwnTallyOnly).

## The third re-review (09-Oct-2026), range 5930b690..c4b8c5c5

0 High, 1 Medium (M2-r), 2 Low; go vet (Linux, Windows) clean, go test ./... passed (904 s).
- M2-r: one start for every wait reason together (the oldest queued line): it moved while a backlog drained (a cleared
  notice came back) and a line FinCom kept answering 'failed' pinned it (a different wait stayed hidden). Fixed in
  6930bf1b: each reason has its own start (recorderWaitStarts: earlier, blind, queue per company, the queue's start kept on
  disk until that company's queue drops below 30 s), each one item of the notice's fingerprint; tally-ingest keeps only
  the three reasons, a company of at most 200 characters and an ISO time, 50 at most.

## The last re-review (09-Oct-2026), range c4b8c5c5..eed48720

0 High, 0 Medium, 3 Low; go vet (Linux, Windows) clean, go test ./... passes (909 s, -timeout 25m).
- M2-r fixed (6930bf1b): a draining backlog keeps its start (a cleared notice stays cleared); a different reason, or a
  reason started again, is a new item (a new wait shows); the same in every browser and after a reload.
- S-M1 (the security review) fixed in eed48720: checked with the security note (bridge-2.4.0-security-review.md).
- L: a line FinCom keeps answering 'failed' holds its company's queue start; a later backlog of the same company shares
  it (the same reason and company).
- L: a bridge upgraded with a stopped look and no saved start keys on the last time a line waited until the next
  complete look.
- L: the bridge cuts a queue company to 200 characters, tally-ingest counts UTF-16 units: a name with 4-byte characters
  near the limit is dropped (the notice falls back to recorderWaitSince).
- Not run here: the app's Python tests and the server's Deno tests, real Tally.

Range: 2bf4011d..eed48720
