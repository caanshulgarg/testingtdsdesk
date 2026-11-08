package main

// bridge 2.5.10: the bridge heals itself (selfheal.go, keepalive.go): the heartbeat's watchdog, its retries, a sleep or a
// network change noticed, why the last run ended said in the beat, and the keep-alive task's command line
import (
	"fmt"
	"net/http/httptest"
	"os"
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"
)

func r2510HealBridge(t *testing.T) {
	t.Helper()
	f := newStandTally(t)
	standBridge(t, f, `,"Key":"own-user-key"`)
	oldW, oldM, oldP, oldR, oldX, oldH, oldB := wallNow, monoNow, netPrint, runMode, beatWatchExit, hangBeat, watchBusy
	oldLast, oldLook := netLast, netLookAt
	t.Cleanup(func() {
		wallNow, monoNow, netPrint, runMode, beatWatchExit, hangBeat, watchBusy = oldW, oldM, oldP, oldR, oldX, oldH, oldB
		netLast, netLookAt = oldLast, oldLook
		beatLoopAt.Store(0)
		resetEarlier()
	})
	for _, p := range []string{lastStopFile(), runningFile(), keepAliveHintFile(), crashLogFile(), keepAliveMarkFile()} {
		_ = os.Remove(p)
	}
}

// a failed heartbeat is tried again after 5 s, growing to a minute (never more than the usual time), for ever
func TestR2510BeatPause(t *testing.T) {
	every := 30 * time.Second
	want := []time.Duration{5, 10, 20, 30, 30, 30}
	for i, w := range want {
		if d := beatPause(false, i, every); d != w*time.Second {
			t.Fatalf("failure %d: %s, want %ds", i+1, d, w)
		}
	}
	long := 5 * time.Minute
	for i, w := range []time.Duration{5, 10, 20, 40, 60, 60} {
		if d := beatPause(false, i, long); d != w*time.Second {
			t.Fatalf("every 5 min, failure %d: %s", i+1, d)
		}
	}
	if d := beatPause(false, 1000, long); d != time.Minute {
		t.Fatalf("after many: %s", d)
	}
	if d := beatPause(true, 7, every); d != every {
		t.Fatalf("answered: %s", d)
	}
}

// the wait ends at once after a sleep (the wall clock jumped), a network change, a beat asked for, a stop
func TestR2510BeatWaitWakes(t *testing.T) {
	r2510HealBridge(t)
	netPrint = func() string { return "10.0.0.5/24" }
	netLast, netLookAt = "10.0.0.5/24", time.Time{}
	if w := beatWait(150*time.Millisecond, nil, nil); w != "" {
		t.Fatalf("a quiet wait: %q", w)
	}
	if beatSec() > 1 {
		t.Fatal("the loop's progress not noted")
	}
	// the computer slept: the wall clock moves 40 minutes in a slice of 150 ms
	base := time.Date(2026, 11, 8, 8, 35, 57, 0, time.UTC)
	var mu sync.Mutex
	n := 0
	wallNow = func() time.Time {
		mu.Lock()
		defer mu.Unlock()
		n++
		if n == 1 {
			return base
		}
		return base.Add(40 * time.Minute)
	}
	if w := beatWait(300*time.Millisecond, nil, nil); w != "sleep" {
		t.Fatalf("after a sleep: %q", w)
	}
	s := readLastStop()
	if s == nil || s.Why != "sleep" || !s.At.Equal(base) || !s.Back.Equal(base.Add(40*time.Minute)) {
		t.Fatalf("the sleep written down: %+v", s)
	}
	if !strings.Contains(readText(crashLogFile()), `"why":"sleep"`) {
		t.Fatal("not in the crash log")
	}
	wallNow = func() time.Time { return time.Now().Round(0) }
	// the network changed
	netPrint, netLookAt = func() string { return "192.168.1.9/24" }, time.Time{}
	if w := beatWait(300*time.Millisecond, nil, nil); w != "network" {
		t.Fatalf("a network change: %q", w)
	}
	now, stop := make(chan struct{}, 1), make(chan struct{})
	now <- struct{}{}
	if w := beatWait(time.Minute, now, stop); w != "now" {
		t.Fatalf("asked for: %q", w)
	}
	close(stop)
	if w := beatWait(time.Minute, nil, stop); w != "stop" {
		t.Fatalf("stopped: %q", w)
	}
}

