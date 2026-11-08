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

// --- the review of next-bridge-258 (findings 1-4)

// emptyAnswer: a stand-in Tally's company list answered with no company while on is set
func emptyAnswer(f *standTally, on *atomic.Bool) {
	f.mu.Lock()
	f.behave = func(w http.ResponseWriter, r *http.Request, id, body string) bool {
		if id == "TDSDeskCompanies" && on.Load() {
			_, _ = w.Write([]byte("<ENVELOPE><BODY><DATA><COLLECTION></COLLECTION></DATA></BODY></ENVELOPE>"))
			return true
		}
		return false
	}
	f.mu.Unlock()
}

func drainBeat() {
	for {
		select {
		case <-beatNow:
		default:
			return
		}
	}
}

func beatSent() bool {
	select {
	case <-beatNow:
		return true
	default:
		return false
	}
}

// review 1: two Tallys of this login (the owner's server has several TallyPrime installs), one naming a company, one
// at Select Company: only the empty one is asked on the short age; the other keeps its 10 minutes; nothing is logged and
// no beat is sent until the empty one names a company
func TestR258TwoTallysOnlyTheEmptyOneAskedSoon(t *testing.T) {
	a, b := newStandTally(t), newStandTally(t)
	standBridge(t, a, "")
	r253Server(t, `{"pid": 10, "name": "tally", "session": 1}, {"pid": 11, "name": "tally", "session": 1}`,
		fmt.Sprintf(`{"port": %d, "pid": 10}, {"port": %d, "pid": 11}`, a.port, b.port))
	var empty atomic.Bool
	empty.Store(true)
	emptyAnswer(b, &empty)
	oldTyping := keepTypingFn
	keepTypingFn = func() bool { return false }
	t.Cleanup(func() { keepTypingFn, nowFn = oldTyping, time.Now })
	base := time.Now()
	tick := func(sec int) []M {
		nowFn = func() time.Time { return base.Add(time.Duration(sec) * time.Second) }
		return lightCompanyList(openCompaniesCachedOnce(false))
	}
	_ = tick(0)
	a0, b0 := a.n("TDSDeskCompanies"), b.n("TDSDeskCompanies")
	if a0 != 1 || b0 != 1 {
		t.Fatalf("the first look: %d and %d asked", a0, b0)
	}
	drainBeat()
	for sec := 30; sec < 9*60; sec += 30 {
		_ = tick(sec)
	}
	if a.n("TDSDeskCompanies") != a0 {
		t.Fatalf("the Tally naming a company was asked %d more times in 9 minutes (it keeps its 10)", a.n("TDSDeskCompanies")-a0)
	}
	if n := b.n("TDSDeskCompanies") - b0; n < 10 {
		t.Fatalf("the empty Tally was asked again %d times in 9 minutes (the short age)", n)
	}
	if logLines("Tally names a company now") != 0 || beatSent() {
		t.Fatal("logged or beat as if a company appeared, while the empty Tally still names none")
	}
	b.mu.Lock()
	b.coName = "ZZ SECOND"
	b.mu.Unlock()
	empty.Store(false)
	nb := b.n("TDSDeskCompanies")
	got := tick(9*60 + 30)
	if b.n("TDSDeskCompanies") != nb+1 || a.n("TDSDeskCompanies") != a0 {
		t.Fatalf("at the next turn: %d / %d asked", a.n("TDSDeskCompanies")-a0, b.n("TDSDeskCompanies")-nb)
	}
	names := map[string]bool{}
	for _, n := range r258Names(got) {
		names[n] = true
	}
	if !names[zz] || !names["ZZ SECOND"] || logLines("Tally names a company now") != 1 || !beatSent() {
		t.Fatalf("the company opened in the second Tally: %v, logged %d", r258Names(got), logLines("Tally names a company now"))
	}
	// both name a company now: the next ask is at 10 minutes, of both
	for sec := 10 * 60; sec < 20*60; sec += 30 {
		_ = tick(sec)
	}
	if a.n("TDSDeskCompanies") != a0+1 || b.n("TDSDeskCompanies") != nb+2 {
		t.Fatalf("after both name one: %d / %d asked in 10 minutes (want one each)", a.n("TDSDeskCompanies")-a0, b.n("TDSDeskCompanies")-nb-1)
	}
}

// review 1: only a port that ANSWERED with no company is on the short age: not one that failed or is only open (its
// earlier answer named a company, or it never answered), nor another user's
func TestR258EmptyPortsOnlyAnsweredEmpty(t *testing.T) {
	resetAsks()
	t.Cleanup(func() { nowFn = time.Now; resetAsks() })
	base := time.Now()
	nowFn = func() time.Time { return base }
	noteAsked(9001, 1, true)  // answered with no company
	noteAsked(9002, 2, false) // named one; now open with none held (its last ask failed)
	open := func(port int, mine any) M { return M{"port": port, "ok": true, "mine": mine, "companies": []any{}} }
	ss := []M{open(9001, true), open(9002, true), open(9003, true), open(9004, true), open(9005, false)}
	held := []M{{"port": 9003, "ok": false, "error": "Tally did not answer", "companies": []any{}},
		{"port": 9004, "ok": true, "error": "", "companies": []any{}}}
	got := emptyPorts(ss, held, base.Add(-time.Minute))
	if _, ok := got[9001]; !ok || len(got) != 2 {
		t.Fatalf("on the short age: %v (want 9001, and 9004 that answered with none before this run)", got)
	}
	if _, ok := got[9004]; !ok {
		t.Fatalf("a Tally that answered with none before this run: %v", got)
	}
	if d := got[9001].Sub(base); d != 25*time.Second {
		t.Fatalf("due after %s", d)
	}
}

