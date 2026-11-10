// FinCom Bridge 2.5.12 (range2512.go; the independent review of f1b3e700b, points 1, 2 and 4): the day lists of a range of
// days in one FinComDayHeads, only for a book shown sparse. No missing days (every listed day reported, empty ones too;
// the run's first range checked against single days; a row outside the range is "date not applied"; a range answer cut,
// in error, not adding up, or over 2 s never used and never a stop; only days FinCom handed this bridge, consecutive ones
// together) and no hang of Tally (3 days first, a predicted time under 0.8 s, +50% under 0.5 s, halved over 0.8 s).
package main

import (
	"fmt"
	"net/http"
	"strings"
	"testing"
	"time"
)

// the FinComDayHeads requests the stand Tally got, as (from, to)
func r2512HeadsAsked(f *standTally) [][2]string {
	f.mu.Lock()
	defer f.mu.Unlock()
	var o [][2]string
	for i, id := range f.reqs {
		if id == dayHeadsID {
			a, z := pinDates(f.bodies[i])
			o = append(o, [2]string{a, z})
		}
	}
	return o
}

func r2512Ranges(f *standTally) [][2]string {
	var o [][2]string
	for _, x := range r2512HeadsAsked(f) {
		if x[1] > x[0] {
			o = append(o, x)
		}
	}
	return o
}

// the days told to FinCom (period_heads, not an upload mark), each with its count
func r2512Told(m *pullModel) map[string]int {
	o := map[string]int{}
	for _, b := range m.heads {
		if !truthy(b["upload"]) {
			o[str(b["day"])] = toInt(b["n"])
		}
	}
	return o
}

func r2512Days(from string, n int) []string {
	var o []string
	for i := 0; i < n; i++ {
		o = append(o, addDays(from, i))
	}
	return o
}

// a sparse stretch of n listed days from 01-Sep-2025, entries on the 1st (2), the 6th (1) and the 9th (1); a day after it
// that FinCom did not hand out
func r2512Sparse(t *testing.T, n int) (*standTally, *standCloud, *pullModel, []string) {
	t.Helper()
	return r2512SparseWith(t, n, `,"TallyAbandonMaxSec":600`) // (Tally's end of a request watched, as the bridge's default)
}

func r2512SparseWith(t *testing.T, n int, extra string) (*standTally, *standCloud, *pullModel, []string) {
	t.Helper()
	f, c, m := pullBridgeWith(t, extra)
	days := r2512Days("20250901", n)
	pullDay(f, "20250901", 700, "Sales", "Receipt")
	pullDay(f, "20250906", 710, "Payment")
	pullDay(f, "20250909", 720, "Journal")
	pullDay(f, addDays("20250901", n), 730, "Journal")
	return f, c, m, days
}

func r2512Want(days []string) map[string]int {
	w := map[string]int{}
	for _, d := range days {
		w[d] = map[string]int{"20250901": 2, "20250906": 1, "20250909": 1}[d]
	}
	return w
}

func r2512List(days ...string) M {
	return M{"periodDays": pullList(days...)["periodDays"], "periodNight": true}
}

// 1. every day reported (the empty ones as 0); a range only after 3 sparse single days; this run's first range is a check
// (the same days then read one by one); only after it passed is a range used; only days FinCom handed out
func TestR2512RangeEveryDayReported(t *testing.T) {
	f, _, m, days := r2512Sparse(t, 12)
	applyPeriodDays(r2512List(days...))
	pullRun(t, 120)
	rs := r2512Ranges(f)
	if len(rs) < 2 || rs[0] != [2]string{days[3], days[5]} {
		t.Fatalf("ranges: %v (all lists %v)", rs, r2512HeadsAsked(f))
	}
	// the check's days read one by one after it, then the next range used (no single list of its days)
	singles := map[string]int{}
	for _, x := range r2512HeadsAsked(f) {
		if x[0] == x[1] {
			singles[x[0]]++
		}
	}
	for _, d := range days[:6] {
		if singles[d] != 1 {
			t.Fatalf("%s asked alone %d times (the evidence and the check's days): %v", d, singles[d], r2512HeadsAsked(f))
		}
	}
	if rs[1][0] != days[6] || singles[days[6]] != 0 {
		t.Fatalf("the range after the check: %v, %v", rs, singles)
	}
	if fmt.Sprint(r2512Told(m)) != fmt.Sprint(r2512Want(days)) {
		t.Fatalf("told %v, want %v", r2512Told(m), r2512Want(days))
	}
	if _, had := r2512Told(m)[addDays(days[11], 1)]; had || len(m.upload) != 0 || len(sentEntries(m)) != 4 || pullCurrent() != nil {
		t.Fatalf("a day not handed out told, or upload %v, entries %d", m.upload, len(sentEntries(m)))
	}
	if !strings.Contains(readText(logFile()), "the check of a range against the same days read one by one passed") {
		t.Fatal("the check not logged")
	}
}

