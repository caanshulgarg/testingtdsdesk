package main

// 2.4.8 (anyport.go): TallyPrime on any port, never another Windows user's. Fake listener tables (TDSBRIDGE_FAKE) and
// stand-in Tallys on random ports (httptest: never 9000-9005).

import (
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"testing"
	"time"
)

type fakeProc struct {
	pid, session int
	name, path   string
}

// the listener table and programs Windows would give: anshul (session 1, this bridge's) and ravi (session 2)
func fakeWindows(t *testing.T, procs []fakeProc, lis [][2]int) {
	t.Helper()
	var ps, ls []string
	for _, p := range procs {
		ps = append(ps, fmt.Sprintf(`{"pid": %d, "name": %q, "session": %d, "path": %q}`, p.pid, p.name, p.session, p.path))
	}
	for _, l := range lis {
		ls = append(ls, fmt.Sprintf(`{"port": %d, "pid": %d}`, l[0], l[1]))
	}
	f := filepath.Join(t.TempDir(), "fake.json")
	_ = os.WriteFile(f, []byte(`{"mySession": 1, "users": {"1": "anshul", "2": "ravi"}, "processes": [`+strings.Join(ps, ",")+`], "listeners": [`+strings.Join(ls, ",")+`]}`), 0o644)
	t.Setenv("TDSBRIDGE_FAKE", f)
	resetNotTally()
	forgetPlanCache()
}

// a tally.ini that names the port 9000 (Tally runs on another one)
func iniSays9000(t *testing.T) string {
	d := filepath.Join(t.TempDir(), "TallyPrime")
	_ = os.MkdirAll(d, 0o755)
	_ = os.WriteFile(filepath.Join(d, "tally.ini"), []byte("[Tally]\r\nClient Server = Both\r\nServer Port = 9000\r\n"), 0o644)
	return filepath.ToSlash(filepath.Join(d, "tally.exe"))
}

// a port nothing listens on
func closedPort(t *testing.T) int {
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	p := l.Addr().(*net.TCPAddr).Port
	l.Close()
	return p
}

// a program that answers HTTP, not as Tally
func notTallyServer(t *testing.T) (int, *int) {
	n := new(int)
	var mu sync.Mutex
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		*n++
		mu.Unlock()
		_, _ = w.Write([]byte("<html><body>Hello from another program</body></html>"))
	}))
	t.Cleanup(s.Close)
	return s.Listener.Addr().(*net.TCPAddr).Port, n
}

func sessionFor(ss []M, port int) M {
	for _, s := range ss {
		if toInt(s["port"]) == port {
			return s
		}
	}
	return nil
}

// a. automatic: Tally found on its real port (not tally.ini's 9000), another user's Tally never asked, a second listener
// of the same Tally program that answers not as Tally asked once and then left out
func TestAnyPortAutoFindsOwnTallyAnyPort(t *testing.T) {
	mine, theirs := newStandTally(t), newStandTally(t)
	standBridge(t, mine, "")
	other, otherN := notTallyServer(t)
	fakeWindows(t, []fakeProc{{10, 1, "tally", iniSays9000(t)}, {20, 2, "TallyPrime.exe", `C:\Tally\tally.exe`}},
		[][2]int{{mine.port, 10}, {other, 10}, {theirs.port, 20}})
	setCfg("TallyPorts", "auto")
	setCfg("OnlyMySession", true)
	if mode, plan := portPlan(); mode != "auto" || len(plan) != 3 {
		t.Fatalf("plan %s %v", mode, plan)
	}
	ss := openCompanies(true)
	if s := sessionFor(ss, mine.port); s == nil || s["ok"] != true || len(sessCompanies(s)) != 1 {
		t.Fatalf("own Tally on port %d: %v", mine.port, jsonText(ss))
	}
	if s := sessionFor(ss, theirs.port); s == nil || s["skipped"] != true {
		t.Fatalf("another user's Tally not skipped: %v", jsonText(ss))
	}
	if s := sessionFor(ss, other); s == nil || s["ok"] == true || s["notTally"] != true {
		t.Fatalf("a listener answering not as Tally taken as Tally: %v", jsonText(ss))
	}
	// the second look: the port known not to be Tally's is left out while the same program holds it
	_, plan := portPlan()
	for _, p := range plan {
		if toInt(p["port"]) == other {
			t.Fatalf("the not-Tally port is still planned: %v", plan)
		}
	}
	openCompanies(true)
	if *otherN != 1 {
		t.Fatalf("the not-Tally port was asked %d times", *otherN)
	}
	if len(theirs.ids()) != 0 {
		t.Fatalf("another user's Tally was asked: %v", theirs.ids())
	}
	port, _, err := findCompanyNow(zz, 9000)
	if err != nil || port != mine.port {
		t.Fatalf("company found on %d (%v), want %d", port, err, mine.port)
	}
	// another program takes that port (another pid): asked again
	fakeWindows(t, []fakeProc{{10, 1, "tally", ""}, {11, 1, "tally", ""}}, [][2]int{{mine.port, 10}, {other, 11}})
	if _, plan := portPlan(); len(plan) != 2 {
		t.Fatalf("a new program on the port is asked again: %v", plan)
	}
}

