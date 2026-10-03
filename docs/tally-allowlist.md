# Tally requests: the allow-list

FinCom Bridge sends Tally only the requests in this table (`bridge-go/allowlist.go`). Any other request is refused
by `invokeTally` before a byte is sent, and the refusal is written to the bridge's log. Ids marked **measure-only** go
only while the measuring tool (Measure Tally, for FinCom support) is running.

- **id**: the request's collection ID, the report's name ("Day Book"), or "Import" for every posting and deletion.
- **shape**: the first 12 hex digits of the SHA-256 of the request as its builder makes it with fixed inputs
  (`allowListSamples`). A change to a request's fields, filter or period changes its shape.
- **worst case (s)**: the longest time measured on ZZ BIG TEST (`tests/fixtures/big/make_big_company.py`) on NWS144,
  with **measured on** its date. "not yet measured" until the phase 1 measurement (`docs/tally-measure-sheet.txt`) fills it.

The line above the table ("First table: not yet measured; allowed for <version> only; re-measured on <date>") is the
first build's exception: `release-check.sh` (check 4) accepts "not yet measured" rows only for the one version that line
names; any other version needs a worst case above 0 in every row. The bridge tells FinCom's cloud in every heartbeat
whether its table is measured (`allowlist: {measured, hash}`), and the cloud refuses to approve a version whose pilot
bridge reports it unmeasured, so an unmeasured build never leaves the pilot computer.

`TestAllowListUnchanged` (in `bridge-go/allowlist_test.go`, run on every build and by `release-check.sh`) fails when
this table and the Go table differ. A new or changed request is therefore measured on ZZ BIG TEST again, its time and
date put in `allowlist.go`, and this table replaced with the one the failing test prints.

No request may ask Tally for a figure it computes (`TestNoComputedFigure`): no closing or opening balance for a period,
no trial balance, no profit and loss, no Ledger Vouchers report, no `$$` function other than `$$SysName`, nothing
CHILDOF a ledger ("Vouchers : Ledger"), no on-account value. A ledger's stored opening (the master's own field, asked
without a period) is a stored field, not a computed one.

The size test (`bridge-go/size_test.go`) uses a cost per row returned (`tallyPerRowMs` in `allowlist.go`): a
conservative guess until the phase 1 measurement replaces it.

First table: not yet measured; allowed for 2.1.5 only; re-measured on 2026-10-02 (no times)

<!-- allowlist:begin -->
| id | purpose | shape | worst case (s) | measured on | used by |
|---|---|---|---|---|---|
| Day Book | the day book of one company for one month at most (Update now, the nightly run, a FinCom read) | fbbe1dd6e139 | not yet measured | - | bridge |
| FinComByMaster | the posting read-back by Tally's voucher id (LASTVCHID): one month's entries filtered to that one MasterID, heads and narration only | 3a3e60c1e890 | not yet measured | - | bridge |
| FinComCompany | the company check: one company's name, GUID and highest AlterIDs (also the small check after a timeout) | 0aae177f8654 | not yet measured | - | bridge |
| FinComFree | the small check after a timeout when no company is named: the companies' names and GUIDs | fc989c00dda9 | not yet measured | - | bridge |
| FinComGroups | the group list, stored master fields only | 91fea7a2c04a | not yet measured | - | bridge |
| FinComLedgers | the ledger list, 2,000 MasterIDs a request at most, stored master fields only | e10e54ab1772 | not yet measured | - | bridge |
| FinComMeasureB | measure: entries above an AlterID over the year | 7e0798aa39f7 | not yet measured | - | measure-only |
| FinComMeasureC | measure: entries above an AlterID, one month | 4426a7f95daa | not yet measured | - | measure-only |
| FinComMeasureD | measure: one month's GUIDs only | 09151f17e805 | not yet measured | - | measure-only |
| FinComMeasureE | measure: one entry by its AlterID | 89d6f60096a7 | not yet measured | - | measure-only |
| FinComMeasureLedF | measure: one ledger's master fields | 95a0a8267be5 | not yet measured | - | measure-only |
| FinComMeasureLedO | measure: one ledger's stored opening (the field, no period) | 4239cb0322f6 | not yet measured | - | measure-only |
| FinComMeasureNames | measure: every ledger's name | 1eb2653d0641 | not yet measured | - | measure-only |
| FinComMeasureYear | measure: the year's entries, dates only | a71140d1c723 | not yet measured | - | measure-only |
| FinComSnapshot | measure: one month's entries as GUID, AlterID, date, type and number | c48421c1f84f | not yet measured | - | measure-only |
| FinComTag | the FinCom id check: one date's entries, heads and narration only | c6adb1e0d825 | not yet measured | - | bridge |
| Import | a posting or a deletion (Import Data) | 907a02740d6e | not yet measured | - | bridge |
| TDSDeskCompanies | the companies loaded in Tally (name, books' period, GUID) | a1fe973a9650 | not yet measured | - | bridge |
| TDSDeskCompanyInfo | one company's GSTIN and PAN, once when it is first seen | cacb15508aea | not yet measured | - | bridge |
| TDSDeskDupCheck | the duplicate check before a posting: one date's entries (for one party) | 36255f700773 | not yet measured | - | bridge |
| TDSDeskGroupNames | group names and parents | d2f896e24edc | not yet measured | - | bridge |
| TDSDeskGroups | groups for FinCom's /ledgers (name, parent, GUID) | 797d797aa32d | not yet measured | - | bridge |
| TDSDeskKeepList | one month's entries as GUID, AlterID and date only (the copy's check) | 4a2f4d8e19da | not yet measured | - | bridge |
| TDSDeskLedgers | ledger masters for FinCom's /ledgers, 2,000 MasterIDs a request at most, stored fields only | ab3e05ae1e01 | not yet measured | - | bridge |
| TDSDeskNames | ledger names and groups, 2,000 MasterIDs a request at most | 8265078885e5 | not yet measured | - | bridge |
| TDSDeskVchHeads | voucher heads (Optional ones too) of one company for one month at most, no ledger lines | 53fc675a1641 | not yet measured | - | bridge |
<!-- allowlist:end -->

Table hash (SHA-256): 4a004725c87a50b1b46e100a560affd60d7719d5a8053eb1d8a68f58ad5ef09a
