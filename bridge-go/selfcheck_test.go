package main

// The nightly self-check (next release, item e; docs/selfcheck-requests-for-approval.md). Tests written before the code:
// only requests already on the allow-list, byte for byte as built (FinComCompany from the light check, TDSDeskKeepList
// above an AlterID, FinComVoucherByMaster through the recorder); after hours, once a night per company, Tally idle,
// postings first; nothing asked of Tally when the counter has not moved; the missing entries fetched one a request and
// counted; a list stopped at 2 s, or too many changes, recorded "not checked" and not asked again that night; 2.3.2's
// stop of the entry fetch respected (the days listed for a Day Book upload); the result recorded by the cloud; a cloud
// without the nightly check said once.

import (
	"strings"
	"testing"
	"time"
)

// the other tests never run it by themselves (a light check at night would)
func init() { selfCheckDefault = false }

// a bridge with the nightly check on, its stand Tally holding one entry (the starting point, AlterID 1), at 23:10
func scBridge(t *testing.T, extra string) (*standTally, *standCloud) {
	t.Helper()
	_, f, c := liveBridge(t, `,"SelfCheck":true`+extra)
	noteCompanyGUID(zz, b220CoGUID)
	f.add("20261005", "Party A", "1", "first", "100.00")
	led231Numbers(t, f)
	if sp, ok := startPointOf(zz); !ok || sp != 1 {
		t.Fatalf("no starting point: %d %v", sp, ok)
	}
	scAt(t, time.Date(2026, 10, 6, 23, 10, 0, 0, time.Local))
	t.Cleanup(func() {
		selfCheckHoldFn, selfCheckIdleFn = keepHold, idleSec
		slowForget()
	})
	// the company list is fresh at night (the light check asks it every 10 minutes): asked here once, not counted below
	if _, why := ledOwnPort(zz, b220CoGUID, f.port); why != "" {
		t.Fatalf("not this bridge's own Tally: %s", why)
	}
	return f, c
}

func scAt(t *testing.T, at time.Time) {
	t.Helper()
	nowFn = func() time.Time { return at }
	t.Cleanup(func() { nowFn = time.Now; retryReset() })
}

// the selfcheck bodies of one step
func scSteps(c *standCloud, step string) []M {
	c.mu.Lock()
	defer c.mu.Unlock()
	var o []M
	for _, b := range c.selfchecks {
		if str(b["step"]) == step {
			o = append(o, b)
		}
	}
	return o
}

// every request the stand Tally received: on the allow-list, exactly as its builder makes it, never a balance
// the stand Tally's requests other than the company list (TDSDeskCompanies, TDSDeskCompanyInfo: the bridge's own look at
// which companies are open, asked by the light check every 10 minutes; existing requests)
func scN(f *standTally) int {
	n := 0
	for _, id := range f.ids() {
		if id != "TDSDeskCompanies" && id != "TDSDeskCompanyInfo" {
			n++
		}
	}
	return n
}

func scOnlyListed(t *testing.T, f *standTally) {
	t.Helper()
	f.mu.Lock()
	bodies, ids := append([]string{}, f.bodies...), append([]string{}, f.reqs...)
	f.mu.Unlock()
	for i, b := range bodies {
		if !contains([]string{"FinComCompany", "TDSDeskKeepList", sliceID, vchObjectID, vchByNumberID, "TDSDeskCompanies", "TDSDeskCompanyInfo"}, ids[i]) {
			t.Fatalf("request %d is %s: not one the nightly check uses", i, ids[i])
		}
		if err := checkAllowed(b); err != nil {
			t.Fatalf("request %d (%s) is not allowed as built: %v", i, ids[i], err)
		}
	}
	f.noBalance(t)
}