// the supervisor's notes: a panic (Go's exit code 2), another code, a hang it ended; a stop or a restart asked for: none
func TestR2510LastStopKinds(t *testing.T) {
	r2510HealBridge(t)
	for _, c := range []struct {
		code int
		hung bool
		why  string
	}{{2, false, "panic"}, {1, false, "exit"}, {9, true, "hang"}, {-1073741510, false, "exit"}} {
		_ = os.Remove(lastStopFile())
		runEnded()
		runStarted()
		superviseNote(c.code, c.hung)
		runStarted()
		b := obj(lastStopBeat())
		if str(b["why"]) != c.why || toInt(b["code"]) != c.code {
			t.Fatalf("code %d: %v", c.code, b)
		}
		if w := lastStopWords(c.why, c.code); w == "" || strings.ContainsAny(w, `\/`) {
			t.Fatalf("its words: %q", w)
		}
	}
	for _, code := range []int{0, 3} {
		_ = os.Remove(lastStopFile())
		runEnded()
		runStarted()
		superviseNote(code, false)
		runEnded()
		runStarted()
		if lastStopBeat() != nil {
			t.Fatalf("code %d said: %v", code, lastStopBeat())
		}
	}
	// ended without a word (its mark still there): unclean; the keep-alive task's start: not running
	_ = os.Remove(lastStopFile())
	_ = saveFile(runningFile(), time.Now().Add(-20*time.Minute).UTC().Format(time.RFC3339))
	old := time.Now().Add(-20 * time.Minute)
	_ = os.Chtimes(runningFile(), old, old)
	runStarted()
	b := obj(lastStopBeat())
	if str(b["why"]) != "unclean" {
		t.Fatalf("unclean: %v", b)
	}
	if at, _ := time.Parse(time.RFC3339, str(b["at"])); time.Since(at) < 19*time.Minute {
		t.Fatalf("its time is when it was last alive: %v", b)
	}
	_ = os.Chtimes(runningFile(), old, old)
	_ = saveFile(keepAliveHintFile(), "x")
	runStarted()
	if b := obj(lastStopBeat()); str(b["why"]) != "notRunning" {
		t.Fatalf("by the keep-alive task: %v", b)
	}
	// said for 6 hours after it ran again
	s := readLastStop()
	s.Back = time.Now().Add(-7 * time.Hour)
	saveLastStop(*s)
	if lastStopBeat() != nil {
		t.Fatal("said after 6 hours")
	}
}

// the crash log rotates at 256 KB, one earlier file kept
func TestR2510CrashLogRotates(t *testing.T) {
	r2510HealBridge(t)
	_ = saveFile(crashLogFile(), strings.Repeat("x", 300*1024))
	crashLogLine(`{"why":"exit"}`)
	if fi, err := os.Stat(crashLogFile() + ".1"); err != nil || fi.Size() < 300*1024 {
		t.Fatal("not rotated")
	}
	if s := readText(crashLogFile()); !strings.Contains(s, `"why":"exit"`) || len(s) > 1024 {
		t.Fatalf("the new file: %d bytes", len(s))
	}
}

// the kind of a log line, never its words
func TestR2510LogCategory(t *testing.T) {
	for line, want := range map[string]string{
		"2026-11-08 08:35:57  Heartbeat: FinCom reached again (not reached for 5s)":    "heartbeat",
		"2026-11-08 08:35:57  Posting job job-1: request 1 of 2 (5 vouchers) in 0.4 s": "posting",
		"2026-11-08 08:35:57  Older entries of MADE UP CO: 01-Jul-2025 waits":          "olderEntries",
		"2026-11-08 08:35:57  Watchdog: the bridge hangs":                              "watchdog",
		"2026-11-08 08:35:57  Tally is not open; the bridge reads it only after":       "tally",
		"2026-11-08 08:35:57  Something else entirely":                                 "other",
		"": "",
	} {
		if g := logCategory(line); g != want {
			t.Fatalf("%q: %q, want %q", line, g, want)
		}
	}
}

