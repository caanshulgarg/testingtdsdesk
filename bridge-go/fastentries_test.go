package main

// next-fast-entries (PROTOTYPE; docs/fast-entries-design.md): the older-entries fetch reading a window of listed days in
// a few requests, behind FastEntries (off by default), against the stand Tally (rebuilt_test.go) and the model of
// FinCom's cloud (r245_test.go pullBridgeWith). Every test checks the hard rules too: one request in flight, nothing
// sent twice, nothing missed, each entry exactly as FinComVoucherObject's answer keeps it.

import (
	"net/http"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"testing"
	"time"
)

func fastBridge(t *testing.T, extra string) (*standTally, *standCloud, *pullModel) {
	t.Helper()
	f, c, m := pullBridgeWith(t, `,"FastEntries":true`+extra)
	fastReset()
	t.Cleanup(fastReset)
	return f, c, m
}

// days of the stand's Tally, MasterIDs running on from mid across the days (as Tally numbers entries as they are made)
func fastDays(f *standTally, mid int64, perDay map[string]int) []*tVch {
	var days []string
	for d := range perDay {
		days = append(days, d)
	}
	sort.Strings(days)
	var o []*tVch
	for _, d := range days {
		types := make([]string, perDay[d])
		for i := range types {
			types[i] = []string{"Sales", "Receipt", "Payment", "Journal"}[i%4]
		}
		o = append(o, pullDay(f, d, mid, types...)...)
		mid += int64(len(types))
	}
	return o
}

// FinCom lists the days newest first, as tally_period_next does, up to 30 an answer outside office hours (periodNight)
// and, to a bridge with FastEntries on, by day too (TestFastByDayTakesThirty)
func fastList(in ...string) M {
	days := append([]string(nil), in...) // the caller's days kept in their order
	sort.Sort(sort.Reverse(sort.StringSlice(days)))
	l := pullList(days...)
	l["periodNight"] = true
	return l
}

func daysFrom(from string, n int) []string {
	var o []string
	for i := 0; i < n; i++ {
		o = append(o, addDays(from, i))
	}
	return o
}

// every entry FinCom was sent, by MasterID, and how many times
func fastSent(m *pullModel) (map[string]string, map[string]int) {
	sent, times := map[string]string{}, map[string]int{}
	for _, e := range m.entries {
		for _, x := range arr(e["vouchers"]) {
			mid := tagNum(str(x), "MASTERID")
			sent[mid] = str(x)
			times[mid]++
			if normDate(tagValue(str(x), "DATE")) != str(e["day"]) {
				panic("an entry sent under another day: " + mid)
			}
		}
	}
	return sent, times
}

// all of vs in FinCom, each sent once, each exactly as FinComVoucherObject's answer keeps it
func fastAllOnce(t *testing.T, m *pullModel, vs []*tVch) {
	t.Helper()
	sent, times := fastSent(m)
	for mid, n := range times {
		if n != 1 {
			t.Fatalf("MasterID %s sent %d times", mid, n)
		}
	}
	if len(sent) != len(vs) {
		t.Fatalf("%d entries sent, Tally has %d", len(sent), len(vs))
	}
	for _, v := range vs {
		if want := fastStripVoucher(cleanXML(v.xml())); sent[v.master] != want {
			t.Fatalf("MasterID %s sent as\n%s\nnot as FinComVoucherObject keeps it\n%s", v.master, sent[v.master], want)
		}
	}
}

// the day counts FinCom was told equal Tally's own, for every day (also a day of no entries)
func fastCountsTold(t *testing.T, m *pullModel, vs []*tVch, days []string) {
	t.Helper()
	tally := map[string]int{}
	for _, v := range vs {
		tally[v.date]++
	}
	for _, d := range days {
		if got, ok := m.n[d]; !ok || got != tally[d] {
			t.Fatalf("%s: FinCom told %d (%v), Tally has %d", d, got, ok, tally[d])
		}
	}
}

func fastBodies(f *standTally, id string) []string {
	f.mu.Lock()
	defer f.mu.Unlock()
	var o []string
	for i, x := range f.reqs {
		if x == id {
			o = append(o, f.bodies[i])
		}
	}
	return o
}

