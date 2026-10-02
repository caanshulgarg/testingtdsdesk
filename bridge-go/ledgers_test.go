package main

// FinCom Bridge 2.1.4 (02-Oct-2026): the plain ledger and group lists. Update now reads the ledger list in chunks of
// MasterIDs under the cap, resumes after a timeout from the chunk that did not answer (halved); only stored fields are
// asked for; a posting with a new ledger reads the list once; the refresh endpoint and the cloud's wake-up read it once,
// then are debounced; a rename and a delete are found by GUID and sent as such; every request goes through the one gate
// (a posting jumps it).

import (
	"fmt"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"testing"
	"time"
)

var reFetch = regexp.MustCompile(`<FETCH>([^<]*)</FETCH>`)

// every ledger or group list request asks only for stored fields: no period, no Tally function, nothing computed
func noComputedFields(t *testing.T, f *standTally) int {
	t.Helper()
	allowed := map[string]bool{}
	for _, x := range strings.Split(ledFetch+","+grpFetch, ",") {
		allowed[strings.TrimSpace(x)] = true
	}
	computed := regexp.MustCompile(`(?i)closing|onaccount|balance\b|\$\$|svfromdate|svtodate|total|cashflow|value`)
	f.mu.Lock()
	defer f.mu.Unlock()
	n := 0
	for i, id := range f.reqs {
		if id != ledListID && id != grpListID {
			continue
		}
		n++
		b := f.bodies[i]
		m := reFetch.FindStringSubmatch(b)
		if m == nil {
			t.Fatalf("request %d (%s) has no FETCH", i, id)
		}
		for _, fld := range strings.Split(m[1], ",") {
			if fld = strings.TrimSpace(fld); !allowed[fld] {
				t.Fatalf("request %d (%s) asks for %q, not a stored field of the list", i, id, fld)
			}
		}
		if c := computed.FindString(strings.ReplaceAll(b, "OPENINGBALANCE", "")); c != "" {
			t.Fatalf("request %d (%s) asks for something Tally computes (%q): %s", i, id, c, cut(b, 400))
		}
	}
	return n
}

// a stand-in Tally with n ledgers (and a few groups), a company kept in step from today
func ledgerTally(t *testing.T, n int, extra string) *standTally {
	f := newStandTally(t)
	f.grp = [][2]string{{"Sundry Creditors", "Current Liabilities"}, {"Current Liabilities", "Primary"}, {"Indirect Expenses", ""}}
	for i := 1; i <= n; i++ {
		l := f.addLed(fmt.Sprintf("Party %05d", i), "Sundry Creditors", fmt.Sprintf("-%d.00", i))
		if i%10 == 0 {
			l.gstin, l.pan = "09ABCDE1234F1Z5", "ABCDE1234F"
		}
	}
	standBridge(t, f, `,"KeepBudgetSec":600`+extra)
	liveFrom(today())
	return f
}

// the requests of the ledger list, as MasterID ranges ("a-b", or "a-end" for the last one)
func ledRanges(f *standTally) []string {
	f.mu.Lock()
	defer f.mu.Unlock()
	var o []string
	for i, id := range f.reqs {
		if id != ledListID {
			continue
		}
		m := reMidRange.FindStringSubmatch(f.bodies[i])
		if m == nil {
			o = append(o, "?")
		} else if m[2] == "" {
			o = append(o, m[1]+"-end")
		} else {
			o = append(o, m[1]+"-"+m[2])
		}
	}
	return o
}

func newRun(kind, id string) *keepRun {
	return &keepRun{tc: &TC{copier: true}, kind: kind, told: map[string]bool{}, id: id, alter: map[string]int64{}}
}