// --- 1. nothing missing: one list request, compared by the cloud, recorded; the mark moves to Tally's counter; the same
// night never again; the next night with the counter unmoved: nothing asked of Tally, still recorded
func TestSelfCheckNothingMissing(t *testing.T) {
	f, c := scBridge(t, "")
	for i, d := range []string{"20261006", "20261006", "20261004"} {
		f.add(d, "Party B", string(rune('2'+i)), "", "50.00")
	}
	led231Numbers(t, f)
	n0 := scN(f)
	r, err := selfCheckStart(zz, f.port)
	if err != nil || r == nil {
		t.Fatalf("not started: %v %v", r, err)
	}
	if f.n("TDSDeskKeepList") != 1 || scN(f)-n0 != 1 {
		t.Fatalf("requests: %v", f.ids()[n0:])
	}
	if b := f.bodiesOf("TDSDeskKeepList")[0]; b != keepListAboveRequest(zz, 1) || requestDated(b) {
		t.Fatalf("not source B's undated list above the starting point: %s", b)
	}
	cmp := scSteps(c, "compare")
	if len(cmp) != 1 || len(arr(cmp[0]["entries"])) != 3 || toI64(cmp[0]["after"]) != 1 || toI64(cmp[0]["altvchid"]) != 4 || str(cmp[0]["company_guid"]) != b220CoGUID {
		t.Fatalf("the compare: %v", cmp)
	}
	e := arr(arr(cmp[0]["entries"])[0])
	if len(e) != 4 || toI64(e[1]) != 2 || toI64(e[2]) != 2 || str(e[3]) != "20261006" || !strings.HasPrefix(str(e[0]), b220CoGUID+"-") {
		t.Fatalf("an entry: [guid, alter, mid, date] %v", e)
	}
	if err := selfCheckFinish(r); err != nil {
		t.Fatal(err)
	}
	rec := scSteps(c, "record")
	if len(rec) != 1 {
		t.Fatalf("records: %d", len(rec))
	}
	x := rec[0]
	if toI64(x["listed"]) != 3 || toI64(x["missing"]) != 0 || toI64(x["fetched"]) != 0 || toI64(x["still"]) != 0 || str(x["stopped"]) != "" || str(x["night"]) != "20261006" ||
		toI64(x["altvchid"]) != 4 || toI64(x["after"]) != 1 || len(arr(x["gapDays"])) != 0 {
		t.Fatalf("the record: %v", x)
	}
	if st := scState(zz, b220CoGUID); toI64(st["mark"]) != 4 || str(st["night"]) != "20261006" || str(st["since"]) != "20261006" {
		t.Fatalf("the mark: %v", st)
	}
	// the same night (after midnight too): not again
	scAt(t, time.Date(2026, 10, 7, 2, 0, 0, 0, time.Local))
	if r, _ := selfCheckStart(zz, f.port); r != nil || f.n("TDSDeskKeepList") != 1 {
		t.Fatalf("checked twice in one night")
	}
	// the next night, nothing changed in Tally: nothing asked, still recorded
	scAt(t, time.Date(2026, 10, 7, 22, 30, 0, 0, time.Local))
	led231Numbers(t, f)
	n1 := scN(f)
	r, err = selfCheckStart(zz, f.port)
	if err != nil || r == nil || scN(f)-n1 != 0 {
		t.Fatalf("asked with the counter unmoved: %v %v %v", r, err, f.ids()[n1:])
	}
	if err := selfCheckFinish(r); err != nil {
		t.Fatal(err)
	}
	if rec = scSteps(c, "record"); len(rec) != 2 || toI64(rec[1]["listed"]) != 0 || str(rec[1]["night"]) != "20261007" || len(scSteps(c, "compare")) != 1 {
		t.Fatalf("the second night: %v", rec)
	}
	scOnlyListed(t, f)
}

