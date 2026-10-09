# FinCom 2.4.0: release notes

For the owner. Plain words; times are IST. The steps to try it on NWS144 are in `docs/bridge-2.4.0-test-sheet.txt`.

**One combined release** (the owner's decision of 08-Oct-2026): 2.3.4 and 2.3.5 are not published on their own; bridges
go from 2.3.3 straight to 2.4.0. So 2.4.0 carries everything of 2.3.4 (part A below, full notes
`docs/bridge-2.3.4-notes.md`), of 2.3.5 (part B, `docs/bridge-2.3.5-notes.md`) and the new items of the next release
(part C). Branch `release-240`: `release-235` (2.3.4 + 2.3.5) with `next-userfile`, `next-tds`, `next-outbox` (and its app
part `next-outbox-app`), `next-realtime`, `next-selfcheck`, `next-masterhook`, `next-renumber`, `next-ledpage`,
`next-bankdate`, `next-uploadpage` and `next-sentry` merged in, each with its review fixes. `next-inflight` and
`next-reask` are NOT in it; `next-push` and `next-connect` are not in it (see the end).

| | |
|---|---|
| Setup file | FinComBridge-Setup-2.4.0.exe |
| Fingerprint | SHA-256 `00ab8042dff1b1b508410632f832d20ee1169fcc71493f682af38a413ac416dc` (FinComBridge-Setup-2.4.0.exe, built 09-Oct-2026 13:52 IST; compare with the .sha256 file next to the setup) |
| Replaces | 2.3.3 (kept on the computer, so the tray can roll back to it) |
| FinCom app | changed (parts B and C): the simpler Tally, ledgers and upload pages, Clear notifications, pages that refresh by themselves, the nightly self-check's line, Needs you for renumbered entries and stuck saves, Sentry (staging only) |
| FinCom's cloud | migrations 68 and 70 (2.3.5) and migrations 62, 63, 64, 65, 66 and 67 (2.4.0), each add-only, NONE run yet; the owner runs them: staging ... -> 60 -> 68 -> 70 -> 62 -> 63 -> 64 -> 65 -> 66 -> 67 (`docs/MIGRATION-ORDER.md`; md5 in the test sheet). tally-ingest is deployed with them (run 62 and 66 before it; each item says what waits without its migration) |
| Add-on | changed: load the new `C:\ProgramData\FinCom\addon\FinComRecorder.tdl` (each Windows user's own file; no master form hooked, item C6 not shipped) |
| Tally requests | see "Tally requests" below: the entry request is FinComVoucherObject (2.3.4, the owner's decision of 08-Oct-2026); FinComVoucherByNumber also asks for the whole TDS list (the owner's decision of 07-Oct-2026); nothing else added or changed |

## A. From 2.3.4 (not published on its own)

1. **One entry is found in milliseconds, whatever the company's size**: the entry request is FinComVoucherObject,
   Tally's object export of ONE voucher by its MasterID (9-23 ms median, 61 ms worst on TallyPrime 3.0-7.1 at 4,000 to
   100,000 vouchers). FinComVoucherByMaster is gone, no fallback. The owner: "Allow, strip in bridge."
2. **Exactly the approved fields**: Tally sends the whole voucher; the bridge keeps exactly the approved fields (the 13
   approved on 08-Oct-2026 among them; from 2.4.0 the TDS list whole, item C2) and drops the rest before anything is
   logged, stored or sent.
3. **No company is marked slow; one more ask.** The owner's answers of 08-Oct-2026: "A, 'slow company' marking ends: yes.
   A slow answer then holds only that one entry, so one big invoice can't stop a whole company from syncing." and "B: one
   more ask. It gives an entry one more chance before it's held, without letting it retry forever." An entry Tally takes
   over 2 s to give is held, asked ONE more time 5 minutes later, and then ends with the Day Book words. The 2-second
   stop itself is unchanged.
4. Lines 2.3.3 ended get one more ask (FinCom lists them 30 days; the owner: "30-day window ... YES").
5. **A deleted entry is proven gone only when Tally says so twice**, with the company open before and after; a MasterID
   with a leading zero is never proof. The owner: "Delete fix: yes. The leading-zero refusal and the company check close
   real ways a delete could be proven wrongly, and both have tests." The entry requests (FinComVoucherObject and
   FinComVoucherByNumber) go only right after Tally's company list on that port names the company (Tally crashes on an
   entry request naming a company that is not open); FinCom's read stop refuses both before the list too.
