package main

// Bridge 2.2.0, the owner's additions: A. the dates of a Voucher COLLECTION tried in the read test (a past-year month
// must answer exactly its entries; the first form that does is kept per company and Tally); C. one Edit Log probe in the
// read test; B. source C (month slices) using the kept form; the 2 s switch-off on every method. Tests first.

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// a copy holding a past-year month (3 entries) and Tally holding those plus others (a month before it, this month)
func pastYearSetup(t *testing.T, f *standTally) (ym string) {
	t.Helper()
	ym = nowFn().AddDate(0, -14, 0).Format("200601")
	dir := syncFolder(zz)
	for i, d := range []string{ym + "03", ym + "11", ym + "20"} {
		v := f.add(d, fgParty, fmt.Sprint("PY-", i), "past year", "-1.00")
		writeDayFile(dir, d, "<ENVELOPE>"+v.xml()+"</ENVELOPE>", true)
	}
	prev := fromTallyDate(ym+"01").AddDate(0, -1, 0).Format("200601")
	f.add(prev+"15", fgParty, "PY-P", "the month before", "-1.00")
	f.add(today(), fgParty, "NOW-1", "this month", "-1.00")
	return ym
}

func dash(ym string) string { return ym[:4] + "-" + ym[4:] }

func TestReadTestDatesCollectionForms(t *testing.T) {
	f := newStandTally(t)
	standBridge(t, f, "")
	liveFrom(today())
	ym := pastYearSetup(t, f)
	if _, err := runReadTest(zz); err != nil {
		t.Fatal(err)
	}
	if logLines("Dates (collection) form yyyymmdd: 3 entries for "+dash(ym)+", ") != 1 || logLines("form yyyymmdd: 3 entries for "+dash(ym)) != 1 {
		t.Fatalf("the plain form: %s", readText(logFile()))
	}
	if !strings.Contains(readText(logFile()), "Dates (collection) form yyyymmdd: 3 entries for "+dash(ym)) || logLines(", applied: yes") != 1 {
		t.Fatal("one form applied")
	}
	for _, fm := range collForms {
		if logLines("Dates (collection) form "+fm+": ") != 1 {
			t.Errorf("no line for the form %s", fm)
		}
	}
	if dateFormFor(zz) != formPlain {
		t.Fatalf("kept: %q", dateFormFor(zz))
	}
	if n := f.n(datesProbeID); n != len(collForms) {
		t.Fatalf("probes: %d", n)
	}
}

func TestReadTestDatesFilterFormWins(t *testing.T) {
	f := newStandTally(t)
	f.svIgnored, f.filterDates = true, true // a Tally that ignores SVFROMDATE/SVTODATE but applies a TDL filter
	standBridge(t, f, "")
	liveFrom(today())
	ym := pastYearSetup(t, f)
	if _, err := runReadTest(zz); err != nil {
		t.Fatal(err)
	}
	if logLines("Dates (collection) form yyyymmdd: 5 entries for "+dash(ym)) != 1 {
		t.Fatalf("the ignored form: %s", readText(logFile()))
	}
	if logLines("Dates (collection) form "+collFilterGE+": 3 entries for "+dash(ym)) != 1 || logLines(", applied: yes") != 1 {
		t.Fatalf("the filter form: %s", readText(logFile()))
	}
	if dateFormFor(zz) != collFilterGE {
		t.Fatalf("kept: %q", dateFormFor(zz))
	}
	// the filter form's request: dates as TDL literals, no figure Tally works out
	for _, b := range f.bodiesOf(datesProbeID) {
		if m := computedFigure(b); m != "" {
			t.Fatalf("a computed figure: %q", m)
		}
	}
}

func TestReadTestNoPastYearDay(t *testing.T) {
	f := newStandTally(t)
	standBridge(t, f, "")
	liveFrom(today())
	f.add(today(), fgParty, "N-1", "now", "-1.00")
	if _, err := runReadTest(zz); err != nil {
		t.Fatal(err)
	}
	if logLines("Dates (collection): the copy holds no day of a past year; the collection forms are not tried") != 1 || f.n(datesProbeID) != 0 || dateFormFor(zz) != "" {
		t.Fatal("tried without a past-year anchor")
	}
}

