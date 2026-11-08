package main

// Bridge 2.5.8 (nocompany258.go): a company opened in Tally after Tally answered the company list with none shows in
// FinCom within about 30 s, not up to 10 minutes later. Only the light company list (TDSDeskCompanies) is asked, under
// its rules: 2 s at most, one in flight, postings first, never while someone is typing in Tally. Made-up company names.

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"
)

// a stand-in Tally whose company list is empty while empty is set (Tally started, no company loaded yet)
func r258Stand(t *testing.T) (*standTally, *atomic.Bool) {
	t.Helper()
	f := newStandTally(t)
	standBridge(t, f, "")
	var empty atomic.Bool
	f.mu.Lock()
	f.behave = func(w http.ResponseWriter, r *http.Request, id, body string) bool {
		if id == "TDSDeskCompanies" && empty.Load() {
			_, _ = w.Write([]byte("<ENVELOPE><BODY><DATA><COLLECTION></COLLECTION></DATA></BODY></ENVELOPE>"))
			return true
		}
		return false
	}
	f.mu.Unlock()
	oldAsk, oldTyping := askAfreshFn, keepTypingFn
	askAfreshFn = func() { openCompaniesAsk(bgCompaniesTC(), true) }
	keepTypingFn = func() bool { return false }
	askAfreshAt.Store(0)
	_ = os.Remove(filepath.Join(syncDir(), "open-companies.json"))
	coMu.Lock()
	coCache = nil
	coMu.Unlock()
	t.Cleanup(func() { askAfreshFn, keepTypingFn, nowFn = oldAsk, oldTyping, time.Now; retryReset() })
	return f, &empty
}

func r258Names(ss []M) []string {
	var o []string
	for _, s := range ss {
		if s["skipped"] == true || s["ok"] != true {
			continue
		}
		for _, c := range sessCompanies(s) {
			o = append(o, str(c["name"]))
		}
	}
	return o
}

func r258Port(t *testing.T, port int) M {
	t.Helper()
	_, ports, _, _ := beatParts(openCompaniesCachedOnce(false))
	for _, x := range ports {
		if p := obj(x); p != nil && toInt(p["port"]) == port {
			return p
		}
	}
	t.Fatalf("port %d not in the beat: %s", port, jsonText(ports))
	return nil
}

// 1: Tally answers with no company; a company opened 15 s later is seen at the next 30 s turn (it was 10 minutes), and
// the beat says when Tally answered and what it named
func TestR258EmptyListAskedAgainWithin30s(t *testing.T) {
	f, empty := r258Stand(t)
	empty.Store(true)
	base := time.Now()
	tick := func(sec int) []M {
		nowFn = func() time.Time { return base.Add(time.Duration(sec) * time.Second) }
		return lightCompanyList(openCompaniesCachedOnce(false))
	}
	n0 := f.n("TDSDeskCompanies")
	if got := tick(0); len(r258Names(got)) != 0 || f.n("TDSDeskCompanies") != n0+1 {
		t.Fatalf("the first look: %v, %d asked", r258Names(got), f.n("TDSDeskCompanies")-n0)
	}
	if p := r258Port(t, f.port); p["list"] != "empty" || str(p["askedAt"]) == "" {
		t.Fatalf("the beat's port after an empty answer: %s", jsonText(p))
	}
	_ = tick(10) // 10 s: not asked yet
	if f.n("TDSDeskCompanies") != n0+1 {
		t.Fatal("asked again after 10 s")
	}
	empty.Store(false) // the company opened in Tally at 15 s
	got := tick(30)
	if f.n("TDSDeskCompanies") != n0+2 || len(r258Names(got)) != 1 || r258Names(got)[0] != zz {
		t.Fatalf("the company opened since was not seen at the 30 s turn: %v (%d asked)", r258Names(got), f.n("TDSDeskCompanies")-n0)
	}
	if p := r258Port(t, f.port); p["list"] != "named" {
		t.Fatalf("the beat's port once Tally names the company: %s", jsonText(p))
	}
	if logLines("Company list: Tally names a company now (it named none before)") != 1 {
		t.Fatalf("the log does not say it: %s", readText(logFile()))
	}
	for _, id := range f.ids() {
		if id != "TDSDeskCompanies" && id != "TDSDeskCompanyInfo" {
			t.Fatalf("another request went: %v", f.ids())
		}
	}
}

