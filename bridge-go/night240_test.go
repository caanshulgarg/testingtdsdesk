package main

// release-240, the owner's decision of 2026-10-09 ("Ok"): Tally is usually closed at night, so the night's work no longer
// waits for 02:00. It starts at the end of office hours (19:00 IST) at the first quiet moment, any time outside office
// hours (09:00 to 19:00, Monday to Saturday, in the PC's time and in IST) up to the next office start, Sundays included,
// once per night (its key: the date of the evening it began). A KeepDailyAt set by hand is still respected. A night that
// did not run is simply run at the next evening's quiet moment (no daytime pieces: they would need a changed request, for
// the owner to approve first). A company whose bank dates have not been read for 3 days: one plain notice, once per
// problem, through the tray's notices gate. No request added or changed. Written before the code (red first).

import (
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func istAt(y, mo, d, h, mi int) time.Time {
	return time.Date(y, time.Month(mo), d, h, mi, 0, 0, istZone)
}

func TestNightWindowFrom1900(t *testing.T) {
	bankBridge(t, "")
	if keepDailyAt() != "19:00" {
		t.Fatalf("keepDailyAt %q, want 19:00 unless set", keepDailyAt())
	}
	// 2026-10-06 is a Tuesday, 2026-10-10 a Saturday, 2026-10-11 a Sunday
	for _, tc := range []struct {
		at  time.Time
		in  bool
		key string
	}{
		{istAt(2026, 10, 6, 18, 59), false, ""},
		{istAt(2026, 10, 6, 19, 0), true, "20261006"},
		{istAt(2026, 10, 6, 23, 30), true, "20261006"},
		{istAt(2026, 10, 7, 2, 0), true, "20261006"},
		{istAt(2026, 10, 7, 8, 59), true, "20261006"},
		{istAt(2026, 10, 7, 9, 0), false, ""},
		{istAt(2026, 10, 7, 14, 0), false, ""},
		{istAt(2026, 10, 10, 19, 30), true, "20261010"},
		{istAt(2026, 10, 11, 14, 0), true, "20261010"}, // Sunday: no office hours
		{istAt(2026, 10, 11, 19, 0), true, "20261011"},
		{istAt(2026, 10, 12, 8, 30), true, "20261011"},
		{istAt(2026, 10, 12, 9, 0), false, ""},
	} {
		in, key := nightWindow(tc.at)
		if in != tc.in || (in && key != tc.key) {
			t.Errorf("%s: in %v key %q (want %v %q)", tc.at.Format("Mon 2006-01-02 15:04"), in, key, tc.in, tc.key)
		}
		if bin, _ := bankNightNow(tc.at); bin != tc.in {
			t.Errorf("%s: the bank route's night %v (want %v)", tc.at.Format("Mon 15:04"), bin, tc.in)
		}
	}
	// set by hand: 02:00 is respected (from 02:00 to the office start)
	setCfg("KeepDailyAt", "02:00")
	t.Cleanup(func() { setCfg("KeepDailyAt", "") })
	for _, tc := range []struct {
		at  time.Time
		in  bool
		key string
	}{
		{istAt(2026, 10, 6, 20, 0), false, ""},
		{istAt(2026, 10, 7, 1, 59), false, ""},
		{istAt(2026, 10, 7, 2, 0), true, "20261007"},
		{istAt(2026, 10, 7, 8, 59), true, "20261007"},
		{istAt(2026, 10, 7, 9, 0), false, ""},
	} {
		if in, key := nightWindow(tc.at); in != tc.in || (in && key != tc.key) {
			t.Errorf("KeepDailyAt 02:00, %s: in %v key %q (want %v %q)", tc.at.Format("Mon 15:04"), in, key, tc.in, tc.key)
		}
	}
}

// a company on the nightly route whose bank dates were not read for 3 days (Tally closed every evening): one notice,
// once, whatever the days it stays so; the words exact; read again, the problem is gone
func TestBankNotReadThreeDaysOneNotice(t *testing.T) {
	_, f, _ := bankBridge(t, "")
	t.Cleanup(func() { nowFn = time.Now })
	start := istAt(2026, 10, 6, 10, 0)
	nowFn = func() time.Time { return start }
	bankForceNight(nwsCo)
	if l := bankStaleList(start); len(l) != 0 {
		t.Fatalf("stale at once: %v", l)
	}
	var shown []string
	clock := func() time.Time { return nowFn() }
	g := newNoticeGate(openNoticeStore(filepath.Join(t.TempDir(), "n.json"), clock), "PC-ONE", clock,
		func(title, text string, warn bool) { shown = append(shown, text) }, func() {})
	look := func() {
		st := M{"tallyOpen": true, "online": true, "cloudConnected": true, "nightStale": bankStaleList(nowFn())}
		for _, p := range trayProblems(trayFacts{St: st, Up: time.Hour}) {
			g.Check(p)
		}
	}
	for _, at := range []time.Time{istAt(2026, 10, 7, 10, 0), istAt(2026, 10, 8, 10, 0), istAt(2026, 10, 9, 9, 59)} {
		nowFn = func() time.Time { return at }
		look()
	}
	if len(shown) != 0 {
		t.Fatalf("a notice before 3 days: %v", shown)
	}
	want := "Bank dates for " + nwsCo + " not read since 06-Oct-2026. Keep Tally open for a few minutes after 7 pm, or upload the Day Book."
	for _, at := range []time.Time{istAt(2026, 10, 9, 10, 1), istAt(2026, 10, 9, 20, 0), istAt(2026, 10, 10, 10, 0), istAt(2026, 10, 12, 11, 0)} {
		nowFn = func() time.Time { return at }
		look()
		look()
	}
	if len(shown) != 1 || shown[0] != want {
		t.Fatalf("notices %d: %q (want exactly one: %q)", len(shown), shown, want)
	}
	if !strings.Contains(readText(logFile()), want) {
		t.Fatalf("the log does not say it")
	}
	// read at last (an evening with Tally open): the problem is gone
	night := istAt(2026, 10, 12, 19, 30)
	nowFn = func() time.Time { return night }
	retryReset()
	bankSet(f, "26311", "20261012")
	bankCheck(t, f)
	bankNightTurn()
	if n := len(bankLists(f)); n != 1 {
		t.Fatalf("lists at 19:30: %d", n)
	}
	if l := bankStaleList(night); len(l) != 0 {
		t.Fatalf("still stale after the night's read: %v", l)
	}
}