func TestReadTestEditLogProbe(t *testing.T) {
	f := newStandTally(t)
	standBridge(t, f, "")
	liveFrom(today())
	f.add(today(), fgParty, "E-1", "one", "-1.00")
	v := f.add(today(), fgParty, "E-2", "two", "-1.00")
	if _, err := runReadTest(zz); err != nil {
		t.Fatal(err)
	}
	bs := f.bodiesOf(editLogProbeID)
	if len(bs) != 1 || !strings.Contains(bs[0], "$MasterID = "+v.master) {
		t.Fatalf("the probe: %v", bs)
	}
	if logLines(fmt.Sprintf("Edit Log probe (%s, MasterID %s): answered, ", editLogProbeID, v.master)) != 1 || logLines("tags: <ENVELOPE>") < 1 || logLines("Tally program: ") != 1 {
		t.Fatalf("the probe's log: %s", readText(logFile()))
	}
	if m := computedFigure(bs[0]); m != "" {
		t.Fatalf("a computed figure: %q", m)
	}
}

// --- source C, month slices
func sliceReady(t *testing.T, earliestBack int) (*standTally, []M) {
	t.Helper()
	_, f, _ := liveBridge(t, "")
	setCfg("RecorderSlices", true) // round 2 R2-5: month slices by the setting only (the cloud cannot send them yet)
	saveDateForm(zz, formPlain, "202508", 3)
	f.add(today(), fgParty, "SC-1", "one", "-1.00")
	sessions := openCompaniesWith(fin, true)
	lightCheckOpen(sessions) // the starting point (nothing above it), source C's state from it
	backdateStartPoint(t, earliestBack)
	return f, sessions
}

// the starting point recorded months back (the slices walk back to its month, round 2 R2-10)
func backdateStartPoint(t *testing.T, months int) {
	t.Helper()
	all := readObjFile(sp("start-point.json"))
	for k, v := range all {
		e := obj(v)
		e["at"] = nowFn().AddDate(0, -months, 0).Format("2006-01-02T15:04:05")
		all[k] = e
	}
	_ = saveFile(sp("start-point.json"), jsonText(all))
	spMu.Lock()
	spLatestD = ""
	spMu.Unlock()
}

func sliceMonths(f *standTally) []string {
	var o []string
	for _, b := range f.bodiesOf(sliceID) {
		o = append(o, group(`<SVFROMDATE>(\d{6})01</SVFROMDATE>`, b, 1))
	}
	return o
}

func TestSourceCSlicesOrderAndStop(t *testing.T) {
	f, _ := sliceReady(t, 3)
	prev := nowFn().AddDate(0, -1, 0).Format("200601")
	f.mu.Lock()
	f.add(today(), fgParty, "SC-2", "this month", "-1.00")
	f.add(prev+"10", fgParty, "SC-3", "last month", "-1.00")
	f.mu.Unlock()
	_, _ = companyCheck(fin, zz, f.port)
	if n, err := liveSourceC(zz, f.port); err != nil || n != 1 {
		t.Fatalf("first slice: %d %v", n, err)
	}
	b := f.bodiesOf(sliceID)[0]
	cur := nowFn().Format("200601")
	if !strings.Contains(b, "<SVFROMDATE>"+cur+"01</SVFROMDATE><SVTODATE>"+monthEnd(cur)+"</SVTODATE>") || !strings.Contains(b, "$AlterID &gt; 1") || !strings.Contains(b, "MASTERID") {
		t.Fatalf("the slice: %s", b)
	}
	laterBy(t, 30*time.Second)
	if n, _ := liveSourceC(zz, f.port); n != 0 || f.n(sliceID) != 1 {
		t.Fatal("two slices within 60 s")
	}
	laterBy(t, 31*time.Second)
	postTaking.Store(true)
	n, _ := liveSourceC(zz, f.port)
	postTaking.Store(false)
	if n != 0 || f.n(sliceID) != 1 {
		t.Fatal("a slice during a posting")
	}
	if n, err := liveSourceC(zz, f.port); err != nil || n != 1 {
		t.Fatalf("second slice: %d %v", n, err)
	}
	laterBy(t, 2*time.Minute)
	_, _ = liveSourceC(zz, f.port)
	if got := strings.Join(sliceMonths(f), ","); got != cur+","+prev {
		t.Fatalf("months asked: %s (the rise of 2 was found in two months: no third)", got)
	}
	var src []string
	for _, c := range liveQueue() {
		src = append(src, c.source+":"+c.guid)
	}
	if strings.Join(src, ",") != "slice:"+b220CoGUID+"-00000002,slice:"+b220CoGUID+"-00000003" {
		t.Fatalf("the stream: %v", src)
	}
}