func fastGroupSize(b string, vs []*tVch) int {
	a, z := pinDates(b)
	r := reFastRange.FindStringSubmatch(b)
	if r == nil {
		return -1
	}
	n := 0
	for _, v := range vs {
		if mv := toI64(v.master); mv >= toI64(r[1]) && mv <= toI64(r[2]) && v.date >= a && v.date <= z {
			n++
		}
	}
	return n
}

// --- 1. the two requests are exactly the doc's (docs/fast-entries-design.md, its two ```xml blocks), on the allow-list
// unmeasured, pinned to their builders, and no other shape is built
func TestFastRequestsAsInTheDoc(t *testing.T) {
	doc := readText(filepath.Join("..", "docs", "fast-entries-design.md"))
	var blocks []string
	for _, m := range regexp.MustCompile("(?s)```xml\n(.*?)\n```").FindAllStringSubmatch(doc, -1) {
		blocks = append(blocks, strings.TrimSpace(m[1]))
	}
	if len(blocks) != 2 {
		t.Fatalf("the design doc holds %d xml blocks, want 2", len(blocks))
	}
	if got := fastHeadsRequest("@@CO@@", "20250901", "20250907"); got != blocks[0] {
		t.Fatalf("W1 FinComWindowHeads:\n%s\nwant (the doc)\n%s", got, blocks[0])
	}
	if got := fastBatchRequest("@@CO@@", "20250903", "20250905", 1201, 1260); got != blocks[1] {
		t.Fatalf("W2 FinComVoucherWindow:\n%s\nwant (the doc)\n%s", got, blocks[1])
	}
	// the same fields as the approved requests: W1 FinComDayHeads' four, W2 FinComVoucherBatch's frozen FETCH
	if !strings.Contains(blocks[0], "<FETCH>"+dayHeadsFetch+"</FETCH>") || !strings.Contains(blocks[1], "<FETCH>"+batchFetchText+"</FETCH>") || !batchFetchOK() {
		t.Fatal("a FETCH other than the approved ones")
	}
	for _, x := range blocks {
		if computedFigure(x) != "" || strings.Contains(x, "Day Book") {
			t.Fatalf("a computed figure or the Day Book: %s", x)
		}
	}
	for _, id := range []string{fastHeadsID, fastBatchID} {
		a, ok := tallyAllowList[id]
		if !ok || a.measureOnly || a.maxSec != 0 || a.measuredOn != "" || requestClass[id] != "exception" {
			t.Fatalf("%s: %+v %v %q (on the list, not measured yet, by its id always)", id, a, ok, requestClass[id])
		}
	}
	if allowListMeasured() {
		t.Fatal("the table reads measured with the two unmeasured rows")
	}
	// refused: one day (FinComDayHeads), over 31 days, to before from, no such date, b below a, MasterID 0
	for name, bad := range map[string]string{
		"one day": fastHeadsRequest(zz, "20250901", "20250901"), "32 days": fastHeadsRequest(zz, "20250901", "20251002"),
		"backwards": fastHeadsRequest(zz, "20250907", "20250901"), "no such date": fastHeadsRequest(zz, "20250230", "20250301"),
		"b below a": fastBatchRequest(zz, "20250901", "20250902", 9, 5), "MasterID 0": fastBatchRequest(zz, "20250901", "20250902", 0, 5),
		"group 32 days": fastBatchRequest(zz, "20250901", "20251002", 1, 5),
	} {
		if bad != "" {
			t.Errorf("%s built: %s", name, cut(bad, 200))
		}
	}
	if fastHeadsRequest(zz, "20250901", "20251001") == "" || fastBatchRequest(zz, "20250901", "20250901", 5, 5) == "" {
		t.Fatal("31 days, or a group of one day, refused")
	}
	h, b := fastHeadsRequest(zz, "20250901", "20250907"), fastBatchRequest(zz, "20250903", "20250905", 1201, 1260)
	for _, ok := range []string{h, b} {
		if err := checkAllowed(ok); err != nil {
			t.Fatalf("refused: %v", err)
		}
	}
	for _, bad := range []string{
		strings.Replace(h, "</FETCH>", ", NARRATION</FETCH>", 1),
		strings.Replace(h, `<SVTODATE TYPE="Date">20250907`, `<SVTODATE TYPE="Date">20251231`, 1),
		strings.Replace(b, "$MasterID &gt;= 1201", "$MasterID &gt; 1201", 1),
		strings.Replace(b, "</FETCH>", ", ADDRESS</FETCH>", 1),
		strings.Replace(b, `<SVFROMDATE TYPE="Date">20250903</SVFROMDATE><SVTODATE TYPE="Date">20250905</SVTODATE>`, "", 1),
	} {
		if checkAllowed(bad) == nil {
			t.Errorf("allowed: %s", cut(bad, 300))
		}
	}
}