// several Tallys of this user, each on its own port: both used; a port set by hand that is wrong (tally.ini's 9000 kind)
// does not stop Tally being found where it runs
func TestAnyPortSeveralTallysAndWrongSetPort(t *testing.T) {
	a, b := newStandTally(t), newStandTally(t)
	b.coName = "ZZ SECOND"
	standBridge(t, a, "")
	fakeWindows(t, []fakeProc{{10, 1, "tally", ""}, {11, 1, "tally", ""}}, [][2]int{{a.port, 10}, {b.port, 11}})
	setCfg("OnlyMySession", true)
	setCfg("TallyPorts", []any{float64(closedPort(t))})
	ss := openCompanies(true)
	if s := sessionFor(ss, a.port); s == nil || s["ok"] != true {
		t.Fatalf("Tally A: %v", jsonText(ss))
	}
	if s := sessionFor(ss, b.port); s == nil || s["ok"] != true {
		t.Fatalf("Tally B: %v", jsonText(ss))
	}
	if p, _, err := findCompanyNow("ZZ SECOND", 0); err != nil || p != b.port {
		t.Fatalf("ZZ SECOND on %d %v", p, err)
	}
}

// the diagnosis: TallyPrime listening on a port outside 9000-9999 accepts connections (the 7.2 proof's 4125 false alarm)
func TestAnyPortDiagnosisAnyPort(t *testing.T) {
	f := newStandTally(t)
	standBridge(t, f, "")
	fakeWindows(t, []fakeProc{{10, 1, "tally", iniSays9000(t)}}, [][2]int{{4125, 10}, {50000, 99}})
	d := diagnosis()
	fs := d["findings"].([]M)
	if len(fs) != 1 || str(fs[0]["level"]) != "ok" || !strings.Contains(str(fs[0]["text"]), "port 4125") {
		t.Fatalf("diagnosis: %v", jsonText(fs))
	}
	for _, l := range d["listeners"].([]M) {
		if toInt(l["port"]) == 50000 {
			t.Fatalf("another program outside 9000-9999 listed: %v", l)
		}
	}
}

// Windows did not let the bridge list programs: tally.ini's port is tried before FallbackPorts
func TestAnyPortFallbackReadsIniPort(t *testing.T) {
	f := newStandTally(t)
	standBridge(t, f, "")
	t.Setenv("TDSBRIDGE_FAKE", "")
	d := t.TempDir()
	_ = os.WriteFile(filepath.Join(d, "tally.ini"), []byte(fmt.Sprintf("[Tally]\r\nServerPort = %d\r\n", f.port)), 0o644)
	old := tallyIniDirsFn
	tallyIniDirsFn = func() []string { return []string{d} }
	t.Cleanup(func() { tallyIniDirsFn = old; resetIniPorts() })
	resetIniPorts()
	setCfg("TallyPorts", "auto")
	setCfg("FallbackPorts", []any{float64(closedPort(t))})
	if ok, _, _ := netState(); ok {
		t.Skip("this platform lists programs")
	}
	mode, plan := portPlan()
	if mode != "fallback" || len(plan) != 2 || toInt(plan[0]["port"]) != f.port {
		t.Fatalf("plan %s %v", mode, plan)
	}
	if p, _, err := findCompanyNow(zz, 0); err != nil || p != f.port {
		t.Fatalf("found on %d %v", p, err)
	}
}

