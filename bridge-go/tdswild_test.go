package main

// The owner's decision of 07-Oct-2026 (option A): "Ask for all fields of the TDS list and its sub-list on
// FinComVoucherByMaster, FinComVoucherByNumber and test forms A and C. One entry per request, read only, nothing else
// added." The real TallyPrime 7.1 run 37492981527 (S5, a journal with TDS entered on Tally's screen) showed the entry
// request's named TDS fields (TAXOBJECTALLOCATIONS.TAXTYPE .. SUBCATEGORYALLOCATION.TAX) come back as empty
// TAXOBJECTALLOCATIONS.LISTs, while the harness's collection with ALLLEDGERENTRIES.TAXOBJECTALLOCATIONS.* and
// ALLLEDGERENTRIES.TAXOBJECTALLOCATIONS.SUBCATEGORYALLOCATION.* returned the whole block (captured in
// testdata/real-tally-7.1/231/s5-tds-on-screen.daybook.xml, after the Day Book export). The entry request adds exactly
// those two items. Tests written before the code.

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// what the owner's 07-Oct decision adds to the entry request's fetch, and only this
const tdsWildAdded = ", ALLLEDGERENTRIES.TAXOBJECTALLOCATIONS.*, ALLLEDGERENTRIES.TAXOBJECTALLOCATIONS.SUBCATEGORYALLOCATION.*"

// the fetch as 2.3.1 built it
const tdsWildBefore = partABefore + partAAdded

// the allow-list shapes as 2.3.1 built them (docs/tally-allowlist.md at 2.3.1). release-240 (merged onto 2.3.5): of the
// four rows the owner named, FinComVoucherByMaster is replaced by FinComVoucherObject (2.3.4, the owner's decision of
// 08-Oct-2026, "Allow, strip in bridge") and the test forms A and C are gone (2.3.4, the owner's decision of 08-Oct-2026);
// FinComVoucherByNumber is the one row whose shape changes with the fetch
var tdsWildOldShapes = map[string]string{vchByNumberID: "111afcb61eb9"}

// FinComVoucherObject's bytes stay those measured and proven on real Tally: the object export sends the whole voucher
// whatever its FETCHLIST names, so the TDS list and its sub-list are kept by the strip (fastPathOK), not asked for
const tdsWildObjectShape = "ce0e72f74e72"

// --- 1. the fetch: 2.3.1's plus the two wildcard items, nothing else new; both requests otherwise as before
func TestTDSWildFetchExactly(t *testing.T) {
	if liveFetchField != tdsWildBefore+tdsWildAdded {
		t.Fatalf("the entry request's fetch is not 2.3.1's plus the two TDS wildcard items:\n%s", liveFetchField)
	}
	seen := map[string]bool{}
	for _, f := range strings.Split(liveFetchField, ", ") {
		if seen[f] {
			t.Errorf("fetched twice: %s", f)
		}
		seen[f] = true
		if strings.Contains(f, "*") && f != "ALLLEDGERENTRIES.TAXOBJECTALLOCATIONS.*" && f != "ALLLEDGERENTRIES.TAXOBJECTALLOCATIONS.SUBCATEGORYALLOCATION.*" {
			t.Errorf("a wildcard other than the TDS list's and its sub-list's: %q", f)
		}
	}
	byNumber := voucherByNumberRequest(spikeCo, "20270101", "Journal", "1")
	if strings.Replace(byNumber, "<FETCH>"+liveFetchField+"</FETCH>", "<FETCH>"+tdsWildBefore+"</FETCH>", 1) != fcCollection(vchByNumberID, spikeCo, periodVars("20270101", "20270101"), "Voucher", tdsWildBefore, `$VoucherNumber = "1" AND $VoucherTypeName = "Journal"`) {
		t.Fatalf("by number: more than the fetch changed:\n%s", byNumber)
	}
	object := voucherObjectRequest(spikeCo, "3")
	for name, x := range map[string]string{"by MasterID (the object export)": object, "by number": byNumber} {
		if !strings.Contains(x, "<TALLYREQUEST>Export</TALLYREQUEST>") || isImportRequest(x) {
			t.Fatalf("%s: not a read: %s", name, x)
		}
		if err := checkAllowed(x); err != nil {
			t.Fatalf("%s refused: %v", name, err)
		}
		if m := computedFigure(x); m != "" {
			t.Fatalf("%s asks for a computed figure: %s", name, m)
		}
	}
	// the object export: one MasterID, its FETCHLIST the named fields (no wildcard), its bytes as proven on real Tally
	if strings.Contains(object, "*") || strings.Count(object, "<FETCH>") != len(liveFetchFields()) || shapeOf(allowListSamples()[vchObjectID]) != tdsWildObjectShape {
		t.Fatalf("the object export changed: %s", object)
	}
	// the strip keeps the TDS list and its sub-list whole (and nothing else new)
	ok := fastApprovedPaths()
	for _, p := range []string{"ALLLEDGERENTRIES.TAXOBJECTALLOCATIONS.CATEGORY", "ALLLEDGERENTRIES.TAXOBJECTALLOCATIONS.SUBCATEGORYALLOCATION.SUBCATEGORY",
		"ALLLEDGERENTRIES.TAXOBJECTALLOCATIONS.SUBCATEGORYALLOCATION.DUTYLEDGER"} {
		if !fastPathOK(ok, p) {
			t.Errorf("the strip drops %s", p)
		}
	}
	for _, p := range []string{"ALLLEDGERENTRIES.TAXOBJECTALLOCATIONS.SUBCATEGORYALLOCATION.X.LIST.Y", "ALLLEDGERENTRIES.OTHERLIST.FIELD", "ALLLEDGERENTRIES.CLOSINGBALANCE"} {
		if fastPathOK(ok, strings.ReplaceAll(p, ".LIST", "")) {
			t.Errorf("the strip keeps %s", p)
		}
	}
	// test forms B, D, E and F as in 2.3.0 (A and C gone in 2.3.4)
	for _, l := range []string{"B", "D", "E", "F"} {
		if x := fetchTestRequest(l, spikeCo, "20270101", "Journal", "1", "3"); !strings.Contains(x, "<FETCH>"+liveFetchField222+"</FETCH>") || strings.Contains(x, "*") {
			t.Errorf("trial form %s does not keep the 2.3.0 fetch", l)
		}
	}
}

