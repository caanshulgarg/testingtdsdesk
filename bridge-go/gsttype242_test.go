package main

import (
	"bytes"
	"compress/gzip"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"testing"
	"time"
)

// --- 2.4.2 (round 44 part B; the owner's approval of 11-Oct-2026, "the bridge sends each entry's GST type"): the fields of
// Tally's whole-voucher answer to FinComVoucherObject that carry an entry's GST type are kept by the strip, and nothing
// else is added. Measured on real TallyPrime 3.0, 4.1, 5.1, 6.2 and 7.1 (tally-versions mode gsttype, runs 38099393603
// and 38100635902; the raw answers in testdata/gsttype242/<release>/; an item's tags: TestGST242ItemTagsKept). The request is the same bytes (Tally sends the
// whole voucher whatever the FETCHLIST names), so its shape stays ce0e72f74e72.

// the exact list (order as the owner sees it in the report)
var gst242Want = []string{
	"GSTREGISTRATIONTYPE", "COUNTRYOFRESIDENCE", "ISREVERSECHARGEAPPLICABLE",
	"ALLLEDGERENTRIES.GSTOVRDNNATURE", "ALLLEDGERENTRIES.GSTOVRDNTAXABILITY", "ALLLEDGERENTRIES.GSTOVRDNTYPEOFSUPPLY",
	"ALLLEDGERENTRIES.GSTOVRDNINELIGIBLEITC", "ALLLEDGERENTRIES.GSTOVRDNISREVCHARGEAPPL",
	"ALLINVENTORYENTRIES.GSTOVRDNNATURE", "ALLINVENTORYENTRIES.GSTOVRDNTAXABILITY", "ALLINVENTORYENTRIES.GSTOVRDNTYPEOFSUPPLY",
	"ALLINVENTORYENTRIES.GSTOVRDNINELIGIBLEITC", "ALLINVENTORYENTRIES.GSTOVRDNISREVCHARGEAPPL",
	"ALLINVENTORYENTRIES.ACCOUNTINGALLOCATIONS.GSTOVRDNNATURE", "ALLINVENTORYENTRIES.ACCOUNTINGALLOCATIONS.GSTOVRDNTAXABILITY",
	"ALLINVENTORYENTRIES.ACCOUNTINGALLOCATIONS.GSTOVRDNTYPEOFSUPPLY", "ALLINVENTORYENTRIES.ACCOUNTINGALLOCATIONS.GSTOVRDNINELIGIBLEITC",
	"ALLINVENTORYENTRIES.ACCOUNTINGALLOCATIONS.GSTOVRDNISREVCHARGEAPPL",
}

func TestGST242KeptFieldsExactly(t *testing.T) {
	if strings.Join(liveKeepGST242, ",") != strings.Join(gst242Want, ",") {
		t.Fatalf("the kept GST type fields:\n got %v\nwant %v", liveKeepGST242, gst242Want)
	}
	ok := fastApprovedPaths()
	for _, f := range gst242Want {
		if !ok[f] {
			t.Errorf("%s not kept by the strip", f)
		}
	}
	// the approved paths: today's 61 named fields, the two TDS lists whole, and these
	if n := len(ok); n != 61+2+len(gst242Want) {
		t.Errorf("%d approved paths", n)
	}
}

// the request is unchanged: not in the FETCHLIST of either entry request, both shapes as measured and proven
func TestGST242RequestShapeUnchanged(t *testing.T) {
	if shapeOf(allowListSamples()[vchObjectID]) != "ce0e72f74e72" || shapeOf(allowListSamples()[vchByNumberID]) != "2167477221dc" {
		t.Fatalf("the entry requests' shapes changed: object %s, by number %s", shapeOf(allowListSamples()[vchObjectID]), shapeOf(allowListSamples()[vchByNumberID]))
	}
	for _, q := range []string{voucherObjectRequest("FinCom Spike Co", "4"), allowListSamples()[vchByNumberID]} {
		for _, f := range gst242Want {
			if strings.Contains(q, f) {
				t.Errorf("%s asked in a request: %.120s", f, q)
			}
		}
	}
	for _, f := range liveFetchFields() {
		for _, g := range gst242Want {
			if f == g {
				t.Errorf("%s in the FETCHLIST", f)
			}
		}
	}
}

func gz242(t *testing.T, f string) string {
	b, err := os.ReadFile(f)
	if err != nil {
		t.Fatal(err)
	}
	r, err := gzip.NewReader(bytes.NewReader(b))
	if err != nil {
		t.Fatal(err)
	}
	x, err := io.ReadAll(r)
	if err != nil {
		t.Fatal(err)
	}
	return string(x)
}