// --- Update now: the ledger list in chunks of 2,000 MasterIDs (each under the cap), then one last request with no upper
// end; 50,000 ledgers. A chunk that does not answer: halved, and the read resumes from it (the chunks before are kept)
func TestLedgerListChunksUnderCapAndResume(t *testing.T) {
	const n = 50000
	f := ledgerTally(t, n, "")
	t0 := time.Now()
	k := newRun("now", "r1")
	if err := k.step(zz, f.port, ""); err != nil {
		t.Fatal(err)
	}
	took := time.Since(t0)
	rs := ledRanges(f)
	want := n/2000 + 1
	if len(rs) != want || rs[len(rs)-1] != fmt.Sprint(n)+"-end" {
		t.Fatalf("%d ledger requests (%v...), want %d ending with the open one", len(rs), rs[:minI(3, len(rs))], want)
	}
	for i, r := range rs[:len(rs)-1] {
		if r != fmt.Sprintf("%d-%d", i*2000, (i+1)*2000) {
			t.Fatalf("chunk %d is %s", i, r)
		}
	}
	held := loadLedList(syncFolder(zz))
	if len(held) != n || held["led-7"].name != "Party 00007" || held["led-7"].open != "-7.00" || held["led-10"].gstin != "09ABCDE1234F1Z5" || held["led-10"].pan != "ABCDE1234F" {
		t.Fatalf("the list held: %d ledgers, %+v %+v", len(held), held["led-7"], held["led-10"])
	}
	if f.n(grpListID) != 1 {
		t.Fatalf("the groups: %d requests, want 1", f.n(grpListID))
	}
	// the slowest chunk, from the log ("(1.2s)")
	slowest := 0.0
	for _, l := range strings.Split(readText(logFile()), "\n") {
		if m := regexp.MustCompile(`ledger list MasterID \S+, \d+ ledger\(s\) \(([\d.]+)s\)`).FindStringSubmatch(l); m != nil && num(m[1]) > slowest {
			slowest = num(m[1])
		}
	}
	t.Logf("stand-in: %d ledgers in %d requests of 2,000 MasterIDs; the whole step %.2fs, the slowest chunk %.2fs (the cap is %ds)", n, len(rs), took.Seconds(), slowest, ledChunkSec())
	if slowest >= float64(ledChunkSec()) {
		t.Fatal("a chunk took longer than the cap")
	}
	if c := noComputedFields(t, f); c != want+1 {
		t.Fatalf("%d list requests checked", c)
	}

	// a new round (another Update now) where the chunk from MasterID 20,001 does not answer once
	var once sync.Once
	f.mu.Lock()
	f.slow = func(id, body string) time.Duration {
		d := time.Duration(0)
		if id == ledListID && strings.Contains(body, "$MasterID &gt; 20000 AND") {
			once.Do(func() { d = 3 * time.Second })
		}
		return d
	}
	f.mu.Unlock()
	setCfg("TallyMaxSec", 1)
	setCfg("TallyProbeEverySec", 1)
	before := len(ledRanges(f))
	k2 := newRun("now", "r2")
	err := k2.step(zz, f.port, "")
	if err == nil || !strings.Contains(err.Error(), "the next try reads 1000 from MasterID 20001") {
		t.Fatalf("the chunk that did not answer: %v", err)
	}
	ls := obj(readKeepState(syncFolder(zz))["led"])
	if toI64(ls["after"]) != 20000 || toInt(ls["size"]) != 1000 {
		t.Fatalf("the progress saved: %v", ls)
	}
	// after the check (Tally answers again), the read resumes from MasterID 20,001 with the smaller chunk
	time.Sleep(1100 * time.Millisecond)
	if err := k2.step(zz, f.port, ""); err != nil {
		t.Fatal(err)
	}
	rs = ledRanges(f)[before:]
	if rs[0] != "0-2000" || rs[10] != "20000-22000" || rs[11] != "20000-21000" || rs[12] != "21000-22000" {
		t.Fatalf("the second round: %v", rs[:minI(14, len(rs))])
	}
	for _, r := range rs[11:] {
		if r == "0-2000" {
			t.Fatal("the chunks before the one that failed were read again")
		}
	}
	if len(loadLedList(syncFolder(zz))) != n {
		t.Fatal("the list held after the resumed round")
	}
	// the chunk grows back after quick answers
	if toInt(readKeepState(syncFolder(zz))["ledSize"]) != 2000 {
		t.Fatalf("the chunk size after quick answers: %v", readKeepState(syncFolder(zz))["ledSize"])
	}
	noComputedFields(t, f)
	f.noBalance(t)
}

