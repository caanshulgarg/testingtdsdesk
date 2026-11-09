// FinCom Bridge 2.5.4: the update's state in the beat; Windows' lists read once and shared; tally.ini's connection
// never written in a file every user shares; "your Tally's connection is off" ranked first; a Tally's owner settled by
// its Windows user before any port tie; the company list 2 s at most with a wait after a slow one; the update never in
// the middle of a posting, its checks spread out, the tray never waiting for a download
package main

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// under go test the shared-computer look is never kept from one test to the next (review M1: a hook, not package testing)
func init() { sharedKeep = 0 }

// --- fix 1: the update's state in the beat, small
func TestR254BeatCarriesUpdateState(t *testing.T) {
	f := newStandTally(t)
	standBridge(t, f, "")
	setUpd("checked", "2026-11-04T10:00:00")
	setUpd("latest", "2.5.9")
	setUpd("message", "Version 2.5.9 is available but not approved for this computer yet ("+strings.Repeat("x", 400)+")")
	setCfg("NoAutoUpdate", true)
	t.Cleanup(func() {
		setCfg("NoAutoUpdate", false)
		setUpd("message", "")
		setUpd("latest", "")
		setUpd("checked", "")
	})
	b := beatBody(false, "closed", "", nil, nil, nil)
	u := obj(b["update"])
	if u == nil || str(u["checked"]) != "2026-11-04T10:00:00" || str(u["offered"]) != "2.5.9" || u["noAutoUpdate"] != true {
		t.Fatalf("beat update: %v", u)
	}
	if n := len([]rune(str(u["message"]))); n == 0 || n > 200 {
		t.Fatalf("message length %d", n)
	}
	if len(jsonText(u)) > 600 {
		t.Fatalf("the beat's update part is not small: %d bytes", len(jsonText(u)))
	}
	if b["autoUpdate"] != false {
		t.Fatalf("autoUpdate with NoAutoUpdate: %v", b["autoUpdate"])
	}
}

// --- fix 2: one read shared, never an older one than asked, a failed read not kept
func TestR254SnapCacheShared(t *testing.T) {
	r254Bridge(t)
	var reads atomic.Int32
	clock := time.Now()
	var cmu sync.Mutex
	c := newSnapCache(func() (int, bool) { reads.Add(1); time.Sleep(20 * time.Millisecond); return int(reads.Load()), true })
	c.now = func() time.Time { cmu.Lock(); defer cmu.Unlock(); return clock }
	var wg sync.WaitGroup
	for i := 0; i < 50; i++ {
		wg.Add(1)
		go func() { defer wg.Done(); c.get(time.Time{}) }()
	}
	wg.Wait()
	if reads.Load() != 1 {
		t.Fatalf("50 callers at once: %d reads, want 1", reads.Load())
	}
	// a caller whose connection came after the read: a new read
	cmu.Lock()
	clock = clock.Add(100 * time.Millisecond)
	cmu.Unlock()
	if v, _ := c.get(clock); v != 2 || reads.Load() != 2 {
		t.Fatalf("notBefore after the held read: %d reads", reads.Load())
	}
	// older than the time to keep: read again
	cmu.Lock()
	clock = clock.Add(snapTTL)
	cmu.Unlock()
	c.get(time.Time{})
	if reads.Load() != 3 {
		t.Fatalf("after %v: %d reads", snapTTL, reads.Load())
	}
	// within it: held
	c.get(time.Time{})
	if reads.Load() != 3 {
		t.Fatalf("held: %d reads", reads.Load())
	}
	// a failed read is not kept
	bad := newSnapCache(func() (int, bool) { reads.Add(1); return 0, false })
	bad.get(time.Time{})
	bad.get(time.Time{})
	if reads.Load() != 5 {
		t.Fatalf("failed reads kept: %d", reads.Load())
	}
}