// --- 2. off by default: the guard refuses both ids even while one is being asked; with the switch on, only the request
// being asked, under the 2 s stop, for a company with a starting point
func TestFastGuardOffByDefault(t *testing.T) {
	f, _, m := pullBridgeWith(t, "")
	fastReset()
	t.Cleanup(fastReset)
	if fastOn() {
		t.Fatal("FastEntries on by default")
	}
	h := fastHeadsRequest(zz, "20250901", "20250907")
	fast.mu.Lock()
	fast.ask = h
	fast.mu.Unlock()
	if datedRefused(recorderTC(nil), h) == nil {
		t.Fatal("a window went with the switch off")
	}
	fast.mu.Lock()
	fast.ask = ""
	fast.mu.Unlock()
	// a period read with the switch off: today's requests only
	vs := fastDays(f, 700, map[string]int{"20250901": 3, "20250902": 2, "20250903": 4})
	applyPeriodDays(fastList("20250901", "20250902", "20250903"))
	pullRun(t, 40)
	if f.n(fastHeadsID)+f.n(fastBatchID) != 0 || f.n(dayHeadsID) != 3 {
		t.Fatalf("requests: %v", f.ids())
	}
	fastAllOnce(t, m, vs)

	setCfg("FastEntries", true)
	tc := recorderTC(nil)
	if datedRefused(tc, h) == nil {
		t.Fatal("a window not being asked went")
	}
	fast.mu.Lock()
	fast.ask = h
	fast.mu.Unlock()
	if err := datedRefused(tc, h); err != nil {
		t.Fatalf("the window being asked refused: %v", err)
	}
	slow := recorderTC(nil)
	slow.limitMs = 5000
	for name, x := range map[string]*TC{"no 2 s stop": slow, "a person's": {copier: true, person: true, bg: true, limitMs: 2000}, "none": nil} {
		if datedRefused(x, h) == nil {
			t.Fatalf("%s went", name)
		}
	}
	if datedRefused(tc, fastHeadsRequest(zz, "20250901", "20250908")) == nil {
		t.Fatal("another window went")
	}
	if datedRefused(tc, fastHeadsRequest("OTHER CO", "20250901", "20250907")) == nil {
		t.Fatal("a company with no starting point went")
	}
}

// --- 3. ten listed days in two windows: no FinComDayHeads, no entry one by one; every entry once, as FinComVoucherObject
// keeps it; each day's count told to FinCom as Tally's own (a day of no entries too); one request in flight
func TestFastWindowReadsManyDays(t *testing.T) {
	f, _, m := fastBridge(t, "")
	days := daysFrom("20250901", 10)
	per := map[string]int{}
	for i, d := range days {
		per[d] = (i%3)*4 + 3
	}
	per["20250905"] = 0
	delete(per, "20250905")
	vs := fastDays(f, 1000, per)
	applyPeriodDays(fastList(days...))
	pullRun(t, 80)
	if f.n(dayHeadsID) != 0 || f.n(vchObjectID) != 0 || f.n(vchBatchID) != 0 {
		t.Fatalf("today's requests went: heads %d, one by one %d, day groups %d: %v", f.n(dayHeadsID), f.n(vchObjectID), f.n(vchBatchID), f.ids())
	}
	if n := f.n(fastHeadsID); n != 2 {
		t.Fatalf("%d windows asked (want 7 days, then the 3 left)", n)
	}
	if n := f.n(fastBatchID); n < 2 || n > 6 {
		t.Fatalf("%d groups for %d entries", n, len(vs))
	}
	fastAllOnce(t, m, vs)
	fastCountsTold(t, m, vs, days)
	f.mu.Lock()
	mf := f.maxFlight
	f.mu.Unlock()
	if mf > 1 {
		t.Fatalf("%d requests at Tally at once", mf)
	}
	for _, h := range m.heads {
		if str(h["via"]) != "day" || h["fetch"] != true {
			t.Fatalf("period_heads not as today's: %v", h)
		}
	}
	// the window grew (7 days answered fast: 14 next) and the group too (10, then 20 ...); kept for the choice
	if s := fastSizeOf(pullItem{Company: zz, CGUID: b220CoGUID}); s.Win != 14 || s.Batch < 20 {
		t.Fatalf("sizes %+v", s)
	}
}