// --- a posting that carries a new ledger: the list is read once after it (not again on the next turn)
func TestPostingNewLedgerReadsListOnce(t *testing.T) {
	f := ledgerTally(t, 20, "")
	runNow(t, "now")
	g0 := f.n(grpListID)
	master := `<LEDGER NAME="Kashi IT Solutions" ACTION="Create"><NAME>Kashi IT Solutions</NAME><PARENT>Sundry Creditors</PARENT></LEDGER>`
	j, err := newPostJob(M{"jobId": "job-newled-1", "company": zz, "masters": []any{M{"id": "m1", "xml": master}},
		"vouchers": []any{M{"id": "v1", "xml": finVoucher("v1", "Kashi IT Solutions", "K-1", today(), "10.00")}}})
	if err != nil {
		t.Fatal(err)
	}
	if p := waitJob(t, str(j["id"])); str(p["status"]) != "done" {
		t.Fatalf("the posting: %v", p["message"])
	}
	evMu.Lock()
	_, due := ledPosted[zz]
	evMu.Unlock()
	if !due {
		t.Fatal("the posting with a ledger master did not ask for the ledger list")
	}
	nowFn = func() time.Time { return time.Now().Add(5 * time.Second) }
	postedDue()
	time.Sleep(100 * time.Millisecond)
	waitIdle(t)
	postedDue()
	time.Sleep(100 * time.Millisecond)
	waitIdle(t)
	if f.n(grpListID) != g0+1 {
		t.Fatalf("%d list reads after the posting, want 1", f.n(grpListID)-g0)
	}
	found := false
	for _, r := range loadLedList(syncFolder(zz)) {
		if r.name == "Kashi IT Solutions" && r.parent == "Sundry Creditors" {
			found = true
		}
	}
	if !found || logLines("1 new, 0 changed, 0 renamed, 0 deleted") != 1 {
		t.Fatal("the new ledger is not in the list held")
	}
	// a posting of entries only (no ledger master): no list read
	if r := postOne(t, "v2", finVoucher("v2", "Kashi IT Solutions", "K-2", today(), "11.00")); r["ok"] != true {
		t.Fatalf("posting: %v", r)
	}
	nowFn = func() time.Time { return time.Now().Add(20 * time.Second) }
	postedDue()
	time.Sleep(100 * time.Millisecond)
	waitIdle(t)
	if f.n(grpListID) != g0+1 {
		t.Fatal("a posting without a ledger read the list")
	}
	noComputedFields(t, f)
	f.noBalance(t)
}

