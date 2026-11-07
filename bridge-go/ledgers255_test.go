// 2.5.5: the full ledger read (Update now, the nightly run, the ledger wake) under the 2-second hard stop: a chunk stopped
// at 2 s is halved down to 125 and carries on; the smallest chunk stopped at 2 s ends the turn with plain words, marks
// nothing, and goes on from there at the next try; the groups are still read
package main

import (
	"errors"
	"fmt"
	"strings"
	"sync/atomic"
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

// a stand-in whose ledger list takes d for any request that asks for one of mids (in its range, the open end included)
func led255SlowMids(f *standTally, d time.Duration, mids ...int64) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.slow = func(id, body string) time.Duration {
		if id != ledListID {
			return 0
		}
		m := reMidRange.FindStringSubmatch(body)
		if m == nil {
			return 0
		}
		for _, mid := range mids {
			if toI64(m[1]) < mid && (m[2] == "" || mid <= toI64(m[2])) {
				return d
			}
		}
		return 0
	}
}

// the turns of one run until its round is done: each turn under the limit; errors only a give-way (the cool-down,
// Tally still on a request) or a plain stop (the back-off); the plain ones counted
func led255Run(t *testing.T, f *standTally, k *keepRun, max int, limit time.Duration) (plain int, turns int) {
	t.Helper()
	for turns = 0; turns < max; turns++ {
		t0 := time.Now()
		err := k.step(zz, f.port, "")
		if err == nil {
			return plain, turns + 1
		}
		if time.Since(t0) > limit {
			t.Fatalf("turn %d took %s: a request was not stopped at the limit", turns, time.Since(t0))
		}
		if !gaveWay(err) {
			if !strings.Contains(err.Error(), "the smallest part the ledger list is read in") && !strings.Contains(err.Error(), "it is asked again after a pause") {
				t.Fatalf("turn %d: %v", turns, err)
			}
			plain++
		}
		led255Settle(t, f)
	}
	t.Fatalf("the round did not finish in %d turns", max)
	return
}

