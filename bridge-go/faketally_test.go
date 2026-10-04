package main

// Plan item 8: a fake Tally that fails the ways Tally failed on 02-Oct-2026, and the permanent tests built on it. The
// behaviours extend the stand-in Tally (standTally, rebuilt_test.go) through its behave hook:
//   - slow: answers late (standTally.slow);
//   - silent: takes the request and never answers;
//   - wrong company: another company's name, or the same name with another GUID;
//   - mid-save: half an answer (a message box in Tally mid-save), then nothing;
//   - poison ledger: only the ledger-list chunk holding one MasterID hangs.
// Every test uses short timeouts from the config (TallyMaxSec 1) so it runs in seconds.

import (
	"fmt"
	"net/http"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// silent: the request is taken and never answered (until the bridge closes it); held is how long each was held
type fakeLog struct {
	mu   sync.Mutex
	held []time.Duration
}

func (l *fakeLog) longest() time.Duration {
	l.mu.Lock()
	defer l.mu.Unlock()
	var m time.Duration
	for _, d := range l.held {
		if d > m {
			m = d
		}
	}
	return m
}

func silentFor(match func(id, body string) bool, log *fakeLog) func(w http.ResponseWriter, r *http.Request, id, body string) bool {
	return func(w http.ResponseWriter, r *http.Request, id, body string) bool {
		if !match(id, body) {
			return false
		}
		t0 := time.Now()
		<-r.Context().Done()
		if log != nil {
			log.mu.Lock()
			log.held = append(log.held, time.Since(t0))
			log.mu.Unlock()
		}
		return true
	}
}

// mid-save: the start of an answer, then nothing
func midSave(match func(id string) bool) func(w http.ResponseWriter, r *http.Request, id, body string) bool {
	return func(w http.ResponseWriter, r *http.Request, id, body string) bool {
		if !match(id) {
			return false
		}
		w.Header().Set("Content-Length", "100000")
		_, _ = w.Write([]byte("<ENVELOPE><BODY><DATA><COLLECTION><VOUCHER><DATE>2026"))
		if fl, ok := w.(http.Flusher); ok {
			fl.Flush()
		}
		<-r.Context().Done()
		return true
	}
}

// poison: the ledger-list chunk whose MasterID range holds mid hangs; every other chunk answers
func poisonLedger(mid int64) func(w http.ResponseWriter, r *http.Request, id, body string) bool {
	return func(w http.ResponseWriter, r *http.Request, id, body string) bool {
		if id != ledListID {
			return false
		}
		m := reMidRange.FindStringSubmatch(body)
		if m == nil {
			return false
		}
		after, upto := toI64(m[1]), int64(1<<62)
		if m[2] != "" {
			upto = toI64(m[2])
		}
		if mid > after && mid <= upto {
			<-r.Context().Done()
			return true
		}
		return false
	}
}

func isID(ids ...string) func(id, body string) bool {
	return func(id, body string) bool { return contains(ids, id) }
}

// --- the behaviours themselves
func TestFakeTallyBehaviours(t *testing.T) {
	td := today()
	t.Run("silent", func(t *testing.T) {
		f := newStandTally(t)
		var l fakeLog
		f.behave = silentFor(isID("TDSDeskNames"), &l)
		standBridge(t, f, `,"TallyMaxSec":1`)
		oldDaysOn() // round 19: ReadDays on: invokeTally refuses every dated request with it off; this test is about the dated logic
		t0 := time.Now()
		if _, err := getLedgerNames(fin, zz, f.port); err == nil || !isBusyErr(err) {
			t.Fatalf("a silent Tally: %v", err)
		}
		if el := time.Since(t0); el > 3*time.Second {
			t.Fatalf("held %s", el)
		}
	})
	t.Run("mid-save", func(t *testing.T) {
		f := newStandTally(t)
		f.behave = midSave(func(id string) bool { return id == "Day Book" })
		standBridge(t, f, `,"TallyMaxSec":1`)
		oldDaysOn() // round 19: ReadDays on: invokeTally refuses every dated request with it off; this test is about the dated logic
		t0 := time.Now()
		if _, err := getDayBookXML(fin, zz, td, td, f.port); err == nil || !isBusyErr(err) {
			t.Fatalf("half an answer: %v", err)
		}
		if el := time.Since(t0); el > 3*time.Second {
			t.Fatalf("held %s", el)
		}
		if !needProbe(f.port) {
			t.Fatal("half an answer was not taken as Tally not answering")
		}
	})
	t.Run("wrong company name", func(t *testing.T) {
		f := newStandTally(t)
		f.coName = "SOME OTHER CO"
		standBridge(t, f, "")
		oldDaysOn() // round 19: ReadDays on: invokeTally refuses every dated request with it off; this test is about the dated logic
		res, err := invokeImport(M{"company": zz, "vouchers": []any{M{"id": "w1", "xml": finVoucher("w1", fgParty, "W-1", td, "1.00")}}})
		if err == nil || !strings.Contains(err.Error(), "is not open in Tally") || f.n("Import") != 0 {
			t.Fatalf("posted with another company open: %v %v", res, err)
		}
	})
	t.Run("wrong company GUID", func(t *testing.T) {
		f := newStandTally(t)
		standBridge(t, f, "")
		oldDaysOn() // round 19: ReadDays on: invokeTally refuses every dated request with it off; this test is about the dated logic
		noteCompanyGUID(zz, "co-guid-held")
		r := postOne(t, "w2", finVoucher("w2", fgParty, "W-2", td, "1.00"))
		if r["ok"] == true || r["guidMismatch"] != true || f.n("Import") != 0 {
			t.Fatalf("posted to a company with another GUID: %v", r)
		}
	})
}

// --- 02-Oct-2026, permanent: a read Tally would have held for 900 s. No request runs past 20 s (here the cut is 1 s);
// after it only the small check goes, once a minute, until Tally answers it
func Test02Oct900sRead(t *testing.T) {
	td := today()
	f := newStandTally(t)
	f.add(td, fgParty, "X-1", "sale", "-1.00")
	standBridge(t, f, "")
	oldDaysOn() // the owner's rule of 04-Oct-2026 turns reading old days off (ReadDays); the round's day logic is still tested here
	if m := tallyMaxSec(); m > 20 {
		t.Fatalf("a request may hold Tally %d s by default (20 at most)", m)
	}
	setCfg("TallyMaxSec", 1)
	setCfg("TallyProbeSec", 1)
	liveFrom(td)
	var l fakeLog
	var busy atomic.Bool
	busy.Store(true)
	// the run's day book is the 900-second read: Tally takes it and does not answer
	f.mu.Lock()
	f.behave = func(w http.ResponseWriter, r *http.Request, id, body string) bool {
		if busy.Load() && (id == "Day Book" || l.longest() > 0) {
			return silentFor(func(string, string) bool { return true }, &l)(w, r, id, body)
		}
		return false
	}
	f.mu.Unlock()
	if !startKeepRun(runReq{kind: "now", why: "test"}) {
		t.Fatal("no run started")
	}
	for i := 0; i < 300 && logLines("Leaving Tally alone until") == 0; i++ {
		time.Sleep(20 * time.Millisecond)
	}
	if logLines("Leaving Tally alone until") == 0 {
		t.Fatal("the run did not leave Tally alone after the read that did not answer")
	}
	if f.n("Day Book") != 1 {
		t.Fatalf("the day book was asked %d times (want once, nothing stacked on it)", f.n("Day Book"))
	}
	if lo := l.longest(); lo > 2*time.Second || lo < 900*time.Millisecond {
		t.Fatalf("the read was held %s (the cut is 1 s)", lo)
	}
	// Tally still working on it (everything silent): within the minute nothing goes, a posting neither
	start := time.Now()
	n0 := f.n("")
	for _, sec := range []int{1, 30, 55} {
		nowFn = func() time.Time { return start.Add(time.Duration(sec) * time.Second) }
		if _, err := getLedgerNames(fin, zz, f.port); err == nil {
			t.Fatal("answered while Tally is busy")
		}
		if r := postOne(t, fmt.Sprint("b", sec), finVoucher(fmt.Sprint("b", sec), fgParty, fmt.Sprint("B-", sec), td, "2.00")); r["ok"] == true {
			t.Fatal("posted while Tally is busy")
		}
	}
	if f.n("") != n0 {
		t.Fatalf("within the minute %v went to Tally", f.ids()[n0:])
	}
	// past the minute: the small check alone (whoever asks), not answered
	nowFn = func() time.Time { return start.Add(61 * time.Second) }
	_, _ = getLedgerNames(fin, zz, f.port)
	time.Sleep(1500 * time.Millisecond)
	if s := f.ids()[n0:]; len(s) != 1 || s[0] != "FinComCompany" {
		t.Fatalf("after a minute: %v (want the small check only)", s)
	}
	// Tally free: the check answers and the read goes on
	busy.Store(false)
	later := start.Add(3 * time.Hour)
	nowFn = func() time.Time { return later }
	if _, err := getLedgerNames(fin, zz, f.port); err != nil {
		t.Fatalf("Tally free again: %v", err)
	}
	waitIdle(t)
	nowFn = time.Now
	if lo := l.longest(); lo > 2*time.Second {
		t.Fatalf("a request was held %s", lo)
	}
	f.noBalance(t)
	f.noLedgerCollection(t)
}

// --- 02-Oct-2026, permanent: after a timeout nothing is queued behind it. FinCom's requests that waited for Tally
// meanwhile are refused at once without a byte sent, and the next run sends nothing until the small check may go
func Test02OctStackedRetries(t *testing.T) {
	td := today()
	f := newStandTally(t)
	var l fakeLog
	f.behave = silentFor(isID("Day Book"), &l)
	standBridge(t, f, `,"TallyMaxSec":1,"TallyProbeSec":1`)
	oldDaysOn() // round 19: ReadDays on: invokeTally refuses every dated request with it off; this test is about the dated logic
	liveFrom(td)
	var wg sync.WaitGroup
	wg.Add(1)
	go func() {
		defer wg.Done()
		_, _ = getDayBookXML(fin, zz, td, td, f.port) // FinCom's own read: not stopped for the others
	}()
	for i := 0; i < 50 && f.n("Day Book") == 0; i++ {
		time.Sleep(20 * time.Millisecond)
	}
	var errs atomic.Int32
	t0 := time.Now()
	for i := 0; i < 5; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if _, err := getLedgerNames(fin, zz, f.port); err != nil {
				errs.Add(1)
			}
		}()
	}
	wg.Wait()
	if errs.Load() != 5 {
		t.Fatalf("%d of the 5 waiting requests were refused (want all)", errs.Load())
	}
	if el := time.Since(t0); el > 3*time.Second {
		t.Fatalf("the waiting requests took %s", el)
	}
	after := func() []string {
		got := f.ids()
		for i, id := range got {
			if id == "Day Book" {
				return got[i+1:]
			}
		}
		return got
	}
	if got := after(); len(got) != 0 {
		t.Fatalf("sent after the timeout: %v (want nothing after the read that did not answer)", got)
	}
	// a run now: nothing is sent while the check may not go yet (the run waits, sending nothing)
	if !startKeepRun(runReq{kind: "now", why: "test"}) {
		t.Fatal("no run started")
	}
	time.Sleep(1500 * time.Millisecond)
	if got := after(); len(got) != 0 {
		t.Fatalf("the run sent %v", got)
	}
	// Tally free and the minute past: the run reads and ends
	f.mu.Lock()
	f.behave = nil
	f.mu.Unlock()
	later := time.Now().Add(3 * time.Hour)
	nowFn = func() time.Time { return later }
	waitIdle(t)
	nowFn = time.Now
	f.mu.Lock()
	mx := f.maxFlight
	f.mu.Unlock()
	if mx != 1 {
		t.Fatalf("%d requests at Tally at once", mx)
	}
}

