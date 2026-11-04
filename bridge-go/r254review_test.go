// FinCom Bridge 2.5.4, the independent review's findings (B1, B2, S1-S4, M1, M2): each test fails on f9f807b88 and
// passes with the fix
package main

import (
	"fmt"
	"go/parser"
	"go/token"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func standCount(f *standTally, id string) int {
	f.mu.Lock()
	defer f.mu.Unlock()
	n := 0
	for _, r := range f.reqs {
		if r == id {
			n++
		}
	}
	return n
}

// B1: a Tally that always takes 4 s for its company list: the bridge stops waiting at 2 s, keeps Tally's late answer,
// and the next ask takes it (nothing sent again): the company is found, a posting's look finds it, the busy mark goes
func TestR254ReviewB1LateListKept(t *testing.T) {
	mine := newStandTally(t)
	standBridge(t, mine, `,"TallyAbandonMaxSec":600`) // as on a real computer: Tally's answer read after the stop
	resetLate()
	t.Cleanup(resetLate)
	r253Server(t, `{"pid": 10, "name": "tally", "session": 1}`, fmt.Sprintf(`{"port": %d, "pid": 10}`, mine.port))
	mine.mu.Lock()
	mine.slow = func(id, body string) time.Duration {
		if id == "TDSDeskCompanies" {
			return 4 * time.Second
		}
		return 0
	}
	mine.mu.Unlock()
	t0 := time.Now()
	e := r253Entry(t, openCompanies(true), mine.port)
	if time.Since(t0) > 3*time.Second || len(sessCompanies(e)) != 0 {
		t.Fatalf("first ask: %v after %v", e, time.Since(t0))
	}
	time.Sleep(3500 * time.Millisecond) // Tally finishes the list 4 s after it was sent
	n := standCount(mine, "TDSDeskCompanies")
	e = r253Entry(t, openCompanies(true), mine.port)
	if e["ok"] != true || len(sessCompanies(e)) == 0 || e["late"] != true {
		t.Fatalf("the late list is not kept: %v", e)
	}
	if standCount(mine, "TDSDeskCompanies") != n {
		t.Fatal("the list was asked again (it was there)")
	}
	if port, _, err := findCompanyNow("ZZ TEST", 0); err != nil || port != mine.port {
		t.Fatalf("a posting's look: %d %v", port, err)
	}
	if getTallyStuck() != nil || notAnsweringSince() != "" {
		t.Fatalf("still marked not answering: %v", getTallyStuck())
	}
	if !strings.Contains(readText(logFile()), "its answer is kept as the answer") {
		t.Fatal("the log does not say the late answer was kept")
	}
	// a Tally restarted on the port (another program there) never gets the kept answer
	noteLateAnswer(mine.port, companiesRequest(), "<ENVELOPE></ENVELOPE>")
	old := listenerPidFn
	t.Cleanup(func() { listenerPidFn = old })
	listenerPidFn = func(int) int { return 99 }
	if _, ok := takeLateAnswer(mine.port, companiesRequest(), 0); ok { // the program there now: 99, not 10
		t.Fatal("a late answer of another program taken")
	}
}

// B2: a fresh ask (a posting, Test connection) is never held by the wait after a slow list; a wait noted for another
// program on the port is dropped
func TestR254ReviewB2FreshNotHeld(t *testing.T) {
	mine := newStandTally(t)
	standBridge(t, mine, "")
	resetLate()
	r253Server(t, `{"pid": 10, "name": "tally", "session": 1}`, fmt.Sprintf(`{"port": %d, "pid": 10}`, mine.port))
	if e := r253Entry(t, openCompanies(true), mine.port); e["ok"] != true {
		t.Fatalf("first list: %v", e)
	}
	colistMu.Lock()
	colistBack[mine.port] = colistWait{until: nowFn().Add(10 * time.Minute), n: 6, pid: 10}
	colistMu.Unlock()
	n := standCount(mine, "TDSDeskCompanies")
	e := r253Entry(t, openCompanies(true), mine.port)
	if standCount(mine, "TDSDeskCompanies") != n+1 || e["kept"] == true {
		t.Fatalf("a fresh ask was held: %v", e)
	}
	colistMu.Lock()
	colistBack[mine.port] = colistWait{until: nowFn().Add(10 * time.Minute), n: 6, pid: 10}
	colistMu.Unlock()
	if _, held := colistHold(mine.port, 11); held {
		t.Fatal("a wait of another program on the port held")
	}
	if _, held := colistHold(mine.port, 10); held {
		t.Fatal("the wait was not dropped with the other program")
	}
}

// B2: a kept list that does not name the company a posting wants: Tally is asked once more
func TestR254ReviewB2KeptListWithoutCompany(t *testing.T) {
	mine := newStandTally(t)
	standBridge(t, mine, "")
	resetLate()
	t.Cleanup(resetLate)
	r253Server(t, `{"pid": 10, "name": "tally", "session": 1}`, fmt.Sprintf(`{"port": %d, "pid": 10}`, mine.port))
	old := listenerPidFn
	t.Cleanup(func() { listenerPidFn = old })
	listenerPidFn = func(int) int { return 10 }
	noteLateAnswer(mine.port, companiesRequest(), `<ENVELOPE><BODY><DATA><COLLECTION><COMPANY NAME="OTHER CO"><NAME>OTHER CO</NAME><GUID>g2</GUID></COMPANY></COLLECTION></DATA></BODY></ENVELOPE>`)
	n := standCount(mine, "TDSDeskCompanies")
	port, _, err := findCompanyNow("ZZ TEST", 0)
	if err != nil || port != mine.port || standCount(mine, "TDSDeskCompanies") != n+1 {
		t.Fatalf("not asked once more: %d %v (%d sent)", port, err, standCount(mine, "TDSDeskCompanies")-n)
	}
}

// S1: "Check for updates" while an update waits to start again (or before it ran well) never puts it in place again
func TestR254ReviewS1NoSecondApply(t *testing.T) {
	r254Bridge(t)
	var hits atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { hits.Add(1); w.WriteHeader(404) }))
	defer srv.Close()
	setCfg("UpdateUrl", srv.URL)
	t.Cleanup(func() { setCfg("UpdateUrl", "") })
	setUpd("applying", true)
	if m := checkForUpdate(true); hits.Load() != 0 || !strings.Contains(str(m["message"]), "start") {
		t.Fatalf("looked again while an update waits: %d hits, %v", hits.Load(), m)
	}
	setUpd("applying", false)
	dir := t.TempDir()
	oldE := exePathFn
	exePathFn = func() string { return filepath.Join(dir, "FinComBridge.exe") }
	t.Cleanup(func() { exePathFn = oldE })
	_ = os.WriteFile(filepath.Join(dir, "update-pending.json"), []byte(`{"from":"2.5.3"}`), 0o644)
	if _, ran := checkForUpdateOnce(true); !ran || hits.Load() != 0 {
		t.Fatalf("looked again before the new one ran well: %d hits", hits.Load())
	}
	// (re-review N1: the flag stays only while an update this bridge put in place waits to start again; a look that only
	// found update-pending.json clears it: r254review2_test.go)
	if updChecking.Load() {
		t.Fatal("the one-look flag stays after a look that put nothing in place")
	}
	_ = os.Remove(filepath.Join(dir, "update-pending.json"))
	if _, ran := checkForUpdateOnce(true); !ran || hits.Load() == 0 || updChecking.Load() {
		t.Fatalf("no update pending: looked %d, flag %v", hits.Load(), updChecking.Load())
	}
}