// 2. days FinCom handed out that are not next to each other are never in one range
func TestR2512RangeOnlyConsecutiveDays(t *testing.T) {
	f, _, m, days := r2512Sparse(t, 12)
	list := append(append([]string{}, days[:5]...), days[6:]...) // the 6th not handed out
	applyPeriodDays(r2512List(list...))
	pullRun(t, 120)
	for _, r := range r2512Ranges(f) {
		if r[0] <= days[5] && r[1] >= days[5] {
			t.Fatalf("a range over a day not handed out: %v", r)
		}
	}
	told := r2512Told(m)
	if _, had := told[days[5]]; had || len(told) != 11 {
		t.Fatalf("told %v", told)
	}
}

// 3. not a sparse book: a day of more than 50 entries, or a single day's list of 300 ms or more, in the last three: no range
func TestR2512RangeOnlyWhenSparse(t *testing.T) {
	f, _, _, days := r2512Sparse(t, 8)
	var types []string
	for i := 0; i < 51; i++ {
		types = append(types, "Sales")
	}
	pullDay(f, days[2], 5000, types...)
	applyPeriodDays(r2512List(days[:5]...))
	pullRun(t, 200)
	if rs := r2512Ranges(f); len(rs) != 0 {
		t.Fatalf("a range after a day of 51 entries: %v", rs)
	}
	f2, _, _, d2 := r2512Sparse(t, 6)
	f2.mu.Lock()
	f2.slow = func(id, body string) time.Duration {
		if a, z := pinDates(body); id == dayHeadsID && a == z && a == d2[1] {
			return 320 * time.Millisecond
		}
		return 0
	}
	f2.mu.Unlock()
	applyPeriodDays(r2512List(d2[:5]...))
	pullRun(t, 80)
	if rs := r2512Ranges(f2); len(rs) != 0 {
		t.Fatalf("a range after a single day of 320 ms: %v", rs)
	}
}

// the stand's own answer to a range, as a real TallyPrime writes it, with the rows of skip left out
func r2512RangeAnswer(f *standTally, a, z string, skip map[string]bool) string {
	var o strings.Builder
	o.WriteString(`<ENVELOPE><BODY><DATA><COLLECTION>`)
	f.mu.Lock()
	for _, v := range f.vch {
		if v.date >= a && v.date <= z && !skip[v.master] {
			fmt.Fprintf(&o, `<VOUCHER REMOTEID="%s" VCHTYPE="%s"><DATE TYPE="Date">%s</DATE><GUID>%s</GUID><VOUCHERTYPENAME>%s</VOUCHERTYPENAME><ALTERID TYPE="Number"> %d</ALTERID><MASTERID TYPE="Number"> %s</MASTERID></VOUCHER>`,
				v.guid, v.typ, v.date, v.guid, v.typ, v.alter, v.master)
		}
	}
	f.mu.Unlock()
	o.WriteString(`</COLLECTION></DATA></BODY></ENVELOPE>`)
	return o.String()
}

// 4. the run's check finds a difference (the range left out an entry the day read alone gives): ranges off for that
// company for good (kept in sync\range-off.json, so a new run does not use them either), logged; no day missing
func TestR2512RangeCheckMismatchOffForGood(t *testing.T) {
	f, _, m, days := r2512Sparse(t, 10)
	pullDay(f, days[4], 740, "Sales")
	f.mu.Lock()
	f.behave = func(w http.ResponseWriter, r *http.Request, id, body string) bool {
		if a, z := pinDates(body); id == dayHeadsID && z > a {
			fmt.Fprint(w, r2512RangeAnswer(f, a, z, map[string]bool{"740": true}))
			return true
		}
		return false
	}
	f.mu.Unlock()
	applyPeriodDays(r2512List(days...))
	pullRun(t, 120)
	if rs := r2512Ranges(f); len(rs) != 1 {
		t.Fatalf("ranges after a check that failed: %v", rs)
	}
	want := r2512Want(days)
	want[days[4]] = 1
	if fmt.Sprint(r2512Told(m)) != fmt.Sprint(want) {
		t.Fatalf("told %v", r2512Told(m))
	}
	if !strings.Contains(readText(pullRangeOffFile()), zz) || !strings.Contains(readText(logFile()), "ranges are off for this company for good") {
		t.Fatal("not kept or not logged")
	}
	// a new run (the bridge restarted): still off
	pullRangeReset()
	if _, why := pullRangeMay(pullItem{Company: zz, CGUID: b220CoGUID, Day: days[0], Fetch: true}); why != "off for good" {
		t.Fatalf("after a restart: %q", why)
	}
}