// --- 4. a window of more entries than a group: groups grow 10, 20, 40, 80, then 100 at most; every entry once
func TestFastWindowMoreThanTheBatch(t *testing.T) {
	f, _, m := fastBridge(t, "")
	days := daysFrom("20250901", 3)
	vs := fastDays(f, 5000, map[string]int{days[0]: 150, days[1]: 140, days[2]: 160})
	applyPeriodDays(fastList(days...))
	pullRun(t, 200)
	var sizes []int
	for _, b := range fastBodies(f, fastBatchID) {
		n := fastGroupSize(b, vs)
		if n < 2 || n > 100 {
			t.Fatalf("a group of %d", n)
		}
		sizes = append(sizes, n)
	}
	if len(sizes) < 5 || sizes[0] != 10 || sizes[1] != 20 || sizes[2] != 40 || sizes[3] != 80 || sizes[4] != 100 {
		t.Fatalf("group sizes %v", sizes)
	}
	if f.n(vchObjectID) != 0 || f.n(fastHeadsID) != 1 {
		t.Fatalf("requests: %v", f.ids())
	}
	fastAllOnce(t, m, vs)
	fastCountsTold(t, m, vs, days)
}

// --- 5. slow replies: a group over 1.2 s halves the next; a group stopped at 2 s is halved once, a second stop: the rest
// one by one (FinComVoucherObject); Tally's window answered, so the company is not stopped; nothing missed or doubled
func TestFastSlowGroupsShrinkThenOneByOne(t *testing.T) {
	f, c, m := fastBridge(t, `,"TallyAbandonMaxSec":600,"FastEntriesBatchStart":40`)
	var stops []M
	c.mu.Lock()
	prev := c.other
	c.other = func(k string, b M) (int, M) {
		if k == "period_stop" {
			stops = append(stops, b)
			return 200, M{"ok": true}
		}
		return prev(k, b)
	}
	c.mu.Unlock()
	days := daysFrom("20250901", 2)
	vs := fastDays(f, 3000, map[string]int{days[0]: 60, days[1]: 60})
	n := 0
	f.mu.Lock()
	f.slow = func(id, body string) time.Duration {
		if id != fastBatchID {
			return 0
		}
		n++
		switch n {
		case 1:
			return 1300 * time.Millisecond // slow, answered: the next group halved
		case 2, 3:
			return 2300 * time.Millisecond // stopped at 2 s
		}
		return 0
	}
	f.mu.Unlock()
	applyPeriodDays(fastList(days...))
	at := nowFn()
	for i := 0; i < 60 && len(m.held) < len(vs); i++ { // the shared retry schedule waits after a stop: time moves on
		pullRun(t, 300)
		at = at.Add(time.Minute)
		nowFn = func() time.Time { return at }
		applyPeriodDays(fastList(days...))
	}
	r3Settle()
	bs := fastBodies(f, fastBatchID)
	var sizes []int
	for _, b := range bs {
		sizes = append(sizes, fastGroupSize(b, vs))
	}
	if len(sizes) != 3 || sizes[0] != 40 || sizes[1] != 20 || sizes[2] != 10 {
		t.Fatalf("group sizes %v (want 40 slow, 20 stopped, 10 stopped)", sizes)
	}
	if len(stops) != 0 {
		t.Fatalf("the company stopped: %v", stops)
	}
	if f.n(vchObjectID) == 0 || f.n(vchBatchID) != 0 {
		t.Fatalf("one by one %d, day groups %d (the rest is read one by one)", f.n(vchObjectID), f.n(vchBatchID))
	}
	if s := fastSizeOf(pullItem{Company: zz, CGUID: b220CoGUID}); s.Batch != 1 {
		t.Fatalf("sizes %+v (one by one kept for the choice)", s)
	}
	fastAllOnce(t, m, vs)
}

