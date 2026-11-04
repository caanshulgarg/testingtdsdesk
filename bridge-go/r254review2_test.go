// FinCom Bridge 2.5.4, the re-review of 9c8546b75 (N1-N4): each test fails on 9c8546b75 and passes with the fix
package main

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

// N1: a look that only found update-pending.json (the new program not yet running two minutes) clears the one-look
// flag: the next look (the schedule's, the tray's) runs
func TestR254ReviewN1FlagClearedWhenOnlyPending(t *testing.T) {
	r254Bridge(t)
	dir := t.TempDir()
	oldE := exePathFn
	exePathFn = func() string { return filepath.Join(dir, "FinComBridge.exe") }
	t.Cleanup(func() { exePathFn = oldE; updChecking.Store(false) })
	_ = os.WriteFile(filepath.Join(dir, "update-pending.json"), []byte(`{"from":"2.5.3"}`), 0o644)
	setUpd("applying", false)
	if _, ran := checkForUpdateOnce(true); !ran {
		t.Fatal("the look did not run")
	}
	if updChecking.Load() || updateBeat()["checking"] == true {
		t.Fatal("the one-look flag stays set after a look that put nothing in place")
	}
	// an update this bridge put in place (applying): the flag stays until the restart
	setUpd("applying", true)
	updChecking.Store(false)
	checkForUpdateOnce(true)
	if !updChecking.Load() {
		t.Fatal("the flag is cleared while an update waits to start again")
	}
}

// N2: a Tally whose last list is kept marked busy (a fresh ask timed out) and does not name the company: busy, never
// "not open"
func TestR254ReviewN2BusyNotNotOpen(t *testing.T) {
	r254Bridge(t)
	list := func(bool) []M {
		return []M{{"port": 9000, "ok": true, "busy": true, "tallyState": "busy", "mine": true, "companies": []any{M{"name": "OTHER CO"}}}}
	}
	_, _, err := findCompanyWith("ZZ TEST", 0, []bool{true}, list)
	var w *tallyWait
	if !errors.As(err, &w) || w.kind != "busy" {
		t.Fatalf("a busy Tally: %v", err)
	}
	// an answer in time without the company: not open, as before
	list = func(bool) []M {
		return []M{{"port": 9000, "ok": true, "tallyState": "open", "mine": true, "companies": []any{M{"name": "OTHER CO"}}}}
	}
	if _, _, err := findCompanyWith("ZZ TEST", 0, []bool{true}, list); !errors.As(err, &w) || w.kind != "notopen" {
		t.Fatalf("not open: %v", err)
	}
}

// N3: a caller that waited for Tally's lock behind the slow list takes its late answer, never sends the list again
func TestR254ReviewN3QueuedCallerTakesLate(t *testing.T) {
	mine := newStandTally(t)
	standBridge(t, mine, `,"TallyAbandonMaxSec":600`)
	mine.mu.Lock()
	mine.slow = func(id, body string) time.Duration {
		if id == "TDSDeskCompanies" {
			return 3 * time.Second
		}
		return 0
	}
	mine.mu.Unlock()
	var wg sync.WaitGroup
	var errA, errB error
	var rawB string
	wg.Add(1)
	go func() { defer wg.Done(); _, errA = invokeTally(fin, mine.port, companiesRequest(), 8) }()
	time.Sleep(2300 * time.Millisecond) // A stopped waiting at 2 s; Tally is still on it (the lock held)
	wg.Add(1)
	go func() { defer wg.Done(); rawB, errB = invokeTally(&TC{}, mine.port, companiesRequest(), 8) }()
	wg.Wait()
	if errA == nil {
		t.Fatal("A was answered in time (the stand-in is not slow)")
	}
	if errB != nil || !strings.Contains(rawB, "COMPANY") || standCount(mine, "TDSDeskCompanies") != 1 {
		t.Fatalf("B: %v, %d lists sent (want 1)", errB, standCount(mine, "TDSDeskCompanies"))
	}
}

// N4: an answer in time drops an older late answer to the same request
func TestR254ReviewN4InTimeDropsLate(t *testing.T) {
	mine := newStandTally(t)
	standBridge(t, mine, "")
	noteLateAnswer(mine.port, companiesRequest(), "<ENVELOPE>old</ENVELOPE>")
	raw, err := invokeTally(&TC{noLate: true}, mine.port, companiesRequest(), 8)
	if err != nil || strings.Contains(raw, "old") {
		t.Fatalf("in time: %v %q", err, raw)
	}
	if l, ok := takeLateAnswer(mine.port, companiesRequest(), 0); ok {
		t.Fatalf("the older late answer is still served: %q", l)
	}
}