// 5. a range answer cut, in error, or over the 2 s stop: not used, NOT a stop of the company (as Tally being busy); its
// days read one by one, every day told; ranges off for the rest of the run
func TestR2512RangeBusyNotAStop(t *testing.T) {
	for name, how := range map[string]string{"cut": "cut", "error": "error", "over 2 s": "slow"} {
		t.Run(name, func(t *testing.T) {
			f, c, m, days := r2512Sparse(t, 9)
			stops := r1Stops(c)
			f.mu.Lock()
			f.behave = func(w http.ResponseWriter, r *http.Request, id, body string) bool {
				a, z := pinDates(body)
				if id != dayHeadsID || z <= a {
					return false
				}
				switch how {
				case "cut":
					fmt.Fprint(w, `<ENVELOPE><BODY><DATA><COLLECTION><VOUCHER REMOTEID="x" VCHTYPE="Sales"><DATE TYPE="Date">`+a+`</DATE>`)
					return true
				case "error":
					fmt.Fprint(w, `<ENVELOPE><BODY><DATA><LINEERROR>Could not set 'SVCurrentCompany'</LINEERROR></DATA></BODY></ENVELOPE>`)
					return true
				}
				return false
			}
			if how == "slow" {
				f.slow = func(id, body string) time.Duration {
					if a, z := pinDates(body); id == dayHeadsID && z > a {
						return 2500 * time.Millisecond
					}
					return 0
				}
			}
			f.mu.Unlock()
			applyPeriodDays(r2512List(days...))
			pullRun(t, 120)
			// the shared retry schedule's wait after a stop: the clock moved on, the read goes on by itself
			at := nowFn().Add(10 * time.Minute)
			nowFn = func() time.Time { return at }
			retryReset()
			pullRun(t, 120)
			if len(*stops) != 0 {
				t.Fatalf("the company stopped: %v", *stops)
			}
			if rs := r2512Ranges(f); len(rs) != 1 {
				t.Fatalf("ranges: %v", rs)
			}
			if fmt.Sprint(r2512Told(m)) != fmt.Sprint(r2512Want(days)) || len(m.upload) != 0 {
				t.Fatalf("told %v, upload %v", r2512Told(m), m.upload)
			}
			if _, why := pullRangeMay(pullItem{Company: zz, CGUID: b220CoGUID, Day: days[0], Fetch: true}); why != "off this run" || !strings.Contains(readText(logFile()), "taken as Tally being busy (nothing stopped)") {
				t.Fatalf("after it: %q", why)
			}
		})
	}
}

// 6. a row dated outside the range: the single-day rule's "date not applied" (the answer dropped, the day marked, no day
// asked of that Tally until the bridge restarts)
func TestR2512RangeDateNotApplied(t *testing.T) {
	f, _, m, days := r2512Sparse(t, 9)
	f.mu.Lock()
	f.behave = func(w http.ResponseWriter, r *http.Request, id, body string) bool {
		if a, z := pinDates(body); id == dayHeadsID && z > a {
			fmt.Fprint(w, r2512RangeAnswer(f, "20250101", "20251231", nil))
			return true
		}
		return false
	}
	f.mu.Unlock()
	applyPeriodDays(r2512List(days...))
	pullRun(t, 120)
	n := len(r2512HeadsAsked(f))
	if up := m.upload[days[3]]; up == nil || str(up["why"]) != "dates" || !strings.Contains(readText(logFile()), "the date was not applied") {
		t.Fatalf("the mark: %v", m.upload)
	}
	if _, had := r2512Told(m)[days[3]]; had {
		t.Fatal("a day of the dropped answer told")
	}
	applyPeriodDays(r2512List(days[4:]...))
	pullRun(t, 20)
	if len(r2512HeadsAsked(f)) != n {
		t.Fatal("another day asked of the same Tally")
	}
}

