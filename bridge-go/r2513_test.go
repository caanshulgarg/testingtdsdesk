package main

import (
	"fmt"
	"os"
	"strings"
	"testing"
	"time"
)

// 2.5.13: FinCom's own marks decide. FinCom's period list hands out only the days it does not mark to upload
// (tally_period_next_paced: upload_at null), so a listed day that this bridge marked "upload" here, once FinCom took the
// mark, means FinCom cleared it (the day reset): the local mark is dropped and the day is read again.

func r2513Key(day string) string {
	return pullItem{Company: zz, CGUID: b220CoGUID, Day: day}.key()
}

func r2513Marked(day string) bool {
	pull.mu.Lock()
	defer pull.mu.Unlock()
	_, up := pull.upload[r2513Key(day)]
	return up
}

func r2513Later(d time.Duration) {
	at := nowFn().Add(d)
	nowFn = func() time.Time { return at }
}

// marks the day listed now "upload" as the bridge does when Tally is too slow (FinCom told at once)
func r2513Mark(t *testing.T, day string) {
	t.Helper()
	applyPeriodDays(pullList(day))
	w := pullCurrent()
	if w == nil || w.it.Day != day {
		t.Fatalf("the day %s is not the one being read: %+v", day, w)
	}
	pullMarkUpload(w, "over2s", "Sales")
	if !r2513Marked(day) {
		t.Fatal("not marked")
	}
}

// a day marked "upload" here and then reset in FinCom (listed again) is read at the next beat
func TestR2513CloudResetDayReadAgain(t *testing.T) {
	f, _, _ := pullBridge(t)
	pullDay(f, "20250402", 900, "Sales")
	r2513Mark(t, "20250402")
	n0 := f.n(dayHeadsID)
	r2513Later(3 * time.Minute)
	applyPeriodDays(pullList("20250402"))
	if r2513Marked("20250402") {
		t.Fatal("the local mark kept though FinCom lists the day again")
	}
	pullRun(t, 10)
	if f.n(dayHeadsID) != n0+1 {
		t.Fatalf("not read again: %v", f.ids())
	}
	pull.mu.Lock()
	ups := pullUploadListLocked()
	pull.mu.Unlock()
	if len(ups) != 0 {
		t.Fatalf("still in the beat's uploadDays: %v", ups)
	}
	// a restart: the mark stays dropped (saved)
	pullSaveNow()
	pull.mu.Lock()
	pull.upload = map[string]M{}
	pull.mu.Unlock()
	pullLoad()
	if r2513Marked("20250402") {
		t.Fatal("the dropped mark came back after a restart")
	}
}

// a day FinCom still marks (not listed, or listed before FinCom took the mark) is not read
func TestR2513CloudStillMarksNotRead(t *testing.T) {
	f, c, _ := pullBridge(t)
	pullDay(f, "20250402", 900, "Sales")
	pullDay(f, "20250403", 910, "Sales")
	r2513Mark(t, "20250402")
	n0 := f.n(dayHeadsID)
	// FinCom lists other days only: the mark stays and the day is not asked
	r2513Later(3 * time.Minute)
	applyPeriodDays(pullList("20250403"))
	pullRun(t, 10)
	if !r2513Marked("20250402") {
		t.Fatal("the mark dropped though FinCom does not list the day")
	}
	if f.n(dayHeadsID) != n0+1 {
		t.Fatalf("asked: %v", f.ids())
	}
	// a beat answered while FinCom was taking the mark lists it once more: not read (the list may be older than the mark)
	pullDay(f, "20250404", 920, "Sales")
	r2513Mark(t, "20250404")
	n1 := f.n(dayHeadsID)
	applyPeriodDays(pullList("20250404"))
	r2513Later(30 * time.Second)
	applyPeriodDays(pullList("20250404"))
	pullRun(t, 10)
	if !r2513Marked("20250404") || f.n(dayHeadsID) != n1 {
		t.Fatalf("read again within the 2 minutes after the mark: marked %v, %v", r2513Marked("20250404"), f.ids())
	}
	// FinCom never took the mark (its answer failed): FinCom's list does not know of it, the day stays marked
	c.mu.Lock()
	prev := c.other
	c.other = func(k string, b M) (int, M) {
		if k == "period_heads" && truthy(b["upload"]) {
			return 500, M{"ok": false}
		}
		return prev(k, b)
	}
	c.mu.Unlock()
	pullDay(f, "20250405", 930, "Sales")
	r2513Later(3 * time.Minute)
	r2513Mark(t, "20250405")
	n2 := f.n(dayHeadsID)
	r2513Later(3 * time.Minute)
	applyPeriodDays(pullList("20250405"))
	pullRun(t, 10)
	if !r2513Marked("20250405") || f.n(dayHeadsID) != n2 {
		t.Fatalf("read again before FinCom took the mark: marked %v, %v", r2513Marked("20250405"), f.ids())
	}
}

