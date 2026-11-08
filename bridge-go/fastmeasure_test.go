package main

// next-fast-measure: "Measure the fast read (ZZ TEST only)" (fastmeasure.go) against the stand Tally and cloud: the tray
// only; refused unless ZZ TEST is the one company open, its starting point recorded and FastEntries off; the plan's
// requests only (the two window requests and FinComVoucherObject, with the company list); the stop rules; the upload
// carries no entry data.

import (
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"
)

func fmBridge(t *testing.T) (*standTally, *standCloud, *[]M) {
	t.Helper()
	f, c, _ := pullBridgeWith(t, "")
	fastReset()
	t.Cleanup(fastReset)
	t.Cleanup(func() {
		for fastMeasure.running.Load() {
			time.Sleep(20 * time.Millisecond)
		}
		fastMeasure.mu.Lock()
		fastMeasure.last = nil
		fastMeasure.mu.Unlock()
	})
	var ups []M
	c.mu.Lock()
	prev := c.other
	c.other = func(k string, b M) (int, M) {
		if k == "fast_measure" {
			ups = append(ups, b)
			return 200, M{"ok": true}
		}
		return prev(k, b)
	}
	c.mu.Unlock()
	return f, c, &ups
}

// ZZ TEST's entries: n a day on the days given (pullBridgeWith's clock: 21-Oct-2026)
func fmFill(f *standTally, per map[string]int) []*tVch {
	return fastDays(f, 7000, per)
}

func fmRun(t *testing.T) M {
	t.Helper()
	_, r := callLocal(t, "POST", "/tray/fastmeasure", "", `{}`)
	if r["ok"] != true {
		t.Fatalf("not started: %v", r)
	}
	var s M
	for i := 0; i < 1200; i++ {
		_, s = callLocal(t, "GET", "/tray/fastmeasure", "", "")
		if str(s["state"]) != "running" {
			break
		}
		time.Sleep(50 * time.Millisecond)
	}
	if str(s["state"]) == "running" {
		t.Fatal("still running")
	}
	return s
}

// 1. a person's only: a web page is refused, nothing reaches Tally
func TestFastMeasureTrayOnly(t *testing.T) {
	f, _, ups := fmBridge(t)
	n0 := f.n("")
	for _, origin := range []string{"https://app.fincom.live", "https://evil.example"} {
		for _, method := range []string{"POST", "GET"} {
			if code, _ := callLocal(t, method, "/tray/fastmeasure", origin, `{}`); code != 403 {
				t.Fatalf("%s from %s: %d (want 403)", method, origin, code)
			}
		}
	}
	if code, _ := callLocalHeaders(t, "POST", "/tray/fastmeasure", map[string]string{"Sec-Fetch-Site": "same-site"}, `{}`); code != 403 {
		t.Fatal("a Sec-Fetch header not refused")
	}
	if f.n("") != n0 || len(*ups) != 0 || fastMeasure.running.Load() {
		t.Fatal("a refused call started something")
	}
}

// 2. the refusals: another company's name (even one that differs only in case or spaces), FastEntries on, no starting
// point; nothing sent to Tally
func TestFastMeasureRefusals(t *testing.T) {
	f, _, _ := fmBridge(t)
	fmFill(f, map[string]int{"20261010": 3})
	n0 := f.n("")
	setCfg("FastEntries", true)
	_, r := callLocal(t, "POST", "/tray/fastmeasure", "", `{}`)
	if r["ok"] != false || !strings.Contains(str(r["error"]), "FastEntries") {
		t.Fatalf("FastEntries on: %v", r)
	}
	setCfg("FastEntries", false)
	// no starting point for ZZ TEST
	clearStartPoints(t)
	_, r = callLocal(t, "POST", "/tray/fastmeasure", "", `{}`)
	if r["ok"] != false || !strings.Contains(str(r["error"]), "starting point") {
		t.Fatalf("no starting point: %v", r)
	}
	if f.n("") != n0 {
		t.Fatalf("asked of Tally: %v", f.ids()[n0:])
	}
}

func clearStartPoints(t *testing.T) {
	t.Helper()
	old := fmStartPoint
	fmStartPoint = func(string) (int64, bool) { return 0, false }
	t.Cleanup(func() { fmStartPoint = old })
}

