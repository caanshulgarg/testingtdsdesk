package main

// Round 4 (03-Oct-2026), the owner's items 9, 14 and 18 on the bridge side:
//   9. the rewind guard: read_guard carries the company's highest AlterID from the latest company check on EVERY round,
//      and null (not 0) when it is not known
//  14. the FinCom tag: first in the narration the bridge writes ("TDSDesk:<id> | <rest>"), and found anywhere in a
//      narration when read back (exact id, never a prefix)
//  18. the measuring tool: stops at the first request that does not answer in TallyMaxSec, waits for the small company
//      check and ends; started by a person only (the tray, the measure command), never from a web page or the service

import (
	"fmt"
	"net/http/httptest"
	"regexp"
	"strings"
	"sync"
	"testing"
	"time"
)

// --- 9. a keeper spanning two rounds: the second read_guard carries the AlterID the company check gave between them
func TestReadGuardAlterEveryRound(t *testing.T) {
	td := today()
	f := newStandTally(t)
	c := newStandCloud(t)
	f.add(td, "Party X", "1", "sale", "-100.00")
	standBridge(t, f, c.cfg())
	oldDaysOn() // the owner's rule of 04-Oct-2026 turns reading old days off (ReadDays); the round's day logic is still tested here
	liveFrom(td[:6] + "01")
	k := &keepRun{tc: &TC{copier: true}, kind: "now", force: true, told: map[string]bool{}, id: "round-1", alter: map[string]int64{}}
	round := func() {
		t.Helper()
		k.caughtUp = false
		for i := 0; i < 20 && !k.caughtUp; i++ {
			if err := k.step(zz, f.port, ""); err != nil {
				t.Fatal(err)
			}
		}
		if !k.caughtUp {
			t.Fatal("the round did not finish")
		}
	}
	round()
	f.mu.Lock()
	first := f.alter
	f.mu.Unlock()
	// between the rounds: Tally moves on (an entry added raises ALTVCHID)
	f.add(td, "Party Y", "2", "sale", "-200.00")
	f.mu.Lock()
	second := f.alter
	f.mu.Unlock()
	if second <= first {
		t.Fatal("the stand-in Tally did not raise its AlterID")
	}
	k.id = "round-2"
	round()
	c.mu.Lock()
	guards := append([]M{}, c.guard...)
	c.mu.Unlock()
	if len(guards) != 2 {
		t.Fatalf("%d read_guard(s) sent, want one per round: %v", len(guards), guards)
	}
	if toI64(guards[0]["alter"]) != first || toI64(guards[1]["alter"]) != second {
		t.Fatalf("read_guard alter %v then %v, want %d then %d (the latest company check each round)", guards[0]["alter"], guards[1]["alter"], first, second)
	}
	if f.n("FinComCompany") < 2 {
		t.Fatalf("the company check was made %d time(s) over two rounds, want one per round", f.n("FinComCompany"))
	}
}

// --- 9. an AlterID not known (the check gave none, or 0): read_guard says null, never 0 (0 would look like a rewind)
func TestReadGuardNullWhenUnknown(t *testing.T) {
	f := newStandTally(t)
	c := newStandCloud(t)
	standBridge(t, f, c.cfg())
	sendReadGuard(zz, "co-guid-1", 0, 3)
	sendReadGuard(zz, "co-guid-1", 7, 3)
	c.mu.Lock()
	raws := append([]string{}, c.raw...)
	c.mu.Unlock()
	var guards []string
	for _, r := range raws {
		if strings.Contains(r, `"kind":"read_guard"`) {
			guards = append(guards, r)
		}
	}
	if len(guards) != 2 {
		t.Fatalf("%d read_guard bodies: %v", len(guards), raws)
	}
	if !strings.Contains(guards[0], `"alter":null`) || strings.Contains(guards[0], `"alter":0`) {
		t.Fatalf("an unknown AlterID must go as null: %s", guards[0])
	}
	if !strings.Contains(guards[1], `"alter":7`) {
		t.Fatalf("a known AlterID must go as the number: %s", guards[1])
	}
}