// --- 02-Oct-2026, permanent: a posting while a read is running goes within seconds (the read is stopped at once and
// resumes after)
func Test02OctPostingDuringRead(t *testing.T) {
	td := today()
	f := newStandTally(t)
	f.add(td, fgParty, "R-1", "sale", "-1.00")
	var once sync.Once
	f.slow = func(id, body string) time.Duration {
		d := time.Duration(0)
		if id == "Day Book" {
			once.Do(func() { d = 15 * time.Second })
		}
		return d
	}
	standBridge(t, f, "")
	oldDaysOn() // the owner's rule of 04-Oct-2026 turns reading old days off (ReadDays); the round's day logic is still tested here
	liveFrom(td)
	if !startKeepRun(runReq{kind: "now", why: "test"}) {
		t.Fatal("no run started")
	}
	for i := 0; i < 200; i++ {
		f.mu.Lock()
		in := f.inflight > 0 && len(f.reqs) > 0 && f.reqs[len(f.reqs)-1] == "Day Book"
		f.mu.Unlock()
		if in {
			break
		}
		time.Sleep(20 * time.Millisecond)
	}
	t0 := time.Now()
	r := postOne(t, "dr1", finVoucher("dr1", fgParty, "DR-1", td, "7.00"))
	el := time.Since(t0)
	if r["ok"] != true || r["byReply"] != true { // round 15: posted by Tally's reply, nothing read back
		t.Fatalf("the posting during the read: %v", r)
	}
	if el > 3*time.Second {
		t.Fatalf("the posting took %s while a read was running (want seconds)", el)
	}
	if logLines("a background read was stopped at once so FinCom's request goes first") < 1 {
		t.Fatal("the read was not stopped for the posting")
	}
	waitIdle(t)
	if f.n("Day Book") < 2 {
		t.Fatal("the read did not resume after the posting")
	}
	t.Logf("posting confirmed %s after it was asked, with a read running", el.Round(time.Millisecond))
}