// 2b. a company not named exactly ZZ TEST open alone: refused (the name the stand Tally gives)
func TestFastMeasureOnlyZZTest(t *testing.T) {
	for _, name := range []string{"ZZ TEST2", "zz test", "ZZ  TEST", "Client Books"} {
		if guid, why := fastMeasureWhyNotOf([]string{name}); why == "" || guid != "" {
			t.Fatalf("%q allowed", name)
		}
	}
	if _, why := fastMeasureWhyNotOf([]string{"ZZ TEST", "Client Books"}); !strings.Contains(why, "alone") {
		t.Fatalf("two companies open: %q", why)
	}
	if _, why := fastMeasureWhyNotOf(nil); !strings.Contains(why, "No company") {
		t.Fatalf("none open: %q", why)
	}
}

// 3. the full plan on ZZ TEST: only its requests; pass; FinCom has the result; the table is unchanged afterwards; the
// window requests are refused again once it ended
func TestFastMeasurePlanPasses(t *testing.T) {
	f, _, ups := fmBridge(t)
	fmFill(f, map[string]int{"20261008": 20, "20261009": 30, "20261010": 120, "20260915": 5})
	before := allowListHash(allowListRows())
	n0 := len(f.ids())
	s := fmRun(t)
	if s["pass"] != true || s["sent"] != true || !strings.HasPrefix(str(s["line"]), "PASS: ") {
		t.Fatalf("the result: %v", s)
	}
	for _, id := range f.ids()[n0:] {
		switch id {
		case fastHeadsID, fastBatchID, vchObjectID, "TDSDeskCompanies":
		default:
			t.Fatalf("another request went to Tally: %s", id)
		}
	}
	kinds := map[string]int{}
	for _, x := range arr(s["results"]) {
		kinds[str(obj(x)["kind"])]++
	}
	if kinds["locate"] != fastMeasureLocate || kinds["W1"] != 4 || kinds["W2"] != 9 {
		t.Fatalf("the plan: %v", kinds)
	}
	if toInt(s["compared"]) != fastMeasureCompare || toInt(s["differ"]) != 0 || toInt(s["busiestDay"]) != 120 || toInt(s["busiest31"]) != 175 {
		t.Fatalf("compared %v, differ %v, busiest %v / %v", s["compared"], s["differ"], s["busiestDay"], s["busiest31"])
	}
	if f.n(vchObjectID) != fastMeasureCompare {
		t.Fatalf("%d entries asked one by one", f.n(vchObjectID))
	}
	f.mu.Lock()
	mf := f.maxFlight
	f.mu.Unlock()
	if mf > 1 {
		t.Fatalf("%d requests at Tally at once", mf)
	}
	if len(*ups) != 1 || str((*ups)[0]["company"]) != zz || obj((*ups)[0]["result"])["pass"] != true {
		t.Fatalf("the upload: %v", *ups)
	}
	if allowListHash(allowListRows()) != before {
		t.Fatal("the request table changed")
	}
	x := fastHeadsRequest(zz, "20261001", "20261007")
	fast.mu.Lock()
	fast.ask = x
	fast.mu.Unlock()
	if datedRefused(recorderTC(nil), x) == nil || checkAllowed(x) == nil {
		t.Fatal("a window request allowed after the measurement ended")
	}
	fast.mu.Lock()
	fast.ask = ""
	fast.mu.Unlock()
}

// 4. no entry data in the upload: no GUID, number, date, party, ledger, amount or narration of any entry
func TestFastMeasureNoEntryData(t *testing.T) {
	f, _, ups := fmBridge(t)
	vs := fmFill(f, map[string]int{"20261009": 12, "20261010": 14})
	s := fmRun(t)
	if len(*ups) != 1 {
		t.Fatalf("uploads %d sent=%v", len(*ups), s["sent"])
	}
	b, _ := json.Marshal((*ups)[0])
	txt := string(b)
	for _, v := range vs {
		for _, bad := range []string{v.guid, v.narr, `"` + v.no + `"`, v.date, "Customer A", "Bank", "10.00"} {
			if bad != "" && strings.Contains(txt, bad) {
				t.Fatalf("the upload carries entry data %q: %s", bad, txt)
			}
		}
	}
	r, _ := json.Marshal((*ups)[0]["result"])
	if strings.Contains(string(r), b220CoGUID) {
		t.Fatal("a GUID in the result (only company_guid names the company)")
	}
}