// Tally's real answers on every release: the strip keeps each entry's GST type and no other GST field
func TestGST242StripRealCaptures(t *testing.T) {
	rels, _ := filepath.Glob(filepath.Join("testdata", "gsttype242", "[0-9].[0-9]"))
	sort.Strings(rels)
	if len(rels) != 5 {
		t.Fatalf("captures for %d releases: %v", len(rels), rels)
	}
	want := map[string][]string{
		"S03":   {"<ALLLEDGERENTRIES.LIST>", "<GSTOVRDNNATURE>Sales to SEZ - Taxable</GSTOVRDNNATURE>", "<GSTREGISTRATIONTYPE>Regular</GSTREGISTRATIONTYPE>"},
		"S04":   {"<GSTOVRDNNATURE>Sales to SEZ - LUT/Bond</GSTOVRDNNATURE>"},
		"S05":   {"<COUNTRYOFRESIDENCE>Germany</COUNTRYOFRESIDENCE>", "<GSTOVRDNNATURE>Exports - Taxable</GSTOVRDNNATURE>"},
		"S06":   {"<GSTOVRDNNATURE>Exports - LUT/Bond</GSTOVRDNNATURE>"},
		"S10":   {"<GSTOVRDNTAXABILITY>Nil Rated</GSTOVRDNTAXABILITY>"},
		"S11":   {"<GSTOVRDNTAXABILITY>Exempt</GSTOVRDNTAXABILITY>", "<GSTREGISTRATIONTYPE>Unregistered</GSTREGISTRATIONTYPE>"},
		"S15":   {"<GSTOVRDNTYPEOFSUPPLY>Services</GSTOVRDNTYPEOFSUPPLY>"},
		"P03":   {"<ISREVERSECHARGEAPPLICABLE>Yes</ISREVERSECHARGEAPPLICABLE>"},
		"P04L":  {"<GSTOVRDNINELIGIBLEITC> Applicable</GSTOVRDNINELIGIBLEITC>" /* Tally's "&#4; Applicable", its &#4; dropped by cleanXML */},
		"P04V2": {"<GSTOVRDNINELIGIBLEITC> Applicable</GSTOVRDNINELIGIBLEITC>" /* Tally's "&#4; Applicable", its &#4; dropped by cleanXML */},
	}
	ok := fastApprovedPaths()
	never := regexp.MustCompile(`<(GSTOVRDNSTOREDNATURE|CMPGSTREGISTRATIONTYPE|VCHGSTSTATUS\w*|ISELIGIBLEFORITC|VCHGSTCLASS|STATENAME|GSTOVRDNISTAXONMRPAPPLICABLE|GSTOVRDNCLASSIFICATION|GSTCLASS)[ >]`)
	for _, d := range rels {
		fs, _ := filepath.Glob(filepath.Join(d, "obj-*.xml.gz"))
		if len(fs) < len(want) {
			t.Errorf("%s: %d captures", d, len(fs))
		}
		for _, f := range fs {
			id := strings.TrimSuffix(strings.TrimPrefix(filepath.Base(f), "obj-"), ".xml.gz")
			vs := reVchBlock.FindAllString(gz242(t, f), -1)
			if len(vs) != 1 {
				t.Fatalf("%s: %d vouchers", f, len(vs))
			}
			t0 := time.Now()
			s := fastStripVoucher(cleanXML(vs[0]))
			if el := time.Since(t0); el > 200*time.Millisecond {
				t.Errorf("%s: the strip took %v", f, el)
			}
			if s == "" {
				t.Errorf("%s: held by the strip", f)
				continue
			}
			for _, p := range fastLeafPaths(s) {
				if !fastPathOK(ok, p) {
					t.Errorf("%s: %s kept (not an approved field)", f, p)
				}
			}
			if m := never.FindString(s); m != "" {
				t.Errorf("%s: %s kept", f, m)
			}
			for _, w := range want[id] {
				if !strings.Contains(s, w) {
					t.Errorf("%s %s: the stripped entry lacks %s", filepath.Base(d), id, w)
				}
			}
			// the stripped entry as the bridge sends it (read by FinCom's reader in tests/run_parse_gsttype.mjs)
			out := strings.TrimSuffix(f, ".xml.gz") + "-stripped.xml"
			if os.Getenv("GSTTYPE242_GOLDEN") != "" {
				if err := os.WriteFile(out, []byte(s), 0o644); err != nil {
					t.Fatal(err)
				}
			} else if readText(out) != s {
				t.Errorf("%s: not what the strip makes now (GSTTYPE242_GOLDEN=1 rewrites it)", out)
			}
			// every release keeps these on every entry it gives them on
			if !strings.Contains(s, "<ISREVERSECHARGEAPPLICABLE>") || !strings.Contains(s, "<GSTREGISTRATIONTYPE>") {
				t.Errorf("%s %s: no registration type or reverse-charge mark kept", filepath.Base(d), id)
			}
		}
	}
}