// --- 2. the allow-list: FinComVoucherByNumber's shape changes with the fetch alone (the request with 2.3.1's fetch put
// back has 2.3.1's shape); FinComVoucherObject's is unchanged; every other row is untouched (TestAllowListUnchanged holds
// the doc to the table)
func TestTDSWildAllowListShapes(t *testing.T) {
	samples := allowListSamples()
	for id, old := range tdsWildOldShapes {
		x := samples[id]
		if !strings.Contains(x, "<FETCH>"+liveFetchField+"</FETCH>") {
			t.Fatalf("%s does not carry the entry fetch", id)
		}
		if got := shapeOf(x); got == old {
			t.Errorf("%s: shape %s unchanged", id, got)
		}
		if back := shapeOf(strings.Replace(x, "<FETCH>"+liveFetchField+"</FETCH>", "<FETCH>"+tdsWildBefore+"</FETCH>", 1)); back != old {
			t.Errorf("%s: with 2.3.1's fetch put back the shape is %s, not 2.3.1's %s: more than the fetch changed", id, back, old)
		}
	}
	if got := shapeOf(samples[vchObjectID]); got != tdsWildObjectShape {
		t.Errorf("%s: shape %s, not the proven %s", vchObjectID, got, tdsWildObjectShape)
	}
	// review L4 of 2.4.0 part 2 (08-Oct-2026): the 2.4.0 line is IN FORCE (the decision line release-check reads, not a
	// draft), names the change and quotes the owner's approval of 2026-10-07 (option A); 2.3.1's decisions kept as history
	al := readText("../docs/tally-allowlist.md")
	line := group(`(?m)^(First table: .*)$`, al, 1)
	for _, w := range []string{"allowed for 2.4.0 by the owner's decision of 2026-10-07 (option A", "ALLLEDGERENTRIES.TAXOBJECTALLOCATIONS.* and ALLLEDGERENTRIES.TAXOBJECTALLOCATIONS.SUBCATEGORYALLOCATION.*",
		"one entry per request, read only, nothing else added",
		`the owner's words: "Ask for all fields of the TDS list and its sub-list on FinComVoucherByMaster, FinComVoucherByNumber and test forms A and C. One entry per request, read only, nothing else added. Work out the rate as tax divided by assessable amount where Tally stores 0, and mark it as worked out."`,
		"as for 2.3.1: the owner's decision of 2026-10-06"} {
		if !strings.Contains(line, w) {
			t.Errorf("the decision line in force does not say %q", w)
		}
	}
	if strings.Contains(al, "Draft of the next release's line") || strings.Contains(al, "<next>") {
		t.Error("docs/tally-allowlist.md still holds the draft line: the 2.4.0 line is to be in force")
	}
	rows, _ := docAllowList(t)
	for id, old := range tdsWildOldShapes {
		if strings.Contains(rows, "| "+old+" |") {
			t.Errorf("docs/tally-allowlist.md still holds %s's 2.3.1 shape %s", id, old)
		}
		if !strings.Contains(rows, "| "+id+" | ") || !strings.Contains(rows, "| "+shapeOf(samples[id])+" |") {
			t.Errorf("docs/tally-allowlist.md does not hold %s's new shape %s", id, shapeOf(samples[id]))
		}
	}
}

