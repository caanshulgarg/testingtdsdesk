package main

// Bridge 2.5.0 (the owner's decision of 30-Oct-2026, "Ok" to this exact proposal): inside the STATICVARIABLES of the three
// ledger requests (FinComLedgers, FinComLedgerChanges, FinComLedgerByName)
//
//	<SVFROMDATE TYPE="Date">{books-from yyyymmdd}</SVFROMDATE><SVTODATE TYPE="Date">{books-from + 1 year - 1 day}</SVTODATE>
//
// and BOOKSFROM in the company list (TDSDeskCompanies); nothing else in any request changes. Proven on real TallyPrime
// (tally-versions mode openp, runs 41002898108 (7.1) and 41004704755 (3.0)): undated, OPENINGBALANCE is as at the start
// of the Gateway's CURRENT period. Written before the code:
//   1. the requests carry the period from BOOKSFROM, byte for byte the 2.4.9 request with the period added, nothing else;
//   2. a company whose books-from is unknown: the ledger read is held (never sent undated), one plain log line, and the
//      company list read again; once Tally says it, the read goes, dated;
//   3. the ReadDays exemption is for exactly these three, exactly as built with their company's own books' first year;
//      every other request carrying a period keeps the rule it had (ReadDays off: refused);
//   4. TestNoComputedFigure's "opening balance with a period" allows only these three, only with the books' first year;
//   5. the cloud is told the openings' date (openingsAt) with every ledger batch; the first dated round after an
//      undated one (an upgrade from 2.4.9) sends every ledger, and a round begun undated by 2.4.9 starts again.

import (
	"path/filepath"
	"regexp"
	"strings"
	"testing"
	"time"
)

const r250Period = `<SVFROMDATE TYPE="Date">20250401</SVFROMDATE><SVTODATE TYPE="Date">20260331</SVTODATE>`

// the bridge with a stand Tally whose company says its books begin on books (the stand's own default: "")
func r250Bridge(t *testing.T, books string) (*standTally, *standCloud) {
	t.Helper()
	_, f, c := liveBridge(t, `,"KeepBudgetSec":600`)
	f.mu.Lock()
	f.booksFrom = books
	f.mu.Unlock()
	for _, l := range [][3]string{{"Cash", "Cash-in-Hand", "-1000.00"}, {"Customer A", "Sundry Debtors", "1000.00"}, {"Supplier B", "Sundry Creditors", "0.00"}} {
		f.addLed(l[0], l[1], l[2])
	}
	liveFrom(today())
	return f, c
}

