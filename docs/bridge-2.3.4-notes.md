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
   difference: an item invoice's ledger lines are numbered in the order Tally's Day Book gives them (harmless: an entry
   2.3.3 stored and 2.3.4 sends again ends with exactly the new rows live). The by-number request's answers are stripped
   to the same fields too: no entry's body leaves the bridge with a field outside the approved list.
   An entry Tally keeps in a form whose lines the strip cannot keep whole (an invoice made in voucher mode: stock under
   the sales line) is held with the Day Book words, never sent with lines missing. Every kind of entry was compared on
   real answers of all five releases (docs/fast-request-form.md section 9).
3. **No company is marked slow.** The owner's decision of 08-Oct-2026: "When FinCom's fast request for one entry takes more than 2 seconds, the bridge stops waiting as today, sends that entry's line to FinCom as held, and ends it with 'upload that day's Day Book to settle it'. The slow answer does not count towards marking the company slow; the company's other entries keep being fetched normally. The 2-second stop itself is unchanged."
   So an entry Tally takes over 2 s to give (a very large invoice: about 600 items or more; or Tally busy at that moment)
   goes to FinCom held with "Tally took longer than 2 s for this entry; upload that day's Day Book to settle it" and is not
   asked again; nothing marks the company. A company 2.3.3 marked is asked again (the mark lifts with the new version).
4. **Lines 2.3.3 ended get one more ask.** A held line 2.3.3 ended with the Day Book words (a slow company's) is asked
   once more with the new request when FinCom lists it; if Tally gives the entry it enters the books, replacing the held
   line; if not, it ends again with the Day Book words and FinCom stops listing it; it is never asked a third time.
   FinCom lists such lines for 30 days (other held lines: 7 days, as before), to a 2.3.4 bridge only (a bridge rolled
   back to 2.3.3 gets its last 7 days' lines as before).
   Every line an older bridge kept in its held list (at 20 tries, or marked "not asked again") is asked once with the
   new request on the upgrade: answered, it enters the books; not, it ends with the Day Book words. None is left unasked.
5. **Lines with no MasterID** (a new entry whose line carries MasterID 0; 2 of 82 on staging in 30 days) are still asked
   by type and number (FinComVoucherByNumber, unchanged): one try and one ask again, then the Day Book words. Their stops
   no longer mark a company. A line WITH a MasterID is never asked by its number (a scan of the whole company): when
   Tally's voucher with it is another entry the line is held with the Day Book words (only a line whose MasterID is
   proven not its entry's, the copied source's, is asked by number).
6. **The trial forms A and C** of "Test fetching an entry" are removed (the owner's decision; nothing in normal working
   used them). The tray item keeps forms B, D, E and F.

7. **A deleted entry is proven gone exactly as before.** Tally answers the new request for a MasterID it no longer has
   with one bare line, `<ERRORMSG>Could not find Voucher:ID:<n>!</ERRORMSG>` (not an empty answer; seen on all five
   releases). The bridge takes it as "not in this Tally" only when it is exactly that line for the MasterID it asked;
   anything else is an answer it cannot read, and the delete is held with words, never taken as proven.
   **This changes how deletes are settled and needs the owner's sign-off before the build.**
8. **After the second independent review** (0 High, 4 Medium, 7 Low; fixed test-first, L3 / L4 / L7 left as they were
   for the owner):
   - a held line an older bridge kept that gets an unreadable answer on its one ask ends with the Day Book words; it
     no longer vanishes from FinCom's list (M1);
   - an item invoice whose sales ledger is also a line of its own is stored as today (M2);
   - FinCom's 30-day list of ended lines reads every such line of the company, not the 400 oldest of any kind (M3);
   - a held line whose ask takes over 2 s is ended at once with the Day Book words (option (a) in the held list too, M4);
   - a payroll voucher typed on the Payroll screen is stored as today, no longer held (L1);
   - a cancel / delete check or posting check meeting a voucher the bridge cannot read says so in words and is not
     asked every turn; the posting check says a person must look in Tally, never "busy" (L2);
   - an answer carrying a voucher the bridge cannot read is held, never taken as "no such voucher" (L5);
   - the allow-list row of the new request carries its measured worst case (1.7 s, a 500-item invoice) (L6).
   A cancel / delete check stopped at 2 s keeps its "could not be asked" words and is asked again, as before: the owner's
   option (a) applies to the entry requests, not to these checks.

Two request forms froze Tally on every release when tried (the object export with no field list; a TDL report over the
voucher object): the bridge refuses both before anything is sent.

## Tested

- Real Tally (tally-real run 37723589664, TallyPrime 7.1, built from next-fastfetch): two companies open, one of 40,000
  entries, the data folder on an SMB share (on one runner: SMB only, no network); 20 held lines (10 ended by 2.3.3):
  every check passed: each save in FinCom with its details, every entry request 20-46 ms at Tally, every held line
  fetched once by the new request, no old request, no overlap, no company marked slow.
- The gate on this build's committed setup: see below (filled in after the run).

## Not published
