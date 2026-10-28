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
