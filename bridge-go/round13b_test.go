package main

// Round 13b (03-Oct-2026), code review of rounds 12-13: (1) a day whose every entry was really removed in Tally (a
// posted test voucher deleted later; the read-back had written it into the day file) was distrusted for ever by the
// round-12 guard: it failed three times each Update now, was skipped, and its stale entry stayed in the copy and the
// cloud. On the THIRD try of a one-day slice the keeper asks Tally once more with a different request kind, FinComTag
// (the posting read-back's collection): when that lists none either, the empty day is trusted. (2) the read test runs
// in a goroutine, the tray polls, as the measuring tool does.

import (
	"path/filepath"
	"strings"
	"testing"
)

// three Update-now rounds on a one-day slice whose copy holds an entry; the error of each
func r13bThreeTries(t *testing.T, port int) []error {
	t.Helper()
	var errs []error
	for i := 1; i <= 3; i++ {
		errs = append(errs, r10Round(t, r12Keeper("r13b-"+itoa(i)), port))
	}
	return errs
}

// --- 1a. Day Book empty every time, FinComTag lists none: the third try trusts the empty day
func TestEmptiedDayConfirmedByCollection(t *testing.T) {
	td := today()
	f := newStandTally(t) // no voucher: the Day Book and FinComTag both answer whole envelopes with none
	c := newStandCloud(t)
	standBridge(t, f, c.cfg())
	r12State(td)
	dir := syncFolder(zz)
	writeDayFile(dir, td, r12Voucher(td), false)
	errs := r13bThreeTries(t, f.port)
	for i := 0; i < 2; i++ {
		if errs[i] == nil || !strings.Contains(errs[i].Error(), "try "+itoa(i+1)+" of 3") {
			t.Fatalf("try %d: %v", i+1, errs[i])
		}
	}
	if errs[2] != nil {
		t.Fatalf("the third try, confirmed empty by FinComTag, still failed: %v", errs[2])
	}
	if f.n("FinComTag") != 1 {
		t.Fatalf("FinComTag was asked %d time(s), want once (on the third try only): %v", f.n("FinComTag"), f.ids())
	}
	if got := readText(filepath.Join(dir, "days", td+".xml")); got != "" {
		t.Fatalf("the emptied day's file still holds: %q", got)
	}
	if !exists(dayFullMark(dir, td)) {
		t.Fatal("the emptied day carries no .full mark")
	}
	e := c.dayEntries()[td]
	if e == nil || e["empty"] != true || toInt(e["n"]) != 0 {
		t.Fatalf("the emptied day did not go as empty:true: %v", e)
	}
	if n := logLines("Keeping " + zz + ": day book " + td + ": Tally listed no entries three times and its entry list (FinComTag) lists none either; the day is taken as empty"); n != 1 {
		t.Fatalf("the confirmation log line is there %d time(s), want once", n)
	}
	if logLines("not trusted") != 2 {
		t.Fatalf("'not trusted' logged %d time(s), want 2 (the first two tries)", logLines("not trusted"))
	}
	st := readKeepState(dir)
	if len(arr(st["skipped"])) != 0 || toInt(st["dayFail"]) != 0 || str(st["roundNext"]) != addDays(td, 1) {
		t.Fatalf("state after the confirmed empty day: skipped %v dayFail %v roundNext %v", st["skipped"], st["dayFail"], st["roundNext"])
	}
}

// --- 1b. Day Book empty every time, FinComTag lists 2: the third try keeps distrusting, the day is skipped as today
func TestEmptiedDayNotConfirmedWhenCollectionListsEntries(t *testing.T) {
	td := today()
	f := newStandTally(t)
	c := newStandCloud(t)
	f.add(td, "Party X", "1", "sale", "-100.00")
	f.add(td, "Party X", "2", "sale", "-200.00")
	f.mu.Lock()
	f.behave = emptyDayBook()
	f.mu.Unlock()
	standBridge(t, f, c.cfg())
	r12State(td)
	dir := syncFolder(zz)
	text := r12Voucher(td)
	writeDayFile(dir, td, text, false)
	errs := r13bThreeTries(t, f.port)
	if errs[2] == nil || !strings.Contains(errs[2].Error(), "after 3 tries") {
		t.Fatalf("the third try: %v", errs[2])
	}
	if f.n("FinComTag") != 1 {
		t.Fatalf("FinComTag was asked %d time(s), want once: %v", f.n("FinComTag"), f.ids())
	}
	if got := readText(filepath.Join(dir, "days", td+".xml")); got != text {
		t.Fatalf("the day file was changed: %q", got)
	}
	if exists(dayFullMark(dir, td)) {
		t.Fatal("the day carries the full-read mark")
	}
	if strings.Contains(readText(filepath.Join(dir, "cloud-out.txt")), td) {
		t.Fatal("the day is queued for the cloud")
	}
	noEmptyDay(t, c)
	if logLines("not trusted") != 3 {
		t.Fatalf("'not trusted' logged %d time(s), want 3", logLines("not trusted"))
	}
	if logLines("; the entry list (FinComTag) lists 2") != 1 {
		t.Fatal("the third try's log line does not say the entry list lists 2")
	}
	if logLines("the day is taken as empty") != 0 {
		t.Fatal("the day was taken as empty although the entry list lists entries")
	}
	st := readKeepState(dir)
	if sk := arr(st["skipped"]); len(sk) != 1 || str(sk[0]) != td {
		t.Fatalf("the day was not skipped: %v", st["skipped"])
	}
}