// --- 1. the period from BOOKSFROM, in the STATICVARIABLES, and nothing else changed
func TestR250LedgerRequestsCarryBooksPeriod(t *testing.T) {
	f, _ := r250Bridge(t, "20250401")
	// the company list asks for BOOKSFROM too, and nothing else changed
	if companiesRequest() != collectionRequest("TDSDeskCompanies", "Company", "NAME,STARTINGFROM,ENDINGAT,GUID,BOOKSFROM", "", "") {
		t.Fatalf("the company list: %s", companiesRequest())
	}
	if strings.Replace(companiesRequest(), ",BOOKSFROM", "", 1) != collectionRequest("TDSDeskCompanies", "Company", "NAME,STARTINGFROM,ENDINGAT,GUID", "", "") {
		t.Fatal("the company list changed otherwise than BOOKSFROM")
	}
	openCompaniesWith(fin, true)
	if booksFromOf(zz) != "20250401" {
		t.Fatalf("books-from not held: %q", booksFromOf(zz))
	}
	// each of the three: exactly 2.4.9's request with the period inside STATICVARIABLES, after the company
	was := map[string]string{
		ledListID:    fcCollection(ledListID, zz, "", "Ledger", ledFetch, masterRange(0, 2000)),
		ledChangesID: fcCollection(ledChangesID, zz, "", "Ledger", ledFetch, alterRange(5, 205)),
		ledByNameID:  fcCollection(ledByNameID, zz, "", "Ledger", ledFetch, `$Name = "New Party & Co"`),
	}
	now := map[string]string{ledListID: ledgerChunkRequest(zz, 0, 2000), ledChangesID: ledgerChangesRequest(zz, 5, 205), ledByNameID: ledgerByNameRequest(zz, "New Party & Co")}
	for id, x := range now {
		if !strings.Contains(x, "<SVCURRENTCOMPANY>"+zz+"</SVCURRENTCOMPANY>"+r250Period+"</STATICVARIABLES>") {
			t.Fatalf("%s: the period is not inside STATICVARIABLES: %s", id, x)
		}
		if strings.Replace(x, r250Period, "", 1) != was[id] || strings.Count(x, "SVFROMDATE") != 2 || strings.Count(x, "SVTODATE") != 2 {
			t.Fatalf("%s changed otherwise than the period:\n%s\n%s", id, x, was[id])
		}
		if err := checkAllowed(x); err != nil {
			t.Fatalf("%s: %v", id, err)
		}
		if err := datedRefused(fin, x); err != nil {
			t.Fatalf("%s refused with ReadDays off: %v", id, err)
		}
	}
	// a year on less a day, whatever the month the books begin
	for from, to := range map[string]string{"20250401": "20260331", "20251001": "20260930", "20240101": "20241231", "20230701": "20240630"} {
		if booksYearEnd(from) != to {
			t.Fatalf("%s: %s", from, booksYearEnd(from))
		}
	}
	if ledgerPeriodVars("") != "" || ledgerPeriodVars("2025-04-01") != "" || ledgerChunkRequestAt(zz, "", 0, 10) != "" {
		t.Fatal("a period built from no date")
	}
	// driven: the ledgers-only read sends only dated ledger requests, refused none; the cloud is told the openings' date
	if err := newRun("ledgers", "r250-1").step(zz, f.port, ""); err != nil {
		t.Fatal(err)
	}
	if f.n(ledListID) == 0 || logLines("refused: The request") != 0 {
		t.Fatalf("the read: %v; refused %d", f.ids(), logLines("refused: The request"))
	}
	for _, b := range f.bodiesOf(ledListID) {
		if !strings.Contains(b, r250Period) {
			t.Fatalf("an undated ledger request went: %s", b)
		}
	}
}

// --- 2. books-from unknown: held, one plain log line, the company list read again; never undated
func TestR250BooksFromUnknownHeld(t *testing.T) {
	f, _ := r250Bridge(t, "-")
	const said = "not read: Tally has not said when its books begin; the company list is read again and the ledgers wait until it does"
	for i := 0; i < 3; i++ {
		// a minute on since the last re-read (the once-a-minute clock of the re-read only; the bridge's other clocks as they are)
		booksFromMu.Lock()
		for k, v := range booksFromAsk {
			booksFromAsk[k] = v.Add(-2 * time.Minute)
		}
		booksFromMu.Unlock()
		c0 := f.n("TDSDeskCompanies")
		k := newRun("ledgers", "r250-h"+string(rune('a'+i)))
		if err := k.step(zz, f.port, ""); err != nil {
			t.Fatal(err)
		}
		if f.n("TDSDeskCompanies") <= c0 || !k.booksHeld[zz] {
			t.Fatalf("round %d: the company list was not read again (or the company not marked held)", i)
		}
		// within the minute: held again, the company list not read again (review: not on every held chunk or ledger)
		c1 := f.n("TDSDeskCompanies")
		if _, _, err := readLedgerChunk(fin, zz, f.port, 0, 2000); err == nil || f.n("TDSDeskCompanies") != c1 {
			t.Fatalf("round %d: a held chunk read the company list again within the minute: %v", i, err)
		}
	}
	if f.n(ledListID)+f.n(ledChangesID)+f.n(ledByNameID) != 0 {
		t.Fatalf("a ledger request went with books-from unknown: %v", f.ids())
	}
	if n := logLines("Ledgers of " + zz + " " + said); n != 1 {
		t.Fatalf("the held read said %d times in the log", n)
	}
	if ledgerChunkRequest(zz, 0, 2000) != "" || ledgerChangesRequest(zz, 0, 200) != "" || ledgerByNameRequest(zz, "Cash") != "" {
		t.Fatal("a ledger request is built with books-from unknown")
	}
	if _, _, err := readLedgerChunk(fin, zz, f.port, 0, 2000); err == nil || f.n(ledListID) != 0 {
		t.Fatalf("a chunk read with books-from unknown: %v", err)
	}
	if _, err := fetchLedgerByMaster(fin, zz, f.port, 1); err == nil || f.n(ledListID) != 0 {
		t.Fatalf("one ledger fetched with books-from unknown: %v", err)
	}
	// an undated ledger request is refused at the gate, whoever asks and whatever ReadDays says
	und := fcCollection(ledListID, zz, "", "Ledger", ledFetch, masterRange(0, 2000))
	oldDaysOn()
	if _, err := invokeTally(&TC{person: true}, f.port, und, 5); err == nil || f.n(ledListID) != 0 {
		t.Fatalf("an undated ledger request went: %v", err)
	}
	// Tally says it: the next round reads, dated
	f.mu.Lock()
	f.booksFrom = "20250401"
	f.mu.Unlock()
	booksFromMu.Lock()
	booksFromAsk = map[string]time.Time{}
	booksFromMu.Unlock()
	if err := newRun("ledgers", "r250-hz").step(zz, f.port, ""); err != nil {
		t.Fatal(err)
	}
	if f.n(ledListID) == 0 {
		t.Fatalf("not read once books-from is known: %v", f.ids())
	}
	for _, b := range f.bodiesOf(ledListID) {
		if !strings.Contains(b, r250Period) {
			t.Fatalf("undated: %s", b)
		}
	}
}

