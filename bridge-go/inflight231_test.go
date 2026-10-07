package main

// Bridge 2.3.1, the owner's rule on a busy Tally (06-Oct-2026): the bridge never piles up requests.
//  1. One request in flight per Tally at any time, a request the bridge stopped waiting for included: the per-Tally lock
//     stays held until Tally has answered (the answer read and discarded) or closed that request, at most
//     TallyAbandonMaxSec (10 minutes), after which Tally is taken as not answering (one log line) and the lock goes.
//     Postings and a person's requests wait for it too ("waiting for Tally to finish an earlier request").
//  2. A single-entry fetch waits up to 20 s (RecorderEntryLimitMs); the other background reads keep 2 s; after giving up,
//     the shared retry schedule.
//  3. Waiting entries are fetched one after another, never two at once.
// Written before the code.

import (
	"fmt"
	"net/http"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// a stand Tally that holds the requests matching busy until released (as a real Tally keeps working on a request the
// bridge stopped waiting for), and counts the requests at it at once
type busyStand struct {
	mu      sync.Mutex
	release chan struct{}
	now     atomic.Int32 // requests at Tally now
	most    atomic.Int32 // the most at once
}

func (b *busyStand) free() {
	b.mu.Lock()
	defer b.mu.Unlock()
	select {
	case <-b.release:
	default:
		close(b.release)
	}
}

func holdBusy(f *standTally, busy func(id string) bool) *busyStand {
	b := &busyStand{release: make(chan struct{})}
	f.mu.Lock()
	f.behave = func(w http.ResponseWriter, r *http.Request, id, body string) bool {
		n := b.now.Add(1)
		defer b.now.Add(-1)
		for {
			m := b.most.Load()
			if n <= m || b.most.CompareAndSwap(m, n) {
				break
			}
		}
		b.mu.Lock()
		rel := b.release
		b.mu.Unlock()
		if busy(id) {
			select {
			case <-rel:
			case <-r.Context().Done():
				return true // the bridge closed it (it must not before Tally answers)
			}
		}
		return false
	}
	f.mu.Unlock()
	return b
}

// a voucher of the stand's company, above a recorded starting point (the entry request goes only then)
func inflightVoucher(f *standTally) string {
	f.mu.Lock()
	f.alter = 10
	f.mu.Unlock()
	noteCompanyGUID(zz, b220CoGUID)
	noteStartPoint(zz, b220CoGUID, 5, 1)
	return f.add(today(), "Party IF", "IF-0", "busy", "-1.00").master
}

// the cleanup: Tally answers, and its late answer is logged while this test's log is still the log
func earlierQuiet(port int) {
	for i := 0; i < 100 && earlierBusy(port); i++ {
		time.Sleep(20 * time.Millisecond)
	}
	time.Sleep(50 * time.Millisecond)
}

// until the port's earlier request is over (the answer came and was discarded)
func waitEarlierOver(t *testing.T, port int) {
	t.Helper()
	for i := 0; i < 200 && earlierBusy(port); i++ {
		time.Sleep(50 * time.Millisecond)
	}
	if earlierBusy(port) {
		t.Fatal("the earlier request is still held after Tally answered")
	}
}

// --- after an abandoned request nothing else goes to that Tally until Tally answers it: not a background read, not a
// person's read, not a posting (which waits, with plain words, and is not lost)
func TestInflightNothingSentWhileAbandoned(t *testing.T) {
	td := today()
	f := newStandTally(t)
	// next-inflight: Tally finishes it after the wait (1 s here), so the late answer is said as such
	standBridge(t, f, `,"RecorderEntryLimitMs":1000,"TallyAbandonWaitSec":1,"TallyAbandonMaxSec":600`)
	liveFrom(td)
	mid := inflightVoucher(f)
	b := holdBusy(f, func(id string) bool { return id == vchByMasterID })
	t.Cleanup(func() { b.free(); earlierQuiet(f.port) }) // the held request ends before the test's log goes
	t0 := time.Now()
	_, err := fetchVouchersByMasterIn(entryTC(nil), zz, f.port, td, []string{mid}, 20)
	if !strings.Contains(errText(err), "stopped waiting") || time.Since(t0) > 3*time.Second {
		t.Fatalf("the entry fetch was not given up at its limit: %v after %s", err, time.Since(t0))
	}
	if !earlierBusy(f.port) || f.n("") != 1 {
		t.Fatalf("the abandoned request is not held as in flight (%v, %d requests)", earlierBusy(f.port), f.n(""))
	}
	// a background read at the retry's time: not sent
	retryDue()
	if _, err := invokeTally(recorderTC(nil), f.port, companyCheckRequest(zz), 5); !strings.Contains(errText(err), "waiting for Tally to finish an earlier request") {
		t.Fatalf("a background read while the earlier request is at Tally: %v", err)
	}
	// a posting: waits, says so, goes once Tally answers the earlier request
	done := make(chan M, 1)
	go func() { done <- postOne(t, "if1", finVoucher("if1", fgParty, "IF-1", td, "5.00")) }()
	time.Sleep(1500 * time.Millisecond)
	if f.n("") != 1 || f.n("Import") != 0 {
		t.Fatalf("sent while Tally is still on the earlier request: %v", f.ids())
	}
	if logLines("waiting for Tally to finish an earlier request") < 1 {
		t.Fatalf("the wait is not said in plain words:\n%s", readText(logFile()))
	}
	b.free() // Tally answers the earlier request (its answer is read and discarded)
	select {
	case r := <-done:
		if r["ok"] != true || f.n("Import") != 1 {
			t.Fatalf("the posting after the wait: %v", r)
		}
	case <-time.After(20 * time.Second):
		t.Fatal("the posting was lost while it waited")
	}
	waitEarlierOver(t, f.port)
	if b.most.Load() != 1 {
		t.Fatalf("%d requests at Tally at once (want 1)", b.most.Load())
	}
	if logLines("answered the earlier request") != 1 {
		t.Fatalf("the late answer is not said:\n%s", readText(logFile()))
	}
}

// --- the long bound: Tally never answers the abandoned request: after TallyAbandonMaxSec it is taken as not answering,
// said in one line, and the next request may go
func TestInflightAbandonBound(t *testing.T) {
	td := today()
	f := newStandTally(t)
	standBridge(t, f, `,"RecorderEntryLimitMs":500,"TallyAbandonMaxSec":2,"TallyProbeEverySec":1`) // next-inflight: the minute before the small check counts from the give-up (compressed here with the bound)
	liveFrom(td)
	mid := inflightVoucher(f)
	b := holdBusy(f, func(id string) bool { return id == vchByMasterID })
	t.Cleanup(func() { b.free(); earlierQuiet(f.port) }) // the held request ends before the test's log goes
	_, _ = fetchVouchersByMasterIn(entryTC(nil), zz, f.port, td, []string{mid}, 20)
	if !earlierBusy(f.port) {
		t.Fatal("not held")
	}
	time.Sleep(3 * time.Second)
	if earlierBusy(f.port) || logLines("did not answer an earlier request") != 1 {
		t.Fatalf("not released after the bound:\n%s", readText(logFile()))
	}
	if _, err := getLedgerNames(fin, zz, f.port); err != nil {
		t.Fatalf("a read after the bound: %v", err)
	}
}

// --- a single-entry fetch waits up to 20 s: an answer in 15 s is taken (not abandoned, no retry)
func TestInflightEntryFetch15sAccepted(t *testing.T) {
	p, f, c := r222bBridge(t, `,"RecorderBodySec":30,"RecorderEntryLimitMs":20000`)
	f.mu.Lock()
	f.slow = func(id, body string) time.Duration {
		if id == vchByMasterID {
			return 15 * time.Second
		}
		return 0
	}
	for _, v := range f.vch {
		if v.master == "26311" {
			v.alter = 54395
		}
	}
	f.mu.Unlock()
	liveAppend(t, p,
		r222Line("voucher_accept_pre", "09:00", r222GUID(26311), "26311", "54391", "Receipt", "191", "5-Oct-2026", "slow"),
		r222Line("voucher_accept_post", "09:00", r222GUID(26311), "26311", "54395", "Receipt", "191", "5-Oct-2026", "slow"))
	liveReadOnce()
	uploadAll(t)
	if sent := c.recSent(); len(sent) != 1 || str(sent[0]["xml"]) == "" || f.n(vchByMasterID) != 1 || retryHeld() {
		t.Fatalf("a 15 s answer was not taken: sent %v, asked %d, retry %v", sent, f.n(vchByMasterID), retryHeld())
	}
	// the other background reads keep the 2 s stop
	if recorderTC(nil).limitMs != 2000 || bgCompaniesTC().limitMs != 2000 || entryTC(nil).limitMs != 20000 {
		t.Fatalf("limits: background %d, company list %d, entry %d", recorderTC(nil).limitMs, bgCompaniesTC().limitMs, entryTC(nil).limitMs)
	}
}

// --- Tally busy for 5 minutes with 10 entries waiting: one request goes and is held; nothing more is sent while Tally is
// on it, whatever the retries; once Tally answers, the 10 entries are fetched one after another. The exact count is the
// test's: 1 while busy (the first entry's fetch, given up at its limit and held until Tally answers), then 10 (one per
// entry, the first asked again), never two at once
func TestInflightBusyFiveMinutesTenEntries(t *testing.T) {
	p, f, c := r222bBridge(t, `,"RecorderEntryLimitMs":1000,"TallyAbandonMaxSec":600`)
	base := time.Date(2026, 10, 5, 12, 0, 0, 0, liveZone)
	retryClock(base, 0)
	var lines []string
	for i := 0; i < 10; i++ {
		mid := int64(26500 + i)
		r222Vch(f, mid, "Journal", "", "20261005", int64(54600+i))
		lines = append(lines, r222Line("voucher_accept_post", "09:00", r222GUID(mid), fmtI(mid), fmtI(54600+int64(i)), "Journal", "", "5-Oct-2026", "busy"))
	}
	liveAppend(t, p, lines...)
	liveReadOnce()
	_, _ = findCompanyPortBg(nwsCo, 0) // the company looked for once before (its list answered in time)
	var busy atomic.Bool
	busy.Store(true)
	b := holdBusy(f, func(id string) bool { return busy.Load() && id == vchByMasterID })
	t.Cleanup(func() { b.free(); earlierQuiet(f.port) }) // the held request ends before the test's log goes
	n0 := f.n("")
	for sec := 0; sec <= 300; sec += 5 {
		retryClock(base, sec)
		liveReadOnce()
		liveUploadOnce()
	}
	during := f.n("") - n0
	t.Logf("Tally busy 5 minutes, 10 entries waiting: %d request(s) sent (%v)", during, f.ids()[n0:])
	if during != 1 || f.n(vchByMasterID) != 1 {
		t.Fatalf("requests while Tally is busy: %d (%v), want 1", during, f.ids()[n0:])
	}
	busy.Store(false)
	b.free()
	waitEarlierOver(t, f.port)
	for sec := 305; sec <= 900 && len(c.recSent()) < 10; sec += 5 {
		retryClock(base, sec)
		liveUploadOnce()
	}
	after := f.n(vchByMasterID) - 1
	t.Logf("after Tally answered: %d entry fetch(es), one after another (most at once: %d)", after, b.most.Load())
	if len(c.recSent()) != 10 || after != 10 || b.most.Load() != 1 {
		t.Fatalf("after Tally answered: sent %d, fetched %d, at once %d", len(c.recSent()), after, b.most.Load())
	}
	for _, s := range c.recSent() {
		if str(s["xml"]) == "" {
			t.Fatalf("an entry went without its body: %v", s)
		}
	}
}

func fmtI(n int64) string { return fmt.Sprint(n) }
