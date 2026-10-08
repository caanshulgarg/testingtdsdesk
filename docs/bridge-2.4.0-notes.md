# FinCom 2.4.0: release notes

For the owner. Plain words; times are IST. The steps to try it on NWS144 are in `docs/bridge-2.4.0-test-sheet.txt`.
Built on 2.3.5 (branch `release-240`, from `release-235`), with the branches `next-userfile`, `next-tds`,
`next-outbox`, `next-realtime`, `next-selfcheck`, `next-masterhook` and `next-renumber` merged in, in that order.
`next-inflight` and `next-reask` are NOT in it (the 2.4.0 review: superseded by 2.3.3-2.3.5; their merges reverted, see
below). `next-connect` (paused) and `next-push` (the full entry at save, with migration 69: still being finished) are not
in it.

| | |
|---|---|
| Setup file | FinComBridge-Setup-2.4.0.exe |
| Fingerprint | (filled in when the setup is built) |
| FinCom app | changed: pages refresh by themselves (Realtime), the nightly self-check's line on the Tally page |
| FinCom's cloud | migrations 62, 63, 64, 65, 66 and 67 (`server/tally-cloud/`, each add-only; NOT run; the owner runs them, after 2.3.5's 68): staging ... -> 60 -> 68 -> 62 -> 63 -> 64 -> 65 -> 66 -> 67 (`docs/MIGRATION-ORDER.md`). tally-ingest changed (below); until a migration runs, its part waits (each item says how) |
| Replaces | 2.3.5 (kept on the computer, so the tray can roll back to it) |
| Add-on | changed: load the new `FinComRecorder.tdl` (each Windows user's own file; the Pay Head, Stock Item and Godown forms) |
| Tally requests | ONE changed, with the owner's approval (item 2): FinComVoucherByNumber also asks for the whole TDS list. None added. FinComVoucherObject unchanged byte for byte |

## What changes

### 1. Each Windows user's own recorder file (next-userfile)

The owner's item b. On a computer where several Windows users run Tally, the add-on now writes each user's saves into
that user's own daily file (`<company GUID>-<day>-<Windows user>.txt`) and puts `|w=<user>` on every line, from Tally's
own `$$SysInfo:WindowsUser` (proven on real TallyPrime 7.1, run 37580509870). Each user's bridge reads only its own
user's files (and the older shared ones). This is in the add-on, not a request the bridge sends.

### 2. TDS details on payments: the whole TDS list (next-tds, migration 62)

The owner's decision of 07-Oct-2026 (option A): "Ask for all fields of the TDS list and its sub-list on
FinComVoucherByMaster, FinComVoucherByNumber and test forms A and C. One entry per request, read only, nothing else
added. Work out the rate as tax divided by assessable amount where Tally stores 0, and mark it as worked out."

- Since that decision, 2.3.4 replaced FinComVoucherByMaster by FinComVoucherObject and removed the test forms A and C
  (the owner's decisions of 08-Oct-2026). So in 2.4.0: **FinComVoucherByNumber** asks for the two lists whole (its shape
  111afcb61eb9 -> 2167477221dc; the one allow-list row changed); **FinComVoucherObject is unchanged byte for byte**
  (Tally sends the whole voucher anyway): the bridge now keeps every field of the TDS list and its sub-list from it, and
  still drops everything else before anything is logged, stored or sent.
- The rate: where Tally stores 0 (an entry keyed on Tally's screen, run 37492981527), FinCom works it out as tax divided
  by assessable amount and marks it as worked out (migration 62, `tally_tds_lines.rate_worked_out`). Without 62 the
  worked-out rate is stored without the mark.

### 3. Nothing is lost between the bridge and FinCom (next-outbox, migration 63)

- Every recorder line stays on the computer until FinCom confirms it, including a save whose two halves sit in two
  daily files across midnight; the sent marks are never rotated away while a line is still unconfirmed.
- Each line says whether it is a deliberate resend; FinCom answers a repeat of a line it already has "already have this
  line" and never stores or applies it twice (migration 63). Without 63, a repeat is stored as before.

### 4. Pages refresh by themselves (next-realtime, migration 64)

Look up, the ledger list and Sync activity refresh by themselves when the books change (1.5 s after the last change, one
refresh at a time; never a page reload). Migration 64 adds `tally_book_changes` (one row per book) and puts it and three
small tables in Realtime; the copy's own tables are not published. Without 64 the pages work as before.

### 5. The nightly self-check (next-selfcheck, migration 65)

The owner's item e. Once a night (22:00 to 06:00, Tally idle, postings first), for each company open in the bridge's
own Tally, the bridge checks that every change Tally made since the last good check reached FinCom, fetches what is
missing one entry at a time, and FinCom records the result in plain words, shown on the Tally page's card for that
computer. It sends ONLY requests already on the list. The requests the design writes up for the owner's approval
(Tally's own trial balance, a ledger's closing balance; `docs/selfcheck-requests-for-approval.md`, 8.5) are NOT built.
Without 65 the check has nowhere to record and the card shows nothing.

### 6. Master hooks: Pay Head, Stock Item and Godown (next-masterhook, migration 66)

The owner's item c. The add-on also hooks the Pay Head, Stock Item and Godown forms (heads only: type, name, parent,
GUID, MasterID, AlterID), proven on real Tally (run 37580509870). **Unit and Employee are left out**: a Unit whose symbol
was changed did not save with the hook, and no form name fires for Employee. Such a master's delete is never sent as a
ledger's. Nothing is asked of Tally for them. Migration 66 keeps them (`tally_recorder_masters`); without 66 such lines
are kept as failed with words, nothing in the books changes.

### 7. Renumbered entries (next-renumber, migration 67)

The owner's decision of 08-Oct-2026: "renumbering yes". When an entry is inserted or deleted in a voucher type that
renumbers, Tally renumbers the later entries without moving their AlterIDs. After such a line is taken by FinCom, the
bridge asks FinCom which later entries of that type it holds, reads each again from Tally (FinComVoucherObject, already
on the list) and sends the renumbered ones; FinCom applies them with Tally's new number (migration 67: "renumbered in
Tally: Receipt 191 is Receipt 192 now"). Without 67 such a line is 'duplicate' and the copy keeps the old number.

**63 and 67 both replace the same cloud function** (`tally_recorder_line`): both files carry ONE combined text (63's
repeat check and 67's renumbering), so whichever runs last leaves the same function and neither is lost.

## The cloud

- Migrations 62, 63, 64, 65, 66, 67: add-only, one transaction each, safe to run twice, nothing deleted; NOT run. Their
  md5s are in the test sheet.
- tally-ingest (deploy with the migrations): keeps each line's "again" and answers repeats (63); master lines (66);
  the self-check's records (65); the renumber list (67, read only).

## Not in 2.4.0

- `next-push` (the full entry at save) and its migration 69: to be merged when finished; 69 then carries the same
  combined text of `tally_recorder_line`.
- `next-connect` (paused).
- `next-inflight` (one request in flight per Tally): already in 2.3.3 (the bridge sends nothing to a Tally still working
  on a request it stopped waiting for); what was left, a 20-second wait for a single entry, breaks the 2-second rule
  ("The 2-second stop itself is unchanged", the owner's decision of 08-Oct-2026 for 2.3.4). Its merge is reverted; the
  2-second stop stays.
- `next-reask` (the owner, 07-Oct-2026: "Re-ask a held entry the moment Tally answers again, not every 10 minutes."):
  largely superseded by 2.3.3-2.3.5's one-more-ask rule (a held line is asked once more at the next try) and in
  conflict with their rewritten resolver (the 2.4.0 review). Its merge is reverted.
- The self-check's requests for approval (item 5).
- Unit and Employee master hooks (item 6).

No AI in the bridge.