// the request x with the books' first year put inside its STATICVARIABLES (as the three carry it)
func r250WithPeriod(x string) string {
	if strings.Contains(x, "<SVFROMDATE") {
		return x
	}
	return strings.Replace(x, "</STATICVARIABLES>", r250Period+"</STATICVARIABLES>", 1)
}

// --- 3. the ReadDays exemption: exactly the three, exactly as built with their company's own books' first year
func TestR250ReadDaysExemptionOnlyThree(t *testing.T) {
	f, _ := r250Bridge(t, "20250401")
	_ = f
	openCompaniesWith(fin, true)
	if readDaysOn() {
		t.Fatal("ReadDays is on")
	}
	var classed []string
	for id, c := range requestClass {
		if c == "ledgerPeriod" {
			classed = append(classed, id)
		}
	}
	if len(classed) != 3 || !ledgerPeriodIDs[classed[0]] || !ledgerPeriodIDs[classed[1]] || !ledgerPeriodIDs[classed[2]] || len(ledgerPeriodIDs) != 3 {
		t.Fatalf("the exemption's ids: %v", classed)
	}
	for id, x := range map[string]string{ledListID: ledgerChunkRequest(zz, 0, 2000), ledChangesID: ledgerChangesRequest(zz, 5, 205), ledByNameID: ledgerByNameRequest(zz, "Cash")} {
		if err := datedRefused(fin, x); err != nil {
			t.Fatalf("%s as built: %v", id, err)
		}
		bad := map[string]string{
			"the Gateway's year":      strings.Replace(strings.Replace(x, ">20250401<", ">20260401<", 1), ">20260331<", ">20270331<", 1),
			"a month":                 strings.Replace(x, ">20260331<", ">20250430<", 1),
			"no TYPE":                 strings.Replace(x, r250Period, "<SVFROMDATE>20250401</SVFROMDATE><SVTODATE>20260331</SVTODATE>", 1),
			"undated":                 strings.Replace(x, r250Period, "", 1),
			"the period twice":        strings.Replace(x, r250Period, r250Period+r250Period, 1),
			"another company":         strings.Replace(x, "<SVCURRENTCOMPANY>"+zz+"<", "<SVCURRENTCOMPANY>OTHER CO<", 1),
			"a date filter as well":   strings.Replace(x, "</SYSTEM>", " AND $Date &gt; $$Date:&#34;1-Apr-2025&#34;</SYSTEM>", 1),
			"a field more":            strings.Replace(x, "LEDSTATENAME", "LEDSTATENAME, CLOSINGBALANCE", 1),
			"the period in the TDL":   strings.Replace(strings.Replace(x, r250Period, "", 1), "<TDLMESSAGE>", "<TDLMESSAGE>"+r250Period, 1),
			"the books-from a day on": strings.Replace(strings.Replace(x, ">20250401<", ">20250402<", 1), ">20260331<", ">20260401<", 1),
		}
		for why, y := range bad {
			if y == x {
				t.Fatalf("%s %s: the change was not made", id, why)
			}
			if datedRefused(fin, y) == nil {
				t.Errorf("%s %s: passes the ReadDays rule", id, why)
			}
			if datedRefused(&TC{person: true}, y) == nil && why != "a field more" {
				t.Errorf("%s %s: passes for a person", id, why)
			}
		}
	}
	// review of 2.5.0: with ReadDays ON too, a ledger request without exactly the books' first year is refused
	setCfg("ReadDays", true)
	defer setCfg("ReadDays", false)
	for _, y := range []string{fcCollection(ledListID, zz, "", "Ledger", ledFetch, masterRange(0, 2000)), ledgerChunkRequestAt(zz, "20260401", 0, 2000)} {
		if err := datedRefused(fin, y); err != errLedgerPeriodRefused {
			t.Fatalf("with ReadDays on, a ledger request with another period or none: %v", err)
		}
	}
	setCfg("ReadDays", false)
	// every other request carrying the same period keeps the rule it had: refused with ReadDays off
	keep := map[string]bool{vchObjectID: true, sliceID: true, vchByNumberID: true, dayHeadsID: true, vchBatchID: true, "TDSDeskKeepList": true, "Import": true}
	for id, x := range allowListSamples() {
		if ledgerPeriodIDs[id] || keep[id] || x == "" {
			continue
		}
		if err := datedRefused(fin, r250WithPeriod(x)); err == nil {
			t.Errorf("%s with the books' first year passes with ReadDays off", id)
		}
	}
	// the undated ids stay undated: the employees, the natures, the groups, the ledger count
	for _, id := range []string{empListID, natListID, grpListID, ledIdsID, "TDSDeskLedgers", "TDSDeskNames"} {
		if requestClass[id] != "undated" {
			t.Errorf("%s is %q", id, requestClass[id])
		}
	}
}