// --- 14. the narration the bridge writes starts with the tag, so a cut at 300 characters can never lose it
func TestTagFirstInNarration(t *testing.T) {
	long := strings.Repeat("rent for the month ", 20) // 380 characters
	cases := []struct{ in, id, want string }{
		{`<VOUCHER ACTION="Create"><DATE>20260401</DATE><NARRATION>Paid rent</NARRATION><X/></VOUCHER>`, "ab-1", "TDSDesk:ab1 | Paid rent"},
		{`<VOUCHER ACTION="Create"><DATE>20260401</DATE><NARRATION></NARRATION></VOUCHER>`, "ab1", "TDSDesk:ab1"},
		{`<VOUCHER ACTION="Create"><DATE>20260401</DATE></VOUCHER>`, "ab1", "TDSDesk:ab1"},
		{`<VOUCHER ACTION="Create"><DATE>20260401</DATE><NARRATION>` + long + `</NARRATION></VOUCHER>`, "ab1", "TDSDesk:ab1 | " + long},
		// FinCom wrote the tag at the end (the 2.1.4 shape): moved first, nothing else lost
		{`<VOUCHER ACTION="Create"><DATE>20260401</DATE><NARRATION>Paid rent | TDSDesk:ab1</NARRATION></VOUCHER>`, "ab1", "TDSDesk:ab1 | Paid rent"},
		{`<VOUCHER ACTION="Create"><DATE>20260401</DATE><NARRATION>TDSDesk:ab1 | Paid rent</NARRATION></VOUCHER>`, "ab1", "TDSDesk:ab1 | Paid rent"},
	}
	for _, cs := range cases {
		x, tag := stampFinComID(cs.in, cs.id)
		if tag != "TDSDesk:ab1" {
			t.Errorf("tag %q for %s", tag, cs.in)
		}
		got := group(`<NARRATION>([\s\S]*?)</NARRATION>`, x, 1)
		if got != cs.want {
			t.Errorf("narration %q, want %q (from %s)", got, cs.want, cs.in)
		}
		if !strings.HasPrefix(got, tag) {
			t.Errorf("the tag is not first: %q", got)
		}
		if len(got) > 300 && !strings.Contains(got[:300], tag) {
			t.Errorf("a 300-character cut loses the tag: %q", got[:300])
		}
	}
	// the posting payload carries the tag first too
	x, _ := stampFinComID(`<VOUCHER ACTION="Create"><DATE>20260401</DATE><NARRATION>Bill 7</NARRATION></VOUCHER>`, "z9")
	if !strings.Contains(x, "<NARRATION>TDSDesk:z9 | Bill 7</NARRATION>") {
		t.Fatalf("payload narration: %s", x)
	}
}