// 5. the stop rules: a request over 2 s ends the run there (nothing more asked); a window hold of 1 s too
func TestFastMeasureStopsOver2s(t *testing.T) {
	f, _, ups := fmBridge(t)
	fmFill(f, map[string]int{"20261010": 30})
	setCfg("TallyAbandonMaxSec", 600)
	n := 0
	f.mu.Lock()
	f.slow = func(id, body string) time.Duration {
		if id == fastHeadsID {
			n++
			if n == 3 {
				return 2300 * time.Millisecond
			}
		}
		return 0
	}
	f.mu.Unlock()
	s := fmRun(t)
	r3Settle()
	if s["pass"] == true || !strings.Contains(str(s["stopped"]), "2 s") || len(arr(s["results"])) != 3 {
		t.Fatalf("the result: %v", s)
	}
	if f.n(fastHeadsID) != 3 || f.n(fastBatchID) != 0 || f.n(vchObjectID) != 0 {
		t.Fatalf("asked after the stop: %v", f.ids())
	}
	if len(*ups) != 1 || obj((*ups)[0]["result"])["pass"] != false {
		t.Fatalf("the upload: %v", *ups)
	}
}

func TestFastMeasureStopsAtWindowHold(t *testing.T) {
	f, _, _ := fmBridge(t)
	fmFill(f, map[string]int{"20261010": 30})
	old := windowHoldFn
	k := 0
	windowHoldFn = func() func(time.Time) int {
		k++
		if k == 3 { // the first is the check at the start, then one a request
			return func(time.Time) int { return 1100 }
		}
		return func(time.Time) int { return 0 }
	}
	t.Cleanup(func() { windowHoldFn = old })
	s := fmRun(t)
	if s["pass"] == true || !strings.Contains(str(s["stopped"]), "window") || len(arr(s["results"])) != 2 || f.n(fastHeadsID) != 2 {
		t.Fatalf("the result: %v (asked %v)", s, f.ids())
	}
}

// 6. the field comparison names fields only
func TestFastFieldDiffNamesOnly(t *testing.T) {
	a := `<VOUCHER REMOTEID="x"><GUID>g-1</GUID><NARRATION>Paid rent</NARRATION><ALLLEDGERENTRIES.LIST><LEDGERNAME>Rent</LEDGERNAME><AMOUNT>-500.00</AMOUNT></ALLLEDGERENTRIES.LIST></VOUCHER>`
	b := `<VOUCHER REMOTEID="y"><GUID>g-1</GUID><NARRATION>Paid rent</NARRATION><ALLLEDGERENTRIES.LIST><LEDGERNAME>Rent</LEDGERNAME><AMOUNT>-501.00</AMOUNT></ALLLEDGERENTRIES.LIST></VOUCHER>`
	if d := fastFieldDiff(a, a); d != nil {
		t.Fatalf("the same entry differs: %v", d)
	}
	if d := fastFieldDiff(a, strings.Replace(a, `REMOTEID="x"`, `REMOTEID="z"`, 1)); d != nil {
		t.Fatalf("REMOTEID counted: %v", d)
	}
	d := fastFieldDiff(a, b)
	if strings.Join(d, ",") != "ALLLEDGERENTRIES.LIST/AMOUNT" {
		t.Fatalf("the names: %v", d)
	}
	for _, x := range d {
		if strings.Contains(x, "500") || strings.Contains(x, "Rent") {
			t.Fatalf("a value in the names: %v", d)
		}
	}
}

// 4b. a group answered with other entries (the filter not applied): the run stops with plain words; no MasterID or date
// of an entry in what is sent
func TestFastMeasureInexactNoEntryData(t *testing.T) {
	f, _, ups := fmBridge(t)
	vs := fmFill(f, map[string]int{"20261009": 12, "20261010": 14})
	f.mu.Lock()
	f.batchAll = true
	f.mu.Unlock()
	m := map[string]bool{}
	for _, v := range vs[:3] {
		m[v.guid] = true
	}
	s := fmRun(t)
	if s["pass"] == true || !strings.Contains(str(s["stopped"]), "not exactly") || len(*ups) != 1 {
		t.Fatalf("the result: %v", s)
	}
	b, _ := json.Marshal(obj((*ups)[0]["result"]))
	for _, v := range vs {
		if strings.Contains(string(b), "MasterID "+v.master) || strings.Contains(string(b), v.date) {
			t.Fatalf("entry data in the upload: %s", b)
		}
	}
}

