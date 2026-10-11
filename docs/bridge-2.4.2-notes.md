# FinCom Bridge 2.4.2 (branch next-gsttype, from 2.4.1 as published: tax-accuracy 176dcfb6)

The owner's approval of 11-Oct-2026 (plan round 44, part B): "the bridge sends each entry's GST type". 2.4.2 is 2.4.1 with
that one change. The two data locations (next-241) move to 2.4.3.

| | |
|---|---|
| Setup file | FinComBridge-Setup-2.4.2.exe |
| Fingerprint | (filled in at the build) |
| Replaces | 2.4.1 (kept on the computer, so the tray can roll back to it) |

## What is in 2.4.2

1. **Each entry's GST type reaches FinCom.** The entry request (FinComVoucherObject: Tally's object export of ONE voucher by
   its MasterID) brings Tally's whole stored voucher; the bridge keeps the approved fields and drops the rest before
   anything is logged, stored or sent. 2.4.2 keeps 18 more fields, the ones that carry the entry's GST type, measured on
   real TallyPrime 3.0, 4.1, 5.1, 6.2 and 7.1 (tally-versions mode gsttype, runs 38099393603 and 38100635902: the same tags
   on every release; an item's and the ledger line's under it as every release writes them in the item invoices of
   push-design run 37741662830, testdata/fast234kinds: the gsttype company refused item invoices by XML, run 38101756323):

   | Field (as the strip keeps it) | What it means |
   |---|---|
   | GSTREGISTRATIONTYPE | the party's GST registration type on the entry (Regular, Unregistered, Unregistered/Consumer, Composition, ...) |
   | COUNTRYOFRESIDENCE | the party's country (an export when not India) |
   | ISREVERSECHARGEAPPLICABLE | the entry is under reverse charge (Yes / No) |
   | ALLLEDGERENTRIES.GSTOVRDNNATURE | a ledger line's nature of the transaction ("Sales to SEZ - Taxable", "Sales to SEZ - LUT/Bond", "Exports - Taxable", "Exports - LUT/Bond", "Sales Nil Rated", "Interstate Sales Exempt", "Purchase From Unregistered Dealer - Taxable", ...) |
   | ALLLEDGERENTRIES.GSTOVRDNTAXABILITY | a ledger line's taxability (Taxable, Nil Rated, Exempt, Non-GST) |
   | ALLLEDGERENTRIES.GSTOVRDNTYPEOFSUPPLY | a ledger line's goods or services |
   | ALLLEDGERENTRIES.GSTOVRDNINELIGIBLEITC | a ledger line's input credit is ineligible (blocked, 17(5)): Tally writes "Applicable" on the line when the ledger's own GST details say "Ineligible for input credit" or the line is overridden so |
   | ALLLEDGERENTRIES.GSTOVRDNISREVCHARGEAPPL | a ledger line's reverse-charge override |
   | ALLINVENTORYENTRIES.GSTOVRDNNATURE, .GSTOVRDNTAXABILITY, .GSTOVRDNTYPEOFSUPPLY, .GSTOVRDNINELIGIBLEITC, .GSTOVRDNISREVCHARGEAPPL | the same five on an item line of an item invoice |
   | ALLINVENTORYENTRIES.ACCOUNTINGALLOCATIONS.GSTOVRDNNATURE, .GSTOVRDNTAXABILITY, .GSTOVRDNTYPEOFSUPPLY, .GSTOVRDNINELIGIBLEITC, .GSTOVRDNISREVCHARGEAPPL | the same five on the ledger line under an item |

   (In full: ALLINVENTORYENTRIES.GSTOVRDNNATURE, ALLINVENTORYENTRIES.GSTOVRDNTAXABILITY, ALLINVENTORYENTRIES.GSTOVRDNTYPEOFSUPPLY,
   ALLINVENTORYENTRIES.GSTOVRDNINELIGIBLEITC, ALLINVENTORYENTRIES.GSTOVRDNISREVCHARGEAPPL,
   ALLINVENTORYENTRIES.ACCOUNTINGALLOCATIONS.GSTOVRDNNATURE, ALLINVENTORYENTRIES.ACCOUNTINGALLOCATIONS.GSTOVRDNTAXABILITY,
   ALLINVENTORYENTRIES.ACCOUNTINGALLOCATIONS.GSTOVRDNTYPEOFSUPPLY, ALLINVENTORYENTRIES.ACCOUNTINGALLOCATIONS.GSTOVRDNINELIGIBLEITC,
   ALLINVENTORYENTRIES.ACCOUNTINGALLOCATIONS.GSTOVRDNISREVCHARGEAPPL.)

   The place of supply (PLACEOFSUPPLY) and the party GSTIN (PARTYGSTIN) were kept already. Not kept: Tally's "stored nature"
   (GSTOVRDNSTOREDNATURE), the company's own registration type, the GST status flags, the party's state: nothing else.
   Code: bridge-go/fastvch.go liveKeepGST242; tests: gsttype242_test.go on the real captures (testdata/gsttype242/).

