package main

// --- 2.4.3 (the owner's approval of 11-Oct-2026, (b)): the TDS settings on Tally's masters. The ledger requests
// (FinComLedgers, FinComLedgerChanges, FinComLedgerByName) ask a TDS duty ledger's nature of payment (TDSRATENAME), a
// party's special rate and its lower-deduction certificates; the new request FinComTdsNatures asks the natures of payment
// (Tally's TDSRate masters) with their section, rates and thresholds. Read on real TallyPrime 7.1 (tally-versions mode
// tdsch, run 38155837948: testdata/tdsfields243/7.1/masters-tds-ledgers.xml.gz, Tally's own export of the ledgers;
// natures.xml.gz, a TDSRate collection). Test written before the code.

import (
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

var ledFetch243Added = ", TDSRATENAME, TDSDEDUCTEEISSPECIALRATE, TDSDEDUCTEESPECIALRATE, LOWERDEDUCTION.NATUREOFPAYMENT, " +
	"LOWERDEDUCTION.LOWERDEDUCTIONDETAILS.FROMDATE, LOWERDEDUCTION.LOWERDEDUCTIONDETAILS.TODATE, LOWERDEDUCTION.LOWERDEDUCTIONDETAILS.SECTIONNO, " +
	"LOWERDEDUCTION.LOWERDEDUCTIONDETAILS.CERTIFICATENO, LOWERDEDUCTION.LOWERDEDUCTIONDETAILS.TDSITRATE, LOWERDEDUCTION.LOWERDEDUCTIONDETAILS.LOWERDEDUCTIONLIMIT"

// the ledger requests: 2.4.2's fields byte for byte, then exactly these; the natures request: its fields; all on the list,
// pinned to their builders, nothing computed
func TestTDS243Requests(t *testing.T) {
	if ledFetch242 != "GUID, MASTERID, ALTERID, NAME, PARENT, OPENINGBALANCE, PARTYGSTIN, INCOMETAXNUMBER, LEDGSTREGDETAILS.LIST, LEDSTATENAME, TDSDEDUCTEETYPE" ||
		ledFetch != ledFetch242+ledFetch243Added+ledFetch244Added { // 2.4.4: the pay-head fields after (payroll244_test.go)
		t.Fatalf("the ledger fields: %s", ledFetch)
	}
	for _, x := range []string{ledgerChangesRequest("SAMPLE CO", 5, 205), ledgerByNameRequest("SAMPLE CO", "Supplier B"), ledgerChunkRequest("SAMPLE CO", 0, 2000)} {
		if f := group(`<FETCH>([^<]*)</FETCH>`, x, 1); f != ledFetch {
			t.Fatalf("the fields: %s", x)
		}
		if err := checkAllowed(x); err != nil {
			t.Fatalf("refused: %v", err)
		}
	}
	want := "GUID, MASTERID, ALTERID, NAME, CATEGORYDETAILS.APPLICABLEFROM, CATEGORYDETAILS.TDSRATESECTION, CATEGORYDETAILS.RATEOFTAX, " +
		"CATEGORYDETAILS.OTHERRATE, CATEGORYDETAILS.NOPANRATEOFTAX, CATEGORYDETAILS.NOPANOTHERRATE, CATEGORYDETAILS.EXEMPTIONLIMIT, CATEGORYDETAILS.SINGLEBILLVALUE"
	for _, x := range []string{natureChunkRequest("SAMPLE CO", 0, 5000), natureChunkRequest("SAMPLE CO", 5000, 0)} {
		if group(`<FETCH>([^<]*)</FETCH>`, x, 1) != want || !strings.Contains(x, "<TYPE>TDSRate</TYPE>") || !strings.Contains(x, "$MasterID &gt; ") {
			t.Fatalf("the natures request: %s", x)
		}
		if err := checkAllowed(x); err != nil {
			t.Fatalf("refused: %v", err)
		}
		if strings.Contains(x, "SVFROMDATE") || strings.Contains(strings.ReplaceAll(x, "$$SysName:XML", ""), "$$") {
			t.Fatalf("a period or a Tally function: %s", x)
		}
	}
	// another type or more fields under the natures' id: refused before anything is sent
	bad := strings.Replace(natureChunkRequest("SAMPLE CO", 0, 5000), "<TYPE>TDSRate</TYPE>", "<TYPE>Ledger</TYPE>", 1)
	if checkAllowed(bad) == nil {
		t.Fatal("a Ledger collection under the natures' id was allowed")
	}
	if checkAllowed(strings.Replace(natureChunkRequest("SAMPLE CO", 0, 5000), "SINGLEBILLVALUE", "SINGLEBILLVALUE, CLOSINGBALANCE", 1)) == nil {
		t.Fatal("more fields under the natures' id were allowed")
	}
}

// Tally's own ledgers (real 7.1): the duty ledgers' nature, the special rate and the certificate of the party with one;
// the other parties none
func TestTDS243LedgerRowsReal(t *testing.T) {
	raw := gz242(t, filepath.Join("testdata", "tdsfields243", "7.1", "masters-tds-ledgers.xml.gz"))
	rows, _ := ledRowsOf(raw)
	by := map[string]ledRow{}
	for _, r := range rows {
		by[r.name] = r
	}
	if len(by) != 10 {
		t.Fatalf("%d ledgers: %v", len(by), by)
	}
	if by["FC TDS 194C Keys"].nature != "FC Contract 194C" || by["FC TDS 194J XML"].nature != "FC Prof Fees 194J" {
		t.Fatalf("the duty ledgers' nature: %+v %+v", by["FC TDS 194C Keys"], by["FC TDS 194J XML"])
	}
	l := by["FC LDC Party"]
	if l.special != "1" || l.ldc != `[["FC Prof Fees 194J","20260401","20270331","197","LDC197CERT0001","0","500000.00"]]` || l.nature != "FC Prof Fees 194J" || l.dtype != "Company - Resident" || l.pan != "AAACL0005E" {
		t.Fatalf("the party with a certificate: %+v", l)
	}
	for _, n := range []string{"FC Party Company", "FC Party Individual", "FC Party HUF", "FC Party Firm"} {
		if r := by[n]; r.special != "" || r.ldc != "" || r.nature != "" || r.dtype == "" {
			t.Fatalf("%s: %+v", n, r)
		}
	}
	if by["FC Contract Exp"].nature != "FC Contract 194C" || by["HDFC Bank"].nature != "" {
		t.Fatalf("the expense and the bank: %+v %+v", by["FC Contract Exp"], by["HDFC Bank"])
	}
	// the ledger list as bridge 2.4.3 sends these ledgers and the natures (tests/run_e2e_tdsgst.py's 2.4.3 case reads it)
	led := []any{}
	for _, n := range []string{"FC TDS 194C Keys", "FC TDS 194J XML", "FC Party Company", "FC Party Individual", "FC Party HUF", "FC Party Firm", "FC LDC Party", "FC Contract Exp", "FC Prof Exp", "HDFC Bank"} {
		r := by[n]
		led = append(led, append([]any{r.guid, r.mid, r.alter, r.name, r.parent, r.open, r.gstin, r.pan, 0, r.state, r.dtype}, ledTDSCols(r.nature, r.special, r.ldc)...))
	}
	nat, _ := natRowsOf(gz242(t, filepath.Join("testdata", "tdsfields243", "7.1", "natures.xml.gz")))
	golden := filepath.Join("testdata", "tdsfields243", "7.1", "ledger-list-243.json")
	if g := jsonText(M{"ledgers": led, "natures": nat}); os.Getenv("TDS243_GOLDEN") != "" {
		if err := os.WriteFile(golden, []byte(g), 0o644); err != nil {
			t.Fatal(err)
		}
	} else if readText(golden) != g {
		t.Errorf("%s: not what the bridge sends now (TDS243_GOLDEN=1 rewrites it)", golden)
	}
	// as the ledger_list / ledger_changes columns
	c := ledTDSCols(l.nature, l.special, l.ldc)
	if len(c) != 3 || str(c[0]) != "FC Prof Fees 194J" || str(c[1]) != "1" || len(arr(c[2])) != 1 || str(at(arr(at(arr(c[2]), 0)), 4)) != "LDC197CERT0001" {
		t.Fatalf("the columns: %v", c)
	}
	if c := ledTDSCols("", "", ""); len(c) != 3 || c[0] != "" || c[1] != "" || len(arr(c[2])) != 0 {
		t.Fatalf("no TDS settings: %v", c)
	}
}

// Tally's natures (real 7.1): each one's section, rates and threshold by the date it applies from
func TestTDS243NaturesReal(t *testing.T) {
	rows, _ := natRowsOf(gz242(t, filepath.Join("testdata", "tdsfields243", "7.1", "natures.xml.gz")))
	if len(rows) != 2 {
		t.Fatalf("%d natures: %v", len(rows), rows)
	}
	want := map[string]string{
		"FC Contract 194C":  `[["20260401","194C","1","2","20","20","30000.00",""]]`,
		"FC Prof Fees 194J": `[["20260401","194J","10","10","20","20","30000.00",""]]`,
	}
	for _, x := range rows {
		a := arr(x)
		if str(at(a, 0)) == "" || want[str(at(a, 3))] != jsonText(at(a, 4)) {
			t.Errorf("%v: want %s", a, want[str(at(a, 3))])
		}
	}
}

// the round: the natures are read once (in chunks of MasterIDs up to the company's highest master number, then the open
// end), after the groups and before the ledgers; they go with the first ledger_list batch; the rows carry the three
// columns; a list held by 2.4.2 sends only the ledgers with a TDS setting once
func TestTDS243RoundSendsMastersAndNatures(t *testing.T) {
	f := newStandTally(t)
	c := newStandCloud(t)
	for i := 1; i <= 4; i++ {
		f.addLed(fmt.Sprintf("Party %02d", i), "Sundry Creditors", "0.00")
	}
	f.mu.Lock()
	f.led[0].nature = "FC Contract 194C"
	f.led[1].special = "1"
	f.led[1].ldcXML = `<LOWERDEDUCTION.LIST><NATUREOFPAYMENT>FC Prof Fees 194J</NATUREOFPAYMENT><LOWERDEDUCTIONDETAILS.LIST><FROMDATE>20260401</FROMDATE><TODATE>20270331</TODATE><SECTIONNO>197</SECTIONNO><CERTIFICATENO>LDC1</CERTIFICATENO><TDSITRATE>1</TDSITRATE><TDSSCRATE>0</TDSSCRATE><LOWERDEDUCTIONLIMIT>500000.00</LOWERDEDUCTIONLIMIT></LOWERDEDUCTIONDETAILS.LIST></LOWERDEDUCTION.LIST>`
	f.mid++
	f.nat = append(f.nat, &tNat{guid: "nat-1", name: "FC Contract 194C", mid: f.mid, alter: 9,
		cats: `<CATEGORYDETAILS.LIST><APPLICABLEFROM>20260401</APPLICABLEFROM><TDSRATECHALLANCODE>94C</TDSRATECHALLANCODE><TDSRATESECTION>194C</TDSRATESECTION><RATEOFTAX> 1</RATEOFTAX><OTHERRATE> 2</OTHERRATE><NOPANRATEOFTAX> 20</NOPANRATEOFTAX><NOPANOTHERRATE> 20</NOPANOTHERRATE><EXEMPTIONLIMIT>30000.00</EXEMPTIONLIMIT><SINGLEBILLVALUE/></CATEGORYDETAILS.LIST>`})
	f.mu.Unlock()
	standBridge(t, f, `,"KeepBudgetSec":600`+c.cfg())
	liveFrom(today())
	runNow(t, "now")
	ids := f.ids()
	gi, ni, li := -1, -1, -1
	for i, id := range ids {
		switch {
		case id == grpListID && gi < 0:
			gi = i
		case id == natListID && ni < 0:
			ni = i
		case id == ledListID && li < 0:
			li = i
		}
	}
	if !(gi >= 0 && gi < ni && ni < li) || f.n(natListID) < 1 || f.n(natListID) > 3 {
		t.Fatalf("the order of the round's requests: %v", ids)
	}
	cloudMu.Lock()
	cloudLinksAt = time.Time{}
	cloudMu.Unlock()
	invokeCloudPush()
	c.mu.Lock()
	if len(c.ledList) != 1 {
		c.mu.Unlock()
		t.Fatalf("%d ledger_list calls", len(c.ledList))
	}
	body := c.ledList[0]
	c.mu.Unlock()
	nat := arr(body["natures"])
	if len(nat) != 1 || str(at(arr(nat[0]), 3)) != "FC Contract 194C" || jsonText(at(arr(nat[0]), 4)) != `[["20260401","194C","1","2","20","20","30000.00",""]]` {
		t.Fatalf("the natures sent: %v", body["natures"])
	}
	byGUID := map[string][]any{}
	for _, x := range arr(body["ledgers"]) {
		a := arr(x)
		byGUID[str(at(a, 0))] = a
	}
	if a := byGUID[f.led[0].guid]; len(a) != 18 || str(a[11]) != "FC Contract 194C" || str(a[12]) != "" || len(arr(a[13])) != 0 {
		t.Fatalf("the duty ledger's row: %v", a)
	}
	if a := byGUID[f.led[1].guid]; len(a) != 18 || str(a[11]) != "" || str(a[12]) != "1" || jsonText(a[13]) != `[["FC Prof Fees 194J","20260401","20270331","197","LDC1","1","500000.00"]]` {
		t.Fatalf("the party's row: %v", a)
	}
	// a list held by 2.4.2 (no TDS settings): only the two ledgers with one read as changed
	held := loadLedList(syncFolder(zz))
	old := map[string]ledRow{}
	for g, r := range held {
		r.nature, r.special, r.ldc = "", "", ""
		old[g] = r
	}
	if d := diffLedgers(old, held); len(d.rows) != 2 || d.added != 0 {
		t.Fatalf("the diff from a 2.4.2 list: %+v", d)
	}
	if r := ledFromArr("g", []any{1, 2, "n", "p", "0.00", "", "", "Delhi", "Company - Resident"}); r.nature != "" || r.ldc != "" || r.dtype != "Company - Resident" {
		t.Fatalf("a 2.4.2 row: %+v", r)
	}
}

// a row a 2.4.2 round left in the outbox (no TDS settings read) goes without the three columns: FinCom leaves its own
func TestTDS243OutboxRowFrom242(t *testing.T) {
	f := newStandTally(t)
	c := newStandCloud(t)
	standBridge(t, f, c.cfg())
	dir := syncFolder(zz)
	o := M{"rows": M{"g1": []any{1, 2, "Old Party", "Sundry Creditors", "0.00", "", "", 0, "", ""}, "g2": []any{3, 4, "New Party", "Sundry Creditors", "0.00", "", "", 0, "", "", "N1", "", ""}},
		"renamed": M{}, "round": "r1", "rowsRead": 2, "seen": []any{"g1", "g2"}, "complete": true}
	if err := saveFile(ledOutFile(dir), jsonText(o)); err != nil {
		t.Fatal(err)
	}
	cloudMu.Lock()
	cloudLinks[zz] = true
	err := pushLedgerList(zz, dir)
	cloudMu.Unlock()
	if err != nil {
		t.Fatal(err)
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if len(c.ledList) != 1 {
		t.Fatalf("%d calls", len(c.ledList))
	}
	for _, x := range arr(c.ledList[0]["ledgers"]) {
		a := arr(x)
		if (str(a[0]) == "g1" && len(a) != 11) || (str(a[0]) == "g2" && (len(a) != 18 || str(a[11]) != "N1")) {
			t.Fatalf("row %v", a)
		}
	}
	if _, has := c.ledList[0]["natures"]; has {
		t.Fatal("natures sent from an outbox without them")
	}
}

// a natures answer that cannot be read never holds the ledger list: the round reads the ledgers and sends no natures
// (those sent before stay in FinCom); a natures request Tally drops counts, and after two such rounds the natures are
// not asked again until the bridge's version changes
func TestTDS243NaturesNeverHoldLedgers(t *testing.T) {
	f := newStandTally(t)
	c := newStandCloud(t)
	f.addLed("Party 01", "Sundry Creditors", "0.00")
	mode := "garbled"
	f.behave = func(w http.ResponseWriter, r *http.Request, id, body string) bool {
		if id != natListID {
			return false
		}
		if mode == "garbled" {
			_, _ = w.Write([]byte("not an answer"))
			return true
		}
		if hj, ok := w.(http.Hijacker); ok {
			if conn, _, err := hj.Hijack(); err == nil {
				_ = conn.Close()
			}
		}
		return true
	}
	standBridge(t, f, `,"KeepBudgetSec":600`+c.cfg())
	liveFrom(today())
	runNow(t, "now")
	st := readKeepState(syncFolder(zz))
	if str(st["ledRun"]) == "" || len(loadLedList(syncFolder(zz))) != 1 || toInt(st["natMiss"]) != 0 {
		t.Fatalf("the ledger list was not read past an answer that could not be read: %v %v", st["led"], st["natMiss"])
	}
	if !strings.Contains(readText(logFile()), "the natures of payment were not read") {
		t.Fatal("not said in the log")
	}
	cloudMu.Lock()
	cloudLinksAt = time.Time{}
	cloudMu.Unlock()
	invokeCloudPush()
	c.mu.Lock()
	if len(c.ledList) != 1 || c.ledList[0]["natures"] != nil {
		c.mu.Unlock()
		t.Fatalf("natures sent from a round that did not read them: %v", c.ledList)
	}
	c.mu.Unlock()
	// Tally drops the natures request twice: counted, then not asked again for this version (natureList itself: the
	// round's other requests after a dropped one wait for Tally as any request does)
	mode = "closed"
	st2 := M{}
	for i := 1; i <= 2; i++ {
		probeMu.Lock()
		delete(probes, f.port) // Tally answered its small check: requests go again
		probeMu.Unlock()
		ls := M{"bound": int64(10)}
		n0 := f.n(natListID)
		ok, err := newRun("now", fmt.Sprintf("n%d", i)).natureList(zz, f.port, st2, ls, func() bool { return true }, func() {})
		if !ok || err != nil || f.n(natListID) != n0+1 || !truthy(ls["natSkip"]) || natOfRound(ls) != nil {
			t.Fatalf("drop %d: %v %v asked %d, %v", i, ok, err, f.n(natListID)-n0, ls)
		}
	}
	if str(st2["natOffVer"]) != BridgeVersion {
		t.Fatalf("not switched off after two: %v", st2)
	}
	// Tally still busy with the dropped request: the natures wait with the round (not given up, not counted)
	ls0 := M{}
	if ok, err := newRun("now", "n2b").natureList(zz, f.port, M{}, ls0, func() bool { return true }, func() {}); ok || err == nil || truthy(ls0["natDone"]) {
		t.Fatalf("a busy Tally: %v %v %v", ok, err, ls0)
	}
	probeMu.Lock()
	delete(probes, f.port)
	probeMu.Unlock()
	n0 := f.n(natListID)
	ls := M{}
	if ok, err := newRun("now", "n3").natureList(zz, f.port, st2, ls, func() bool { return true }, func() {}); !ok || err != nil || f.n(natListID) != n0 || !truthy(ls["natSkip"]) {
		t.Fatal("the natures were asked again in the same version")
	}
}

// Tally's real answers to the 2.4.3 requests exactly as built, on TallyPrime 3.0, 4.1, 5.1, 6.2 and 7.1 (tally-versions mode
// tdsm, run 38161708408; testdata/tdsfields243/tdsm-<release>/): the ledger list and the ledger by name carry the duty
// ledger's nature, the special rate and every field of the certificate; the natures request, chunked, carries each nature's
// section, rates and threshold
func TestTDS243FiveReleases(t *testing.T) {
	for _, rel := range []string{"3.0", "4.1", "5.1", "6.2", "7.1"} {
		d := filepath.Join("testdata", "tdsfields243", "tdsm-"+rel)
		for _, f := range []string{"ledlist-243.xml.gz", "ledbyname-ldc.xml.gz"} {
			rows, _ := ledRowsOf(gz242(t, filepath.Join(d, f)))
			by := map[string]ledRow{}
			for _, r := range rows {
				by[r.name] = r
			}
			l := by["FM LDC Party"]
			if l.ldc != `[["FM Prof Fees 194J","20260401","20270331","197","LDC197CERT0001","1","500000.00"]]` {
				t.Errorf("%s %s: the certificate %q", rel, f, l.ldc)
			}
			if f == "ledlist-243.xml.gz" && (by["FM TDS 194J"].nature != "FM Prof Fees 194J" || by["FM Special Party"].special != "1") {
				t.Errorf("%s: nature %q, special %q", rel, by["FM TDS 194J"].nature, by["FM Special Party"].special)
			}
		}
		nat, _ := natRowsOf(gz242(t, filepath.Join(d, "natures-243.xml.gz")))
		want := map[string]string{"FM Contract 194C": `[["20260401","194C","1","2","20","20","30000.00",""]]`, "FM Prof Fees 194J": `[["20260401","194J","10","10","20","20","50000.00",""]]`}
		if len(nat) != 2 {
			t.Errorf("%s: %d natures", rel, len(nat))
		}
		for _, x := range nat {
			a := arr(x)
			if want[str(at(a, 3))] != jsonText(at(a, 4)) {
				t.Errorf("%s: %v", rel, a)
			}
		}
	}
}