func postUse(t *testing.T, body string) M {
	t.Helper()
	code, res := callLocal(t, "POST", "/ports/use", "", body)
	if code != 200 {
		t.Fatalf("/ports/use: %d %v", code, res)
	}
	return res
}

// b. typed: this user's Tally on a typed port is accepted and kept; asked once, with the light company list
func TestTypedPortAccepted(t *testing.T) {
	f := newStandTally(t)
	standBridge(t, f, `,"Key":"k248"`)
	fakeWindows(t, []fakeProc{{10, 1, "tally", ""}}, [][2]int{{f.port, 10}})
	setCfg("TallyPorts", "auto")
	n0 := len(f.ids())
	res := postUse(t, fmt.Sprintf(`{"port": %d}`, f.port))
	if res["ok"] != true || toInt(res["port"]) != f.port || len(arr(res["companies"])) != 1 || str(arr(res["companies"])[0]) != zz {
		t.Fatalf("typed port: %v", res)
	}
	if ids := f.ids()[n0:]; len(ids) != 1 || ids[0] != "TDSDeskCompanies" {
		t.Fatalf("asked: %v", ids)
	}
	if ports, auto := cleanPorts(cfg("TallyPorts")); auto || len(ports) != 1 || ports[0] != f.port {
		t.Fatalf("not kept: %v", cfg("TallyPorts"))
	}
	if saved := readObjFile(ConfigPath); saved == nil || !strings.Contains(jsonText(saved["TallyPorts"]), fmt.Sprint(f.port)) {
		t.Fatalf("not saved: %v", saved["TallyPorts"])
	}
	// automatic again
	if res := postUse(t, `{"port": 0}`); res["ok"] != true || res["auto"] != true {
		t.Fatalf("auto: %v", res)
	}
	if _, auto := cleanPorts(cfg("TallyPorts")); !auto {
		t.Fatalf("not automatic: %v", cfg("TallyPorts"))
	}
}

// b. typed: refused in plain words, nothing kept: nothing listening, not Tally, another user's Tally (by session and by
// Windows user), the bridge's own port, not a number
func TestTypedPortRefused(t *testing.T) {
	mine, theirs := newStandTally(t), newStandTally(t)
	standBridge(t, mine, `,"Key":"k248"`)
	other, _ := notTallyServer(t)
	fakeWindows(t, []fakeProc{{10, 1, "tally", ""}, {20, 2, "tally", ""}}, [][2]int{{mine.port, 10}, {theirs.port, 20}})
	setCfg("TallyPorts", "auto")
	setCfg("Port", float64(9100))
	cases := []struct {
		body, reason, words string
	}{
		{fmt.Sprintf(`{"port": %d}`, closedPort(t)), useNothing, "Nothing is listening on port"},
		{fmt.Sprintf(`{"port": %d}`, other), useNotTally, "answers, but not as TallyPrime"},
		{fmt.Sprintf(`{"port": %d}`, theirs.port), useOtherUser, "the TallyPrime of ravi, another Windows user"},
		{`{"port": 9100}`, useBad, "FinCom Bridge's own port"},
		{`{"port": "abc"}`, useBad, "Type a port number"},
		{`{"port": 70000}`, useBad, "Type a port number"},
		{`{}`, useBad, "Type a port number"},
	}
	for _, c := range cases {
		res := postUse(t, c.body)
		if res["ok"] != false || str(res["reason"]) != c.reason || !strings.Contains(str(res["error"]), c.words) {
			t.Fatalf("%s: %v", c.body, res)
		}
		if _, auto := cleanPorts(cfg("TallyPorts")); !auto {
			t.Fatalf("%s: a refused port was kept: %v", c.body, cfg("TallyPorts"))
		}
	}
	if len(theirs.ids()) != 0 {
		t.Fatalf("another user's Tally was asked: %v", theirs.ids())
	}
	// Windows says the program listening there is another Windows user's (its token), although no session says so
	oldL, oldO := listenerUserOf, ownSIDsOf
	t.Cleanup(func() { listenerUserOf, ownSIDsOf = oldL, oldO })
	ownSIDsOf = func() []string { return []string{sidAnshul} }
	listenerUserOf = func(p int) (string, bool, error) { return sidRavi, true, nil }
	fakeWindows(t, nil, nil)
	if res := postUse(t, fmt.Sprintf(`{"port": %d}`, theirs.port)); str(res["reason"]) != useOtherUser || !strings.Contains(str(res["error"]), "another Windows user") {
		t.Fatalf("by Windows user: %v", res)
	}
	// a process the bridge may not open (another user's, as a non-administrator): refused too
	listenerUserOf = func(p int) (string, bool, error) { return "", true, nil }
	if res := postUse(t, fmt.Sprintf(`{"port": %d}`, theirs.port)); str(res["reason"]) != useOtherUser {
		t.Fatalf("unopenable process: %v", res)
	}
	// Windows could not say
	listenerUserOf = func(p int) (string, bool, error) { return "", true, errors.New("GetExtendedTcpTable: denied") }
	if res := postUse(t, fmt.Sprintf(`{"port": %d}`, theirs.port)); str(res["reason"]) != useUnknown {
		t.Fatalf("unknown: %v", res)
	}
	if len(theirs.ids()) != 0 {
		t.Fatalf("another user's Tally was asked: %v", theirs.ids())
	}
	// this user's: accepted
	listenerUserOf = func(p int) (string, bool, error) { return sidAnshul, true, nil }
	if res := postUse(t, fmt.Sprintf(`{"port": %d}`, mine.port)); res["ok"] != true {
		t.Fatalf("own: %v", res)
	}
}

