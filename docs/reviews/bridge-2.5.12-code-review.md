# Code review: FinCom Bridge 2.5.12 (a voucher-mode sale read; one entry never sinks a day; day lists by range)

Reviewers: the session that built it (a self-review against the owner's rules, below). An independent review is the
coordinator's.

Range: ff86083bf..f1b3e700b (origin/staging-next, which holds released 2.5.11, to the version bump)

(bridge-go/: fastvch.go (liveKeepInv2512, the strip keeps a ledger line's stock items in an entry with no item of its
own, fastEmit writes them after the line's own fields, fastVoucherModeItems writes them as the entry's items too,
fastHasItems / fastOKNoInv), batch249.go (the four fields in FinComVoucherBatch's FETCH, the frozen SHA, pullKeep),
range2512.go (new: the range form of FinComDayHeads), pinned.go and daypull.go dayHeadsExact (the range form pinned and guarded), daypull.go (pullHoldEntry, pullHeldHead, pullKeep, pullEntryMax, the "held" list in period_entries), allowlist.go (the
FinComVoucherBatch row's words; the stock row's version word), util.go (2.5.12); tests r2512_test.go (new), the version
tests, fast234review_test.go / fast234rr_test.go (voucher mode is read now; the hold tests use items in INVENTORYENTRIES,
still held), fast234form_test.go (the approved paths' count), r249batch_test.go (the 2.5.12 request files; 2.4.9's
shape kept as history), stock251_test.go (the history rows as 2.5.11's), testdata: the five voucher-mode goldens,
batch249/b4-range-2512.xml and b4-list-2512.xml. tests/run_parse_fast234_kinds.mjs (nothing held now).
docs/tally-allowlist.md, docs/bridge-2.5.12-test-sheet.txt.)

## The case (staging, 09-Nov-2026)

The older-entries day read lost whole days: a marketplace sale entered in voucher mode keeps its stock item under the
sales ledger's line (ALLLEDGERENTRIES.LIST > INVENTORYALLOCATIONS.LIST). The strip held such an entry ("its lines in
ALLLEDGERENTRIES.INVENTORYALLOCATIONS, which FinCom's entry request does not read"), the group read left it for the
one-entry read, which returned fastShapeError, and pullFetchStep marked the whole day "upload by hand" with the reason
dropped (pullMarkUpload(w, "shape", "")). On one real book 62 days of 223.

## 1. The voucher-mode sale is read (fastvch.go, batch249.go)

- liveKeepInv2512: ALLLEDGERENTRIES.INVENTORYALLOCATIONS.STOCKITEMNAME, BILLEDQTY, RATE, AMOUNT: the item fields an item
  invoice's items carry (ALLINVENTORYENTRIES: name, billed quantity, rate, amount). No godown or batch (no list keeps
  them for ALLINVENTORYENTRIES either), no ACTUALQTY.
- Kept only in an entry with no item of its own (fastHasItems false). An entry with items strips exactly as in 2.5.11:
  a collection's item invoice repeats its items under the sales line and none of that is kept (TestFast234StripCaptures'
  by-number goldens unchanged); a stock item under a ledger line BESIDE items is held as before (TestR2512VoucherModeKept).
- Written inside the ledger line after its own fields (fastEmit defers INVENTORYALLOCATIONS.LIST under
  ALLLEDGERENTRIES), so the line's own AMOUNT is the first a reader meets (parse.js one(e, "AMOUNT"), the bridge's
  voucherLines). Real TallyPrime already writes the line's AMOUNT first (3.0 .. 7.1 captures); the order is a guard.
- fastVoucherModeItems also writes each such stock item as one of the entry's items (ALLINVENTORYENTRIES.LIST with the
  four fields and ACCOUNTINGALLOCATIONS: the line's LEDGERNAME, ISDEEMEDPOSITIVE, the item's AMOUNT), exactly the form
  Tally's own Voucher collection gave for such an entry (FinComVoucherByMaster, the entry request up to 2.3.3:
  sales-voucher-mode-items-bymaster.xml.gz). Result: parse.js reads the stripped object of the voucher-mode invoice on
  3.0, 4.1, 5.1, 6.2 and 7.1 field for field as it read that request's answer, items included
  (tests/run_parse_fast234_kinds.mjs: 112 entries, 0 held, all ok). Only approved paths are written.
- The one-entry request (FinComVoucherObject) is byte for byte 2.5.11's: its FETCHLIST is liveFetchFields, unchanged
  (Tally sends the whole voucher anyway). The four fields go into FinComVoucherBatch's FETCH (and so
  FinComVoucherWindow's, the same frozen text) after the payroll's, with their LEDGERENTRIES copies at the end, as every
  ALLLEDGERENTRIES field: +372 bytes on a 7,629-byte request; the answer of an entry without such lines is unchanged
  (TestR2512OrdinaryVouchersUnchanged: every fast234kinds and batch249 capture strips the same with and without the four
  fields). batchFetchSHA is the new text's (0896778656af...), computed independently from b4-range.xml plus the fields.