// --- 4. no computed figure: an opening with a period only for these three, only the books' first year
func TestR250ComputedFigureOnlyThree(t *testing.T) {
	noteBooksFrom(zz, "20250401")
	for _, x := range []string{ledgerChunkRequestAt(zz, "20250401", 0, 2000), ledgerChangesRequestAt(zz, "20250401", 0, 200), ledgerByNameRequestAt(zz, "20250401", "Cash")} {
		if m := computedFigure(x); m != "" {
			t.Fatalf("%s: %q", tallyRequestID(x), m)
		}
		if m := computedFigure(strings.Replace(x, ">20260331<", ">20250430<", 1)); m == "" {
			t.Fatalf("%s with another period is not caught", tallyRequestID(x))
		}
		if m := computedFigure(strings.Replace(x, "OPENINGBALANCE", "OPENINGBALANCE, CLOSINGBALANCE", 1)); m == "" {
			t.Fatalf("%s asking a closing balance is not caught", tallyRequestID(x))
		}
	}
	for _, x := range []string{r250WithPeriod(measureReqLedO(zz, "Ledger 01")), r250WithPeriod(strings.Replace(groupListRequest(zz), "PARENT</FETCH>", "PARENT, OPENINGBALANCE</FETCH>", 1)),
		r250WithPeriod(strings.Replace(ledgersFullRequest(zz, 0, 2000), "<FETCH>", "<FETCH>OPENINGBALANCE, ", 1))} {
		if !strings.Contains(x, "OPENINGBALANCE") || computedFigure(x) == "" {
			t.Fatalf("an opening with a period in %s is not caught", tallyRequestID(x))
		}
	}
}

