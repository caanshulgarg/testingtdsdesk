package main

// 2.2.2 (05-Oct-2026, the owner's request): "Test fetching an entry", a tray item. NWS144 cannot run PowerShell, so the
// six forms of docs/diagnostics/2.2.2-fetch-check.ps1 (one voucher by type and number, then by its MasterID) are sent by
// the bridge itself, one at a time, each logged with its time, its count, the ids of what came back and the head of
// Tally's answer. A person's tray item only; never during a posting. Also: the live add-on's file names dated d-Mon-yy
// (on real TallyPrime 7.1 @@FCRDay gives "5-Oct-26"). Written before the code.

import (
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
	"time"
)

// the six requests of the PowerShell check, with the company and ids of this test: A..F as the ps1 holds them, the
// collection's id renamed to the form's own measure-only id (FinComFetchTestA..F)
func ps1Forms(t *testing.T, company string) map[string]string {
	t.Helper()
	b, err := os.ReadFile(filepath.Join("..", "docs", "diagnostics", "2.2.2-fetch-check.ps1"))
	if err != nil {
		t.Fatal(err)
	}
	out := map[string]string{}
	for _, m := range regexp.MustCompile(`(?s)Ask '([A-F])' '[^\n]*' @'\r?\n(.*?)\r?\n'@`).FindAllStringSubmatch(string(b), -1) {
		x := strings.ReplaceAll(m[2], "GARG SHEKHAR &amp; COMPANY", esc(company))
		x = strings.ReplaceAll(x, "FinComVoucherByNumber", "FinComFetchTest"+m[1])
		x = strings.ReplaceAll(x, "FinComVoucherByMaster", "FinComFetchTest"+m[1])
		// 2.3.1 (the owner's decision of 06-Oct-2026; review M2): the ps1 stays the record of what 2.2.2 sent; A and C carry
		// the entry request's fetch as built now (the 2.2.2 fields plus the ledger lines under an invoice's items), so they
		// stay byte for byte the bridge's two requests; B, D, E and F stay byte for byte the ps1's (2.2.2 .. 2.3.0)
		if m[1] == "A" || m[1] == "C" {
			x = strings.Replace(x, "<FETCH>"+items231OldFetch+"</FETCH>", "<FETCH>"+liveFetchField+"</FETCH>", 1)
		}
		out[m[1]] = x
	}
	if len(out) != 6 {
		t.Fatalf("the ps1 holds %d forms", len(out))
	}
	return out
}

// the stand answers the fetch test's forms: hit(letter) says which give the one voucher (MasterID 26312)
func fetchTestStand(hit func(letter string) bool, then func(letter string)) func(w http.ResponseWriter, r *http.Request, id, body string) bool {
	return func(w http.ResponseWriter, r *http.Request, id, body string) bool {
		if !strings.HasPrefix(id, "FinComFetchTest") {
			return false
		}
		l := strings.TrimPrefix(id, "FinComFetchTest")
		if then != nil {
			defer then(l)
		}
		if hit(l) {
			_, _ = w.Write([]byte("<ENVELOPE>\r\n <BODY>\r\n  <DATA><COLLECTION><VOUCHER REMOTEID=\"g-1\" VCHTYPE=\"Receipt\"><GUID>g-1</GUID><MASTERID> 26312</MASTERID>" +
				"<DATE>20261005</DATE><VOUCHERTYPENAME>Receipt</VOUCHERTYPENAME><VOUCHERNUMBER>212</VOUCHERNUMBER></VOUCHER></COLLECTION></DATA>" +
				"<DESC><CMPINFO><VOUCHER>14</VOUCHER></CMPINFO></DESC></BODY></ENVELOPE>"))
			return true
		}
		// real TallyPrime 7.1: a <VOUCHER>n</VOUCHER> counter inside CMPINFO is not a voucher
		_, _ = w.Write([]byte("<ENVELOPE><BODY><DESC><CMPINFO><COMPANY>0</COMPANY><VOUCHER>14</VOUCHER></CMPINFO></DESC><DATA><COLLECTION></COLLECTION></DATA></BODY></ENVELOPE>"))
		return true
	}
}

func fetchTestReset() {
	fetchTestMu.Lock()
	fetchTestLast = nil
	fetchTestMu.Unlock()
}