// the marks of an older bridge (before an update) are dropped at the start, with what was left to tell FinCom of them;
// this version's own marks stay
func TestR2513OlderVersionMarksDroppedAtStart(t *testing.T) {
	pullBridge(t)
	old, none, mine := r2513Key("20250410"), r2513Key("20250411"), r2513Key("20250412")
	body := M{"kind": "period_heads", "company": zz, "company_guid": b220CoGUID, "day": "20250410", "upload": true}
	j := M{
		"upload": M{
			old:  M{"company": zz, "day": "20250410", "words": "w", "why": "over2s", "ver": "2.5.12", "atN": 1},
			none: M{"company": zz, "day": "20250411", "words": "w", "why": "over2s", "atN": 2},
			mine: M{"company": zz, "day": "20250412", "words": "w", "why": "over2s", "ver": BridgeVersion, "atN": 3},
		},
		"tell": M{old: body, "stop|other": M{"kind": "period_stop", "company": "Other"}},
	}
	if err := saveFile(pullFile(), jsonText(j)); err != nil {
		t.Fatal(err)
	}
	pullLoad()
	pull.mu.Lock()
	_, a := pull.upload[old]
	_, b := pull.upload[none]
	_, c := pull.upload[mine]
	_, told := pull.tell[old]
	_, stop := pull.tell["stop|other"]
	pull.mu.Unlock()
	if a || b || !c {
		t.Fatalf("older marks: 2.5.12 kept %v, no version kept %v, this version kept %v", a, b, c)
	}
	if told || !stop {
		t.Fatalf("the tells: the older mark's kept %v, the stop's kept %v", told, stop)
	}
	pullSaveNow()
	k := obj(readObjFile(pullFile())["upload"])
	if _, x := k[old]; x || len(k) != 1 {
		t.Fatalf("the file still holds older marks: %v", k)
	}
}

// within one run a day FinCom keeps resetting is read again a few times at most, never in a loop
func TestR2513NoReReadLoop(t *testing.T) {
	f, _, _ := pullBridge(t)
	pullDay(f, "20250402", 900, "Sales")
	r2513Mark(t, "20250402")
	reads := 0
	for i := 0; i < 6; i++ {
		r2513Later(3 * time.Minute)
		n0 := f.n(dayHeadsID)
		applyPeriodDays(pullList("20250402"))
		w := pullCurrent()
		if w == nil {
			break // kept marked: not read
		}
		pullRun(t, 10)
		if f.n(dayHeadsID) > n0 {
			reads++
		}
		// it was too slow again: marked again (FinCom told)
		pull.mu.Lock()
		pull.done = map[string]time.Time{}
		pull.mu.Unlock()
		applyPeriodDays(pullList("20250402"))
		if w := pullCurrent(); w != nil {
			pullMarkUpload(w, "over2s", "Sales")
		}
	}
	if reads != pullUploadReleaseMax {
		t.Fatalf("read again %d times in the run (want %d)", reads, pullUploadReleaseMax)
	}
	if !r2513Marked("20250402") {
		t.Fatal("the mark is not kept after the run's re-reads")
	}
}

// the version
func TestR2513Version(t *testing.T) {
	if BridgeVersion != "2.5.16" || !newerVersion("2.5.13", "2.5.12") || newerVersion("2.5.12", "2.5.13") {
		t.Fatalf("version %s", BridgeVersion)
	}
	if _, err := os.Stat("../docs/bridge-2.5.13-test-sheet.txt"); err != nil {
		t.Fatal(err)
	}
}

