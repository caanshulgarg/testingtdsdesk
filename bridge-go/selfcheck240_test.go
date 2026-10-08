package main

// 2.4.0 review, part 1 (next-selfcheck). Written before the code (red first).
//   MEDIUM 1: an entry whose selfcheck line is still queued (from an earlier run that night) went into neither queued nor
//   notQueued: the second run recorded "all fetched" and moved the mark past it. It is kept unconfirmed now, and the mark
//   never moves past an unconfirmed entry.
//   MEDIUM 2: Tally's change counter below the mark (the company restored from a backup): the mark is reset to the
//   counter and the record says "Tally was restored from a backup: re-check from <date>" (the night of the last good
//   check at or below the counter); the next night checks as usual instead of "not checked" for ever.
//   LOW: more changes than one list may carry (SelfCheckMaxSpan): checked in month slices across nights (source C's month
//   list, as built), the mark moved when the last month is done; the nightly check never goes while reading is stopped
//   from FinCom, or during a posting.

import (
	"strings"
	"testing"
	"time"
)

// --- MEDIUM 1. the second run of a night finds the entry's line of the first run still queued: unconfirmed, never
// "all fetched", and the mark stays below it
func TestSelfCheckQueuedLineStaysUnconfirmed(t *testing.T) {
	f, c := scBridge(t, "")
	v2 := f.add("20261006", "Party B", "2", "", "50.00")
	f.add("20261006", "Party C", "3", "", "60.00")
	led231Numbers(t, f)
	c.scReply = func(b M) (int, M) {
		if str(b["step"]) == "compare" {
			return 200, M{"ok": true, "missing": []any{M{"guid": v2.guid, "why": "absent"}}}
		}
		return 200, M{"ok": true}
	}
	r1, err := selfCheckStart(zz, f.port)
	if err != nil || r1 == nil || len(r1.queued) != 1 {
		t.Fatalf("first run: %v %v", r1, err)
	}
	// the first run's record did not reach the cloud (tried again at the next light check); its line is still queued
	r2, err := selfCheckStart(zz, f.port)
	if err != nil || r2 == nil {
		t.Fatalf("second run: %v %v", r2, err)
	}
	if len(r2.queued)+len(r2.notQueued) != 1 {
		t.Fatalf("the entry whose line is still queued is in neither list (queued %d, not queued %d)", len(r2.queued), len(r2.notQueued))
	}
	if err := selfCheckFinish(r2); err != nil {
		t.Fatal(err)
	}
	x := scSteps(c, "record")[0]
	if toI64(x["still"]) != 1 || toI64(x["fetched"]) != 0 {
		t.Fatalf("recorded as if all were fetched: %v", x)
	}
	if st := scState(zz, b220CoGUID); toI64(st["mark"]) >= v2.alter {
		t.Fatalf("the mark moved past an unconfirmed entry (AlterID %d): %v", v2.alter, st)
	}
}

// --- MEDIUM 2. Tally restored from a backup: the counter below the mark. The mark is reset to the counter, the record
// says it with the night to re-check from; the next night checks from the counter as usual
func TestSelfCheckRestoredFromBackup(t *testing.T) {
	f, c := scBridge(t, "")
	for i := 0; i < 3; i++ {
		f.add("20261006", "Party B", "x", "", "50.00")
	}
	led231Numbers(t, f) // the counter: 4
	scSave(zz, b220CoGUID, M{"mark": 50, "since": "20261005", "hist": []any{M{"night": "20261001", "mark": 3}, M{"night": "20261003", "mark": 4}, M{"night": "20261005", "mark": 50}}})
	n0 := scN(f)
	r, err := selfCheckStart(zz, f.port)
	if err != nil || r == nil || scN(f) != n0 {
		t.Fatalf("a counter below the mark: %v %v (asked %v)", r, err, f.ids()[n0:])
	}
	if err := selfCheckFinish(r); err != nil {
		t.Fatal(err)
	}
	x := scSteps(c, "record")[0]
	if x["restored"] != true || str(x["restoredFrom"]) != "20261003" || !strings.Contains(str(x["stopped"]), "restored from a backup") {
		t.Fatalf("the record does not say Tally was restored, re-check from 03-Oct-2026: %v", x)
	}
	if st := scState(zz, b220CoGUID); toI64(st["mark"]) != 4 {
		t.Fatalf("the mark not reset to Tally's counter: %v", st)
	}
	// the next night: one entry more in Tally, checked from the counter as usual
	f.add("20261007", "Party D", "y", "", "10.00")
	led231Numbers(t, f)
	scAt(t, time.Date(2026, 10, 7, 23, 0, 0, 0, time.Local))
	r, _ = selfCheckStart(zz, f.port)
	if r == nil || r.stopped != "" || r.after != 4 || r.listed != 1 {
		t.Fatalf("the next night: %+v", r)
	}
}