// b. typed, the 2-second rule: a Tally that does not answer is given up at 2 s with plain words; nothing kept
func TestTypedPortTimeoutTwoSeconds(t *testing.T) {
	f := newStandTally(t)
	standBridge(t, f, `,"Key":"k248"`)
	fakeWindows(t, []fakeProc{{10, 1, "tally", ""}}, [][2]int{{f.port, 10}})
	setCfg("TallyPorts", "auto")
	log := &fakeLog{}
	f.behave = silentFor(func(id, body string) bool { return id == "TDSDeskCompanies" }, log)
	t0 := time.Now()
	res := postUse(t, fmt.Sprintf(`{"port": %d}`, f.port))
	took := time.Since(t0)
	if res["ok"] != false || str(res["reason"]) != useTimeout || !strings.Contains(str(res["error"]), "within 2 seconds") {
		t.Fatalf("silent Tally: %v", res)
	}
	if took > 2600*time.Millisecond || log.longest() > 2600*time.Millisecond {
		t.Fatalf("held %v (Tally %v): over the 2 s rule", took, log.longest())
	}
	if _, auto := cleanPorts(cfg("TallyPorts")); !auto {
		t.Fatalf("kept: %v", cfg("TallyPorts"))
	}
}

// b. typed, one request in flight: the typed try and the company look at once never put two requests into Tally
func TestTypedPortOneInFlight(t *testing.T) {
	f := newStandTally(t)
	standBridge(t, f, `,"Key":"k248"`)
	fakeWindows(t, []fakeProc{{10, 1, "tally", ""}}, [][2]int{{f.port, 10}})
	setCfg("TallyPorts", "auto")
	f.slow = func(id, body string) time.Duration { return 300 * time.Millisecond }
	var wg sync.WaitGroup
	for i := 0; i < 3; i++ {
		wg.Add(2)
		go func() { defer wg.Done(); _, _ = tryTypedPort(f.port) }()
		go func() { defer wg.Done(); openCompanies(true) }()
	}
	wg.Wait()
	f.mu.Lock()
	mx := f.maxFlight
	f.mu.Unlock()
	if mx != 1 {
		t.Fatalf("%d requests in Tally at once", mx)
	}
}

