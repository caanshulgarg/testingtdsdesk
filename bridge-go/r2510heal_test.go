package main

// bridge 2.5.10: the bridge heals itself (selfheal.go, keepalive.go): the heartbeat's watchdog, its retries, a sleep or a
// network change noticed, why the last run ended said in the beat, and the keep-alive task's command line
import (
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
	oldW, oldM, oldP, oldR, oldX := wallNow, monoNow, netPrint, runMode, beatWatchExit
	oldLast, oldLook := netLast, netLookAt
	t.Cleanup(func() {
		wallNow, monoNow, netPrint, runMode, beatWatchExit = oldW, oldM, oldP, oldR, oldX
		netLast, netLookAt = oldLast, oldLook
		beatLoopAt.Store(0)
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

// the heartbeat stalled: the worker ends itself (code 13) with the reason written, when something starts it again;
// started again, it says so in the beat
func TestR2510WatchdogStallRestarts(t *testing.T) {
	r2510HealBridge(t)
	runStarted()
	var got []int
	var mu sync.Mutex
	beatWatchExit = func(c int) { mu.Lock(); got = append(got, c); mu.Unlock() }
	// by hand (window): said, never ended
	runMode = "window"
	beatLoopAt.Store(time.Now().Add(-4 * time.Minute).Unix())
	stop := make(chan struct{})
	go beatWatch(stop, 10*time.Millisecond)
	time.Sleep(100 * time.Millisecond)
	close(stop)
	mu.Lock()
	n := len(got)
	mu.Unlock()
	if n != 0 || !strings.Contains(readText(logFile()), "started by hand: nothing restarts it") {
		t.Fatalf("by hand: ended %v", got)
	}
	writeLog("Older entries of MADE UP CO: 01-Jul-2025 waits")
	// moving: nothing
	runMode = "user"
	beatLoopAt.Store(time.Now().Unix())
	stop = make(chan struct{})
	go beatWatch(stop, 10*time.Millisecond)
	time.Sleep(60 * time.Millisecond)
	close(stop)
	if len(got) != 0 {
		t.Fatalf("a moving heartbeat ended: %v", got)
	}
	// stalled under the supervisor: ended with exitStall, the reason and the last log line's kind written
	beatLoopAt.Store(time.Now().Add(-4 * time.Minute).Unix())
	stop = make(chan struct{})
	done := make(chan struct{})
	go func() { beatWatch(stop, 10*time.Millisecond); close(done) }()
	select {
	case <-done:
	case <-time.After(3 * time.Second):
		t.Fatal("the watchdog did not end the worker")
	}
	close(stop)
	if len(got) != 1 || got[0] != exitStall {
		t.Fatalf("ended with %v", got)
	}
	s := readLastStop()
	if s == nil || s.Why != "stall" || s.Log != "olderEntries" || time.Since(s.At) < 3*time.Minute {
		t.Fatalf("the reason: %+v", s)
	}
	if lastStopBeat() != nil {
		t.Fatal("said before it runs again")
	}
	// started again (the supervisor's code 13: its own reason kept)
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

// the supervisor's look: /ping says how long the heartbeat has not moved
func TestR2510PingBeatSec(t *testing.T) {
	r2510HealBridge(t)
	beatLoopAt.Store(time.Now().Add(-200 * time.Second).Unix())
	r := httptest.NewRequest("GET", "http://127.0.0.1:9100/ping", nil)
	r.RemoteAddr = "127.0.0.1:50123"
	w := httptest.NewRecorder()
	handle(w, r)
	if res := parseObj(w.Body.String()); toInt(res["beatSec"]) < 199 {
		t.Fatalf("/ping: %v", res)
	}
}

// the keep-alive task: its exact command line, made once, made again when the program moves, taken off when asked;
// refused for a path schtasks cannot take; nothing real is run here
func TestR2510KeepAliveTask(t *testing.T) {
	r2510HealBridge(t)
	exe := `C:\Users\made-up-a\AppData\Local\FinCom Bridge\FinComBridge.exe`
	cfgp := `C:\Users\made-up-a\AppData\Local\FinCom Bridge\tds-bridge.config.json`
	args, err := keepAliveTaskArgs(exe, cfgp, "made-up-a")
	want := []string{"/Create", "/F", "/TN", "FinCom Bridge keep-alive (made-up-a)", "/SC", "MINUTE", "/MO", "5", "/IT", "/TR",
		`"C:\Users\made-up-a\AppData\Local\FinCom Bridge\FinComBridge.exe" keepalive --config "C:\Users\made-up-a\AppData\Local\FinCom Bridge\tds-bridge.config.json"`}
	if err != nil || !reflect.DeepEqual(args, want) {
		t.Fatalf("the task: %v %q", err, args)
	}
	for _, a := range args {
		if strings.EqualFold(a, "/RU") || strings.EqualFold(a, "/RL") || strings.EqualFold(a, "HIGHEST") || strings.EqualFold(a, "SYSTEM") || strings.EqualFold(a, "ONLOGON") {
			t.Fatalf("needs an administrator or a password: %v", args)
		}
	}
	if !reflect.DeepEqual(keepAliveDeleteArgs("made-up-a"), []string{"/Delete", "/TN", "FinCom Bridge keep-alive (made-up-a)", "/F"}) {
		t.Fatal("the delete")
	}
	if n := keepAliveTaskName(`made"up|a*?`); n != "FinCom Bridge keep-alive (madeupa)" {
		t.Fatalf("a name schtasks refuses: %q", n)
	}
	if _, err := keepAliveTaskArgs(`C:\a"b\FinComBridge.exe`, "", "x"); err == nil {
		t.Fatal("a quote in the path")
	}
	if _, err := keepAliveTaskArgs(`C:\`+strings.Repeat("a", 250)+`\FinComBridge.exe`, "", "x"); err == nil {
		t.Fatal("a path longer than schtasks takes")
	}
	var runs [][]string
	fail := false
	old := schtasksRun
	t.Cleanup(func() { schtasksRun = old })
	schtasksRun = func(a ...string) error {
		runs = append(runs, a)
		if fail {
			return os.ErrPermission
		}
		return nil
	}
	fail = true
	ensureKeepAlive(exe)
	fail = false
	ensureKeepAlive(exe)
	ensureKeepAlive(exe)
	if len(runs) != 2 || runs[1][0] != "/Create" || !strings.Contains(readText(logFile()), "could not be made") {
		t.Fatalf("made once after a failure: %v", runs)
	}
	ensureKeepAlive(`D:\FinCom\FinComBridge.exe`)
	if len(runs) != 3 || !strings.Contains(runs[2][10], `D:\FinCom\FinComBridge.exe`) {
		t.Fatalf("the program moved: %v", runs)
	}
	setCfg("NoKeepAlive", true)
	ensureKeepAlive(exe)
	ensureKeepAlive(exe)
	setCfg("NoKeepAlive", false)
	if len(runs) != 4 || runs[3][0] != "/Delete" {
		t.Fatalf("NoKeepAlive: %v", runs)
	}
	removeKeepAlive(nil)
	if runs[len(runs)-1][0] != "/Delete" || readText(keepAliveMarkFile()) != "" {
		t.Fatal("the uninstall")
	}
}
