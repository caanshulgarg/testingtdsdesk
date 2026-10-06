# Tally requests: the allow-list

FinCom Bridge sends Tally only the requests in this table (`bridge-go/allowlist.go`). Any other request is refused
by `invokeTally` before a byte is sent, and the refusal is written to the bridge's log. Ids marked **measure-only** go
only while the measuring tool (Measure Tally, for FinCom support) is running.

- **id**: the request's collection ID, the report's name ("Day Book"), or "Import" for every posting and deletion.
- **shape**: the first 12 hex digits of the SHA-256 of the request as its builder makes it with fixed inputs
  (`allowListSamples`). A change to a request's fields, filter or period changes its shape.
- **worst case (s)**: the longest time measured on ZZ BIG TEST (`tests/fixtures/big/make_big_company.py`) on NWS144,
  with **measured on** its date. "not yet measured" until the phase 1 measurement (`docs/tally-measure-sheet.txt`) fills it.

The line above the table ("First table: not yet measured; allowed for <version> only by the owner's decision of
<date>") is the owner's per-build exception (round 13, 03-Oct-2026: the owner decides per build which computers get a
build): `release-check.sh` (check 4) accepts "not yet measured" rows only for the one version that line names, and only
with the owner's decision words; any other version needs a worst case above 0 in every row. The bridge still tells
FinCom's cloud in every heartbeat whether its table is measured (`allowlist: {measured, hash}`).

`TestAllowListUnchanged` (in `bridge-go/allowlist_test.go`, run on every build and by `release-check.sh`) fails when
this table and the Go table differ. A new or changed request is therefore measured on ZZ BIG TEST again, its time and
date put in `allowlist.go`, and this table replaced with the one the failing test prints.

No request may ask Tally for a figure it computes (`TestNoComputedFigure`): no closing or opening balance for a period,
no trial balance, no profit and loss, no Ledger Vouchers report, no `$$` function other than `$$SysName`, nothing
CHILDOF a ledger ("Vouchers : Ledger"), no on-account value. A ledger's stored opening (the master's own field, asked
without a period) is a stored field, not a computed one.

The size test (`bridge-go/size_test.go`) uses a cost per row returned (`tallyPerRowMs` in `allowlist.go`): a
conservative guess until the phase 1 measurement replaces it.