// only this Windows user's programs may use /ports/use (as every address but /ping)
func TestTypedPortOwnUserOnly(t *testing.T) {
	f := newStandTally(t)
	standBridge(t, f, `,"Key":"k248"`)
	oldP, oldO := peerUserOf, ownSIDsOf
	t.Cleanup(func() { peerUserOf, ownSIDsOf = oldP, oldO })
	ownSIDsOf = func() []string { return []string{sidAnshul} }
	peerUserOf = func(local, remote int) (string, bool, error) { return sidRavi, true, nil }
	code, res := callLocal(t, "POST", "/ports/use", "", fmt.Sprintf(`{"port": %d}`, f.port))
	if code != 403 || len(f.ids()) != 0 {
		t.Fatalf("another user's program: %d %v, Tally asked %v", code, res, f.ids())
	}
}

// 2.4.8 adds and changes no Tally request: the allow-list table as 2.4.5's, the decision line names 2.4.8 with 2.4.7's
// kept as history, a dated line for 2.4.8; the test sheet names this version's new steps
func TestRelease248VersionAllowListUnchanged(t *testing.T) {
	if BridgeVersion != "2.4.8" {
		t.Fatalf("BridgeVersion %s", BridgeVersion)
	}
	const table245 = "b4df290484f57e3cba053d16cc29f68209eda6a1f087c3c4a1616e69886e9391"
	if h := allowListHash(allowListRows()); h != table245 {
		t.Fatalf("the allow-list's table changed (%s): 2.4.8 adds or changes no request", h)
	}
	al := readText(filepath.Join("..", "docs", "tally-allowlist.md"))
	line := group(`(?m)^(First table: .*)$`, al, 1)
	for _, w := range []string{"allowed for 2.4.8 by the owner's standing decision of 2026-10-06 (no request on the list and no request shape changed",
		"TDSDeskCompanies exactly as built", "as for 2.4.7: the owner's standing decision of 2026-10-06", "as for 2.4.6: the owner's standing decision of 2026-10-06"} {
		if !strings.Contains(line, w) {
			t.Errorf("the decision line does not say %q", w)
		}
	}
	if strings.Contains(al, "allowed for 2.4.7 by") || strings.Contains(al, "allowed for 2.4.6 by") {
		t.Error("an earlier version's decision still worded as the current one")
	}
	if !regexp.MustCompile(`re-measured on 2026-10-28 for 2\.4\.8: no request was measured again[^\n]*allowed for 2\.4\.8 by the owner's standing decision of 2026-10-06`).MatchString(al) {
		t.Error("no dated line for 2.4.8")
	}
	sheet := readText(filepath.Join("..", "docs", "bridge-2.4.8-test-sheet.txt"))
	for _, w := range []string{"2.4.8", "port 4125", "Use this port", "another Windows user", "within 2 seconds", "3.0 + 7.1 by the owner's decision of 2026-10-28"} {
		if !strings.Contains(sheet, w) {
			t.Errorf("the test sheet does not say %q", w)
		}
	}
	// the typed port's request is the light company list exactly as built (no new request shape)
	if tallyRequestID(companiesRequest()) != "TDSDeskCompanies" || checkAllowed(companiesRequest()) != nil {
		t.Fatal("the typed port's request is not the allow-listed company list")
	}
}

// --- review 2.4.8 round 1 (R1-1 .. R1-5): the review's cases

// R1-1: a posting going on: the typed try is refused at once and nothing is sent; a try that waits too long keeps nothing
func TestTypedPortBusyAndBounded(t *testing.T) {
	f := newStandTally(t)
	standBridge(t, f, `,"Key":"k248"`)
	fakeWindows(t, []fakeProc{{10, 1, "tally", ""}}, [][2]int{{f.port, 10}})
	setCfg("TallyPorts", "auto")
	importsInFlight.Add(1)
	res := postUse(t, fmt.Sprintf(`{"port": %d}`, f.port))
	importsInFlight.Store(0)
	if str(res["reason"]) != useBusy || len(f.ids()) != 0 {
		t.Fatalf("during a posting: %v, Tally asked %v", res, f.ids())
	}
	old := usePortWait
	usePortWait = 200 * time.Millisecond
	t.Cleanup(func() { usePortWait = old })
	f.slow = func(id, body string) time.Duration { return 900 * time.Millisecond }
	if res := postUse(t, fmt.Sprintf(`{"port": %d}`, f.port)); str(res["reason"]) != useBusy {
		t.Fatalf("over the wait: %v", res)
	}
	time.Sleep(1500 * time.Millisecond) // the try's late answer
	if _, auto := cleanPorts(cfg("TallyPorts")); !auto {
		t.Fatalf("kept after the page was answered: %v", cfg("TallyPorts"))
	}
}