6. The trial forms A and C of "Test fetching an entry" are removed (the owner's decision).

## B. From 2.3.5 (not published on its own)

1. **The Tally pages are simpler.** The owner: "tally option is so confusing that i am also not able to connect
   properly". One card per computer with one status line, three steps, the rest under More; Sync activity's "Needs you"
   only when a person must act, with one action.
2. **Clear notifications, everywhere** (app and tray). The owner: "if one time any notification is cleared then that
   notification should not appear". Migrations 68 and 70.
3. **Held lines under FinCom's read stop**: a held delete keeps its entry id, plain words while reading is stopped, a
   refused request is not a try. The owner's conditions: "the delete fix must keep the entry id and never create a line
   without it, and the refused-request change must not hide a real Tally failure from the try count".

## C. New in 2.4.0

### 1. Each Windows user's own recorder file (next-userfile)

The owner's item b. The add-on writes each Windows user's saves into that user's own daily file
(`<company GUID>-<day>-<Windows user>.txt`) with `|w=<user>` on every line, from Tally's own `$$SysInfo:WindowsUser`
(proven on real TallyPrime 7.1, run 37580509870). Each user's bridge reads only its own user's files; a line is taken only
when its company is open in that bridge's own Tally too (the 2.4.0 review: "w= alone is not enough"), and the Windows user
is compared whole (DOMAIN\user). This is in the add-on, not a request the bridge sends.

### 2. TDS details: the whole TDS list (next-tds, migration 62)

The owner's decision of 07-Oct-2026 (option A): "Ask for all fields of the TDS list and its sub-list on
FinComVoucherByMaster, FinComVoucherByNumber and test forms A and C. One entry per request, read only, nothing else
added. Work out the rate as tax divided by assessable amount where Tally stores 0, and mark it as worked out."

- With 2.3.4's request: **FinComVoucherByNumber** asks for the two lists whole (its shape 111afcb61eb9 -> 2167477221dc;
  the one allow-list row changed); **FinComVoucherObject is unchanged byte for byte** (Tally sends the whole voucher
  anyway): the bridge keeps every field of the TDS list and its sub-list from it, and still drops everything else.
- The rate: where Tally stores 0, FinCom works it out (tax ÷ assessable amount) and marks it; a line Tally marks exempt
  keeps Tally's own rate and is marked exempt. The TDS tab shows it in words ("2% · rate worked out: Tally stored 0").
  Migration 62 (run it before deploying tally-ingest); without it the rate is stored without the marks.

### 3. Nothing is lost between the bridge and FinCom (next-outbox, migration 63; next-outbox-app)

Every recorder line stays on the computer until FinCom confirms it (also a save across midnight). A line FinCom answers
"failed" is kept and sent again (every 30 minutes after 12 tries, never given up, its tries kept across a restart), and
shown in FinCom under Needs you ("N saves from <computer> could not be stored in FinCom since HH:MM"). FinCom answers a
repeat "already have this line" and never stores or applies it twice (migration 63; without it a repeat is stored as
before).

### 4. Pages refresh by themselves (next-realtime, migration 64)

Look up, the ledger list and Sync activity refresh by themselves when the books change (never a page reload).
Migration 64 adds `tally_book_changes`; without it the pages work as before.

### 5. The nightly self-check (next-selfcheck, migration 65)

The owner's item e. Once a night (22:00 to 06:00, Tally idle, postings first), the bridge checks that every change Tally
made since the last good check reached FinCom, fetches what is missing one entry at a time, never moves past an entry not
confirmed, and FinCom records the result in plain words, shown under the computer's card (More) on the Tally page. ONLY
requests already on the list. The requests the design writes up for the owner's approval (Tally's own trial balance, a
ledger's closing balance; `docs/selfcheck-requests-for-approval.md` 8.5) are NOT built.

### 6. Master hooks (next-masterhook, migration 66)

The owner's item c. **Not shipped in 2.4.0: the add-on hooks no master form.** The owner's rule: only master types
proven on all five TallyPrime releases ship. The real-Tally run 37840646524 (3.0, 4.1, 5.1, 6.2, 7.1) showed Pay Head and
Stock Item failing on every release and Godown on 3.0 to 6.2 (it passed on 7.1 only), so the Pay Head, Stock Item and
Godown hooks next-masterhook added are taken out of the shipped add-on (TestMasterHookNoneShippedIn240). Unit and
Employee are left out too (never hooked). The add-on's Voucher and Ledger hooks and its System Events are as before
2.4.0, so a master's delete goes as a ledger's, as before. The bridge's pairing of master lines stays, inert (no shipped
add-on writes them). Migration 66 stays (add-only, unused). Nothing is asked of Tally.

