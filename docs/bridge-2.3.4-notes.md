# FinCom Bridge 2.3.4: release notes

For the owner. Plain words; times are IST. The steps to try it on NWS144 are in `docs/bridge-2.3.4-test-sheet.txt`. The
exact request and the field comparison are in `docs/fast-request-form.md`.

| | |
|---|---|
| Setup file | FinComBridge-Setup-2.3.4.exe |
| Fingerprint | (filled in when the setup is built) |
| FinCom app | unchanged |
| FinCom's cloud | tally-ingest (`server/tally-cloud/index.ts`) must be deployed with this release: the 30-day window for lines ended by the slow-company rule. No migration |
| Replaces | 2.3.3 (kept on the computer, so the tray can roll back to it) |
| Add-on | unchanged: keep `C:\ProgramData\FinCom\addon\FinComRecorder.tdl` loaded as it is |

## What changes

1. **One entry is found in milliseconds, whatever the company's size.** The entry request is now FinComVoucherObject:
   Tally's object export of ONE voucher by its MasterID ("ID:<MasterID>"). Before, FinComVoucherByMaster read every
   voucher of the company (about 0.15 ms each: 3.5-4 s at 25,000 vouchers, 12-17 s at 100,000). Measured on TallyPrime
   3.0, 4.1, 5.1, 6.2 and 7.1 at 4,000 to 100,000 vouchers: 9-23 ms median, 61 ms worst (push-design run 37718386662).
   The old request is gone, with no fallback: the entry fetch, the held lines, the cancel / delete check and the posting
   check all use the new one.
2. **Exactly the approved fields, nothing more.** Tally answers this request with the whole voucher (it ignores the
   field list). The bridge keeps exactly the 61 approved fields of the entry request (the 13 approved on 08-Oct-2026
   among them) and drops everything else before anything is logged, stored or sent. FinCom stores the same rows from it
   as from the old request (tested on real answers of all five releases, `tests/run_fast234_store.py`); the one
   difference: an item invoice's ledger lines are numbered in the order Tally's Day Book gives them.
3. **No company should need marking slow.** Only the new request's stops count toward the mark. A company 2.3.3 marked is
   asked again (the mark lifts with the new version).
4. **Lines 2.3.3 ended get one more ask.** A held line 2.3.3 ended with the Day Book words (a slow company's) is asked
   once more with the new request when FinCom lists it; if Tally gives the entry it enters the books, replacing the held
   line; it is never asked a third time. FinCom lists such lines for 30 days (other held lines: 7 days, as before).
5. **Lines with no MasterID** (a new entry whose line carries MasterID 0; 2 of 82 on staging in 30 days) are still asked
   by type and number (FinComVoucherByNumber, unchanged): one try and one ask again, then the Day Book words. Their stops
   no longer mark a company.
6. **The trial forms A and C** of "Test fetching an entry" are removed (the owner's decision; nothing in normal working
   used them). The tray item keeps forms B, D, E and F.

Two request forms froze Tally on every release when tried (the object export with no field list; a TDL report over the
voucher object): the bridge refuses both before anything is sent.

## Tested

- Real Tally (tally-real run 37723589664, TallyPrime 7.1, built from next-fastfetch): two companies open, one of 40,000
  entries, the data folder on an SMB share (on one runner: SMB only, no network); 20 held lines (10 ended by 2.3.3):
  every check passed: each save in FinCom with its details, every entry request 20-46 ms at Tally, every held line
  fetched once by the new request, no old request, no overlap, no company marked slow.
- The gate on this build's committed setup: see below (filled in after the run).

## Not published