// 7. the sizes: 3 days first; +50% (a day more at least) only under 0.5 s, 31 days at most; halved over 0.8 s; a range
// cut so its predicted time stays under 0.8 s
func TestR2512RangeHalvingAndCap(t *testing.T) {
	for _, c := range [][3]int{{3, 300, 5}, {5, 300, 8}, {8, 499, 12}, {27, 300, 31}, {31, 100, 31}, {8, 500, 8}, {8, 800, 8}, {8, 801, 4}, {3, 900, 1}, {1, 900, 1}} {
		if got := pullRangeNext(c[0], c[1]); got != c[2] {
			t.Fatalf("after %d days in %d ms: %d, want %d", c[0], c[1], got, c[2])
		}
	}
	for _, c := range [][3]int{{31, 100, 8}, {31, 250, 3}, {31, 400, 2}, {31, 500, 1}, {5, 10, 5}, {31, 0, 31}} {
		if got := pullRangeCap(c[0], c[1]); got != c[2] {
			t.Fatalf("a range of %d at %d ms a day: %d, want %d", c[0], c[1], got, c[2])
		}
	}
	if pullRangeN(pullItem{Company: zz, CGUID: b220CoGUID, Day: "20250901", ChosenAt: "x"}) != 3 {
		t.Fatal("not 3 days at the start of a period")
	}
	if dayHeadsRangeRequest("ZZ", "20250901", "20251001") == "" || dayHeadsRangeRequest("ZZ", "20250901", "20251002") != "" || dayHeadsRangeRequest("ZZ", "20250902", "20250901") != "" {
		t.Fatal("the range bounds (31 days at most)")
	}
	// a range answered in 0.9 s halves the next; its time a day caps the one after
	f, _, _, days := r2512Sparse(t, 20)
	f.mu.Lock()
	f.slow = func(id, body string) time.Duration {
		if a, z := pinDates(body); id == dayHeadsID && z > a {
			return 900 * time.Millisecond
		}
		return 0
	}
	f.mu.Unlock()
	applyPeriodDays(r2512List(days...))
	pullRun(t, 200)
	it := pullItem{Company: zz, CGUID: b220CoGUID, Day: days[0], Fetch: true}
	if n := pullRangeN(it); n != 1 {
		t.Fatalf("after a 0.9 s answer of 3 days: %d days", n)
	}
	if rs := r2512Ranges(f); len(rs) != 1 {
		t.Fatalf("ranges: %v", rs)
	}
}

// 8. the dated guard: the range form only as built, while it is being asked, every day of it listed now
func TestR2512RangeGuard(t *testing.T) {
	_, _, _, days := r2512Sparse(t, 3)
	applyPeriodDays(pullList(days[0], days[1]))
	x := dayHeadsRangeRequest(zz, days[0], days[1])
	tc := recorderTC(nil)
	if dayHeadsExact(tc, x) {
		t.Fatal("let through while not being asked")
	}
	pull.mu.Lock()
	pull.rangeAsk = x
	pull.mu.Unlock()
	if !dayHeadsExact(tc, x) {
		t.Fatal("refused while asked")
	}
	y := dayHeadsRangeRequest(zz, days[0], days[2])
	pull.mu.Lock()
	pull.rangeAsk = y
	pull.mu.Unlock()
	if dayHeadsExact(tc, y) {
		t.Fatal("a day not listed let through")
	}
	pull.mu.Lock()
	pull.rangeAsk = ""
	pull.mu.Unlock()
}

// the second review's M2: a range stopped at 2 s that Tally has not finished within TallyAbandonWaitSec stops the
// company, as the group read (never a single day's list at Tally while it is still on the range); with
// TallyAbandonMaxSec 0 (Tally's end cannot be watched) no range is asked at all
func TestR2512RangeStoppedNotFinishedStopsCompany(t *testing.T) {
	f, c, m, days := r2512SparseWith(t, 9, `,"TallyAbandonMaxSec":600,"TallyAbandonWaitSec":1`)
	stops := r1Stops(c)
	f.mu.Lock()
	f.slow = func(id, body string) time.Duration {
		if a, z := pinDates(body); id == dayHeadsID && z > a {
			return 4 * time.Second
		}
		return 0
	}
	f.mu.Unlock()
	applyPeriodDays(r2512List(days...))
	pullRun(t, 120)
	if len(*stops) != 1 || str((*stops)[0]["why"]) != "over2s" {
		t.Fatalf("stops: %v", *stops)
	}
	if rs := r2512Ranges(f); len(rs) != 1 {
		t.Fatalf("ranges: %v", rs)
	}
	for _, d := range days[3:] {
		if _, had := r2512Told(m)[d]; had {
			t.Fatalf("%s told after the stop", d)
		}
	}
	time.Sleep(3 * time.Second) // (the stand's answer to the range ends)
}