func TestSourceCGoesBackToEarliest(t *testing.T) {
	f, _ := sliceReady(t, 3)
	f.mu.Lock()
	f.add(today(), fgParty, "SC-4", "this month", "-1.00")
	f.alter++ // an AlterID with no entry to show (a deletion)
	f.mu.Unlock()
	_, _ = companyCheck(fin, zz, f.port)
	for i := 0; i < 6; i++ {
		_, _ = liveSourceC(zz, f.port)
		laterBy(t, 61*time.Second)
	}
	var want []string
	for k := 0; k <= 3; k++ {
		want = append(want, nowFn().AddDate(0, -k, 0).Format("200601"))
	}
	// nowFn moved by about 6 minutes: the same months
	if got := strings.Join(sliceMonths(f), ","); got != strings.Join(want, ",") {
		t.Fatalf("months asked: %s (want %s: back to the starting point's month, then stop)", got, strings.Join(want, ","))
	}
}

func TestSourceCOffAfterSlowAnswer(t *testing.T) {
	f, _ := sliceReady(t, 1)
	f.mu.Lock()
	f.add(today(), fgParty, "SC-5", "this month", "-1.00")
	f.slow = func(id, body string) time.Duration {
		if id == sliceID {
			return 2500 * time.Millisecond
		}
		return 0
	}
	f.mu.Unlock()
	_, _ = companyCheck(fin, zz, f.port)
	_, _ = liveSourceC(zz, f.port)
	// 2.2.2: the hard stop at 2 s (the bridge stops waiting then, not at 2.5 s); 2.3.1: never switched off, asked again by
	// itself on the shared retry schedule (retry.go)
	if logLines("off: Tally took") != 0 || logLines("(FinComSlice, try 1); trying again by itself at") != 1 {
		t.Fatalf("the log: %s", readText(logFile()))
	}
	if st := obj(beatBody(true, "open", "", nil, nil, nil)["recorderSourceC"]); len(st) != 0 {
		t.Fatalf("the beat: %v", st)
	}
	liveResetState() // a restart (the setting stays)
	laterBy(t, 10*time.Minute)
	f.mu.Lock()
	f.add(today(), fgParty, "SC-6", "this month", "-1.00")
	f.slow = nil
	f.mu.Unlock()
	_, _ = companyCheck(fin, zz, f.port)
	if n, err := liveSourceC(zz, f.port); err != nil || n == 0 || f.n(sliceID) != 2 {
		t.Fatalf("source C not asked again by itself: %d %v", n, err)
	}
}