// one ledger that alone takes Tally longer than the stop (Tally done with it soon after): the smallest chunk stopped
// three times in a row (the turn ends twice), halved down to that one ledger, which is skipped as slow only after its
// own request is stopped three times in a row (the turn ends twice more); every other ledger is read. Asked again only
// at a later night's run (never Update now), once a day; cleared when it answers in time
func TestLedger255SlowLedgerSkippedRestRead(t *testing.T) {
	const n = 300
	f := ledgerTally(t, n, `,"LedgerChunk":250,"LedgerChunkMin":125,"RecorderStopCoolSec":1,"RecorderLimitMs":500,"LedgerHangSec":5,"TallyAbandonMaxSec":600`)
	f.mu.Lock()
	slow := f.led[76].mid
	f.mu.Unlock()
	led255SlowMids(f, 800*time.Millisecond, slow)
	var stops atomic.Int32 // every request over the stop (third review T3)
	f.mu.Lock()
	inner := f.slow
	f.slow = func(id, body string) time.Duration {
		d := inner(id, body)
		if d > 0 {
			stops.Add(1)
		}
		return d
	}
	f.mu.Unlock()
	plain, _ := led255Run(t, f, newRun("now", "r255e"), 160, 1500*time.Millisecond)
	// third review T3: no more stops than the halving had before N1 (0455fe936, worked out for MasterID 77 here: 250; 125
	// three times; then 62 in time, 124, 62, 31, 15, 7 in time, 14, 7 in time, 14, 7, 3, and the one ledger three times:
	// 15 stops)
	if n := stops.Load(); n > 15 {
		t.Fatalf("%d stops to find one slow ledger (15 before N1)", n)
	} else {
		t.Logf("%d stops to find one slow ledger (15 before N1)", n)
	}
	if plain < 4 || plain%2 != 0 {
		t.Fatalf("the turn ended %d times with plain words, want twice for each run of three stops (at 125, at a size kept, and for the one ledger)", plain)
	}
	st := readKeepState(syncFolder(zz))
	sk := arr(st["ledPoison"])
	if len(sk) != 1 || toI64(at(arr(sk[0]), 0)) != slow || !strings.Contains(str(at(arr(sk[0]), 2)), "takes Tally longer than 2 s") {
		t.Fatalf("skipped: %v (want MasterID %d, slow)", sk, slow)
	}
	held := loadLedList(syncFolder(zz))
	if len(held) != n-1 {
		t.Fatalf("the list held: %d ledgers, want %d", len(held), n-1)
	}
	if !strings.Contains(readText(logFile()), fmt.Sprintf("the ledger with MasterID %d (name not known) takes Tally longer than 2 s (stopped 3 times in a row)", slow)) {
		t.Fatal("the skip was not said")
	}
	asked0 := slowAsks(f, slow)

	// Update now, even a day later: never asks it (review H1: the nightly run only)
	led255Yesterday(t, slow)
	led255Round(t, f, "r255f", "now")
	if slowAsks(f, slow) != asked0 {
		t.Fatal("Update now asked for the slow ledger")
	}
	// the night's run a day later, still slow: asked once alone, stays skipped, named again (once in the outbox)
	led255Round(t, f, "r255g", "nightly")
	if slowAsks(f, slow) != asked0+1 || len(poisonMids(readKeepState(syncFolder(zz)))) != 1 {
		t.Fatalf("still slow: asked %d more time(s), skipped %v", slowAsks(f, slow)-asked0, poisonMids(readKeepState(syncFolder(zz))))
	}
	if r := arr(skippedLedgers(zz)); len(r) != 1 || !strings.Contains(str(at(arr(r[0]), 2)), "still takes Tally longer than 2 s") {
		t.Fatalf("named while skipped: %v", r)
	}
	if o := readObjFile(ledOutFile(syncFolder(zz))); o != nil && len(withMid(arr(o["skipped"]), slow)) > 1 {
		t.Fatalf("named twice in the outbox: %v", o["skipped"])
	}
	// the same day again: not asked; the ledger wake never asks it
	led255Round(t, f, "r255h", "nightly")
	led255Yesterday(t, slow)
	led255Round(t, f, "r255i", "ledgers")
	if slowAsks(f, slow) != asked0+1 {
		t.Fatalf("asked %d times more (want once a day, the night's run only)", slowAsks(f, slow)-asked0)
	}
	// a later night, quick again: asked once, read, no longer skipped (and gone from the outbox)
	f.mu.Lock()
	f.slow = nil
	f.mu.Unlock()
	led255Round(t, f, "r255j", "nightly")
	st = readKeepState(syncFolder(zz))
	if len(poisonMids(st)) != 0 || len(arr(skippedLedgers(zz))) != 0 || len(loadLedList(syncFolder(zz))) != n {
		t.Fatalf("cleared: skipped %v, held %d", poisonMids(st), len(loadLedList(syncFolder(zz))))
	}
	if o := readObjFile(ledOutFile(syncFolder(zz))); o != nil && len(withMid(arr(o["skipped"]), slow)) != 0 {
		t.Fatalf("still named in the outbox after it was cleared: %v", o["skipped"])
	}
	before := slowAsks(f, slow)
	led255Round(t, f, "r255k", "now")
	if slowAsks(f, slow) != before+1 || len(loadLedList(syncFolder(zz))) != n {
		t.Fatal("not read normally after it was cleared")
	}
}

