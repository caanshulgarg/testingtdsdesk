package main

// FinCom Bridge 2.4.5, ROUND 103 (the owner's decisions of 21-Oct-2026, evening). Written before the code.
//
// A. Night / Sunday pace: outside office hours (FinCom says so in the beat answer, periodNight; the hours are the owner's,
//    per computer, on FinCom's Tally page) one beat answer may list up to 30 days (3 by day); the bridge reads day after
//    day while Tally is idle and asks FinCom for the next days as soon as it has finished the listed ones (an early beat,
//    at most one every DayPullNightBeatSec); every request keeps its 2 s stop, the freeze safety, postings first and the
//    per-computer switch (periodFetch false wins over periodNight).
// B. Payroll in the old-period fetch (the owner's decision of 12-Oct-2026 kept): a payroll voucher listed by FinComDayHeads
//    is fetched through the same payroll path (FinComVoucherObject, the employees' pay-head allocations kept, a salary
//    payment's BANKEMPLOYEENAME and AMOUNT only, the bank details stripped); its entry request may take 3 s and its
//    freeze-safety threshold is 3 s, every other request 2 s; the payroll's employees (FinComEmployees) are read and sent
//    before the first payroll entry of the period, so its employee rows link; a payroll voucher counts like any other.

import (
	"fmt"
	"net/http"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func nightList(n int, night bool) M {
	var days []string
	d := time.Date(2025, 9, 30, 0, 0, 0, 0, time.UTC)
	for i := 0; i < n; i++ {
		days = append(days, d.AddDate(0, 0, -i).Format("20060102"))
	}
	l := pullList(days...)
	if night {
		l["periodNight"] = true
	}
	return l
}

func pullItemsN() int {
	pull.mu.Lock()
	defer pull.mu.Unlock()
	return len(pull.items)
}

// A1: up to 30 days an answer at night, 3 by day; the switch off wins
func TestR245NightThirtyDaysAnAnswer(t *testing.T) {
	_, _, _ = pullBridge(t)
	applyPeriodDays(nightList(40, false))
	if n := pullItemsN(); n != 3 {
		t.Fatalf("by day: %d days taken, want 3", n)
	}
	applyPeriodDays(nightList(40, true))
	if n := pullItemsN(); n != 30 {
		t.Fatalf("at night: %d days taken, want 30", n)
	}
	if !pullNight() {
		t.Fatal("the night pace not taken")
	}
	setCfg("DayPullNightDays", float64(500))
	applyPeriodDays(nightList(40, true))
	if n := pullItemsN(); n != 30 {
		t.Fatalf("a setting above 30: %d days taken", n)
	}
	l := nightList(10, true)
	l["periodFetch"] = false
	applyPeriodDays(l)
	if n := pullItemsN(); n != 0 || pullNight() {
		t.Fatalf("the computer's switch off at night: %d days, night %v", n, pullNight())
	}
	// the next answer by day: the day pace again
	applyPeriodDays(nightList(10, false))
	if n := pullItemsN(); n != 3 || pullNight() {
		t.Fatalf("back by day: %d days, night %v", n, pullNight())
	}
}

// A2: at night the listed days are read one after another without waiting for the next beat; FinCom is asked for more
// days as soon as they are done (at most one early beat every DayPullNightBeatSec); by day the beat keeps its own time
func TestR245NightContinuousAndEarlyBeat(t *testing.T) {
	f, _, m := pullBridge(t)
	for i, d := range []string{"20250930", "20250929", "20250928", "20250927", "20250926"} {
		pullDay(f, d, int64(1000+100*i), "Sales", "Receipt")
	}
	drain := func() bool {
		select {
		case <-beatNow:
			return true
		default:
			return false
		}
	}
	drain()
	applyPeriodDays(nightList(5, true))
	pullRun(t, 40)
	if len(m.heads) != 5 || f.n(vchObjectID) != 10 {
		t.Fatalf("at night: %d days' lists told, %d entries asked (want 5, 10)", len(m.heads), f.n(vchObjectID))
	}
	pullAfterTurn(0)
	if !drain() {
		t.Fatal("no early beat after the night's listed days were done")
	}
	pullAfterTurn(0)
	if drain() {
		t.Fatal("a second early beat at once")
	}
	at := nowFn().Add(time.Duration(pullNightBeatSec()+1) * time.Second)
	nowFn = func() time.Time { return at }
	pullAfterTurn(0)
	if !drain() {
		t.Fatal("no early beat after the gap")
	}
	// by day: never an early beat
	applyPeriodDays(nightList(1, false))
	pullRun(t, 10)
	at = at.Add(time.Hour)
	pullAfterTurn(0)
	if drain() {
		t.Fatal("an early beat by day")
	}
}

// A3: the night pace sends more in one turn, each request still under the 2 s stop, one in flight, postings first
func TestR245NightTurnPaceAndRules(t *testing.T) {
	f, _, _ := pullBridge(t)
	var types []string
	for i := 0; i < 120; i++ {
		types = append(types, "Sales")
	}
	pullDay(f, "20250930", 5000, types...)
	applyPeriodDays(nightList(1, false))
	pullTurn()
	day := f.n(vchObjectID)
	if day > pullPerTurnDay() {
		t.Fatalf("by day %d entries in one turn (at most %d)", day, pullPerTurnDay())
	}
	pullReset()
	applyPeriodDays(nightList(1, true))
	n0 := f.n(vchObjectID)
	pullTurn()
	if got := f.n(vchObjectID) - n0; got <= pullPerTurnDay() {
		t.Fatalf("at night only %d entries in one turn", got)
	}
	f.mu.Lock()
	mf := f.maxFlight
	f.mu.Unlock()
	if mf != 1 {
		t.Fatalf("%d requests in flight", mf)
	}
	// a posting goes first at night too
	importsInFlight.Add(1)
	n1 := len(f.ids())
	pullReset()
	applyPeriodDays(nightList(1, true))
	pullTurn()
	importsInFlight.Add(-1)
	if len(f.ids()) != n1 {
		t.Fatalf("asked during a posting at night: %v", f.ids()[n1:])
	}
}

// A4: a day's list over 2 s stops the company at night as by day (the freeze safety does not move at night)
func TestR245NightOver2sStillStops(t *testing.T) {
	f, c, _ := pullBridge(t)
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
	pullDay(f, "20250930", 1000, "Sales")
	pullDay(f, "20250929", 1100, "Sales")
	f.mu.Lock()
	f.slow = func(id, body string) time.Duration {
		if id == dayHeadsID {
			return 2300 * time.Millisecond
		}
		return 0
	}
	f.mu.Unlock()
	applyPeriodDays(nightList(2, true))
	pullRun(t, 10)
	c.mu.Lock()
	ns := len(stops)
	c.mu.Unlock()
	if f.n(dayHeadsID) != 1 || ns != 1 {
		t.Fatalf("at night a list over 2 s: %d lists asked, %d stops", f.n(dayHeadsID), ns)
	}
}

// --- B. payroll

const payGUID = "bfec5f89-b32b-4e27-997d-61327b6f137c"

// the real 7.1 answers (testdata/payroll244, run 38253610530), moved onto a day of the period chosen
func payFixture(t *testing.T, name, from, day string) string {
	return strings.ReplaceAll(gz242(t, filepath.Join("testdata", "payroll244", "7.1", name)), from, day)
}

type payStand struct {
	delay map[string]time.Duration // MasterID -> how late Tally answers its entry
	body  map[string]string        // MasterID -> Tally's whole answer
}

// a payroll voucher (MasterID 7, 500 employees) and a salary payment (MasterID 5) on 30-Sep-2025, with an ordinary Sales
func payDay(t *testing.T, f *standTally) *payStand {
	ps := &payStand{delay: map[string]time.Duration{}, body: map[string]string{
		"7": payFixture(t, "obj-PR-BULK-500.xml.gz", "20261031", "20250930"),
		"5": payFixture(t, "obj-SAL-PAY-NOV.xml.gz", "20261202", "20250930"),
	}}
	f.mu.Lock()
	f.vch = append(f.vch, &tVch{guid: payGUID + "-00000007", master: "7", date: "20250930", typ: "Payroll", no: "1", alter: 7},
		&tVch{guid: payGUID + "-00000005", master: "5", date: "20250930", typ: "Payment", no: "2", alter: 5})
	f.behave = func(w http.ResponseWriter, r *http.Request, id, body string) bool {
		if id != vchObjectID {
			return false
		}
		mid := group(`<ID TYPE="Name">ID:(\d+)</ID>`, body, 1)
		b, ok := ps.body[mid]
		if !ok {
			return false
		}
		if d := ps.delay[mid]; d > 0 {
			select {
			case <-time.After(d):
			case <-r.Context().Done():
				return true
			}
		}
		fmt.Fprint(w, b)
		return true
	}
	f.mu.Unlock()
	pullDay(f, "20250930", 900, "Sales")
	return ps
}

func payEmployees(t *testing.T, f *standTally) {
	pay244AddEmp(f, "Office Staff", "", true, true, "")
	pay244AddEmp(f, "FC Emp One", "Office Staff", true, false, "ABCPR1234K")
	pay244AddEmp(f, "FC Emp Two", "Office Staff", true, false, "ABCPK4321L")
	led231Numbers(t, f)
}

func sentEntries(m *pullModel) map[string]string {
	out := map[string]string{}
	for _, e := range m.entries {
		for _, x := range arr(e["vouchers"]) {
			out[strings.TrimLeft(tagNum(str(x), "MASTERID"), "0")] = str(x)
		}
	}
	return out
}

// B1: the payroll voucher of an old day through the payroll path: answered in 2.5 s (under its 3 s), kept whole with
// every employee's pay heads; the salary payment with BANKEMPLOYEENAME and AMOUNT only; the employees read and sent first;
// the payroll voucher counted in the day's list like any other
func TestR245PullPayrollEntry(t *testing.T) {
	f, c, m := pullBridge(t)
	payEmployees(t, f)
	ps := payDay(t, f)
	ps.delay["7"] = 2500 * time.Millisecond
	applyPeriodDays(pullList("20250930"))
	pullRun(t, 30)
	got := sentEntries(m)
	if len(got) != 3 {
		t.Fatalf("%d entries sent, want 3 (the payroll, the salary payment, the sale): %v", len(got), f.ids())
	}
	pr := got["7"]
	if n := strings.Count(pr, "<COSTCENTREALLOCATIONS.LIST>"); n != 3500 || !strings.Contains(pr, "<VOUCHERTYPENAME>Payroll</VOUCHERTYPENAME>") {
		t.Fatalf("the 500-employee payroll as sent: %d allocations", n)
	}
	sal := got["5"]
	if !strings.Contains(sal, "<BANKEMPLOYEENAME>") {
		t.Fatal("the salary payment lost the employee's name")
	}
	for _, x := range []string{pr, sal} {
		for _, bad := range []string{"ACCOUNTNUMBER", "IFSCODE", "PAYMENTFAVOURING", "BENEFICIARYCODE", "SWIFTCODE"} {
			if strings.Contains(x, bad) {
				t.Fatalf("%s sent to FinCom", bad)
			}
		}
	}
	// the day's list counts the payroll voucher like any other
	if m.n["20250930"] != 3 {
		t.Fatalf("Tally's count of the day as told: %d (want 3)", m.n["20250930"])
	}
	types := map[string]bool{}
	for _, h := range arr(m.heads[0]["heads"]) {
		types[str(arr(h)[3])] = true
	}
	if !types["Payroll"] {
		t.Fatalf("the payroll voucher's type not told: %v", m.heads[0]["heads"])
	}
	// the employees were read (FinComEmployees, undated) and taken by FinCom before the payroll entry was asked
	ids := f.ids()
	firstEmp, firstPay := -1, -1
	f.mu.Lock()
	for i, id := range f.reqs {
		if id == empListID && firstEmp < 0 {
			firstEmp = i
		}
		if id == vchObjectID && strings.Contains(f.bodies[i], "ID:7<") && firstPay < 0 {
			firstPay = i
		}
	}
	f.mu.Unlock()
	c.mu.Lock()
	ne := len(c.empPosts)
	c.mu.Unlock()
	if firstEmp < 0 || firstPay < 0 || firstEmp > firstPay || ne != 1 {
		t.Fatalf("the employees first: employees at %d, payroll at %d, %d lists sent: %v", firstEmp, firstPay, ne, ids)
	}
	// not stopped: a payroll entry within its 3 s is in time
	pull.mu.Lock()
	ns := len(pull.stopCo)
	pull.mu.Unlock()
	if ns != 0 {
		t.Fatal("the period stopped on a payroll entry answered in 2.5 s")
	}
}

// B2: an ordinary entry answered in 2.5 s stops the period (2 s); a payroll entry over 3 s stops it too
func TestR245PullPayrollLimitOnlyPayroll(t *testing.T) {
	for _, tc := range []struct {
		mid   string
		delay time.Duration
		stop  bool
	}{{"5", 2500 * time.Millisecond, true}, {"7", 3400 * time.Millisecond, true}} {
		f, c, _ := pullBridge(t)
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
		payEmployees(t, f)
		ps := payDay(t, f)
		ps.delay[tc.mid] = tc.delay
		applyPeriodDays(pullList("20250930"))
		pullRun(t, 30)
		c.mu.Lock()
		ns := len(stops)
		c.mu.Unlock()
		if (ns == 1) != tc.stop || ns == 1 && str(stops[0]["why"]) != "over2s" {
			t.Fatalf("MasterID %s answered in %v: %d stops %v", tc.mid, tc.delay, ns, stops)
		}
		time.Sleep(tc.delay) // Tally finishes before the next test asks
	}
}

// B3: the freeze-safety threshold: Tally's window held 2.3 s while a payroll entry was at Tally does not stop; held 2.3 s
// for an ordinary entry stops; held 3.1 s for a payroll entry stops
func TestR245PullPayrollWindowThreshold(t *testing.T) {
	for _, tc := range []struct {
		mid    string
		holdMs int
		stop   bool
	}{{"7", 2300, false}, {"5", 2300, true}, {"7", 3100, true}} {
		f, c, m := pullBridge(t)
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
		payEmployees(t, f)
		ps := payDay(t, f)
		delete(ps.body, map[string]string{"7": "5", "5": "7"}[tc.mid]) // only the one under test is in the day
		f.mu.Lock()
		var keep []*tVch
		for _, v := range f.vch {
			if v.master == tc.mid || v.date != "20250930" {
				keep = append(keep, v)
			}
		}
		f.vch = keep
		f.mu.Unlock()
		old := windowHoldFn
		hold := tc.holdMs
		// the list of the day is not held (only the entry under test)
		listed := false
		windowHoldFn = func() func(time.Time) int {
			if !listed {
				listed = true
				return func(time.Time) int { return 0 }
			}
			return func(time.Time) int { return hold }
		}
		applyPeriodDays(pullList("20250930"))
		pullRun(t, 30)
		windowHoldFn = old
		c.mu.Lock()
		ns := len(stops)
		c.mu.Unlock()
		if (ns > 0) != tc.stop {
			t.Fatalf("MasterID %s, window held %d ms: %d stops (want stop %v), sent %d", tc.mid, tc.holdMs, ns, tc.stop, len(sentEntries(m)))
		}
	}
}

// B4: a day without a payroll voucher reads no employees; the employees not readable (FinCom does not take them): the
// payroll entry waits, nothing of it asked
func TestR245PullPayrollEmployeesOnlyWhenNeeded(t *testing.T) {
	f, c, m := pullBridge(t)
	payEmployees(t, f)
	pullDay(f, "20250929", 900, "Sales", "Receipt")
	applyPeriodDays(pullList("20250929"))
	pullRun(t, 20)
	if f.n(empListID) != 0 || len(sentEntries(m)) != 2 {
		t.Fatalf("a day without payroll: %d employee requests, %d sent", f.n(empListID), len(sentEntries(m)))
	}
	c.mu.Lock()
	c.empReply = func(b M) (int, M) { return 500, M{"error": "down"} }
	c.mu.Unlock()
	payDay(t, f)
	at := nowFn().Add(3 * time.Minute)
	nowFn = func() time.Time { return at }
	applyPeriodDays(pullList("20250930"))
	pullRun(t, 20)
	f.mu.Lock()
	for i, id := range f.reqs {
		if id == vchObjectID && strings.Contains(f.bodies[i], "ID:7<") {
			f.mu.Unlock()
			t.Fatal("the payroll entry asked before FinCom took the employees")
		}
	}
	f.mu.Unlock()
	if f.n(empListID) == 0 {
		t.Fatal("the employees not read before the payroll entry")
	}
}
