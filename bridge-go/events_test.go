package main

// FinCom Bridge 2.1.3: the bridge wakes on events and a posting always wins over a background read. A stand-in Tally
// (an httptest server that can be slow) counts every request it is sent.

import (
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

const zz = "ZZ TEST"

type standIn struct {
	srv       *httptest.Server
	port      int
	mu        sync.Mutex
	reqs      []string // the request ids, in order
	bodies    []string
	cancelled int // requests closed by the bridge before they were answered
	// how to answer: by request id; nil: the default answer
	slow func(id, body string) time.Duration
}

func (s *standIn) count(id string) int {
	s.mu.Lock()
	defer s.mu.Unlock()
	n := 0
	for _, r := range s.reqs {
		if id == "" || r == id {
			n++
		}
	}
	return n
}
func (s *standIn) bodiesWith(id, part string) int {
	s.mu.Lock()
	defer s.mu.Unlock()
	n := 0
	for _, r := range s.bodies {
		if strings.Contains(r, "<ID>"+id+"</ID>") && strings.Contains(r, part) {
			n++
		}
	}
	return n
}

var reBalName = regexp.MustCompile(`\$Name = (?:&#34;|&quot;|")([^&"]+)`)

func newStandIn(t *testing.T, ledgers int) *standIn {
	s := &standIn{}
	s.srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b := make([]byte, 0, 4096)
		buf := make([]byte, 4096)
		for {
			n, err := r.Body.Read(buf)
			b = append(b, buf[:n]...)
			if err != nil {
				break
			}
		}
		body := string(b)
		id := group(`<ID>([^<]+)</ID>`, body, 1)
		if strings.Contains(body, "Import Data") {
			id = "Import"
		}
		s.mu.Lock()
		s.reqs = append(s.reqs, id)
		s.bodies = append(s.bodies, body)
		slow := s.slow
		s.mu.Unlock()
		if slow != nil {
			if d := slow(id, body); d > 0 {
				select {
				case <-time.After(d):
				case <-r.Context().Done():
					s.mu.Lock()
					s.cancelled++
					s.mu.Unlock()
					return
				}
			}
		}
		out := "<ENVELOPE></ENVELOPE>"
		switch id {
		case "TDSDeskCompanies":
			out = `<ENVELOPE><COLLECTION><COMPANY NAME="` + zz + `"><NAME>` + zz + `</NAME><STARTINGFROM>20260401</STARTINGFROM><ENDINGAT>20270331</ENDINGAT><GUID>g-1</GUID></COMPANY></COLLECTION></ENVELOPE>`
		case "TDSDeskKeepCo":
			out = `<ENVELOPE><COMPANY><NAME>` + zz + `</NAME><ALTVCHID>5</ALTVCHID><ALTMSTID>3</ALTMSTID></COMPANY></ENVELOPE>`
		case "TDSDeskNames":
			var l strings.Builder
			for i := 1; i <= ledgers; i++ {
				fmt.Fprintf(&l, `<LEDGER NAME="L%02d"><PARENT>Sundry Creditors</PARENT></LEDGER>`, i)
			}
			out = "<ENVELOPE>" + l.String() + "</ENVELOPE>"
		case "TDSDeskKeepBal":
			var l strings.Builder
			for _, m := range reBalName.FindAllStringSubmatch(body, -1) {
				fmt.Fprintf(&l, `<LEDGER NAME="%s"><PARENT>Sundry Creditors</PARENT><CLOSINGBALANCE>100.00</CLOSINGBALANCE></LEDGER>`, m[1])
			}
			out = "<ENVELOPE>" + l.String() + "</ENVELOPE>"
		case "Import":
			out = "<ENVELOPE><BODY><DATA><IMPORTRESULT><CREATED>1</CREATED><ALTERED>0</ALTERED><ERRORS>0</ERRORS><EXCEPTIONS>0</EXCEPTIONS></IMPORTRESULT></DATA></BODY></ENVELOPE>"
		}
		_, _ = w.Write([]byte(out))
	}))
	s.port = s.srv.Listener.Addr().(*net.TCPAddr).Port
	t.Cleanup(s.srv.Close)
	return s
}