First table: re-measured on 2026-10-06 on the stand (not real Tally); not yet measured on NWS144; allowed for 2.3.1 by the owner's decision of 2026-10-06: FinComVoucherByMaster and FinComVoucherByNumber fetch the whole entry: the ledger lines kept under an invoice's items (ALLINVENTORYENTRIES.ACCOUNTINGALLOCATIONS); the items (name, quantity and unit, rate, taxable value, the HSN or SAC and the GST rate Tally applied to that line); bill-wise details; TDS details; cost centre allocations (on ledger lines and on the ledger lines under items); bank details (transaction type, instrument number or UTR, instrument date, bank date); narration, reference number and date; the e-invoice IRN and acknowledgement; the e-way bill number; the party GSTIN, place of supply, company GSTIN and the ledger lines' GST fields the Day Book path reads; one entry per request, by Tally's own id (FinComVoucherByMaster) or by type and number (FinComVoucherByNumber); read only, within the 2-second rule, after postings, nothing else added, each bridge on its own Windows user's Tally only; TDSDeskCompanies, when asked in the background (the recorder's own-Tally look, the light check), stops hard at 2 seconds too (its shape unchanged); nothing else changed (the owner's words: "Voucher request, one change: Item invoices enter complete: sales, purchase, credit notes and debit notes with stock items, including the ledger lines Tally keeps under the items. Item lines: item name, quantity, unit, rate, taxable value, HSN or SAC, GST rate, and CGST, SGST, IGST and cess per line. Take the HSN and rate Tally applied to that invoice line, not from masters. Bill-wise details on party lines: bill name, type, due date or credit period, amount. TDS details where present: section, nature of payment, rate, amount, deductee type. Cost centre and cost category allocations. Bank details on bank lines: instrument number or UTR, instrument date, bank date, transaction type. Narration, reference number and date, e-invoice IRN and acknowledgement number, e-way bill number."; "One entry per request: strictly one, asked for by Tally's own id."; "read only, inside the 2-second rule, after postings, nothing else added, each bridge on its own Windows user's Tally only"; the earlier words of the same day: "change the entry request so the bridge also asks Tally for the ledger lines kept under the items of a sales or purchase invoice (item invoice mode). Conditions: one entry per request as today, read only, inside the 2-second rule, nothing else added to the request"; the two rows' shapes and the test forms FinComFetchTestA and FinComFetchTestC, byte for byte the two requests as built, change with them; FinComFetchTestB, D, E and F stay byte for byte as in 2.3.0; no other row changed; as for 2.3.0: the owner's standing decision of 2026-10-06: no request on the list and no request shape changed (the owner's standing approval of 06-Oct-2026: the line is added for any release where no request was added and no request shape changed; a new or changed request goes to the owner first; as for 2.2.4: the owner's decision of 05-Oct-2026 for 2.2.4: no request shape changed; the bridge reads Tally's answers with or without TYPE attributes and never takes CMPINFO's counters as objects; as for 2.2.3: the owner's decision of 05-Oct-2026: six test-only requests FinComFetchTestA..F, one voucher each, sent only when the owner presses the tray item 'Test fetching an entry', never by the bridge itself; measure-only on the list, a person's request, one at a time through the same gate as every request, each capped at 25 s, never during a posting, and only while the owner's switch 'Trial tools on this computer' is on; A and C are byte for byte FinComVoucherByNumber and FinComVoucherByMaster as built but under their own ids; no other request shape changed; the rest as for 2.2.2: the owner's NWS144 findings of 05-Oct-2026: no request shape changed; FinComVoucherByMaster now needs a recorded starting point and has no date window, Tally's ALTERID above the starting point being the guard (owner, 05-Oct); FinComVoucherByNumber only for a line waiting on it, within 3 days; as in 2.2.1, the NWS144 result of 05-Oct-2026: one new request, FinComVoucherByNumber, approved by the owner on 05-Oct-2026 exactly as follows: it asks Tally for one voucher, a new entry whose add-on line has no MasterID, by its voucher type and number, with the body fetch's fields and nothing computed; the type and the number are always present (the bridge cannot build it without both, so it can never ask for a day's list); the period is one single day, the line's own date; that day is never before the day the company's starting point was recorded and never after today; the request goes only exactly as built (the third dated exception, checked by its id whatever ReadDays says); if Tally ignores the period and returns another voucher with the same type and number, the bridge drops anything that is not of that day, of that company and above the starting point, and never stores or sends it; two that qualify are both dropped and the line stays held; it never starts during a posting, gives way to one, and the 2 s rule switches the entry fetch off for the company; the owner's conditions for 2.2.2: retries capped at 20, a request stopped at 2 s, the date inside the filter if a form is found; as in 2.2.0, the live recorder, plan round 20: one new request, FinComVoucherByMaster, the body of the entries just changed by MasterID with the line's own date as the period, the one dated request allowed with ReadDays off and only exactly as built; the undated TDSDeskKeepList above an AlterID also fetches MASTERID; FinComSlice, source C's one month above an AlterID in the kept date form, off by default and the second dated exception; the read test's measure-only FinComDatesProbe and FinComEditLogProbe; FinComCompany asks AltVchId and AltMstId as NATIVEMETHODs, the owner's finding of empty change numbers on NWS144, and FinComCompanyNumbers, a report over the one company, is its second form)); this line is replaced per build by the owner's decision, and removed once the table carries times.

(re-measured on 2026-10-03: no times yet; the table's rows and shapes are unchanged since the 2.1.6 build; only the owner's decision line above changed for 2.1.7, and again for 2.1.8: no request shape changed; the duplicate check against Tally left the posting path, its request stays on the list for Check Tally)

(2.1.9, 04-Oct-2026: every dated request now renders its dates through one function, `dateVars` in `bridge-go/dates.go`, with the same yyyymmdd text as before, so no shape changed and the table is unchanged. The person-started "Test reading from Tally" also sends the Day Book with the dates as d-MMM-yyyy and with TYPE="Date" (still the "Day Book" id), and TDSDeskKeepList with its AlterID filter and no dates (the entries above the company's starting point, measurement only; the measuring tool sends the same as its item a2). The light FinComCompany request now also goes once when a company is first seen open in a run and at most every 10 minutes while it stays open. Reading old days is off in normal running (ReadDays, the owner's rule of 04-Oct-2026).)