// review 2: the short re-asks give way to typing in Tally after the lock is taken; the first check of a company that
// just appeared waits while someone types
func TestR258TypingAfterTheLock(t *testing.T) {
	f, empty := r258Stand(t)
	empty.Store(true)
	var typing atomic.Bool
	keepTypingFn = typing.Load
	typing.Store(true)
	_, _ = openCompaniesAsk(bgListTC(nil), true)
	if f.n("") != 0 {
		t.Fatalf("asked while someone types: %v", f.ids())
	}
	typing.Store(false)
	_ = os.Remove(filepath.Join(syncDir(), "open-companies.json"))
	coMu.Lock()
	coCache = nil
	coMu.Unlock()
	// the empty answer, then the company opened; the person starts typing right after Tally gave the list
	base := time.Now()
	nowFn = func() time.Time { return base }
	lightCheckOpen(openCompaniesCachedOnce(false))
	empty.Store(false)
	f.mu.Lock()
	old := f.behave
	f.behave = func(w http.ResponseWriter, r *http.Request, id, body string) bool {
		if id == "TDSDeskCompanies" {
			defer typing.Store(true)
		}
		return old(w, r, id, body)
	}
	f.mu.Unlock()
	nowFn = func() time.Time { return base.Add(30 * time.Second) }
	n0 := f.n("FinComCompany")
	lightCheckOpen(openCompaniesCachedOnce(false))
	if f.n("FinComCompany") != n0 || f.n("TDSDeskCompanyInfo") != 0 {
		t.Fatalf("the company's first check went while someone types: %v", f.ids())
	}
	if logLines("someone is typing in Tally (the check goes after it)") == 0 {
		t.Fatalf("the skip is not in the log: %s", readText(logFile()))
	}
	typing.Store(false)
	nowFn = func() time.Time { return base.Add(60 * time.Second) }
	lightCheckOpen(openCompaniesCachedOnce(false))
	if f.n("FinComCompany") != n0+1 {
		t.Fatalf("the check did not go once the typing stopped: %v", f.ids())
	}
}

// review 3: a Check again held (a posting) keeps the background's minute; after no answer in 2 s the next press does
// not ask that Tally again during its wait (one 2 s ask a press at most)
func TestR258CheckAgainHeldAndColistHold(t *testing.T) {
	f, empty := r258Stand(t)
	empty.Store(true)
	at := time.Now().Add(-10 * time.Second).UnixNano()
	askAfreshAt.Store(at)
	importsInFlight.Add(1)
	_ = personCheckNow()
	importsInFlight.Add(-1)
	if askAfreshAt.Load() != at {
		t.Fatal("a held Check again reset the background's minute")
	}
	f.mu.Lock()
	f.slow = func(id, body string) time.Duration {
		if id == "TDSDeskCompanies" {
			return 3 * time.Second
		}
		return 0
	}
	f.mu.Unlock()
	start := time.Now()
	_ = personCheckNow()
	if took := time.Since(start); took > 3500*time.Millisecond {
		t.Fatalf("a press waited %s", took)
	}
	n := f.n("TDSDeskCompanies")
	_ = personCheckNow()
	if f.n("TDSDeskCompanies") != n {
		t.Fatal("a Tally that did not answer in 2 s was asked again at the next press, within its wait")
	}
}

// review 4: a port that opened is asked once, not again by the light check in the same beat
func TestR258ReopenAskedOnceInTheBeat(t *testing.T) {
	f, _ := r258Stand(t)
	_, _ = openCompaniesAsk(bgCompaniesTC(), true)
	shared := filepath.Join(syncDir(), "open-companies.json")
	held := sessionsFromFile(shared)
	for _, e := range held {
		if toInt(e["port"]) == f.port {
			e["ok"], e["companies"], e["tallyState"], e["reason"] = false, []any{}, "closed", "closed"
		}
	}
	_ = saveFile(shared, jsonText(held))
	coMu.Lock()
	coCache = nil
	coMu.Unlock()
	later := time.Now().Add(11 * time.Minute) // the list's 10 minutes passed too
	nowFn = func() time.Time { return later }
	n0 := f.n("TDSDeskCompanies")
	ss := openCompaniesCached() // the beat: the port that opened, asked at once
	_ = lightCompanyList(ss)    // its light check in the same beat
	if f.n("TDSDeskCompanies") != n0+1 {
		t.Fatalf("asked %d times in one beat", f.n("TDSDeskCompanies")-n0)
	}
}
