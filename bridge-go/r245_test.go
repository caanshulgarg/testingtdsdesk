package main

// FinCom Bridge 2.4.5 (ROUND 102; the owner's decisions of 21-Oct-2026). Tests written before the code:
//   1. the three approved requests byte for byte as docs/bridge-2.4.5-forms-for-owner.md shows them (F1 FinComDayHeads, F2
//      its per-voucher-type form, F3 FinComLedgerIds), on the allow-list, pinned, no computed figure; a changed one refused;
//   2. FinComDayHeads goes only for a day the cloud listed, one day, as built, under the 2 s stop (ReadDays off or on);
//   3. the rows of real TallyPrime answers (testdata/r245: tally-versions dbm run 38790555479): CMPINFO never counted.

import (
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

// the owner's exact forms (the three ```xml blocks of the forms doc, in order F1, F2, F3)
func r245Forms(t *testing.T) []string {
	t.Helper()
	doc := readText(filepath.Join("..", "docs", "bridge-2.4.5-forms-for-owner.md"))
	var out []string
	for _, m := range regexp.MustCompile("(?s)```xml\n(.*?)\n```").FindAllStringSubmatch(doc, -1) {
		out = append(out, strings.TrimSpace(m[1]))
	}
	if len(out) != 3 {
		t.Fatalf("the forms doc holds %d xml blocks, want 3", len(out))
	}
	return out
}

func TestR245RequestsAsApproved(t *testing.T) {
	f := r245Forms(t)
	if got := dayHeadsRequest("@@CO@@", "20260831"); got != f[0] {
		t.Fatalf("F1 FinComDayHeads:\n%s\nwant (the owner's form)\n%s", got, f[0])
	}
	if got := dayHeadsTypeRequest("@@CO@@", "20260831", "Sales"); got != f[1] {
		t.Fatalf("F2 FinComDayHeads by type:\n%s\nwant (the owner's form)\n%s", got, f[1])
	}
	if got := ledgerIdsRequest("@@CO@@", 0, 0); got != f[2] {
		t.Fatalf("F3 FinComLedgerIds:\n%s\nwant (the owner's form)\n%s", got, f[2])
	}
	for _, id := range []string{dayHeadsID, ledIdsID} {
		a, ok := tallyAllowList[id]
		if !ok || a.measureOnly || a.maxSec <= 0 || a.maxSec >= 2 || !strings.Contains(a.measuredOn, "39542962661") {
			t.Fatalf("%s on the allow-list: %+v %v", id, a, ok)
		}
		if computedFigure(allowListSamples()[id]) != "" {
			t.Fatalf("%s asks a computed figure", id)
		}
	}
	if requestClass[dayHeadsID] != "exception" || requestClass[ledIdsID] != "undated" {
		t.Fatalf("classes: %q %q", requestClass[dayHeadsID], requestClass[ledIdsID])
	}
	// the Day Book report is not used for old days, and no other id was added
	for _, id := range []string{"FinComLedgerCount", "FinComVchPeriod", "Voucher Register"} {
		if _, ok := tallyAllowList[id]; ok {
			t.Fatalf("%s on the allow-list", id)
		}
	}
	// F3 is pinned: the count and its 2,000-MasterID chunks pass; anything else is refused
	for _, x := range []string{ledgerIdsRequest(zz, 0, 0), ledgerIdsRequest(zz, 2000, 4000), ledgerIdsRequest(zz, 4000, 0)} {
		if err := checkAllowed(x); err != nil {
			t.Fatalf("refused: %v\n%s", err, x)
		}
	}
	x := ledgerIdsRequest(zz, 0, 0)
	for _, bad := range []string{
		strings.Replace(x, "<FETCH>MASTERID</FETCH>", "<FETCH>MASTERID, NAME</FETCH>", 1),
		strings.Replace(x, "<FETCH>MASTERID</FETCH>", "<FETCH>MASTERID</FETCH><COMPUTE>N:$$NumItems:Ledger</COMPUTE>", 1),
		strings.Replace(x, "<TYPE>Ledger</TYPE>", "<TYPE>Voucher</TYPE>", 1),
		strings.Replace(x, "$MasterID &gt; 0", "$MasterID &gt; 0 AND $MasterID &lt;= 9000", 1),
		strings.Replace(x, "</STATICVARIABLES>", "<SVFROMDATE>20260401</SVFROMDATE></STATICVARIABLES>", 1),
		ledgerIdsRequest(zz, 0, 5000),
	} {
		if err := checkAllowed(bad); err == nil {
			t.Fatalf("a changed FinComLedgerIds passes: %s", bad)
		}
	}
}

// FinComDayHeads: only a day the cloud listed now, one day, exactly F1 or F2 for a listed type, under the 2 s stop; refused
// otherwise whatever ReadDays says (nothing sent)
func TestR245DayHeadsOnlyListedDays(t *testing.T) {
	f, _, _ := pullBridge(t)
	g := b220CoGUID
	d := "20250831"
	f1, f2 := dayHeadsRequest(zz, d), dayHeadsTypeRequest(zz, d, "Sales")
	tc := recorderTC(nil)
	// not listed: refused, by its id, nothing sent
	n0 := f.n("")
	if _, err := invokeTally(tc, f.port, f1, 5); err == nil {
		t.Fatal("FinComDayHeads went for a day FinCom did not list")
	}
	applyPeriodDays(M{"periodDays": []any{M{"company": zz, "company_guid": g, "day": d, "fetch": true, "types": []any{"Sales", "Receipt"}}}})
	for _, x := range []string{f1, f2, dayHeadsTypeRequest(zz, d, "Receipt")} {
		if !dayHeadsExact(tc, x) {
			t.Fatalf("a listed day refused: %s", x)
		}
		if err := checkAllowed(x); err != nil {
			t.Fatalf("not allowed: %v", err)
		}
	}
	for name, x := range map[string]string{
		"another day":            dayHeadsRequest(zz, "20250830"),
		"a period":               formCollection(dayHeadsID, zz, formPlainT, d, "20250901", dayHeadsFetch, ""),
		"an unlisted type":       dayHeadsTypeRequest(zz, d, "Payment"),
		"another company":        dayHeadsRequest("OTHER CO", d),
		"another date form":      formCollection(dayHeadsID, zz, formPlain, d, d, dayHeadsFetch, ""),
		"another field":          strings.Replace(f1, "GUID, MASTERID, ALTERID, DATE", "GUID, MASTERID, ALTERID, DATE, NARRATION", 1),
		"the Day Book for a day": dayBookRequestForm(zz, formPlainT, d, d),
	} {
		if dayHeadsExact(tc, x) {
			t.Fatalf("%s passes the exception", name)
		}
		if _, err := invokeTally(tc, f.port, x, 5); err == nil {
			t.Fatalf("%s went to Tally", name)
		}
	}
	// no 2 s stop (a person's or FinCom's request): refused, ReadDays on or off
	oldDaysOn()
	for _, t2 := range []*TC{fin, {copier: true}, {copier: true, limitMs: 2500}} {
		if _, err := invokeTally(t2, f.port, f1, 5); err == nil {
			t.Fatalf("FinComDayHeads went without the 2 s stop (%+v)", t2)
		}
	}
	if got := f.ids()[n0:]; len(got) != 0 {
		t.Fatalf("sent to Tally: %v", got)
	}
	// listed: it goes
	setCfg("ReadDays", false)
	if _, err := invokeTally(tc, f.port, f1, 5); err != nil {
		t.Fatalf("a listed day: %v", err)
	}
	if got := f.ids()[n0:]; len(got) != 1 || got[0] != dayHeadsID {
		t.Fatalf("sent: %v", got)
	}
	// the cloud no longer lists it: refused again
	applyPeriodDays(M{"periodDays": []any{}})
	if dayHeadsExact(tc, f1) {
		t.Fatal("a day no longer listed passes")
	}
}

// the rows of real answers: F2 for Sales of 31-Aug-2026 (340 entries on 3.0 and 7.1) and F3's 1,240 ledgers; Tally's
// CMPINFO counters (8,025 "ledgers", 2,402 "vouchers") never counted
func TestR245RowsOfRealAnswers(t *testing.T) {
	for _, rel := range []string{"3.0", "7.1"} {
		raw := gz242(t, filepath.Join("testdata", "r245", rel, "split-S3-5-20260831-Sales.xml.gz"))
		rows, bad := pullRowsOf(raw, "20260831")
		if bad != "" || len(rows) != 340 {
			t.Fatalf("%s: %d rows, bad %q", rel, len(rows), bad)
		}
		for _, r := range rows {
			if r.Type != "Sales" || r.Mid == "" || r.Alter <= 0 || len(r.GUID) < 30 || r.Date != "20260831" {
				t.Fatalf("%s: %+v", rel, r)
			}
		}
		if _, bad := pullRowsOf(raw, "20260830"); bad != "20260831" {
			t.Fatalf("%s: another day's rows not caught (%q)", rel, bad)
		}
		n, top := ledIdsCount(gz242(t, filepath.Join("testdata", "r245", rel, "ledcount-L3-1240.xml.gz")))
		if n != 1240 || top <= 0 {
			t.Fatalf("%s: %d ledgers (top %d)", rel, n, top)
		}
	}
}

// --- the day pull against the stand Tally and a model of the cloud (tally-ingest period_heads / period_entries)
type pullModel struct {
	held    map[string]int64 // GUID -> AlterID FinCom holds
	heads   []M              // every period_heads body
	entries []M              // every period_entries body
	n       map[string]int   // day -> Tally's count as told
	upload  map[string]M     // day -> the upload mark
}

func pullBridge(t *testing.T) (*standTally, *standCloud, *pullModel) {
	t.Helper()
	_, f, c := liveBridge(t, `,"DayPullGapMs":0,"KeepRestMs":1`)
	at := time.Date(2026, 10, 21, 10, 0, 0, 0, liveZone)
	nowFn = func() time.Time { return at }
	t.Cleanup(func() { nowFn = time.Now })
	f.mu.Lock()
	f.guid = b220CoGUID
	f.mu.Unlock()
	noteCompanyGUID(zz, b220CoGUID)
	noteStartPoint(zz, b220CoGUID, 90000, 500) // the company's starting point (FinComVoucherObject asks only a company with one)
	pullReset()
	t.Cleanup(pullReset)
	if _, err := findCompanyPort(zz, 0); err != nil { // the company list as the beat keeps it (asked before any test counts)
		t.Fatal(err)
	}
	m := &pullModel{held: map[string]int64{}, n: map[string]int{}, upload: map[string]M{}}
	c.mu.Lock()
	c.other = func(k string, b M) (int, M) {
		switch k {
		case "period_heads":
			m.heads = append(m.heads, b)
			d := str(b["day"])
			if truthy(b["upload"]) {
				m.upload[d] = b
				return 200, M{"ok": true}
			}
			m.n[d] = toInt(b["n"])
			want := []any{}
			for _, h := range arr(b["heads"]) {
				a := arr(h)
				if alt, ok := m.held[str(a[0])]; !ok || alt < toI64(a[2]) {
					want = append(want, a[1])
				}
			}
			return 200, M{"ok": true, "want": want}
		case "period_entries":
			m.entries = append(m.entries, b)
			for _, x := range arr(b["vouchers"]) {
				m.held[tagValue(str(x), "GUID")] = toI64(tagNum(str(x), "ALTERID"))
			}
			return 200, M{"ok": true}
		}
		return 200, M{"ok": true}
	}
	c.mu.Unlock()
	return f, c, m
}

func pullReset() {
	pull.mu.Lock()
	pull.items, pull.work = nil, nil
	pull.stopped, pull.upload, pull.done, pull.state, pull.said = map[int]string{}, map[string]M{}, map[string]bool{}, map[string]M{}, map[string]string{}
	pull.mu.Unlock()
}

// a day of the stand's Tally: n entries of each type, MasterIDs from mid
func pullDay(f *standTally, day string, mid int64, types ...string) []*tVch {
	var o []*tVch
	for i, typ := range types {
		v := r222Vch(f, mid+int64(i), typ, fmt.Sprint(mid+int64(i)), day, 5000+mid+int64(i))
		v.guid = fmt.Sprintf("%s-%08x", b220CoGUID, mid+int64(i))
		o = append(o, v)
	}
	return o
}

func pullList(days ...string) M {
	var l []any
	for _, d := range days {
		l = append(l, M{"company": zz, "company_guid": b220CoGUID, "day": d, "fetch": true})
	}
	return M{"periodDays": l}
}

// turns until nothing more goes (at most n)
func pullRun(t *testing.T, n int) {
	t.Helper()
	for i := 0; i < n; i++ {
		if pullTurn() == 0 {
			if w := pullCurrent(); w == nil {
				return
			}
			if pullTurn() == 0 {
				return
			}
		}
	}
}

func TestR245PullOneDayHeadsThenMissingEntries(t *testing.T) {
	f, _, m := pullBridge(t)
	vs := pullDay(f, "20250915", 700, "Sales", "Sales", "Receipt", "Payment", "Journal")
	pullDay(f, "20250916", 800, "Sales", "Sales")
	m.held[vs[0].guid] = vs[0].alter     // held as Tally has it
	m.held[vs[1].guid] = vs[1].alter - 1 // held at an older AlterID: asked again
	applyPeriodDays(pullList("20250915"))
	n0 := len(f.ids())
	pullRun(t, 20)
	ids := f.ids()[n0:]
	heads, objs := 0, 0
	for _, id := range ids {
		switch id {
		case dayHeadsID:
			heads++
		case vchObjectID:
			objs++
		case "TDSDeskCompanies":
		default:
			t.Fatalf("another request went to Tally: %s (%v)", id, ids)
		}
	}
	if heads != 1 || objs != 4 {
		t.Fatalf("%d heads, %d entries asked (want 1, 4): %v", heads, objs, ids)
	}
	if len(m.heads) != 1 || m.n["20250915"] != 5 || str(m.heads[0]["via"]) != "day" || len(arr(m.heads[0]["heads"])) != 5 {
		t.Fatalf("the heads told: %v", m.heads)
	}
	got := 0
	for _, e := range m.entries {
		for _, x := range arr(e["vouchers"]) {
			got++
			if normDate(tagValue(str(x), "DATE")) != "20250915" || !strings.Contains(str(x), "<ALLLEDGERENTRIES.LIST>") {
				t.Fatalf("an entry sent: %s", str(x))
			}
		}
		if str(e["day"]) != "20250915" || e["full"] != true {
			t.Fatalf("period_entries: %v", e)
		}
	}
	if got != 4 || len(m.held) != 5 {
		t.Fatalf("%d entries sent, FinCom holds %d", got, len(m.held))
	}
	// the day's turn is over; nothing more goes until the cloud lists a day again
	n1 := len(f.ids())
	pullRun(t, 3)
	if len(f.ids()) != n1 {
		t.Fatalf("asked again: %v", f.ids()[n1:])
	}
	// listed again (FinCom holds every entry now): the heads only, nothing fetched
	applyPeriodDays(pullList("20250915"))
	pullRun(t, 5)
	if f.n(vchObjectID) != objs || f.n(dayHeadsID) != 2 {
		t.Fatalf("a done day: %v", f.ids()[n1:])
	}
}

func TestR245PullCountingOnlyAndThreeDaysAnAnswer(t *testing.T) {
	f, _, m := pullBridge(t)
	pullDay(f, "20250401", 900, "Sales", "Receipt")
	l := pullList("20250401", "20250402", "20250403", "20250404", "20250405")
	for _, x := range arr(l["periodDays"]) {
		obj(x)["fetch"] = false
	}
	applyPeriodDays(l)
	pull.mu.Lock()
	n := len(pull.items)
	pull.mu.Unlock()
	if n != 3 {
		t.Fatalf("%d days taken from one answer, want 3", n)
	}
	pullRun(t, 20)
	if f.n(vchObjectID) != 0 || f.n(dayHeadsID) != 3 || len(m.heads) != 3 || m.n["20250401"] != 2 || m.n["20250402"] != 0 {
		t.Fatalf("counting: %v %v", f.ids(), m.n)
	}
}

// over 2 s: the late answer thrown away, the day asked one voucher type at a time; a type still over 2 s: the day marked
// "upload", told to FinCom, the one quiet line, never asked again
func TestR245PullSplitThenUpload(t *testing.T) {
	f, _, m := pullBridge(t)
	pullDay(f, "20250831", 1000, "Sales", "Sales", "Receipt", "Payment")
	var slowSales atomic.Bool
	f.mu.Lock()
	f.slow = func(id, body string) time.Duration {
		if id != dayHeadsID {
			return 0
		}
		if !strings.Contains(body, "$VoucherTypeName") || (slowSales.Load() && strings.Contains(body, "&#34;Sales&#34;")) {
			return 2500 * time.Millisecond
		}
		return 0
	}
	f.mu.Unlock()
	l := pullList("20250831")
	obj(arr(l["periodDays"])[0])["types"] = []any{"Sales", "Receipt", "Payment"}
	applyPeriodDays(l)
	step := func() {
		pullRun(t, 10)
		nowFn = func(t0 time.Time) func() time.Time { return func() time.Time { return t0 } }(nowFn().Add(10 * time.Minute)) // past the retry schedule
		retryReset()
		resetEarlier()
	}
	for i := 0; i < 6; i++ {
		step()
	}
	f.mu.Lock()
	var heads []string
	for i, id := range f.reqs {
		if id == dayHeadsID {
			heads = append(heads, pinQuoted(f.bodies[i], "$VoucherTypeName"))
		}
	}
	f.mu.Unlock()
	if len(heads) < 4 || heads[0] != "" || heads[1] != "Sales" || heads[2] != "Receipt" || heads[3] != "Payment" {
		t.Fatalf("the heads asked: %q", heads)
	}
	if len(m.heads) < 1 || str(m.heads[0]["via"]) != "split" || m.n["20250831"] != 4 {
		t.Fatalf("the split told: %v", m.heads)
	}
	// another day where Sales alone is still over 2 s
	pullDay(f, "20250830", 1100, "Sales", "Receipt")
	slowSales.Store(true)
	l = pullList("20250830")
	obj(arr(l["periodDays"])[0])["types"] = []any{"Sales", "Receipt"}
	applyPeriodDays(l)
	for i := 0; i < 6; i++ {
		step()
	}
	up := m.upload["20250830"]
	if up == nil || str(up["why"]) != "over2s" || str(up["type"]) != "Sales" || str(up["words"]) != "Tally took too long to give 30-Aug-2025. Please upload that day's Day Book." {
		t.Fatalf("the upload mark: %v", m.upload)
	}
	if _, told := m.n["20250830"]; told {
		t.Fatal("a day not read whole was counted")
	}
	ul := pullUploadList()
	if len(ul) != 1 || str(obj(ul[0])["words"]) != str(up["words"]) {
		t.Fatalf("the quiet line: %v", ul)
	}
	// the tray: one notice for that day, shown once (noticeGate), never an error
	ps := trayProblems(trayFacts{St: M{"tallyOpen": true, "online": true, "cloudConnected": true, "uploadDays": ul}, Up: time.Hour})
	found := 0
	for _, p := range ps {
		if strings.HasPrefix(p.Kind, "uploadday|") {
			found++
			if p.Text != str(up["words"]) || p.Day != "2025-08-30" || !p.Cond {
				t.Fatalf("the notice: %+v", p)
			}
		}
	}
	if found != 1 {
		t.Fatalf("%d upload notices", found)
	}
	// listed again by an older cloud: never asked again
	n := f.n(dayHeadsID)
	applyPeriodDays(l)
	step()
	if f.n(dayHeadsID) != n {
		t.Fatal("a day marked upload was asked again")
	}
}

// the date not applied: the whole answer dropped (nothing counted or fetched), the day marked "upload", and no single day
// asked of that Tally again until the bridge restarts
func TestR245PullDateNotAppliedStops(t *testing.T) {
	f, _, m := pullBridge(t)
	pullDay(f, "20250510", 1200, "Sales")
	pullDay(f, "20250511", 1300, "Sales")
	f.mu.Lock()
	f.headsAllDays = true
	f.mu.Unlock()
	applyPeriodDays(pullList("20250510", "20250511"))
	pullRun(t, 10)
	if f.n(dayHeadsID) != 1 || f.n(vchObjectID) != 0 || len(m.entries) != 0 || m.n["20250510"] != 0 {
		t.Fatalf("after a wrong date: %v %v", f.ids(), m.n)
	}
	if up := m.upload["20250510"]; up == nil || str(up["why"]) != "dates" {
		t.Fatalf("the mark: %v", m.upload)
	}
	if !strings.Contains(readText(logFile()), "the date was not applied") {
		t.Fatal("no log line names it")
	}
	applyPeriodDays(pullList("20250511"))
	pullRun(t, 5)
	if f.n(dayHeadsID) != 1 {
		t.Fatal("another day asked of the same Tally")
	}
}

// the six conditions: each one false and nothing is sent to Tally (nothing shown either)
func TestR245PullSixConditions(t *testing.T) {
	f, _, _ := pullBridge(t)
	pullDay(f, "20250701", 1400, "Sales", "Receipt")
	try := func(name string, set, unset func()) {
		t.Helper()
		applyPeriodDays(pullList("20250701"))
		set()
		openMu.Lock()
		runSeen = time.Time{} // tallyRunning's 5 s memory
		openMu.Unlock()
		n := len(f.ids())
		pullRun(t, 3)
		if got := f.ids()[n:]; len(got) != 0 {
			t.Fatalf("%s: sent %v", name, got)
		}
		unset()
		openMu.Lock()
		runSeen = time.Time{}
		openMu.Unlock()
		pullReset()
	}
	try("Tally not open", func() { tallyStandInClosed = true }, func() { tallyStandInClosed = false })
	try("paused", func() { pausedB = true }, func() { pausedB = false })
	try("reading stopped from FinCom", func() { setReadStop("fincom", "test") }, func() { clearReadStop("test") })
	try("a posting going", func() { importsInFlight.Add(1) }, func() { importsInFlight.Add(-1) })
	try("the retry schedule", func() { retryNote(f.port, "x", errRecorderStop) }, func() { retryReset() })
	try("Tally's window not answering", func() { tallyNotResponding.Store(true) }, func() { tallyNotResponding.Store(false) })
	try("someone saved in Tally a moment ago", func() {
		_ = os.WriteFile(filepath.Join(recorderDirFn(), b220CoGUID+".txt"), []byte("FCR1|ev=create\n"), 0o644)
		recorderWatchReset()
	}, func() {
		old := time.Now().Add(-10 * time.Minute)
		_ = os.Chtimes(filepath.Join(recorderDirFn(), b220CoGUID+".txt"), old, old)
		recorderWatchReset()
	})
	try("the company not open", func() {
		live.mu.Lock()
		liveFresh()
		live.own, live.ownCur = map[string]*liveOwnSt{}, map[string]bool{}
		live.mu.Unlock()
		_ = os.Remove(liveOwnTallyFile())
	}, func() { liveSeedOwnOpen(b220CoGUID, zz) })
	// all clear: it goes
	applyPeriodDays(pullList("20250701"))
	pullRun(t, 10)
	if f.n(dayHeadsID) != 1 {
		t.Fatalf("all clear: %v", f.ids())
	}
}

// postings first: a posting that starts during a day's fetch stops it before the next request
func TestR245PullPostingFirst(t *testing.T) {
	f, _, m := pullBridge(t)
	pullDay(f, "20250620", 1500, "Sales", "Sales", "Sales", "Sales", "Sales", "Sales")
	applyPeriodDays(pullList("20250620"))
	s1, _ := pullStep() // the heads
	_, _ = pullStep()   // told to FinCom
	s2, _ := pullStep() // one entry
	if !s1 || !s2 || f.n(vchObjectID) != 1 {
		t.Fatalf("the start: %v %v %v", s1, s2, f.ids())
	}
	importsInFlight.Add(1)
	n := len(f.ids())
	pullRun(t, 5)
	if got := f.ids()[n:]; len(got) != 0 {
		t.Fatalf("sent during a posting: %v", got)
	}
	importsInFlight.Add(-1)
	pullRun(t, 30)
	if f.n(vchObjectID) != 6 || len(m.held) != 6 {
		t.Fatalf("after the posting: %d asked, %d held", f.n(vchObjectID), len(m.held))
	}
}

// --- the ledger count and the step-5 progress: the count first (FinComLedgerIds, rows counted, CMPINFO's number never
// used), then "read of N" to FinCom after the chunks, never going back, the round's end the final count
func TestR245LedgerCountAndProgress(t *testing.T) {
	standTyped.Store(true) // Tally's CMPINFO counters in every answer, as a real TallyPrime writes them
	t.Cleanup(func() { standTyped.Store(false) })
	c := newStandCloud(t)
	var prog []M
	c.other = func(k string, b M) (int, M) {
		if k == "ledger_progress" {
			prog = append(prog, b)
		}
		return 200, M{"ok": true}
	}
	f := ledgerTally(t, 5000, c.cfg())
	noteCompanyGUID(zz, f.guid)
	// Update now reads the list as before: no count
	if err := newRun("now", "r0").step(zz, f.port, ""); err != nil {
		t.Fatal(err)
	}
	if f.n(ledIdsID) != 0 {
		t.Fatalf("Update now asked the count: %v", f.ids())
	}
	f.mu.Lock()
	f.reqs = nil
	f.mu.Unlock()
	c.mu.Lock()
	prog = nil
	c.mu.Unlock()
	ledProg.mu.Lock()
	ledProg.last, ledProg.sent = map[string]M{}, map[string]time.Time{}
	ledProg.mu.Unlock()
	// the ledgers-only read (Connect Tally step 5, the cloud's "ledgers" wake)
	if err := newRun("ledgers", "r1").step(zz, f.port, ""); err != nil {
		t.Fatal(err)
	}
	ids := f.ids()
	first := -1
	for i, id := range ids {
		if id == ledListID && first < 0 {
			first = i
		}
	}
	if f.n(ledIdsID) != 1 || first < 0 {
		t.Fatalf("the count: %v", ids)
	}
	for i, id := range ids {
		if id == ledIdsID && i > first {
			t.Fatal("the count asked after the read began")
		}
	}
	c.mu.Lock()
	ps := append([]M{}, prog...)
	c.mu.Unlock()
	if len(ps) < 2 {
		t.Fatalf("progress sent: %v", ps)
	}
	last := ps[len(ps)-1]
	if toInt(last["read"]) != 5000 || toInt(last["of"]) != 5000 || last["done"] != true || str(last["company_guid"]) != f.guid {
		t.Fatalf("the end: %v", last)
	}
	prev := 0
	for _, p := range ps {
		if toInt(p["of"]) != 5000 || toInt(p["read"]) < prev {
			t.Fatalf("progress %v (before %d)", p, prev)
		}
		prev = toInt(p["read"])
	}
	if b := ledProgressBeat(); len(b) != 1 || toInt(obj(b[0])["of"]) != 5000 {
		t.Fatalf("the beat: %v", b)
	}
}

// the count stopped at 2 s: the same id 2,000 MasterIDs a request; a chunk stopped too: no count this round, nothing shown
func TestR245LedgerCountChunkedWhenStopped(t *testing.T) {
	f := ledgerTally(t, 4500, "")
	noteCompanyGUID(zz, f.guid)
	if _, err := companyCheck(fin, zz, f.port); err != nil {
		t.Fatal(err)
	}
	f.mu.Lock()
	f.slow = func(id, body string) time.Duration {
		if id == ledIdsID && !strings.Contains(body, "&lt;=") && strings.Contains(body, "$MasterID &gt; 0<") {
			return 2500 * time.Millisecond
		}
		return 0
	}
	f.mu.Unlock()
	ls := M{}
	ledCountFor(zz, f.port, ls, func() {})
	retryReset()
	resetEarlier()
	ledCountFor(zz, f.port, ls, func() {})
	if toInt(ls["of"]) != 4500 || !truthy(ls["countChunked"]) {
		t.Fatalf("chunked count: %v (%v)", ls, f.ids())
	}
	f.mu.Lock()
	var rs []string
	for i, id := range f.reqs {
		if id == ledIdsID {
			m := reMidRange.FindStringSubmatch(f.bodies[i])
			rs = append(rs, m[1]+"-"+m[2])
		}
	}
	f.mu.Unlock()
	for _, r := range rs[1:] {
		a, b, _ := strings.Cut(r, "-")
		if b != "" && toI64(b)-toI64(a) > 2000 {
			t.Fatalf("a chunk over 2,000: %v", rs)
		}
	}
}

// 2.4.5's state between tests (standBridge)
func r245Reset() {
	pullReset()
	ledProg.mu.Lock()
	ledProg.last, ledProg.sent = map[string]M{}, map[string]time.Time{}
	ledProg.mu.Unlock()
	iniSt.mu.Lock()
	iniSt.files, iniSt.seen = map[string]M{}, time.Time{}
	iniSt.mu.Unlock()
}
