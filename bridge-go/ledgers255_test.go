// 2.5.5: the full ledger read (Update now, the nightly run, the ledger wake) under the 2-second hard stop: a chunk stopped
// at 2 s is halved down to 125 and carries on; the smallest chunk stopped at 2 s ends the turn with plain words, marks
// nothing, and goes on from there at the next try; the groups are still read
package main

import (
	"errors"
	"strings"
	"testing"
	"time"
)

// a stand-in Tally whose ledger list takes 2.4 s for a chunk of more than `fast` MasterIDs (every chunk when fast is 0);
// the last request (no upper end, past the highest MasterID: nothing left) is quick
func led255Slow(f *standTally, fast int64) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.slow = func(id, body string) time.Duration {
		if id != ledListID {
			return 0
		}
		m := reMidRange.FindStringSubmatch(body)
		if m != nil && (m[2] == "" || (fast > 0 && toI64(m[2])-toI64(m[1]) <= fast)) {
			return 0
		}
		return 2400 * time.Millisecond
	}
}

// waits until Tally has finished the request the bridge stopped waiting for, and the stop's cool-down is over
func led255Settle(t *testing.T, f *standTally) {
	t.Helper()
	time.Sleep(1600 * time.Millisecond)
	for i := 0; i < 50 && stopHeld(f.port); i++ {
		time.Sleep(100 * time.Millisecond)
	}
}

func TestLedger255ChunksStoppedAt2sAreHalved(t *testing.T) {
	const n = 900
	f := ledgerTally(t, n, `,"LedgerChunk":1000,"LedgerChunkMin":125,"RecorderStopCoolSec":1`)
	if ledChunkSec() != 3 {
		t.Fatalf("the wait for a ledger request: %d s (want 3: one second past the 2 s stop)", ledChunkSec())
	}
	led255Slow(f, 125)
	k := newRun("now", "r255a")
	var errs []error
	for i := 0; i < 12; i++ {
		t0 := time.Now()
		err := k.step(zz, f.port, "")
		if took := time.Since(t0); took > 2900*time.Millisecond {
			t.Fatalf("turn %d took %s: a request was not stopped at 2 s", i, took)
		}
		if err == nil {
			break
		}
		errs = append(errs, err)
		if !errors.Is(err, errBackoff) {
			t.Fatalf("turn %d: %v (a halved chunk waits only for the stop's cool-down)", i, err)
		}
		led255Settle(t, f)
	}
	rs := ledRanges(f)
	// 0-1000, 0-500, 0-250 stopped; then 125 at a time to the end
	if len(rs) < 4 || rs[0] != "0-1000" || rs[1] != "0-500" || rs[2] != "0-250" || rs[3] != "0-125" {
		t.Fatalf("the chunks: %v", rs)
	}
	if len(errs) != 3 || !strings.Contains(errs[2].Error(), "the next try reads 125 from MasterID 1") {
		t.Fatalf("the stops: %v", errs)
	}
	if held := loadLedList(syncFolder(zz)); len(held) != n {
		t.Fatalf("the list held: %d ledgers, want %d", len(held), n)
	}
	if f.n(grpListID) != 1 {
		t.Fatalf("the groups: %d requests, want 1", f.n(grpListID))
	}
	st := readKeepState(syncFolder(zz))
	if len(poisonMids(st)) != 0 || toInt(st["ledSize"]) != 125 {
		t.Fatalf("after the round: poisoned %v, size %v", poisonMids(st), st["ledSize"])
	}
}

func TestLedger255SmallestChunkStoppedEndsCleanly(t *testing.T) {
	const n = 400
	f := ledgerTally(t, n, `,"LedgerChunk":250,"LedgerChunkMin":125,"RecorderStopCoolSec":1`)
	led255Slow(f, 0) // every ledger chunk over 2 s
	k := newRun("ledgers", "r255b")
	err := k.step(zz, f.port, "")
	if !errors.Is(err, errBackoff) {
		t.Fatalf("the first stop (250): %v", err)
	}
	led255Settle(t, f)
	t0 := time.Now()
	err = k.step(zz, f.port, "")
	if time.Since(t0) > 2900*time.Millisecond {
		t.Fatal("the smallest chunk was not stopped at 2 s")
	}
	// plain words, not a give-way (the run backs off and says it: keep.go setBgBackoff, setKeepTrouble), nothing marked
	if err == nil || gaveWay(err) || !strings.Contains(err.Error(), "Tally took longer than 2 s for 125 ledgers (MasterID 1-125)") ||
		!strings.Contains(err.Error(), "goes on from MasterID 1 at the next try") {
		t.Fatalf("the smallest chunk stopped: %v", err)
	}
	st := readKeepState(syncFolder(zz))
	ls := obj(st["led"])
	if len(poisonMids(st)) != 0 || toI64(ls["after"]) != 0 || toInt(ls["size"]) != 125 || truthy(ls["iso"]) {
		t.Fatalf("after the stop: poisoned %v, round %v", poisonMids(st), ls)
	}
	// while Tally is still on the stopped request (the cool-down): nothing more is sent, at once
	before := f.n("")
	t0 = time.Now()
	if err := k.step(zz, f.port, ""); !gaveWay(err) || time.Since(t0) > time.Second {
		t.Fatalf("right after the stop: %v (%s)", err, time.Since(t0))
	}
	if f.n("") != before {
		t.Fatalf("%d request(s) sent during the cool-down", f.n("")-before)
	}
	// later, with Tally quick again: the round goes on from MasterID 1 at 125 and completes; the groups were read once
	led255Settle(t, f)
	f.mu.Lock()
	f.slow = nil
	f.mu.Unlock()
	if err := k.step(zz, f.port, ""); err != nil {
		t.Fatal(err)
	}
	if held := loadLedList(syncFolder(zz)); len(held) != n {
		t.Fatalf("the list held: %d ledgers, want %d", len(held), n)
	}
	rs := ledRanges(f)
	if rs[0] != "0-250" || rs[1] != "0-125" || rs[2] != "0-125" {
		t.Fatalf("the chunks: %v", rs)
	}
	if f.n(grpListID) != 1 {
		t.Fatalf("the groups: %d requests, want 1", f.n(grpListID))
	}
}

// the groups stopped at 2 s: plain words, asked again at the next try, then the ledgers
func TestLedger255GroupsStoppedAt2s(t *testing.T) {
	f := ledgerTally(t, 50, `,"RecorderStopCoolSec":1`)
	f.mu.Lock()
	f.slow = func(id, body string) time.Duration {
		if id == grpListID {
			return 2400 * time.Millisecond
		}
		return 0
	}
	f.mu.Unlock()
	k := newRun("now", "r255c")
	err := k.step(zz, f.port, "")
	if err == nil || gaveWay(err) || !strings.Contains(err.Error(), "Tally took longer than 2 s for the group list") {
		t.Fatalf("groups stopped: %v", err)
	}
	if f.n(ledListID) != 0 {
		t.Fatal("ledgers asked while the groups were not read")
	}
	led255Settle(t, f)
	f.mu.Lock()
	f.slow = nil
	f.mu.Unlock()
	if err := k.step(zz, f.port, ""); err != nil {
		t.Fatal(err)
	}
	if f.n(grpListID) != 2 || len(loadLedList(syncFolder(zz))) != 50 {
		t.Fatalf("groups %d, ledgers %d", f.n(grpListID), len(loadLedList(syncFolder(zz))))
	}
}