// /ping's user and session checks are given the connection's accept time (the table they look in is one taken after it)
func TestR254PingChecksGetAcceptTime(t *testing.T) {
	r254Bridge(t)
	oldU, oldS := peerUserOf, peerSessionOf
	t.Cleanup(func() { peerUserOf, peerSessionOf = oldU, oldS })
	var mu sync.Mutex
	var got []time.Time
	peerUserOf = func(local, remote int, nb time.Time) (string, bool, error) {
		mu.Lock()
		got = append(got, nb)
		mu.Unlock()
		return "", false, nil
	}
	peerSessionOf = func(local, remote int, nb time.Time) (int, bool) {
		mu.Lock()
		got = append(got, nb)
		mu.Unlock()
		return 0, false
	}
	before := time.Now()
	srv := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fromOwnUser(r)
		sameSessionOf(r)
		w.WriteHeader(204)
	}))
	srv.Config.ConnContext = withAcceptTime
	srv.Start()
	defer srv.Close()
	if _, err := http.Get(srv.URL + "/ping"); err != nil {
		t.Fatal(err)
	}
	mu.Lock()
	defer mu.Unlock()
	if len(got) != 2 || got[0].Before(before) || got[0] != got[1] || got[0].After(time.Now()) {
		t.Fatalf("accept times: %v (before %v)", got, before)
	}
	// a request without one (not through the server): now, so a fresh table
	r := httptest.NewRequest("GET", "/ping", nil)
	if a := acceptedAt(r); time.Since(a) > time.Second {
		t.Fatalf("no accept time: %v", a)
	}
}

// --- fix 3: a tally.ini every user of the computer shares: the connection settings are not written
func TestR254SharedIniNotWritten(t *testing.T) {
	f := newStandTally(t)
	standBridge(t, f, "")
	orig := "[Tally]\r\nUser TDL = Yes\r\nTDL = " + addonIniPath() + "\r\nClient Server = Client\r\n"
	_, p := r253Ini(t, orig)
	old := iniSharedFn
	iniSharedFn = func() bool { return true }
	t.Cleanup(func() { iniSharedFn = old })
	e, err := tallyIniApply(p, addonIniPath())
	if err != nil || str(e["connect"]) != connectSharedOff {
		t.Fatalf("apply: %v %v", e, err)
	}
	if got := r253Read(t, p); got != orig {
		t.Fatalf("the shared file was changed:\n%s", got)
	}
	if _, err := os.Stat(p + ".fincom-bak"); err == nil {
		t.Fatal("a backup was made though nothing was written")
	}
	if str(e["connectWhy"]) != connectWhyShared || str(e["why"]) != connectWhyShared || e["serverPort"] != nil {
		t.Fatalf("words: %v", e)
	}
	// the restart words are never given on a shared computer, even for a file switched on earlier (by 2.5.3)
	on := M{"connect": connectEnabled, "connectAt": nowFn().Format(time.RFC3339)}
	if say := tallyConnectSay("no Tally running in this login", []any{on}); say != "" {
		t.Fatalf("shared computer: %q", say)
	}
	iniSharedFn = func() bool { return false }
	if say := tallyConnectSay("no Tally running in this login", []any{on}); say != connectSay {
		t.Fatalf("one person's computer: %q", say)
	}
}

// a shared file with the add-on line missing: only the add-on line is added (2.4.5), never the connection
func TestR254SharedIniAddonOnly(t *testing.T) {
	f := newStandTally(t)
	standBridge(t, f, "")
	_, p := r253Ini(t, "[Tally]\r\nUser TDL = Yes\r\nClient Server = None\r\n")
	old := iniSharedFn
	iniSharedFn = func() bool { return true }
	t.Cleanup(func() { iniSharedFn = old })
	e, err := tallyIniApply(p, addonIniPath())
	got := r253Read(t, p)
	if err != nil || str(e["state"]) != "added" || str(e["connect"]) != connectSharedOff || !strings.Contains(got, "Client Server = None") || strings.Contains(got, "ServerPort") {
		t.Fatalf("apply: %v %v\n%s", e, err, got)
	}
}

// "cannot write" has plain words in the beat
func TestR254CannotWriteWords(t *testing.T) {
	f := newStandTally(t)
	standBridge(t, f, "")
	_, p := r253Ini(t, "[Tally]\r\nUser TDL = Yes\r\nTDL = "+addonIniPath()+"\r\nClient Server = None\r\n")
	iniWritableFn = func(string) error { return os.ErrPermission }
	e, _ := tallyIniApply(p, addonIniPath())
	if str(e["connect"]) != connectCannotWrite || str(e["connectWhy"]) != connectWhyCannotWrite || !strings.Contains(str(e["why"]), "F1 Help > Settings > Connectivity") {
		t.Fatalf("cannot write: %v", e)
	}
	for _, w := range []string{connectWhyCannotWrite, connectWhyShared, connOffWordsMode, fmt.Sprintf(connOffWordsPort, 65535), connOffWordsReopen} {
		if n := len([]rune(w)); n > 200 {
			t.Fatalf("%d letters (FinCom keeps 200): %s", n, w)
		}
	}
}

