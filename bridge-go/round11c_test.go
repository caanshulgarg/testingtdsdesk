package main

// Round 11, code review of rounds 9-11 (bridge): the ledger state saved with the list, the .full mark only on a full
// read, a day file written by anything else drops the mark, PostOnlyBy

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// --- 1. the list held keeps the state: a second round with the same ledgers and states sends no row
func TestLedgerStateNotChangedEveryRound(t *testing.T) {
	f := newStandTally(t)
	c := newStandCloud(t)
	for i := 1; i <= 3; i++ {
		f.addLed(fmt.Sprintf("Party %02d", i), "Sundry Creditors", "0.00")
	}
	f.mu.Lock()
	f.led[0].state = "Delhi"
	f.led[1].state = "Haryana"
	f.mu.Unlock()
	td := today()
	standBridge(t, f, `,"KeepBudgetSec":600`+c.cfg())
	liveFrom(td)
	runNow(t, "now")
	pushAll := func() {
		cloudMu.Lock()
		cloudLinksAt = time.Time{}
		cloudMu.Unlock()
		invokeCloudPush()
	}
	pushAll()
	c.mu.Lock()
	first := len(c.ledList)
	c.ledList = nil
	c.mu.Unlock()
	if first != 1 {
		t.Fatalf("the first list: %d calls", first)
	}
	held := loadLedList(syncFolder(zz))
	if held[f.led[0].guid].state != "Delhi" || held[f.led[1].guid].state != "Haryana" || held[f.led[2].guid].state != "" {
		t.Fatalf("the list held lost the states: %v", held)
	}
	// the second round: nothing changed but Party 03's state
	f.mu.Lock()
	f.led[2].state = "Punjab"
	f.alter++
	f.led[2].alter = f.alter
	f.mu.Unlock()
	nowFn = func() time.Time { return time.Now().Add(10 * time.Minute) }
	if r := wakeLedgers(zz, "test", false); r["started"] != true {
		t.Fatalf("not started: %v", r)
	}
	waitIdle(t)
	pushAll()
	c.mu.Lock()
	got := append([]M{}, c.ledList...)
	c.mu.Unlock()
	if len(got) != 1 {
		t.Fatalf("%d ledger list calls", len(got))
	}
	rows := arr(got[0]["ledgers"])
	if len(rows) != 1 || str(at(arr(rows[0]), 0)) != f.led[2].guid || str(at(arr(rows[0]), 9)) != "Punjab" {
		t.Fatalf("the second round's rows (want only Party 03 with its new state): %v", rows)
	}
}

// --- 3. the day-book file seed covering less than the range: no .full mark beyond the file's own dates; the days
// outside it are not sent as empty
func TestSeedMarksNoDayFull(t *testing.T) {
	f := newStandTally(t)
	c := newStandCloud(t)
	standBridge(t, f, c.cfg())
	var b strings.Builder
	b.WriteString("<ENVELOPE><BODY><IMPORTDATA><REQUESTDATA>")
	for i, d := range []string{"20260405", "20260520", "20260630"} {
		v := &tVch{guid: fmt.Sprintf("seed-%d", i), master: fmt.Sprint(900 + i), date: d, typ: "Journal", no: fmt.Sprint(i), narr: "seed", party: "Party X", alter: int64(900 + i),
			lines: [][2]string{{"Party X", "-10.00"}, {"Sales", "10.00"}}}
		b.WriteString("<TALLYMESSAGE>" + v.xml() + "</TALLYMESSAGE>")
	}
	b.WriteString("</REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>")
	if _, err := importKeepSeed(zz, "20260401", "20260731", b.String()); err != nil {
		t.Fatal(err)
	}
	dir := syncFolder(zz)
	for d := "20260701"; d <= "20260731"; d = addDays(d, 1) {
		if exists(dayFullMark(dir, d)) {
			t.Fatalf("a July day of the seed carries the full-read mark: %s", d)
		}
	}
	if exists(dayFullMark(dir, "20260406")) {
		t.Fatal("a seeded day carries the full-read mark (a file is not a read)")
	}
	invokeCloudPush()
	days := c.dayEntries()
	for d, e := range days {
		if e["empty"] == true {
			t.Fatalf("a seeded day went as empty:true: %s %v", d, e)
		}
	}
	if e := days["20260405"]; e == nil || toInt(e["n"]) != 1 {
		t.Fatalf("the seeded entry's day: %v", e)
	}
	if e := days["20260715"]; e != nil && e["readFailed"] != true {
		t.Fatalf("a July day of the seed: %v", e)
	}
}

