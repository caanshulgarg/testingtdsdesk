# FinCom Bridge 2.4.3 (branch next-tdsfields, from 2.4.2 as published: tax-accuracy bd80c0cb)

The owner's approval of 11-Oct-2026: TDS challan details and TDS master settings come from Tally into FinCom by themselves:
(a) the challan fields already in FinComVoucherObject's answer are kept; (b) the request changes for the master fields.
The two data locations (next-241) move to 2.4.4.

| | |
|---|---|
| Setup file | FinComBridge-Setup-2.4.3.exe |
| Fingerprint | SHA-256 `374bf99fdb6021a04c4403cd9d52016e5064d871f9f12bc6422709584913307a` (FinComBridge-Setup-2.4.3.exe, built 12-Oct-2026 11:00 IST; compare with the .sha256 file next to the setup); program SHA-256 `31615695ca754fea883185d9624044628e755d63c013106911debf05dcb9ad48` |
| Replaces | 2.4.2 (kept on the computer, so the tray can roll back to it) |
| Published | (filled in at publishing) |

## What is in 2.4.3

1. **A TDS payment's challan reaches FinCom (no request change).** FinComVoucherObject brings Tally's whole stored voucher;
   the bridge keeps 30 more fields, measured on real TallyPrime 7.1 (tally-versions mode tdsch, runs 38147459474 ..
   38158072301; the table: scratchpad tds-tally-fields.md; testdata/tdsfields243/7.1). A blank one is not kept, so every
   other entry strips exactly as in 2.4.2 (the 2.4.2 goldens unchanged):

   | Field (as the strip keeps it) | What it means |
   |---|---|
   | STATPAYMENTTYPE, TAXPAYPERIODFROMDATE, TAXPAYPERIODTODATE | a Stat Payment: the duty (TDS) and the period paid for |
   | TAXCHALLANBSRCODE, TAXBANKCHALLANNUMBER, TAXCHALLANDATE | the challan: BSR code, number, date |
   | TAXCHEQUENUMBER, TAXCHEQUEDATE, TAXBANKNAME, TAXBANKBRANCHNAME | the cheque or DD, the bank and branch |
   | TDSNATUREOFPAYMENT, TDSSECTIONNO | the nature of payment and section the payment is for |
   | ALLLEDGERENTRIES.TYPEOFTAXPAYMENT, ALLLEDGERENTRIES.STATNATURENAME | what each line pays (Tax / Interest / Late Fee) and its nature |
   | ALLLEDGERENTRIES.SUMMARYALLOCS.NAME, ALLLEDGERENTRIES.SUMMARYALLOCS.FROMDATE, ALLLEDGERENTRIES.SUMMARYALLOCS.TODATE, ALLLEDGERENTRIES.SUMMARYALLOCS.TDSNATUREOFPAYMENT, ALLLEDGERENTRIES.SUMMARYALLOCS.TDSSECTIONNO, ALLLEDGERENTRIES.SUMMARYALLOCS.TDSDEDNSTATUS, ALLLEDGERENTRIES.SUMMARYALLOCS.TDSRESIDENTIALSTATUS, ALLLEDGERENTRIES.SUMMARYALLOCS.FORMTYPE, ALLLEDGERENTRIES.SUMMARYALLOCS.PAIDAMOUNT | per nature on the payment's TDS line: the return quarter (TDS/Q3/2026-27/26Q), the period, nature, section, the deductee's status and residence, the form, the amount paid |
   | ALLLEDGERENTRIES.SUMMARYALLOCS.TAXCHALLANBSRCODE, ALLLEDGERENTRIES.SUMMARYALLOCS.TAXBANKCHALLANNUMBER, ALLLEDGERENTRIES.SUMMARYALLOCS.TAXCHALLANDATE, ALLLEDGERENTRIES.SUMMARYALLOCS.TAXCHEQUENUMBER, ALLLEDGERENTRIES.SUMMARYALLOCS.TAXCHEQUEDATE, ALLLEDGERENTRIES.SUMMARYALLOCS.TAXBANKNAME, ALLLEDGERENTRIES.SUMMARYALLOCS.TAXBANKBRANCHNAME | the challan per nature, where Tally's Challan Reconciliation writes it |

   The link from a payment to each deduction it pays is TAXOBJECTALLOCATIONS (TAXNAME, Agst Ref on the payment, New Ref
   on the deduction), kept whole since 2.4.0. The request is unchanged byte for byte (shape ce0e72f74e72; FinComVoucherByNumber
   2167477221dc, which fetches none of these). Code: bridge-go/fastvch.go liveKeepTDS243; tests: tdsfields243_test.go.

   The challan typed in Tally's Challan Reconciliation: on the test machines (Tally's Educational mode) the keys did not save
   the BSR code and number; the owner checked on his own licensed Tally that they stay saved. The payment made by XML with
   the challan tags is what Tally's own Challan Reconciliation report shows, and is what the tests use. **The first real
   Challan Reconciliation entry on NWS144 after 2.4.3 is installed is the live confirmation that the TAX* tags carry it**
   (test sheet check 2).