// --- 2. two entries missing from FinCom's copy: fetched through the recorder (one MasterID a request, the line's own date),
// sent with Tally's entry, counted as fetched; an answer naming something Tally did not list is ignored; the mark stays below
// them so the next night proves them, and moves on when nothing is missing
func TestSelfCheckFetchesMissing(t *testing.T) {
	f, c := scBridge(t, "")
	v2 := f.add("20261006", "Party B", "2", "", "50.00")
	f.add("20261006", "Party C", "3", "", "60.00")
	v4 := f.add("20261003", "Party D", "4", "", "70.00")
	led231Numbers(t, f)
	c.scReply = func(b M) (int, M) {
		if str(b["step"]) == "compare" {
			return 200, M{"ok": true, "received": 3, "missing": []any{M{"guid": v2.guid, "why": "absent"}, M{"guid": v4.guid, "why": "older"}, M{"guid": "not-listed-1", "why": "absent"}}}
		}
		return 200, M{"ok": true, "result": "fetched", "words": "2 fetched"}
	}
	r, err := selfCheckStart(zz, f.port)
	if err != nil || r == nil || len(r.missing) != 2 || len(r.queued) != 2 {
		t.Fatalf("missing / queued: %v %v", r, err)
	}
	q := liveQueue()
	evs := map[string]string{}
	for _, x := range q {
		if x.source != "selfcheck" {
			t.Fatalf("queued from another source: %v", x)
		}
		evs[x.guid] = x.event
	}
	if evs[v2.guid] != "created" || evs[v4.guid] != "altered" {
		t.Fatalf("events: %v", evs)
	}
	n0 := f.n(vchObjectID)
	uploadAll(t)
	if f.n(vchObjectID)-n0 != 2 {
		t.Fatalf("body requests: %d", f.n(vchObjectID)-n0)
	}
	bs := f.bodiesOf(vchObjectID)
	want := map[string]bool{voucherObjectRequest(zz, v2.master): true, voucherObjectRequest(zz, v4.master): true}
	for _, b := range bs[len(bs)-2:] {
		if !want[b] {
			t.Fatalf("not the body fetch as built (one MasterID, the entry's own date): %s", b)
		}
	}
	sent := c.recSent()
	got := 0
	for _, l := range sent {
		if str(l["source"]) == "selfcheck" && str(l["xml"]) != "" && l["full"] == true {
			got++
		}
	}
	if got != 2 {
		t.Fatalf("lines sent with Tally's entry: %d of %v", got, sent)
	}
	if err := selfCheckFinish(r); err != nil {
		t.Fatal(err)
	}
	x := scSteps(c, "record")[0]
	if toI64(x["missing"]) != 2 || toI64(x["fetched"]) != 2 || toI64(x["still"]) != 0 || toI64(x["listed"]) != 3 {
		t.Fatalf("the record: %v", x)
	}
	if st := scState(zz, b220CoGUID); toI64(st["mark"]) != 1 || str(st["since"]) != "" {
		t.Fatalf("the mark must stay below the entries just fetched: %v", st)
	}
	// the next night FinCom has them: the mark moves to Tally's counter
	c.scReply = nil
	scAt(t, time.Date(2026, 10, 7, 23, 0, 0, 0, time.Local))
	r, _ = selfCheckStart(zz, f.port)
	if r == nil || r.listed != 3 || len(r.missing) != 0 {
		t.Fatalf("the next night: %v", r)
	}
	_ = selfCheckFinish(r)
	if st := scState(zz, b220CoGUID); toI64(st["mark"]) != 4 {
		t.Fatalf("the mark: %v", st)
	}
	scOnlyListed(t, f)
}

// --- 3. Tally's list stopped at the 2-second rule: nothing compared, nothing fetched, recorded "not checked" with the day
// of the last good check for a Day Book upload; the mark stays; not asked again that night
func TestSelfCheckListStoppedAt2s(t *testing.T) {
	f, c := scBridge(t, `,"RecorderLimitMs":300`)
	f.add("20261006", "Party B", "2", "", "50.00")
	led231Numbers(t, f)
	scSave(zz, b220CoGUID, M{"mark": 1, "since": "20261005"})
	f.mu.Lock()
	f.slow = func(id, body string) time.Duration {
		if id == "TDSDeskKeepList" {
			return 1500 * time.Millisecond
		}
		return 0
	}
	f.mu.Unlock()
	r, err := selfCheckStart(zz, f.port)
	if err != nil || r == nil || r.stopped == "" || !strings.Contains(r.stopped, "2 s") {
		t.Fatalf("not stopped: %v %v", r, err)
	}
	if len(scSteps(c, "compare")) != 0 || len(liveQueue()) != 0 {
		t.Fatalf("compared or queued after a stop")
	}
	if err := selfCheckFinish(r); err != nil {
		t.Fatal(err)
	}
	x := scSteps(c, "record")[0]
	if str(x["stopped"]) == "" || toI64(x["listed"]) != 0 || str(x["since"]) != "20261005" {
		t.Fatalf("the record: %v", x)
	}
	if st := scState(zz, b220CoGUID); toI64(st["mark"]) != 1 || str(st["night"]) != "20261006" {
		t.Fatalf("the mark moved after a stop: %v", st)
	}
	retryReset()
	n := f.n("TDSDeskKeepList")
	scAt(t, time.Date(2026, 10, 7, 1, 30, 0, 0, time.Local))
	if r, _ := selfCheckStart(zz, f.port); r != nil || f.n("TDSDeskKeepList") != n {
		t.Fatalf("asked again the same night")
	}
}