// another login's Tally running makes the computer shared
func TestR254SharedByAnotherLoginsTally(t *testing.T) {
	r254Bridge(t)
	r253Server(t, `{"pid": 20, "name": "tally", "session": 2}`, `{"port": 9000, "pid": 20}`)
	if !sharedComputerNow() {
		t.Fatal("hemant's Tally runs: shared")
	}
	r253Server(t, `{"pid": 10, "name": "tally", "session": 1}`, `{"port": 9000, "pid": 10}`)
	if sharedComputerNow() {
		t.Fatal("only this login's Tally: not shared")
	}
}

// --- fix 4: this login's Tally takes no connection: said above "another user" and "owner unknown"
func TestR254ConnectionOffRanked(t *testing.T) {
	r254Bridge(t)
	old := connOffFn
	t.Cleanup(func() { connOffFn = old })
	connOffFn = func([]any) (bool, string, M) { return true, connOffWordsMode, nil }
	cases := []struct {
		ports []any
		want  string
	}{
		{[]any{M{"port": 9000, "reason": "another user", "skipped": true}}, whyConnOff},
		{[]any{M{"port": 9070, "reason": "owner unknown"}}, whyConnOff},
		{[]any{M{"port": 9000, "reason": "closed"}}, whyConnOff},
		{[]any{M{"port": 9070, "reason": "not answering"}}, "not answering"},
		{[]any{M{"port": 9070, "reason": "open", "ok": true}}, ""},
	}
	for i, c := range cases {
		if got := tallyWhy(c.ports); got != c.want {
			t.Fatalf("case %d: %q, want %q", i, got, c.want)
		}
	}
	if say := tallyConnectSay(tallyWhy(cases[0].ports), nil); say != connOffWordsMode {
		t.Fatalf("say %q", say)
	}
	connOffFn = func([]any) (bool, string, M) { return false, "", nil }
	if got := tallyWhy(cases[0].ports); got != "another user" {
		t.Fatalf("not off: %q", got)
	}
}

