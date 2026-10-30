# Security review: FinCom Bridge 2.5.1 (the ledger requests dated from FinCom's first day of the book)

Reviewer: the independent review sessions of bridge-2.5.1-code-review.md (three rounds; each asked for security points
explicitly). They did not write the change. Checked against the owner's standing rules: every request to Tally 2 s or
less; one request in flight; postings first; only the exact approved shapes reach Tally; nothing computed asked of Tally
except where the owner decided; reading is prospective only (ReadDays) except the owner's narrow exceptions; no computer
names in words a firm sees; no AI.

Range: 204d79d4f..4d7cc006d

## Threats looked at

1. **The cloud choosing the period of a read.** New in 2.5.1: FinCom's answer names the date the three ledger requests
   carry. Bounded: a real yyyymmdd day (1990 to a year after today, finComDay), used only on or after Tally's own
   books-from of that company (finComDayFits), kept only for a company of this Windows user's own Tally whose
   books-from Tally said. The request is still built only by ledgerChunkRequestAt / ledgerChangesRequestAt /
   ledgerByNameRequestAt (byte for byte 2.5.0's shape: the allow-list table and its hash unchanged, TestAllowListUnchanged,
   TestR251VersionAllowList); the gate (ledgerPeriodExact) lets through exactly the first year of the day in use or of
   Tally's BOOKSFROM, nothing else, whoever asks and whatever ReadDays says (TestR251FinComFirstDayDatesTheLedgerRequests:
   another year refused with ReadDays off). A later year of Tally's books gives carried-forward openings, a figure Tally
   computes: the owner's decision for 2.5.1 (round 2 finding 1), timed on real Tally by o251 (44 ms worst).
2. **The sync folder's file (fincom-books-from.json).** Read once per sync folder; each value goes through finComDay,
   each key must be a folded company name; a day is used only through finComDayFits. A local user who can write the
   sync folder can already change everything the bridge keeps there; the file cannot widen the gate beyond (1).
3. **Another company of the same name.** The cloud answers "" for a computer whose company has another GUID than the
   book's recorded one, and leaves the company out while the beat carries no GUID (round 2 finding 5). A book with no
   recorded GUID: as periodDaysFor (known limit).
4. **Wrong-day openings reaching FinCom.** The cloud guard of 204d79d4f (deployed 30-Oct-2026) refuses openings whose
   openingsAt is not the book's from_date (ledger_list: nothing staged or settled; ledger_changes: no opening changed);
   its notes no longer also claim "taken without the guards"; run_openings_ingest.py G.
5. **Log lines from the cloud's words.** Company names from the answer are folded to one line before any log line, and
   a line is written only for a company Tally knows.
6. **Data to the cloud.** Nothing new is sent; the beat's answer carries only the firm's own books' first days for the
   companies that firm's computer has open.
7. **Requests to Tally.** No request added; 2 s, one in flight and postings first unchanged (o251 o5, o6 PASS on all
   five releases).

## Findings

Round 1: finding 1 (High, the cloud choosing any date) fixed as in (1); finding 3 (GUID) fixed as in (3); finding 4
(test mode) fixed. Round 2: findings 1-3 as in the code review (decided, fixed, fixed). Round 3: no new security finding
beyond the code review's (a book without a recorded GUID: known limit).
