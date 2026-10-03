package main

// Round 13 (03-Oct-2026): "Test reading from Tally" in the tray. On the owner's computer the Day Book export answers a
// whole envelope with no voucher while the TDL collections (the ledger list, FinComTag) list entries; only the tray
// menu can be used there, so the bridge gathers the evidence itself: three requests for one day, the same day, their
// counts and heads in the log. Nothing is written (no day file, no mark, no cloud queue) and nothing goes to the cloud.

import (
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// the stand answers every Day Book request (either date form) with a whole envelope and no voucher
func emptyDayBook() func(w http.ResponseWriter, r *http.Request, id, body string) bool {
	return func(w http.ResponseWriter, r *http.Request, id, body string) bool {
		if id != "Day Book" {
			return false
		}
		_, _ = w.Write([]byte("<ENVELOPE><BODY><IMPORTDATA><REQUESTDATA></REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>"))
		return true
	}
}

func r13LogLines(part string) []string {
	var out []string
	for _, l := range strings.Split(readText(logFile()), "\n") {
		if strings.Contains(l, part) {
			out = append(out, l)
		}
	}
	return out
}

// --- 1. the three requests go, one after the other, for the newest day of the copy that holds an entry; each is logged
// with its count, size, time and head (tags only); nothing is written and nothing goes to the cloud
func TestReadTestThreeRequestsLogged(t *testing.T) {
	const d = "20260615"
	f := newStandTally(t)
	c := newStandCloud(t)
	for i := 1; i <= 3; i++ {
		f.add(d, "Party X", string(rune('0'+i)), "sale", "-100.00")
	}
	f.mu.Lock()
	f.behave = emptyDayBook()
	f.mu.Unlock()
	standBridge(t, f, c.cfg()+`,"Key":"tray-test-key"`)
	dir := syncFolder(zz)
	text := r12Voucher(d)
	writeDayFile(dir, d, text, false)
	outFile := filepath.Join(dir, "cloud-out.txt")
	outBefore := readText(outFile)
	days0, guard0 := c.count("days"), c.count("read_guard")

	// 13b: POST starts it and answers at once; GET says how far; the tray polls (the stand answers instantly)
	code, res := callLocal(t, "POST", "/tray/readtest", "", `{"company":"ZZ TEST"}`)
	if code != 200 || res["ok"] != true || res["started"] != true || str(res["company"]) != zz || str(res["day"]) != d {
		t.Fatalf("POST /tray/readtest from the tray: %d %v", code, res)
	}
	for i := 0; i < 200; i++ {
		code, res = callLocal(t, "GET", "/tray/readtest", "", "")
		if code != 200 || str(res["state"]) == "failed" {
			t.Fatalf("GET /tray/readtest: %d %v", code, res)
		}
		if str(res["state"]) == "done" {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if str(res["state"]) != "done" || res["ok"] != true {
		t.Fatalf("the test did not finish: %v", res)
	}
	if str(res["company"]) != zz || str(res["day"]) != d {
		t.Fatalf("company/day: %v", res)
	}
	results := arr(res["results"])
	if len(results) != 3 {
		t.Fatalf("results: %v", results)
	}
	labels := []string{"Day Book, dates yyyymmdd", "Day Book, dates d-MMM-yyyy", "FinComTag (the posting read-back's request)"}
	want := []int{0, 0, 3}
	for i, x := range results {
		m := obj(x)
		if str(m["label"]) != labels[i] {
			t.Fatalf("result %d label %q, want %q", i, str(m["label"]), labels[i])
		}
		if str(m["error"]) != "" {
			t.Fatalf("result %d not answered: %v", i, m)
		}
		if toInt(m["vouchers"]) != want[i] {
			t.Fatalf("result %d: %d vouchers, want %d (%v)", i, toInt(m["vouchers"]), want[i], m)
		}
		if toInt(m["bytes"]) <= 0 || str(m["head"]) == "" {
			t.Fatalf("result %d: no bytes or no head: %v", i, m)
		}
	}
	// the requests reached the stand: two Day Book exports (one per date form) and one FinComTag collection
	if f.n("Day Book") != 2 || f.n("FinComTag") != 1 {
		t.Fatalf("requests sent: %v", f.ids())
	}
	dmy := 0
	f.mu.Lock()
	for _, b := range f.bodies {
		if strings.Contains(b, "<SVFROMDATE>15-Jun-2026</SVFROMDATE><SVTODATE>15-Jun-2026</SVTODATE>") {
			dmy++
		}
	}
	f.mu.Unlock()
	if dmy != 1 {
		t.Fatalf("the d-MMM-yyyy request went %d time(s), want once", dmy)
	}
	// the log: one line per request, the agreed form, the head with tags only
	for i, lb := range labels {
		lines := r13LogLines("Test reading from Tally: " + zz + ", " + d + ": " + lb + ": ")
		if len(lines) != 1 {
			t.Fatalf("log lines for %q: %d, want 1\n%s", lb, len(lines), strings.Join(lines, "\n"))
		}
		l := lines[0]
		if !strings.Contains(l, lb+": "+itoa(want[i])+" vouchers, ") || !strings.Contains(l, " bytes, ") || !strings.Contains(l, " s; head: <ENVELOPE><BODY>") {
			t.Fatalf("the log line is not the agreed one: %s", l)
		}
		head := l[strings.Index(l, "; head: ")+len("; head: "):]
		if strings.ContainsAny(head, "0123456789=\"") {
			t.Fatalf("the head carries a value: %s", head)
		}
		if i == 2 && !strings.Contains(head, "<VOUCHER>") {
			t.Fatalf("the FinComTag head shows no voucher tag: %s", head)
		}
	}
	// nothing written, nothing sent
	if got := readText(filepath.Join(dir, "days", d+".xml")); got != text {
		t.Fatalf("the day file was changed: %q", got)
	}
	if exists(dayFullMark(dir, d)) {
		t.Fatal("a .full mark appeared")
	}
	if m, _ := filepath.Glob(filepath.Join(dir, "days", "*.full")); len(m) != 0 {
		t.Fatalf("full marks appeared: %v", m)
	}
	if readText(outFile) != outBefore {
		t.Fatal("cloud-out.txt changed")
	}
	if c.count("days") != days0 || c.count("read_guard") != guard0 {
		t.Fatalf("the cloud was called during the test: %v", c.kinds)
	}
}

// --- 2. a web page never starts it (POST or GET, with an Origin); the stand got no request
func TestReadTestNotFromWebPage(t *testing.T) {
	f := newStandTally(t)
	standBridge(t, f, `,"Key":"tray-test-key"`)
	readTestMu.Lock()
	readTestLast = nil
	readTestMu.Unlock()
	for _, origin := range []string{"https://app.fincom.live", "http://localhost:5173", "https://evil.example"} {
		for _, method := range []string{"POST", "GET"} {
			code, res := callLocal(t, method, "/tray/readtest", origin, `{"company":"ZZ TEST"}`)
			if code != 403 {
				t.Fatalf("%s /tray/readtest from the web page %s: %d %v (want 403)", method, origin, code, res)
			}
		}
	}
	code, res := callLocalHeaders(t, "POST", "/tray/readtest", map[string]string{"Sec-Fetch-Dest": "empty"}, `{"company":"ZZ TEST"}`)
	if code != 403 || !strings.Contains(str(res["error"]), "tray icon only") {
		t.Fatalf("POST /tray/readtest with a Sec-Fetch header: %d %v (want 403)", code, res)
	}
	if code, res := callLocal(t, "GET", "/tray/readtest", "", ""); code != 200 || str(res["state"]) != "none" {
		t.Fatalf("GET /tray/readtest from the tray with no test run: %d %v", code, res)
	}
	if f.n("Day Book") != 0 || f.n("FinComTag") != 0 {
		t.Fatalf("a refused request reached Tally: %v", f.ids())
	}
}

// --- 3. the day: the newest day file with an entry; today when the copy holds none
func TestReadTestDayChoice(t *testing.T) {
	f := newStandTally(t)
	standBridge(t, f, "")
	dir := syncFolder(zz)
	r, err := runReadTest(zz)
	if err != nil {
		t.Fatal(err)
	}
	if str(r["day"]) != today() {
		t.Fatalf("no day file: the day is %q, want today %s", str(r["day"]), today())
	}
	writeDayFile(dir, "20260615", r12Voucher("20260615"), false)
	writeDayFile(dir, "20260701", "", false)
	r, err = runReadTest(zz)
	if err != nil {
		t.Fatal(err)
	}
	if str(r["day"]) != "20260615" {
		t.Fatalf("the day is %q, want 20260615 (the newest day file that holds an entry)", str(r["day"]))
	}
	if got := readText(filepath.Join(dir, "days", "20260701.xml")); got != "" {
		t.Fatalf("the empty day file was changed: %q", got)
	}
	if _, err := os.Stat(dayFullMark(dir, "20260615")); err == nil {
		t.Fatal("a .full mark appeared")
	}
	// no company given: the one open in Tally (as the tray's Measure Tally picks it)
	r, err = runReadTest("")
	if err != nil || str(r["company"]) != zz || str(r["day"]) != "20260615" {
		t.Fatalf("no company given: %v %v (want the open company %s)", r, err, zz)
	}
}

// --- 4. the Day Book request with d-MMM-yyyy dates: the same report, on the allow-list
func TestDayBookRequestDMY(t *testing.T) {
	x := dayBookRequestDMY("ZZ TEST", "20260701", "20260731")
	if !strings.Contains(x, "<SVFROMDATE>1-Jul-2026</SVFROMDATE><SVTODATE>31-Jul-2026</SVTODATE>") {
		t.Fatalf("dates: %s", x)
	}
	if !strings.Contains(x, "<REPORTNAME>Day Book</REPORTNAME>") || tallyRequestID(x) != "Day Book" {
		t.Fatalf("report: %s", x)
	}
	if err := checkAllowed(x); err != nil {
		t.Fatal(err)
	}
	if tallyDMY("20260105") != "5-Jan-2026" || tallyDMY("20261231") != "31-Dec-2026" {
		t.Fatalf("tallyDMY: %q %q", tallyDMY("20260105"), tallyDMY("20261231"))
	}
}