// R1-2: a typed port that is not Tally and drops the connection leaves the real Tally's "not answering" record as it was
func TestTypedPortLeavesRealTallyState(t *testing.T) {
	f := newStandTally(t)
	standBridge(t, f, `,"Key":"k248"`)
	fakeWindows(t, []fakeProc{{10, 1, "tally", ""}}, [][2]int{{f.port, 10}})
	setCfg("TallyPorts", "auto")
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { l.Close() })
	go func() {
		for {
			c, err := l.Accept()
			if err != nil {
				return
			}
			buf := make([]byte, 512)
			_, _ = c.Read(buf)
			c.Close() // drops the connection without an answer
		}
	}()
	drop := l.Addr().(*net.TCPAddr).Port
	setTallyStuck(f.port)
	before := readText(stuckFile())
	res := postUse(t, fmt.Sprintf(`{"port": %d}`, drop))
	if res["ok"] == true || str(res["reason"]) != useNotTally {
		t.Fatalf("a port that drops the connection: %v", res)
	}
	if readText(stuckFile()) != before || needProbe(drop) {
		t.Fatalf("the typed port left a mark: stuck %s (was %s), probe %v", readText(stuckFile()), before, needProbe(drop))
	}
}

// R1-4: Tally set on another computer (TallyHost): the typed port is not tried (whose it is cannot be told)
func TestTypedPortRemoteTallyHostRefused(t *testing.T) {
	f := newStandTally(t)
	standBridge(t, f, `,"Key":"k248"`)
	setCfg("TallyHost", "10.0.0.5")
	t.Cleanup(func() { setCfg("TallyHost", "127.0.0.1") })
	if res := postUse(t, fmt.Sprintf(`{"port": %d}`, f.port)); str(res["reason"]) != useBad || !strings.Contains(str(res["error"]), "TallyHost") || len(f.ids()) != 0 {
		t.Fatalf("remote TallyHost: %v %v", res, f.ids())
	}
}

// R1-3: Tally's own short refusal or an empty answer never marks its port; a mark ends when Tally answers
func TestAnyPortTallyRefusalNotMarked(t *testing.T) {
	if !isTallyAnswer("<RESPONSE>Unknown Request, cannot be processed</RESPONSE>") || notTallyAnswer("") || notTallyAnswer("  ") || !notTallyAnswer("<html>x</html>") {
		t.Fatal("the answer rules")
	}
	f := newStandTally(t)
	standBridge(t, f, "")
	fakeWindows(t, []fakeProc{{10, 1, "tally", ""}}, [][2]int{{f.port, 10}})
	setCfg("TallyPorts", "auto")
	noteNotTally(f.port, 99) // another program held the port before
	ss := openCompanies(true)
	if s := sessionFor(ss, f.port); s == nil || s["ok"] != true {
		t.Fatalf("Tally: %v", jsonText(ss))
	}
	notTallyMu.Lock()
	_, marked := notTally[f.port]
	notTallyMu.Unlock()
	if marked {
		t.Fatal("Tally's answer did not end the mark")
	}
}

