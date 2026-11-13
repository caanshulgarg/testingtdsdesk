package main

// FinCom Bridge 2.5.16, item 2 (daystop2516.go; the owner's YES of 13-Nov-2026): stops lift by themselves. A slow day
// stops only that day, for 24 hours, then is tried again in the heavy tier; FinCom asks for the upload only on the 3rd
// day it fails; a cloud without migration 197 stops the period as before; rows of another date are skipped; a slow mark
// lifts after a day. Against the stand-in Tally and a model of tally-ingest.

import (
	"path/filepath"
	"strings"
	"testing"
	"time"
)

type r2516Cloud struct {
	dayStops []M
	stops    []M
	fails    map[string]int
	older    bool // a cloud without migration 197
}

func r2516Stops(t *testing.T, c *standCloud) *r2516Cloud {
	t.Helper()
	x := &r2516Cloud{fails: map[string]int{}}
	c.mu.Lock()
	prev := c.other
	c.other = func(k string, b M) (int, M) {
		switch k {
		case "period_day_stop":
			if x.older {
				return 503, M{"ok": false, "notReady": true, "error": "The cloud does not hold a slow day for later yet (migration 197)."}
			}
			x.dayStops = append(x.dayStops, b)
			d := str(b["day"])
			x.fails[d]++
			if x.fails[d] >= 3 {
				return 200, M{"ok": true, "fails": x.fails[d], "upload": true, "words": "Tally could not send " + liveDay(d) + " in time on 3 days. Upload that day's Day Book to finish it."}
			}
			return 200, M{"ok": true, "fails": x.fails[d], "upload": false}
		case "period_stop":
			x.stops = append(x.stops, b)
			return 200, M{"ok": true}
		}
		return prev(k, b)
	}
	c.mu.Unlock()
	return x
}

func r2516SlowDay(f *standTally, day string) {
	f.mu.Lock()
	f.slow = func(id, body string) time.Duration {
		if id == dayHeadsID && strings.Contains(body, day) && !strings.Contains(body, "$VoucherTypeName") {
			return 2500 * time.Millisecond
		}
		return 0
	}
	f.mu.Unlock()
}

func r2516At(t *testing.T, at time.Time) {
	t.Helper()
	nowFn = func() time.Time { return at }
}

func TestR2516SlowDayStopsThatDayOnly(t *testing.T) {
	f, c, m := pullBridge(t)
	x := r2516Stops(t, c)
	pullDay(f, "20250831", 1000, "Sales", "Receipt")
	pullDay(f, "20250830", 1100, "Sales")
	r2516SlowDay(f, "20250831")
	setCfg("DayPullSplit", false) // (item 3's split is looked at in its own test)
	t0 := nowFn()
	l := r2510List(t0.Add(-time.Hour).UTC().Format(time.RFC3339), "period", "20250831", "20250830")
	applyPeriodDays(l)
	pullRun(t, 10)
	retryReset() // (the shared retry schedule after a stop: its own tests)
	pullRun(t, 10)
	if len(x.dayStops) != 1 || str(x.dayStops[0]["day"]) != "20250831" || str(x.dayStops[0]["why"]) != "over2s" || len(x.stops) != 0 {
		t.Fatalf("FinCom told: day stops %v, period stops %v", x.dayStops, x.stops)
	}
	if m.n["20250830"] != 1 {
		t.Fatalf("the other day was not read: %v", m.n)
	}
	if len(m.upload) != 0 {
		t.Fatalf("the person asked to upload after one slow day: %v", m.upload)
	}
	// listed again within the day: not asked, refused with its own plain reason
	n0 := f.n(dayHeadsID)
	r2516At(t, t0.Add(3*time.Hour))
	l = r2510List(t0.Add(-time.Hour).UTC().Format(time.RFC3339), "period", "20250831")
	applyPeriodDays(l)
	pullRun(t, 5)
	if f.n(dayHeadsID) != n0 {
		t.Fatal("the slow day was asked again within its 24 hours")
	}
	found := false
	for _, a := range r2510Acks() {
		if str(a["code"]) == "dayRetry" && strings.Contains(str(a["words"]), "no action needed") {
			found = true
		}
	}
	if !found {
		t.Fatalf("no dayRetry refusal said: %v", r2510Acks())
	}
	if b := pullBeat(); len(arr(b["retryDays"])) != 1 {
		t.Fatalf("the beat's retryDays: %v", b["retryDays"])
	}
	// kept across a restart
	pullSaveNow()
	pull.mu.Lock()
	pull.retry = map[string]M{}
	pull.mu.Unlock()
	pullLoad()
	if !pullRetryHeld(pullItem{Company: zz, CGUID: b220CoGUID, Day: "20250831"}) {
		t.Fatal("the hold was lost at a restart")
	}
	// after 24 hours: asked again, but only once Tally has been left alone a minute (the heavy tier)
	r2516At(t, t0.Add(25*time.Hour))
	r2516Person(t, 20)
	paceNote(zz, paceHeads, 50, 0, true) // the list measured small: still heavy for a retried day
	applyPeriodDays(l)
	pullRun(t, 5)
	if f.n(dayHeadsID) != n0 {
		t.Fatal("a retried day went 20 s after typing")
	}
	r2516Idle(70)
	f.mu.Lock()
	f.slow = nil // Tally quick now
	f.mu.Unlock()
	retryReset()
	pullRun(t, 10)
	if f.n(dayHeadsID) != n0+1 || m.n["20250831"] != 2 {
		t.Fatalf("not read again after its hold: %v", m.n)
	}
	if pullRetryOnce(pullItem{Company: zz, CGUID: b220CoGUID, Day: "20250831"}) {
		t.Fatal("the hold kept after the day was read whole")
	}
}