// review of 2.5.10 (1): the stall is judged by the progress count across the watchdog's looks: a late look (a sleep, a
// hibernate, a clock jumped forward or back) starts the count again; two looks or more without a move are needed
func TestR2510StallTracker(t *testing.T) {
	tr := stallTracker{every: 15 * time.Second}
	at := time.Date(2026, 11, 8, 8, 0, 0, 0, time.UTC)
	look := func(n int64, d time.Duration) (time.Duration, bool) { at = at.Add(d); return tr.observe(n, at) }
	look(1, 0)
	if st, _ := look(1, 15*time.Second); st != 0 {
		t.Fatalf("one look without a move: %s", st)
	}
	for i := 0; i < 10; i++ {
		look(1, 15*time.Second)
	}
	if st, _ := look(1, 15*time.Second); st != 3*time.Minute {
		t.Fatalf("12 looks without a move: %s", st)
	}
	// the computer slept 10 minutes (or hibernated, or the clock jumped): a late look, the count starts again
	if st, slept := look(1, 10*time.Minute); st != 0 || !slept {
		t.Fatalf("after a 10-minute sleep: %s %v", st, slept)
	}
	if st, _ := look(1, 15*time.Second); st != 0 {
		t.Fatalf("the first look after it: %s", st)
	}
	// the clock set back
	if st, slept := look(1, -time.Hour); st != 0 || !slept {
		t.Fatalf("the clock back: %s %v", st, slept)
	}
	// a move: nothing
	look(2, 15*time.Second)
	if st, _ := look(3, 15*time.Second); st != 0 {
		t.Fatalf("moving: %s", st)
	}
}

// the heartbeat stalled: the worker ends itself (code 13) with the reason written, when something starts it again;
// a 10-minute sleep is never taken for a stall (review 1); a posting or a busy Tally first (review 2)
func TestR2510WatchdogStallRestarts(t *testing.T) {
	r2510HealBridge(t)
	runStarted()
	var mu sync.Mutex
	var got []int
	beatWatchExit = func(c int) { mu.Lock(); got = append(got, c); mu.Unlock() }
	exits := func() int { mu.Lock(); defer mu.Unlock(); return len(got) }
	hangBeat = 60 * time.Millisecond
	watchBusy = func() string { return "" }
	watch := func(d time.Duration) {
		stop := make(chan struct{})
		done := make(chan struct{})
		go func() { beatWatch(stop, 10*time.Millisecond); close(done) }()
		select {
		case <-done:
		case <-time.After(d):
		}
		close(stop)
		<-done
	}
	// by hand (window): said, never ended
	runMode = "window"
	watch(200 * time.Millisecond)
	if exits() != 0 || !strings.Contains(readText(logFile()), "started by hand: nothing restarts it") {
		t.Fatalf("by hand: ended %v", got)
	}
	runMode = "user"
	// moving: nothing
	stopMove := make(chan struct{})
	go func() {
		for {
			select {
			case <-stopMove:
				return
			case <-time.After(3 * time.Millisecond):
				noteBeat()
			}
		}
	}()
	watch(200 * time.Millisecond)
	close(stopMove)
	if exits() != 0 {
		t.Fatalf("a moving heartbeat ended: %v", got)
	}
	// a 10-minute sleep at each look (the heartbeat still, as while asleep): never a stall, the sleep note kept
	base := time.Now()
	var n int
	wallNow = func() time.Time {
		mu.Lock()
		defer mu.Unlock()
		n++
		return base.Add(time.Duration(n) * 10 * time.Minute)
	}
	noteSleep(base, base.Add(10*time.Minute))
	watch(200 * time.Millisecond)
	if exits() != 0 {
		t.Fatalf("a sleep taken for a stall: %v", got)
	}
	if s := readLastStop(); s == nil || s.Why != "sleep" {
		t.Fatalf("the sleep note: %+v", s)
	}
	wallNow = func() time.Time { return time.Now().Round(0) }
	// a posting being sent: the exit waits (TallyAbandonMaxSec at most), then goes
	setCfg("TallyAbandonMaxSec", 1)
	t.Cleanup(func() { setCfg("TallyAbandonMaxSec", nil) })
	watchBusy = func() string { return "a posting is being sent to Tally" }
	writeLog("Older entries of MADE UP CO: 01-Jul-2025 waits")
	stop := make(chan struct{})
	done := make(chan struct{})
	t0 := time.Now()
	go func() { beatWatch(stop, 10*time.Millisecond); close(done) }()
	time.Sleep(500 * time.Millisecond)
	if exits() != 0 {
		t.Fatal("ended while a posting was being sent")
	}
	select {
	case <-done:
	case <-time.After(4 * time.Second):
		t.Fatal("never ended after TallyAbandonMaxSec")
	}
	close(stop)
	if exits() != 1 || got[0] != exitStall || time.Since(t0) < time.Second {
		t.Fatalf("ended with %v after %s", got, time.Since(t0))
	}
	if !strings.Contains(readText(logFile()), "ends itself once a posting is being sent to Tally no more") {
		t.Fatal("the wait not said")
	}
	s := readLastStop()
	if s == nil || s.Why != "stall" || s.Log != "olderEntries" {
		t.Fatalf("the reason: %+v", s)
	}
	if lastStopBeat() != nil {
		t.Fatal("said before it runs again")
	}
	superviseNote(exitStall, false)
	runStarted()
	b := obj(lastStopBeat())
	if str(b["why"]) != "stall" || str(b["log"]) != "olderEntries" || str(b["back"]) == "" || str(b["at"]) == "" || b["code"] != nil {
		t.Fatalf("the beat's lastStop: %v", b)
	}
	if strings.Contains(jsonText(b), "MADE UP") {
		t.Fatal("a log line's words in the beat")
	}
	if l, ok := beatBody(false, "closed", "", nil, nil, nil)["lastStop"].(M); !ok || str(l["why"]) != "stall" {
		t.Fatalf("not in the beat's body: %v", beatBody(false, "closed", "", nil, nil, nil)["lastStop"])
	}
	// review 7: a worker that ended with code 9 by itself is not a hang (only one the supervisor ended is)
	runEnded()
	runStarted()
	superviseNote(9, false)
	runStarted()
	if b := obj(lastStopBeat()); str(b["why"]) != "exit" || toInt(b["code"]) != 9 {
		t.Fatalf("code 9 by itself: %v", b)
	}
}