func TestR2512NoRangeWhenTallyEndNotWatched(t *testing.T) {
	f, _, m, days := r2512SparseWith(t, 9, `,"TallyAbandonMaxSec":0`)
	applyPeriodDays(r2512List(days...))
	pullRun(t, 120)
	if rs := r2512Ranges(f); len(rs) != 0 {
		t.Fatalf("a range with TallyAbandonMaxSec 0: %v", rs)
	}
	if fmt.Sprint(r2512Told(m)) != fmt.Sprint(r2512Want(days)) {
		t.Fatalf("told %v", r2512Told(m))
	}
}

// the second review's L3: Tally's window held 2 s during a range stops the company, as for one day's list
func TestR2512RangeWindowHeldStopsCompany(t *testing.T) {
	f, c, _, days := r2512Sparse(t, 9)
	stops := r1Stops(c)
	old := windowHoldFn
	windowHoldFn = func() func(time.Time) int {
		pull.mu.Lock()
		rangeNow := pull.rangeAsk != ""
		pull.mu.Unlock()
		return func(time.Time) int {
			if rangeNow {
				return 2200
			}
			return 0
		}
	}
	t.Cleanup(func() { windowHoldFn = old })
	applyPeriodDays(r2512List(days...))
	pullRun(t, 120)
	if rs := r2512Ranges(f); len(rs) != 1 || len(*stops) != 1 || str((*stops)[0]["why"]) != "window" {
		t.Fatalf("ranges %v, stops %v", rs, *stops)
	}
}

// the second review's L4: a range-off file that cannot be read keeps ranges off for every company and is never written over
func TestR2512RangeOffFileUnreadable(t *testing.T) {
	_, _, _, days := r2512Sparse(t, 3)
	if err := saveFile(pullRangeOffFile(), "{not json"); err != nil {
		t.Fatal(err)
	}
	pullRangeReset()
	for _, co := range []string{zz, "Made Up Other Co"} {
		if _, why := pullRangeMay(pullItem{Company: co, CGUID: b220CoGUID, Day: days[0], Fetch: true}); why != "off for good" {
			t.Fatalf("%s: %q", co, why)
		}
	}
	pullRangeOffForGood(pullItem{Company: zz, CGUID: b220CoGUID, Day: days[0]}, "a made-up difference")
	if got := readText(pullRangeOffFile()); got != "{not json" {
		t.Fatalf("written over: %q", got)
	}
	if !strings.Contains(readText(logFile()), "cannot be read; ranges of day lists are off for every company") {
		t.Fatal("not logged")
	}
	// a readable file keeps the other companies' entries when one more is added
	if err := saveFile(pullRangeOffFile(), jsonText(M{"other|guid": M{"company": "Made Up Other Co"}})); err != nil {
		t.Fatal(err)
	}
	pullRangeReset()
	pullRangeOffForGood(pullItem{Company: zz, CGUID: b220CoGUID, Day: days[0]}, "a made-up difference")
	if got := readObjFile(pullRangeOffFile()); got["other|guid"] == nil || len(got) != 2 {
		t.Fatalf("the other entries lost: %v", got)
	}
}

// the final review: a range stopped at 2 s while Tally's window is held 2 s (also measured over the wait for Tally's end of
// it) stops the company for the window, as the group read; never taken as Tally being busy
func TestR2512RangeStoppedAndWindowHeldStopsCompany(t *testing.T) {
	f, c, _, days := r2512Sparse(t, 9)
	stops := r1Stops(c)
	f.mu.Lock()
	f.slow = func(id, body string) time.Duration {
		if a, z := pinDates(body); id == dayHeadsID && z > a {
			return 2500 * time.Millisecond
		}
		return 0
	}
	f.mu.Unlock()
	old := windowHoldFn
	windowHoldFn = func() func(time.Time) int {
		pull.mu.Lock()
		rangeNow := pull.rangeAsk != ""
		pull.mu.Unlock()
		return func(time.Time) int {
			if rangeNow {
				return 2300
			}
			return 0
		}
	}
	t.Cleanup(func() { windowHoldFn = old })
	applyPeriodDays(r2512List(days...))
	pullRun(t, 120)
	if rs := r2512Ranges(f); len(rs) != 1 || len(*stops) != 1 || str((*stops)[0]["why"]) != "window" {
		t.Fatalf("ranges %v, stops %v", rs, *stops)
	}
	if _, why := pullRangeMay(pullItem{Company: zz, CGUID: b220CoGUID, Day: days[0], Fetch: true}); why == "off this run" {
		t.Fatal("taken as Tally being busy")
	}
}