// the rule itself on Windows' lists: this login's Tally running with no port, and why
func TestR254ConnectionOffFromWindows(t *testing.T) {
	r254Bridge(t)
	dir := t.TempDir()
	write := func(body string) string {
		_ = os.WriteFile(filepath.Join(dir, "tally.ini"), []byte(body), 0o644)
		return strings.ReplaceAll(filepath.Join(dir, "tally.exe"), `\`, `\\`)
	}
	exe := write("[Tally]\r\nClient Server = Client\r\n")
	// durgesh's Tally (session 1) listens nowhere; hemant's (session 2) has 9000
	procs := fmt.Sprintf(`{"pid": 10, "name": "tally", "session": 1, "path": %q}, {"pid": 20, "name": "tally", "session": 2}`, exe)
	r253Server(t, procs, `{"port": 9000, "pid": 20}`)
	// 2.5.11 (owntally2511.go): the words say the mode, the port taken by another user's Tally (with this login's own port), and
	// nothing listening on its port ("close and reopen" only when tally.ini changed after the Tally started: r2511_test.go)
	if off, w, _ := connOffNow(nil); !off || w != offWordsMode {
		t.Fatalf("acts as Client: %v %q", off, w)
	}
	write("[Tally]\r\nClient Server = Both\r\nServer Port = 9000\r\n")
	if off, w, d := connOffNow(nil); !off || !strings.HasPrefix(w, "Your TallyPrime's port 9000 is used by hemant's Tally: set your own port ") || d["reason"] != offClash {
		t.Fatalf("port taken: %v %q", off, w)
	}
	write("[Tally]\r\nClient Server = Both\r\nServer Port = 9070\r\n")
	if off, w, _ := connOffNow(nil); !off || w != fmt.Sprintf(offWordsClosed, 9070, 9070) {
		t.Fatalf("set, not on: %v %q", off, w)
	}
	// the beat: hemant's port is "another user", but the reason given is this login's connection
	_, plan := portPlan()
	var ports []any
	for _, pp := range plan {
		e := planEntry(pp)
		e["reason"] = portReason(e)
		if e["skipped"] != true {
			e["reason"] = "closed"
		}
		ports = append(ports, e)
	}
	if why := tallyWhy(ports); why != whyConnOff {
		t.Fatalf("tallyWhy %q (ports %v)", why, ports)
	}
	// this login's Tally listening: not off
	r253Server(t, fmt.Sprintf(`{"pid": 10, "name": "tally", "session": 1, "path": %q}`, exe), `{"port": 9070, "pid": 10}`)
	if off, _, _ := connOffNow(nil); off {
		t.Fatal("listening: not off")
	}
	// no Tally in this login: not off (the reason stays "no Tally running in this login")
	r253Server(t, `{"pid": 20, "name": "tally", "session": 2}`, `{"port": 9000, "pid": 20}`)
	if off, _, _ := connOffNow(nil); off {
		t.Fatal("no own Tally: not off")
	}
}

// --- fix 5: the owner settled by the Tally's Windows user before any port tie; never another login's
const sidHemant = "S-1-5-21-1111-2222-3333-1003"

func TestR254OwnerByWindowsUser(t *testing.T) {
	r254Bridge(t)
	r253Server(t, "", "")
	old := ownSIDsOf
	t.Cleanup(func() { ownSIDsOf = old })
	ownSIDsOf = func() []string { return []string{sidLocalSystem, sidAnshul} } // the service (SYSTEM) for anshul
	cases := []struct {
		p    proc
		want string
	}{
		{proc{Session: 1}, "mine"},                                   // this login's session
		{proc{Session: 1, Sid: sidHemant}, "mine"},                   // opened in this login "as another user"
		{proc{SessionUnknown: true, Sid: sidAnshul}, "mine"},         // run as administrator by the owner
		{proc{Session: 0, Sid: sidAnshul}, "mine"},                   // session 0, the owner's user
		{proc{SessionUnknown: true, Sid: sidHemant}, "other"},        // run as administrator by another person
		{proc{Session: 0, Sid: sidHemant}, "other"},                  // never handed to this login
		{proc{SessionUnknown: true, Sid: sidLocalSystem}, "unknown"}, // a service account is nobody's
		{proc{SessionUnknown: true}, "unknown"},                      // Windows said nothing
		{proc{Session: 2}, "other"},                                  // another signed-in session
	}
	for i, c := range cases {
		if got := sessionOwner(c.p); got != c.want {
			t.Fatalf("case %d %+v: %s, want %s", i, c.p, got, c.want)
		}
	}
	// the bridge that does not know its own user's SID: another SID proves nothing
	ownSIDsOf = func() []string { return []string{sidLocalSystem} }
	if got := sessionOwner(proc{SessionUnknown: true, Sid: sidHemant}); got != "unknown" {
		t.Fatalf("own SID not known: %s", got)
	}
}

// the Hemant / saurabh case: an elevated Tally of another login is skipped (never asked), its owner settled by its user;
// the other bridge's claim is never consulted for a Tally settled as this login's
func TestR254ElevatedTallyOfAnotherLogin(t *testing.T) {
	mine := newStandTally(t)
	standBridge(t, mine, "")
	r253Server(t, fmt.Sprintf(`{"pid": 10, "name": "tally", "sessionUnknown": true, "sid": %q}`, sidHemant), fmt.Sprintf(`{"port": %d, "pid": 10}`, mine.port))
	old := ownSIDsOf
	t.Cleanup(func() { ownSIDsOf = old })
	ownSIDsOf = func() []string { return []string{sidAnshul} }
	n0 := len(mine.reqs)
	e := r253Entry(t, openCompanies(true), mine.port)
	if e["skipped"] != true || str(e["reason"]) != "another user" || e["mine"] != false {
		t.Fatalf("another login's elevated Tally: %v", e)
	}
	mine.mu.Lock()
	sent := len(mine.reqs) - n0
	mine.mu.Unlock()
	if sent != 0 {
		t.Fatalf("%d requests sent to another login's Tally", sent)
	}
	// this login's own elevated Tally: used, and no other bridge is asked about it
	r253Server(t, fmt.Sprintf(`{"pid": 10, "name": "tally", "sessionUnknown": true, "sid": %q}`, sidAnshul), fmt.Sprintf(`{"port": %d, "pid": 10}`, mine.port))
	asked := false
	otherBridgeClaimFn = func(int) string { asked = true; return "hemant" }
	e = r253Entry(t, openCompanies(true), mine.port)
	if e["ok"] != true || e["mine"] != true || asked {
		t.Fatalf("own elevated Tally: %v (claim asked %v)", e, asked)
	}
	own, unknown := claimedPorts()
	if len(own) != 1 || own[0] != mine.port || len(unknown) != 0 {
		t.Fatalf("/ping claims: own %v unknown %v", own, unknown)
	}
}

// the last tie (both bridges know nothing of the Tally's user): the same for each login whatever its bridge's port
func TestR254ClaimTieStable(t *testing.T) {
	r254Bridge(t)
	if !claimWins(bridgeClaim{port: 9102, unknown: false, user: "zed"}, 9101, "amy") {
		t.Fatal("an own claim always wins")
	}
	// hemant < saurabh, whichever bridge holds the lower port
	// (both 2.5.4: the other bridge's /ping says claimRule "user"; an older one: r254review_test.go S2)
	u := claimRuleUser
	if !claimWins(bridgeClaim{port: 9109, unknown: true, user: `SRV\Hemant`, rule: u}, 9102, "saurabh") || claimWins(bridgeClaim{port: 9102, unknown: true, user: "saurabh", rule: u}, 9109, `SRV\hemant`) {
		t.Fatal("names decide")
	}
	if claimWins(bridgeClaim{port: 9101, unknown: true, user: "saurabh", rule: u}, 9109, "hemant") {
		t.Fatal("the port does not decide when the names differ")
	}
	if !claimWins(bridgeClaim{port: 9101, unknown: true, rule: u}, 9109, "hemant") || claimWins(bridgeClaim{port: 9109, unknown: true, user: "hemant", rule: u}, 9101, "HEMANT") {
		t.Fatal("no name or the same name: the lower port")
	}
}

// --- fix 6: the company list 2 s at most; a slow list keeps the last one and waits, nothing sent meanwhile
func TestR254CompanyListTwoSeconds(t *testing.T) {
	mine := newStandTally(t)
	standBridge(t, mine, "")
	r253Server(t, `{"pid": 10, "name": "tally", "session": 1}`, fmt.Sprintf(`{"port": %d, "pid": 10}`, mine.port))
	e := r253Entry(t, openCompanies(true), mine.port)
	if e["ok"] != true || len(sessCompanies(e)) == 0 {
		t.Fatalf("first list: %v", e)
	}
	var slow atomic.Bool
	slow.Store(true)
	mine.mu.Lock()
	mine.slow = func(id, body string) time.Duration {
		if id == "TDSDeskCompanies" && slow.Load() {
			return 4 * time.Second
		}
		return 0
	}
	mine.mu.Unlock()
	forgetTallyOpen()
	t0 := time.Now()
	e = r253Entry(t, openCompanies(true), mine.port)
	took := time.Since(t0)
	if took > 3*time.Second {
		t.Fatalf("the list waited %v (the rule: 2 s)", took)
	}
	if e["ok"] != true || len(sessCompanies(e)) == 0 {
		t.Fatalf("the last list not kept: %v", e)
	}
	until, held := colistHold(mine.port, 0)
	if !held || time.Until(until) < 10*time.Second || time.Until(until) > 16*time.Second {
		t.Fatalf("wait after a slow list: %v %v", held, time.Until(until))
	}
	// within the wait: nothing sent, the last list stands, at once
	time.Sleep(2500 * time.Millisecond) // the stand-in finishes the slow one (Tally's lock held until then)
	mine.mu.Lock()
	n0 := len(mine.reqs)
	mine.mu.Unlock()
	t0 = time.Now()
	// (an ask that is not fresh: the light check, the beat's own look; a fresh one always asks, review B2)
	coMu.Lock()
	coCacheAt = time.Time{}
	coMu.Unlock()
	old := time.Now().Add(-time.Hour)
	_ = os.Chtimes(filepath.Join(syncDir(), "open-companies.json"), old, old)
	l, _ := openCompaniesAsk(fin, false)
	e = r253Entry(t, l, mine.port)
	mine.mu.Lock()
	n1 := len(mine.reqs)
	mine.mu.Unlock()
	if n1 != n0 || time.Since(t0) > 500*time.Millisecond || e["ok"] != true || e["kept"] != true {
		t.Fatalf("within the wait: %d sent, %v, %v", n1-n0, time.Since(t0), e)
	}
	// the wait over and Tally quick again (and its once-a-minute small check due, as after a minute): asked, the wait ends
	slow.Store(false)
	probeMu.Lock()
	probes = map[int]*probeState{}
	probeMu.Unlock()
	colistMu.Lock()
	w := colistBack[mine.port]
	w.until = time.Now().Add(-time.Second)
	colistBack[mine.port] = w
	colistMu.Unlock()
	e = r253Entry(t, openCompanies(true), mine.port)
	if _, held := colistHold(mine.port, 0); held || e["ok"] != true || e["kept"] == true {
		t.Fatalf("after the wait: %v held %v", e, held)
	}
}

// the wait doubles to 10 minutes at most; an answer in time ends it; a refusal does not start one
func TestR254ColistBackoff(t *testing.T) {
	r254Bridge(t)
	resetColist()
	t.Cleanup(resetColist)
	want := []time.Duration{15 * time.Second, 30 * time.Second, time.Minute, 2 * time.Minute, 4 * time.Minute, 8 * time.Minute, 10 * time.Minute, 10 * time.Minute}
	for i, d := range want {
		colistNote(9000, 0, errTimeout)
		until, _ := colistHold(9000, 0)
		if got := time.Until(until); got < d-time.Second || got > d+time.Second {
			t.Fatalf("try %d: %v, want %v", i+1, got, d)
		}
	}
	colistNote(9000, 0, nil)
	if _, held := colistHold(9000, 0); held {
		t.Fatal("an answer in time ends the wait")
	}
	colistNote(9001, 0, errors.New("refused: not on the allow-list"))
	if _, held := colistHold(9001, 0); held {
		t.Fatal("a refusal starts no wait")
	}
}

// the 2 s cap is the request's own, whoever asks (a person's Connect too), and the XML is unchanged
func TestR254ColistCapWhoeverAsks(t *testing.T) {
	mine := newStandTally(t)
	standBridge(t, mine, "")
	mine.mu.Lock()
	mine.slow = func(id, body string) time.Duration {
		if id == "TDSDeskCompanies" || id == "TDSDeskCompanyInfo" {
			return 5 * time.Second
		}
		return 0
	}
	mine.mu.Unlock()
	for _, x := range []string{companiesRequest(), coInfoRequest("ZZ TEST")} {
		t0 := time.Now()
		_, err := tallyRaw(context.Background(), mine.port, x, 8)
		if err == nil || time.Since(t0) > 3*time.Second {
			t.Fatalf("%s: %v after %v", tallyRequestID(x), err, time.Since(t0))
		}
		time.Sleep(3500 * time.Millisecond) // the stand-in finishes
	}
	if !strings.Contains(companiesRequest(), "TDSDeskCompanies") || checkAllowed(companiesRequest()) != nil {
		t.Fatal("the company list's request changed")
	}
}

// --- fix 8: the update never during a posting or a request at Tally; spread out; the tray never waits
func TestR254UpdateRestartWaitsForQuiet(t *testing.T) {
	r254Bridge(t)
	old := tallyQuietFn
	t.Cleanup(func() { tallyQuietFn = old })
	var busy atomic.Bool
	busy.Store(true)
	tallyQuietFn = func() bool { return !busy.Load() }
	var restarted atomic.Bool
	done := make(chan struct{})
	go func() { updateRestartWhenQuiet(10*time.Millisecond, func() { restarted.Store(true) }); close(done) }()
	time.Sleep(150 * time.Millisecond)
	if restarted.Load() {
		t.Fatal("restarted during a posting")
	}
	busy.Store(false)
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("not restarted once quiet")
	}
	if !restarted.Load() {
		t.Fatal("not restarted")
	}
}

// the real quiet check: a posting in flight, a request at Tally, a request Tally is still on
func TestR254TallyQuiet(t *testing.T) {
	r254Bridge(t)
	resetEarlier()
	if !tallyQuietFn() {
		t.Fatal("nothing going on: quiet")
	}
	importsInFlight.Add(1)
	q := tallyQuietFn()
	importsInFlight.Add(-1)
	if q {
		t.Fatal("a posting in flight")
	}
	setInflight(9999, true)
	q = tallyQuietFn()
	setInflight(9999, false)
	if q {
		t.Fatal("a request at Tally")
	}
	earlierMu.Lock()
	earlier[9999] = &abandonSlot{}
	earlierMu.Unlock()
	q = tallyQuietFn()
	resetEarlier()
	if q {
		t.Fatal("a request Tally is still on")
	}
}

func TestR254UpdateJitter(t *testing.T) {
	r254Bridge(t)
	// by default none: FinCom's update gate expects each look 2 minutes after the start, then every 6 hours
	if updateWait(true) != 2*time.Minute || updateWait(false) != 6*time.Hour {
		t.Fatalf("default waits %v / %v: not the gate's times", updateWait(true), updateWait(false))
	}
	setCfg("UpdateJitterMin", float64(60))
	t.Cleanup(func() { setCfg("UpdateJitterMin", nil) })
	base := time.Duration(keepNum("UpdateCheckHours", 6)) * time.Hour
	seen := map[time.Duration]bool{}
	for i := 0; i < 200; i++ {
		d := updateWait(false)
		if d < base || d >= base+60*time.Minute {
			t.Fatalf("wait %v outside %v + [0, 60 min)", d, base)
		}
		seen[d/time.Minute] = true
		if f := updateWait(true); f < 2*time.Minute || f >= 62*time.Minute {
			t.Fatalf("first wait %v", f)
		}
	}
	if len(seen) < 10 {
		t.Fatalf("not spread: %d different minutes in 200", len(seen))
	}
}

// the tray's "Check for updates" answers within its wait while the look (a slow download) goes on; one look at a time
func TestR254TrayUpdateNeverWaits(t *testing.T) {
	r254Bridge(t)
	block := make(chan struct{})
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { <-block }))
	defer srv.Close()
	defer close(block)
	setCfg("UpdateUrl", srv.URL)
	t.Cleanup(func() { setCfg("UpdateUrl", "") })
	oldW := updTrayWait
	updTrayWait = 300 * time.Millisecond
	t.Cleanup(func() { updTrayWait = oldW })
	t0 := time.Now()
	m := checkForUpdateTray()
	if time.Since(t0) > 2*time.Second || m["checking"] != true || !updChecking.Load() {
		t.Fatalf("tray: %v after %v", m, time.Since(t0))
	}
	if _, ran := checkForUpdateOnce(false); ran {
		t.Fatal("a second look ran beside the first")
	}
	if !updateBeat()["checking"].(bool) {
		t.Fatal("the beat does not say a look is going on")
	}
}

// the new program is kept only when it works: its web server up and its main loop turning
func TestR254UpdateHealth(t *testing.T) {
	r254Bridge(t)
	oldS, oldL := serving.Load(), loopAt.Load()
	t.Cleanup(func() { serving.Store(oldS); loopAt.Store(oldL) })
	serving.Store(false)
	loopAt.Store(time.Now().Unix())
	if updateLooksHealthy() {
		t.Fatal("no web server: not healthy")
	}
	serving.Store(true)
	if !updateLooksHealthy() {
		t.Fatal("serving and turning: healthy")
	}
	loopAt.Store(time.Now().Add(-time.Minute).Unix())
	if updateLooksHealthy() {
		t.Fatal("a main loop stuck a minute: not healthy")
	}
	oldM := updHealthMax
	updHealthMax = 200 * time.Millisecond
	t.Cleanup(func() { updHealthMax = oldM })
	if updateWaitHealthy(10*time.Millisecond, 20*time.Millisecond) {
		t.Fatal("never healthy: false")
	}
	loopAt.Store(time.Now().Unix())
	if !updateWaitHealthy(10*time.Millisecond, 20*time.Millisecond) {
		t.Fatal("healthy: true")
	}
}

// --- fix 7: the setup for all users never ends the other Windows users' FinCom Bridges
func TestR254InstallerKillsOnlyItsOwn(t *testing.T) {
	r254Bridge(t)
	b, err := os.ReadFile(filepath.Join("installer", "FinComBridge.nsi"))
	if err != nil {
		t.Fatal(err)
	}
	for i, l := range strings.Split(string(b), "\n") {
		if strings.Contains(l, "taskkill") && !strings.Contains(l, `/FI "USERNAME eq`) {
			t.Fatalf("line %d ends every user's FinCom Bridge: %s", i+1, strings.TrimSpace(l))
		}
	}
	if !strings.Contains(string(b), `taskkill.exe /F /IM FinComBridge.exe /FI "USERNAME eq SYSTEM"`) {
		t.Fatal("the service's own process is not ended")
	}
}

// a bridge of its own for a test (its log and files in the test's folder, never in the package folder)
func r254Bridge(t *testing.T) {
	t.Helper()
	standBridge(t, newStandTally(t), "")
}