func TestSourceCNeedsCalibratedForm(t *testing.T) {
	_, f, _ := liveBridge(t, "")
	setCfg("RecorderSlices", true)
	f.add(today(), fgParty, "NC-1", "one", "-1.00")
	sessions := openCompaniesWith(fin, true)
	lightCheckOpen(sessions)
	f.mu.Lock()
	f.add(today(), fgParty, "NC-2", "two", "-1.00")
	f.mu.Unlock()
	spMu.Lock()
	spChecked = map[string]time.Time{}
	spMu.Unlock()
	lightCheckOpen(sessions)
	if f.n(sliceID) != 0 || logLines("Source C: no dated collection form has passed the read test for "+zz) != 1 {
		t.Fatalf("asked without a calibrated form: %v", f.ids())
	}
	// the setting off (the default): never
	setCfg("RecorderSlices", false)
	saveDateForm(zz, formPlain, "202508", 3)
	f.mu.Lock()
	f.add(today(), fgParty, "NC-3", "three", "-1.00")
	f.mu.Unlock()
	spMu.Lock()
	spChecked = map[string]time.Time{}
	spMu.Unlock()
	lightCheckOpen(sessions)
	if f.n(sliceID) != 0 {
		t.Fatal("source C ran with the default source")
	}
	if !sourceHas("addon") || sourceHas("slices") || recorderSource() != "addon" {
		t.Fatal("the default")
	}
	// round 2 R2-5: "both" is what the cloud means, the add-on and Tally's change list; the cloud cannot send "slices"
	applyRecorderSource(M{"recorderSource": "both"})
	if !sourceHas("addon") || sourceHas("slices") || !sourceHas("alterid") {
		t.Fatal("both is the add-on and Tally's change list")
	}
	applyRecorderSource(M{"recorderSource": "slices"})
	if recorderSource() != "both" {
		t.Fatalf("the cloud set slices: %s", recorderSource())
	}
}

func TestSourceCDatedGuardException(t *testing.T) {
	f := newStandTally(t)
	standBridge(t, f, "")
	noteStartPoint(zz, "co-guid-1", 5, 3) // round 2 R2-2: the guard checks values against the starting point
	ym := nowFn().Format("200601")
	if datedRefused(fin, sliceRequest(zz, formPlain, ym, 5)) == nil {
		t.Fatal("a slice passes without a calibrated form")
	}
	saveDateForm(zz, formDMYT, "202508", 3)
	ok := sliceRequest(zz, formDMYT, ym, 5)
	if datedRefused(fin, ok) != nil {
		t.Fatal("the calibrated slice is refused with ReadDays off")
	}
	bad := map[string]string{
		"another form":    sliceRequest(zz, formPlain, ym, 5),
		"another company": sliceRequest("OTHER CO", formDMYT, ym, 5),
		"two months":      strings.Replace(ok, ">"+tallyDMY(monthEnd(ym))+"<", ">"+tallyDMY(monthEnd(nextYm(ym)))+"<", 1),
		"no AlterID":      strings.Replace(ok, "$AlterID &gt; 5", "$AlterID &gt; -1", 1),
		"another id":      strings.ReplaceAll(ok, sliceID, "FinComMeasureC"),
		// round 2 R2-2, the two proved bypasses and their kin
		"2019-04 above 0":           sliceRequest(zz, formDMYT, "201904", 0),
		"2099-12":                   sliceRequest(zz, formDMYT, "209912", 5),
		"AlterID 0":                 sliceRequest(zz, formDMYT, ym, 0),
		"below the starting point":  sliceRequest(zz, formDMYT, ym, 4),
		"before the starting point": sliceRequest(zz, formDMYT, nowFn().AddDate(0, -1, 0).Format("200601"), 5),
		"next month":                sliceRequest(zz, formDMYT, nextYm(ym), 5),
	}
	for name, x := range bad {
		if datedRefused(fin, x) == nil {
			t.Errorf("%s passes the dated guard", name)
		}
	}
	for id, x := range allowListSamples() {
		if id == sliceID || id == vchObjectID || (!strings.Contains(x, "<SVFROMDATE") && !strings.Contains(x, "<SVTODATE")) {
			continue
		}
		if datedRefused(fin, x) == nil {
			t.Errorf("%s passes the dated guard", id)
		}
	}
}

