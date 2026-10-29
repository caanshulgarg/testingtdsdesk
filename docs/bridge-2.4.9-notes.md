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
3. **Checks on every group answer** (fetchVoucherBatch): every entry asked, none more, none twice, all dated the day;
   otherwise the answer is not used and the day goes one by one (one log line). Each entry's GUID is checked against the
   day's list as before.
4. **The slow-group rule**: a group stopped at 2 s (Tally's window answering) is asked again in groups of half its size;
   a half-size group also stopped: the day goes one by one. Tally's window not answering for 2 s during a group stops the
   company's period, as in 2.4.5 (freeze safety, unchanged).

## Measured (real TallyPrime, test data)

- The request: tally-versions mode batch, runs 40741546645 and 40750991113 (28-Oct-2026), 3.0 / 4.1 / 5.1 / 6.2 / 7.1,
  ZZ BIG TEST at 30,021 and 100,021 entries: 100 entries 945 ms worst on a day of up to 2,216 entries, 1,405 ms on a day of
  7,601 entries, exact in 6,280 requests; `docs/bridge-2.4.9-forms-for-owner.md`.
- The gate (this build): see the release log row and the test sheet (bdiff on the tdsgst and payroll companies, g245 with
  the night pace, upg from 2.4.8, on all five releases).