// --- 5. the openings' date goes with every batch; the first dated round after an undated one sends every ledger
func TestR250OpeningsAtAndFirstDatedRoundSendsAll(t *testing.T) {
	f, c := r250Bridge(t, "20250401")
	dir := syncFolder(zz)
	// as 2.4.9 left it: the list held from an undated round, and a round half read (no openingsAt)
	if err := newRun("ledgers", "r250-o1").step(zz, f.port, ""); err != nil {
		t.Fatal(err)
	}
	if err := pushLedgerList(zz, dir); err != nil {
		t.Fatal(err)
	}
	if len(c.ledList) == 0 || str(c.ledList[0]["openingsAt"]) != "20250401" || len(arr(c.ledList[0]["ledgers"])) != 3 {
		t.Fatalf("the first round: %v", c.ledList)
	}
	// nothing changed: the next dated round sends no row
	n0 := len(c.ledList)
	if err := newRun("ledgers", "r250-o2").step(zz, f.port, ""); err != nil {
		t.Fatal(err)
	}
	_ = pushLedgerList(zz, dir)
	if len(c.ledList) == n0 {
		t.Fatal("no batch for the second round")
	}
	for _, b := range c.ledList[n0:] {
		if len(arr(b["ledgers"])) != 0 || str(b["openingsAt"]) != "20250401" {
			t.Fatalf("the unchanged round: %v", b)
		}
	}
	// an upgrade from 2.4.9: its state names no openings' date, and a round it began holds an undated half
	st := readKeepState(dir)
	delete(st, "ledOpeningsAt")
	st["led"] = M{"started": nowS(), "after": 2, "size": 2000, "empty": 0, "groups": true, "n": 2, "reqs": 1, "round": "half-undated"}
	saveKeepState(dir, st)
	n1, l1 := len(c.ledList), f.n(ledListID)
	if err := newRun("ledgers", "r250-o3").step(zz, f.port, ""); err != nil {
		t.Fatal(err)
	}
	_ = pushLedgerList(zz, dir)
	if len(c.ledList) == n1 {
		t.Fatal("no batch for the upgraded round")
	}
	b := c.ledList[n1]
	if str(b["round"]) == "half-undated" || str(b["openingsAt"]) != "20250401" || len(arr(b["ledgers"])) != 3 {
		t.Fatalf("the first dated round after 2.4.9: %v", b)
	}
	for _, x := range f.bodiesOf(ledListID)[l1:] {
		if !strings.Contains(x, "$MasterID &gt; 0") && !strings.Contains(x, r250Period) {
			t.Fatalf("the upgraded round did not start again from the first ledger: %s", x)
		}
	}
	if !strings.Contains(f.bodiesOf(ledListID)[l1], "$MasterID &gt; 0") {
		t.Fatalf("the upgraded round resumed 2.4.9's half: %s", f.bodiesOf(ledListID)[l1])
	}
	if str(readKeepState(dir)["ledOpeningsAt"]) != "20250401" {
		t.Fatal("the openings' date is not kept")
	}
}