// --- 4. 2.3.2's mark "entry fetch stopped: over 2 s" for the company (slowco.go; 2.4.0 review: the dead stub
// entryFetchOffFor is gone): nothing fetched; the missing entries' days listed for a Day Book upload; recorded as still
// missing with the reason
func TestSelfCheckEntryFetchOff(t *testing.T) {
	f, c := scBridge(t, "")
	v2 := f.add("20261003", "Party B", "2", "", "50.00")
	v3 := f.add("20261005", "Party C", "3", "", "60.00")
	v4 := f.add("20261003", "Party D", "4", "", "70.00")
	led231Numbers(t, f)
	slowSt.mu.Lock()
	slowFresh()
	slowSt.marks[companyKey(zz)] = &slowMark{Company: zz, GUID: b220CoGUID, LastMs: -1}
	slowSt.mu.Unlock()
	c.scReply = func(b M) (int, M) {
		if str(b["step"]) == "compare" {
			return 200, M{"ok": true, "missing": []any{M{"guid": v2.guid, "why": "absent"}, M{"guid": v3.guid, "why": "absent"}, M{"guid": v4.guid, "why": "absent"}}}
		}
		return 200, M{"ok": true}
	}
	n0 := f.n(vchObjectID)
	r, err := selfCheckStart(zz, f.port)
	if err != nil || r == nil || len(r.queued) != 0 || r.fetchOff == "" {
		t.Fatalf("fetched while the entry fetch is off: %v %v", r, err)
	}
	uploadAll(t)
	if f.n(vchObjectID) != n0 {
		t.Fatalf("an entry asked of Tally")
	}
	_ = selfCheckFinish(r)
	x := scSteps(c, "record")[0]
	gd := arr(x["gapDays"])
	if toI64(x["still"]) != 3 || toI64(x["fetched"]) != 0 || len(gd) != 2 || str(gd[0]) != "20261003" || str(gd[1]) != "20261005" || !strings.Contains(str(x["fetchOff"]), "longer than 2 s") {
		t.Fatalf("the record: %v", x)
	}
	scOnlyListed(t, f)
}

// --- 5. more changes since the mark than one list may carry: 2.4.0 review: no longer "not checked" for ever: month
// slices when the date form is kept (selfcheck240_test.go), else the one list asked all the same; a counter that went
// back: restored from a backup, the mark reset (selfcheck240_test.go)
func TestSelfCheckLargeAndRewound(t *testing.T) {
	f, c := scBridge(t, `,"SelfCheckMaxSpan":2`)
	for i := 0; i < 3; i++ {
		f.add("20261006", "Party B", "x", "", "50.00")
	}
	led231Numbers(t, f)
	n0 := scN(f)
	r, _ := selfCheckStart(zz, f.port)
	// no date form kept for the company (source C never probed): the one undated list is asked all the same (the 2-second
	// stop guards Tally), never "not checked" without asking
	if r == nil || r.stopped != "" || r.listed != 3 || f.n("TDSDeskKeepList") != 1 || requestDated(f.bodiesOf("TDSDeskKeepList")[0]) {
		t.Fatalf("not the undated list past the span: %+v %v", r, f.ids()[n0:])
	}
	_ = selfCheckFinish(r)
	if x := scSteps(c, "record")[0]; str(x["stopped"]) != "" || toI64(x["listed"]) != 3 {
		t.Fatalf("the record: %v", x)
	}
	n0 = scN(f)
	scAt(t, time.Date(2026, 10, 7, 23, 0, 0, 0, time.Local))
	scSave(zz, b220CoGUID, M{"mark": 50})
	r, _ = selfCheckStart(zz, f.port)
	if r == nil || !strings.Contains(r.stopped, "restored from a backup") || scN(f) != n0 {
		t.Fatalf("a counter below the mark: %v", r)
	}
}