// --- 02-Oct-2026, permanent: a ledger that hangs Tally. Halving the chunk isolates it; it is skipped and named in what
// goes to FinCom's cloud, and the rest of the list arrives
func Test02OctPoisonLedger(t *testing.T) {
	const n, poison = 40, int64(13)
	c := newStandCloud(t)
	f := ledgerTally(t, n, `,"TallyMaxSec":1,"TallyProbeSec":1,"LedgerChunk":8,"LedgerChunkMin":4`+c.cfg())
	push := func() {
		cloudMu.Lock()
		cloudLinksAt = time.Time{}
		cloudMu.Unlock()
		invokeCloudPush()
	}
	// a first round with no trouble: the list is held (with every ledger's name)
	runNow(t, "now")
	push()
	dir := syncFolder(zz)
	if len(loadLedList(dir)) != n {
		t.Fatalf("the first round held %d ledgers", len(loadLedList(dir)))
	}
	c.mu.Lock()
	c.ledList = nil
	c.mu.Unlock()
	// now the ledger with MasterID 13 hangs Tally
	f.mu.Lock()
	f.behave = poisonLedger(poison)
	f.mu.Unlock()
	start := time.Now()
	off := time.Duration(0)
	k := newRun("now", "poison")
	var err error
	for i := 0; i < 30; i++ {
		if err = k.step(zz, f.port, ""); err == nil {
			break
		}
		off += 2 * time.Minute // the small check may go again
		o := off
		nowFn = func() time.Time { return time.Now().Add(o) }
	}
	nowFn = time.Now
	if err != nil {
		t.Fatalf("the round did not finish: %v", err)
	}
	if el := time.Since(start); el > 20*time.Second {
		t.Fatalf("isolating the ledger took %s", el)
	}
	st := readKeepState(dir)
	if p := poisonMids(st); len(p) != 1 || p[0] != poison {
		t.Fatalf("the ledger that hangs: %v", st["ledPoison"])
	}
	if logLines(fmt.Sprintf("the ledger with MasterID %d (Party 00013) does not answer and holds Tally; it is skipped", poison)) != 1 {
		t.Fatal("the log does not name the ledger")
	}
	held := loadLedList(dir)
	if len(held) != n {
		t.Fatalf("%d ledgers held after the round (the skipped one must not be taken as deleted)", len(held))
	}
	// the cloud: the skipped ledger named, nothing deleted
	push()
	c.mu.Lock()
	sent := append([]M{}, c.ledList...)
	c.mu.Unlock()
	named := false
	for _, b := range sent {
		for _, x := range arr(b["skipped"]) {
			a := arr(x)
			if toI64(at(a, 0)) == poison && str(at(a, 1)) == "Party 00013" {
				named = true
			}
		}
		if _, has := b["deleted"]; has {
			t.Fatalf("ledgers deleted in the cloud: %v", b["deleted"])
		}
	}
	if !named {
		t.Fatalf("the skipped ledger was not named to the cloud: %v", sent)
	}
	// the next round never asks for it again
	f.mu.Lock()
	f.behave = func(w http.ResponseWriter, r *http.Request, id, body string) bool {
		if poisonLedger(poison)(w, r, id, body) {
			t.Errorf("the ledger that hangs was asked again: %s", cut(body, 300))
			return true
		}
		return false
	}
	f.mu.Unlock()
	if err := newRun("now", "after").step(zz, f.port, ""); err != nil {
		t.Fatalf("the round after: %v", err)
	}
	if len(loadLedList(dir)) != n {
		t.Fatal("the list held after the next round")
	}
	f.noBalance(t)
}