// the four rows 2.5.0 changes, as 2.4.9's table had them (docs/tally-allowlist.md at 2.4.9): the table before 2.5.0 is
// the table now with these in place (the earlier releases' tests hash it)
var allowRows249 = map[string]string{
	"FinComLedgerByName":  "| FinComLedgerByName | one ledger an entry uses that FinCom does not have, by its name (2.3.1), fetched before the entry is applied: the ledger list's stored master fields only | ddaf1adf0dab | 0.0 | 2026-10-12 (real TallyPrime 3.0, 4.1, 5.1, 6.2, 7.1; tally-versions mode paym, run 38263695475, at 20,000 ledgers and 2,000 employees: 38 ms worst (3.0)) | bridge |\n",
	"FinComLedgerChanges": "| FinComLedgerChanges | the ledgers created or altered since Tally's master counter last moved (2.3.1): AlterID above the last number, 200 AlterIDs a request at most, the ledger list's stored master fields only | d476d0e22c08 | 0.2 | 2026-10-12 (real TallyPrime 3.0, 4.1, 5.1, 6.2, 7.1; tally-versions mode paym, run 38263695475, at 20,000 ledgers and 2,000 employees: every window of 200 AlterIDs, 237 ms worst (3.0)) | bridge |\n",
	"FinComLedgers":       "| FinComLedgers | the ledger list, 2,000 MasterIDs a request at most, stored master fields only (2.3.1: the party's deductee type too; 2.4.3: a TDS ledger's nature of payment, a party's special rate and lower-deduction certificates; 2.4.4: a pay head's PAYTYPE, PAYSTATTYPE, ITCOMPONENT, FORPAYROLL) | 521a794f4c4f | 0.3 | 2026-10-12 (real TallyPrime 3.0, 4.1, 5.1, 6.2, 7.1; tally-versions mode paym, run 38263695475, at 20,000 ledgers and 2,000 employees: a chunk of 2,000 MasterIDs 278 ms worst (3.0), the same chunk with 2.4.3's fields 218 ms; 2.4.3's tdsm runs 38164963591 and 38187902681: 316 ms worst with 2.4.3's fields) | bridge |\n",
	"TDSDeskCompanies":    "| TDSDeskCompanies | the companies loaded in Tally (name, books' period, GUID) | a1fe973a9650 | not yet measured | - | bridge |\n",
}

func allowRowsBefore250() string {
	var o []string
	for _, l := range strings.SplitAfter(allowListRows(), "\n") {
		id := strings.TrimSpace(strings.SplitN(strings.TrimPrefix(l, "| "), " |", 2)[0])
		if w, ok := allowRows249[id]; ok && strings.HasPrefix(l, "| "+id+" |") {
			l = w
		}
		o = append(o, l)
	}
	return strings.Join(o, "")
}

// --- review of 2.5.0: books-from only from this user's own Tally; a round FinCom's cloud held goes whole again
func TestR250OwnTallyAndResendAfterHeld(t *testing.T) {
	f, c := r250Bridge(t, "20250401")
	// another Windows user's Tally naming the same company with other books: never this user's period
	coMu.Lock()
	was := coCache
	coCache = []M{{"port": 9999, "ok": true, "mine": false, "companies": []any{M{"name": zz, "booksFrom": "20240401"}}}}
	coMu.Unlock()
	if booksFromOf(zz) != "" {
		t.Fatalf("books-from taken from another user's Tally: %q", booksFromOf(zz))
	}
	coMu.Lock()
	coCache = was
	coMu.Unlock()
	dir := syncFolder(zz)
	next := func(id string) {
		t.Helper()
		st := readKeepState(dir)
		delete(st, "ledRun")
		saveKeepState(dir, st)
		if err := newRun("ledgers", id).step(zz, f.port, ""); err != nil {
			t.Fatal(err)
		}
	}
	// the first dated round goes whole (every ledger); held (Tally's own openings do not add up): not whole again
	next("r250-r1")
	c.mu.Lock()
	c.ledListOut = M{"openings": "held"}
	c.mu.Unlock()
	if err := pushLedgerList(zz, dir); err != nil || exists(ledResendFile(dir)) {
		t.Fatalf("a whole round held is marked to go whole again (%v)", err)
	}
	c.mu.Lock()
	c.ledListOut = nil
	c.mu.Unlock()
	// a plain round (one ledger changed) held: the next round sends every ledger
	led231Alter(f, "Cash", func(l *tLed) { l.open = "-1500.00" })
	next("r250-r1b")
	c.mu.Lock()
	c.ledListOut = M{"openings": "held"}
	c.mu.Unlock()
	if err := pushLedgerList(zz, dir); err != nil || !exists(ledResendFile(dir)) {
		t.Fatalf("FinCom held a plain round's openings: the next round is not marked to send every ledger (%v)", err)
	}
	c.mu.Lock()
	c.ledListOut = nil
	n0 := len(c.ledList)
	c.mu.Unlock()
	next("r250-r2")
	_ = pushLedgerList(zz, dir)
	if len(c.ledList) == n0 || len(arr(c.ledList[n0]["ledgers"])) != 3 || exists(ledResendFile(dir)) { // the three ledgers whole
		t.Fatalf("the round after a held one: %v", c.ledList[n0:])
	}
	// held again (Tally's own openings do not add up): that whole round is not sent whole a third time
	c.mu.Lock()
	c.ledListOut = M{"openings": "held"}
	c.mu.Unlock()
	f.addLed("Another", "Sundry Debtors", "5.00")
	next("r250-r2b")
	_ = pushLedgerList(zz, dir)
	c.mu.Lock()
	c.ledListOut = nil
	c.mu.Unlock()
	if !exists(ledResendFile(dir)) {
		t.Fatal("a held plain round is not marked to go whole again")
	}
	next("r250-r2c")
	c.mu.Lock()
	c.ledListOut = M{"openings": "held"}
	c.mu.Unlock()
	_ = pushLedgerList(zz, dir)
	c.mu.Lock()
	c.ledListOut = nil
	c.mu.Unlock()
	if exists(ledResendFile(dir)) {
		t.Fatal("a resend round held again marks yet another resend (it would never stop)")
	}
	// and the one after that sends only what changed (nothing)
	n1 := len(c.ledList)
	next("r250-r3")
	_ = pushLedgerList(zz, dir)
	if len(c.ledList) == n1 || len(arr(c.ledList[n1]["ledgers"])) != 0 {
		t.Fatalf("an unchanged round after the resend: %v", c.ledList[n1:])
	}
}

