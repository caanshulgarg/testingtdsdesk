# FinCom Bridge 2.4.9 (branch next-bridge-249, from next-bridge-248 a9cbec7f8)

The owner approved all four points of `docs/bridge-2.4.9-forms-for-owner.md` section 9 on 29-Oct-2026: the request
FinComVoucherBatch (B4, at most 100 entries a request, for the older-entries fetch only, idle only, the per-computer
switch), its list form (B5), the LEDGERENTRIES rule for entries with items, and the slow-group rule (halve, then one by
one). One request was added to Tally's allow-list; no other request changed. No cloud change, no migration, no app
change.

| | |
|---|---|
| Setup file | FinComBridge-Setup-2.4.9.exe |
| Fingerprint | SHA-256 `161adb967539a60e329b84765db926bb6c31acd9bcb52c205693eedc80642fc0` (FinComBridge-Setup-2.4.9.exe, built 29-Oct-2026 13:28 IST at the commit after e3f7dcb8f, bridge sources e16baaf86, POSTONLY=any); program FinComBridge-2.4.9.exe SHA-256 `6e501239f252b5dd8eb1dce7724fb4049af8a65766284e8b6091c09dcf2ccb4f` |
| Replaces | 2.4.8 (kept on the computer, so the tray can roll back to it) |
| Published | not published |

## What is in 2.4.9

1. **Older entries 100 at a time** (bridge-go/batch249.go; daypull.go's pullFetchStep asks pullBatchStep first):
   - After a day's FinComDayHeads, the entries FinCom lacks are asked in groups of up to 100 (keep.json
     `DayPullBatchMax`, 1 to 100, default 100; 1 turns groups off).
   - A run of the day's heads (every head between the first and the last of the group is wanted) goes as the range form,
     `$MasterID >= a AND $MasterID <= b`; scattered entries as the list form, `$MasterID = m1 OR ...`.
   - Payroll entries (Tally's Payroll type, or a type the bridge has learned carries employees' pay heads) are never in a
     group: they go one by one through the 2.4.4 payroll path, their employees first, up to 3 s.
   - The request is exactly the measured one (bridge-go/testdata/batch249/b4-range.xml, TestR249RequestAsApproved),
     pinned to its builder (pinned.go) and let through the dated guard only while it is the group the fetch is asking
     now (tally.go datedRefused, voucherBatchExact: pull.batchAsk), under the 2 s stop, for a company with a starting
     point; refused otherwise whatever ReadDays says.
2. **The converter** (batchConvert, then FinComVoucherObject's strip fastStripWhy):
   - an entry with items keeps its LEDGERENTRIES as its ledger lines and drops the collection's ALLLEDGERENTRIES (which
     also holds the items' sales ledger with the items under it);
   - any other entry keeps its ALLLEDGERENTRIES and drops the collection's extra LEDGERENTRIES copy;
   - the collection's own extra lists VCHLEDINFOS and CATEGORYENTRY (never kept by FinCom; CATEGORYENTRY is read by the
     strip only as a payroll's pay heads, and payroll entries are never in a group) are dropped first.
   - An entry FinComVoucherObject's strip would hold (lines in a place it cannot keep whole) is not taken from the
     group: it stays wanted and FinComVoucherObject reads it one by one, as 2.4.8 does. Real answers of TallyPrime 7.1
     and 3.0 (296 entries a release, run 40750991113): every entry identical to FinComVoucherObject's after the strip,
     none held (TestR249ConverterMatchesObjectOnRealAnswers on a sample kept in testdata/batch249).
   - Each entry keeps the REMOTEID attribute Tally writes on a collection's VOUCHER, equal to its GUID (an approved
     field; FinCom's reader takes the GUID first).
   - What a group gives otherwise than FinComVoucherObject (the gate's field-by-field comparison on the tdsgst and
     payroll test companies, tally-versions mode bdiff, run 40800355969) is never taken from it; that entry is read one
     by one:
     - an "On Account" bill allocation with no name, which every release adds to a bill-wise party's line that has none;
     - TallyPrime 3.0 .. 6.2 leave a line's GST type of supply empty in a group where FinComVoucherObject gives the one
       the ledger or stock item holds ("Goods"): an entry with a line that has a GST nature or taxability and no type of
       supply (empty or left out) is read one by one, every time. Nothing read from one entry is carried to another
       (review round 2, H1 / M1 / M2). So on 3.0 .. 6.2 entries with GST lines go one by one, as in 2.4.8; on 7.1 groups
       give the type and take them.
     - employees' pay heads under an entry's lines (a salary entry of a Tally base type, which the payroll learning never
       learns; review round 1, R1-1 / S-1): the strip with the collection's CATEGORYENTRY must make exactly what it makes
       without it, else the entry is read one by one.
   - The gate's answers on 7.1 and 3.0 (bdiff run 40815068422: tdsgst, TDS challan payments, salary payments per
     employee, stock journals, an optional sales entry) are kept in testdata/batch249/gate-*.zip and compared entry by
     entry in TestR249R1GateAnswersAsObject: 7.1 134 identical, 2 left; 3.0 78 identical, 58 left; none differs.
3. **Checks on every group answer** (fetchVoucherBatch): every entry asked, none more, none twice, all dated the day;
   otherwise the answer is not used and the day goes one by one (one log line). Each entry's GUID is checked against the
   day's list as before.