2. **The ledger requests ask the TDS settings (request change, (b)).** FinComLedgers, FinComLedgerChanges and
   FinComLedgerByName (one field list, ledFetch) ask, after 2.4.2's fields: TDSRATENAME (a TDS duty ledger's nature of
   payment), TDSDEDUCTEEISSPECIALRATE and TDSDEDUCTEESPECIALRATE (a party's special rate), LOWERDEDUCTION.NATUREOFPAYMENT and
   LOWERDEDUCTION.LOWERDEDUCTIONDETAILS.FROMDATE, .TODATE, .SECTIONNO, .CERTIFICATENO, .TDSITRATE, .LOWERDEDUCTIONLIMIT (a
   party's lower-deduction certificates), each field named (no wildcard). They go to FinCom as the 12th, 13th and 14th
   columns of the ledger list's row (a row a 2.4.2 round left in the outbox goes without them: FinCom keeps its own).

3. **One new request, FinComTdsNatures (request change, (b)).** Tally's TDSRate masters (the natures of payment: a few
   dozen in a company): GUID, MASTERID, ALTERID, NAME and CATEGORYDETAILS.APPLICABLEFROM, .TDSRATESECTION, .RATEOFTAX,
   .OTHERRATE, .NOPANRATEOFTAX, .NOPANOTHERRATE, .EXEMPTIONLIMIT, .SINGLEBILLVALUE (the section, the rates with and without
   PAN, the year's threshold and the single bill's, by the date each applies from). In chunks of 5,000 MasterIDs up to the
   company's highest master number, then the open end (the natures are few; each request reads Tally's TDSRate masters
   alone). Read in the ledger round after the groups (Update now, the nightly run), one request in flight, inside the round's
   budget and stops. A natures request that is not answered never holds the ledger list: the round goes on without the
   natures (nothing of them sent that round); after two rounds Tally does not answer them they are not asked again until the
   bridge is updated. Sent with the first ledger_list batch of a complete round. Code: bridge-go/tdsnatures.go; tests:
   tdsmasters243_test.go. TDSRATESECTION and APPLICABLEFROM are read with the thresholds: the section is what "section from
   TDSRATENAME" needs (a nature's name need not carry its section) and the date says which of a nature's rows applies.