// what 2.4.1 kept is kept the same: an entry without any GST type field strips exactly as before
func TestGST242OtherwiseTheSameStrip(t *testing.T) {
	v := `<VOUCHER REMOTEID="g" VCHTYPE="Journal"><DATE>20261001</DATE><NARRATION>n</NARRATION><CMPGSTREGISTRATIONTYPE>Regular</CMPGSTREGISTRATIONTYPE><LEDGERENTRIES.LIST><LEDGERNAME>Cash</LEDGERNAME><AMOUNT>-1.00</AMOUNT><GSTOVRDNSTOREDNATURE>x</GSTOVRDNSTOREDNATURE></LEDGERENTRIES.LIST></VOUCHER>`
	want := `<VOUCHER REMOTEID="g" VCHTYPE="Journal"><DATE>20261001</DATE><NARRATION>n</NARRATION><ALLLEDGERENTRIES.LIST><LEDGERNAME>Cash</LEDGERNAME><AMOUNT>-1.00</AMOUNT></ALLLEDGERENTRIES.LIST></VOUCHER>`
	if got := fastStripVoucher(v); got != want {
		t.Fatalf("got  %s\nwant %s", got, want)
	}
	w2 := `<VOUCHER REMOTEID="g" VCHTYPE="Sales"><GSTREGISTRATIONTYPE>Regular</GSTREGISTRATIONTYPE><ISREVERSECHARGEAPPLICABLE>No</ISREVERSECHARGEAPPLICABLE><LEDGERENTRIES.LIST><LEDGERNAME>S</LEDGERNAME><GSTOVRDNNATURE>Sales to SEZ - Taxable</GSTOVRDNNATURE><GSTOVRDNSTOREDNATURE>x</GSTOVRDNSTOREDNATURE></LEDGERENTRIES.LIST></VOUCHER>`
	want2 := `<VOUCHER REMOTEID="g" VCHTYPE="Sales"><GSTREGISTRATIONTYPE>Regular</GSTREGISTRATIONTYPE><ISREVERSECHARGEAPPLICABLE>No</ISREVERSECHARGEAPPLICABLE><ALLLEDGERENTRIES.LIST><LEDGERNAME>S</LEDGERNAME><GSTOVRDNNATURE>Sales to SEZ - Taxable</GSTOVRDNNATURE></ALLLEDGERENTRIES.LIST></VOUCHER>`
	if got := fastStripVoucher(w2); got != want2 {
		t.Fatalf("got  %s\nwant %s", got, want2)
	}
}

// an item invoice: the five tags Tally writes on an item and on the ledger line under it (real 3.0 .. 7.1, push-design run
// 37741662830: the credit note with items) are kept, under ALLINVENTORYENTRIES and its ACCOUNTINGALLOCATIONS
func TestGST242ItemTagsKept(t *testing.T) {
	for _, rel := range []string{"3.0", "4.1", "5.1", "6.2", "7.1"} {
		raw := gz242(t, filepath.Join("testdata", "fast234kinds", rel, "credit-note-items-object.xml.gz"))
		vs := reVchBlock.FindAllString(raw, -1)
		if len(vs) != 1 {
			t.Fatalf("%s: %d vouchers", rel, len(vs))
		}
		s := fastStripVoucher(cleanXML(vs[0]))
		// every release writes the item's reverse-charge override with a value ("Not Applicable"); 3.0 also its taxability
		have := map[string]bool{}
		for _, q := range fastLeafPaths(s) {
			have[q] = true
		}
		if !have["ALLINVENTORYENTRIES.GSTOVRDNISREVCHARGEAPPL"] || (rel == "3.0" && !strings.Contains(s, "<GSTOVRDNTAXABILITY>Taxable</GSTOVRDNTAXABILITY>")) {
			t.Errorf("%s: the item's GST type not kept: %v", rel, have)
		}
		if !strings.Contains(s, "<ALLINVENTORYENTRIES.LIST>") || !strings.Contains(s, "<ACCOUNTINGALLOCATIONS.LIST>") {
			t.Errorf("%s: the item lines not kept: %.300s", rel, s)
		}
	}
}
