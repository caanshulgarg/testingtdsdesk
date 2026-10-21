package main

// FinCom Bridge 2.4.5, review round 15 (21-Oct-2026). Written before the code.
//
// M1: a payroll entry waiting for its employees never holds the computer's period fetch for ever: the day's other entries
//     are read first; the wait is bounded (EmployeeWaitTries tries a minute apart, EmployeeWaitMin minutes); then what was
//     read is sent, the payroll entries are left out, the day is marked "upload" (words naming the payroll) and the other
//     days go on.
// M2: the employees' read inside the period fetch sends ONE request a step, each after the six conditions (pause, read
//     stop, a person at Tally ...), Tally's window watched; a request over its 2 s stop or a window held 2 s stops the
//     company and is never asked again by itself.
// L1: the night flag only when a listed day is left to read once the list is filtered: no early beats all night for days
//     this bridge does not read.
// L2: the employees' check answers for the day's own company GUID, never another company's of the same name.
// L3 (the owner's decision of 21-Oct-2026): a payroll entry may hold Tally's window up to 3 s (as its 3 s request stop);
//     every other request, the employees' read included, 2 s (TestR245PullPayrollWindowThreshold and below).

import (
	"strings"
	"testing"
	"time"
)

func r15Stops(c *standCloud) *[]M {
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
	return &stops
}

func r15PayrollAsked(f *standTally) bool {
	f.mu.Lock()
	defer f.mu.Unlock()
	for i, id := range f.reqs {
		if id == vchObjectID && strings.Contains(f.bodies[i], "ID:7<") {
			return true
		}
	}
	return false
}

// M1: FinCom never takes the employees: the day's Sales and salary payment are read and sent, the payroll entry never
// asked; after the tries the day is marked "upload" naming the payroll, and the next day is read
func TestR245R15PayrollWaitBounded(t *testing.T) {
	f, c, m := pullBridge(t)
	payEmployees(t, f)
	c.mu.Lock()
	c.empReply = func(b M) (int, M) { return 500, M{"error": "down"} }
	c.mu.Unlock()
	payDay(t, f)
	pullDay(f, "20250929", 950, "Sales", "Receipt")
	at := nowFn()
	applyPeriodDays(pullList("20250930", "20250929"))
	for i := 0; i < 8; i++ {
		pullRun(t, 20)
		at = at.Add(61 * time.Second)
		nowFn = func() time.Time { return at }
	}
	if r15PayrollAsked(f) {
		t.Fatal("the payroll entry asked though FinCom never took its employees")
	}
	got := sentEntries(m)
	if got["900"] == "" || got["5"] == "" {
		t.Fatalf("the day's other entries not sent while the payroll waited: %v", got)
	}
	up := m.upload["20250930"]
	if up == nil || str(up["why"]) != "payroll" || !strings.Contains(str(up["words"]), "payroll") {
		t.Fatalf("the day not marked upload for its payroll: %v", m.upload)
	}
	if got["950"] == "" || got["951"] == "" {
		t.Fatalf("the next day not read after the payroll wait ended: %v", got)
	}
	if n := f.n(empListID); n == 0 || n > 6 {
		t.Fatalf("%d employee requests (want a few, bounded)", n)
	}
}

// M1: the wait is bounded in time too (a read that keeps going, a person at Tally, ...)
func TestR245R15PayrollWaitMinutes(t *testing.T) {
	f, c, m := pullBridge(t)
	payEmployees(t, f)
	c.mu.Lock()
	c.empReply = func(b M) (int, M) { return 500, M{"error": "down"} }
	c.mu.Unlock()
	payDay(t, f)
	setCfg("EmployeeWaitTries", float64(100))
	at := nowFn()
	applyPeriodDays(pullList("20250930"))
	for i := 0; i < 15; i++ {
		pullRun(t, 20)
		at = at.Add(61 * time.Second)
		nowFn = func() time.Time { return at }
	}
	if up := m.upload["20250930"]; up == nil || str(up["why"]) != "payroll" {
		t.Fatalf("10 minutes on: the day not marked upload: %v", m.upload)
	}
}