// review (bca62f92d) 3: Tally's window not watchable: refused at the start, nothing asked; unwatched later: stops there
func TestFastMeasureNeverUnwatched(t *testing.T) {
	f, _, ups := fmBridge(t)
	fmFill(f, map[string]int{"20261010": 30})
	old := windowHoldFn
	t.Cleanup(func() { windowHoldFn = old })
	windowHoldFn = func() func(time.Time) int { return func(time.Time) int { return -1 } }
	n0 := f.n("")
	_, r := callLocal(t, "POST", "/tray/fastmeasure", "", `{}`)
	if r["ok"] != false || !strings.Contains(str(r["error"]), "cannot watch") || f.n("") != n0 || len(*ups) != 0 {
		t.Fatalf("unwatched at the start: %v (asked %v)", r, f.ids()[n0:])
	}
	k := 0
	windowHoldFn = func() func(time.Time) int {
		k++
		if k >= 3 {
			return func(time.Time) int { return -1 }
		}
		return func(time.Time) int { return 0 }
	}
	s := fmRun(t)
	if s["pass"] == true || !strings.Contains(str(s["stopped"]), "could not be watched") || len(arr(s["results"])) != 2 || f.n(fastHeadsID) != 2 {
		t.Fatalf("unwatched later: %v (asked %v)", s, f.ids())
	}
}

// review 4: the raw names: "ZZ TEST" and "zz test" open together refuse; another company opened during the run stops it
// before its next request
func TestFastMeasureAloneByRawNames(t *testing.T) {
	if _, why := fastMeasureWhyNotOf([]string{"ZZ TEST", "zz test"}); !strings.Contains(why, "alone") {
		t.Fatalf("ZZ TEST and zz test: %q", why)
	}
	f, _, ups := fmBridge(t)
	fmFill(f, map[string]int{"20261010": 30})
	if o := fmOpenNames(); len(o) != 1 || o[0] != fastMeasureCompany {
		t.Fatalf("the stand's open companies: %v", o)
	}
	old := fmOpenNames
	t.Cleanup(func() { fmOpenNames = old })
	calls := 0
	fmOpenNames = func() []string {
		calls++
		if calls > 3 { // the start, then the first two requests
			return []string{fastMeasureCompany, "zz test"}
		}
		return []string{fastMeasureCompany}
	}
	s := fmRun(t)
	if s["pass"] == true || !strings.Contains(str(s["stopped"]), "another company") || f.n(fastHeadsID) != 2 {
		t.Fatalf("another company opened: %v (asked %v)", s, f.ids())
	}
	if b, _ := json.Marshal(*ups); strings.Contains(string(b), "zz test") {
		t.Fatalf("the other company's name uploaded: %s", b)
	}
}

// review 2: what is uploaded for a request not asked is fixed words, never the period read's own text
func TestFastMeasureStopFixedWords(t *testing.T) {
	fmBridge(t) // the log in the test's own folder (fastMeasureStop logs the details)
	for _, a := range []fmAnswer{{err: errFmNotFree, nothingAsked: true},
		{err: errors.New("Tally busy reading Client Books 20261010 to 20261012"), nothingAsked: true}} {
		w := fastMeasureStop(a)
		if !strings.HasPrefix(w, "not measured: Tally was not free") || strings.Contains(w, "2026") || strings.Contains(w, "Client") {
			t.Fatalf("%q", w)
		}
	}
}

// review 5: a step's window hold counts from its start, the pause between its requests too
func TestFastMeasureHoldFromStepStart(t *testing.T) {
	fmBridge(t)
	old := windowHoldFn
	t.Cleanup(func() { windowHoldFn = old })
	windowHoldFn = func() func(time.Time) int {
		return func(from time.Time) int { return int(time.Since(from).Milliseconds()) } // all of it a hold
	}
	a := fastMeasureAsk(fastMeasureCompany, "", "", func(tc *TC, port int) (string, error) {
		time.Sleep(400 * time.Millisecond) // the pause before the step's second request
		return "", fastCompanyListed(tc, fastMeasureCompany, port, 5)
	})
	if a.err != nil || a.ms > 300 || a.holdMs < 400 {
		t.Fatalf("the hold: %+v", a)
	}
}
