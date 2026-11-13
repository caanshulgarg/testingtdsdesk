package main

// FinCom Bridge 2.5.16, the code review of d2b7fd47a..a87fd2260: H1 (a split never closes a day: a Credit Note not
// asked), M1 (typing looked at again after the wait for Tally's lock, right before the send), M2 (the date not applied:
// the day held 24 hours, counted), L2 (a company's brake: 3 day stops in an hour, an hour's wait).

import (
	"math"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

// H1: a big day whose list is read type by type holds a Credit Note (not one of the types asked): the bridge says the
// list is partial, never takes the day as done, and holds it for its one-day list a day later
func TestR2516SplitWithCreditNoteNotDone(t *testing.T) {
	f, x, m := r2516SplitDay(t)
	pullDay(f, "20250831", 1100, "Credit Note")
	r2516Person(t, 70)
	applyPeriodDays(pullList("20250831"))
	pullRun(t, 5)
	retryReset()
	pullRun(t, 30)
	var last M
	for _, h := range m.heads {
		if str(h["day"]) == "20250831" {
			last = h
		}
	}
	if last == nil || last["partial"] != true || str(last["via"]) != "split" || toInt(last["n"]) != 4 {
		t.Fatalf("the split list told: %v", last)
	}
	for _, hd := range arr(last["heads"]) {
		if str(arr(hd)[3]) == "Credit Note" {
			t.Fatal("a type not asked in the split")
		}
	}
	pull.mu.Lock()
	st := str(obj(pull.state[companyKey(zz)])["phase"])
	pull.mu.Unlock()
	if st != "retry" || len(x.dayStops) != 1 || str(x.dayStops[0]["why"]) != "split" {
		t.Fatalf("the day after its split: phase %q, day stops %v", st, x.dayStops)
	}
}

// M1: a key pressed while the request waits for Tally's lock: nothing is sent
func TestR2516TypingDuringLockWait(t *testing.T) {
	f, _, _ := pullBridge(t)
	pullDay(f, "20250915", 700, "Sales")
	var idle atomic.Uint64
	idle.Store(math.Float64bits(70))
	oi, of := pullIdleFn, pullFrontFn
	pullIdleFn = func() float64 { return math.Float64frombits(idle.Load()) }
	pullFrontFn = func() bool { return true }
	t.Cleanup(func() { pullIdleFn, pullFrontFn = oi, of })
	applyPeriodDays(pullList("20250915"))
	unlock, err := enterTallyLock(&TC{copier: true, person: true}, f.port, func() {}, false)
	if err != nil {
		t.Fatal(err)
	}
	n0 := len(f.ids())
	done := make(chan bool, 1)
	go func() { s, _ := pullStep(); done <- s }()
	time.Sleep(300 * time.Millisecond)
	idle.Store(math.Float64bits(1)) // a key in Tally while the request waits for the lock
	unlock()
	select {
	case <-done:
	case <-time.After(10 * time.Second):
		t.Fatal("the step did not end")
	}
	if got := f.ids()[n0:]; len(got) != 0 {
		t.Fatalf("sent after a key during the lock wait: %v", got)
	}
	idle.Store(math.Float64bits(70))
	pullRun(t, 3)
	if f.n(dayHeadsID) != 1 {
		t.Fatal("not asked once Tally was left alone again")
	}
}

// M2: Tally answers a day's list with other days' entries only: the day is held 24 hours and counted as a failed day
func TestR2516DateNotAppliedHeld(t *testing.T) {
	f, c, m := pullBridge(t)
	x := r2516Stops(t, c)
	pullDay(f, "20250511", 1300, "Sales") // 10-May has none of its own
	f.mu.Lock()
	f.headsAllDays = true
	f.mu.Unlock()
	t0 := nowFn()
	applyPeriodDays(pullList("20250510"))
	pullRun(t, 10)
	if len(x.dayStops) != 1 || str(x.dayStops[0]["why"]) != "dates" || len(m.upload) != 0 {
		t.Fatalf("day stops %v, uploads %v", x.dayStops, m.upload)
	}
	n := f.n(dayHeadsID)
	r2516At(t, t0.Add(2*time.Hour))
	retryReset()
	applyPeriodDays(pullList("20250510"))
	pullRun(t, 10)
	if f.n(dayHeadsID) != n {
		t.Fatal("asked again within its 24 hours (a loop)")
	}
	pull.mu.Lock()
	ns := len(pull.stopped)
	pull.mu.Unlock()
	if ns != 0 {
		t.Fatal("single days stopped on this Tally")
	}
}

// L2: 3 day stops of one company within an hour: that company waits an hour
func TestR2516CompanyBrake(t *testing.T) {
	f, c, _ := pullBridge(t)
	x := r2516Stops(t, c)
	days := []string{"20250901", "20250902", "20250903", "20250904"}
	for _, d := range days {
		pullDay(f, d, 2000+int64(len(d)), "Sales")
	}
	f.mu.Lock()
	f.slow = func(id, body string) time.Duration {
		if id == dayHeadsID {
			return 2500 * time.Millisecond
		}
		return 0
	}
	f.mu.Unlock()
	t0 := nowFn()
	for i, d := range days[:3] {
		r2516At(t, t0.Add(time.Duration(i)*10*time.Minute))
		retryReset()
		applyPeriodDays(pullList(d))
		pullRun(t, 5)
	}
	if len(x.dayStops) != 3 || !pullBraked(pullItem{Company: zz, CGUID: b220CoGUID}) {
		t.Fatalf("3 stops: %d told, braked %v", len(x.dayStops), pullBraked(pullItem{Company: zz, CGUID: b220CoGUID}))
	}
	n := f.n(dayHeadsID)
	r2516At(t, t0.Add(30*time.Minute))
	retryReset()
	applyPeriodDays(pullList(days[3]))
	pullRun(t, 5)
	if f.n(dayHeadsID) != n {
		t.Fatal("a day of a braked company was asked")
	}
	if !strings.Contains(readText(logFile()), "its older days wait an hour") {
		t.Fatal("no log line")
	}
	r2516At(t, t0.Add(81*time.Minute))
	if pullBraked(pullItem{Company: zz, CGUID: b220CoGUID}) {
		t.Fatal("still braked an hour after the third stop")
	}
}
