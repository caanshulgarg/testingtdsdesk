package main

// next-fix-read-any-bridge (07-Nov-2026, staging): an Update now on a computer where the company was open but held by the
// copier's wait (someone working in Tally, FinCom reading, a posting going) did nothing for up to 30 minutes and said
// nothing: while a run was going the main loop sent no cloud push, so the company's link was not asked and nothing of
// the wait reached FinCom. Now a held run still pushes and asks the links, and the beat says why it waits and that an
// Update now is queued behind it.

import (
	"os"
	"strings"
	"testing"
	"time"
)

func TestHeldRunStillPushesAndSaysWhy(t *testing.T) {
	f := newStandTally(t)
	c := newStandCloud(t)
	standBridge(t, f, c.cfg())
	liveCopy(t) // a company kept here: the links are asked for it
	setFinComReading()
	defer func() { _ = os.Remove(sp("fincom-reading.txt")) }()
	wakeUpdate("")
	// the run starts and waits on the hold
	time.Sleep(1500 * time.Millisecond)
	if !keepRunning() || logLines("waiting, FinCom is reading from Tally") == 0 {
		t.Fatalf("the run is not held (running %v)", keepRunning())
	}
	// the main loop's turn while the run is held: the push (and with it the links) still goes
	before := c.count("companies")
	turnPushAt, turnFirst = time.Time{}, false // not the first turn (that one starts an Update now asked before a restart)
	bridgeTurn(func(_ string, fn func()) { fn() })
	for i := 0; i < 50 && c.count("companies") == before; i++ {
		time.Sleep(100 * time.Millisecond)
	}
	if c.count("companies") == before {
		t.Fatal("a held run stops the cloud push: the links are never asked")
	}
	// the beat says why, in plain words, and since when
	kw := obj(beatBody(true, "open", "", nil, nil, nil)["keepWait"])
	if str(kw["reason"]) != "fincomReading" || !strings.Contains(str(kw["words"]), "FinCom is reading from Tally") || str(kw["since"]) == "" {
		t.Fatalf("the beat does not say why the run waits: %v", kw)
	}
	if str(kw["queued"]) != "" {
		t.Fatalf("nothing is queued yet: %v", kw)
	}
	// another Update now while held: said as queued, not silently kept
	wakeUpdate("")
	kw = obj(beatBody(true, "open", "", nil, nil, nil)["keepWait"])
	if q := str(kw["queued"]); !strings.HasPrefix(q, "Update now is queued: ") || !strings.Contains(q, "FinCom is reading from Tally") {
		t.Fatalf("a queued Update now is not said: %v", kw)
	}
	// the hold over: the run goes on, and the wait is no longer said
	_ = os.Remove(sp("fincom-reading.txt"))
	waitIdle(t)
	if kw := beatBody(true, "open", "", nil, nil, nil)["keepWait"]; kw != nil {
		t.Fatalf("after the run the beat still says a wait: %v", kw)
	}
}

// the words for each hold
func TestKeepWaitWords(t *testing.T) {
	for _, x := range [][2]string{
		{"userInTally", "someone is working in Tally"},
		{"tallyYoung", "Tally has just opened"},
		{"posting", "posting"},
		{"stopped", "stopped"},
	} {
		if w := keepWaitWords(x[0], ""); !strings.Contains(w, x[1]) {
			t.Fatalf("%s: %q", x[0], w)
		}
	}
	if w := keepWaitWords("userInTally", ""); !strings.Contains(w, "15 s") {
		t.Fatalf("the user's wait does not say when it starts: %q", w)
	}
}