// 1: while it stays empty: every 30 s for 3 minutes, then every minute, then every 2 minutes; never more often
func TestR258EmptyListEases(t *testing.T) {
	f, empty := r258Stand(t)
	empty.Store(true)
	base := time.Now()
	var at []int
	for sec := 0; sec <= 16*60; sec += 30 {
		nowFn = func() time.Time { return base.Add(time.Duration(sec) * time.Second) }
		n := f.n("TDSDeskCompanies")
		_ = lightCompanyList(openCompaniesCachedOnce(false))
		if f.n("TDSDeskCompanies") > n {
			at = append(at, sec)
		}
	}
	for i := 1; i < len(at); i++ {
		gap, want := at[i]-at[i-1], 30
		switch {
		case at[i-1] >= 10*60:
			want = 120
		case at[i-1] >= 3*60:
			want = 60
		}
		if gap != want && !(at[i-1] < 3*60 && at[i] > 3*60 && gap == 60) && !(at[i-1] < 10*60 && at[i] > 10*60 && gap == 120) {
			t.Fatalf("asked at %v s: the gap after %d s is %d s (want %d)", at, at[i-1], gap, want)
		}
	}
	if len(at) < 15 || len(at) > 20 {
		t.Fatalf("asked %d times in 16 minutes: %v", len(at), at)
	}
}

// 1: a list naming a company keeps its 10 minutes
func TestR258NamedListKeepsTenMinutes(t *testing.T) {
	f, _ := r258Stand(t)
	base := time.Now()
	n0 := f.n("TDSDeskCompanies")
	for sec := 0; sec < 10*60; sec += 30 {
		nowFn = func() time.Time { return base.Add(time.Duration(sec) * time.Second) }
		_ = lightCompanyList(openCompaniesCachedOnce(false))
	}
	if f.n("TDSDeskCompanies") != n0+1 {
		t.Fatalf("a list naming a company was asked %d times in 10 minutes (want once)", f.n("TDSDeskCompanies")-n0)
	}
	nowFn = func() time.Time { return base.Add(10*time.Minute + time.Second) }
	_ = lightCompanyList(openCompaniesCachedOnce(false))
	if f.n("TDSDeskCompanies") != n0+2 {
		t.Fatal("not asked again at 10 minutes")
	}
}

// 1: the gates: nothing is asked while a posting runs or someone types in Tally; asked at the turn after
func TestR258EmptyListGates(t *testing.T) {
	f, empty := r258Stand(t)
	empty.Store(true)
	base := time.Now()
	nowFn = func() time.Time { return base }
	_ = lightCompanyList(openCompaniesCachedOnce(false))
	n0, c0 := f.n(""), f.n("TDSDeskCompanies")
	nowFn = func() time.Time { return base.Add(40 * time.Second) }
	importsInFlight.Add(1)
	lightCheckOpen(openCompaniesCachedOnce(false)) // the beat's light check
	_ = personCheckNow()                           // a Check again
	importsInFlight.Add(-1)
	if f.n("") != n0 {
		t.Fatalf("asked while a posting runs: %v", f.ids()[n0:])
	}
	keepTypingFn = func() bool { return true }
	_ = lightCompanyList(openCompaniesCachedOnce(false))
	_ = personCheckNow()
	if f.n("") != n0 {
		t.Fatalf("asked while someone types in Tally: %v", f.ids()[n0:])
	}
	keepTypingFn = func() bool { return false }
	_ = lightCompanyList(openCompaniesCachedOnce(false))
	if f.n("TDSDeskCompanies") != c0+1 || f.n("") != n0+1 {
		t.Fatalf("not asked once the gates opened: %v", f.ids()[n0:])
	}
}

// 2: a port the list held as closed takes a connection now: asked at once (the minute's wait not kept), not the old list
func TestR258ClosedPortOpenAskedAtOnce(t *testing.T) {
	f, _ := r258Stand(t)
	_, _ = openCompaniesAsk(bgCompaniesTC(), true) // (a background ask: a person's would hold the next background one 4 s)
	shared := filepath.Join(syncDir(), "open-companies.json")
	held := sessionsFromFile(shared)
	for _, e := range held {
		if toInt(e["port"]) == f.port {
			e["ok"], e["companies"], e["tallyState"], e["reason"], e["error"] = false, []any{}, "closed", "closed", "Tally is not open (nothing listening on this port)"
		}
	}
	_ = saveFile(shared, jsonText(held))
	coMu.Lock()
	coCache = nil
	coMu.Unlock()
	askAfreshAt.Store(time.Now().UnixNano()) // a background ask a moment ago
	n0 := f.n("TDSDeskCompanies")
	got := openCompaniesCached()
	if f.n("TDSDeskCompanies") != n0+1 || len(r258Names(got)) != 1 {
		t.Fatalf("a closed port open now: %d asked, %v", f.n("TDSDeskCompanies")-n0, r258Names(got))
	}
	// the list matches now: the beat asks nothing more
	_ = openCompaniesCached()
	if f.n("TDSDeskCompanies") != n0+1 {
		t.Fatal("asked again with the list matching")
	}
	// a posting going: nothing is sent (the ask gives way)
	_ = saveFile(shared, jsonText(held))
	askAfreshAt.Store(0)
	importsInFlight.Add(1)
	_ = openCompaniesCached()
	importsInFlight.Add(-1)
	if f.n("TDSDeskCompanies") != n0+1 {
		t.Fatal("asked while a posting runs")
	}
}