// reviews H1, N2: a ledger Tally keeps far longer than the stop (past LedgerHangSec): each such stop is one of three in
// a row; after three it hangs Tally. It is asked again only at a nightly run a week on (never Update now, never sooner),
// and a night's retry never goes while a posting does; answering in time clears it
func TestLedger255HangingLedgerRetriedWeekly(t *testing.T) {
	const n = 300
	f := ledgerTally(t, n, `,"LedgerChunk":250,"LedgerChunkMin":125,"RecorderStopCoolSec":1,"RecorderLimitMs":500,"LedgerHangSec":1,"TallyAbandonMaxSec":600`)
	f.mu.Lock()
	hang := f.led[76].mid
	f.mu.Unlock()
	led255SlowMids(f, 1800*time.Millisecond, hang) // Tally keeps it 1.8 s: past the 1 s taken as hanging here
	led255Run(t, f, newRun("now", "r255m"), 160, 1500*time.Millisecond)
	st := readKeepState(syncFolder(zz))
	if sk := arr(st["ledPoison"]); len(sk) != 1 || toI64(at(arr(sk[0]), 0)) != hang || !strings.Contains(str(at(arr(sk[0]), 2)), "does not answer and holds Tally (stopped 3 times in a row") || slowSkipped(st, hang) {
		t.Fatalf("skipped: %v (want MasterID %d as hanging Tally, after three stops)", sk, hang)
	}
	if len(loadLedList(syncFolder(zz))) != n-1 {
		t.Fatal("the rest was not read")
	}
	asked := slowAsks(f, hang)
	// Update now and a nightly run the same week: not asked
	led255SetTry(t, hang, addDays(today(), -3))
	led255Round(t, f, "r255n1", "now")
	led255Round(t, f, "r255n2", "nightly")
	if slowAsks(f, hang) != asked {
		t.Fatal("a ledger that hangs Tally was asked again within the week")
	}
	// a week on, a posting going at the night's run: not asked, the try not used
	led255SetTry(t, hang, addDays(today(), -7))
	importsInFlight.Add(1)
	led255Round(t, f, "r255n3", "nightly")
	importsInFlight.Store(0)
	if slowAsks(f, hang) != asked || str(obj(readKeepState(syncFolder(zz))["ledSlowTry"])[fmt.Sprint(hang)]) == today() {
		t.Fatal("the retry went (or used the try) while a posting was going")
	}
	// the posting done, still hanging: asked once, stays skipped as hanging Tally, the next try a week on
	led255Round(t, f, "r255n4", "nightly")
	st = readKeepState(syncFolder(zz))
	if slowAsks(f, hang) != asked+1 || len(poisonMids(st)) != 1 || slowSkipped(st, hang) || str(obj(st["ledSlowTry"])[fmt.Sprint(hang)]) != today() {
		t.Fatalf("the weekly retry: asked %d more, skipped %v", slowAsks(f, hang)-asked, arr(st["ledPoison"]))
	}
	// another week on, quick now: read and no longer skipped
	led255SlowMids(f, 0)
	led255SetTry(t, hang, addDays(today(), -8))
	led255Round(t, f, "r255n5", "nightly")
	if st = readKeepState(syncFolder(zz)); len(poisonMids(st)) != 0 || len(loadLedList(syncFolder(zz))) != n {
		t.Fatalf("cleared: skipped %v, held %d", poisonMids(st), len(loadLedList(syncFolder(zz))))
	}
}

// second review N1: after the halving the chunks grow back only until the first stop, then keep the last size that
// answered in time: no stop every other chunk. (a) a Tally just over 2 s for 124 ledgers; (b) just over 2 s for about
// 1,000 ledgers, after one slow ledger
func TestLedger255GrowBackStopsAtFirstStop(t *testing.T) {
	for _, c := range []struct {
		name    string
		n       int
		over    int64 // a chunk of this many MasterIDs or more is over the stop
		slowIdx int   // -1: none
	}{{"124", 1500, 124, -1}, {"1000-after-slow", 6000, 1000, 3000}} {
		t.Run(c.name, func(t *testing.T) {
			f := ledgerTally(t, c.n, `,"RecorderStopCoolSec":1,"RecorderLimitMs":500,"LedgerHangSec":5,"TallyAbandonMaxSec":600`)
			slow := int64(-1)
			f.mu.Lock()
			if c.slowIdx >= 0 {
				slow = f.led[c.slowIdx].mid
			}
			f.slow = func(id, body string) time.Duration {
				m := reMidRange.FindStringSubmatch(body)
				if id != ledListID || m == nil || m[2] == "" {
					return 0
				}
				a, b := toI64(m[1]), toI64(m[2])
				if b-a >= c.over || (a < slow && slow <= b) {
					return 800 * time.Millisecond
				}
				return 0
			}
			f.mu.Unlock()
			plain, _ := led255Run(t, f, newRun("now", "r255g-"+c.name), 200, 2*time.Minute)
			want := c.n
			if slow > 0 {
				want--
			}
			if got := len(loadLedList(syncFolder(zz))); got != want {
				t.Fatalf("held %d, want %d", got, want)
			}
			lg := readText(logFile())
			i := strings.LastIndex(lg, "as the chunks grew back;")
			if i < 0 {
				t.Fatal("the growth never met a stop")
			}
			if after := strings.Count(lg[i:], "(stopped)"); after != 0 {
				t.Fatalf("%d stop(s) after the size was kept: the chunks alternate", after)
			}
			stops := strings.Count(lg, "(stopped)")
			real := time.Duration(stops)*32*time.Second + time.Duration(plain)*2*time.Minute
			if real > time.Hour {
				t.Fatalf("%d stops, %d plain ends: about %s in real time", stops, plain, real)
			}
			t.Logf("%s: %d requests, %d stops, %d plain ends (about %s in real time)", c.name, len(ledRanges(f)), stops, plain, real)
		})
	}
}

