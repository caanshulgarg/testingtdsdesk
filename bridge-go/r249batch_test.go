package main

// Bridge 2.4.9 (the owner's approval of 29-Oct-2026, docs/bridge-2.4.9-forms-for-owner.md section 9): FinComVoucherBatch,
// up to 100 older entries of one day in one request (batch249.go). Written before the code they test.

import (
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"testing"
	"time"
)

func batchTD(t *testing.T, name string) string {
	t.Helper()
	b, err := os.ReadFile(filepath.Join("testdata", "batch249", name))
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

func midList(from, n int64) []string {
	o := []string{}
	for i := int64(0); i < n; i++ {
		o = append(o, fmt.Sprint(from+i))
	}
	return o
}

// 1. the request is byte for byte the one measured and approved (run 40750991113's capture, the same on 3.0 .. 7.1)
func TestR249RequestAsApproved(t *testing.T) {
	if got, want := voucherBatchRangeRequest("@@CO@@", "20991231", 111111, 222222), batchTD(t, "b4-range.xml"); got != want {
		t.Fatalf("the range form is not the approved request:\n%s\nwant\n%s", got, want)
	}
	mids := []string{"15", "17", "20"}
	want := strings.Replace(batchTD(t, "b4-list.xml"), "@@MIDS@@", "$MasterID = 15 OR $MasterID = 17 OR $MasterID = 20", 1)
	if got := voucherBatchListRequest("@@CO@@", "20991231", mids); got != want {
		t.Fatalf("the list form is not the approved request:\n%s\nwant\n%s", got, want)
	}
	// the company escaped as every request escapes it; FETCH: FinComVoucherObject's kept fields, then the ledger lines
	// once more under LEDGERENTRIES; no other field
	x := voucherBatchRangeRequest("A & B <Co>", "20260831", 5, 9)
	if !strings.Contains(x, "<SVCURRENTCOMPANY>A &amp; B &lt;Co&gt;</SVCURRENTCOMPANY>") || !strings.Contains(x, `<SVFROMDATE TYPE="Date">20260831</SVFROMDATE><SVTODATE TYPE="Date">20260831</SVTODATE>`) {
		t.Fatalf("company or day: %s", x)
	}
	fs := batchFetchFields()
	allowed := fastApprovedPaths()
	for _, f := range batchPayrollFields {
		allowed[f] = true
	}
	for _, f := range fs {
		g := f
		if strings.HasPrefix(f, "LEDGERENTRIES.") {
			g = "ALL" + f
		}
		if !allowed[g] {
			t.Errorf("a field FinComVoucherObject does not keep: %s", f)
		}
	}
	if len(fs) != 174 {
		t.Errorf("%d fields, measured with 174", len(fs))
	}
	// refused: no day, b below a, no MasterID, more than 100 listed, a MasterID twice or with a leading zero
	for _, bad := range []string{voucherBatchRangeRequest("C", "2026083", 1, 2), voucherBatchRangeRequest("C", "20260831", 9, 5), voucherBatchRangeRequest("C", "20260831", 0, 5),
		voucherBatchListRequest("C", "20260831", nil), voucherBatchListRequest("C", "20260831", midList(1, 101)), voucherBatchListRequest("C", "20260831", []string{"5", "5"}),
		voucherBatchListRequest("C", "20260831", []string{"05"}), voucherBatchListRequest("C", "20260831", []string{"5 OR 1=1"})} {
		if bad != "" {
			t.Errorf("built: %s", bad)
		}
	}
	if voucherBatchListRequest("C", "20260831", midList(1, 100)) == "" {
		t.Error("100 MasterIDs refused")
	}
}

// 2. pinned to its builder: only exactly the built request goes; any change is refused before anything is sent
func TestR249PinnedAndGuarded(t *testing.T) {
	x := voucherBatchRangeRequest("ZZ CO", "20260831", 100, 199)
	l := voucherBatchListRequest("ZZ CO", "20260831", []string{"100", "150", "199"})
	for _, ok := range []string{x, l} {
		if err := checkAllowed(ok); err != nil {
			t.Fatalf("refused: %v", err)
		}
	}
	for _, bad := range []string{
		strings.Replace(x, "</FETCH>", ", ADDRESS</FETCH>", 1),
		strings.Replace(x, `<SVTODATE TYPE="Date">20260831`, `<SVTODATE TYPE="Date">20260930`, 1),
		strings.Replace(x, "$MasterID &gt;= 100", "$MasterID &gt; 100", 1),
		strings.Replace(l, "$MasterID = 150", "$MasterID = 150 OR $AlterID = 1", 1),
		strings.Replace(x, `<SVFROMDATE TYPE="Date">20260831</SVFROMDATE><SVTODATE TYPE="Date">20260831</SVTODATE>`, "", 1),
		strings.Replace(voucherBatchListRequest("ZZ CO", "20260831", midList(1, 100)), "$MasterID = 100<", "$MasterID = 100 OR $MasterID = 101<", 1),
	} {
		if checkAllowed(bad) == nil {
			t.Errorf("allowed: %s", cut(bad, 400))
		}
	}
	// the dated guard: only the group being asked now, under the 2 s stop, for a company with a starting point (the
	// bridge's own folders in a temporary place)
	liveBridge(t, "")
	pullReset()
	t.Cleanup(pullReset)
	noteStartPoint("ZZ CO", "guid-zz", 1, 1)
	tc := recorderTC(nil)
	if datedRefused(tc, x) == nil {
		t.Fatal("a group not being asked went")
	}
	pull.mu.Lock()
	pull.batchAsk = x
	pull.mu.Unlock()
	if err := datedRefused(tc, x); err != nil {
		t.Fatalf("the group being asked refused: %v", err)
	}
	if datedRefused(tc, l) == nil {
		t.Fatal("another group went")
	}
	slow := recorderTC(nil)
	slow.limitMs = 5000
	if datedRefused(slow, x) == nil {
		t.Fatal("went without the 2 s stop")
	}
	if datedRefused(nil, x) == nil {
		t.Fatal("went without a stop")
	}
}

// 3. the converter (the owner's point 3) on real TallyPrime answers: every entry, put through batchConvert and
// FinComVoucherObject's strip, keeps exactly what FinComVoucherObject's answer keeps (a REMOTEID equal to the GUID aside)
func TestR249ConverterMatchesObjectOnRealAnswers(t *testing.T) {
	reRemote := regexp.MustCompile(` REMOTEID="[^"]*"`)
	for _, rel := range []string{"7.1", "3.0"} {
		files, _ := filepath.Glob(filepath.Join("testdata", "batch249", rel, "batch-*.xml"))
		n, items := 0, 0
		for _, f := range files {
			raw, _ := os.ReadFile(f)
			for _, b := range reVchBlock.FindAllString(reCmpInfo.ReplaceAllString(textFromBytes(raw), ""), -1) {
				c := cleanXML(b)
				mid := strings.TrimLeft(tagNum(c, "MASTERID"), "0")
				got, why := fastStripWhy(batchConvert(c))
				if why != "" || got == "" {
					t.Fatalf("%s MasterID %s held: %s", rel, mid, why)
				}
				ob, err := os.ReadFile(filepath.Join("testdata", "batch249", rel, "obj-"+mid+".xml"))
				if err != nil {
					t.Fatal(err)
				}
				var want string
				for _, ov := range reVchBlock.FindAllString(textFromBytes(ob), -1) {
					want, why = fastStripWhy(cleanXML(ov))
				}
				if why != "" || want == "" {
					t.Fatalf("%s MasterID %s: the object answer held: %s", rel, mid, why)
				}
				if rg := regexp.MustCompile(`REMOTEID="([^"]*)"`).FindStringSubmatch(got); rg != nil && rg[1] != tagValue(got, "GUID") {
					t.Fatalf("a REMOTEID other than the GUID: %s", rg[1])
				}
				if reRemote.ReplaceAllString(got, "") != reRemote.ReplaceAllString(want, "") {
					t.Errorf("%s MasterID %s differs:\nbatch  %s\nobject %s", rel, mid, cut(got, 3000), cut(want, 3000))
				}
				if strings.Contains(c, "<STOCKITEMNAME") {
					items++
					// without the rule the collection's ALLLEDGERENTRIES (the items' sales ledger among them, with the items under
					// it) would be held, or counted twice in FinCom
					raw2, why2 := fastStripWhy(reBatchLed.ReplaceAllString(reBatchExtra.ReplaceAllString(c, ""), ""))
					if why2 == "" && strings.Count(raw2, "<ALLLEDGERENTRIES.LIST>") <= strings.Count(want, "<ALLLEDGERENTRIES.LIST>") {
						t.Errorf("%s MasterID %s: the collection's ALLLEDGERENTRIES alone is kept whole (the rule untested)", rel, mid)
					}
				}
				n++
			}
		}
		if n < 8 || items < 1 {
			t.Fatalf("%s: %d entries, %d with items", rel, n, items)
		}
	}
}

// 4. the group: a run of the day's heads is the range form; scattered wanted entries the list form; payroll left out;
// at most n (100)
func TestR249Group(t *testing.T) {
	heads := map[string]pullHead{}
	for _, m := range midList(10, 20) {
		heads[m] = pullHead{Mid: m, Type: "Sales"}
	}
	heads["15"] = pullHead{Mid: "15", Type: "Payroll"}
	pay := func(m string) bool { return heads[m].Type == "Payroll" }
	g, run := batchGroup([]string{"12", "11", "13"}, heads, 100, pay)
	if !run || strings.Join(g, ",") != "11,12,13" {
		t.Fatalf("a run: %v %v", g, run)
	}
	g, run = batchGroup([]string{"12", "14", "16"}, heads, 100, pay)
	if run || strings.Join(g, ",") != "12,14,16" {
		t.Fatalf("scattered: %v %v", g, run)
	}
	g, run = batchGroup([]string{"14", "15", "16"}, heads, 100, pay)
	if run || strings.Join(g, ",") != "14,16" {
		t.Fatalf("payroll: %v %v (15 is a head between them: the list form)", g, run)
	}
	g, _ = batchGroup(midList(10, 20), heads, 4, pay)
	if len(g) != 4 {
		t.Fatalf("n: %v", g)
	}
	g, _ = batchGroup(midList(10, 20), heads, 500, pay)
	if len(g) > batchMaxN {
		t.Fatal("more than 100")
	}
	if g, _ := batchGroup([]string{"15"}, heads, 100, pay); len(g) != 0 {
		t.Fatalf("payroll alone: %v", g)
	}
}

func batchBodies(f *standTally) []string {
	f.mu.Lock()
	defer f.mu.Unlock()
	var o []string
	for i, id := range f.reqs {
		if id == vchBatchID {
			o = append(o, f.bodies[i])
		}
	}
	return o
}

// 5. a day: its heads, then the wanted entries in one FinComVoucherBatch, nothing one by one; FinCom gets each entry as
// FinComVoucherObject would have given it
func TestR249PullDayInOneGroup(t *testing.T) {
	f, _, m := pullBridgeWith(t, "")
	vs := pullDay(f, "20250915", 700, "Sales", "Sales", "Receipt", "Payment", "Journal", "Contra", "Sales")
	pullDay(f, "20250916", 800, "Sales")
	m.held[vs[0].guid] = vs[0].alter
	applyPeriodDays(pullList("20250915"))
	pullRun(t, 20)
	bs := batchBodies(f)
	if f.n(dayHeadsID) != 1 || len(bs) != 1 || f.n(vchObjectID) != 0 {
		t.Fatalf("heads %d, groups %d, one by one %d: %v", f.n(dayHeadsID), len(bs), f.n(vchObjectID), f.ids())
	}
	if !strings.Contains(bs[0], "$MasterID &gt;= 701 AND $MasterID &lt;= 706") {
		t.Fatalf("the group: %s", cut(bs[0], 300))
	}
	sent := map[string]string{}
	for _, e := range m.entries {
		for _, x := range arr(e["vouchers"]) {
			sent[tagNum(str(x), "MASTERID")] = str(x)
		}
	}
	if len(sent) != 6 {
		t.Fatalf("%d entries sent", len(sent))
	}
	for _, v := range vs[1:] {
		want := fastStripVoucher(cleanXML(v.xml()))
		if sent[v.master] != want {
			t.Fatalf("MasterID %s sent as\n%s\nnot as FinComVoucherObject gives it\n%s", v.master, sent[v.master], want)
		}
	}
}

// 6. scattered wanted entries: the list form; more than 100: groups of 100; payroll entries never in a group
func TestR249PullListFormGroupsOf100AndPayroll(t *testing.T) {
	f, _, m := pullBridgeWith(t, "")
	types := make([]string, 0, 230)
	for i := 0; i < 230; i++ {
		types = append(types, "Sales")
	}
	types[3] = "Payroll"
	vs := pullDay(f, "20250915", 1000, types...)
	for i, v := range vs {
		if i%2 == 1 && i < 20 {
			m.held[v.guid] = v.alter // FinCom holds these: the first 20 wanted are scattered
		}
	}
	applyPeriodDays(pullList("20250915"))
	pullRun(t, 60)
	bs := batchBodies(f)
	total, lists := 0, 0
	for _, b := range bs {
		n := len(reBatchMid.FindAllString(b, -1))
		if r := reBatchRange.FindStringSubmatch(b); r != nil {
			n = 0
			for _, v := range vs {
				if mv := toI64(v.master); mv >= toI64(r[1]) && mv <= toI64(r[2]) {
					n++
				}
			}
		} else {
			lists++
		}
		if n > 100 || n < 2 {
			t.Fatalf("a group of %d", n)
		}
		if strings.Contains(b, vs[3].master+" ") || strings.Contains(b, "= "+vs[3].master+"<") || strings.Contains(b, "= "+vs[3].master+" OR") {
			t.Fatal("the payroll entry asked in a group")
		}
		total += n
	}
	if lists < 1 || len(bs) < 3 {
		t.Fatalf("%d groups, %d lists", len(bs), lists)
	}
	held := 0
	for _, v := range vs {
		if _, ok := m.held[v.guid]; ok {
			held++
		}
	}
	// every entry but the payroll's (which waits for the employees, as in 2.4.5) is in FinCom
	if held < len(vs)-1 {
		t.Fatalf("FinCom holds %d of %d", held, len(vs))
	}
}

// 7. the slow-group rule (the owner's point 4): a group stopped at 2 s asked again in halves; a half also stopped: the
// day one by one; nothing stopped the company (Tally's window answered)
func TestR249PullSlowGroupHalvesThenOneByOne(t *testing.T) {
	f, c, m := pullBridgeWith(t, `,"TallyAbandonMaxSec":600`)
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
	types := make([]string, 120)
	for i := range types {
		types[i] = "Sales"
	}
	vs := pullDay(f, "20250915", 1000, types...)
	f.mu.Lock()
	f.slow = func(id, body string) time.Duration {
		if id == vchBatchID {
			return 2300 * time.Millisecond
		}
		return 0
	}
	f.mu.Unlock()
	applyPeriodDays(pullList("20250915"))
	at := nowFn()
	for i := 0; i < 60 && len(m.held) < len(vs); i++ { // the shared retry schedule waits after a stop: time moves on
		pullRun(t, 200)
		at = at.Add(time.Minute)
		nowFn = func() time.Time { return at }
		applyPeriodDays(pullList("20250915"))
	}
	r3Settle()
	bs := batchBodies(f)
	if len(bs) != 2 {
		t.Fatalf("%d groups asked (want the first of 100 and one of 50)", len(bs))
	}
	if r := reBatchRange.FindStringSubmatch(bs[1]); r == nil || toI64(r[2])-toI64(r[1])+1 != 50 {
		t.Fatalf("the second group: %s", cut(bs[1], 200))
	}
	if f.n(vchObjectID) != len(vs) || len(stops) != 0 {
		t.Fatalf("one by one %d (want %d), company stopped %v", f.n(vchObjectID), len(vs), stops)
	}
	if len(m.held) != len(vs) {
		t.Fatalf("FinCom holds %d", len(m.held))
	}
}

// Tally's window held 2 s during a group: the company's period stops (the 2.4.5 freeze safety)
func TestR249PullGroupWindowHoldStopsCompany(t *testing.T) {
	f, c, _ := pullBridgeWith(t, "")
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
	pullDay(f, "20250915", 1000, "Sales", "Sales", "Sales")
	old := windowHoldFn
	var heads bool
	windowHoldFn = func() func(time.Time) int {
		return func(time.Time) int {
			if !heads {
				heads = true
				return 0 // the day's list
			}
			return 2200
		}
	}
	t.Cleanup(func() { windowHoldFn = old })
	applyPeriodDays(pullList("20250915"))
	pullRun(t, 10)
	if len(batchBodies(f)) != 1 || f.n(vchObjectID) != 0 || len(stops) != 1 || str(stops[0]["why"]) != "window" {
		t.Fatalf("groups %d, one by one %d, stops %v", len(batchBodies(f)), f.n(vchObjectID), stops)
	}
}

// an answer that is not exactly the entries asked: not used, the day one by one
func TestR249PullInexactAnswerOneByOne(t *testing.T) {
	f, _, m := pullBridgeWith(t, "")
	vs := pullDay(f, "20250915", 1000, "Sales", "Sales", "Sales", "Sales")
	m.held[vs[1].guid] = vs[1].alter // FinCom holds the second: the list form, Tally answers every entry of the day
	f.mu.Lock()
	f.batchAll = true
	f.mu.Unlock()
	applyPeriodDays(pullList("20250915"))
	pullRun(t, 20)
	if len(batchBodies(f)) != 1 || f.n(vchObjectID) != 3 || len(m.entries) == 0 {
		t.Fatalf("groups %d, one by one %d", len(batchBodies(f)), f.n(vchObjectID))
	}
	var got []string
	for _, e := range m.entries {
		for _, x := range arr(e["vouchers"]) {
			got = append(got, tagNum(str(x), "MASTERID"))
		}
	}
	sort.Strings(got)
	if strings.Join(got, ",") != "1000,1002,1003" {
		t.Fatalf("sent %v", got)
	}
}

// the setting DayPullBatchMax 1: one by one, as 2.4.8
func TestR249PullSettingOff(t *testing.T) {
	_, f, _ := liveBridge(t, `,"DayPullGapMs":0,"KeepRestMs":1,"DayPullBatchMax":1`)
	_ = f
	if pullBatchMax() != 1 {
		t.Fatalf("DayPullBatchMax %d", pullBatchMax())
	}
	w := &pullWork{it: pullItem{Company: zz, Day: "20250915"}, heads: map[string]pullHead{"1": {Mid: "1"}, "2": {Mid: "2"}}, want: []string{"1", "2"}}
	if handled, _, _ := pullBatchStep(w, 0); handled {
		t.Fatal("a group asked with DayPullBatchMax 1")
	}
}

// the allow-list's rows without 2.4.9's FinComVoucherBatch: 2.4.5's table (2.4.6 .. 2.4.8 added or changed no request)
func allowRowsBefore249() string {
	var o []string
	for _, l := range strings.SplitAfter(allowRowsBefore250(), "\n") { // 2.5.0 changed four rows (r250dated_test.go)
		if !strings.HasPrefix(l, "| "+vchBatchID+" |") {
			o = append(o, l)
		}
	}
	return strings.Join(o, "")
}

// 2.4.9: the version; one request added (FinComVoucherBatch: the table changed by that row only); the decision line names
// 2.4.9 by the owner's decision of 2026-10-29 with the measured times, 2.4.8's kept as history; the dated line; the sheet
func TestR249VersionAllowList(t *testing.T) {
	if BridgeVersion != "2.5.2" { // 2.5.2 (stock251_test.go); 2.5.0 (r250dated_test.go): kept as history
		t.Fatalf("BridgeVersion %s", BridgeVersion)
	}
	if h := allowListHash(allowRowsBefore249()); h != "b4df290484f57e3cba053d16cc29f68209eda6a1f087c3c4a1616e69886e9391" {
		t.Fatalf("a row other than FinComVoucherBatch changed (%s)", h)
	}
	a := tallyAllowList[vchBatchID]
	if a.maxSec != 1.41 || !strings.HasPrefix(a.measuredOn, "2026-10-28 (real TallyPrime 3.0, 4.1, 5.1, 6.2, 7.1; tally-versions mode batch, run 40750991113") || a.measureOnly {
		t.Fatalf("the row: %+v", a)
	}
	al := readText(filepath.Join("..", "docs", "tally-allowlist.md"))
	line := group(`(?m)^(First table: .*)$`, al, 1)
	for _, w := range []string{"as for 2.4.9: the owner's decision of 2026-10-29", "FinComVoucherBatch (shape " + shapeOf(allowListSamples()[vchBatchID]) + ")",
		"0.95 s worst", "1.41 s", "as for 2.4.8: the owner's standing decision of 2026-10-06"} {
		if !strings.Contains(line, w) {
			t.Errorf("the decision line does not say %q", w)
		}
	}
	if strings.Contains(al, "allowed for 2.4.8 by") {
		t.Error("2.4.8's decision still worded as the current one")
	}
	if !regexp.MustCompile(`re-measured on 2026-10-29 for 2\.4\.9: FinComVoucherBatch[^\n]*2\.4\.9 allowed by the owner's decision of 2026-10-29`).MatchString(al) {
		t.Error("no dated line for 2.4.9")
	}
	sheet := readText(filepath.Join("..", "docs", "bridge-2.4.9-test-sheet.txt"))
	for _, w := range []string{"2.4.9", "FinComVoucherBatch", "100 entries", "one by one", "upgrade from 2.4.8"} {
		if !strings.Contains(sheet, w) {
			t.Errorf("the test sheet does not say %q", w)
		}
	}
}

// a payroll entry in a day read in groups: never in a group; it goes one by one through the payroll path (employees
// first, its 3 s), the day's other entries in one group
func TestR249PullPayrollOneByOneOthersInAGroup(t *testing.T) {
	f, _, m := pullBridgeWith(t, "")
	payEmployees(t, f)
	payDay(t, f)
	applyPeriodDays(pullList("20250930"))
	pullRun(t, 30)
	bs := batchBodies(f)
	f.mu.Lock()
	var objs []string
	for i, id := range f.reqs {
		if id == vchObjectID {
			objs = append(objs, group(`<ID TYPE="Name">ID:(\d+)</ID>`, f.bodies[i], 1))
		}
	}
	f.mu.Unlock()
	if len(bs) != 1 || strings.Join(objs, ",") != "7" {
		t.Fatalf("groups %d, one by one %v", len(bs), objs)
	}
	if strings.Contains(bs[0], "= 7 ") || strings.Contains(bs[0], "= 7<") || reBatchRange.MatchString(bs[0]) && strings.Contains(bs[0], "&gt;= 5 AND $MasterID &lt;= 900") {
		t.Fatalf("the payroll entry in a group: %s", cut(bs[0], 300))
	}
	if got := sentEntries(m); len(got) != 3 || !strings.Contains(got["7"], "<VOUCHERTYPENAME>Payroll</VOUCHERTYPENAME>") {
		t.Fatalf("%d entries sent", len(got))
	}
}

// 2.4.9's gate (bdiff run 40800355969, TallyPrime 3.0, the tdsgst and payroll companies): what a group gives otherwise
// than FinComVoucherObject is never taken from it. An "On Account" bill allocation Tally adds: one by one. A line with a
// GST nature and no type of supply (3.0 .. 6.2): one by one, whatever was read before (review 249 round 2 H1 / M1 / M2:
// nothing learned from one entry is carried to another). Salary payments: taken from the group, identical
func TestR249GroupLeavesWhatItGivesOtherwise(t *testing.T) {
	liveBridge(t, "") // the bridge's folders (and its log) in a temporary place: payroll learning may write a line
	reRemote := regexp.MustCompile(` REMOTEID="[^"]*"`)
	load := func(dir string, files ...string) map[string]string {
		o := map[string]string{}
		for _, f := range files {
			raw, err := os.ReadFile(filepath.Join(dir, f))
			if err != nil {
				t.Fatal(err)
			}
			for _, b := range reVchBlock.FindAllString(reCmpInfo.ReplaceAllString(textFromBytes(raw), ""), -1) {
				c := cleanXML(b)
				o[strings.TrimLeft(tagNum(c, "MASTERID"), "0")] = c
			}
		}
		return o
	}
	obj := func(dir, mid string) string {
		ob, _ := os.ReadFile(filepath.Join(dir, "obj-"+mid+".xml"))
		var o string
		for _, ov := range reVchBlock.FindAllString(textFromBytes(ob), -1) {
			o, _ = fastStripWhy(cleanXML(ov))
		}
		return o
	}
	same := func(dir, mid, c string) {
		got, leave := batchEntry("BDIFF CO", c)
		if leave != "" || reRemote.ReplaceAllString(got, "") != reRemote.ReplaceAllString(obj(dir, mid), "") {
			t.Errorf("MasterID %s taken from a group differs (%s)", mid, leave)
		}
	}
	td := filepath.Join("testdata", "batch249", "3.0-bdiff")
	e := load(td, "B5-20260501-2.xml", "B4-20260401-1.xml", "B4-20260602-39.xml")
	if _, leave := batchEntry("BDIFF CO", e["1"]); !strings.Contains(leave, "On Account") {
		t.Fatalf("the journal with Tally's own On Account allocation: %q", leave)
	}
	for _, mid := range []string{"46", "48"} { // salary payments: identical
		same(td, mid, e[mid])
	}
	for _, mid := range []string{"2", "39"} { // "Sales Goods 18%": no type of supply in the group, "Goods" in the object
		if _, leave := batchEntry("BDIFF CO", e[mid]); !strings.Contains(leave, "sales goods 18%") {
			t.Fatalf("MasterID %s: %q", mid, leave)
		}
	}
	// a line with the tag left out (not only empty) is left too (round 2 M3)
	if _, leave := batchEntry("BDIFF CO", strings.Replace(e["2"], "<GSTOVRDNTYPEOFSUPPLY></GSTOVRDNTYPEOFSUPPLY>", "", -1)); leave == "" {
		t.Fatal("a GST line without the type-of-supply tag taken")
	}
	// ZZ BIG TEST on 3.0: an entry with a GST line is left; every entry taken is identical
	zd := filepath.Join("testdata", "batch249", "3.0")
	left, taken := 0, 0
	for mid, c := range load(zd, "batch-20260831-w5.xml", "batch-20260801-w6.xml") {
		if _, leave := batchEntry("ZZ BIG", c); leave != "" {
			left++
			continue
		}
		taken++
		same(zd, mid, c)
	}
	if left == 0 || taken == 0 {
		t.Fatalf("3.0 ZZ BIG TEST: %d left, %d taken", left, taken)
	}
	// 7.1 gives the type of supply in a group: nothing left for it
	for mid, c := range load(filepath.Join("testdata", "batch249", "7.1"), "batch-20260831-w5.xml", "batch-20260801-w6.xml") {
		if k, always := batchTOSLines(batchConvert(c)); len(k) != 0 || always != "" {
			t.Fatalf("7.1 %s: %v %q", mid, k, always)
		}
	}
}

// in the period fetch: entries with a GST line and no type of supply are read one by one; the others of the day come
// in the group; FinCom gets all, as FinComVoucherObject gives them
func TestR249PullGSTLineWithoutTypeOneByOne(t *testing.T) {
	f, _, m := pullBridgeWith(t, "")
	vs := pullDay(f, "20250915", 2000, "Sales", "Sales", "Sales", "Sales", "Receipt", "Receipt")
	f.mu.Lock()
	for _, v := range vs[:4] {
		v.extra = `<ALLLEDGERENTRIES.LIST><LEDGERNAME>Sales GST</LEDGERNAME><AMOUNT>5.00</AMOUNT><GSTOVRDNNATURE>Sales Taxable</GSTOVRDNNATURE><GSTOVRDNTYPEOFSUPPLY></GSTOVRDNTYPEOFSUPPLY></ALLLEDGERENTRIES.LIST>`
	}
	f.mu.Unlock()
	applyPeriodDays(pullList("20250915"))
	pullRun(t, 40)
	if len(batchBodies(f)) != 1 || f.n(vchObjectID) != 4 || len(sentEntries(m)) != 6 {
		t.Fatalf("groups %d, one by one %d, sent %d", len(batchBodies(f)), f.n(vchObjectID), len(sentEntries(m)))
	}
}