// --- 6. a window's heads stopped at 2 s (a timeout): the next window is halved; at two days the fast read stops for
// the choice and the days are read as before; nothing missed or doubled; Tally's window answered
func TestFastHeadsTimeoutShrinksThenAsBefore(t *testing.T) {
	f, _, m := fastBridge(t, `,"TallyAbandonMaxSec":600,"FastEntriesWindowDays":4`)
	days := daysFrom("20250901", 4)
	vs := fastDays(f, 800, map[string]int{days[0]: 2, days[1]: 3, days[2]: 2, days[3]: 3})
	f.mu.Lock()
	f.slow = func(id, body string) time.Duration {
		if id == fastHeadsID {
			return 2300 * time.Millisecond
		}
		return 0
	}
	f.mu.Unlock()
	applyPeriodDays(fastList(days...))
	at := nowFn()
	for i := 0; i < 60 && len(m.held) < len(vs); i++ {
		pullRun(t, 100)
		at = at.Add(time.Minute)
		nowFn = func() time.Time { return at }
		applyPeriodDays(fastList(days...))
	}
	r3Settle()
	hs := fastBodies(f, fastHeadsID)
	if len(hs) != 2 {
		t.Fatalf("%d windows asked (want 4 days, then 2)", len(hs))
	}
	a0, z0 := pinDates(hs[0])
	a1, z1 := pinDates(hs[1])
	if a0 != days[0] || z0 != days[3] || addDays(a1, 1) != z1 {
		t.Fatalf("windows %s..%s, %s..%s", a0, z0, a1, z1)
	}
	if s := fastSizeOf(pullItem{Company: zz, CGUID: b220CoGUID}); s.Off == "" {
		t.Fatal("the fast read still on after two stops")
	}
	if f.n(dayHeadsID) != 4 {
		t.Fatalf("%d days asked as before (want 4)", f.n(dayHeadsID))
	}
	fastAllOnce(t, m, vs)
}

// --- 7. a malformed reply to a group: not used; those days read one by one; every entry once
func TestFastMalformedGroupOneByOne(t *testing.T) {
	f, _, m := fastBridge(t, "")
	days := daysFrom("20250901", 3)
	vs := fastDays(f, 900, map[string]int{days[0]: 4, days[1]: 5, days[2]: 4})
	f.mu.Lock()
	f.behave = func(w http.ResponseWriter, r *http.Request, id, body string) bool {
		if id == fastBatchID {
			_, _ = w.Write([]byte("<ENVELOPE><BODY><DATA><COLLECTION><VOUCHER><MASTERID>9")) // cut short
			return true
		}
		return false
	}
	f.mu.Unlock()
	applyPeriodDays(fastList(days...))
	pullRun(t, 80)
	if f.n(fastBatchID) != 1 || f.n(vchBatchID) != 0 {
		t.Fatalf("groups %d, day groups %d", f.n(fastBatchID), f.n(vchBatchID))
	}
	if f.n(vchObjectID) == 0 {
		t.Fatal("the group's days not read one by one")
	}
	fastAllOnce(t, m, vs)
	fastCountsTold(t, m, vs, days)
}

// --- 7b. a window answered with rows of other days (the dates not applied): dropped; no window asked of that Tally
// again; the days read as before (FinComDayHeads), nothing stored from the bad answer
func TestFastWindowOtherDatesDropped(t *testing.T) {
	f, _, m := fastBridge(t, "")
	days := daysFrom("20250901", 3)
	vs := fastDays(f, 900, map[string]int{days[0]: 2, days[1]: 2, days[2]: 2})
	other := pullDay(f, "20250820", 950, "Sales")
	m.held[other[0].guid] = other[0].alter
	f.mu.Lock()
	f.headsAllDays = true
	f.mu.Unlock()
	applyPeriodDays(fastList(days...))
	for i := 0; i < 50 && f.n(fastHeadsID) == 0; i++ {
		pullStep()
	}
	f.mu.Lock()
	f.headsAllDays = false // FinComDayHeads as today answers its one day
	f.mu.Unlock()
	pullRun(t, 60)
	if f.n(fastHeadsID) != 1 || f.n(fastBatchID) != 0 || f.n(dayHeadsID) != 3 {
		t.Fatalf("requests %v", f.ids())
	}
	fastAllOnce(t, m, vs)
}