// S1: the wait for a quiet moment has a maximum: after it, the first quiet look starts it again (never mid-request)
func TestR254ReviewS1QuietMax(t *testing.T) {
	r254Bridge(t)
	oldQ, oldM := tallyQuietFn, updQuietMax
	t.Cleanup(func() { tallyQuietFn, updQuietMax = oldQ, oldM })
	updQuietMax = 100 * time.Millisecond
	var looks atomic.Int32
	// never two quiet looks in a row: busy, quiet, busy, quiet...
	tallyQuietFn = func() bool { return looks.Add(1)%2 == 0 }
	var restarted atomic.Bool
	done := make(chan struct{})
	go func() {
		updateRestartWhenQuiet(10*time.Millisecond, func() {
			restarted.Store(looks.Load()%2 == 0) // at a quiet look
		})
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(3 * time.Second):
		t.Fatal("never started again though quiet moments came")
	}
	if !restarted.Load() {
		t.Fatal("started again at a busy look")
	}
}

// S2: with a bridge before 2.5.4 (no claimRule on its /ping) the tie is the bridge port, as that bridge decides it;
// this bridge's /ping says its rule
func TestR254ReviewS2MixedVersions(t *testing.T) {
	r254Bridge(t)
	// hemant's 2.5.3 bridge on 9109, saurabh's 2.5.4 on 9102: 2.5.3 keeps it only if its port is lower (no): saurabh keeps it
	if claimWins(bridgeClaim{port: 9109, unknown: true, user: "hemant"}, 9102, "saurabh") {
		t.Fatal("an older bridge's claim judged by user name")
	}
	if !claimWins(bridgeClaim{port: 9109, unknown: true, user: "hemant", rule: claimRuleUser}, 9102, "saurabh") {
		t.Fatal("two 2.5.4 bridges: by user name")
	}
	r := httptest.NewRequest("GET", "http://127.0.0.1:9100/ping", nil)
	w := httptest.NewRecorder()
	handle(w, r)
	if str(parseObj(w.Body.String())["claimRule"]) != claimRuleUser {
		t.Fatalf("/ping: %s", w.Body.String())
	}
}

