# Bulk posting with the recorder loaded (owner, 04-Oct-2026)

Case: FinCom posts 2,000 entries to Tally, 50 per request, with the add-on loaded. Six requirements, each with its design
and its test. Where a test names a release, it is built there.

## 1. Trial on ZZ TEST
docs/recorder-trial-sheet.txt PART 3B: "Make N test copies", 100 then 500 entries, add-on loaded and then off, "note change
numbers" before and after each, "send results" after each round.
Reported from the two sends:
- the import time per posting;
- the delay per entry, (with - without) / entries, from the bridge's request timings in milliseconds (the add-on's clock,
  $$MachineTime, counts whole seconds only);
- the lines written, by event;
- whether the import events (Start Import, Import Object, After Import Object, End Import) fire for entries arriving
  through Tally's HTTP port;
- the rise in Tally's change number (ALTVCHID) per posting.

## 2. A short line for FinCom's own entries
Design: when the entry's narration carries "TDSDesk:<id>", the add-on writes only:
- the company GUID;
- the voucher GUID, MasterID and AlterID;
- the FinCom id;
- the event and the time.
It does not write the ledger lines, bill allocations, GST details or inventory.

Is it possible in TDL? Yes, as a condition on the narration (a substring test on $Narration) choosing between two line
builders in the one writer function. The FinCom id is the text after "TDSDesk:" up to the first space. The exact string
function is confirmed on NWS144 before the real add-on is written (docs/recorder-trial-review.md lists the candidates and
the fallback).
- If the id cannot be cut out in TDL, the line carries the full narration instead.
- FinCom's narrations are short, so the line stays short.
- The cloud cuts the id out with the same rule as parse.js (tally_vouchers.fincom_id).

The trial add-on already writes heads only (no ledger lines). So the trial measures the cost of the short line itself.

