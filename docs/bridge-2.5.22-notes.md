# FinCom Bridge 2.5.22 – notes (branch next-bridge-2522, from 2.5.21 at e5a689f58)

The version is 2.5.22 (util.go). **No new request to Tally, and no request sent more often**: the allow-list holds the
same 54 requests as 2.5.21, and its table and hash are unchanged (86bfeef4...; the stock row keeps "unchanged in
2.5.21"); only the decision and dated lines name 2.5.22, by the owner's standing decision of 2026-10-06. The same rules
as before: a request at most 2 s, one in flight, postings first, the typing gate, only this user's own Tally (no
tally.ini of another user, nor a shared one, is ever written). Use a test company with made-up entries only.

## What changes

The owner's decision of 24-Nov-2026: "There should be proper way to tell and auto import of tally days into fincom"
(findings/tally-tell-autoday-plan.md, A.4). The heartbeat says, per company FinCom linked, why it cannot be read. Codes
only: FinCom's cloud owns the words (migration 221, tally-ingest's tellOf). Every field is optional: a cloud before
them ignores them.

```
"skip":       { "<company>": "ownerUnknown" | "twoTallys" | "otherLogin" | "notOpen" | "otherCopy" | "slow" },
"numbersWhy": { "<company>": "ownerUnknown" | "twoTallys" | "lightFailed" | "over2s" | "notAsked" },
"addonSilent":[ { "company": "...", "guid": "...", "reason": "addonShared" | "addonAdded" | "noFile" | "fileUnreadable",
                  "since": "<RFC3339 UTC>", "tallyAlter": 95937, "lastLineAlter": 95888 } ]
```

1. **skip** (tell2522.go): from the company list the bridge holds. twoTallys: open on two or more of this user's own
   Tallys. otherCopy: open once, and the last pick-up was refused otherCompany. slow: open once, and the company is
   marked slow (over 2 s) or its last pick-up was refused slow / dayRetry. ownerUnknown: not in this user's own Tally,
   but on a Tally whose owner Windows cannot tell (run as administrator). otherLogin: only on another Windows user's
   Tally, or its last pick-up was refused otherLogin. notOpen: this user's Tally answers without it. No entry when the
   company is read, or when no Tally of this user answers (tallyWhy says that for the computer).
2. **numbersWhy**: for a company seen open with no change numbers (no altvchid) in this run: twoTallys, ownerUnknown,
   the light check's last result (over2s: stopped at 2 s or Tally did not answer in time; lightFailed: it went and gave
   no numbers), else notAsked.
3. **addonSilent** (addonsilent2522.go): the company is open in this user's own Tally; a light check taken after the
   add-on's last line of the company gave a voucher counter at least 1 above the first such check (since: that check's
   time); no add-on line has come for 15 minutes since. A line clears it at once. The reason from the tally.ini step's
   results the bridge holds: a shared tally.ini (FinCom never adds the add-on there): addonShared; FinCom's line in this
   user's own tally.ini while Tally loads nothing: addonAdded (Tally loads it when started again); a tally.ini that
   could not be read: fileUnreadable; else noFile. lastLineAlter is the highest AlterID an add-on line of the company
   carried in this run (0: none in this run). A new key: recorderStuck stays the cloud's own.
4. **The own-Tally privacy rule**: skip, numbersWhy and addonSilent name ONLY companies FinCom's cloud named to this
   bridge as linked books (the beat answer's booksFrom with a day, kept 7 days while not named again; and the first
   days FinCom gave before, fincom-books-from.json). A company on an owner-unknown or another user's Tally that FinCom
   never linked is never reported. At most 50 entries each.
5. **Nothing asked of Tally**: all three are built from the bridge's memory (the list held, the light check's last
   result, the pick-ups, the slow marks, the tally.ini results). A test counts the requests while the beat is built.

Automatic day import (the plan's part B) needs no bridge change: the days come by the existing hand-out to bridges
2.5.16 and later, read with FinComDayHeads, FinComDayHeadsPart, FinComVoucherBatch and FinComVoucherObject under the
existing pace (postings first, the typing gate, the 2 s stop, dayRetry).

6. **No word asks for an upload** (plan B.7, B.9; words only, no logic change): the held, slow, renumber, bank-date and
   older-day words, the tray notices and the log lines no longer say "upload the Day Book"; they say FinCom brings or
   tries that day from Tally by itself. The pick-up words for stopped and dayRetry are the cloud's: "Tally was too slow
   for this company; FinCom tries again by itself" and "Tally was slow for this day; FinCom tries it again by itself".
   Uploading by hand stays possible in FinCom; nothing asks for it.
7. **A heavy day's bands go with its list** (migration 222's partial-list guard): a day listed in pieces of entry
   numbers (FinComDayHeadsPart, unchanged) sends them in period_heads as `"bands": [[from, to], ...]`, the last `to`
   null, in the order read. FinCom counts the list as whole (and so may confirm a delete on a second list) only when
   the bands start at 1, join with no hole and every head falls inside one; without them a bands list counts as
   partial and nothing is deleted. No request added or changed.

## Tests

tell2522_test.go (TestTell2522SkipCodes, TestTell2522NamesOnlyFromFinCom, TestTell2522SkipPrecedence,
TestTell2522AddonSilent, TestTell2522BeatMakesNoTallyRequest, TestTell2522NoUploadAsk); bands2522_test.go (TestBands2522SentWithTheDaysList, TestBands2522Body); r2522version_test.go; TestAllowListUnchanged unchanged.
The paper test sheet: docs/bridge-2.5.22-test-sheet.txt.