// review M2: 50,000 ledgers with one slow ledger: after the halving the chunks grow back to the full 2,000, and the round
// finishes in a few dozen requests (well within LedgerResumeHours, the round never started again)
func TestLedger255SlowPatchLargeCompanyFinishes(t *testing.T) {
	const n = 50000
	// fourth review: a limit of 1.5 s, so a 2,000 chunk in time never trips the stop on a loaded machine; the slow ledger
	// (1.8 s) still does
	f := ledgerTally(t, n, `,"RecorderStopCoolSec":1,"RecorderLimitMs":1500,"LedgerHangSec":5,"TallyAbandonMaxSec":600`)
	f.mu.Lock()
	slow := f.led[20000].mid
	f.mu.Unlock()
	led255SlowMids(f, 1800*time.Millisecond, slow)
	k := newRun("now", "r255q")
	t0 := time.Now()
	plain, turns := led255Run(t, f, k, 120, 2*time.Minute) // a turn reads many 2,000 chunks in time here
	if len(loadLedList(syncFolder(zz))) != n-1 || !slowSkipped(readKeepState(syncFolder(zz)), slow) {
		t.Fatalf("held %d, slow skipped %v", len(loadLedList(syncFolder(zz))), slowSkipped(readKeepState(syncFolder(zz)), slow))
	}
	rs := ledRanges(f)
	// back to the full chunk after the slow ledger: the last chunks before the end are 2,000 MasterIDs
	last := rs[len(rs)-2]
	a := strings.SplitN(last, "-", 2)
	if toI64(a[1])-toI64(a[0]) != 2000 {
		t.Fatalf("the chunks after the slow patch: %v", rs[len(rs)-6:])
	}
	// the cost in real time: every stop's cool-down (30 s) and each plain end's back-off (1 minute, doubling, reset by a
	// chunk in time: 1 + 2 minutes per run of three) stay far within LedgerResumeHours (6 h)
	stops := strings.Count(readText(logFile()), "(stopped)")
	real := time.Duration(stops)*32*time.Second + time.Duration(plain)*2*time.Minute
	if len(rs) > n/2000+60 || real > time.Hour {
		t.Fatalf("%d requests, %d stops, %d plain ends: about %s in real time", len(rs), stops, plain, real)
	}
	t.Logf("50,000 ledgers, one slow: %d requests, %d stops, %d plain ends (about %s in real time); %d turns, %s here", len(rs), stops, plain, real, turns, time.Since(t0).Round(time.Second))
}