What it saves:
- the full line of an entry is its whole voucher, ~2-6 KB with GST and bill allocations;
- the short line is ~250 bytes;
- for 2,000 posted entries that is ~4-12 MB of file, upload and storage against ~0.5 MB;
- on each save, the add-on does less work while the import runs (measured in 1: the delay per entry).
FinCom already holds what it posted (tally_post_jobs.payload keeps every voucher's XML). So nothing is lost: the copy's
entry is built from FinCom's own posted XML plus the GUID, MasterID and AlterID from the short line (4.).

## 3. No false alarm after a bulk posting
The missing-changes check compares Tally's change number (ALTVCHID) with what was received. If Tally does not fire the
import events for port imports, 2,000 posted entries would raise ALTVCHID by at least 2,000 with no recorder lines.
Without this design that shows as "up to 2,000 changes not received".

Design: FinCom's postings are accounted from their own record.
- (a) The posting window, from the bridge (2.2.0).
  - The company check before each posting job already reads FinComCompany. The bridge keeps its ALTVCHID as a0.
  - After the job ends, the bridge sends one more FinComCompany read, a1. That is one light request per job, never
    during a posting.
  - It sends both with the job's last posts_update, together with the counts from Tally's replies: vouchers created
    and masters created.
  - The cloud stores the window per book: a0, a1, created vouchers and created masters.
- (b) The cloud (migration 45) subtracts the accounted changes. A window counts as fully accounted when
  a1 - a0 = created vouchers + created masters, so nobody else changed anything while it ran.
  - Missing = ALTVCHID - baseline - (the accounted changes of the windows above the baseline).
  - A window that does not fully account leaves "up to (a1 - a0 - created) changes not received during the posting
    of <time>". That is a real possible gap, still an upper bound.
- (c) Fallback when no window was sent (2.1.x bridges, or a1 not read): the vouchers created by FinCom's postings
  accepted after the last match, and not yet matched by a recorder line, are subtracted.
  - The result stays an upper bound for vouchers.
  - Ledgers FinCom created in the posting can leave a small remainder. It is named in the flag as "of which up to
    k may be FinCom's own new ledgers".
- A posted entry later matched by a recorder line (4.) is counted once: either through recorder_max_alter or through
  the window, never both. The window's credit applies only to entries without a recorder match.

Test (cloud, migration 45, run_migration45.py + run_recorder_server.py): post 100 with the add-on unable to see imports.
- The book's starting point is 1000. A job of 100 bills, replies "created 1" each. The window is a0 = 1000,
  a1 = 1100, with 100 created vouchers. No recorder line arrives. Then the beat brings ALTVCHID 1100.
- Expected: no gap; last_match_at set.
- The same without a window (fallback): no gap.
- A window with a1 = 1103 (3 changes by a person during the posting): "up to 3 changes not received during the posting
  of <time>".

## 4. No doubling: a posted entry coming back lands on FinCom's entry
A recorder line (short or full) whose FinCom id matches a live, accepted tally_post_ids row of the firm, for the same
book, is applied as follows:
- tally_post_ids gets matched_at, matched_vch (the voucher number), and the GUID, MasterID and AlterID. That is
  "Matched with Tally" on the bill or bank line in FinCom.
- The copy's entry (tally_vouchers, by its GUID) is built once:
  - from the line's body when it has one;
  - otherwise from FinCom's own posted XML in the job's payload, parsed by parse.js in tally-ingest, with the line's
    GUID and AlterID.
- A later arrival of the same entry has the same GUID, so it is updated in place:
  - a full line;
  - a Day Book upload;
  - the same line from a second PC.
  It never makes a second entry.
- A short line whose FinCom id matches nothing is held with its words: never a new entry, never a guess.
Test (cloud): 500 posted entries (a job of 500, accepted, with payload XML), 500 short lines.
- Expected: 500 matched, 500 entries in the copy, 0 held, 0 duplicate.
- The same 500 lines again: 500 duplicate, still 500 entries.
- Then the Day Book upload of that day: still 500 entries, versions kept, the trial balance unchanged.

## 5. The holding file during a bulk posting (bridge 2.2.0)
- The folder watcher reads new lines as they arrive. The uploader sends them in groups of at most 500 lines or 1 MB,
  whichever comes first. Each group is marked sent only after the cloud confirms it.
- A posting always goes first. While a posting job is running, the uploader sends between two posting requests, never
  during one. It sends at most one group per gap, and only if the next posting request is not ready. When the job ends,
  it catches up group by group.
- Nothing unsent is dropped. The file is never locked by the bridge: it reads with sharing, and the add-on keeps writing.
- Test (Go, fake add-on writer and fake Tally): a posting of 2,000 in 40 requests while the fake add-on writes 2,000 lines.
  - The stand sees every posting request start no later than it would without the uploader (no request waits on an
    upload).
  - All 2,000 lines reach the fake cloud in groups of 500 or fewer, each once, in order.
  - The last group goes within 30 s of the job's end.

## 6. The touched-ledger check waits for the posting to end (bridge 2.2.0)
- While a posting job runs, the ledgers touched by recorder lines are collected, not checked.
- When the job ends (done, failed or stopped), the check runs once over the union of those ledgers, after the posting
  window read of 3(a).
- A second posting job queued behind it postpones the check again; it runs once after the last job.
- Test (Go): a job of 2,000 entries touching 30 ledgers. No ledger check request is sent during the job; exactly one runs
  after it, over the 30 ledgers. Two jobs back to back give one check after the second.

## 7. Can the add-on hang or slow Tally (the owner's seven questions)
What the add-on does per event (bridge-go/addon/FinComRecorderTrial.tdl, function FCRLog):
- **Reads:** the company GUID (one company lookup), and these of the object being saved: Name, Parent, VoucherTypeName,
  Guid, MasterID, AlterID, VoucherNumber, Date and Narration. It also reads the user name and the machine date and time,
  three times.
- **It never reads** ledger lines, bill allocations or inventory. So the work per event is the same for a 2-line and a
  50-line voucher.
- **Writes:** one line of about 300-600 characters (UTF-16, so about 0.6-1.2 KB), with one open, two writes and one
  close of the holding file.
- **Events per entry:** a screen save is 2 events (before and after Form Accept), so 2 lines. An imported entry is up to
  2 lines (Import Object, After Import Object), plus 2 lines per import request (Start Import, End Import).

1. **The file is locked** (by antivirus or by anyone else).
   - Code path: OPEN FILE (line 26) fails, and $$LastResult is No. The line is redirected (28) to failed.txt (29).
   - If failed.txt cannot be opened either, FCRLog returns Yes (31) and nothing is written.
   - Tally's save goes on in every branch. The Form Accept line is unconditional, and every handler returns Yes.
   - The TDL itself has no wait and no retry.
   - Not yet known until it is tested on NWS144: whether Tally's own OPEN FILE waits on a locked file before it gives
     up, or shows its own error. Test: tray item "Recorder trial: lock the holding file for 30 s" (sheet PART 3C).
   - A line lost in the last branch is still caught by the missing-changes check ("up to N changes not received").
2. **The bridge never writes, locks or holds the holding file.**
   - It reads it read-only with full sharing (read, write and delete) and closes it at once. Watching uses the file's
     size and time only.
   - The change-number notes moved out of the recorder folder (2.1.9 review, finding 2).
   - Tests: a Go test that no bridge code writes, renames or deletes there. Windows-only tests on the Windows CI
     runners: a writer can append while the bridge reads, and a read of a locked file gives up at once, without
     waiting.
3. **No message box from the add-on.**
   - The TDL has no Message, Query, Log or Display action, and no menu, key or button.
   - A failure is noted silently in failed.txt, which the bridge sends with the trial results.
   - Whether Tally itself shows anything on a locked file is part of test 1.
4. **Time per save.** Not measured yet: it needs Tally. Tray item "Recorder trial: time saving (ZZ TEST)" imports
   50 small (2-line) and 50 large (50-line) vouchers, with the add-on loaded and then off, antivirus on. It reports the
   milliseconds per entry (median and 90th percentile). Tally's TDL clock counts whole seconds, so the bridge times it.
5. **Bulk import of 100 and 500, on and off:** sheet PART 3B. The added time is (with - without), in total and per
   entry.
6. **The off switch.**
   - Unload the add-on in F1 > TDLs & Add-Ons > Manage Local TDLs (sheet PART 4). TallyPrime applies this without a
     restart.
   - Posting never depends on the add-on: the bridge posts through Tally's port either way.
   - Test (sheet PART 3C): unload without closing Tally, then save one voucher and post one test bill. Expected: no
     line after the unload time, and the posting goes through.
7. **The limit.** I recommend not using the add-on if any of these is measured:
   - more than **100 ms added per save** (median), or more than 250 ms at the 90th percentile. A person starts to feel
     a save as slower at around 100 ms;
   - more than **25 % added** to a bulk import's total time;
   - **any** wait on the locked file, or any message from Tally.
   Below these limits, the add-on is used.
