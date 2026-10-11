package main

import (
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

// --- 2.4.3 (the owner's approval of 11-Oct-2026, (a)): the TDS challan details Tally keeps on a TDS payment, already in
// FinComVoucherObject's answer (Tally sends the whole voucher whatever the FETCHLIST names), are kept by the strip; the
// request is unchanged (shape ce0e72f74e72). Measured on real TallyPrime 7.1 (tally-versions mode tdsch, run 38155837948;
// the raw answers in testdata/tdsfields243/7.1/): a payment made on Tally's Stat Payment screen (SP1) keeps the period,
// the nature, section and the deductee's status per nature (SUMMARYALLOCS.LIST) and the link to the deductions it pays
// (TAXOBJECTALLOCATIONS, already kept); a payment with its challan details (PX1) the challan's BSR code, number and date,
// the cheque, the bank, and each line's tax / interest / late fee (TYPEOFTAXPAYMENT).

// the exact list (order as the owner sees it in the report)
var tds243Want = []string{
	"STATPAYMENTTYPE", "TAXPAYPERIODFROMDATE", "TAXPAYPERIODTODATE",
	"TAXCHALLANBSRCODE", "TAXBANKCHALLANNUMBER", "TAXCHALLANDATE", "TAXCHEQUENUMBER", "TAXCHEQUEDATE", "TAXBANKNAME", "TAXBANKBRANCHNAME",
	"TDSNATUREOFPAYMENT", "TDSSECTIONNO",
	"ALLLEDGERENTRIES.TYPEOFTAXPAYMENT", "ALLLEDGERENTRIES.STATNATURENAME",
	"ALLLEDGERENTRIES.SUMMARYALLOCS.NAME", "ALLLEDGERENTRIES.SUMMARYALLOCS.FROMDATE", "ALLLEDGERENTRIES.SUMMARYALLOCS.TODATE",
	"ALLLEDGERENTRIES.SUMMARYALLOCS.TDSNATUREOFPAYMENT", "ALLLEDGERENTRIES.SUMMARYALLOCS.TDSSECTIONNO",
	"ALLLEDGERENTRIES.SUMMARYALLOCS.TDSDEDNSTATUS", "ALLLEDGERENTRIES.SUMMARYALLOCS.TDSRESIDENTIALSTATUS",
	"ALLLEDGERENTRIES.SUMMARYALLOCS.FORMTYPE", "ALLLEDGERENTRIES.SUMMARYALLOCS.PAIDAMOUNT",
	"ALLLEDGERENTRIES.SUMMARYALLOCS.TAXCHALLANBSRCODE", "ALLLEDGERENTRIES.SUMMARYALLOCS.TAXBANKCHALLANNUMBER",
	"ALLLEDGERENTRIES.SUMMARYALLOCS.TAXCHALLANDATE", "ALLLEDGERENTRIES.SUMMARYALLOCS.TAXCHEQUENUMBER",
	"ALLLEDGERENTRIES.SUMMARYALLOCS.TAXCHEQUEDATE", "ALLLEDGERENTRIES.SUMMARYALLOCS.TAXBANKNAME",
	"ALLLEDGERENTRIES.SUMMARYALLOCS.TAXBANKBRANCHNAME",
}

func TestTDS243KeptFieldsExactly(t *testing.T) {
	if strings.Join(liveKeepTDS243, ",") != strings.Join(tds243Want, ",") {
		t.Fatalf("the kept TDS challan fields:\n got %v\nwant %v", liveKeepTDS243, tds243Want)
	}
	ok := fastApprovedPaths()
	for _, f := range tds243Want {
		if !ok[f] {
			t.Errorf("%s not kept by the strip", f)
		}
	}
	// the approved paths: today's 61 named fields, the two TDS lists whole, 2.4.2's GST type and these
	if n := len(ok); n != 61+2+len(gst242Want)+len(tds243Want) {
		t.Errorf("%d approved paths", n)
	}
}

// the entry requests are unchanged: none of these in either FETCHLIST, both shapes as measured and proven
func TestTDS243VoucherRequestUnchanged(t *testing.T) {
	if shapeOf(allowListSamples()[vchObjectID]) != "ce0e72f74e72" || shapeOf(allowListSamples()[vchByNumberID]) != "2167477221dc" {
		t.Fatalf("the entry requests' shapes changed: object %s, by number %s", shapeOf(allowListSamples()[vchObjectID]), shapeOf(allowListSamples()[vchByNumberID]))
	}
	for _, f := range liveFetchFields() {
		for _, g := range tds243Want {
			if f == g {
				t.Errorf("%s in the FETCHLIST", f)
			}
		}
	}
}

// Tally's real answers: the strip keeps the challan details and the payment's split, and no other field
func TestTDS243StripRealCaptures(t *testing.T) {
	want := map[string][]string{
		"PX1": {"<STATPAYMENTTYPE>TDS</STATPAYMENTTYPE>", "<TAXCHALLANBSRCODE>0510308</TAXCHALLANBSRCODE>", "<TAXBANKCHALLANNUMBER>54321</TAXBANKCHALLANNUMBER>",
			"<TAXCHALLANDATE>20261231</TAXCHALLANDATE>", "<TAXCHEQUENUMBER>778899</TAXCHEQUENUMBER>", "<TAXCHEQUEDATE>20261201</TAXCHEQUEDATE>",
			"<TAXBANKNAME>HDFC Bank Ltd</TAXBANKNAME>", "<TAXBANKBRANCHNAME>Connaught Place</TAXBANKBRANCHNAME>", "<TAXPAYPERIODFROMDATE>20261101</TAXPAYPERIODFROMDATE>",
			"<TDSNATUREOFPAYMENT>FC Prof Fees 194J</TDSNATUREOFPAYMENT>", "<TDSSECTIONNO>194J</TDSSECTIONNO>",
			"<TYPEOFTAXPAYMENT>Tax</TYPEOFTAXPAYMENT>", "<TYPEOFTAXPAYMENT>Interest</TYPEOFTAXPAYMENT>", "<TYPEOFTAXPAYMENT>Late Fee</TYPEOFTAXPAYMENT>",
			"<STATNATURENAME>FC Prof Fees 194J</STATNATURENAME>"},
		"SP1": {"<STATPAYMENTTYPE>TDS</STATPAYMENTTYPE>", "<TAXPAYPERIODFROMDATE>20261101</TAXPAYPERIODFROMDATE>", "<TAXPAYPERIODTODATE>20261102</TAXPAYPERIODTODATE>",
			"<SUMMARYALLOCS.LIST>", "<NAME>TDS/Q3/2026-27/26Q</NAME>", "<TDSNATUREOFPAYMENT>FC Contract 194C</TDSNATUREOFPAYMENT>", "<TDSSECTIONNO>194C</TDSSECTIONNO>",
			"<TDSDEDNSTATUS>Company</TDSDEDNSTATUS>", "<TDSRESIDENTIALSTATUS>Resident</TDSRESIDENTIALSTATUS>", "<FORMTYPE>26Q</FORMTYPE>", "<PAIDAMOUNT>-2000.00</PAIDAMOUNT>",
			// the link to the deduction it pays (already kept: TAXOBJECTALLOCATIONS whole)
			"<REFTYPE>Agst Ref</REFTYPE>", "<TAXNAME>5XM6JEN801imvm4W</TAXNAME>"},
		"K1": {"<REFTYPE>New Ref</REFTYPE>", "<TAXNAME>5XM6JEN801imvm4W</TAXNAME>"},
	}
	ok := fastApprovedPaths()
	never := regexp.MustCompile(`<(STATENAME|TAXTYPE|VCHSTATUS\w*|CMPGSTREGISTRATIONTYPE|GSTCLASS|ISDEEMEDPOSITIVE_X|CHEQUECROSSCOMMENT|BANKRECONSTATUS|PAYMENTMODE)[ >]`)
	fs, _ := filepath.Glob(filepath.Join("testdata", "tdsfields243", "7.1", "obj-*.xml.gz"))
	if len(fs) < 6 {
		t.Fatalf("%d captures", len(fs))
	}
	for _, f := range fs {
		id := strings.TrimSuffix(strings.TrimPrefix(filepath.Base(f), "obj-"), ".xml.gz")
		vs := reVchBlock.FindAllString(gz242(t, f), -1)
		if len(vs) != 1 {
			t.Fatalf("%s: %d vouchers", f, len(vs))
		}
		s := fastStripVoucher(cleanXML(vs[0]))
		if s == "" {
			t.Errorf("%s: held by the strip", f)
			continue
		}
		for _, p := range fastLeafPaths(s) {
			if !fastPathOK(ok, p) {
				t.Errorf("%s: %s kept (not an approved field)", f, p)
			}
		}
		// TAXTYPE is kept only inside the TDS list (approved whole), never elsewhere
		if m := never.FindString(regexp.MustCompile(`(?s)<TAXOBJECTALLOCATIONS\.LIST>.*?</TAXOBJECTALLOCATIONS\.LIST>`).ReplaceAllString(s, "")); m != "" {
			t.Errorf("%s: %s kept", f, m)
		}
		for _, w := range want[id] {
			if !strings.Contains(s, w) {
				t.Errorf("%s: the stripped entry lacks %s", id, w)
			}
		}
		out := strings.TrimSuffix(f, ".xml.gz") + "-stripped.xml"
		if os.Getenv("TDS243_GOLDEN") != "" {
			if err := os.WriteFile(out, []byte(s), 0o644); err != nil {
				t.Fatal(err)
			}
		} else if readText(out) != s {
			t.Errorf("%s: not what the strip makes now (TDS243_GOLDEN=1 rewrites it)", out)
		}
	}
}

// what 2.4.2 kept is kept the same: an entry without any of these strips exactly as before
func TestTDS243OtherwiseTheSameStrip(t *testing.T) {
	v := `<VOUCHER REMOTEID="g" VCHTYPE="Payment"><DATE>20261001</DATE><STATPAYMENTTYPE>TDS</STATPAYMENTTYPE><TAXUNITNAME>x</TAXUNITNAME><LEDGERENTRIES.LIST><LEDGERNAME>TDS</LEDGERNAME><AMOUNT>-1.00</AMOUNT><TYPEOFTAXPAYMENT>Interest</TYPEOFTAXPAYMENT><SUMMARYALLOCS.LIST><STATENAME>India</STATENAME><TAXCHALLANBSRCODE>0510308</TAXCHALLANBSRCODE></SUMMARYALLOCS.LIST></LEDGERENTRIES.LIST></VOUCHER>`
	want := `<VOUCHER REMOTEID="g" VCHTYPE="Payment"><DATE>20261001</DATE><STATPAYMENTTYPE>TDS</STATPAYMENTTYPE><ALLLEDGERENTRIES.LIST><LEDGERNAME>TDS</LEDGERNAME><AMOUNT>-1.00</AMOUNT><TYPEOFTAXPAYMENT>Interest</TYPEOFTAXPAYMENT><SUMMARYALLOCS.LIST><TAXCHALLANBSRCODE>0510308</TAXCHALLANBSRCODE></SUMMARYALLOCS.LIST></ALLLEDGERENTRIES.LIST></VOUCHER>`
	if got := fastStripVoucher(v); got != want {
		t.Fatalf("got  %s\nwant %s", got, want)
	}
}