// --- LOW 1. too many changes for one list: checked in month slices across nights, each source C's month list above the
// mark exactly as sliceRequest builds it in the date form kept for the company (FinComSlice, on the allow-list, the one
// dated list the guard lets go while reading old days is off); the mark moves when the last month is done
func TestSelfCheckInSlicesAcrossNights(t *testing.T) {
	f, c := scBridge(t, `,"SelfCheckMaxSpan":2,"SelfCheckSlicesPerNight":1`)
	for i := 0; i < 3; i++ {
		f.add("20261006", "Party B", "x", "", "50.00")
	}
	led231Numbers(t, f)
	ym := startPointMonth(zz)
	saveDateForm(zz, formPlain, ym, 1)
	r, err := selfCheckStart(zz, f.port)
	if err != nil || r == nil || r.stopped != "" {
		t.Fatalf("not checked (want a slice): %+v %v", r, err)
	}
	if b := f.bodiesOf(sliceID); len(b) != 1 || b[0] != sliceRequest(zz, formPlain, ym, 1) || f.n("TDSDeskKeepList") != 0 {
		t.Fatalf("the month slice: %v (%v)", b, f.ids())
	}
	if err := selfCheckFinish(r); err != nil {
		t.Fatal(err)
	}
	x := scSteps(c, "record")[0]
	if str(x["sliceFrom"]) != ym+"01" || str(x["sliceTo"]) != monthEnd(ym) || str(x["stopped"]) != "" {
		t.Fatalf("the slice's record: %v", x)
	}
	if st := scState(zz, b220CoGUID); toI64(st["mark"]) != 4 || st["slice"] != nil {
		t.Fatalf("the mark after the last month: %v", st)
	}
	scOnlyListed(t, f)
}

// a cycle of months over two nights: the first night's month done, the mark kept until the last
func TestSelfCheckSlicesKeepTheMarkUntilTheLast(t *testing.T) {
	f, c := scBridge(t, `,"SelfCheckMaxSpan":2,"SelfCheckSlicesPerNight":1`)
	for i := 0; i < 3; i++ {
		f.add("20261006", "Party B", "x", "", "50.00")
	}
	led231Numbers(t, f)
	ym := startPointMonth(zz)
	saveDateForm(zz, formPlain, ym, 1)
	// a month later: two months to list, one a night
	first := fromTallyDate(ym + "01")
	scAt(t, time.Date(first.Year(), first.Month()+1, 2, 23, 0, 0, 0, time.Local))
	next := nowFn().Format("200601")
	r, _ := selfCheckStart(zz, f.port)
	if r == nil || r.sliceFrom != ym+"01" {
		t.Fatalf("the first month: %+v", r)
	}
	_ = selfCheckFinish(r)
	if st := scState(zz, b220CoGUID); st["mark"] != nil || str(obj(st["slice"])["next"]) != next {
		t.Fatalf("after the first month: %v", st)
	}
	scAt(t, time.Date(first.Year(), first.Month()+1, 3, 23, 0, 0, 0, time.Local))
	r, _ = selfCheckStart(zz, f.port)
	if r == nil || r.sliceFrom != next+"01" {
		t.Fatalf("the second night: %+v", r)
	}
	_ = selfCheckFinish(r)
	if st := scState(zz, b220CoGUID); toI64(st["mark"]) != 4 {
		t.Fatalf("the mark after the last month: %v", st)
	}
	if len(scSteps(c, "record")) != 2 {
		t.Fatalf("records: %d", len(scSteps(c, "record")))
	}
}

// --- LOW 2. reading stopped from FinCom: the nightly check does not go (nothing sent); on by default
func TestSelfCheckStoppedByReadStop(t *testing.T) {
	f, c := scBridge(t, "")
	f.add("20261006", "Party B", "2", "", "50.00")
	led231Numbers(t, f)
	setReadStop("fincom", "the owner's test")
	t.Cleanup(func() { clearReadStop("fincom-resume") })
	n0 := scN(f)
	if why := selfCheckBlocked(zz, b220CoGUID); !strings.Contains(why, "reading from Tally is stopped") {
		t.Fatalf("not blocked by the read stop: %q", why)
	}
	selfCheckAfterLightCheck(zz, f.port)
	scWG.Wait()
	if scN(f) != n0 || len(c.selfchecks) != 0 {
		t.Fatalf("sent while reading is stopped: %v", f.ids()[n0:])
	}
}