// --- 8. a restart in the middle of a window's days: the read goes on from what FinCom confirmed; nothing sent twice,
// nothing missed; the sizes reached are taken from fast-entries.json
func TestFastRestartMidRead(t *testing.T) {
	f, _, m := fastBridge(t, "")
	days := daysFrom("20250901", 6)
	vs := fastDays(f, 2000, map[string]int{days[0]: 5, days[1]: 6, days[2]: 7, days[3]: 5, days[4]: 6, days[5]: 7})
	applyPeriodDays(fastList(days...))
	// steps until FinCom has taken some days' entries, not all
	for i := 0; i < 200; i++ {
		pullStep()
		if _, times := fastSent(m); len(times) > 0 && len(times) < len(vs) && len(m.entries) >= 2 {
			break
		}
	}
	_, before := fastSent(m)
	if len(before) == 0 || len(before) >= len(vs) {
		t.Fatalf("the restart point: %d of %d sent", len(before), len(vs))
	}
	fastSaveNow()
	sz := fastSizeOf(pullItem{Company: zz, CGUID: b220CoGUID})
	// the restart: everything in memory is gone (FinCom's cloud keeps what it took)
	pullReset()
	fast.mu.Lock()
	fast.ask, fast.eng, fast.ready, fast.sizes = "", nil, map[string]*fastDay{}, map[string]fastSize{}
	fast.mu.Unlock()
	fastLoad()
	if got := fastSizeOf(pullItem{Company: zz, CGUID: b220CoGUID}); got != sz {
		t.Fatalf("sizes after the restart %+v, before %+v", got, sz)
	}
	// FinCom lists the days again (those it holds whole too: their heads are told again, nothing more is read of them)
	applyPeriodDays(fastList(days...))
	pullRun(t, 120)
	fastAllOnce(t, m, vs)
	fastCountsTold(t, m, vs, days)
}

// --- 9. a cancelled entry goes as today: listed in the day's heads, read, sent with its own mark (ISCANCELLED and
// ISOPTIONAL are fields of the approved FETCH; nothing is filtered on them)
func TestFastCancelledAndOptionalAsToday(t *testing.T) {
	f, _, m := fastBridge(t, "")
	days := daysFrom("20250901", 2)
	vs := fastDays(f, 400, map[string]int{days[0]: 3, days[1]: 3})
	f.mu.Lock()
	vs[1].cancelled = true
	f.mu.Unlock()
	applyPeriodDays(fastList(days...))
	pullRun(t, 60)
	fastAllOnce(t, m, vs)
	sent, _ := fastSent(m)
	if !strings.Contains(sent[vs[1].master], "<ISCANCELLED>Yes</ISCANCELLED>") {
		t.Fatalf("the cancelled entry: %s", sent[vs[1].master])
	}
}

// --- 10. the speed in the beat: entries FinCom took a minute (no figure until two sends a minute apart)
func TestFastRateInBeat(t *testing.T) {
	fastReset()
	t.Cleanup(fastReset)
	at := time.Date(2026, 11, 7, 10, 0, 0, 0, time.Local)
	nowFn = func() time.Time { return at }
	t.Cleanup(func() { nowFn = time.Now })
	fastRateNote(zz, 50)
	if r := fastRate(zz); r != 0 {
		t.Fatalf("a speed from one send: %d", r)
	}
	at = at.Add(30 * time.Second)
	fastRateNote(zz, 100)
	if r := fastRate(zz); r != 0 {
		t.Fatalf("a speed over 30 s: %d", r)
	}
	at = at.Add(90 * time.Second)
	fastRateNote(zz, 200)
	if r := fastRate(zz); r != 150 { // 300 entries in the 2 minutes since the first send
		t.Fatalf("speed %d, want 150", r)
	}
	pull.mu.Lock()
	pull.state[companyKey(zz)] = M{"day": "20250901", "phase": "fetch"}
	pull.mu.Unlock()
	t.Cleanup(pullReset)
	b := pullBeat()
	st := obj(obj(b["companies"])[companyKey(zz)])
	if toInt(st["entriesPerMin"]) != 150 || obj(b["fast"]) == nil {
		t.Fatalf("beat %v", b)
	}
	pull.mu.Lock()
	_, leaked := pull.state[companyKey(zz)]["entriesPerMin"]
	pull.mu.Unlock()
	if leaked {
		t.Fatal("the beat's copy changed the kept state")
	}
	// ten minutes on with nothing taken: no speed
	at = at.Add(11 * time.Minute)
	if r := fastRate(zz); r != 0 {
		t.Fatalf("a stale speed %d", r)
	}
}