// --- 4. a day file written by anything but a full read drops the .full mark: an emptied day is never empty:true
func TestDayFileWrittenElsewhereDropsFullMark(t *testing.T) {
	td := today()
	f := newStandTally(t)
	c := newStandCloud(t)
	standBridge(t, f, c.cfg())
	liveFrom(td)
	runNow(t, "now") // an empty day read in full
	dir := syncFolder(zz)
	if !exists(dayFullMark(dir, td)) {
		t.Fatal("the full read left no mark")
	}
	if e := c.dayEntries()[td]; e == nil || e["empty"] != true {
		t.Fatalf("the empty day read in full: %v", e)
	}
	// a posting's read-back puts an entry into that day (not a read): the mark goes
	addPostedForCopy(zz, M{"guid": "p-1", "alter": "77", "date": td, "number": "P-1", "type": "Journal"}, finVoucher("p1", fgParty, "P-1", td, "1.00"))
	st := readKeepState(dir)
	if n := useKeepPosted(dir, st); n != 1 {
		t.Fatalf("useKeepPosted put %d entries", n)
	}
	if exists(dayFullMark(dir, td)) {
		t.Fatal("the full-read mark survived a write that was not a full read")
	}
	// the same path can leave a day EMPTY (an entry moved from that day): it must go as readFailed, never empty:true
	writeDayFile(dir, td, "", false)
	invokeCloudPush()
	e := c.dayEntries()[td]
	if e == nil || e["empty"] == true || e["readFailed"] != true {
		t.Fatalf("an emptied day without a full read: %v", e)
	}
	// a full read of the day marks it again
	writeDayFile(dir, td, "", true)
	if !exists(dayFullMark(dir, td)) {
		t.Fatal("the full read did not mark the day")
	}
	_ = os.Remove(filepath.Join(dir, "x"))
}

// --- 10. the installer records PostOnlyBy "installer": a later installer replaces its own list, never a hand-set one
func TestPostOnlyByInstaller(t *testing.T) {
	c := newOrdered()
	setPostOnly(c, "ZZ TEST")
	if strings.Join(strs(c.Get("PostOnly")), "|") != "ZZ TEST" || str(c.Get("PostOnlyBy")) != "installer" {
		t.Fatalf("after the first installer: %v / %v", c.Get("PostOnly"), c.Get("PostOnlyBy"))
	}
	setPostOnly(c, "ZZ TEST;ZZ TEST 2")
	if strings.Join(strs(c.Get("PostOnly")), "|") != "ZZ TEST|ZZ TEST 2" || str(c.Get("PostOnlyBy")) != "installer" {
		t.Fatalf("a later installer did not replace the installer-set list: %v", c.Get("PostOnly"))
	}
	setPostOnly(c, "")
	if strings.Join(strs(c.Get("PostOnly")), "|") != "ZZ TEST|ZZ TEST 2" {
		t.Fatalf("an empty define touched the list: %v", c.Get("PostOnly"))
	}
	h := newOrdered()
	h.Set("PostOnly", []any{"BY HAND"})
	setPostOnly(h, "ZZ TEST")
	if strings.Join(strs(h.Get("PostOnly")), "|") != "BY HAND" || h.Has("PostOnlyBy") {
		t.Fatalf("a hand-set list was replaced: %v / %v", h.Get("PostOnly"), h.Get("PostOnlyBy"))
	}
	h2 := newOrdered()
	h2.Set("PostOnly", []any{"BY HAND"})
	h2.Set("PostOnlyBy", "owner")
	setPostOnly(h2, "ZZ TEST")
	if strings.Join(strs(h2.Get("PostOnly")), "|") != "BY HAND" {
		t.Fatalf("a list marked as the owner's was replaced: %v", h2.Get("PostOnly"))
	}
}