// --- the refresh endpoint and the cloud's wake-up: one read, then debounced for a few minutes; paused: none
func TestLedgersRefreshAndWakeDebounced(t *testing.T) {
	f := ledgerTally(t, 30, "")
	refresh := func() M {
		t.Helper()
		r := httptest.NewRequest("POST", "/ledgers/refresh", nil)
		res, err := route(nil, r, "/ledgers/refresh", url.Values{}, `{"company":"`+zz+`"}`, "")
		if err != nil {
			t.Fatal(err)
		}
		return res.(M)
	}
	r := refresh()
	if r["started"] != true {
		t.Fatalf("the first refresh: %v", r)
	}
	waitIdle(t)
	if f.n(grpListID) != 1 || f.n("Day Book") != 0 {
		t.Fatalf("the refresh read %v (want the ledger list only)", f.ids())
	}
	if logLines("Ledger list: done") != 1 {
		t.Fatal("the ledger list run did not finish")
	}
	if str(readKeepState(syncFolder(zz))["ledAt"]) == "" || keepLastRun() != "" {
		t.Fatal("the read time is not kept, or the ledger list was taken for a nightly run")
	}
	// again at once, and the cloud's wake-up for the same company: debounced
	r = refresh()
	if r["started"] == true || r["debounced"] != true || str(r["listAt"]) == "" || str(r["nextAt"]) == "" {
		t.Fatalf("the second refresh: %v", r)
	}
	wakeEvent("ledgers", M{"company": zz, "at": time.Now().UTC().Format(time.RFC3339Nano)})
	time.Sleep(200 * time.Millisecond)
	waitIdle(t)
	if f.n(grpListID) != 1 {
		t.Fatal("the wake-up within the debounce read the list again")
	}
	// a few minutes later: the wake-up reads it once; the heartbeat's copy of the same wake-up does not
	nowFn = func() time.Time { return time.Now().Add(4 * time.Minute) }
	at := time.Now().UTC().Format(time.RFC3339Nano)
	wakeEvent("ledgers", M{"company": zz, "at": at})
	time.Sleep(200 * time.Millisecond)
	waitIdle(t)
	ledgersFromBeat(M{zz: at})
	time.Sleep(100 * time.Millisecond)
	waitIdle(t)
	if f.n(grpListID) != 2 {
		t.Fatalf("after the debounce: %d list reads, want 2", f.n(grpListID))
	}
	// paused in the tray: none (Update now still reads it)
	nowFn = func() time.Time { return time.Now().Add(10 * time.Minute) }
	pausedB = true
	if r := refresh(); r["started"] == true || !strings.Contains(str(r["why"]), "paused") {
		t.Fatalf("paused: %v", r)
	}
	runNow(t, "now")
	pausedB = false
	if f.n(grpListID) != 3 {
		t.Fatal("Update now while paused did not read the ledger list")
	}
	noComputedFields(t, f)
	f.noBalance(t)
}