4. **The slow-group rule**: a group stopped at 2 s (Tally's window answering) is asked again in groups of half its size,
   once (100, then 50: not 25 and less; review R1-8); a half-size group also stopped: one by one. The size a company came
   down to is kept for its next days while its period is read as chosen in FinCom (review R1-4, round 3 L4: chosen again,
   groups of 100 again), so the 2 s stop is met at most twice a company and choice. After a stop the bridge waits for Tally to finish the group (as since 2.3.1) and watches Tally's window
   until then (review R1-2 / S-2): a hold of 2 s or more by then stops the company's period ("window"), and Tally not
   done within TallyAbandonWaitSec (20 s; 60 s at most) stops it too ("over2s"). With TallyAbandonMaxSec 0 (the request
   closed at the stop, so Tally's end cannot be watched) a stopped group stops the company's period, as any stop did in
   2.4.8 (round 3 M1). An answer that is not exactly the entries asked (one more, one missing, one of another date) sends
   that day one by one: safe, at the cost of the day's speed; the log line names the cause (review R1-12, a note). Tally's window not answering for 2 s during a group
   stops the company's period, as in 2.4.5.
5. **Heads, then groups** (the approval, section 6 point 1; review R1-5): a day's heads older than 60 s when a group is
   due (FinCom slow to answer them, a pause) are asked of Tally again first (DayPullHeadsFreshSec).
6. **Uploads** (review R1-3): what was read goes to FinCom in bodies of at most DayPullBatch entries and 4 MB (one entry
   over it at most), so a group of large entries never makes one body FinCom refuses.
7. **The guard and the request** (review R1-10 / S-3, R1-11 / S-5): the dated guard lets a group through only under the
   period fetch's own stop (a copier's background request, not a person's); the FETCH is frozen (its SHA-256 in
   batch249.go, batchFetchSHA): a change of FinComVoucherObject's fields never widens FinComVoucherBatch (the request is
   then not built, and the entries go one by one; round 3 L1).
8. **Known limit** (round 3 L5, Low): on 3.0 .. 6.2 a GST line is told by its GST nature or taxability in the group's
   answer. A line with neither, and no type of supply, is taken from the group. In the gate's field-by-field comparison
   (bdiff run 40834628041 on 3.0, 4.1, 5.1, 6.2 and 7.1, at e16baaf86: the tdsgst, TDS challan, payroll, stock-journal,
   cost-centre, optional and cancelled entries) every entry taken is identical to FinComVoucherObject's answer; the
   answers of 7.1 and 3.0 (run 40815068422) are kept in testdata and compared by TestR249R1GateAnswersAsObject. A ledger whose GST details Tally works out only in the object export is not in that
   data; the field-by-field gate (bdiff) is run on each release before publishing.

## Measured (real TallyPrime, test data)

- The request: tally-versions mode batch, runs 40741546645 and 40750991113 (28-Oct-2026), 3.0 / 4.1 / 5.1 / 6.2 / 7.1,
  ZZ BIG TEST at 30,021 and 100,021 entries: 100 entries 945 ms worst on a day of up to 2,216 entries, 1,405 ms on a day of
  7,601 entries, exact in 6,280 requests; `docs/bridge-2.4.9-forms-for-owner.md`.
- Field by field (tally-versions mode bdiff, run 40834628041 at e16baaf86, all five releases): every entry taken from a
  group identical to FinComVoucherObject's answer (7.1: 142; 3.0 .. 6.2: 86 each), 0 differ, 0 missing; the rest left
  for FinComVoucherObject.
- The real-Tally gate of this build (the committed setup 161adb96...42fc0 installed on each release, branch
  tally-batch249, local_dist=yes; review round 5 checked these against the runs' summaries):
  - upg (2.4.9 over the published 2.4.8, a9cbec7f8, setup 030f4303...d83f): PASS c1, c2, u1-u4 on 3.0 (run 40838981120)
    and on 4.1, 5.1, 6.2, 7.1 (run 40875226108; in 40838981120 their results did not reach the branch).
  - g245 (ZZ BIG TEST, about 30,000 entries, Apr-Sep fetched, 7,852 entries FinCom lacked), every check PASS: 7.1 in run
    40838981120 (13 of 13); 3.0, 4.1, 5.1 in run 40850921512 and 6.2 in run 40873289822 (13 of 13 each). The earlier g3
    FAILs on 3.0 .. 6.2 (40838981120, and 6.2 in 40850921512) were the harness counting an entry asked once in a group
    and then read alone (left by the group: a GST line without a type of supply), alone or after a group cut for a
    posting, as "asked twice"; the harness counts them apart since afafc3a0a and 02f2bc53d. The harness's own figures in
    the passing runs: asked twice 0 on all five; left by a group and read alone 4,768 (3.0, 4.1, 5.1) and 4,278 (6.2,
    where 490 more were cut for a posting first).
  - Speed, the night pace (g10, entries a minute while the bridge reads; the same runs): 7.1 2,801 (1,00,000 entries in
    about 36 min); 3.0 601, 4.1 605, 5.1 623, 6.2 624 (1,00,000 in about 160-166 min), where ZZ BIG TEST's GST entries go
    one by one. 2.4.8's pace on the same data: about 430 a minute; 2.4.5: 165.
  - No request over 2 s, one at a time, Tally's window never held 2 s (g4 PASS on all five).
- CI 40839005998 (at 8e6208992): attempt 2: app, bridge-linux, bridge-linux-typed green; the shares red only on tests
  red on staging-next without 2.4.9 (CI 40855347982: run_migration_grants, run_renumber_list, run_recorder_server,
  run_older_entries_ui, run_cors_preflight, run_stability), plus run_fast_reopen (share 2, a timing check under a 2x CPU
  slow-down) and share 5's Python packages step (infra). Attempt 3 (the one rerun): shares 2, 5 green; run_open_line's
  "2 script files at once ahead (5)" red in share 3, green in attempt 2 and red the same way on staging-next's own build
  (integ-249, no app file changed by 2.4.9). Windows CI 40839003581 attempt 2: green.
