# FinCom Bridge 2.4.9 (branch next-bridge-249, from next-bridge-248 a9cbec7f8)

The owner approved all four points of `docs/bridge-2.4.9-forms-for-owner.md` section 9 on 29-Oct-2026: the request
FinComVoucherBatch (B4, at most 100 entries a request, for the older-entries fetch only, idle only, the per-computer
switch), its list form (B5), the LEDGERENTRIES rule for entries with items, and the slow-group rule (halve, then one by
one). One request was added to Tally's allow-list; no other request changed. No cloud change, no migration, no app
change.

| | |
|---|---|
| Setup file | FinComBridge-Setup-2.4.9.exe |
| Fingerprint | (filled in at the build) |
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
   answer. A line with neither, and no type of supply, is taken from the group; in the gate's data (bdiff, every entry
   of the tdsgst, TDS, payroll and stock-journal companies on all five releases) every such entry taken is identical
   to FinComVoucherObject's answer. A ledger whose GST details Tally works out only in the object export is not in that
   data; the field-by-field gate (bdiff) is run on each release before publishing.

## Measured (real TallyPrime, test data)

- The request: tally-versions mode batch, runs 40741546645 and 40750991113 (28-Oct-2026), 3.0 / 4.1 / 5.1 / 6.2 / 7.1,
  ZZ BIG TEST at 30,021 and 100,021 entries: 100 entries 945 ms worst on a day of up to 2,216 entries, 1,405 ms on a day of
  7,601 entries, exact in 6,280 requests; `docs/bridge-2.4.9-forms-for-owner.md`.
- The gate (this build): see the release log row and the test sheet (bdiff on the tdsgst and payroll companies, g245 with
  the night pace, upg from 2.4.8, on all five releases).