// R1-5: a port set by hand (or tally.ini's, in the fallback) that Windows says is another user's program is skipped
func TestAnyPortSetPortOfOtherUserSkipped(t *testing.T) {
	mine, theirs := newStandTally(t), newStandTally(t)
	standBridge(t, mine, "")
	t.Setenv("TDSBRIDGE_FAKE", "")
	oldL, oldO := listenerUserOf, ownSIDsOf
	t.Cleanup(func() { listenerUserOf, ownSIDsOf = oldL, oldO })
	ownSIDsOf = func() []string { return []string{sidAnshul} }
	listenerUserOf = func(p int) (string, bool, error) {
		if p == theirs.port {
			return sidRavi, true, nil
		}
		return sidAnshul, true, nil
	}
	setCfg("OnlyMySession", true)
	setCfg("TallyPorts", []any{float64(theirs.port), float64(mine.port)})
	forgetPlanCache()
	ss := openCompanies(true)
	if s := sessionFor(ss, theirs.port); s == nil || s["skipped"] != true {
		t.Fatalf("another user's port set by hand: %v", jsonText(ss))
	}
	if s := sessionFor(ss, mine.port); s == nil || s["ok"] != true {
		t.Fatalf("own port: %v", jsonText(ss))
	}
	// the fallback: tally.ini (one file for every user of the server) names their port
	d := t.TempDir()
	_ = os.WriteFile(filepath.Join(d, "tally.ini"), []byte(fmt.Sprintf("[Tally]\r\nServer Port = %d\r\n", theirs.port)), 0o644)
	oldD := tallyIniDirsFn
	tallyIniDirsFn = func() []string { return []string{d} }
	t.Cleanup(func() { tallyIniDirsFn = oldD; resetIniPorts() })
	resetIniPorts()
	setCfg("TallyPorts", "auto")
	setCfg("FallbackPorts", []any{float64(mine.port)})
	forgetPlanCache()
	ss = openCompanies(true)
	if s := sessionFor(ss, theirs.port); s == nil || s["skipped"] != true {
		t.Fatalf("another user's tally.ini port in the fallback: %v", jsonText(ss))
	}
	if len(theirs.ids()) != 0 {
		t.Fatalf("another user's Tally was asked: %v", theirs.ids())
	}
}

// --- review 2.4.8 round 2 (R2-1 .. R2-8): the review's cases

// R2-1/R2-2: a port whose small check is due or pending: the typed try sends nothing (no 10 s small check) and says so
func TestTypedPortNoSmallCheck(t *testing.T) {
	f := newStandTally(t)
	standBridge(t, f, `,"Key":"k248"`)
	fakeWindows(t, []fakeProc{{10, 1, "tally", ""}}, [][2]int{{f.port, 10}})
	setCfg("TallyPorts", "auto")
	setProbeAfterTimeout(f.port)
	res := postUse(t, fmt.Sprintf(`{"port": %d}`, f.port))
	if str(res["reason"]) != useTimeout || !strings.Contains(str(res["error"]), "did not answer lately") || len(f.ids()) != 0 {
		t.Fatalf("small check pending: %v, Tally asked %v", res, f.ids())
	}
	probeMu.Lock()
	if p := probes[f.port]; p != nil {
		p.last = time.Now().Add(-time.Hour) // the small check due now
	}
	probeMu.Unlock()
	res = postUse(t, fmt.Sprintf(`{"port": %d}`, f.port))
	if str(res["reason"]) != useTimeout || len(f.ids()) != 0 {
		t.Fatalf("small check due: %v, Tally asked %v", res, f.ids())
	}
}

// R2-4: a try given up (the page answered busy) sends nothing once it gets Tally's lock
func TestTypedPortGivenUpSendsNothing(t *testing.T) {
	f := newStandTally(t)
	standBridge(t, f, `,"Key":"k248"`)
	fakeWindows(t, []fakeProc{{10, 1, "tally", ""}}, [][2]int{{f.port, 10}})
	setCfg("TallyPorts", "auto")
	old := usePortWait
	usePortWait = 100 * time.Millisecond
	t.Cleanup(func() { usePortWait = old })
	g := portLock(f.port)
	g.ch <- struct{}{} // another request holds Tally's lock
	res := postUse(t, fmt.Sprintf(`{"port": %d}`, f.port))
	time.Sleep(300 * time.Millisecond)
	<-g.ch // the lock let go
	time.Sleep(700 * time.Millisecond)
	if str(res["reason"]) != useBusy || len(f.ids()) != 0 {
		t.Fatalf("given up: %v, Tally asked %v", res, f.ids())
	}
}