// --- 14. the tag is found wherever it is in the narration, and only the exact id (TDSDesk:ab1 is not TDSDesk:ab12)
func TestTagFoundAnywhere(t *testing.T) {
	td := today()
	f := newStandTally(t)
	f.add(td, "Party X", "1", "TDSDesk:q1 | rent for April", "-100.00")
	f.add(td, "Party X", "2", "note: TDSDesk:q22 in the middle", "-100.00")
	f.add(td, "Party X", "3", "at the end TDSDesk:q333", "-100.00")
	standBridge(t, f, "")
	for narr, want := range map[string]string{"TDSDesk:q1 | rent": "TDSDesk:q1", "x TDSDesk:q2 y": "TDSDesk:q2", "end TDSDesk:q3": "TDSDesk:q3", "no tag": ""} {
		k := keyOfVoucher(xmlDoc("<VOUCHER><DATE>" + td + "</DATE><NARRATION>" + narr + "</NARRATION></VOUCHER>").All("VOUCHER")[0])
		if k.tag != want {
			t.Errorf("tag of %q = %q, want %q", narr, k.tag, want)
		}
	}
	for _, cs := range []struct {
		n, tag string
		want   bool
	}{{"TDSDesk:q1 | rent", "TDSDesk:q1", true}, {"x TDSDesk:q1 y", "TDSDesk:q1", true}, {"end TDSDesk:q1", "TDSDesk:q1", true},
		{"TDSDesk:q12 | rent", "TDSDesk:q1", false}, {"rent TDSDesk:q", "TDSDesk:q1", false}, {"", "TDSDesk:q1", false}, {"TDSDesk:q1", "", false}} {
		if hasTag(cs.n, cs.tag) != cs.want {
			t.Errorf("hasTag(%q, %q) = %v, want %v", cs.n, cs.tag, !cs.want, cs.want)
		}
	}
	// the tag read (findPostedTags, kept for Check Tally; round 15: no posting calls it): each tag found wherever it is; a prefix is not a match
	item := func(id, tag string) M {
		return M{"id": id, "kind": "voucher", "xml": `<VOUCHER ACTION="Create"><DATE>` + td + `</DATE><NARRATION>` + tag + ` | x</NARRATION></VOUCHER>`}
	}
	items := []M{item("a", "TDSDesk:q1"), item("b", "TDSDesk:q22"), item("c", "TDSDesk:q333"), item("d", "TDSDesk:q2"), item("e", "TDSDesk:q33")}
	found := findPostedTags(f.port, zz, items, "")
	if found == nil {
		t.Fatal("the read-back did not answer")
	}
	for id, want := range map[string]bool{"a": true, "b": true, "c": true, "d": false, "e": false} {
		if (found[id] != nil) != want {
			t.Errorf("item %s found=%v, want %v (%v)", id, found[id] != nil, want, found[id])
		}
	}
	// the duplicate check's own look for the id (sameId): the tag in the middle of a narration is found
	r := dupCheck(f.port, zz, "x2", `<VOUCHER ACTION="Create"><DATE>`+td+`</DATE><NARRATION>TDSDesk:q22 | again</NARRATION><PARTYLEDGERNAME>Party X</PARTYLEDGERNAME>`+
		`<VOUCHERNUMBER>9</VOUCHERNUMBER><ALLLEDGERENTRIES.LIST><LEDGERNAME>Party X</LEDGERNAME><AMOUNT>-55.00</AMOUNT></ALLLEDGERENTRIES.LIST></VOUCHER>`)
	if r["sameId"] != true {
		t.Fatalf("the duplicate check did not find the id in the middle of the narration: %v", r)
	}
	// (round 15, the owner's decision of 03-Oct-2026: a lost posting is never sent again; resendLost is gone. The
	// read-back and the duplicate check above are tested as reads, for Check Tally; no posting calls them)
}

// --- 18b. the measuring tool stops at the FIRST request that does not answer: nothing more is sent (the small company
// check aside), the check is waited for, and the run ends with that in the report
func TestMeasureStopsAtFirstHang(t *testing.T) {
	td := today()
	f := newStandTally(t)
	for i := 0; i < 5; i++ {
		f.add(td, "Party X", fmt.Sprint(i), "sale", "-1.00")
	}
	f.slow = func(id, body string) time.Duration {
		if id == "FinComMeasureC" {
			return 3 * time.Second // c1 hangs
		}
		return 0
	}
	standBridge(t, f, `,"TallyMaxSec":1,"TallyProbeEverySec":1`)
	r, err := runMeasure(measureOpts{company: zz, ledgers: "1-2"})
	if err != nil {
		t.Fatal(err)
	}
	rep := str(r["report"])
	t.Log("\n" + rep)
	for _, want := range []string{"\na ", "\nb ", "\nc1 ", "HANGS", "waiting for Tally to answer the company check", "stopped at the first request"} {
		if !strings.Contains(rep, want) {
			t.Errorf("the report lacks %q", want)
		}
	}
	if regexp.MustCompile(`\n(c2|d|e|f0|f\d+-\w+) `).MatchString(rep) {
		t.Fatalf("items were measured after the first hang:\n%s", rep)
	}
	// after the hang only the company check went to Tally
	f.mu.Lock()
	var after []string
	seen := false
	for _, id := range f.reqs {
		if seen {
			after = append(after, id)
		}
		if id == "FinComMeasureC" {
			seen = true
		}
	}
	f.mu.Unlock()
	for _, id := range after {
		if id != "FinComCompany" && id != "FinComFree" {
			t.Fatalf("after the hang %q was sent to Tally (only the company check may go): %v", id, after)
		}
	}
	if len(after) == 0 {
		t.Fatal("the company check was not waited for after the hang")
	}
}