// 2.5.0: the version; four rows changed (the table otherwise 2.4.9's); the decision line names 2.5.0 by the owner's
// decision of 2026-10-30 with the three shapes, 2.4.9's kept as history; the dated line; the test sheet
func TestR250VersionAllowList(t *testing.T) {
	if BridgeVersion != "2.5.1" { // 2.5.1 (r251openings_test.go): kept as history
		t.Fatalf("BridgeVersion %s", BridgeVersion)
	}
	if h := allowListHash(allowRowsBefore250()); h != "8962b5cdd4868e09696bef97780b196198a2fb9d7f79293ace32d799b6dfa79b" {
		t.Fatalf("a row other than the four changed (%s)", h)
	}
	al := readText(filepath.Join("..", "docs", "tally-allowlist.md"))
	line := group(`(?m)^(First table: .*)$`, al, 1)
	for _, w := range []string{"as for 2.5.0: the owner's decision of 2026-10-30", "as for 2.4.9: the owner's decision of 2026-10-29",
		`<SVFROMDATE TYPE="Date">{books-from yyyymmdd}</SVFROMDATE><SVTODATE TYPE="Date">{books-from + 1 year - 1 day}</SVTODATE>`,
		"nothing else in any request changes", "runs 41002898108 (7.1) and 41004704755 (3.0)", "run 41016133667",
		"FinComLedgers " + shapeOf(allowListSamples()[ledListID]), "FinComLedgerChanges " + shapeOf(allowListSamples()[ledChangesID]),
		"FinComLedgerByName " + shapeOf(allowListSamples()[ledByNameID]), "TDSDeskCompanies " + shapeOf(allowListSamples()["TDSDeskCompanies"])} {
		if !strings.Contains(line, w) {
			t.Errorf("the decision line does not say %q", w)
		}
	}
	if strings.Contains(line, "allowed for 2.4.9 by") {
		t.Error("2.4.9's decision still worded as the current one")
	}
	if !regexp.MustCompile(`re-measured on 2026-10-30 for 2\.5\.0: [^\n]*2\.5\.0 allowed by the owner's decision of 2026-10-30`).MatchString(al) {
		t.Error("no dated line for 2.5.0")
	}
	sheet := readText(filepath.Join("..", "docs", "bridge-2.5.0-test-sheet.txt"))
	for _, w := range []string{"2.5.0", "books' first year", "2.5.0 over 2.4.9", "do not add up to nil"} {
		if !strings.Contains(sheet, w) {
			t.Errorf("the test sheet does not say %q", w)
		}
	}
}