- In a group's answer Tally may list a voucher-mode entry's items itself (as its collections do): the entry then has
  items, nothing of 2.5.12 applies, and if its ledger lines still carry the stock item the strip holds it and the group
  leaves it for FinComVoucherObject (as before), which reads it. Either way it is read; not measured on real Tally.

## 2. One entry never sinks a day (daypull.go)

- errFastShape in pullFetchStep, and an entry larger than tally-ingest takes (2 MB, MAX_RECORDER_XML: it refused the
  whole call, which marked the day), go to pullHoldEntry: the entry leaves the wanted list, the day's other entries are
  read and sent as on any day, and the day is NOT marked upload.
- The cloud has no "day done except entry X". The closest existing mechanism is used, no cloud change: the day's held
  count (tally_period_days.held_n). The entry goes in period_entries as its head only (GUID, MASTERID, ALTERID, DATE,
  VOUCHERTYPENAME, as FinComDayHeads gave them; no ledger line). tally-ingest periodEntries takes a voucher Tally gave that
  parse.js makes no entry of as seen at its AlterID (the rule for stock journals and delivery notes), tally_period_held
  counts it, and the day is done. Asked again only when its AlterID moves.
- The reason, with the voucher type and MasterID and the fastShapeError's own words ("Sales entry (MasterID 701) of
  15-Sep-2025 held: Tally keeps this entry with its lines in INVENTORYENTRIES, which FinCom's entry request does not
  read; upload that day's Day Book to settle it"), goes in the same call as "held": [{guid, masterId, alterId, type,
  why}] (today's tally-ingest ignores the key; nothing is refused), in the bridge's log (writeLog), and once in the
  tray's activity (liveSayOnce). It is never dropped.
- Its lines are not in FinCom's books until the Day Book is uploaded. Without a GUID in the day's list (never seen) the
  day is marked as before.
- To show it on the Tally page, tally-ingest would keep body.held (e.g. its words in tally_period_days, or a held row):
  not done here (no cloud change, no deploy).

## 3. Day lists by range (range2512.go; the owner's approval of 09-Nov-2026: "Yes but no missing days at all", "and no hang of Tally at all")

- dayHeadsRangeRequest: FinComDayHeads exactly (formCollection, formPlainT, F1's four fields), SVFROMDATE < SVTODATE, 2 to
  31 days. pinned.go rebuilds it from its dates; dayHeadsExact lets it through only while it is the range being asked
  (pull.rangeAsk) and every day of it is in pull.items for that company, under the same 2 s TC.
- pullRangeStep runs in pullStep's heads phase after pullMayAskWhy (the six conditions, typing gate, postings first) and
  before one day's list; FastEntries on, a split day, or a day whose range answer was not used: one day's list as before.
- The range: consecutive days from the current one that pull.items holds for the same company, GUID, choice, kind,
  fetch and types, not finished, not marked, not already holding a range list; never a day FinCom did not hand out.
- The answer is used only whole: envelope with its end, no LINEERROR, every row dated inside the range, every
  <VOUCHER opening a counted row, rows <= DayPullHeadsMax. Otherwise nothing is used (w.noRange; each day asks its own
  list; the company's later ranges are single days). A row dated outside the range thus never gets dropped.
- Used: the current day's list into w.heads; each other day's list kept by its day key with the time; the day's own
  turn takes it (once) while fresh (pullHeadsFresh, the group read's rule), else asks its own list. Each day then goes
  through pullSendHeads as before (an empty day: n 0, heads []), so FinCom's per-day claim and count are unchanged and
  tally-ingest needs nothing.
- No hang: errRecorderStop (over 2 s) -> pullStopCompany("over2s"), Tally's window held 2 s -> "window", exactly as one
  day's list (never retried); the size starts at 7 per company and choice, pullRangeNext doubles under 1 s (31 at most),
  halves over 1 s; a day of more than 200 rows sets single days.
- The stand Tally (tests) answers FinComDayHeads for its dates' range.

## 4. Tests

r2512range_test.go: every day of a 7-day sparse stretch told (empty days as 0) in one list request, entries as before;
only consecutive listed days together (a day not handed out never told); outside-range row / cut / Tally error: nothing
used, each day alone, all told, sizes to 1; over 2 s: the company stopped, no day told, not asked again; the halving and
the 31-day cap, a 1.2 s answer halving 7 to 3, a 201-entry day ending ranges; the guard.

## 5. Tests (the voucher-mode and held-entry parts)

r2512_test.go: the voucher-mode strip (order, fields, mapped form, from a group, beside items, a collection's item
invoice), the five real releases, ordinary entries unchanged, the request = 2.4.9's + the fields (and the 2.5.12 file),
a day with one unreadable entry (one by one and in groups: the others sent as the strip makes them, the held head as
tally-ingest takes it, the reason with its type in "held" and the log, no upload mark, not asked again when listed again),
an oversize entry held alone, the version, the allow-list (the table is 2.5.11's but for the one row).

## Verdict

Ship after the coordinator's review and a measurement on real TallyPrime of FinComVoucherBatch with the four fields and of FinComDayHeads for a range of days.