// S3: a company's GSTIN / PAN that did not come in time is not kept empty for 6 hours: asked again after 5 minutes
func TestR254ReviewS3CoInfoNotCachedOnFailure(t *testing.T) {
	mine := newStandTally(t)
	standBridge(t, mine, "")
	resetLate()
	resetCoInfo()
	t.Cleanup(func() { nowFn = time.Now; resetCoInfo() })
	var slow atomic.Bool
	slow.Store(true)
	mine.mu.Lock()
	mine.slow = func(id, body string) time.Duration {
		if id == "TDSDeskCompanyInfo" && slow.Load() {
			return 25 * time.Second // past the wait: no late answer either
		}
		return 0
	}
	mine.mu.Unlock()
	_ = getCoInfo(fin, "ZZ TEST", mine.port)
	n := standCount(mine, "TDSDeskCompanyInfo")
	coInfoMu.Lock()
	_, kept := coInfo["ZZ TEST"]
	coInfoMu.Unlock()
	if kept {
		t.Fatal("a failed GSTIN / PAN is kept")
	}
	_ = getCoInfo(fin, "ZZ TEST", mine.port)
	if standCount(mine, "TDSDeskCompanyInfo") != n {
		t.Fatal("asked again at once")
	}
	slow.Store(false)
	resetLate()
	base := time.Now()
	nowFn = func() time.Time { return base.Add(6 * time.Minute) }
	probeMu.Lock()
	probes = map[int]*probeState{}
	probeMu.Unlock()
	resetEarlier()
	_ = getCoInfo(fin, "ZZ TEST", mine.port)
	coInfoMu.Lock()
	_, kept = coInfo["ZZ TEST"]
	coInfoMu.Unlock()
	if standCount(mine, "TDSDeskCompanyInfo") != n+1 || !kept {
		t.Fatalf("not asked again after 5 minutes (%d), kept %v", standCount(mine, "TDSDeskCompanyInfo")-n, kept)
	}
}

// S4: the setup moves a FinComBridge.setup-old.exe still in use to a name of its own, so its own rename never fails
func TestR254ReviewS4SetupOldInUse(t *testing.T) {
	b, _ := os.ReadFile(filepath.Join("installer", "FinComBridge.nsi"))
	s := string(b)
	i := strings.Index(s, `Rename "$INSTDIR\FinComBridge.setup-old.exe" "$INSTDIR\FinComBridge.setup-old-$9.exe"`)
	j := strings.Index(s, `Rename "$INSTDIR\FinComBridge.exe" "$INSTDIR\FinComBridge.setup-old.exe"`)
	if i < 0 || j < 0 || i > j {
		t.Fatal("a setup-old.exe in use is not moved aside before the program is")
	}
	if !strings.Contains(s, `Delete /REBOOTOK "$INSTDIR\FinComBridge.setup-old.exe"`) || !strings.Contains(s, `Delete "$INSTDIR\FinComBridge.setup-old-*.exe"`) {
		t.Fatal("the uninstall does not handle files still in use by another user's icon")
	}
}

// M1: the production code of 2.5.4 does not import package testing
func TestR254ReviewM1NoTestingImport(t *testing.T) {
	for _, f := range []string{"iniconnect254.go", "owntally254.go", "colist254.go", "snapcache254.go", "late254.go"} {
		af, err := parser.ParseFile(token.NewFileSet(), f, nil, parser.ImportsOnly)
		if err != nil {
			t.Fatal(err)
		}
		for _, im := range af.Imports {
			if im.Path.Value == `"testing"` {
				t.Fatalf("%s imports testing", f)
			}
		}
	}
}

// M2: a Microsoft Entra ID user (S-1-12-1-...) is a person's account
func TestR254ReviewM2EntraSid(t *testing.T) {
	r253Server(t, "", "")
	old := ownSIDsOf
	t.Cleanup(func() { ownSIDsOf = old })
	const me, other = "S-1-12-1-111-222-333-444", "S-1-12-1-555-666-777-888"
	ownSIDsOf = func() []string { return []string{me} }
	if !isUserSid(me) || sessionOwner(proc{SessionUnknown: true, Sid: me}) != "mine" || sessionOwner(proc{SessionUnknown: true, Sid: other}) != "other" {
		t.Fatal("Entra ID users not told apart")
	}
}