// --- 2.5.13 (live, a company opened in Tally for the first time): FinCom has no first day for the book and Tally's company
// list gives no BOOKSFROM. The masters need no first day (only the openings do): the ledger and group lists are read all
// the same, dated with the stand-in day (the request byte for byte as built, only its date), and FinCom is told that
// round's openings are not known (none sent, none taken), with plain words

func r2513NoBooksFrom(t *testing.T) (*standTally, *standCloud) {
	f := newStandTally(t)
	c := newStandCloud(t)
	f.grp = [][2]string{{"Sundry Creditors", "Current Liabilities"}, {"Current Liabilities", "Primary"}}
	for i := 1; i <= 3; i++ {
		f.addLed(fmt.Sprintf("Party %02d", i), "Sundry Creditors", fmt.Sprintf("-%d.00", i))
	}
	f.mu.Lock()
	f.booksFrom, f.cnMode = "-", "zero" // a fresh company: no BOOKSFROM, no change numbers
	f.mu.Unlock()
	standBridge(t, f, `,"KeepBudgetSec":600`+c.cfg())
	liveFrom(today())
	return f, c
}

func r2513LedPush(t *testing.T, c *standCloud) []M {
	t.Helper()
	cloudMu.Lock()
	cloudLinksAt = time.Time{}
	cloudMu.Unlock()
	invokeCloudPush()
	c.mu.Lock()
	defer c.mu.Unlock()
	return append([]M{}, c.ledList...)
}

func TestR2513MastersReadWithoutBooksFrom(t *testing.T) {
	f, c := r2513NoBooksFrom(t)
	startKeepRun(runReq{kind: "ledgers", only: []string{zz}, why: "test"})
	for i := 0; i < 50 && f.n(ledListID) == 0; i++ {
		time.Sleep(100 * time.Millisecond)
	}
	waitIdle(t)
	if f.n(ledListID) == 0 || f.n("FinComGroups") == 0 {
		t.Fatalf("the masters not read: %v", f.ids())
	}
	day := ledgerStandInDay()
	for _, b := range f.bodiesOf(ledListID) {
		if a, z := pinDates(b); a != day || z != booksYearEnd(day) {
			t.Fatalf("the ledger request's period %s-%s (want the stand-in year from %s)", a, z, day)
		}
	}
	sent := r2513LedPush(t, c)
	if len(sent) == 0 {
		t.Fatal("no ledger list went to FinCom")
	}
	b := sent[0]
	if b["openingsAt"] != nil || !truthy(b["openingsUnknown"]) || str(b["openingsWhy"]) != booksFromUnknownWords || len(arr(b["ledgers"])) != 3 {
		t.Fatalf("the ledger list: openingsAt %v, unknown %v, why %q, %d ledgers", b["openingsAt"], b["openingsUnknown"], b["openingsWhy"], len(arr(b["ledgers"])))
	}
	for _, x := range arr(b["ledgers"]) {
		if a := arr(x); str(at(a, 5)) != "" || toInt(at(a, 8)) != 0 {
			t.Fatalf("an opening sent though it is not known: %v", a)
		}
	}
	if logLines(booksFromUnknownWords) == 0 {
		t.Fatalf("not said:\n%s", readText(logFile()))
	}
	// review A2: a read without its openings is not a read of the books ("Books as of" not moved)
	if st := readKeepState(syncFolder(zz)); st == nil || str(st["readAt"]) != "" {
		t.Fatalf("the books' read time moved: %v", st["readAt"])
	}
	// the beat names it for the company (the page shows it instead of "no answer from Tally")
	ss := openCompaniesWith(fin, true)
	var open []any
	for _, s := range ss {
		for _, c := range sessCompanies(s) {
			open = append(open, str(c["name"]))
		}
	}
	cos := beatCompanies(ss, open)
	found := false
	for _, x := range cos {
		if e := obj(x); str(e["name"]) == zz && str(e["booksFromWhy"]) == booksFromUnknownWords {
			found = true
		}
	}
	if !found {
		t.Fatalf("the beat: %v", cos)
	}
}