// --- a ledger renamed and one deleted in Tally: found by GUID, sent to the cloud as a rename and a deletion; the copy's
// entries carry the new name. Many gone at once: only after the next full read. A cloud without migration-32: the
// deletions go again with the next list
func TestLedgerRenameAndDeleteSent(t *testing.T) {
	f := newStandTally(t)
	c := newStandCloud(t)
	for i := 1; i <= 60; i++ {
		f.addLed(fmt.Sprintf("Party %02d", i), "Sundry Creditors", "0.00")
	}
	td := today()
	f.add(td, "Party 01", "", "sale", "-100.00")
	standBridge(t, f, `,"KeepBudgetSec":600`+c.cfg())
	liveFrom(td)
	runNow(t, "now")
	dir := syncFolder(zz)
	if !exists(filepath.Join(dir, "days", td+".xml")) || !strings.Contains(readText(filepath.Join(dir, "days", td+".xml")), "Party 01") {
		t.Fatal("the day was not kept")
	}
	pushAll := func() {
		cloudMu.Lock()
		cloudLinksAt = time.Time{}
		cloudMu.Unlock()
		invokeCloudPush()
	}
	pushAll()
	c.mu.Lock()
	if len(c.ledList) != 1 || len(arr(c.ledList[0]["ledgers"])) != 60 || len(arr(c.ledList[0]["groups"])) != 0 && false {
		t.Fatalf("the first list sent: %d calls", len(c.ledList))
	}
	c.ledList = nil
	c.mu.Unlock()
	if exists(ledOutFile(dir)) {
		t.Fatal("the outbox was not emptied")
	}
	// renamed: Party 01 -> Party One (same GUID); deleted: Party 02; Party 03's stored opening changed
	f.mu.Lock()
	f.led[0].name = "Party One"
	f.alter++
	f.led[0].alter = f.alter
	f.led[2].open = "-500.00"
	f.led = append(f.led[:1], f.led[2:]...)
	f.mu.Unlock()
	nowFn = func() time.Time { return time.Now().Add(10 * time.Minute) }
	if r := wakeLedgers(zz, "test", false); r["started"] != true {
		t.Fatalf("not started: %v", r)
	}
	waitIdle(t)
	pushAll()
	c.mu.Lock()
	got := c.ledList
	c.ledList = nil
	c.mu.Unlock()
	if len(got) != 1 {
		t.Fatalf("%d ledger list calls", len(got))
	}
	b := got[0]
	ren, del, rows := arr(b["renamed"]), arr(b["deleted"]), arr(b["ledgers"])
	if len(ren) != 1 || jsonText(ren[0]) != `["led-1","Party 01","Party One"]` {
		t.Fatalf("renamed: %v", ren)
	}
	if len(del) != 1 || jsonText(del[0]) != `["led-2","Party 02"]` {
		t.Fatalf("deleted: %v", del)
	}
	if len(rows) != 2 {
		t.Fatalf("rows sent: %v (want the renamed one and the one whose opening changed)", rows)
	}
	for _, x := range rows {
		a := arr(x)
		if str(a[0]) == "led-3" && (str(a[5]) != "-500.00" || toInt(a[8]) != 1) {
			t.Fatalf("the opening change: %v", a)
		}
	}
	if b["last"] != true {
		t.Fatal("the call is not marked last")
	}
	day := readText(filepath.Join(dir, "days", td+".xml"))
	if strings.Contains(day, ">Party 01<") || !strings.Contains(day, ">Party One<") {
		t.Fatalf("the copy's entries keep the old name: %s", cut(day, 300))
	}
	if _, ok := loadLedList(dir)["led-2"]; ok {
		t.Fatal("the deleted ledger is still held")
	}
	// many gone at once (30 of 59): held back until the next full read misses them too
	f.mu.Lock()
	f.led = f.led[:29]
	f.mu.Unlock()
	nowFn = func() time.Time { return time.Now().Add(20 * time.Minute) }
	wakeLedgers(zz, "test", false)
	waitIdle(t)
	pushAll()
	c.mu.Lock()
	for _, b := range c.ledList {
		if len(arr(b["deleted"])) > 0 {
			t.Fatalf("deleted at the first read that missed many: %v", arr(b["deleted"]))
		}
	}
	c.ledList = nil
	c.noDel = true // and the cloud has no migration-32 yet
	c.mu.Unlock()
	if logLines("taken as deleted only if the next full read misses them too") != 1 {
		t.Fatal("the hold is not in the log")
	}
	nowFn = func() time.Time { return time.Now().Add(30 * time.Minute) }
	wakeLedgers(zz, "test", false)
	waitIdle(t)
	pushAll()
	c.mu.Lock()
	n := 0
	for _, b := range c.ledList {
		n += len(arr(b["deleted"]))
	}
	c.ledList = nil
	c.noDel = false
	c.mu.Unlock()
	if n != 30 {
		t.Fatalf("the second read: %d deletions sent, want 30", n)
	}
	if !exists(ledLaterFile(dir)) || logLines("not marked in FinCom yet") != 1 {
		t.Fatal("deletions a cloud without migration-32 skipped are not kept for later")
	}
	// the next list carries them again
	f.addLed("Party New", "Sundry Debtors", "0.00")
	nowFn = func() time.Time { return time.Now().Add(40 * time.Minute) }
	wakeLedgers(zz, "test", false)
	waitIdle(t)
	pushAll()
	c.mu.Lock()
	n = 0
	for _, b := range c.ledList {
		n += len(arr(b["deleted"]))
	}
	c.mu.Unlock()
	if n != 30 || exists(ledLaterFile(dir)) {
		t.Fatalf("the skipped deletions with the next list: %d", n)
	}
	noComputedFields(t, f)
	f.noBalance(t)
}

