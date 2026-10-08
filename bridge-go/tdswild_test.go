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

// the allow-list shapes of the four rows as 2.3.1 built them (docs/tally-allowlist.md at 2.3.1)
var tdsWildOldShapes = map[string]string{vchByMasterID: "9708f011f6ce", vchByNumberID: "111afcb61eb9", fetchTestA: "695e040c7274", fetchTestC: "4692878ad37b"}

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
	byMaster := voucherByMasterRequest(spikeCo, "20270101", []string{"3"})
	byNumber := voucherByNumberRequest(spikeCo, "20270101", "Journal", "1")
	for name, x := range map[string]string{"by MasterID": byMaster, "by number": byNumber} {
		id, filter := vchByMasterID, "$MasterID = 3"
		if name == "by number" {
			id, filter = vchByNumberID, `$VoucherNumber = "1" AND $VoucherTypeName = "Journal"`
		}
		if strings.Replace(x, "<FETCH>"+liveFetchField+"</FETCH>", "<FETCH>"+tdsWildBefore+"</FETCH>", 1) != fcCollection(id, spikeCo, periodVars("20270101", "20270101"), "Voucher", tdsWildBefore, filter) {
			t.Fatalf("%s: more than the fetch changed:\n%s", name, x)
		}
		if !strings.Contains(x, "<TALLYREQUEST>Export</TALLYREQUEST>") || strings.Count(x, "<COLLECTION ") != 1 || !strings.Contains(x, `ISMODIFY="No"`) || isImportRequest(x) {
			t.Fatalf("%s: not a read: %s", name, x)
		}
		if err := checkAllowed(x); err != nil {
			t.Fatalf("%s refused: %v", name, err)
		}
		if m := computedFigure(x); m != "" {
			t.Fatalf("%s asks for a computed figure: %s", name, m)
		}
	}
	// one entry per request: never two MasterIDs
	if voucherByMasterRequest(spikeCo, "20270101", []string{"3", "4"}) != "" {
		t.Fatal("two MasterIDs built a request")
	}
	// test forms A and C: byte for byte the two requests; B, D, E and F as in 2.3.0
	if strings.ReplaceAll(fetchTestRequest("A", spikeCo, "20270101", "Journal", "1", ""), fetchTestA, vchByNumberID) != byNumber ||
		strings.ReplaceAll(fetchTestRequest("C", spikeCo, "20270101", "", "", "3"), fetchTestC, vchByMasterID) != byMaster {
		t.Fatal("the test forms A and C are no longer the two requests as built")
	}
	for _, l := range []string{"B", "D", "E", "F"} {
		if x := fetchTestRequest(l, spikeCo, "20270101", "Journal", "1", "3"); !strings.Contains(x, "<FETCH>"+liveFetchField222+"</FETCH>") || strings.Contains(x, "*") {
			t.Errorf("trial form %s does not keep the 2.3.0 fetch", l)
		}
	}
}

// --- 2. the allow-list: the four rows' shapes change with the fetch alone (the request with 2.3.1's fetch put back has
// 2.3.1's shape); every other row is untouched (TestAllowListUnchanged holds the doc to the table)
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
	// review L4 of 2.4.0 part 2 (08-Oct-2026): the 2.4.0 line is IN FORCE (the decision line release-check reads, not a
	// draft), names the change and quotes the owner's approval of 2026-10-07 (option A); 2.3.1's decisions kept as history
	al := readText("../docs/tally-allowlist.md")
	line := group(`(?m)^(First table: .*)$`, al, 1)
	for _, w := range []string{"allowed for 2.4.0 by the owner's decision of 2026-10-07 (option A)", "ALLLEDGERENTRIES.TAXOBJECTALLOCATIONS.* and ALLLEDGERENTRIES.TAXOBJECTALLOCATIONS.SUBCATEGORYALLOCATION.*",
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
	e, err := os.ReadFile(filepath.Join("testdata", "real-tally-7.1", "231", "s5-tds-on-screen.entry.xml"))
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(e), "<SUBCATEGORYALLOCATION.LIST>") || !strings.Contains(string(e), "<TAXOBJECTALLOCATIONS.LIST>      </TAXOBJECTALLOCATIONS.LIST>") {
		t.Error("the real answer to 2.3.1's request is not the empty TDS list the run showed")
	}
}