// once the first day is known (FinCom's or Tally's), the next round is dated it and sends every ledger with its opening
func TestR2513StandInRoundReadAgainDated(t *testing.T) {
	f, c := r2513NoBooksFrom(t)
	runNow(t, "ledgers")
	if s := r2513LedPush(t, c); len(s) == 0 || !truthy(s[0]["openingsUnknown"]) {
		t.Fatalf("the first round: %v", s)
	}
	f.mu.Lock()
	f.booksFrom = "20250401"
	f.mu.Unlock()
	openCompaniesWith(fin, true) // Tally now gives BOOKSFROM
	c.mu.Lock()
	c.ledList = nil
	c.mu.Unlock()
	runNow(t, "ledgers")
	s := r2513LedPush(t, c)
	if len(s) == 0 || str(s[0]["openingsAt"]) != "20250401" || truthy(s[0]["openingsUnknown"]) || len(arr(s[0]["ledgers"])) != 3 {
		t.Fatalf("the dated round: %v", s)
	}
	for _, x := range arr(s[0]["ledgers"]) {
		if a := arr(x); str(at(a, 5)) == "" {
			t.Fatalf("no opening in the dated round: %v", a)
		}
	}
	// the stand-in day is never allowed once a first day is known
	if x := ledgerChunkRequestAt(zz, ledgerStandInDay(), 0, 2000); ledgerStandInDay() != "20250401" && ledgerPeriodExact(x) {
		t.Fatal("the stand-in day allowed with a known first day")
	}
}

// the read held (the first day lost in the middle of a dated round) is never said as done
func TestR2513HeldLedgerReadNotSaidDone(t *testing.T) {
	k := newRun("ledgers", "r1")
	k.booksHeld = map[string]bool{zz: true}
	if w := ledgerRunEndWords(k, true); strings.Contains(w, "done") || !strings.Contains(w, "Tally has not said when") {
		t.Fatalf("the run's end: %q", w)
	}
}

// the owner's decision of 10-Nov-2026: Tally gives no BOOKSFROM, FinCom has the book's first day: the ledgers are read
// dated FinCom's day, with their openings (no stand-in, nothing said missing)
func TestR2513FinComDayUsedWhenTallyGivesNone(t *testing.T) {
	f, c := r2513NoBooksFrom(t)
	openCompaniesWith(fin, true) // this Tally lists the company, without BOOKSFROM
	applyBooksFrom(M{"booksFrom": M{zz: "20250401"}})
	if d := booksFromOf(zz); d != "20250401" {
		t.Fatalf("books-from %q", d)
	}
	runNow(t, "ledgers")
	for _, b := range f.bodiesOf(ledListID) {
		if a, _ := pinDates(b); a != "20250401" {
			t.Fatalf("the ledger request dated %s", a)
		}
	}
	s := r2513LedPush(t, c)
	if len(s) == 0 || str(s[0]["openingsAt"]) != "20250401" || truthy(s[0]["openingsUnknown"]) {
		t.Fatalf("the ledger list: %v", s)
	}
	if logLines(booksFromUnknownWords) != 0 {
		t.Fatal("said missing though FinCom has the day")
	}
}

// 2.5.13's sentence in the FinComLedgers row (the date its period carries when Tally gives no BOOKSFROM)
const r2513LedgersWords = "; 2.5.13, the owner's decision of 10-Nov-2026: FinCom's first day of the book when Tally gives no BOOKSFROM, and with no first day known anywhere the first day of the current financial year, that round's openings not sent"

func TestR2513AllowListOnlyLedgersWords(t *testing.T) {
	if a := tallyAllowList[ledListID]; !strings.Contains(a.purpose, r2513LedgersWords) {
		t.Fatalf("the FinComLedgers row: %q", a.purpose)
	}
	if !strings.Contains(readText("../docs/tally-allowlist.md"), "as for 2.5.13 by the owner's standing decision of 2026-10-06") { // 2.5.14 names the line (r2514_test.go)
		t.Fatal("no decision line for 2.5.13")
	}
}
