package main

// next-inflight (the owner's requirements of 07-Oct-2026), on top of inflight231_test.go:
//  1. one request in flight per Tally, really, including after an abandoned one;
//  2. after a stop, wait up to 20 s (TallyAbandonWaitSec) for Tally to finish the abandoned request before sending anything
//     else (light: the kept connection's answer, nothing sent), then back off; after the long bound, the small check
//     goes first, at once, and the request after it;
//  3. waiting entries fetched one after another (inflight231_test.go);
//  4. never pile up.
// Written before the code.

import (
	"strings"
	"testing"
	"time"
)

// --- 2. a background read stopped at its limit returns then (the 2-second rule); Tally finishing it 3 s later, within the
// 20 s wait: nothing was sent meanwhile, the lock goes at once, no small check is owed, and the retry schedule's wait is
// lifted: the next background read is sent straight away
func TestInflightLateAnswerWithin20s(t *testing.T) {
	f := newStandTally(t)
	standBridge(t, f, `,"RecorderLimitMs":500,"TallyAbandonMaxSec":600`)
	b := holdBusy(f, func(id string) bool { return id == "FinComCompany" || id == "FinComFree" })
	t.Cleanup(func() { b.free(); earlierQuiet(f.port) }) // the held request ends before the test's log goes
	t0 := time.Now()
	_, err := invokeTally(recorderTC(nil), f.port, companyCheckRequest(""), 5)
	if took := time.Since(t0); !strings.Contains(errText(err), "stopped waiting") || took > 1500*time.Millisecond {
		t.Fatalf("the read was not stopped at its limit: %v after %s", err, took)
	}
	if !earlierBusy(f.port) || !retryHeld() {
		t.Fatalf("after the stop: held %v, retry wait %v (want both)", earlierBusy(f.port), retryHeld())
	}
	if _, err := invokeTally(recorderTC(nil), f.port, companyCheckRequest(""), 5); err == nil || f.n("") != 1 {
		t.Fatalf("sent while Tally is on the request given up: %v (%v)", err, f.ids())
	}
	time.Sleep(2500 * time.Millisecond)
	b.free() // Tally finishes it, 3 s after it was sent
	waitEarlierOver(t, f.port)
	for i := 0; i < 40 && retryHeld(); i++ {
		time.Sleep(50 * time.Millisecond)
	}
	if needProbe(f.port) || retryHeld() {
		t.Fatalf("Tally finished the request within the wait, yet a small check is owed (%v) or the retry wait stands (%v)", needProbe(f.port), retryHeld())
	}
	if logLines("finished the request the bridge stopped waiting for") != 1 {
		t.Fatalf("not said:\n%s", readText(logFile()))
	}
	n := f.n("")
	if _, err := invokeTally(recorderTC(nil), f.port, companyCheckRequest(""), 5); err != nil || f.n("") != n+1 {
		t.Fatalf("the next background read after Tally finished: %v (%d requests, was %d)", err, f.n(""), n)
	}
	if b.most.Load() != 1 {
		t.Fatalf("%d requests at Tally at once", b.most.Load())
	}
}

// --- 2. Tally not finishing within the wait: back off. Nothing more is sent while it is on the request (a background read
// refused at once, a person's read waits up to the same wait and is then refused in plain words); when Tally answers it
// later, the lock goes, no small check is owed, and the retry schedule's time stands
func TestInflightNoAnswerBacksOff(t *testing.T) {
	f := newStandTally(t)
	standBridge(t, f, `,"RecorderLimitMs":500,"TallyAbandonWaitSec":2,"TallyAbandonMaxSec":60`)
	b := holdBusy(f, func(id string) bool { return id == "FinComCompany" || id == "FinComFree" })
	t.Cleanup(func() { b.free(); earlierQuiet(f.port) }) // the held request ends before the test's log goes
	t0 := time.Now()
	_, err := invokeTally(recorderTC(nil), f.port, companyCheckRequest(""), 5)
	if took := time.Since(t0); !strings.Contains(errText(err), "stopped waiting") || took > 1500*time.Millisecond {
		t.Fatalf("the read: %v after %s (want its stop)", err, took)
	}
	retryDue()
	if _, err := invokeTally(recorderTC(nil), f.port, companyCheckRequest(""), 5); !strings.Contains(errText(err), earlierWords) {
		t.Fatalf("a background read while Tally is on the earlier request: %v", err)
	}
	t1 := time.Now()
	_, err = invokeTally(fin, f.port, groupNamesRequest(zz), 20)
	if took := time.Since(t1); !strings.Contains(errText(err), earlierWords) || took < 1500*time.Millisecond || took > 4*time.Second {
		t.Fatalf("a person's read while Tally is on the earlier request: %v after %s (want refused in plain words after the 2 s wait)", err, took)
	}
	if f.n("") != 1 || b.most.Load() != 1 {
		t.Fatalf("sent while Tally is on the earlier request: %v (at once %d)", f.ids(), b.most.Load())
	}
	time.Sleep(1 * time.Second)
	b.free() // over the wait
	waitEarlierOver(t, f.port)
	time.Sleep(300 * time.Millisecond)
	if needProbe(f.port) {
		t.Fatal("a small check is owed although Tally answered the earlier request")
	}
	if logLines("over the 2s wait") != 1 {
		t.Fatalf("the late answer is not said:\n%s", readText(logFile()))
	}
	if _, err := getLedgerNames(fin, zz, f.port); err != nil {
		t.Fatalf("a person's read after Tally answered: %v", err)
	}
}