func fetchTestWait(t *testing.T, until string) M {
	t.Helper()
	var res M
	for i := 0; i < 400; i++ {
		_, res = callLocal(t, "GET", "/tray/fetchtest", "", "")
		if st := str(res["state"]); st == until || st == "failed" {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if str(res["state"]) != until {
		t.Fatalf("the fetch test is not %s: %v", until, res)
	}
	return res
}

func fetchTestBodies(f *standTally) ([]string, []string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	var ids, bodies []string
	for i, id := range f.reqs {
		if strings.HasPrefix(id, "FinComFetchTest") {
			ids = append(ids, strings.TrimPrefix(id, "FinComFetchTest"))
			bodies = append(bodies, f.bodies[i])
		}
	}
	return ids, bodies
}

// --- 1. the route: the tray only (no Origin, no Sec-Fetch header), the owner's trial tools on; nothing sent otherwise
func TestFetchTestRoutePersonOnly(t *testing.T) {
	f := newStandTally(t)
	standBridge(t, f, `,"Key":"tray-test-key"`)
	fetchTestReset()
	body := `{"company":"ZZ TEST","type":"Receipt","number":"212","date":"05-Oct-2026"}`
	// trial tools off: refused
	if code, res := callLocal(t, "POST", "/tray/fetchtest", "", body); code != 403 || !strings.Contains(str(res["error"]), "Trial tools") {
		t.Fatalf("with the trial tools off: %d %v", code, res)
	}
	trialOn(t)
	for _, origin := range []string{"https://app.fincom.live", "http://localhost:5173"} {
		for _, method := range []string{"POST", "GET"} {
			if code, res := callLocal(t, method, "/tray/fetchtest", origin, body); code != 403 {
				t.Fatalf("%s from the web page %s: %d %v", method, origin, code, res)
			}
		}
	}
	for _, h := range []string{"Sec-Fetch-Dest", "Sec-Fetch-Site", "Sec-Fetch-Mode"} {
		if code, _ := callLocalHeaders(t, "POST", "/tray/fetchtest", map[string]string{h: "x"}, body); code != 403 {
			t.Fatalf("with %s: %d", h, code)
		}
	}
	if code, res := callLocal(t, "GET", "/tray/fetchtest", "", ""); code != 200 || str(res["state"]) != "none" {
		t.Fatalf("GET from the tray, nothing run: %d %v", code, res)
	}
	if ids, _ := fetchTestBodies(f); len(ids) != 0 {
		t.Fatalf("a refused request reached Tally: %v", ids)
	}
	// the preview names the company and sends nothing
	if code, res := callLocal(t, "POST", "/tray/fetchtest", "", `{"preview":true,"company":"ZZ TEST"}`); code != 200 || res["ok"] != true || str(res["company"]) != zz {
		t.Fatalf("the preview: %d %v", code, res)
	}
	if ids, _ := fetchTestBodies(f); len(ids) != 0 {
		t.Fatalf("the preview sent %v", ids)
	}
	// the variants are measure-only: never sent outside the test
	for _, l := range []string{"A", "B", "C", "D", "E", "F"} {
		x := fetchTestRequest(l, zz, "20261005", "Receipt", "212", "26312")
		if x == "" {
			t.Fatalf("form %s not built", l)
		}
		if a := tallyAllowList["FinComFetchTest"+l]; !a.measureOnly || a.purpose == "" {
			t.Fatalf("FinComFetchTest%s is not measure-only with a purpose: %+v", l, a)
		}
		if _, err := invokeTally(fin, f.port, x, 5); err == nil {
			t.Fatalf("form %s went outside the test", l)
		}
		if _, err := invokeTally(fetchTestTC, f.port, x, 5); err == nil || !strings.Contains(err.Error(), "measure-only") {
			t.Fatalf("form %s went as a person's outside the test: %v", l, err)
		}
	}
	if fetchTestTC == nil || !fetchTestTC.person || fetchTestTC.copier {
		t.Fatal("the fetch test's requests are not a person's")
	}
}

// --- 2. the six forms, in order, byte for byte as the ps1 holds them; C on the MasterID B found; the log and the summary
func TestFetchTestSixFormsInOrder(t *testing.T) {
	f := newStandTally(t)
	f.mu.Lock()
	f.behave = fetchTestStand(func(l string) bool { return l == "B" || l == "D" || l == "F" }, nil)
	f.coName = gsc // the company open in this stand's Tally, as on NWS144
	f.mu.Unlock()
	standBridge(t, f, `,"Key":"tray-test-key"`)
	trialOn(t)
	fetchTestReset()
	code, res := callLocal(t, "POST", "/tray/fetchtest", "", `{"company":"`+gsc+`","type":"Receipt","number":"212","date":"05-Oct-2026"}`)
	if code != 200 || res["ok"] != true || res["started"] != true {
		t.Fatalf("POST: %d %v", code, res)
	}
	res = fetchTestWait(t, "done")
	ids, bodies := fetchTestBodies(f)
	if strings.Join(ids, "") != "ABCDEF" {
		t.Fatalf("the forms sent: %v", ids)
	}
	want := ps1Forms(t, gsc)
	for i, l := range ids {
		if bodies[i] != want[l] {
			t.Errorf("form %s:\n got %s\nwant %s", l, bodies[i], want[l])
		}
	}
	// A and C are the bridge's own requests, byte for byte, under their own ids
	if strings.ReplaceAll(bodies[0], "FinComFetchTestA", vchByNumberID) != voucherByNumberRequest(gsc, "20261005", "Receipt", "212") {
		t.Error("A is not voucherByNumberRequest as sent")
	}
	if strings.ReplaceAll(bodies[2], "FinComFetchTestC", vchByMasterID) != voucherByMasterRequest(gsc, "20261005", []string{"26312"}) {
		t.Error("C is not voucherByMasterRequest as sent")
	}
	sum := str(res["summary"])
	if !regexp.MustCompile(`^A 0 vouchers \d+ ms · B 1 voucher \d+ ms · C 0 vouchers \d+ ms · D 1 voucher \d+ ms · E 0 vouchers \d+ ms · F 1 voucher \d+ ms$`).MatchString(sum) {
		t.Fatalf("the summary: %q", sum)
	}
	if str(res["masterId"]) != "26312" {
		t.Fatalf("the MasterID: %v", res["masterId"])
	}
	// the log: per form its letter and description, ms, count, the ids of each voucher and the answer's head
	ll := r13LogLines("Test fetching an entry: " + gsc + ", Receipt 212, 5-Oct-2026: ")
	all := strings.Join(ll, "\n")
	for _, w := range []string{
		"A. FinComVoucherByNumber as sent (&#34; quotes, dates yyyymmdd): ",
		"B. by number with plain quote marks, dates yyyymmdd: ",
		"C. FinComVoucherByMaster as sent, MasterID 26312 (dates yyyymmdd): ",
		"D. by MasterID 26312 with no dates: ",
		"E. by MasterID 26312 with the dates as d-MMM-yyyy TYPE=Date: ",
		"F. by number with plain quote marks and no dates: ",
		"B vouchers: MASTERID=26312 VOUCHERNUMBER=212 DATE=20261005 VOUCHERTYPENAME=Receipt",
		"A answer starts: <ENVELOPE><BODY><DESC><CMPINFO><COMPANY>0</COMPANY><VOUCHER>14</VOUCHER></CMPINFO></DESC>",
		// the period sent, in full, per form
		"A. FinComVoucherByNumber as sent (&#34; quotes, dates yyyymmdd): sent <SVFROMDATE>20261005</SVFROMDATE><SVTODATE>20261005</SVTODATE>: ",
		"E. by MasterID 26312 with the dates as d-MMM-yyyy TYPE=Date: sent <SVFROMDATE TYPE=\"Date\">5-Oct-2026</SVFROMDATE><SVTODATE TYPE=\"Date\">5-Oct-2026</SVTODATE>: ",
		"D. by MasterID 26312 with no dates: sent no SVFROMDATE/SVTODATE: ",
		"B answer starts: <ENVELOPE> <BODY> <DATA><COLLECTION><VOUCHER REMOTEID=\"g-1\"",
	} {
		if !strings.Contains(all, w) {
			t.Errorf("the log does not say %q:\n%s", w, all)
		}
	}
	if !regexp.MustCompile(`A\. [^\n]*: \d+ ms, 0 vouchers`).MatchString(all) || !regexp.MustCompile(`B\. [^\n]*: \d+ ms, 1 voucher\b`).MatchString(all) {
		t.Errorf("the times and counts:\n%s", all)
	}
	for _, l := range ll {
		if i := strings.Index(l, " answer starts: "); i >= 0 {
			if h := strings.TrimRight(l[i+len(" answer starts: "):], "\r"); len([]rune(h)) > 400 || strings.Contains(h, "\r") {
				t.Errorf("a head longer than 400 or not collapsed: %q", h)
			}
		}
	}
	// the company's books as Tally listed them, at the start
	if len(r13LogLines("Test fetching an entry: "+gsc+", Receipt 212, 5-Oct-2026: the company's period in Tally: ")) != 1 {
		t.Errorf("the company's period is not logged at the start:\n%s", all)
	}
	// at most 5 vouchers named
	f2 := strings.Repeat("<VOUCHER><MASTERID>1</MASTERID></VOUCHER>", 7)
	if got := fetchTestIDs(f2); strings.Count(got, "MASTERID=") != 5 || !strings.Contains(got, "and 2 more") {
		t.Fatalf("seven vouchers: %q", got)
	}
	// a counter (no attribute, no MASTERID) is not counted; an attributed VOUCHER or one holding a MASTERID is
	if n := fetchTestCount("<CMPINFO><VOUCHER>14</VOUCHER></CMPINFO><VOUCHER REMOTEID=\"x\"></VOUCHER><VOUCHER><MASTERID>3</MASTERID></VOUCHER>"); n != 2 {
		t.Fatalf("the count: %d", n)
	}
}

// --- 3. no MasterID from B or A: F goes before C (C on F's); none at all: the bridge asks (needMaster), and Cancel skips
// C, D and E with a log line
func TestFetchTestMasterFromFOrAsked(t *testing.T) {
	f := newStandTally(t)
	hitF := true
	f.mu.Lock()
	f.behave = fetchTestStand(func(l string) bool { return l == "F" && hitF }, nil)
	f.mu.Unlock()
	standBridge(t, f, `,"Key":"tray-test-key"`)
	trialOn(t)
	fetchTestReset()
	if code, res := callLocal(t, "POST", "/tray/fetchtest", "", `{"company":"ZZ TEST","type":"Receipt","number":"212","date":"20261005"}`); code != 200 || res["started"] != true {
		t.Fatalf("POST: %d %v", code, res)
	}
	fetchTestWait(t, "done")
	if ids, _ := fetchTestBodies(f); strings.Join(ids, "") != "ABFCDE" {
		t.Fatalf("with F's MasterID: %v", ids)
	}
	// none found: asked
	f.mu.Lock()
	hitF = false
	f.reqs, f.bodies = nil, nil
	f.mu.Unlock()
	fetchTestReset()
	callLocal(t, "POST", "/tray/fetchtest", "", `{"company":"ZZ TEST","type":"Receipt","number":"212","date":"05-Oct-2026"}`)
	res := fetchTestWait(t, "needMaster")
	if !strings.Contains(str(res["question"]), "MasterID") {
		t.Fatalf("the question: %v", res)
	}
	if code, r := callLocal(t, "POST", "/tray/fetchtest", "", `{"masterId":"12a"}`); code != 200 || r["ok"] != false {
		t.Fatalf("a MasterID that is not a number: %d %v", code, r)
	}
	callLocal(t, "POST", "/tray/fetchtest", "", `{"masterId":"777"}`)
	res = fetchTestWait(t, "done")
	ids, bodies := fetchTestBodies(f)
	if strings.Join(ids, "") != "ABFCDE" || !strings.Contains(bodies[3], "$MasterID = 777</SYSTEM>") {
		t.Fatalf("with the MasterID typed: %v", ids)
	}
	// skipped
	f.mu.Lock()
	f.reqs, f.bodies = nil, nil
	f.mu.Unlock()
	fetchTestReset()
	callLocal(t, "POST", "/tray/fetchtest", "", `{"company":"ZZ TEST","type":"Receipt","number":"212","date":"05-Oct-2026"}`)
	fetchTestWait(t, "needMaster")
	callLocal(t, "POST", "/tray/fetchtest", "", `{"skip":true}`)
	res = fetchTestWait(t, "done")
	if ids, _ := fetchTestBodies(f); strings.Join(ids, "") != "ABF" {
		t.Fatalf("skipped: %v", ids)
	}
	if !strings.Contains(str(res["summary"]), "C, D, E skipped") || len(r13LogLines("C, D and E not sent: no MasterID")) == 0 {
		t.Fatalf("the skip is not said: %v", res["summary"])
	}
}

// --- 2.2.3 review M1: while the test waits for the person's MasterID nothing of the measuring tool's is held open: the
// measure-only gate is shut and the self-watch is not suspended (measuring is raised only around each form's send)
func TestFetchTestMeasuringNotHeldWhileAsking(t *testing.T) {
	f := newStandTally(t)
	f.mu.Lock()
	f.behave = fetchTestStand(func(string) bool { return false }, nil)
	f.mu.Unlock()
	standBridge(t, f, `,"Key":"tray-test-key"`)
	var during int32 = -1
	r, err := runFetchTest(fetchTestOpts{company: "ZZ TEST", typ: "Receipt", no: "212", date: "20261005"}, func() string {
		during = measuring.Load()
		return "777"
	})
	if err != nil {
		t.Fatal(err)
	}
	if during != 0 {
		t.Fatalf("measuring while asking the person: %d (want 0)", during)
	}
	if measuring.Load() != 0 {
		t.Fatalf("measuring after the test: %d", measuring.Load())
	}
	if ids, _ := fetchTestBodies(f); strings.Join(ids, "") != "ABFCDE" || str(r["masterId"]) != "777" {
		t.Fatalf("the forms: %v %v", ids, r["masterId"])
	}
}

// --- 4. never during a posting: refused with plain words before anything goes; a posting that starts during the test
// stops it before the next form
func TestFetchTestRefusedDuringPosting(t *testing.T) {
	f := newStandTally(t)
	f.mu.Lock()
	f.behave = fetchTestStand(func(string) bool { return false }, nil)
	f.mu.Unlock()
	standBridge(t, f, `,"Key":"tray-test-key"`)
	trialOn(t)
	fetchTestReset()
	postTaking.Store(true)
	t.Cleanup(func() { postTaking.Store(false) })
	code, res := callLocal(t, "POST", "/tray/fetchtest", "", `{"company":"ZZ TEST","type":"Receipt","number":"212","date":"05-Oct-2026"}`)
	if code != 200 || res["ok"] != false || !strings.Contains(str(res["error"]), "posting") || !strings.Contains(str(res["error"]), "nothing was sent") {
		t.Fatalf("during a posting: %d %v", code, res)
	}
	if ids, _ := fetchTestBodies(f); len(ids) != 0 {
		t.Fatalf("sent during a posting: %v", ids)
	}
	if _, err := runFetchTest(fetchTestOpts{company: zz, typ: "Receipt", no: "212", date: "20261005"}, nil); err == nil || !strings.Contains(err.Error(), "posting") {
		t.Fatalf("run directly during a posting: %v", err)
	}
	postTaking.Store(false)
	// a posting starts while A is answered: B is not sent
	f.mu.Lock()
	f.behave = fetchTestStand(func(string) bool { return false }, func(l string) {
		if l == "A" {
			postTaking.Store(true)
		}
	})
	f.mu.Unlock()
	callLocal(t, "POST", "/tray/fetchtest", "", `{"company":"ZZ TEST","type":"Receipt","number":"212","date":"05-Oct-2026"}`)
	res = fetchTestWait(t, "done")
	if ids, _ := fetchTestBodies(f); strings.Join(ids, "") != "A" {
		t.Fatalf("a posting started after A: %v", ids)
	}
	if !strings.Contains(str(res["summary"]), "B not sent (a posting started)") || len(r13LogLines("B not sent: a posting started")) == 0 {
		t.Fatalf("the stop is not said: %v", res)
	}
}

// --- 5. the inputs: a type or number that cannot go in a TDL string, a date that is not one, a MasterID not a number
func TestFetchTestInputsChecked(t *testing.T) {
	for _, c := range [][4]string{{"Rec\"eipt", "212", "20261005", ""}, {"Receipt", "", "20261005", ""}, {"Receipt", "212", "2026-13-45", ""}} {
		if x := fetchTestRequest("A", zz, normDate(c[2]), c[0], c[1], ""); x != "" {
			t.Errorf("%v built: %s", c, x)
		}
	}
	if fetchTestRequest("C", zz, "20261005", "", "", "12a") != "" || fetchTestRequest("D", zz, "", "", "", "") != "" {
		t.Error("a MasterID that is not a number built")
	}
	if fetchTestRequest("F", zz, "", "Receipt", "212", "") == "" || fetchTestRequest("D", zz, "", "", "", "5") == "" {
		t.Error("the undated forms need no date")
	}
}