// review of 2.5.10 (2): a Tally still on a request given up is held across a restart, until TallyAbandonMaxSec after
// the send; then the small check is owed and the hold goes
func TestR2510EarlierHoldKeptAcrossRestart(t *testing.T) {
	r2510HealBridge(t)
	resetEarlier()
	setCfg("TallyAbandonMaxSec", 2)
	t.Cleanup(func() { setCfg("TallyAbandonMaxSec", nil) })
	port := 43991
	sl := &abandonSlot{done: make(chan struct{}), id: "FinComDayHeads", at: time.Now().Add(-1200 * time.Millisecond)}
	holdUntilAnswered(port, sl, func() {})
	m := readObjFile(earlierFile())
	if e := obj(m[fmt.Sprint(port)]); str(e["id"]) != "FinComDayHeads" || str(e["until"]) == "" {
		t.Fatalf("not kept on disk: %v", m)
	}
	// the run ends (the watchdog, a crash): a new run starts with nothing in memory
	saved := readText(earlierFile())
	resetEarlier()
	_ = saveFile(earlierFile(), saved)
	if n := earlierLoad(); n != 1 {
		t.Fatalf("%d holds taken over", n)
	}
	if earlierRefusal(port) == nil || !earlierBusyAny() || len(portLock(port).ch) != 1 {
		t.Fatal("the Tally not held after the restart")
	}
	if !strings.Contains(readText(logFile()), "nothing is sent to it until") {
		t.Fatal("not said")
	}
	for i := 0; i < 40 && earlierRefusal(port) != nil; i++ {
		time.Sleep(100 * time.Millisecond)
	}
	if earlierRefusal(port) != nil || len(portLock(port).ch) != 0 {
		t.Fatal("still held after TallyAbandonMaxSec")
	}
	probeMu.Lock()
	need := probes[port] != nil && probes[port].need
	probeMu.Unlock()
	if !need {
		t.Fatal("the small check not owed")
	}
	time.Sleep(50 * time.Millisecond)
	if exists(earlierFile()) {
		t.Fatal("the file kept after the hold ended")
	}
	// a hold already over, or one further ahead than the bound: not taken
	_ = saveFile(earlierFile(), jsonText(M{"43992": M{"id": "x", "at": time.Now().Add(-time.Hour).UTC().Format(time.RFC3339), "until": time.Now().Add(-time.Minute).UTC().Format(time.RFC3339)},
		"43993": M{"id": "y", "at": time.Now().UTC().Format(time.RFC3339), "until": time.Now().Add(time.Hour).UTC().Format(time.RFC3339)}}))
	if n := earlierLoad(); n != 0 || earlierRefusal(43992) != nil || earlierRefusal(43993) != nil {
		t.Fatalf("%d stale holds taken", n)
	}
	close(sl.done)
}