### 7. Renumbered entries (next-renumber, migration 67)

The owner's decision of 08-Oct-2026: "renumbering yes". After an insert or delete in a voucher type that renumbers, the
bridge reads the later entries FinCom holds again (FinComVoucherObject, one at a time, a stopped one asked once more
5 minutes later) and sends the renumbered ones; FinCom applies Tally's new number (migration 67). What could not be read
is one "Needs you" item: "upload the Day Book from <date>".

**63 and 67 both replace `tally_recorder_line`: both files carry ONE combined text**, so whichever runs last leaves the
same function and neither is lost; each stops (nothing changed) over a version written without its own lines.

### 8. Bank dates set in Bank Reconciliation (next-bankdate)

A bank date set in Tally's Bank Reconciliation (no voucher form, so no add-on line) now reaches FinCom: a small company
by day (the undated list of changed entries, then each entry read again), a large one at night (once, outside office
hours, at most 500 entries). **The nightly list stops at 10 seconds**: 10 s for the nightly bank-date list, outside office hours only, by the owner's decision of 2026-10-09 ("You can take
10 sec"). It is never sent inside office hours (09:00 to 19:00, Monday to Saturday, in the PC's time or in IST), nor when
its 10 s would reach them; every other request keeps the 2-second rule; a time limit only, no request shape changed (the
allow-list table and its hash unchanged). The night's work starts at 19:00 (the end of office hours), not 02:00, by the owner's decision of 2026-10-09 ("Ok";
Tally is usually closed at night): the nightly catch-up, this nightly list and the nightly self-check run at the first
quiet moment from 19:00 (KeepDailyAt, still respected when set by hand) outside office hours up to the next office
start, Sundays included, once a night; a night that did not run (Tally closed all evening) runs at the next evening's
quiet moment (no daytime pieces: splitting the list by AlterID range would change the request, for the owner to approve
first). A company whose bank dates were not read for 3 days: one notice from the tray, once per problem ("Bank dates for
<company> not read since <date>. Keep Tally open for a few minutes after 7 pm, or upload the Day Book."). Stopped, one plain alert ("... bank dates set in Tally may not have reached FinCom;
upload the Day Book from ...") and not asked again that night. Only requests already on the list (TDSDeskKeepList,
FinComVoucherObject).

### 9. The GST and TDS ledgers page and the upload page are simpler (next-ledpage, next-uploadpage; app only)

One status line, Needs you, the tables with one action a row. The owner's decisions of 08-Oct-2026: a regular input
ledger is not reverse charge; the ledger check is kept with the books (pending), no schema change. The Tally data upload
page: one status line, one "Upload Tally data", the days that need a Day Book, how to export.

### 10. Sentry error reports, staging only (next-sentry)

The owner's conditions of 08-Oct-2026 (`docs/sentry.md`): no business data leaves (only error type and scrubbed message,
stack, release, environment "staging", page name, browser/OS, a random install id); no replay, screenshots or feedback;
staging only. App (test build on staging), tally-ingest (staging database), bridge (only when its settings say
`"CrashReports": true` and it is connected to staging). Tested: no made-up business data in any report.

## Tally requests

- FinComVoucherObject replaces FinComVoucherByMaster (A1; the owner's decision of 08-Oct-2026), unchanged since 2.3.4.
- FinComVoucherByNumber: the TDS list and its sub-list whole (C2; the owner's decision of 07-Oct-2026).
- FinComFetchTestA and C removed (A6). Nothing else added or changed: the rest of 2.4.0 sends only requests already on
  the list. Every row is "not yet measured" on NWS144; the decision line quotes each approval (`docs/tally-allowlist.md`).

## Not in 2.4.0

- `next-push` (the full entry at save) and its migration 69: prepared on the side branch `release-240-push`; merged only if
  the coordinator confirms its share checks and save-time table before the freeze.
- `next-inflight`: already in 2.3.3; what was left, a 20-second wait for a single entry, breaks the 2-second rule ("The
  2-second stop itself is unchanged", the owner, 08-Oct-2026). Its merge is reverted.
- `next-reask` (the owner, 07-Oct-2026: "Re-ask a held entry the moment Tally answers again, not every 10 minutes."):
  superseded by 2.3.4's one-more-ask rule and in conflict with the rewritten resolver (the 2.4.0 review). Its merge is
  reverted.
- `next-connect` (paused). The self-check's requests for approval (C5). Master hooks (C6): Pay Head, Stock Item and Godown taken out (run 37840646524), Unit and Employee never in.

No AI in the bridge.