// --- 18b. after the hang nothing goes to Tally until the small check answers; the run then ends
func TestMeasureWaitsForCheckAfterHang(t *testing.T) {
	td := today()
	f := newStandTally(t)
	f.add(td, "Party X", "1", "sale", "-1.00")
	var mu sync.Mutex
	hung, slowChecks := false, 0
	f.slow = func(id, body string) time.Duration {
		mu.Lock()
		defer mu.Unlock()
		if id == "FinComMeasureB" {
			hung = true
			return 3 * time.Second // b hangs
		}
		if hung && id == "FinComCompany" && slowChecks < 2 {
			slowChecks++
			return 2 * time.Second // the first two checks after the hang do not answer in time either
		}
		return 0
	}
	standBridge(t, f, `,"TallyMaxSec":1,"TallyProbeEverySec":1`)
	r, err := runMeasure(measureOpts{company: zz})
	if err != nil {
		t.Fatal(err)
	}
	rep := str(r["report"])
	t.Log("\n" + rep)
	m := regexp.MustCompile(`answered: true after (\d+) check\(s\)`).FindStringSubmatch(rep)
	if m == nil || toInt(m[1]) < 3 {
		t.Fatalf("the check was not waited for until it answered (want 3 or more checks):\n%s", rep)
	}
	f.mu.Lock()
	reqs := append([]string{}, f.reqs...)
	mx := f.maxFlight
	f.mu.Unlock()
	seen := false
	for _, id := range reqs {
		if seen && id != "FinComCompany" && id != "FinComFree" {
			t.Fatalf("%q went to Tally before the check answered / after the run should have ended: %v", id, reqs)
		}
		if id == "FinComMeasureB" {
			seen = true
		}
	}
	if mx != 1 {
		t.Fatal("more than one request at a time")
	}
	if !strings.Contains(rep, "stopped at the first request") || strings.Contains(rep, "\nc1 ") {
		t.Fatalf("the run did not end after the hang:\n%s", rep)
	}
}

// --- 18c. the measuring tool is started by a person: a web page (an Origin or Sec-Fetch header, FinCom's own
// included) is refused on both measure routes, and nothing starts
func TestMeasureNotFromHTTP(t *testing.T) {
	f := newStandTally(t)
	standBridge(t, f, `,"Key":"tray-test-key"`)
	for _, origin := range []string{"https://app.fincom.live", "http://localhost:5173", "https://evil.example"} {
		for _, p := range []string{"/measure", "/tray/measure"} {
			for _, method := range []string{"POST", "GET"} {
				code, res := callLocal(t, method, p, origin, `{"company":"ZZ TEST"}`)
				if code != 403 {
					t.Fatalf("%s %s from the web page %s: %d %v (want 403)", method, p, origin, code, res)
				}
			}
		}
	}
	// a browser request without an Origin header still carries Sec-Fetch headers
	code, res := callLocalHeaders(t, "POST", "/measure", map[string]string{"Sec-Fetch-Mode": "cors", "Sec-Fetch-Site": "same-site"}, `{"company":"ZZ TEST"}`)
	if code != 403 {
		t.Fatalf("POST /measure with Sec-Fetch headers: %d %v (want 403)", code, res)
	}
	if st := measureStatus(); str(st["state"]) != "none" {
		t.Fatalf("a web page started the measuring tool: %v", st)
	}
	if f.n("FinComCompany") != 0 || f.n("FinComMeasureB") != 0 {
		t.Fatal("a web page's request reached Tally")
	}
	// the measure command (a console program on this computer: no Origin, no Sec-Fetch) is answered
	if code, res := callLocal(t, "GET", "/measure", "", ""); code != 200 || str(res["state"]) != "none" {
		t.Fatalf("GET /measure from the console: %d %v", code, res)
	}
}

// --- 18c, round 5 (C4): TestMeasureRefusedAsService was dropped. There is no start of the measuring tool that is not
// tray- or console-originated (nothing in the bridge's own loops calls runMeasure), and under the Windows service the
// tray is a program of its own calling the service's web server, so a service-mode refusal would only break the tray's
// Measure Tally item. See TestMeasureFromTrayUnderService (round5_test.go).

// a request to the bridge's web server with the given headers (a browser sends Sec-Fetch headers even without an Origin)
func callLocalHeaders(t *testing.T, method, path string, headers map[string]string, body string) (int, M) {
	t.Helper()
	r := httptest.NewRequest(method, "http://127.0.0.1:9100"+path, strings.NewReader(body))
	r.Header.Set("X-Bridge-Key", cfgS("Key"))
	r.Header.Set("Content-Type", "application/json")
	for k, v := range headers {
		r.Header.Set(k, v)
	}
	w := httptest.NewRecorder()
	handle(w, r)
	return w.Code, parseObj(w.Body.String())
}