// the supervisor's look: /ping says the heartbeat's progress count, its age and what keeps it from ending
func TestR2510PingBeatSec(t *testing.T) {
	r2510HealBridge(t)
	watchBusy = func() string { return "Tally is still on an earlier request" }
	beatLoopAt.Store(time.Now().Add(-200 * time.Second).Unix())
	n0 := beatLoopN.Load()
	r := httptest.NewRequest("GET", "http://127.0.0.1:9100/ping", nil)
	r.RemoteAddr = "127.0.0.1:50123"
	w := httptest.NewRecorder()
	handle(w, r)
	res := parseObj(w.Body.String())
	if toInt(res["beatSec"]) < 199 || toI64(res["beatN"]) != n0 || watchBusyOf(res) != "Tally is still on an earlier request" {
		t.Fatalf("/ping: %v", res)
	}
}

// review of 2.5.10 (7): the network's fingerprint leaves out IPv6 (its temporary addresses change by themselves),
// adapters that are down, the loopback and virtual adapters; the backoff is moved by up to a fifth
func TestR2510NetPrintAndJitter(t *testing.T) {
	l := []ifaceAddrs{
		{name: "Ethernet", up: true, addrs: []string{"192.168.1.20/24", "2401:4900:1c3d:1111:aaaa:bbbb:cccc:dddd/64", "fe80::1/64"}},
		{name: "vEthernet (WSL)", up: true, addrs: []string{"172.20.0.1/20"}},
		{name: "VirtualBox Host-Only Network", up: true, addrs: []string{"192.168.56.1/24"}},
		{name: "Wi-Fi", up: false, addrs: []string{"10.0.0.5/24"}},
		{name: "Loopback Pseudo-Interface 1", up: true, loop: true, addrs: []string{"127.0.0.1/8"}},
		{name: "Bluetooth Network Connection", up: true, addrs: []string{"169.254.3.4/16"}},
	}
	if p := netPrintOf(l); p != "192.168.1.20/24" {
		t.Fatalf("the fingerprint: %q", p)
	}
	l[0].addrs[1] = "2401:4900:1c3d:1111:1234:5678:9abc:def0/64" // a new temporary IPv6 address
	if p := netPrintOf(l); p != "192.168.1.20/24" {
		t.Fatalf("a temporary IPv6 address changed it: %q", p)
	}
	l[0].addrs[0] = "192.168.2.7/24"
	if p := netPrintOf(l); p != "192.168.2.7/24" {
		t.Fatalf("a real change not seen: %q", p)
	}
	old := jitterRand
	t.Cleanup(func() { jitterRand = old })
	for _, f := range []float64{0, 0.5, 0.999} {
		jitterRand = func() float64 { return f }
		if d := beatJitter(10 * time.Second); d < 8*time.Second || d > 12*time.Second {
			t.Fatalf("jitter %v: %s", f, d)
		}
	}
	jitterRand = old
	seen := map[time.Duration]bool{}
	for i := 0; i < 20; i++ {
		seen[beatJitter(10*time.Second)] = true
	}
	if len(seen) < 2 {
		t.Fatal("no jitter")
	}
}