// R2-6: this user's TallyPrime run as administrator (Windows will not open it: no user, no error) is accepted when Windows
// lists it in this user's session; R2-7: another program's XML with a <Response> is not Tally
func TestTypedPortElevatedOwnAndStrictAnswer(t *testing.T) {
	f := newStandTally(t)
	standBridge(t, f, `,"Key":"k248"`)
	fakeWindows(t, []fakeProc{{10, 1, "tally", ""}}, [][2]int{{f.port, 10}})
	setCfg("TallyPorts", "auto")
	oldL, oldO := listenerUserOf, ownSIDsOf
	t.Cleanup(func() { listenerUserOf, ownSIDsOf = oldL, oldO })
	ownSIDsOf = func() []string { return []string{sidAnshul} }
	listenerUserOf = func(p int) (string, bool, error) { return "", true, nil }
	if res := postUse(t, fmt.Sprintf(`{"port": %d}`, f.port)); res["ok"] != true {
		t.Fatalf("own TallyPrime as administrator: %v", res)
	}
	listenerUserOf = oldL
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`<?xml version="1.0"?><Response><Status>404</Status></Response>`))
	}))
	t.Cleanup(s.Close)
	p := s.Listener.Addr().(*net.TCPAddr).Port
	if res := postUse(t, fmt.Sprintf(`{"port": %d}`, p)); str(res["reason"]) != useNotTally {
		t.Fatalf("a <Response> of another program: %v", res)
	}
	if !isTallyAnswer("\ufeff <?xml version=\"1.0\"?>\r\n<ENVELOPE><HEADER>") || isTallyAnswer("<html><ENVELOPE>") ||
		!isTallyAnswer("<RESPONSE>Unknown Request</RESPONSE>") || isTallyAnswer(`<?xml version="1.0"?><Response><Status>404</Status></Response>`) {
		t.Fatal("the Tally answer rule")
	}
}

// R2-8: an empty answer does not end a not-Tally mark
func TestAnyPortEmptyAnswerKeepsMark(t *testing.T) {
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))
	t.Cleanup(s.Close)
	f := newStandTally(t)
	standBridge(t, f, "")
	p := s.Listener.Addr().(*net.TCPAddr).Port
	fakeWindows(t, []fakeProc{{10, 1, "tally", ""}}, [][2]int{{f.port, 10}, {p, 10}})
	setCfg("TallyPorts", []any{float64(p)})
	noteNotTally(p, 10)
	openCompanies(true)
	notTallyMu.Lock()
	_, marked := notTally[p]
	notTallyMu.Unlock()
	if !marked {
		t.Fatal("an empty answer ended the mark")
	}
}

// --- review 2.4.8 round 3 (R3-1, R3-7): the review's cases

// a port set by hand whose program Windows will not open (no user, no error) and which runs in another user's session is
// another user's: skipped, never asked; in this user's session (TallyPrime as administrator) it is asked
func TestAnyPortUnopenableOtherSessionSkipped(t *testing.T) {
	mine, theirs := newStandTally(t), newStandTally(t)
	standBridge(t, mine, "")
	fakeWindows(t, []fakeProc{{10, 1, "java", ""}, {20, 2, "java", ""}, {30, 1, "tally", ""}}, [][2]int{{mine.port, 10}, {theirs.port, 20}})
	oldL := listenerUserOf
	t.Cleanup(func() { listenerUserOf = oldL; resetOtherUser() })
	listenerUserOf = func(p int) (string, bool, error) { return "", true, nil }
	resetOtherUser()
	setCfg("OnlyMySession", true)
	setCfg("TallyPorts", []any{float64(theirs.port), float64(mine.port)})
	ss := openCompanies(true)
	if s := sessionFor(ss, theirs.port); s == nil || s["skipped"] != true {
		t.Fatalf("another session's unopenable program: %v", jsonText(ss))
	}
	if s := sessionFor(ss, mine.port); s == nil || s["ok"] != true {
		t.Fatalf("this session's (as administrator): %v", jsonText(ss))
	}
	if len(theirs.ids()) != 0 {
		t.Fatalf("another user's Tally was asked: %v", theirs.ids())
	}
}
