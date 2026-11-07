// 2.5.5: the full ledger read (Update now, the nightly run, the ledger wake) under the 2-second hard stop: a chunk stopped
// at 2 s is halved down to 125 and carries on; the smallest chunk stopped at 2 s ends the turn with plain words, marks
// nothing, and goes on from there at the next try; the groups are still read
package main

import (
	"errors"
	"fmt"
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

// the groups stopped at 2 s: said, and the ledgers are read anyway (FinCom keeps the groups it has); the next full read
// asks for the groups again
func TestLedger255GroupsStoppedAt2sNeverHoldTheLedgers(t *testing.T) {
	f := ledgerTally(t, 50, `,"RecorderStopCoolSec":1`)
	// a first full read: the groups as FinCom has them
	if err := newRun("now", "r255c0").step(zz, f.port, ""); err != nil {
		t.Fatal(err)
	}
	groups0 := readText(syncFolder(zz) + "/group-list.json")
	f.mu.Lock()
	f.slow = func(id, body string) time.Duration {
		if id == grpListID {
			return 2400 * time.Millisecond
		}
		return 0
	}
	f.addLedLocked("Party new", "Sundry Creditors", "-1.00")
	f.mu.Unlock()
	k := newRun("now", "r255c")
	var err error
	for i := 0; i < 5; i++ {
		t0 := time.Now()
		if err = k.step(zz, f.port, ""); err == nil {
			break
		}
		if time.Since(t0) > 2900*time.Millisecond || !gaveWay(err) {
			t.Fatalf("turn %d: %v (%s): the group list's stop held the ledgers", i, err, time.Since(t0))
		}
		led255Settle(t, f)
	}
	if err != nil {
		t.Fatal(err)
	}
	if f.n(grpListID) != 2 || len(loadLedList(syncFolder(zz))) != 51 {
		t.Fatalf("groups asked %d times, ledgers held %d (want the new one read)", f.n(grpListID), len(loadLedList(syncFolder(zz))))
	}
	if !strings.Contains(readText(logFile()), "Tally took longer than 2 s for the group list; the bridge stopped waiting and reads the ledgers anyway") {
		t.Fatal("the group list's stop was not said")
	}
	if readText(syncFolder(zz)+"/group-list.json") != groups0 {
		t.Fatal("the groups FinCom has were changed by a round that did not read them")
	}
	// the next full read asks for the groups again (quick now)
	led255Settle(t, f)
	f.mu.Lock()
	f.slow = nil
	f.mu.Unlock()
	if err := newRun("now", "r255d").step(zz, f.port, ""); err != nil {
		t.Fatal(err)
	}
	if f.n(grpListID) != 3 {
		t.Fatalf("the next full read: groups asked %d times, want 3", f.n(grpListID))
	}
}

// one ledger that alone takes Tally longer than the stop: the smallest chunk stopped three times in a row (the turn ends
// twice, with plain words), then halved down to that one ledger, which is skipped and named ("takes Tally longer than
// 2 s"); every other ledger is read, and every request is stopped at the limit
func TestLedger255SlowLedgerSkippedRestRead(t *testing.T) {
	const n = 300
	f := ledgerTally(t, n, `,"LedgerChunk":250,"LedgerChunkMin":125,"RecorderStopCoolSec":1,"RecorderLimitMs":500`)
	f.mu.Lock()
	slow := f.led[76].mid
	f.slow = func(id, body string) time.Duration {
		if id != ledListID {
			return 0
		}
		m := reMidRange.FindStringSubmatch(body)
		if m != nil && toI64(m[1]) < slow && (m[2] == "" || slow <= toI64(m[2])) {
			return 800 * time.Millisecond
		}
		return 0
	}
	f.mu.Unlock()
	k := newRun("now", "r255e")
	plain := 0
	var err error
	for i := 0; i < 80; i++ {
		t0 := time.Now()
		if err = k.step(zz, f.port, ""); err == nil {
			break
		}
		if time.Since(t0) > 1500*time.Millisecond {
			t.Fatalf("turn %d took %s: a request was not stopped at the limit", i, time.Since(t0))
		}
		if !gaveWay(err) {
			if !strings.Contains(err.Error(), "the smallest part the ledger list is read in") {
				t.Fatalf("turn %d: %v", i, err)
			}
			plain++
		}
		led255Settle(t, f)
	}
	if err != nil {
		t.Fatalf("the round did not finish: %v", err)
	}
	if plain != 2 {
		t.Fatalf("the smallest chunk ended the turn %d times before it was halved, want 2", plain)
	}
	st := readKeepState(syncFolder(zz))
	sk := arr(st["ledPoison"])
	if len(sk) != 1 || toI64(at(arr(sk[0]), 0)) != slow || !strings.Contains(str(at(arr(sk[0]), 2)), "takes Tally longer than 2 s") {
		t.Fatalf("skipped: %v (want MasterID %d, slow)", sk, slow)
	}
	if r := arr(skippedLedgers(zz)); len(r) != 1 {
		t.Fatalf("named to FinCom: %v", r)
	}
	held := loadLedList(syncFolder(zz))
	if len(held) != n-1 {
		t.Fatalf("the list held: %d ledgers, want %d", len(held), n-1)
	}
	for _, h := range held {
		if h.mid == slow {
			t.Fatal("the slow ledger was read")
		}
	}
	if !strings.Contains(readText(logFile()), fmt.Sprintf("the ledger with MasterID %d (name not known) takes Tally longer than 2 s; it is skipped from now on", slow)) { // a first read: no list held yet to name it
		t.Fatal("the skip was not said")
	}
	// the next round never asks for it: no request stopped
	led255Settle(t, f)
	stops := strings.Count(readText(logFile()), "(stopped)")
	if err := newRun("now", "r255f").step(zz, f.port, ""); err != nil {
		t.Fatal(err)
	}
	if strings.Count(readText(logFile()), "(stopped)") != stops {
		t.Fatal("the next round asked for the slow ledger again")
	}
	asked0 := slowAsks(f, slow)

	// a day later, still slow: asked once at the next full read (alone, stopped at the limit), stays skipped, named again
	led255Yesterday(t, slow)
	led255Round(t, f, "r255g", "nightly")
	if slowAsks(f, slow) != asked0+1 || len(poisonMids(readKeepState(syncFolder(zz)))) != 1 {
		t.Fatalf("still slow: asked %d more time(s), skipped %v", slowAsks(f, slow)-asked0, poisonMids(readKeepState(syncFolder(zz))))
	}
	if r := arr(skippedLedgers(zz)); len(r) != 1 || !strings.Contains(str(at(arr(r[0]), 2)), "still takes Tally longer than 2 s") {
		t.Fatalf("named to FinCom while skipped: %v", r)
	}
	if !strings.Contains(readText(logFile()), "it stays skipped, is named to FinCom again") {
		t.Fatal("the retry was not said")
	}
	// the same day again: not asked; the ledger wake never asks it
	led255Round(t, f, "r255h", "now")
	led255Yesterday(t, slow)
	led255Round(t, f, "r255i", "ledgers")
	if slowAsks(f, slow) != asked0+1 {
		t.Fatalf("asked %d times more (want once a day, full reads only)", slowAsks(f, slow)-asked0)
	}

	// the next day, quick again: asked once, read, and no longer skipped
	f.mu.Lock()
	f.slow = nil
	f.mu.Unlock()
	led255Round(t, f, "r255j", "now")
	st = readKeepState(syncFolder(zz))
	if len(poisonMids(st)) != 0 || len(arr(skippedLedgers(zz))) != 0 || len(loadLedList(syncFolder(zz))) != n {
		t.Fatalf("cleared: skipped %v, held %d", poisonMids(st), len(loadLedList(syncFolder(zz))))
	}
	if !strings.Contains(readText(logFile()), fmt.Sprintf("the ledger with MasterID %d answered in time when asked again; it is read and no longer skipped", slow)) {
		t.Fatal("the clearing was not said")
	}
	// and from then on it is read with the others, in the ordinary chunks
	before := slowAsks(f, slow)
	led255Round(t, f, "r255k", "now")
	if slowAsks(f, slow) != before+1 || len(loadLedList(syncFolder(zz))) != n {
		t.Fatal("not read normally after it was cleared")
	}
}

// the ledger list requests that asked for MasterID mid (in its range)
func slowAsks(f *standTally, mid int64) int {
	c := 0
	for _, r := range ledRanges(f) {
		a := strings.SplitN(r, "-", 2)
		if len(a) == 2 && toI64(a[0]) < mid && (a[1] == "end" || mid <= toI64(a[1])) {
			c++
		}
	}
	return c
}

// the slow ledger's last try moved to yesterday (a day passes)
func led255Yesterday(t *testing.T, mid int64) {
	t.Helper()
	dir := syncFolder(zz)
	st := readKeepState(dir)
	tries := obj(st["ledSlowTry"])
	if tries == nil {
		tries = M{}
	}
	tries[fmt.Sprint(mid)] = "20000101"
	st["ledSlowTry"] = tries
	saveKeepState(dir, st)
}

// one full round of the given kind, through any stop's cool-down
func led255Round(t *testing.T, f *standTally, id, kind string) {
	t.Helper()
	led255Settle(t, f)
	k := newRun(kind, id)
	for i := 0; i < 10; i++ {
		err := k.step(zz, f.port, "")
		if err == nil {
			return
		}
		if !gaveWay(err) {
			t.Fatalf("%s: %v", id, err)
		}
		led255Settle(t, f)
	}
	t.Fatalf("%s did not finish", id)
}