// a bridge in a folder of its own, using the stand-in Tally; the state of earlier tests forgotten
func bridgeFor(t *testing.T, s *standIn, extra string) string {
	waitIdle(t)
	dir := t.TempDir()
	oldC, oldH := ConfigPath, Home
	t.Cleanup(func() { waitIdle(t); ConfigPath, Home = oldC, oldH; nowFn = time.Now; loadConfigRO() })
	ConfigPath, Home = filepath.Join(dir, "tds-bridge.config.json"), dir
	j := func(p string) string { return filepath.ToSlash(filepath.Join(dir, p)) }
	cfgText := fmt.Sprintf(`{"TallyPorts":[%d],"TallyHost":"127.0.0.1","AllowImport":true,"LogFile":"%s","SyncDir":"%s","JobsDir":"%s","KeepInStep":true,"GentleMs":0,
		"KeepRestMs":10,"KeepCycleSec":1,"KeepSharePct":100,"KeepNightSharePct":100,"KeepStartSec":60%s}`, s.port, j("b.log"), j("sync"), j("jobs"), extra)
	_ = os.WriteFile(ConfigPath, []byte(cfgText), 0o644)
	loadConfig()
	_ = os.MkdirAll(syncDir(), 0o755)
	// forget what an earlier test left in memory
	nowFn = time.Now
	coMu.Lock()
	coCache, coInfo = nil, nil
	coMu.Unlock()
	coolMu.Lock()
	tallyCool = map[int]cool{}
	coolMu.Unlock()
	busyMu.Lock()
	busySince, inflight = map[int]time.Time{}, map[int]time.Time{}
	busyMu.Unlock()
	bgMu.Lock()
	bgBack = map[int]keepBack{}
	bgMu.Unlock()
	evMu.Lock()
	openSeen, openFromBeat, postedFor, cloudUseAt, ownUseAt = map[string]time.Time{}, map[string]string{}, map[string]time.Time{}, time.Time{}, time.Time{}
	evMu.Unlock()
	useMu.Lock()
	tallyUse = map[int][]use{}
	useMu.Unlock()
	wantMu.Lock()
	wantAt = time.Time{}
	wantMu.Unlock()
	pausedB, tallyStandInClosed, turnFirst, nightAt = false, false, true, time.Time{}
	forgetTallyOpen()
	return dir
}

// a company kept in step and up to date (as after its first copy)
func liveCopy(t *testing.T) {
	dir := syncFolder(zz)
	_ = os.MkdirAll(filepath.Join(dir, "days"), 0o755)
	td := today()
	saveKeepState(dir, M{"company": zz, "from": td, "next": addDays(td, 1), "slice": 1, "phase": "live", "openIdx": 0, "last": 5, "lastM": 3, "cv": 5, "cm": 3, "ledIds": true,
		"checkYm": td[:6], "months": M{}, "cycle": 0, "skipped": []any{}, "dayFail": 0, "roundFrom": td, "roundAt": td, "at": nowS()})
	_ = saveFile(filepath.Join(dir, "groups.json"), "[]")
	_ = saveFile(filepath.Join(dir, "ledgers.json"), "{}")
	_ = saveFile(filepath.Join(dir, "balances.json"), jsonText(M{"ok": true, "company": zz, "from": td, "openAsOn": addDays(td, -1), "ledgers": []any{}}))
}

func waitIdle(t *testing.T) {
	for i := 0; i < 600 && keepRunning(); i++ {
		time.Sleep(100 * time.Millisecond)
	}
	if keepRunning() {
		t.Fatal("a run of the copier did not end")
	}
}
func logLines(part string) int {
	n := 0
	for _, l := range strings.Split(readText(logFile()), "\n") {
		if strings.Contains(l, part) {
			n++
		}
	}
	return n
}