func TestR2516UploadOnlyAfterThreeDays(t *testing.T) {
	f, c, m := pullBridge(t)
	x := r2516Stops(t, c)
	pullDay(f, "20250831", 1000, "Sales")
	r2516SlowDay(f, "20250831")
	setCfg("DayPullSplit", false)
	t0 := nowFn()
	l := r2510List(t0.Add(-time.Hour).UTC().Format(time.RFC3339), "period", "20250831")
	for i := 0; i < 3; i++ {
		r2516At(t, t0.Add(time.Duration(i)*25*time.Hour))
		applyPeriodDays(l)
		pullRun(t, 5)
		retryReset()
		if i < 2 && len(pull.upload) != 0 {
			t.Fatalf("try %d: marked to upload", i+1)
		}
	}
	if len(x.dayStops) != 3 {
		t.Fatalf("%d day stops told", len(x.dayStops))
	}
	pull.mu.Lock()
	up := pull.upload[pullItem{Company: zz, CGUID: b220CoGUID, Day: "20250831"}.key()]
	pull.mu.Unlock()
	if up == nil || !strings.Contains(str(up["words"]), "on 3 days") || len(m.upload) != 0 {
		t.Fatalf("after 3 days: %v (told again: %v)", up, m.upload)
	}
	_ = f
	// (FinCom then never lists it; a day it lists again was cleared there: read again, 2.5.13)
}

// a cloud without migration 197: the period stops as in 2.5.15 (its words), and that stop lifts here after 24 hours
func TestR2516OlderCloudStopsPeriod(t *testing.T) {
	f, c, _ := pullBridge(t)
	x := r2516Stops(t, c)
	x.older = true
	pullDay(f, "20250831", 1000, "Sales")
	pullDay(f, "20250830", 1100, "Sales")
	r2516SlowDay(f, "20250831")
	setCfg("DayPullSplit", false)
	t0 := nowFn()
	chosen := t0.Add(-time.Hour).UTC().Format(time.RFC3339)
	l := r2510List(chosen, "period", "20250831", "20250830")
	applyPeriodDays(l)
	pullRun(t, 10)
	if len(x.stops) != 1 || str(x.stops[0]["day"]) != "20250831" {
		t.Fatalf("an older cloud: period stops %v", x.stops)
	}
	if pullStoppedFor(zz, chosen) != true {
		t.Fatal("not stopped here")
	}
	r2516At(t, t0.Add(25*time.Hour))
	if pullStoppedFor(zz, chosen) {
		t.Fatal("the stop did not lift after 24 hours")
	}
}

// every row of another date: a day not read (asked again later), never a stop of single days, never an upload
func TestR2516RowsOfAnotherDate(t *testing.T) {
	for _, rel := range []string{"3.0", "7.1"} {
		raw := gz242(t, filepath.Join("testdata", "r245", rel, "split-S3-5-20260831-Sales.xml.gz"))
		rows, skipped, other := pullRowsSkip(raw, "20260830")
		if len(rows) != 0 || skipped != 340 || other != "20260831" {
			t.Fatalf("%s: %d rows, %d skipped, %q", rel, len(rows), skipped, other)
		}
		rows, skipped, _ = pullRowsSkip(raw, "20260831")
		if len(rows) != 340 || skipped != 0 {
			t.Fatalf("%s: %d rows, %d skipped", rel, len(rows), skipped)
		}
	}
	mixed := `<ENVELOPE><VOUCHER VCHTYPE="Sales"><GUID>g-1</GUID><MASTERID>11</MASTERID><ALTERID>5</ALTERID><DATE>20250510</DATE></VOUCHER>` +
		`<VOUCHER VCHTYPE="Sales"><GUID>g-2</GUID><MASTERID>12</MASTERID><ALTERID>6</ALTERID><DATE>20250511</DATE></VOUCHER></ENVELOPE>`
	rows, skipped, other := pullRowsSkip(mixed, "20250510")
	if len(rows) != 1 || rows[0].Mid != "11" || skipped != 1 || other != "20250511" {
		t.Fatalf("mixed: %+v %d %q", rows, skipped, other)
	}
}

// a slow mark lifts by itself after a day; the entries are asked again
func TestR2516SlowMarkLiftsAfterADay(t *testing.T) {
	pullBridge(t)
	t0 := nowFn()
	slowSt.mu.Lock()
	slowFresh()
	slowSt.marks[companyKey(zz)] = &slowMark{Company: zz, GUID: b220CoGUID, Since: t0.In(liveZone).Format(time.RFC3339), TimesOver: 2, LastMs: -1}
	slowSt.mu.Unlock()
	t.Cleanup(func() {
		slowSt.mu.Lock()
		delete(slowSt.marks, companyKey(zz))
		slowSt.mu.Unlock()
	})
	r2516At(t, t0.Add(23*time.Hour))
	if !slowMarked(zz, b220CoGUID) {
		t.Fatal("lifted within the day")
	}
	r2516At(t, t0.Add(25*time.Hour))
	if slowMarked(zz, b220CoGUID) {
		t.Fatal("not lifted after a day")
	}
	if !strings.Contains(readText(logFile()), "is a day old: lifted") {
		t.Fatal("no log line")
	}
}
