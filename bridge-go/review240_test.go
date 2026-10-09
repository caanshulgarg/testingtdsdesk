package main

// release-240 final review (09-Oct-2026), bridge items, each written before its fix (red first).

import (
	"net/http"
	"os"
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