// 2: another Tally program holds the port now than the one that answered last: asked at once
func TestR258OtherProcessAskedAtOnce(t *testing.T) {
	mine := newStandTally(t)
	standBridge(t, mine, "")
	r253Server(t, `{"pid": 10, "name": "tally", "session": 1}`, fmt.Sprintf(`{"port": %d, "pid": 10}`, mine.port))
	resetAsks()
	_, _ = openCompaniesAsk(bgCompaniesTC(), true)
	if n, ok := askNoteOf(mine.port); !ok || n.pid != 10 {
		t.Fatalf("the answer's program not noted: %+v %v", n, ok)
	}
	askAfreshAt.Store(time.Now().UnixNano())
	n0 := mine.n("TDSDeskCompanies")
	_ = openCompaniesCached()
	if mine.n("TDSDeskCompanies") != n0 {
		t.Fatal("asked with the same program on the port")
	}
	noteAsked(mine.port, 9, false) // the last answer came from another program (Tally restarted since)
	_ = openCompaniesCached()
	if mine.n("TDSDeskCompanies") != n0+1 {
		t.Fatalf("another program on the port: %d asked", mine.n("TDSDeskCompanies")-n0)
	}
}

// 3: Check again on this computer (/status?fresh=1) asks Tally now, every press (never a list up to 30 s old), one at a time
func TestR258CheckAgainAsksNow(t *testing.T) {
	f, empty := r258Stand(t)
	empty.Store(true)
	status := func() M {
		qs := url.Values{"fresh": {"1"}}
		res, err := route(httptest.NewRecorder(), httptest.NewRequest("GET", "/status?fresh=1", nil), "/status", qs, "", "")
		if err != nil {
			t.Fatal(err)
		}
		return res.(M)
	}
	n0 := f.n("TDSDeskCompanies")
	_ = status()
	if f.n("TDSDeskCompanies") != n0+1 {
		t.Fatal("Check again did not ask Tally")
	}
	empty.Store(false) // the company opened a moment later
	st := status()
	if f.n("TDSDeskCompanies") != n0+2 {
		t.Fatal("a second Check again within 30 s did not ask Tally (the list held was shown)")
	}
	ss, _ := st["sessions"].([]M)
	if names := r258Names(ss); len(names) != 1 || names[0] != zz {
		t.Fatalf("Check again's answer: %v", names)
	}
	for _, s := range ss {
		if toInt(s["port"]) == f.port && (s["list"] != "named" || str(s["askedAt"]) == "") {
			t.Fatalf("the status's port: %s", jsonText(s))
		}
	}
	// the plain status (the minute's look, the beat) asks nothing
	_, _ = route(httptest.NewRecorder(), httptest.NewRequest("GET", "/status", nil), "/status", url.Values{}, "", "")
	if f.n("TDSDeskCompanies") != n0+2 {
		t.Fatal("the plain status asked Tally")
	}
	// two presses at once: one ask
	f.mu.Lock()
	f.slow = func(id, body string) time.Duration {
		if id == "TDSDeskCompanies" {
			return 300 * time.Millisecond
		}
		return 0
	}
	f.mu.Unlock()
	done := make(chan struct{})
	go func() { _ = personCheckNow(); close(done) }()
	time.Sleep(50 * time.Millisecond)
	_ = personCheckNow()
	<-done
	if f.n("TDSDeskCompanies") != n0+3 {
		t.Fatalf("two presses at once asked %d times", f.n("TDSDeskCompanies")-n0-2)
	}
}

// 4: the beat's port before any answer in this run: never asked
func TestR258BeatNeverAsked(t *testing.T) {
	f, _ := r258Stand(t)
	if p := r258Port(t, f.port); p["list"] != "never" || str(p["askedAt"]) != "" {
		t.Fatalf("before any answer: %s", jsonText(p))
	}
}