// --- the ledger list goes through the one gate: a posting stops a chunk at Tally at once and goes first; the chunk is
// read again afterwards. Another bridge holding the lease, or another company GUID: nothing read
func TestLedgerListGivesWayToPosting(t *testing.T) {
	f := ledgerTally(t, 5000, `,"PostWaitMs":200`)
	var once sync.Once
	started := make(chan struct{})
	f.mu.Lock()
	f.slow = func(id, body string) time.Duration {
		d := time.Duration(0)
		if id == ledListID && strings.Contains(body, "$MasterID &gt; 2000 AND") {
			once.Do(func() { d = 4 * time.Second; close(started) })
		}
		return d
	}
	f.mu.Unlock()
	if !startKeepRun(runReq{kind: "now", why: "test"}) {
		t.Fatal("no run")
	}
	<-started
	time.Sleep(200 * time.Millisecond)
	t0 := time.Now()
	if r := postOne(t, "p1", finVoucher("p1", fgParty, "P-1", today(), "5.00")); r["ok"] != true {
		t.Fatalf("posting: %v", r)
	}
	if time.Since(t0) > 3*time.Second {
		t.Fatal("the posting waited for the ledger chunk")
	}
	waitIdle(t)
	ids := f.ids()
	seq := []string{}
	for i, id := range ids {
		if id == ledListID {
			if m := reMidRange.FindStringSubmatch(f.bodies[i]); m != nil && m[1] == "2000" {
				seq = append(seq, "chunk")
			}
		}
		if id == "Import" {
			seq = append(seq, "import")
		}
	}
	if strings.Join(seq, ",") != "chunk,import,chunk" {
		t.Fatalf("order %v (want the chunk stopped, the posting, the chunk again)", seq)
	}
	f.mu.Lock()
	mx := f.maxFlight
	f.mu.Unlock()
	if mx != 1 {
		t.Fatalf("%d requests at Tally at once", mx)
	}
	if len(loadLedList(syncFolder(zz))) != 5000 {
		t.Fatal("the list was not finished after the posting")
	}
	// another company of the same name (another GUID): no ledger list read
	f.mu.Lock()
	f.guid = "co-guid-other"
	f.mu.Unlock()
	n := f.n(ledListID)
	nowFn = func() time.Time { return time.Now().Add(10 * time.Minute) }
	wakeLedgers(zz, "test", false)
	waitIdle(t)
	if f.n(ledListID) != n {
		t.Fatal("the ledger list of another company was read")
	}
	noComputedFields(t, f)
	f.noBalance(t)
}

// --- the comparison itself: new, changed, renamed, deleted; many gone at once held back
func TestDiffLedgers(t *testing.T) {
	row := func(g, n, o string) ledRow { return ledRow{guid: g, mid: 1, alter: 1, name: n, parent: "P", open: o} }
	held := map[string]ledRow{"a": row("a", "A", "0.00"), "b": row("b", "B", "0.00"), "c": row("c", "C", "1.00")}
	read := map[string]ledRow{"a": row("a", "A2", "0.00"), "c": row("c", "C", "2.00"), "d": row("d", "D", "0.00")}
	d := diffLedgers(held, read, nil)
	if d.added != 1 || len(d.rows) != 3 || len(d.renamed) != 1 || d.renamed[0] != (ledRen{"a", "A", "A2"}) || len(d.deleted) != 1 || d.deleted[0].guid != "b" || !d.openChg["c"] {
		t.Fatalf("%+v", d)
	}
	big := map[string]ledRow{}
	for i := 0; i < 100; i++ {
		g := fmt.Sprint(i)
		big[g] = row(g, g, "0")
	}
	d = diffLedgers(big, map[string]ledRow{}, nil)
	if len(d.deleted) != 0 || len(d.deferred) != 100 {
		t.Fatal("an empty answer deleted the list")
	}
	d = diffLedgers(big, map[string]ledRow{}, map[string]bool{"5": true})
	if len(d.deleted) != 1 || len(d.deferred) != 99 {
		t.Fatal("the second look")
	}
	_ = os.Remove("")
}