4. **Measured on real TallyPrime 3.0, 4.1, 5.1, 6.2 and 7.1** (tally-versions mode tdsm, the requests exactly as next-tdsfields
   builds them; runs 38164963591 (11-Oct) and 38187902681 (12-Oct, with FinComLedgerChanges) on GitHub runners, not NWS144;
   checks m1 to m5 PASS on every release in both; the worst of each over both runs, in ms):

   | TallyPrime | FinComTdsNatures | FinComLedgerByName | FinComLedgers chunk, 20,000 ledgers (2.4.3 / 2.4.2's fields) | FinComLedgerChanges (200 AlterIDs) | ZZ BIG TEST: FinComLedgers / natures |
   |---|---|---|---|---|---|
   | 3.0 | 2.6 | 26.3 | 212.4 / 162.0 | 188.8 | 100.4 / 2.3 |
   | 4.1 | 5.6 | 36.6 | 280.1 / 247.0 | 182.6 | 114.5 / 2.8 |
   | 5.1 | 3.3 | 36.1 | 315.9 / 229.9 | 246.7 | 114.8 / 2.9 |
   | 6.2 | 4.2 | 35.6 | 298.0 / 214.9 | 222.2 | 126.7 / 4.2 |
   | 7.1 | 4.2 | 44.8 | 306.9 / 228.7 | 267.9 | 167.5 / 3.7 |

   Every field came back as made on all five (m1 ledgers, m2 certificates, m3 natures); m4: the challan fields in
   FinComVoucherObject's answer on all five (8-81 ms, the request unchanged); m5: Tally responding after every request,
   no request failed. Well under the 2-second rule; the four rows' worst cases are in the allow-list table.

5. **The cloud stores them (migration 73, add-only).** parse.js reads the challan, the per-line kinds, the per-nature detail
   and the TDS references into each voucher's "tdsx", the same way from a Day Book export and from the bridge's body
   (tests/run_parse_tdsfields.mjs on the real captures and Tally's full export). tally-ingest passes "tdsx" on, the ledger
   rows' three columns and the natures. Migration 73 adds tally_vouchers.tds_tally / tds_tally_alter_id (written only onto
   the version just stored, with the AlterID it was read at; a body without "tdsx" leaves them, never blanked),
   tally_ledgers.tds_nature / tds_special_rate / tds_ldc, the table tally_tds_natures (a member of the firm reads), the
   functions tally_ingest_tdstally and tally_ingest_natures, and 72's tally_ingest_details with one line added. Tests:
   run_migration73.py, run_recorder_server.py (2.4.3 rows), run_migration_order.py.

6. **The app (arc-ui, src/js/72-tds-tally.js, small UI marks).** On loading the cloud copy (TDSTally.sync):
   - **Challans.** A challan is made from each TDS payment Tally gives a BSR code, number and date for, marked **From
     Tally**. Its tax, interest and late fee are split by TYPEOFTAXPAYMENT (the FVU's challan record carries the interest
     and the fee): the interest, fee and others are the lines Tally marks so, the tax the rest of the TDS paid (a payment
     of interest alone is a challan of tax 0). A payment with several challans takes each its own paid amount, the
     interest and fee by nature; where Tally's entry does not tell a challan's amounts it is not made and is listed for a
     person. When Tally corrects a challan's details, an untouched, untagged challan follows; one with tags, or one a
     person corrected, stays and the difference is listed (never a second challan). A person's correction of a challan
     from Tally stays (Tally's last figures kept beside it); its tax is never lowered below what is tagged to it.
   - **Tags.** The deduction Tally links to a payment (the same reference, for the same party and duty ledger) is tagged
     to that payment's challan (From Tally) only where exactly one deduction and one payment carry it, the payment not
     dated before the deduction nor in a year after the next; anything else is listed ("Tally and FinCom differ"). A
     deduction FinCom already tags elsewhere is never moved. A challan a person entered for the same payment is kept, a
     difference listed.
   - **Sections.** A TDS ledger's section comes from its nature's section in Tally before the one in its name (a
     person's own choice stays). The ledger masters read with a Day Book take TDSRATENAME as the nature too.
   - **Certificates.** Tally's lower-deduction certificates fill FinCom's certificate list (From Tally); one FinCom has
     under the same number is kept as entered, differences listed; a person's correction of one from Tally stays; one
     Tally no longer keeps leaves (only Tally's, untouched).
   - **Thresholds.** The limits tracker uses the thresholds of the nature Tally keeps on the expense ledgers, said as
     Tally's, only for the rule's own section, never on a monthly limit (rent), only where stricter than FinCom's, and
     for 194C's bill-or-year rule only when Tally fills both figures (Tally 7.1 keeps 194C's bill figure alone in the
     year's field).
   - The books' TDS payment list gives the tax alone where Tally marks interest and fee lines, and shows the interest and
     fee beside it; "Make it a challan" carries them onto the challan. A challan made that way is the person's (never
     changed or removed by the sync; Tally's link tags to it); a payment a challan already names is not proposed again.

   Tests: run_tds_tally.mjs (with the review's cases); run_e2e_tdsgst.py part E (13 PASS: Tally's real 7.1 entries and
   masters through the cloud function, migration 73 and the app).

What the owner's staff do in Tally: the test sheet's "What your staff do in Tally" (Stat Payment, then Challan
Reconciliation; interest and late fee as their own lines; certificates on the party ledger).

No change to the add-on: the add-on unchanged from 2.4.2. No AI in the bridge or the add-on. Prospective only; each bridge
reads only its own Windows user's Tally; one request in flight; the 2-second rule unchanged.

## Not in 2.4.3

- The two data locations (next-241): moved to 2.4.4.

## Checks

go vet (Linux and Windows), go test -timeout 20m, release-check steps 1-6, CI and Windows CI, the real-Tally gate on the
committed setup (tally-versions upg (from 2.4.2), s235, bankb, selfck on all five releases; tally-real fast234; the
tdsgst end-to-end run on 7.1).