2. **The request is unchanged.** The fields are kept by the strip only and are NOT written into the request's FETCHLIST
   (Tally sends the whole voucher whatever it names), so FinComVoucherObject is the same bytes as in 2.4.1 (shape
   ce0e72f74e72; FinComVoucherByNumber 2167477221dc unchanged). One entry per request, read only, the 2-second rule and one
   request in flight per Tally unchanged; each bridge reads only its own Windows user's Tally; prospective only. The
   allow-list table and its hash are unchanged; its decision line says "allowed for 2.4.2 by the owner's decision of
   2026-10-11".

3. **The blocked credit (17(5)) as Tally keeps it.** Round 43 found TallyPrime 7.1 dropped the mark given by XML. Measured
   on all five releases: the ledger's own GST details (GSTDETAILS.LIST GSTINELIGIBLEITC Yes, what the ledger screen's
   "Ineligible for input credit" sets) make Tally write GSTOVRDNINELIGIBLEITC "Applicable" on every purchase line of that
   ledger; a line's own override is kept only in Tally's own form ("&#4; Applicable"); the plain word "Applicable" given by
   XML is dropped (Tally writes "Not Applicable"). FinCom reads the mark from the line.

4. **The cloud stores it (migration 72, add-only).** parse.js reads the type the same way from a Day Book export and from
   the bridge's entry body into each entry's "gst" (registration type, country, reverse charge, nature, taxability, goods or
   services, ineligible credit; an ineligible mark counts only on a line Tally gives a GST taxability or nature: a ledger
   without GST details carries Tally's "Applicable" with neither). The nature, taxability and goods or services come
   together from the entry's first GST line in the document's order (an item with the ledger line under it is one line);
   an entry whose GST lines disagree is marked mixed. tally-ingest passes it on; migration 72 adds nine columns to
   tally_vouchers (gst_reg_type, gst_country, gst_rcm, gst_nature, gst_taxability, gst_supply, gst_ineligible, gst_mixed,
   gst_alter_id) and tally_ingest_gsttype, called by 62's tally_ingest_details (one line added); the type is written only
   onto the version just stored, with the AlterID it was read at. A body without "gst" (a bridge before 2.4.2, or 2.4.2's
   FinComVoucherByNumber answer, whose request is unchanged and fetches none of these fields) leaves the stored values as
   they are, never blanked, and gst_alter_id below the entry's AlterID, so the app never takes them for the later
   version's own. Tests: run_parse_gsttype.mjs, run_migration72.py.

5. **The app** (arc-ui): the GST builders take the cloud copy's GST type for the entries the bridge sent, as they take it
   from an uploaded Day Book.

No change to the add-on: the add-on unchanged from 2.4.1 (no data-folder line). No AI in the bridge or the add-on.

## Not in 2.4.2

- The two data locations (next-241): moved to 2.4.3.

## Checks

go vet (Linux and Windows), go test -timeout 20m, release-check steps 1-6, CI and Windows CI, the real-Tally gate on the
committed setup (tally-versions upg (from 2.4.1), s235, bankb, selfck on all five releases; tally-real fast234; the
tdsgst end-to-end run on 7.1).