// --- 3. on the real capture (run 37492981527, S5): Tally's whole TDS block, cut down to what the entry request now
// fetches, still carries the Contractor line's nature, party, sub-category, rate, assessable amount and tax; cut down to
// 2.3.1's fetch, the TDS lists come back empty, as the real run showed (s5-tds-on-screen.entry.xml)
func TestTDSWildRealCapture(t *testing.T) {
	b, err := os.ReadFile(filepath.Join("testdata", "real-tally-7.1", "231", "s5-tds-on-screen.daybook.xml"))
	if err != nil {
		t.Fatal(err)
	}
	s := string(b)
	coll := s[strings.Index(s, "<!-- the voucher collection of MasterID 3 -->"):]
	a, z := strings.Index(coll, "<VOUCHER REMOTEID"), strings.LastIndex(coll, "</VOUCHER>")+len("</VOUCHER>")
	if a < 0 || z < a {
		t.Fatal("no voucher in the capture's collection part")
	}
	vch := coll[a:z]
	now := partAFilter(vch, liveFetchField)
	for _, w := range []string{"<CATEGORY>S231 Contract Work</CATEGORY>", "<TAXTYPE>TDS</TAXTYPE>", "<PARTYLEDGER>S231 Contractor</PARTYLEDGER>",
		"<SUBCATEGORY>Income Tax</SUBCATEGORY>", "<DUTYLEDGER>S231 TDS Payable</DUTYLEDGER>", "<TAXRATE>0</TAXRATE>",
		"<ASSESSABLEAMOUNT>100000.00</ASSESSABLEAMOUNT>", "<TAX>2000.00</TAX>", "<SUBCATEGORY>Surcharge</SUBCATEGORY>",
		// review L2 of 2.4.0 part 2: Tally's exempt mark on the line reaches the cloud (parse.js keeps it; no rate is worked out)
		"<EXEMPTED>Yes</EXEMPTED>"} {
		if !strings.Contains(now, w) {
			t.Errorf("the body as the request now fetches it lacks %s", w)
		}
	}
	// the named fields alone: Tally's answer held empty lists; here they are what the named fields keep (no sub-category
	// name, no duty ledger: not enough to tell Income Tax from the cess heads)
	before := partAFilter(vch, tdsWildBefore)
	if strings.Contains(before, "<SUBCATEGORY>") || strings.Contains(before, "<DUTYLEDGER>") {
		t.Error("2.3.1's fetch already carried the sub-category: the test proves nothing")
	}
	// release-240: the bridge's strip (the object export's answer cut to the approved fields) keeps the same TDS block
	stripped := fastStripVoucher(cleanXML(vch))
	for _, w := range []string{"<TAXTYPE>TDS</TAXTYPE>", "<PARTYLEDGER>S231 Contractor</PARTYLEDGER>", "<SUBCATEGORY>Income Tax</SUBCATEGORY>",
		"<DUTYLEDGER>S231 TDS Payable</DUTYLEDGER>", "<ASSESSABLEAMOUNT>100000.00</ASSESSABLEAMOUNT>", "<TAX>2000.00</TAX>", "<SUBCATEGORY>Surcharge</SUBCATEGORY>"} {
		if !strings.Contains(stripped, w) {
			t.Errorf("the strip of Tally's voucher lacks %s", w)
		}
	}
	e, err := os.ReadFile(filepath.Join("testdata", "real-tally-7.1", "231", "s5-tds-on-screen.entry.xml"))
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(e), "<SUBCATEGORYALLOCATION.LIST>") || !strings.Contains(string(e), "<TAXOBJECTALLOCATIONS.LIST>      </TAXOBJECTALLOCATIONS.LIST>") {
		t.Error("the real answer to 2.3.1's request is not the empty TDS list the run showed")
	}
}
