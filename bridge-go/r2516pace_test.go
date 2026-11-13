package main

// FinCom Bridge 2.5.16, item 1 (daypace2516.go): the older days read in the day, in two tiers by the time each form is
// measured to take for the company; the smallest forms first; postings first; the typing refusal kept fresh; the beat's
// lastKeyAt. Against the stand-in Tally (no real Tally; Windows-only parts: the real idle and front-window look).

import (
	"strings"
	"testing"
	"time"
)

// the person at Tally, as the pull sees it: Tally in front, idle for sec seconds
func r2516Person(t *testing.T, sec float64) {
	t.Helper()
	oi, of := pullIdleFn, pullFrontFn
	pullIdleFn = func() float64 { return sec }
	pullFrontFn = func() bool { return true }
	t.Cleanup(func() { pullIdleFn, pullFrontFn = oi, of })
}

func r2516Idle(sec float64) { pullIdleFn = func() float64 { return sec } }

func TestR2516PaceTiers(t *testing.T) {
	f, _, _ := pullBridgeWith(t, "")
	pullDay(f, "20250915", 700, "Sales", "Sales", "Receipt", "Payment")
	r2516Person(t, 10) // Tally used 10 s ago
	applyPeriodDays(pullList("20250915"))
	n0 := len(f.ids())
	// never measured: the heavy tier, 60 s: nothing goes after 10 s
	pullRun(t, 5)
	if got := f.ids()[n0:]; len(got) != 0 {
		t.Fatalf("an unmeasured form went 10 s after typing: %v", got)
	}
	if w := pullCurrent(); w == nil || pullNextForm(w) != paceHeads {
		t.Fatal("the day's list is not the next form")
	}
	// the day's list measured small for the company (0.1 s): it goes after 5 s, not after 3 s
	paceNote(zz, paceHeads, 100, 0, true)
	r2516Idle(3)
	pullRun(t, 5)
	if got := f.ids()[n0:]; len(got) != 0 {
		t.Fatalf("a small form went 3 s after typing: %v", got)
	}
	r2516Idle(6)
	pullRun(t, 1)
	if f.n(dayHeadsID) != 1 {
		t.Fatalf("the small list did not go after 6 s: %v", f.ids()[n0:])
	}
	// the entries: one by one is not measured yet: heavy, they wait; no group goes in the small tier
	if w := pullCurrent(); w == nil || !w.headsDone {
		t.Fatal("the heads are not done")
	}
	pullRun(t, 5)
	if f.n(vchObjectID)+f.n(vchBatchID) != 0 {
		t.Fatalf("an unmeasured entry form went 6 s after typing: %v", f.ids()[n0:])
	}
	paceNote(zz, paceObject, 40, 0, true)
	pullRun(t, 10)
	if f.n(vchBatchID) != 0 || f.n(vchObjectID) == 0 {
		t.Fatalf("the small tier: %d groups, %d one by one: %v", f.n(vchBatchID), f.n(vchObjectID), f.ids()[n0:])
	}
}

func TestR2516PaceGroupOnlyAfterAMinute(t *testing.T) {
	f, _, _ := pullBridgeWith(t, "")
	pullDay(f, "20250915", 700, "Sales", "Sales", "Receipt", "Payment", "Journal")
	r2516Person(t, 70) // left alone 70 s: the heavy tier may go
	applyPeriodDays(pullList("20250915"))
	pullRun(t, 10)
	if f.n(vchBatchID) == 0 {
		t.Fatalf("no group after a minute: %v", f.ids())
	}
}