// M2: one employees' request a step, the conditions looked at before each: paused after the first, nothing more asked
func TestR245R15EmployeesOneRequestAStep(t *testing.T) {
	f, _, _ := pullBridge(t)
	setCfg("EmployeeChunk", float64(1))
	payEmployees(t, f)
	ps := payDay(t, f)
	delete(ps.body, "5")
	f.mu.Lock()
	var keep []*tVch
	for _, v := range f.vch {
		if v.master == "7" || v.date != "20250930" {
			keep = append(keep, v)
		}
	}
	f.vch = keep
	f.mu.Unlock()
	applyPeriodDays(pullList("20250930"))
	for i := 0; i < 10 && f.n(empListID) == 0; i++ {
		n0 := f.n(empListID)
		pullStep()
		if d := f.n(empListID) - n0; d > 1 {
			t.Fatalf("%d employee requests in one step", d)
		}
	}
	if f.n(empListID) != 1 {
		t.Fatalf("%d employee requests before the pause", f.n(empListID))
	}
	setPaused(true)
	defer setPaused(false)
	for i := 0; i < 5; i++ {
		pullStep()
	}
	if f.n(empListID) != 1 {
		t.Fatalf("paused: %d employee requests", f.n(empListID))
	}
	setPaused(false)
	for i := 0; i < 40; i++ {
		n0 := f.n(empListID)
		pullStep()
		if d := f.n(empListID) - n0; d > 1 {
			t.Fatalf("%d employee requests in one step", d)
		}
	}
	if !r15PayrollAsked(f) || f.n(empListID) < 3 {
		t.Fatalf("the employees read step by step, then the payroll entry: %d employee requests, payroll asked %v", f.n(empListID), r15PayrollAsked(f))
	}
}

// M2: an employees' request over its 2 s stop, or Tally's window held 2 s while it was at Tally, stops the company: never
// asked again by itself
func TestR245R15EmployeesOver2sStops(t *testing.T) {
	for _, tc := range []struct {
		slow   time.Duration
		holdMs int
		why    string
	}{{2300 * time.Millisecond, 0, "over2s"}, {0, 2100, "window"}} {
		f, c, _ := pullBridge(t)
		stops := r15Stops(c)
		payEmployees(t, f)
		payDay(t, f)
		f.mu.Lock()
		f.slow = func(id, body string) time.Duration {
			if id == empListID {
				return tc.slow
			}
			return 0
		}
		f.mu.Unlock()
		old := windowHoldFn
		windowHoldFn = func() func(time.Time) int { return func(time.Time) int { return 0 } }
		if tc.holdMs > 0 {
			windowHoldFn = func() func(time.Time) int {
				return func(time.Time) int {
					if f.n(empListID) > 0 {
						return tc.holdMs
					}
					return 0
				}
			}
		}
		applyPeriodDays(pullList("20250930"))
		at := nowFn()
		for i := 0; i < 4; i++ {
			pullRun(t, 20)
			at = at.Add(61 * time.Second)
			nowFn = func() time.Time { return at }
		}
		windowHoldFn = old
		c.mu.Lock()
		ns := len(*stops)
		why := ""
		if ns > 0 {
			why = str((*stops)[0]["why"])
		}
		c.mu.Unlock()
		if ns != 1 || why != tc.why || f.n(empListID) != 1 {
			t.Fatalf("%s: %d stops (%s), %d employee requests (want 1 stop, 1 request)", tc.why, ns, why, f.n(empListID))
		}
		if r15PayrollAsked(f) {
			t.Fatalf("%s: the payroll entry asked after the stop", tc.why)
		}
		time.Sleep(tc.slow)
	}
}

// L1: at night, every listed day another company GUID's: no night pace, no early beat
func TestR245R15NightOnlyWhenADayIsLeft(t *testing.T) {
	_, _, _ = pullBridge(t)
	for {
		select {
		case <-beatNow:
			continue
		default:
		}
		break
	}
	l := nightList(5, true)
	for _, x := range arr(l["periodDays"]) {
		obj(x)["company_guid"] = "00000000-0000-0000-0000-000000000001"
	}
	applyPeriodDays(l)
	if pullNight() {
		t.Fatal("the night pace taken for days this bridge does not read")
	}
	pullAfterTurn(0)
	select {
	case <-beatNow:
		t.Fatal("an early beat for days this bridge does not read")
	default:
	}
	applyPeriodDays(nightList(5, true))
	if !pullNight() {
		t.Fatal("the night pace not taken for days to read")
	}
}

// L2: the employees taken for this company's GUID only
func TestR245R15EmployeesTakenForTheGUID(t *testing.T) {
	_, _, _ = pullBridge(t)
	g := heldGUID(zz)
	if g == "" {
		t.Fatal("no GUID held")
	}
	empPut(companyKey(zz)+"|"+g, M{"sent": true})
	if !employeesTakenFor(zz, g) {
		t.Fatal("not taken for the company's own GUID")
	}
	if employeesTakenFor(zz, "00000000-0000-0000-0000-000000000001") {
		t.Fatal("taken for another company GUID of the same name")
	}
}