// review L3: the natures of payment stopped at 2 s: counted (as not answering), said in the round's end line and in the
// company's trouble
func TestLedger255NaturesStoppedCounted(t *testing.T) {
	f := ledgerTally(t, 30, `,"RecorderStopCoolSec":1`)
	f.mu.Lock()
	f.slow = func(id, body string) time.Duration {
		if id == natListID {
			return 2400 * time.Millisecond
		}
		return 0
	}
	f.mu.Unlock()
	led255Round(t, f, "r255r", "now")
	st := readKeepState(syncFolder(zz))
	if toInt(st["natMiss"]) != 0 || toInt(st["natStops"]) != 1 || !truthy(st["natWaitNight"]) || str(st["natOffVer"]) != "" ||
		!strings.Contains(str(obj(st["trouble"])["why"]), "Tally took longer than 2 s for the natures of payment") {
		t.Fatalf("natMiss %v, natStops %v, wait %v, off %v, trouble %v", st["natMiss"], st["natStops"], st["natWaitNight"], st["natOffVer"], st["trouble"])
	}
	if !strings.Contains(readText(logFile()), "; the natures of payment were stopped at 2 s (1 time(s) so far)") {
		t.Fatal("the round's end line does not say it")
	}
	// second review N5: never turned off; Update now does not ask them again, the next nightly run does
	asked := f.n(natListID)
	led255Round(t, f, "r255s", "now")
	led255Round(t, f, "r255t", "now")
	if f.n(natListID) != asked || str(readKeepState(syncFolder(zz))["natOffVer"]) != "" {
		t.Fatal("asked again before the nightly run, or turned off")
	}
	f.mu.Lock()
	f.slow = nil
	f.mu.Unlock()
	led255Round(t, f, "r255u", "nightly")
	if st = readKeepState(syncFolder(zz)); f.n(natListID) == asked || truthy(st["natWaitNight"]) {
		t.Fatal("the nightly run did not ask the natures again")
	}
}

func withMid(l []any, mid int64) []any {
	var o []any
	for _, x := range l {
		if toI64(at(arr(x), 0)) == mid {
			o = append(o, x)
		}
	}
	return o
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

// a skipped ledger's last try set to a day
func led255SetTry(t *testing.T, mid int64, day string) {
	t.Helper()
	dir := syncFolder(zz)
	st := readKeepState(dir)
	tries := obj(st["ledSlowTry"])
	if tries == nil {
		tries = M{}
	}
	tries[fmt.Sprint(mid)] = day
	st["ledSlowTry"] = tries
	saveKeepState(dir, st)
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

// third review T1: a round that completes while a push of the ledger outbox is still going: no ledger change is lost
// (one lock over every read, change and write of the outbox)
func TestLedger255RoundDuringPushLosesNothing(t *testing.T) {
	f := newStandTally(t)
	f.grp = [][2]string{{"Sundry Creditors", ""}}
	for i := 1; i <= 50; i++ {
		f.addLed(fmt.Sprintf("Party %05d", i), "Sundry Creditors", "0.00")
	}
	c := newStandCloud(t)
	standBridge(t, f, `,"KeepBudgetSec":600`+c.cfg())
	liveFrom(today())
	dir := syncFolder(zz)
	if err := newRun("now", "r255p1").step(zz, f.port, ""); err != nil {
		t.Fatal(err)
	}
	if !exists(ledOutFile(dir)) {
		t.Fatal("no outbox after the first round")
	}
	// a slow push of the outbox (the cloud answers each batch in 2 s), and meanwhile a round with a new ledger completes
	c.mu.Lock()
	c.ledDelay = 2 * time.Second
	c.mu.Unlock()
	done := make(chan struct{})
	go func() { defer close(done); _ = pushLedgerList(zz, dir) }()
	time.Sleep(300 * time.Millisecond)
	f.addLed("Party new one", "Sundry Creditors", "0.00")
	if err := newRun("now", "r255p2").step(zz, f.port, ""); err != nil {
		t.Fatal(err)
	}
	<-done
	c.mu.Lock()
	c.ledDelay = 0
	c.mu.Unlock()
	if err := pushLedgerList(zz, dir); err != nil {
		t.Fatal(err)
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	for _, b := range c.ledList {
		if strings.Contains(jsonText(b), "Party new one") {
			return
		}
	}
	t.Fatalf("the new ledger never reached FinCom (%d ledger lists sent)", len(c.ledList))
}