<!-- allowlist:begin -->
| id | purpose | shape | worst case (s) | measured on | used by |
|---|---|---|---|---|---|
| Day Book | the day book of one company for one month at most (Update now, the nightly run, a FinCom read) | fbbe1dd6e139 | not yet measured | - | bridge |
| FinComByMaster | the posting read-back by Tally's voucher id (LASTVCHID): one month's entries filtered to that one MasterID, heads and narration only | 3a3e60c1e890 | not yet measured | - | bridge |
| FinComCompany | the company check: one company's name, GUID and highest AlterIDs (also the small check after a timeout) | f3e3710802ed | not yet measured | - | bridge |
| FinComCompanyNumbers | the company's change numbers (2.2.0, form b): a report over the one company, its name, GUID, AltVchId and AltMstId | 62084b69e34d | not yet measured | - | bridge |
| FinComDatesProbe | measure (the read test): one past-year month's entries as GUID, MasterID, AlterID and date, in each date form | f441cc0d993a | not yet measured | - | measure-only |
| FinComEditLogProbe | measure (the read test): one entry by MasterID with its edit-log sub-collection (candidate names) | 5bc0e4c16b77 | not yet measured | - | measure-only |
| FinComFetchTestA | measure (Test fetching an entry): form A, FinComVoucherByNumber as built (one voucher by type and number, one day, yyyymmdd), under its own id | 5a1c381441eb | not yet measured | - | measure-only |
| FinComFetchTestB | measure (Test fetching an entry): form B, form A with plain quote marks in the filter | 2d905711230e | not yet measured | - | measure-only |
| FinComFetchTestC | measure (Test fetching an entry): form C, FinComVoucherByMaster as built (one MasterID, one day, yyyymmdd), under its own id | 4ed2f75891bd | not yet measured | - | measure-only |
| FinComFetchTestD | measure (Test fetching an entry): form D, form C with no dates | 96da1903f282 | not yet measured | - | measure-only |
| FinComFetchTestE | measure (Test fetching an entry): form E, form C with the dates as d-MMM-yyyy TYPE=Date | ad966bf1dffa | not yet measured | - | measure-only |
| FinComFetchTestF | measure (Test fetching an entry): form F, form B with no dates | 624561c5f62e | not yet measured | - | measure-only |
| FinComFree | the small check after a timeout when no company is named: the companies' names and GUIDs | fc989c00dda9 | not yet measured | - | bridge |
| FinComGroups | the group list, stored master fields only | 91fea7a2c04a | not yet measured | - | bridge |
| FinComLedgers | the ledger list, 2,000 MasterIDs a request at most, stored master fields only | 9b990b2eb9b9 | not yet measured | - | bridge |
| FinComMeasureB | measure: entries above an AlterID over the year | 7e0798aa39f7 | not yet measured | - | measure-only |
| FinComMeasureC | measure: entries above an AlterID, one month | 4426a7f95daa | not yet measured | - | measure-only |
| FinComMeasureD | measure: one month's GUIDs only | 09151f17e805 | not yet measured | - | measure-only |
| FinComMeasureE | measure: one entry by its AlterID | 89d6f60096a7 | not yet measured | - | measure-only |
| FinComMeasureLedF | measure: one ledger's master fields | 95a0a8267be5 | not yet measured | - | measure-only |
| FinComMeasureLedO | measure: one ledger's stored opening (the field, no period) | 4239cb0322f6 | not yet measured | - | measure-only |
| FinComMeasureNames | measure: every ledger's name | 1eb2653d0641 | not yet measured | - | measure-only |
| FinComMeasureYear | measure: the year's entries, dates only | a71140d1c723 | not yet measured | - | measure-only |
| FinComSlice | the recorder's source C (2.2.0, off by default): one month's entries above an AlterID as GUID, MasterID, AlterID and date, in the date form the read test kept | 4ae8c3aa2577 | not yet measured | - | bridge |
| FinComSnapshot | measure: one month's entries as GUID, AlterID, date, type and number | c48421c1f84f | not yet measured | - | measure-only |
| FinComTag | the FinCom id check: one date's entries, heads and narration only | c6adb1e0d825 | not yet measured | - | bridge |
| FinComVoucherByMaster | the recorder's body fetch (2.2.0): the entry just changed, by its MasterID (exactly one a request since 2.3.1), the line's own date as the period, the fields FinCom's day parse reads (2.3.1: the whole entry: items, the ledger lines under them, bill-wise, cost centres, bank, TDS, GST, e-invoice and e-way bill details) | 192f19192b9d | not yet measured | - | bridge |
| FinComVoucherByNumber | the recorder's new entry (2.2.1): one entry by its voucher type and number, the line's own date as the period, the body fetch's fields (2.3.1: the whole entry, as the body fetch) | 64c81462240b | not yet measured | - | bridge |
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

Table hash (SHA-256): b3a08f2dc932a10fd836b2e1cfbe42abc5de19e3dc4a180cab56a1a7e57a1b16
