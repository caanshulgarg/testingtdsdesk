package main

// The agreed rule (07-Nov-2026): an Update now a person pressed waits about 2 minutes at most for a 15 s pause in Tally;
// then it reads on in short slices (each request under the 2 s stop) and gives way between them while the person types.
// The nightly run keeps waiting as before; postings are never held (they do not ask keepHold).

import (
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

// someone working in Tally, and typing, as the tests say
func keepNowFake(t *testing.T) (busy, typing *atomic.Bool) {
	busy, typing = new(atomic.Bool), new(atomic.Bool)
	ou, ot := keepUserInTallyFn, keepTypingFn
	keepUserInTallyFn, keepTypingFn = busy.Load, typing.Load
	t.Cleanup(func() { keepUserInTallyFn, keepTypingFn = ou, ot })
	return
}

func TestKeepNowReadsOnAfterWait(t *testing.T) {
	f := ledgerTally(t, 300, `,"KeepNowWaitSec":3,"KeepNowYieldSec":2`)
	busy, _ := keepNowFake(t)
	busy.Store(true)
	// the nightly run: someone in Tally the whole time: nothing read (as before)
	startKeepRun(runReq{kind: "nightly", why: "test"})
	time.Sleep(5 * time.Second)
	if n := f.n(ledListID); n != 0 {
		t.Fatalf("the nightly run read %d chunk(s) while someone worked in Tally", n)
	}
	if kw := obj(beatBody(true, "open", "", nil, nil, nil)["keepWait"]); str(kw["reason"]) != "userInTally" || strings.Contains(str(kw["words"]), "reads on after 2 minutes") {
		t.Fatalf("the nightly wait: %v", kw)
	}
	busy.Store(false)
	waitIdle(t)
	if f.n(ledListID) == 0 {
		t.Fatal("the nightly run did not read once Tally was free")
	}

	// an Update now while someone works in Tally: it waits (KeepNowWaitSec, 2 minutes in use), the beat says it reads on
	// after that, then it reads in slices under the 2 s stop
	before := f.n(ledListID)
	busy.Store(true)
	wakeUpdate("")
	time.Sleep(1500 * time.Millisecond)
	if f.n(ledListID) != before {
		t.Fatal("the Update now read at once while someone worked in Tally")
	}
	if kw := obj(beatBody(true, "open", "", nil, nil, nil)["keepWait"]); str(kw["reason"]) != "userInTally" || !strings.Contains(str(kw["words"]), "reads on after 2 minutes at most") {
		t.Fatalf("the Update now's wait: %v", kw)
	}
	waitIdle(t)
	if f.n(ledListID) == before || logLines("reading goes on in short parts (each request 2 s at most), giving way while they type") == 0 {
		t.Fatal("the Update now did not read on after its wait")
	}
	busy.Store(false)
}

// between slices: while the person types, the next slice waits for a pause (KeepNowYieldSec at most); not typing, at once;
// a run not reading on keeps keepHold's words
func TestKeepNowGivesWayWhileTyping(t *testing.T) {
	f := newStandTally(t)
	standBridge(t, f, `,"KeepNowYieldSec":1`)
	busy, typing := keepNowFake(t)
	busy.Store(true)
	k := newRun("now", "kn1")
	if h := k.holdNow(); !strings.Contains(h, "someone is working in Tally") {
		t.Fatalf("not reading on: %q", h)
	}
	k.pressOn = true
	typing.Store(true)
	t0 := time.Now()
	if h := k.holdNow(); h != "" || time.Since(t0) < 900*time.Millisecond {
		t.Fatalf("typing: %q after %s (want a wait for a pause, then on)", h, time.Since(t0))
	}
	typing.Store(false)
	t0 = time.Now()
	if h := k.holdNow(); h != "" || time.Since(t0) > 300*time.Millisecond {
		t.Fatalf("not typing: %q after %s", h, time.Since(t0))
	}
	// another hold (FinCom reading) is never pressed on
	setFinComReading()
	if h := k.holdNow(); !strings.Contains(h, "FinCom is reading") {
		t.Fatalf("FinCom reading: %q", h)
	}
}
