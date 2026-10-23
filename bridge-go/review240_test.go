package main

// release-240 final review (09-Oct-2026), bridge items, each written before its fix (red first).

import (
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func renumListAsks(c *standCloud, company string) int {
	c.mu.Lock()
	defer c.mu.Unlock()
	n := 0
	for _, b := range c.renumAsks {
		if str(b["company"]) == company {
			n++
		}
	}
	return n
}

// --- M1. FinCom's cloud failing renumber_list (HTTP 500) for one job: that job is not asked again at every turn (it waits,
// 30 s, then longer each time), and the other jobs get their turn meanwhile
func TestRenumberCloudFailureBacksOff(t *testing.T) {
	_, f, c := renumBridge(t, "")
	t.Cleanup(func() { nowFn = time.Now })
	const other, cg = "OTHER CO", "11111111-2222-3333-4444-555555555555"
	noteCompanyGUID(other, cg)
	noteStartPoint(other, cg, 10, 10)
	renumInsert(f, 26400, "20261005", "191")
	at := nowS()
	c.mu.Lock()
	inner := c.renumReply
	c.renumReply = func(b M) (int, M) {
		if str(b["company"]) == other {
			return 500, M{"ok": false, "error": "the cloud is down"}
		}
		return inner(b)
	}
	c.mu.Unlock()
	renumNote([]*renumJob{{Key: companyKey(other) + "|" + cg + "|receipt", Company: other, CGUID: cg, Type: "Receipt", Date: "20261005", No: "5", Mid: "77", Event: "created", At: at}})
	readAndUploadAll(t)
	renumNote([]*renumJob{{Key: companyKey(nwsCo) + "|" + strings.ToLower(nwsGUID) + "|receipt", Company: nwsCo, CGUID: nwsGUID, Type: "Receipt", Date: "20261005", No: "191", Mid: "26400", Event: "created", At: at}})
	for i := 0; i < 8; i++ {
		readAndUploadAll(t)
	}
	if n := renumListAsks(c, other); n != 1 {
		t.Fatalf("the failing job asked FinCom %d times in a few seconds (want once, then a wait)", n)
	}
	if alt := renumAltered(c); len(alt) != 4 {
		t.Fatalf("the other job did not get its turn: %v", alt)
	}
	// 31 s later: asked again; then it waits longer (60 s): not again 31 s after that
	t0 := time.Now()
	nowFn = func() time.Time { return t0.Add(31 * time.Second) }
	readAndUploadAll(t)
	if n := renumListAsks(c, other); n != 2 {
		t.Fatalf("after 31 s: %d asks (want 2)", n)
	}
	nowFn = func() time.Time { return t0.Add(62 * time.Second) }
	readAndUploadAll(t)
	if n := renumListAsks(c, other); n != 2 {
		t.Fatalf("31 s after the second failure: %d asks (want still 2: it waits 60 s now)", n)
	}
	nowFn = func() time.Time { return t0.Add(95 * time.Second) }
	readAndUploadAll(t)
	if n := renumListAsks(c, other); n != 3 {
		t.Fatalf("60 s after the second failure: %d asks (want 3)", n)
	}
}

// --- M4. a held line's fast ask is used only by its own entry request: Tally's company list (TDSDeskCompanies, asked
// first) saying the company is not open sends no entry request, so the line keeps both its asks; once the company is
// open, both are there (here each stops at 2 s: two entry requests in all, then the Day Book words)
func TestHeldAskNotUsedByCompanyListAlone(t *testing.T) {
	_, f, c := slow232Bridge(t)
	t.Cleanup(func() { nowFn = time.Now })
	r222Vch(f, 25791, "Journal", "", "20261005", 54591)
	stopSlowMids(f, 700*time.Millisecond, 25791)
	if err := saveFile(liveHeldFile(), jsonText(M{"items": M{"held-slow": heldFreshItem()}})); err != nil {
		t.Fatal(err)
	}
	closed := false
	lists := 0
	f.mu.Lock()
	f.behave = func(w http.ResponseWriter, r *http.Request, id, body string) bool {
		if id == "TDSDeskCompanies" && closed {
			lists++
			_, _ = w.Write([]byte(`<ENVELOPE><BODY><DATA><COLLECTION><COMPANY NAME="OTHER CO"><NAME TYPE="String">OTHER CO</NAME><GUID TYPE="String">11111111-2222-3333-4444-555555555555</GUID></COMPANY></COLLECTION></DATA></BODY></ENVELOPE>`))
			return true
		}
		return false
	}
	f.mu.Unlock()
	fastRestart()
	base := nowFn()
	for _, sec := range []int{0, 20, 60, 240, 301, 330, 600, 1200} {
		retryClock(base, sec)
		// the port found from the bridge's recent list (the company was open a moment ago); Tally's own list, asked
		// right before the entry request, says it is not open now
		f.mu.Lock()
		closed = false
		f.mu.Unlock()
		openCompaniesAsk(bgCompaniesTC(), true)
		f.mu.Lock()
		closed = true
		f.mu.Unlock()
		fastTurns(2)
	}
	f.mu.Lock()
	closed = false
	n0 := lists
	f.mu.Unlock()
	if n := f.n(vchObjectID); n != 0 || n0 == 0 {
		t.Fatalf("company not open: %d entry requests, %d company lists (want 0 entry requests, the list asked)", n, n0)
	}
	if s := r222cSentID(c, "held-slow:resolved"); len(s) != 0 {
		t.Fatalf("ended while its company was not open, with no entry request: %v", s)
	}
	for _, sec := range []int{1500, 1520, 1560, 1800, 1801, 1830, 2100, 5000, 90000} {
		retryClock(base, sec)
		fastTurns(2)
	}
	if n := f.n(vchObjectID); n != 2 {
		t.Fatalf("%d entry requests once the company is open (want both asks: 2)", n)
	}
}

// --- M6. the bank route's nightly list and entry reads, and renumbering's reads, ask only this bridge's own Tally (as the
// self-check, ledOwnPort): with OnlyMySession off (every Tally on the computer reachable) and the company never seen open
// in the own Tally, nothing is asked; seen open there again, they go
func TestBankAndRenumberOwnTallyOnly(t *testing.T) {
	_, f, c := bankBridge(t, "")
	t.Cleanup(func() { nowFn = time.Now })
	setCfg("OnlyMySession", false)
	setCfg("RenumberGapMs", float64(0))
	// a by-day company: its list asked; the entry it names is read at a later turn
	bankSet(f, "26311", "20261007")
	bankCheck(t, f)
	if n := len(bankLists(f)); n != 1 {
		t.Fatalf("lists %d", n)
	}
	_ = os.Remove(liveOwnTallyFile())
	liveResetState() // a restart: the company never seen open in the own Tally
	bankTurn()
	if a := bankAsked(f); len(a) != 0 {
		t.Fatalf("the bank route read an entry from a Tally not its own: %v", a)
	}
	// the nightly list
	bankForceNight(nwsCo)
	bankSet(f, "26312", "20261008")
	night := istAt(2026, 10, 6, 20, 0)
	nowFn = func() time.Time { return night }
	retryReset()
	bankCheck(t, f) // the light check sees the counter moved
	bankNightTurn()
	if n := len(bankLists(f)); n != 1 {
		t.Fatalf("the nightly list asked of a Tally not its own (%d lists)", n)
	}
	// renumbering
	renumInsert(f, 26400, "20261005", "191")
	c.mu.Lock()
	c.renumReply = func(b M) (int, M) {
		return 200, M{"ok": true, "entries": renumCopy(f, str(b["from"]), str(b["no"]), str(b["mid"])), "more": false}
	}
	c.mu.Unlock()
	renumNote([]*renumJob{{Key: companyKey(nwsCo) + "|" + strings.ToLower(nwsGUID) + "|receipt", Company: nwsCo, CGUID: nwsGUID, Type: "Receipt", Date: "20261005", No: "191", Mid: "26400", Event: "created", At: nowS()}})
	n0 := f.n(vchObjectID)
	for i := 0; i < 3; i++ {
		renumTurn()
	}
	if n := f.n(vchObjectID); n != n0 {
		t.Fatalf("renumbering read %d entries from a Tally not its own", n-n0)
	}
	// seen open in the own Tally: they go (renumbering after its job's wait for a company not open, 5 minutes)
	liveSeedOwnOpen(nwsGUID, nwsCo)
	later := night.Add(6 * time.Minute)
	nowFn = func() time.Time { return later }
	for i := 0; i < 3; i++ {
		renumTurn()
	}
	if f.n(vchObjectID) == n0 {
		t.Fatal("renumbering did not go once the company is open in the own Tally")
	}
	bankNightTurn()
	if n := len(bankLists(f)); n != 2 {
		t.Fatalf("the nightly list did not go once the company is open in the own Tally (%d lists)", n)
	}
}

// --- M2(b). a tray notice is keyed on when its problem started, not on the day: cleared, the same problem still there
// the next day is not shown again; ended and back the day after, it is a new problem and shows once
func TestNoticeKeyedOnStartNotDay(t *testing.T) {
	f := t.TempDir() + "/FinCom Bridge/notifications-cleared.json"
	now := noticeDay(8, 11)
	g, shown, _ := noticeTestGate(t, f, &now)
	p := trayProblem{Kind: "tally", Cond: true, Title: "Tally not open", Text: "Open TallyPrime"}
	g.Check(p)
	if len(*shown) != 1 {
		t.Fatalf("first: shown %d, want 1", len(*shown))
	}
	g.ClearAll()
	for _, d := range []time.Time{noticeDay(8, 18), noticeDay(9, 10), noticeDay(10, 9)} {
		now = d
		g.Check(p)
	}
	if len(*shown) != 1 {
		t.Fatalf("the same problem, still there on the next days, shown %d times (want once)", len(*shown))
	}
	now = noticeDay(10, 12)
	g.Check(trayProblem{Kind: "tally", Cond: false})
	now = noticeDay(11, 10)
	g.Check(p)
	if len(*shown) != 2 {
		t.Fatalf("ended and back another day: shown %d in all (want 2)", len(*shown))
	}
}

// --- Low. the two limits are capped whatever the settings say: RecorderLimitMs at 2,000 ms (the 2-second rule),
// BankNightLimitMs at 10,000 ms (the owner's 10 s); lower values set by hand stay
func TestLimitsCapped(t *testing.T) {
	bankBridge(t, "")
	setCfg("RecorderLimitMs", float64(5000))
	setCfg("BankNightLimitMs", float64(60000))
	t.Cleanup(func() { setCfg("RecorderLimitMs", nil); setCfg("BankNightLimitMs", nil) })
	if recorderLimitMs() != 2000 || bankNightLimitMs() != 10000 {
		t.Fatalf("limits %d / %d ms (want 2000 / 10000 whatever the settings say)", recorderLimitMs(), bankNightLimitMs())
	}
	setCfg("RecorderLimitMs", float64(300))
	setCfg("BankNightLimitMs", float64(1500))
	if recorderLimitMs() != 300 || bankNightLimitMs() != 1500 {
		t.Fatalf("lower limits set by hand: %d / %d", recorderLimitMs(), bankNightLimitMs())
	}
}

// --- M6 remainder (re-review): the bank route's by-day list goes only to this bridge's own Tally. Two Tallys on the
// computer, OnlyMySession off: the company is open only in the other Windows user's Tally (ravi's, session 2), never
// seen in this bridge's own (anshul's); the light check found it there. The bank route sends that Tally nothing at all,
// and nothing to the own Tally either
func TestBankSmallListOwnTallyOnly(t *testing.T) {
	_, theirs, _ := bankBridge(t, "")
	mine := newStandTally(t)
	dir := t.TempDir()
	fake := filepath.Join(dir, "fake.json")
	_ = os.WriteFile(fake, []byte(fmt.Sprintf(`{"mySession": 1, "users": {"1": "anshul", "2": "ravi"},
		"processes": [{"pid": 10, "name": "tally", "session": 1, "path": "C:\\Tally\\tally.exe"}, {"pid": 20, "name": "tally", "session": 2, "path": "C:\\Tally\\tally.exe"}],
		"listeners": [{"port": %d, "pid": 10}, {"port": %d, "pid": 20}]}`, mine.port, theirs.port)), 0o644)
	t.Setenv("TDSBRIDGE_FAKE", fake)
	setCfg("OnlyMySession", false)
	_ = os.Remove(liveOwnTallyFile())
	liveResetState() // the company never seen open in the own Tally
	bankSet(theirs, "26311", "20261007")
	if _, err := companyCheck(fin, nwsCo, theirs.port); err != nil { // the light check, on the Tally it found
		t.Fatal(err)
	}
	n0, m0 := theirs.n(""), mine.n("")
	bankAfterLightCheck(nwsCo, theirs.port)
	if n := theirs.n(""); n != n0 {
		t.Fatalf("the other user's Tally got %d request(s) from the bank route: %v", n-n0, theirs.ids()[n0:])
	}
	if n := mine.n("TDSDeskKeepList"); n != 0 || mine.n("") != m0 {
		t.Fatalf("the own Tally (the company not open there) was asked: %v", mine.ids()[m0:])
	}
}

// --- M2 remainder (re-review): the beat says when the wait its recorderWaitWords tell of began (recorderWaitSince), so
// every browser keys the "changes wait" notice on the same start: the same while the wait lasts (more lines waiting do
// not move it), gone when it ends, and a later wait has a later start
func TestBeatWaitSince(t *testing.T) {
	rec, f, _ := ownBridge(t, "", b220CoGUID, zz)
	t.Cleanup(func() { nowFn = time.Now; retryReset() })
	if b := beatBody(true, "open", "", nil, nil, nil); str(b["recorderWaitSince"]) != "" {
		t.Fatalf("a start while nothing waits: %v", b["recorderWaitSince"])
	}
	ownSlowList(f, true)
	base := time.Now().Truncate(time.Second)
	ownAt(base)
	liveAppend(t, ownFile(rec, b220CoGUID), ownLine(b220CoGUID, zz, "mine", "11", base.Add(-20*time.Second)))
	var first string
	for i, m := range []int{0, 1, 6, 16, 40} {
		ownAt(base.Add(time.Duration(m) * time.Minute))
		if i == 2 {
			liveAppend(t, ownFile(rec, b220CoGUID), ownLine(b220CoGUID, zz, "mine", "12", base.Add(5*time.Minute)))
		}
		readAndUploadAll(t)
		b := beatBody(true, "open", "", nil, nil, nil)
		if str(b["recorderWaitWords"]) == "" {
			continue
		}
		s := str(b["recorderWaitSince"])
		if _, err := time.Parse(time.RFC3339, s); err != nil {
			t.Fatalf("+%d min: words %q with no start (%q)", m, b["recorderWaitWords"], s)
		}
		if first == "" {
			first = s
		} else if s != first {
			t.Fatalf("+%d min: the start moved from %s to %s while the same wait lasts", m, first, s)
		}
	}
	if first == "" {
		t.Fatal("the wait was never said")
	}
	// a complete look ends it
	ownSlowList(f, false)
	ownAt(base.Add(76 * time.Minute))
	openCompaniesWith(fin, true)
	ownAt(base.Add(77 * time.Minute))
	readAndUploadAll(t)
	if b := beatBody(true, "open", "", nil, nil, nil); str(b["recorderWaitWords"]) != "" || str(b["recorderWaitSince"]) != "" {
		t.Fatalf("after the complete look: %q since %q", b["recorderWaitWords"], b["recorderWaitSince"])
	}
	// later, a look stopped again and a line waiting for the next one (as the reader marks them): a new wait, a later start
	ownAt(base.Add(120 * time.Minute))
	liveOwnBlindNow()
	live.mu.Lock()
	live.ownWaitAt = nowFn()
	live.mu.Unlock()
	b := beatBody(true, "open", "", nil, nil, nil)
	s := str(b["recorderWaitSince"])
	if str(b["recorderWaitWords"]) == "" || s != base.Add(120*time.Minute).UTC().Format(time.RFC3339) || s <= first {
		t.Fatalf("the wait again: words %q since %q (the first one began %s)", b["recorderWaitWords"], s, first)
	}
}

// --- M2-r (re-review): each reason the changes wait has its own start in the beat (recorderWaitStarts): an earlier
// request ("earlier"), no complete look at the own Tally ("blind"), a company's lines waiting ("queue": from when its
// oldest line first passed 30 s, kept on disk, reset only when that company's queue drops below the threshold)
func waitStarts(t *testing.T) map[string]string {
	t.Helper()
	b := beatBody(true, "open", "", nil, nil, nil)
	o := map[string]string{}
	for _, x := range arr(b["recorderWaitStarts"]) {
		e := obj(x)
		o[str(e["reason"])+":"+str(e["company"])] = str(e["since"])
	}
	return o
}

func waitQueue(lines ...*change) {
	live.mu.Lock()
	liveFresh()
	live.queue = lines
	live.mu.Unlock()
}

func TestWaitStartsDrainingBacklog(t *testing.T) {
	liveBridge(t, "")
	t.Cleanup(func() { nowFn = time.Now; waitQueue() })
	base := time.Now().Truncate(time.Second)
	nowFn = func() time.Time { return base }
	var q []*change
	for i := 0; i < 5; i++ {
		q = append(q, &change{company: "CO A", readAt: base.Add(time.Duration(-300+i*10) * time.Second)})
	}
	waitQueue(q...)
	s0 := waitStarts(t)["queue:CO A"]
	if s0 == "" {
		t.Fatalf("no start for the waiting lines: %v", waitStarts(t))
	}
	// the backlog drains, one line every 30 s: the oldest queued moves on, the start does not
	for i := 1; i < 5; i++ {
		nowFn = func() time.Time { return base.Add(time.Duration(i*30) * time.Second) }
		waitQueue(q[i:]...)
		if s := waitStarts(t)["queue:CO A"]; s != s0 {
			t.Fatalf("draining (%d left): the start moved from %s to %s", 5-i, s0, s)
		}
	}
	// a restart while it waits: the same start (kept on disk)
	waitForget()
	if s := waitStarts(t)["queue:CO A"]; s != s0 {
		t.Fatalf("after a restart: %s (was %s)", s, s0)
	}
	// empty: no start; lines over 30 s again later: a new, later start
	nowFn = func() time.Time { return base.Add(10 * time.Minute) }
	waitQueue()
	if s := waitStarts(t)["queue:CO A"]; s != "" {
		t.Fatalf("an empty queue keeps a start: %s", s)
	}
	waitQueue(&change{company: "CO A", readAt: base.Add(10*time.Minute - 40*time.Second)})
	if s := waitStarts(t)["queue:CO A"]; s == "" || s <= s0 {
		t.Fatalf("the queue again: %q (the first began %s)", s, s0)
	}
}

// the queue below the threshold (its oldest line under 30 s) and over it again: a new start
func TestWaitStartsQueueBelowThresholdResets(t *testing.T) {
	liveBridge(t, "")
	t.Cleanup(func() { nowFn = time.Now; waitQueue() })
	base := time.Now().Truncate(time.Second)
	nowFn = func() time.Time { return base }
	waitQueue(&change{company: "CO A", readAt: base.Add(-60 * time.Second)})
	s0 := waitStarts(t)["queue:CO A"]
	nowFn = func() time.Time { return base.Add(2 * time.Minute) }
	waitQueue(&change{company: "CO A", readAt: base.Add(2*time.Minute - 5*time.Second)})
	if s := waitStarts(t)["queue:CO A"]; s != "" || s0 == "" {
		t.Fatalf("below the threshold: %q (before %q)", s, s0)
	}
	nowFn = func() time.Time { return base.Add(3 * time.Minute) }
	if s := waitStarts(t)["queue:CO A"]; s == "" || s == s0 {
		t.Fatalf("over it again: %q (the first %q): want a new start", s, s0)
	}
}

// a line FinCom keeps answering 'failed' stays queued (its start stays); a new blind look adds its own start
func TestWaitStartsStuckLineThenBlind(t *testing.T) {
	liveBridge(t, "")
	t.Cleanup(func() { nowFn = time.Now; waitQueue() })
	base := time.Now().Truncate(time.Second)
	nowFn = func() time.Time { return base }
	waitQueue(&change{company: "CO A", readAt: base.Add(-time.Hour), failN: 25})
	s0 := waitStarts(t)
	nowFn = func() time.Time { return base.Add(time.Hour) }
	live.mu.Lock()
	live.ownAt = base // the last complete look at the own Tally (this test's bridge seeds one far ahead)
	live.mu.Unlock()
	liveOwnBlindNow()
	live.mu.Lock()
	live.ownWaitAt = nowFn()
	live.mu.Unlock()
	s1 := waitStarts(t)
	if s1["queue:CO A"] != s0["queue:CO A"] || s1["blind:"] != base.Add(time.Hour).UTC().Format(time.RFC3339) || len(s1) != 2 {
		t.Fatalf("a stuck line, then a blind look: %v (before %v)", s1, s0)
	}
}