// --- 3b. by day: the days FinCom listed (5 here, two with no entries) are one window, one heads request
func TestFastByDayOneWindow(t *testing.T) {
	f, _, m := fastBridge(t, "")
	days := daysFrom("20250901", 3)
	vs := fastDays(f, 600, map[string]int{days[0]: 4, days[1]: 5, days[2]: 6})
	applyPeriodDays(pullList(days[2], days[1], days[0], "20250831", "20250830")) // by day
	pullRun(t, 40)
	if f.n(fastHeadsID) != 1 || f.n(dayHeadsID) != 0 || f.n(vchObjectID) != 0 {
		t.Fatalf("requests %v", f.ids())
	}
	fastAllOnce(t, m, vs)
}

// --- 11. postings first: a posting going holds every request of the window (before its heads, and between its
// groups); once it is done the window goes on where it was, nothing asked twice
func TestFastPostingFirst(t *testing.T) {
	f, _, m := fastBridge(t, `,"FastEntriesBatchStart":2`)
	days := daysFrom("20250901", 3)
	vs := fastDays(f, 300, map[string]int{days[0]: 3, days[1]: 3, days[2]: 3})
	importsInFlight.Store(1)
	t.Cleanup(func() { importsInFlight.Store(0) })
	applyPeriodDays(fastList(days...))
	n0 := len(f.ids())
	pullRun(t, 10)
	if len(f.ids()) != n0 {
		t.Fatalf("sent while a posting was going: %v", f.ids()[n0:])
	}
	importsInFlight.Store(0)
	for i := 0; i < 50 && f.n(fastBatchID) == 0; i++ {
		pullStep()
	}
	importsInFlight.Store(1) // a posting between two groups
	n1 := len(f.ids())
	pullRun(t, 10)
	if len(f.ids()) != n1 {
		t.Fatalf("sent while a posting was going: %v", f.ids()[n1:])
	}
	importsInFlight.Store(0)
	pullRun(t, 60)
	if f.n(fastHeadsID) != 1 {
		t.Fatalf("the window's heads asked %d times", f.n(fastHeadsID))
	}
	fastAllOnce(t, m, vs)
}

// --- 3c. FinCom hands a fast bridge up to 30 days by day (the owner's "Yes to both"): all are kept and read as windows;
// with the switch off, 3 as before; the night pace is not taken by day
func TestFastByDayTakesThirty(t *testing.T) {
	f, _, m := fastBridge(t, "")
	days := daysFrom("20250901", 12)
	per := map[string]int{}
	for _, d := range days {
		per[d] = 2
	}
	vs := fastDays(f, 700, per)
	applyPeriodDays(pullList(days...)) // by day (no periodNight)
	pull.mu.Lock()
	n := len(pull.items)
	pull.mu.Unlock()
	if n != 12 || pullNight() {
		t.Fatalf("%d days kept by day (want 12), night %v", n, pullNight())
	}
	pullRun(t, 80)
	if f.n(fastHeadsID) > 2 || f.n(dayHeadsID) != 0 {
		t.Fatalf("requests %v", f.ids())
	}
	fastAllOnce(t, m, vs)
	setCfg("FastEntries", false)
	applyPeriodDays(pullList(days...))
	pull.mu.Lock()
	n = len(pull.items)
	pull.mu.Unlock()
	if n > 3 {
		t.Fatalf("%d days kept by day with the switch off", n)
	}
}
