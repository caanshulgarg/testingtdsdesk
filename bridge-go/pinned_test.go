package main

// Bridge 2.2.0, round 5 of the reviews: every request id pinned to its builder (a wrong caller can no longer widen an
// id); the keep list above an AlterID needs the starting point; "note change numbers" writes "not given". Written
// before the fixes.

import (
	"strings"
	"testing"
	"time"
)

// a request may go to Tally: on the allow-list as built, and through the dated guard
func sendable(x string) bool {
	measuring.Add(1)
	defer measuring.Add(-1)
	return checkAllowed(x) == nil && datedRefused(fin, x) == nil
}

func TestEveryIdPinned(t *testing.T) {
	f := newStandTally(t)
	standBridge(t, f, "")
	samples := allowListSamples()
	for id := range tallyAllowList {
		if requestRebuild[id] == nil {
			t.Errorf("%s has no rebuild", id)
		}
	}
	for id, x := range samples {
		measuring.Add(1)
		err := checkAllowed(x)
		measuring.Add(-1)
		if err != nil {
			t.Errorf("%s as built: %v", id, err)
		}
		// one character more in the request's own markup: after <ENVELOPE>, after <BODY>, before the end, after the company
		ats := []int{len("<ENVELOPE>"), strings.Index(x, "<BODY>") + 6, len(x) - 11}
		if i := strings.Index(x, "</SVCURRENTCOMPANY>"); i > 0 {
			ats = append(ats, i+len("</SVCURRENTCOMPANY>"))
		}
		for _, at := range ats {
			y := x[:at] + " " + x[at:]
			measuring.Add(1)
			err := checkAllowed(y)
			measuring.Add(-1)
			if err == nil {
				t.Errorf("%s with one character more at %d passes", id, at)
			}
		}
	}
	// the R5-2 examples
	cnv := strings.NewReplacer("<TYPE>Company</TYPE>", "<TYPE>Voucher</TYPE>", "$AltVchId", "$Amount", "$AltMstId", "$Narration").Replace(companyNumbersRequest(zz))
	cnb := strings.Replace(companyNumbersRequest(zz), "$AltVchId", "$ClosingBalance", 1)
	bad := map[string]string{
		"FinComCompanyNumbers over vouchers":   cnv,
		"FinComCompanyNumbers closing balance": cnb,
		"FinComCompany over vouchers":          fcCollection("FinComCompany", zz, "", "Voucher", "NAME, GUID, AMOUNT, NARRATION", ""),
		"TDSDeskCompanies with a date filter": collectionRequest("TDSDeskCompanies", "Company", "NAME,STARTINGFROM,ENDINGAT,GUID", "",
			`<FILTERS>R5</FILTERS></COLLECTION><SYSTEM TYPE="Formulae" NAME="R5">$EffectiveDate &gt; 1</SYSTEM><COLLECTION NAME="TDSDeskUnused" ISMODIFY="No"><TYPE>Company</TYPE>`),
		"the ledger list over vouchers":  strings.Replace(ledgerChunkRequest(zz, 0, 2000), "<TYPE>Ledger</TYPE>", "<TYPE>Voucher</TYPE>", 1),
		"an Import with a TDL":           importEnvelope("Vouchers", zz, `<TALLYMESSAGE xmlns:UDF="TallyUDF"><TDL><TDLMESSAGE><COLLECTION NAME="X"/></TDLMESSAGE></TDL></TALLYMESSAGE>`),
		"an Import of a stock item":      importEnvelope("Vouchers", zz, `<TALLYMESSAGE xmlns:UDF="TallyUDF"><STOCKITEM NAME="x"></STOCKITEM></TALLYMESSAGE>`),
		"an Import under another report": importEnvelope("Day Book", zz, `<TALLYMESSAGE xmlns:UDF="TallyUDF"><VOUCHER></VOUCHER></TALLYMESSAGE>`),
		"the keep list with a narration": strings.Replace(keepListAboveRequest(zz, 7), "GUID,MASTERID", "GUID,NARRATION,MASTERID", 1),
		"a slice 2019-04 above 0":        sliceRequest(zz, formPlain, "201904", 0),
		"a lower-cased day book":         strings.ToLower(dayBookRequest(zz, "20190401", "20190430")),
	}
	for name, x := range bad {
		if sendable(x) {
			t.Errorf("%s goes to Tally", name)
		}
	}
	// a posting as built goes, a voucher and a ledger
	ok := importEnvelope("Vouchers", zz, `<TALLYMESSAGE xmlns:UDF="TallyUDF">`+finVoucher("p1", fgParty, "P-1", today(), "1.00")+`</TALLYMESSAGE>`)
	if checkAllowed(ok) != nil {
		t.Fatal("a posting is refused")
	}
	led := importEnvelope("All Masters", zz, `<TALLYMESSAGE xmlns:UDF="TallyUDF"><LEDGER NAME="X" ACTION="Create"><NAME>X</NAME><PARENT>Sundry Creditors</PARENT></LEDGER></TALLYMESSAGE>`)
	if checkAllowed(led) != nil {
		t.Fatal("a ledger posting is refused")
	}
}

// --- R5-1: the keep list above an AlterID needs the company's starting point, at or above it; the NWS144 case (form a
// empty, no starting point): no keep list is sent by the measuring tool or the read test
func TestKeepAboveNeedsStartPoint(t *testing.T) {
	f := newStandTally(t)
	f.cnMode = "none"
	standBridge(t, f, "")
	f.add(today(), fgParty, "K-1", "x", "-1.00")
	if sendable(keepListAboveRequest(zz, 0)) {
		t.Fatal("the keep list above 0 goes without a starting point")
	}
	if _, err := runMeasure(measureOpts{company: zz}); err != nil {
		t.Fatal(err)
	}
	if _, err := runReadTest(zz); err != nil {
		t.Fatal(err)
	}
	if f.n("TDSDeskKeepList") != 0 {
		t.Fatalf("a keep list went without a starting point: %v", f.ids())
	}
	if logLines("Measure Tally: "+zz+": the entries above the starting point are not asked: no starting point is recorded") != 1 {
		t.Fatalf("the measuring tool's log: %s", readText(logFile()))
	}
	if f.n(cnReportID) < 2 {
		t.Fatalf("form b not asked by the measure and the read test: %v", f.ids())
	}
	// with a starting point: at or above it only
	noteStartPoint(zz, "co-guid-1", 5, 3)
	if !sendable(keepListAboveRequest(zz, 5)) || sendable(keepListAboveRequest(zz, 4)) {
		t.Fatal("the keep list's AlterID against the starting point")
	}
}

// --- R5-3: "note change numbers" writes "not given" when neither form gave them this time
func TestNoteChangeNumbersNotGiven(t *testing.T) {
	f := newStandTally(t)
	standBridge(t, f, `,"Key":"tray-test-key"`)
	trialOn(t)
	f.add(today(), fgParty, "NG-1", "x", "-1.00")
	if _, err := companyCheck(fin, zz, f.port); err != nil { // numbers given once: cached
		t.Fatal(err)
	}
	f.mu.Lock()
	f.cnMode = "none"
	f.mu.Unlock()
	time.Sleep(10 * time.Millisecond)
	r, err := recorderNoteChangeNumbers()
	if err != nil {
		t.Fatal(err)
	}
	if got := strings.Join(strs(r["lines"]), "|"); !strings.Contains(got, zz+": ALTVCHID=not given, ALTMSTID=not given") {
		t.Fatalf("noted: %s", got)
	}
}
