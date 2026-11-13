package main

// FinCom Bridge 2.5.16, item 3 (the owner's YES of 13-Nov-2026): the voucher-type split back on for very big days. A day
// whose one-day list (F1) is stopped at 2 s is asked one voucher type at a time (F2, the existing measured form, 1.08 s
// at worst), each under its own 2 s stop, only in the heavy tier; a type over 2 s stops the day only (item 2). F2 passes
// the gate only for the day being read by type and a type of its list. No new request.

import (
	"strings"
	"testing"
	"time"
)

func r2516SplitDay(t *testing.T) (*standTally, *r2516Cloud, *pullModel) {
	t.Helper()
	f, c, m := pullBridge(t)
	setCfg("DayPullSplit", true)
	x := r2516Stops(t, c)
	pullDay(f, "20250831", 1000, "Sales", "Sales", "Receipt", "Payment")
	r2516SlowDay(f, "20250831") // F1 (yyyymmdd) over 2 s; F2 (d-MMM-yyyy) quick
	return f, x, m
}

func r2516Bodies(f *standTally, id string) []string {
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

func TestR2516SplitReadsABigDayByType(t *testing.T) {
	f, x, m := r2516SplitDay(t)
	r2516Person(t, 70)
	applyPeriodDays(pullList("20250831"))
	pullRun(t, 5)
	retryReset() // (the shared retry schedule after the stop: its own tests)
	pullRun(t, 30)
	var f2 []string
	for _, b := range r2516Bodies(f, dayHeadsID) {
		if strings.Contains(b, "$VoucherTypeName") {
			f2 = append(f2, b)
		}
	}
	if len(f2) != len(pullStdTypes) {
		t.Fatalf("%d by-type lists asked, want %d", len(f2), len(pullStdTypes))
	}
	for i, b := range f2 {
		if b != dayHeadsTypeRequest(zz, "20250831", pullStdTypes[i]) {
			t.Fatalf("by-type list %d is not F2 as built:\n%s", i, b)
		}
	}
	// (the code review's H1) the day is never done on a split list: told partial, then held 24 hours (not a failed day)
	if len(x.stops) != 0 || len(x.dayStops) != 1 || str(x.dayStops[0]["why"]) != "split" {
		t.Fatalf("after the split: day stops %v, period stops %v", x.dayStops, x.stops)
	}
	var via string
	partial := false
	for _, h := range m.heads {
		if str(h["day"]) == "20250831" && !truthy(h["upload"]) {
			via, partial = str(h["via"]), h["partial"] == true
		}
	}
	if m.n["20250831"] != 4 || via != "split" || !partial || f.n(vchObjectID) != 4 {
		t.Fatalf("the day by type: n %v via %q partial %v, %d entries asked", m.n, via, partial, f.n(vchObjectID))
	}
	if !pullRetryHeld(pullItem{Company: zz, CGUID: b220CoGUID, Day: "20250831"}) {
		t.Fatal("the split day is not held for its one-day list a day later")
	}
	if !strings.Contains(readText(logFile()), "asked again one voucher type at a time") {
		t.Fatal("no log line")
	}
}

func TestR2516SplitTypeOver2sStopsTheDay(t *testing.T) {
	f, x, _ := r2516SplitDay(t)
	f.mu.Lock()
	f.slow = func(id, body string) time.Duration {
		if id == dayHeadsID && (strings.Contains(body, "20250831") || strings.Contains(body, "Receipt")) {
			return 2500 * time.Millisecond
		}
		return 0
	}
	f.mu.Unlock()
	r2516Person(t, 70)
	applyPeriodDays(pullList("20250831"))
	for i := 0; i < 6; i++ {
		pullRun(t, 10)
		retryReset()
	}
	if len(x.dayStops) != 1 || str(x.dayStops[0]["day"]) != "20250831" {
		t.Fatalf("a type over 2 s: day stops %v", x.dayStops)
	}
	// the split went no further than the slow type
	n := 0
	for _, b := range r2516Bodies(f, dayHeadsID) {
		if strings.Contains(b, "$VoucherTypeName") {
			n++
		}
	}
	if n != 3 { // Sales, Purchase, Receipt
		t.Fatalf("%d by-type lists asked", n)
	}
}

// the split is the heavy tier: not 10 s after typing, even with the day's list measured small
func TestR2516SplitIsHeavy(t *testing.T) {
	f, _, _ := r2516SplitDay(t)
	paceNote(zz, b220CoGUID, paceHeads, 50, 0, true)
	r2516Person(t, 10)
	applyPeriodDays(pullList("20250831"))
	pullRun(t, 5)
	retryReset()
	pullRun(t, 5)
	for _, b := range r2516Bodies(f, dayHeadsID) {
		if strings.Contains(b, "$VoucherTypeName") {
			t.Fatal("a by-type list went 10 s after typing")
		}
	}
	if w := pullCurrent(); w == nil || !w.split {
		t.Fatal("the day is not being read by type")
	}
}

// the gate: F2 only for the day being read by type and a type of its list; switched off: never
func TestR2516SplitGate(t *testing.T) {
	pullBridge(t)
	setCfg("DayPullSplit", true)
	d := "20250831"
	tc := recorderTC(nil)
	applyPeriodDays(M{"periodDays": []any{M{"company": zz, "company_guid": b220CoGUID, "day": d, "fetch": true, "types": []any{"Sales", "Receipt"}}}})
	f2 := dayHeadsTypeRequest(zz, d, "Sales")
	if dayHeadsExact(tc, f2) {
		t.Fatal("F2 passes for a day not read by type")
	}
	w := pullCurrent()
	w.split = true
	if !dayHeadsExact(tc, f2) || !dayHeadsExact(tc, dayHeadsTypeRequest(zz, d, "Receipt")) {
		t.Fatal("F2 refused for the day read by type")
	}
	for name, x := range map[string]string{
		"an unlisted type": dayHeadsTypeRequest(zz, d, "Payment"),
		"another day":      dayHeadsTypeRequest(zz, "20250830", "Sales"),
		"another company":  dayHeadsTypeRequest("OTHER CO", d, "Sales"),
	} {
		if dayHeadsExact(tc, x) {
			t.Fatalf("%s passes", name)
		}
	}
	if dayHeadsExact(&TC{copier: true, limitMs: 2500}, f2) {
		t.Fatal("F2 passes without the 2 s stop")
	}
	setCfg("DayPullSplit", false)
	if dayHeadsExact(tc, f2) {
		t.Fatal("F2 passes with the split switched off")
	}
}