// --- 6. when it may run: after hours only (22:00 to 06:00, the night of the evening it began), the switch, Tally idle, a
// posting first
func TestSelfCheckWhen(t *testing.T) {
	f, c := scBridge(t, "")
	for _, tc := range []struct {
		at    time.Time
		night string
		in    bool
	}{{time.Date(2026, 10, 6, 21, 59, 0, 0, time.Local), "20261006", false}, {time.Date(2026, 10, 6, 22, 0, 0, 0, time.Local), "20261006", true},
		{time.Date(2026, 10, 7, 5, 59, 0, 0, time.Local), "20261006", true}, {time.Date(2026, 10, 7, 6, 0, 0, 0, time.Local), "20261007", false},
		{time.Date(2026, 10, 7, 14, 0, 0, 0, time.Local), "20261007", false}} {
		if n, in := selfCheckNight(tc.at); n != tc.night || in != tc.in {
			t.Fatalf("%v: %s %v", tc.at, n, in)
		}
	}
	f.add("20261006", "Party B", "2", "", "50.00")
	led231Numbers(t, f)
	n0 := scN(f)
	try := func(what, want string) {
		t.Helper()
		if why := selfCheckBlocked(zz, b220CoGUID); !strings.Contains(why, want) {
			t.Fatalf("%s: %q", what, why)
		}
		selfCheckAfterLightCheck(zz, f.port)
		scWG.Wait()
		if scN(f) != n0 || len(c.selfchecks) != 0 {
			t.Fatalf("%s: something was sent: %v", what, f.ids()[n0:])
		}
	}
	scAt(t, time.Date(2026, 10, 6, 14, 0, 0, 0, time.Local))
	try("daytime", "not after hours")
	scAt(t, time.Date(2026, 10, 6, 23, 10, 0, 0, time.Local))
	importsInFlight.Add(1)
	try("a posting", "posting")
	importsInFlight.Add(-1)
	selfCheckHoldFn = func() string { return "someone is working in Tally" }
	try("Tally in use", "someone is working in Tally")
	selfCheckHoldFn = keepHold
	selfCheckIdleFn = func() float64 { return 20 }
	try("the computer in use", "someone used this computer")
	selfCheckIdleFn = idleSec
	setCfg("SelfCheck", false)
	try("switched off", "off")
	setCfg("SelfCheck", true)
	// all clear: the light check's hook runs it in the background, recorded
	selfCheckAfterLightCheck(zz, f.port)
	scWG.Wait()
	if len(scSteps(c, "record")) != 1 || f.n("TDSDeskKeepList") != 1 {
		t.Fatalf("not run when due: %v %v", c.kinds, f.ids()[n0:])
	}
	scOnlyListed(t, f)
}

// --- 7. a cloud without the nightly check (migration 65 not run): said, nothing fetched, not asked again that night
func TestSelfCheckOldCloud(t *testing.T) {
	f, c := scBridge(t, "")
	f.add("20261006", "Party B", "2", "", "50.00")
	led231Numbers(t, f)
	c.scReply = func(b M) (int, M) { return 400, M{"ok": false, "error": "unknown kind"} }
	r, err := selfCheckStart(zz, f.port)
	if r != nil || err == nil || !strings.Contains(err.Error(), "not ready") {
		t.Fatalf("an old cloud: %v %v", r, err)
	}
	if len(liveQueue()) != 0 {
		t.Fatalf("queued")
	}
	n := f.n("TDSDeskKeepList")
	if r, _ := selfCheckStart(zz, f.port); r != nil || f.n("TDSDeskKeepList") != n {
		t.Fatalf("asked again tonight")
	}
}

// --- 8. the light check calls it after the masters' changes (startpoint.go)
func TestSelfCheckFromLightCheck(t *testing.T) {
	src := readText("startpoint.go")
	i, j := strings.Index(src, "ledChangesAfterLightCheck(name, port)"), strings.Index(src, "selfCheckAfterLightCheck(name, port)")
	if i < 0 || j < i {
		t.Fatalf("the light check does not call the nightly check after the masters' changes")
	}
}