// --- the 2 s stop on the body fetch too (2.3.1: never a switch-off)
func TestBodyFetchOffAfterSlowAnswer(t *testing.T) {
	rec, f, c := liveBridge(t, `,"RecorderBodySec":5,"RecorderFreshRetryMs":0`) // 2.3.3: the held line's one ask at the next try
	td := today()
	f.alter = 10
	noteStartPoint(zz, b220CoGUID, 5, 1) // 2.2.2: nothing is taken without a starting point
	v := f.add(td, "Party S", "PS-1", "slow", "-1.00")
	f.mu.Lock()
	f.slow = func(id, body string) time.Duration {
		if id == vchObjectID {
			return 2500 * time.Millisecond
		}
		return 0
	}
	f.mu.Unlock()
	p := liveFilePath(rec, "")
	liveAppend(t, p, liveLine("voucher_accept_post", "Voucher", v.guid, v.master, "1", "Journal", "PS-1", td, "", "", "slow"))
	liveReadOnce()
	uploadAll(t)
	// 2.2.2: the hard stop at 2 s; 2.3.1: never switched off, the line waits for the retry schedule (retry.go)
	if logLines("off: Tally took") != 0 || logLines("(FinComVoucherObject, try 1); trying again by itself at") != 1 {
		t.Fatalf("the log: %s", readText(logFile()))
	}
	// 2.3.3 (the owner's rule): the line goes up held at once with the words (2.3.1 kept it unsent until the retry)
	if st := obj(beatBody(true, "open", "", nil, nil, nil)["recorderBodyFetch"]); len(st) != 0 || len(c.recSent()) != 1 || !strings.HasPrefix(str(c.recSent()[0]["heldWhy"]), "waiting: Tally took longer than 2 s") {
		t.Fatalf("the beat: %v; sent %v", st, c.recSent())
	}
	// Tally answers in time at the next try: both lines go with their body
	f.mu.Lock()
	f.slow = nil
	f.mu.Unlock()
	liveAppend(t, p, liveLine("voucher_accept_post", "Voucher", v.guid, v.master, "2", "Journal", "PS-1", td, "", "", "slow 2"))
	liveReadOnce()
	retryDue()
	uploadAll(t)
	// the second line with its body; the first's body as its ":resolved" line (asked again once, at the retry)
	s := c.recSent()
	if len(s) != 3 || str(s[1]["xml"]) == "" || str(s[2]["xml"]) == "" || !(strings.HasSuffix(str(s[1]["line_id"]), ":resolved") || strings.HasSuffix(str(s[2]["line_id"]), ":resolved")) {
		for _, x := range s {
			t.Logf("%s xml=%d why=%s", str(x["line_id"]), len(str(x["xml"])), str(x["heldWhy"]))
		}
		t.Fatalf("not sent with their bodies at the retry: %d", len(s))
	}
}

// --- the rollback after an install by the setup: round 2 R2-4 replaced this test's checks with TestSetupKeepsGoodPrevious
// (review220b_test.go): the copy goes to a temporary name, is verified, and is labelled by the replaced program itself
func TestRecorderRollbackAfterSetup(t *testing.T) {
	oldL := installLogFn
	installLogFn = func(string) {} // round 3 R3-2: never the bridge's log (it would land in the package folder)
	defer func() { installLogFn = oldL }()
	for _, f := range []string{"win_service.go", "win_user.go"} {
		if !strings.Contains(readText(f), "notePreviousFromSetup(") {
			t.Fatalf("%s: the install step does not take the setup's copy", f)
		}
	}
	oldV := exeVersionFn
	exeVersionFn = func(string) string { return "2.1.10" }
	defer func() { exeVersionFn = oldV }()
	dir := t.TempDir()
	_ = os.WriteFile(filepath.Join(dir, "FinComBridge.exe"), []byte("new"), 0o755)
	_ = os.WriteFile(filepath.Join(dir, "FinComBridge.setup-old.exe"), []byte("2.1.10"), 0o755)
	_ = os.WriteFile(filepath.Join(dir, "FinComBridge.previous.new"), []byte("2.1.10"), 0o755)
	notePreviousFromSetup(dir)
	if str(readObjFile(filepath.Join(dir, "previous-version.json"))["version"]) != "2.1.10" || readText(previousExe(dir)) != "2.1.10" {
		t.Fatal("the previous version is not kept and named")
	}
}