func TestR2516PaceDemotedByWindowHoldAndSlowAnswer(t *testing.T) {
	pullBridgeWith(t, "")
	paceNote(zz, paceObject, 50, 0, true)
	if !paceSmall(zz, paceObject) || paceNeedSec(zz, paceObject) != 5 {
		t.Fatal("a 50 ms form is not small")
	}
	paceNote(zz, paceObject, 60, 1200, true) // a window held 1.2 s
	if paceSmall(zz, paceObject) || paceNeedSec(zz, paceObject) != 60 {
		t.Fatal("a held window did not move the form to the heavy tier")
	}
	for i := 0; i < 12; i++ {
		paceNote(zz, paceObject, 40, 0, true)
	}
	if !paceSmall(zz, paceObject) {
		t.Fatal("measured small again, not small")
	}
	paceNote(zz, paceObject, 0, 0, false) // stopped at 2 s
	if paceSmall(zz, paceObject) {
		t.Fatal("a stopped form stays small")
	}
	// per company: another company knows nothing; a group, a by-type list, a range and the payroll are never small
	if paceSmall("ANOTHER CO", paceObject) {
		t.Fatal("another company's form is small")
	}
	for _, f := range []string{paceBatch, paceSplit, paceRange, pacePayroll} {
		paceNote(zz, f, 10, 0, true)
		if paceSmall(zz, f) {
			t.Fatalf("%s is small", f)
		}
	}
	// a new version starts again
	pace.mu.Lock()
	text := paceTextLocked()
	pace.mu.Unlock()
	_ = saveFile(paceFile(), strings.Replace(text, BridgeVersion, "2.5.15", 1))
	paceReset()
	if _, known := pacePredict(zz, paceObject); known {
		t.Fatal("another version's measure kept")
	}
	_ = saveFile(paceFile(), text)
	paceReset()
	if _, known := pacePredict(zz, paceObject); !known {
		t.Fatal("this version's measure not kept across a restart")
	}
}

// postings first: a posting in flight holds even a small request
func TestR2516PacePostingFirst(t *testing.T) {
	f, _, _ := pullBridgeWith(t, "")
	pullDay(f, "20250915", 700, "Sales")
	r2516Person(t, 30)
	paceNote(zz, paceHeads, 50, 0, true)
	applyPeriodDays(pullList("20250915"))
	importsInFlight.Add(1)
	n0 := len(f.ids())
	pullRun(t, 3)
	importsInFlight.Add(-1)
	if got := f.ids()[n0:]; len(got) != 0 {
		t.Fatalf("a read went while a posting was in flight: %v", got)
	}
	pullRun(t, 1)
	if f.n(dayHeadsID) != 1 {
		t.Fatalf("the read did not go after the posting: %v", f.ids()[n0:])
	}
}

// a repeated typing refusal keeps its time fresh (FinCom's idle look counts a typing refusal only while it is fresh)
func TestR2516PickTypingRefreshed(t *testing.T) {
	pullBridgeWith(t, "")
	it := pullItem{Company: zz, CGUID: b220CoGUID, Day: "20250915", Kind: "period", ChosenAt: "c"}
	pickTake([]pullItem{it}, nil, nil)
	pickRefused(it, "typing")
	a1 := str(r2510Acks()[0]["at"])
	at := nowFn().Add(40 * time.Second)
	old := nowFn
	nowFn = func() time.Time { return at }
	defer func() { nowFn = old }()
	r2510Drain()
	pickRefused(it, "typing")
	a2 := str(r2510Acks()[0]["at"])
	if a1 == "" || a2 == a1 || a2 != at.UTC().Format(time.RFC3339) {
		t.Fatalf("the typing refusal's time: %s then %s", a1, a2)
	}
	if r2510Soon() {
		t.Fatal("an early beat for the same reason")
	}
}

// the beat says when a key was last seen in Tally
func TestR2516BeatLastKeyAt(t *testing.T) {
	pullBridgeWith(t, "")
	of := pullFrontFn
	pullFrontFn = func() bool { return false }
	defer func() { pullFrontFn = of }()
	paceReset()
	if s := lastKeyBeat(); s != "" {
		t.Fatalf("a key seen with Tally not in front: %s", s)
	}
	r2516Person(t, 7)
	s := lastKeyBeat()
	k, err := time.Parse(time.RFC3339, s)
	if err != nil || time.Since(k) < 6*time.Second || time.Since(k) > 10*time.Second {
		t.Fatalf("lastKeyAt %q", s)
	}
	r2516Idle(99999) // not known (a service without its tray): the last one seen is kept
	if lastKeyBeat() != s {
		t.Fatal("the last key seen was lost")
	}
	if b := beatBody(true, "open", "", nil, nil, nil); str(b["lastKeyAt"]) != s {
		t.Fatalf("the beat's lastKeyAt: %v", b["lastKeyAt"])
	}
}