// (f) "Is Tally open?" sends Tally no request: its program running and its port taking a connection
func TestTallyOpenAsksNothing(t *testing.T) {
	s := newStandIn(t, 0)
	bridgeFor(t, s, "")
	if p := tallyOpenNow(); p != s.port {
		t.Fatalf("Tally open on %d, got %d", s.port, p)
	}
	tallyStandInClosed = true
	forgetTallyOpen()
	if tallyOpenNow() != 0 || tallyState(s.port) != "closed" {
		t.Fatal("the program closed: Tally is closed")
	}
	tallyStandInClosed = false
	forgetTallyOpen()
	if st := openCompaniesCached(); len(st) != 1 || str(st[0]["tallyState"]) != "open" {
		t.Fatalf("cached companies: %v", st)
	}
	if n := s.count(""); n != 0 {
		t.Fatalf("the open check sent Tally %d request(s)", n)
	}
	ln, _ := net.Listen("tcp", "127.0.0.1:0")
	closed := ln.Addr().(*net.TCPAddr).Port
	ln.Close()
	setCfg("TallyPorts", []any{float64(closed)})
	forgetTallyOpen()
	if tallyOpenNow() != 0 {
		t.Fatal("nothing listens: Tally is closed")
	}
}

// (b) no events for 30 minutes (an injected clock): not one request to Tally, whatever the heartbeat, the tray and
// FinCom's status checks ask
func TestIdleSendsNothing(t *testing.T) {
	s := newStandIn(t, 0)
	bridgeFor(t, s, "")
	liveCopy(t)
	_ = saveFile(filepath.Join(syncDir(), "open-companies.json"), jsonText([]any{M{"port": s.port, "ok": true, "companies": []any{M{"name": zz}}}}))
	start := time.Date(2026, 10, 2, 10, 0, 0, 0, time.Local)
	safe := func(name string, f func()) { f() }
	for sec := 0; sec <= 1800; sec += 5 {
		nowFn = func() time.Time { return start.Add(time.Duration(sec) * time.Second) }
		bridgeTurn(safe)
		_ = trayStatus()
		_ = openCompaniesCached()
		_ = beatBody(true, "open", "", nil, nil, nil)
		_ = keepStatus(zz)
	}
	time.Sleep(700 * time.Millisecond)
	waitIdle(t)
	if n := s.count(""); n != 0 {
		t.Fatalf("idle for 30 minutes, yet %d request(s) went to Tally: %v", n, s.reqs)
	}
	if tallyOpenNow() != s.port {
		t.Fatal("Tally was open all along (so nothing was skipped for being closed)")
	}
}

// (c) a client opened in FinCom: exactly one light update; opened again within the debounce: none
func TestOpenClientOneLightUpdate(t *testing.T) {
	s := newStandIn(t, 0)
	bridgeFor(t, s, "")
	liveCopy(t)
	if !wakeOpen(zz, "opened in FinCom") {
		t.Fatal("the first opening started nothing")
	}
	waitIdle(t)
	if n := s.count("TDSDeskKeepCo"); n != 1 {
		t.Fatalf("one light update reads the change counters once, got %d (%v)", n, s.reqs)
	}
	before := s.count("")
	if logLines("Light update: done") != 1 {
		t.Fatal("the light update did not finish")
	}
	if wakeOpen(zz, "opened in FinCom") {
		t.Fatal("opened again within the debounce: a second light update")
	}
	time.Sleep(300 * time.Millisecond)
	waitIdle(t)
	if n := s.count(""); n != before {
		t.Fatalf("opened again within the debounce: %d more request(s)", n-before)
	}
	// a few minutes later it reads again
	nowFn = func() time.Time { return time.Now().Add(6 * time.Minute) }
	if !wakeOpen(zz, "opened in FinCom") {
		t.Fatal("after the debounce: no light update")
	}
	waitIdle(t)
	if s.count("TDSDeskKeepCo") != 2 {
		t.Fatal("after the debounce: one more light update")
	}
	// paused in the tray: opening a client reads nothing
	nowFn = func() time.Time { return time.Now().Add(20 * time.Minute) }
	pausedB = true
	if wakeOpen(zz, "opened in FinCom") {
		t.Fatal("background reading paused, yet a light update started")
	}
	pausedB = false
}