// review of 2.5.10 (3): the keep-alive task, from Task Scheduler's own file: every 5 minutes, also on battery, as the
// signed-in user (InteractiveToken, least privilege: no password, no administrator), one name per Windows user (its SID,
// the login in Unicode); made once, made again when the program moves or the task was deleted, taken off when asked;
// nothing real is run here
func TestR2510KeepAliveTask(t *testing.T) {
	r2510HealBridge(t)
	exe := `C:\Users\made-up-a\AppData\Local\FinCom Bridge\FinComBridge.exe`
	cfgp := `C:\Users\made-up-a\AppData\Local\FinCom Bridge\tds-bridge.config.json`
	sid := "S-1-5-21-1111111111-2222222222-3333333333-1001"
	x, err := keepAliveTaskXML(exe, cfgp, sid)
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{"<Interval>PT5M</Interval>", "<DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>", "<StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>",
		"<LogonType>InteractiveToken</LogonType>", "<RunLevel>LeastPrivilege</RunLevel>", "<UserId>" + sid + "</UserId>", "<MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>",
		"<Command>" + exe + "</Command>", "<Arguments>keepalive --config &#34;" + cfgp + "&#34;</Arguments>", "<ExecutionTimeLimit>PT2M</ExecutionTimeLimit>"} {
		if !strings.Contains(x, want) {
			t.Fatalf("the task file lacks %s:\n%s", want, x)
		}
	}
	for _, bad := range []string{"Password", "HighestAvailable", "S4U", "LogonTrigger"} {
		if strings.Contains(x, bad) {
			t.Fatalf("needs a password or an administrator: %s", bad)
		}
	}
	if b := utf16File("<a>"); len(b) != 8 || b[0] != 0xFF || b[1] != 0xFE || b[2] != '<' || b[3] != 0 {
		t.Fatalf("not UTF-16 with its mark: %v", b)
	}
	if n := keepAliveTaskName(`SRV01\made-up-a`, sid); n != "FinCom Bridge keep-alive (SRV01made-up-a "+sid+")" {
		t.Fatalf("the name: %q", n)
	}
	if n := keepAliveTaskName("ना:म|ए", ""); n != "FinCom Bridge keep-alive (नामए)" {
		t.Fatalf("a Unicode login: %q", n)
	}
	if keepAliveTaskName("made-up-a", "S-1-5-21-1") == keepAliveTaskName("made-up-a", "S-1-5-21-2") {
		t.Fatal("two users of the same name share a task")
	}
	if _, err := keepAliveTaskXML(`C:\a"b\FinComBridge.exe`, "", ""); err == nil {
		t.Fatal("a quote in the path")
	}
	if !reflect.DeepEqual(keepAliveCreateArgs("N", `C:\x.xml`), []string{"/Create", "/F", "/TN", "N", "/XML", `C:\x.xml`}) {
		t.Fatal("the create")
	}
	var runs [][]string
	var files []string
	fail, present := false, true
	old := schtasksRun
	t.Cleanup(func() { schtasksRun = old })
	schtasksRun = func(a ...string) error {
		runs = append(runs, a)
		switch a[0] {
		case "/Create":
			if fail {
				return os.ErrPermission
			}
			b, _ := os.ReadFile(a[len(a)-1])
			files = append(files, string(b))
			present = true
		case "/Query":
			if !present {
				return os.ErrNotExist
			}
		case "/Delete":
			present = false
		}
		return nil
	}
	creates := func() int {
		n := 0
		for _, r := range runs {
			if r[0] == "/Create" {
				n++
			}
		}
		return n
	}
	fail = true
	ensureKeepAlive(exe)
	fail = false
	ensureKeepAlive(exe)
	ensureKeepAlive(exe)
	if creates() != 2 || !strings.Contains(readText(logFile()), "could not be made") || len(files) != 1 || len(files[0]) < 100 || files[0][0] != 0xFF {
		t.Fatalf("made once after a failure: %v", runs)
	}
	if exists(keepAliveXMLFile()) {
		t.Fatal("the task's file left behind")
	}
	present = false // deleted in Task Scheduler by someone
	ensureKeepAlive(exe)
	if creates() != 3 {
		t.Fatalf("a deleted task not made again: %v", runs)
	}
	ensureKeepAlive(`D:\FinCom\FinComBridge.exe`)
	if creates() != 4 {
		t.Fatalf("the program moved: %v", runs)
	}
	setCfg("NoKeepAlive", true)
	ensureKeepAlive(exe)
	ensureKeepAlive(exe)
	setCfg("NoKeepAlive", false)
	if r := runs[len(runs)-1]; r[0] != "/Delete" || creates() != 4 {
		t.Fatalf("NoKeepAlive: %v", runs)
	}
	removeKeepAlive(nil)
	if runs[len(runs)-1][0] != "/Delete" || readText(keepAliveMarkFile()) != "" {
		t.Fatal("the uninstall")
	}
	// a setup between its stop and its install: nothing started for 30 minutes at most
	now := time.Now()
	for at, want := range map[string]bool{now.Add(-5 * time.Minute).UTC().Format(time.RFC3339): true, now.Add(-31 * time.Minute).UTC().Format(time.RFC3339): false, "": false, "noon": false} {
		if setupRunning(at, now) != want {
			t.Fatalf("SetupAt %q: %v", at, !want)
		}
	}
}