// (e) after a failure Tally is left alone: one line in the log, and nothing at all is sent during the back-off
func TestBackoffSendsNothing(t *testing.T) {
	s := newStandIn(t, 0)
	s.slow = func(id, body string) time.Duration {
		if id == "TDSDeskKeepCo" {
			return 3 * time.Second
		}
		return 0
	}
	bridgeFor(t, s, `,"TallyMaxSec":1,"KeepBackoffSec":300,"KeepRunMin":1`)
	liveCopy(t)
	if !wakeOpen(zz, "opened in FinCom") {
		t.Fatal("no light update")
	}
	waitIdle(t)
	if logLines("Leaving Tally alone until") != 1 {
		t.Fatalf("the back-off: %d line(s)", logLines("Leaving Tally alone until"))
	}
	sent := s.count("")
	// events during the back-off: another client opened, Update now, the nightly catch-up
	evMu.Lock()
	openSeen = map[string]time.Time{}
	evMu.Unlock()
	wakeOpen(zz, "opened in FinCom")
	waitIdle(t)
	wakeUpdate("")
	waitIdle(t)
	startKeepRun(runReq{kind: "nightly", why: "test"})
	waitIdle(t)
	time.Sleep(500 * time.Millisecond)
	if n := s.count(""); n != sent {
		t.Fatalf("during the back-off %d request(s) went to Tally", n-sent)
	}
	if logLines("Leaving Tally alone until") != 1 {
		t.Fatalf("during the back-off the log says it %d times", logLines("Leaving Tally alone until"))
	}
}

// (d of the requirements) the nightly catch-up: only in its window, only when nobody has used FinCom for 15 minutes
func TestNightlyWaitsForQuiet(t *testing.T) {
	s := newStandIn(t, 0)
	bridgeFor(t, s, "")
	liveCopy(t)
	day := time.Now()
	at := func(h, m int) time.Time { return time.Date(day.Year(), day.Month(), day.Day(), h, m, 0, 0, time.Local) }
	if keepDailyAt() != "02:00" {
		t.Fatal("the nightly catch-up is at 02:00 unless set")
	}
	if due, _ := nightlyDue(at(1, 59)); due {
		t.Fatal("due before 02:00")
	}
	if due, _ := nightlyDue(at(11, 0)); due {
		t.Fatal("due on a working morning")
	}
	ownUseAt = at(1, 58)
	nowFn = func() time.Time { return at(2, 5) }
	nightlyCheck()
	if keepRunning() || s.count("") != 0 {
		t.Fatal("started while FinCom was used 7 minutes ago")
	}
	noteCloudUse(at(2, 1).Format("2006-01-02T15:04:05"))
	nowFn = func() time.Time { return at(2, 14) }
	nightlyCheck()
	if keepRunning() || s.count("") != 0 {
		t.Fatal("started 13 minutes after the cloud's last activity")
	}
	nowFn = func() time.Time { return at(2, 17) }
	nightlyCheck()
	waitIdle(t)
	if s.count("") == 0 || logLines("Nightly catch-up (02:00)") != 1 {
		t.Fatal("the catch-up did not run after 15 quiet minutes")
	}
	if keepLastRun() != today() {
		t.Fatal("the night's run is not recorded")
	}
	n := s.count("")
	nowFn = func() time.Time { return at(3, 30) }
	nightlyCheck()
	waitIdle(t)
	if s.count("") != n {
		t.Fatal("a second catch-up the same night")
	}
}
