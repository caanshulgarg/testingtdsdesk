package main

// FinCom Bridge 2.4.5, ROUND 104 (g10 of the real-Tally gate 39647340380; the owner's choice (a) of 22-Oct-2026).
// Written before the code. The period fetch ran about 165 entries a minute: each entry cost a TDSDeskCompanies, a
// FinComVoucherObject, two gentle waits of 150 ms and the per-step checks (about 0.37 s). Now, with no new request and no
// request changed:
//   - Tally's company list (TDSDeskCompanies) is asked once for the day being read, before its first entry, and again
//     at once after any error, any wait (a posting, the person at Tally, Tally busy or closed, ...), any use of the
//     computer or any save in Tally for the company since it was asked, a new day, or 10 minutes;
//   - at night (FinCom's periodNight, outside office hours) while nobody is at Tally, the period's requests rest 100 ms
//     before each send instead of GentleMs (150 ms), and the window check before a step is the probe of the request
//     just answered (its window watched to its end, under 250 ms) instead of a fresh look;
//   - kept: one request in flight, postings first, the 2 s stop (3 s a payroll entry), the freeze safety.

import (
	"context"
	"net/http"
	"strings"
	"testing"
	"time"
)

// the person away from the computer for an hour (on Linux the platform does not know: 99999, which keeps the list per entry)
func paceIdle(t *testing.T) {
	old := pullIdleFn
	pullIdleFn = func() float64 { return 3600 }
	t.Cleanup(func() { pullIdleFn = old })
}

// the requests sent after n0, and the FinComVoucherObject with no TDSDeskCompanies in its day since the last refusal
func paceIDs(f *standTally, n0 int) []string { return append([]string{}, f.ids()[n0:]...) }

func countID(ids []string, id string) int {
	n := 0
	for _, x := range ids {
		if x == id {
			n++
		}
	}
	return n
}

// (a) one company list for a day's entries, before the first of them; a second day: one more
func TestR245PaceCompanyListOnceADay(t *testing.T) {
	f, _, m := pullBridge(t)
	paceIdle(t)
	var types []string
	for i := 0; i < 30; i++ {
		types = append(types, "Sales")
	}
	pullDay(f, "20250915", 7000, types...)
	pullDay(f, "20250916", 8000, types[:10]...)
	applyPeriodDays(pullList("20250915", "20250916"))
	n0 := len(f.ids())
	pullRun(t, 40)
	ids := paceIDs(f, n0)
	if countID(ids, vchObjectID) != 40 || len(m.held) != 40 {
		t.Fatalf("%d entries asked, %d held (want 40): %v", countID(ids, vchObjectID), len(m.held), ids)
	}
	if n := countID(ids, "TDSDeskCompanies"); n != 2 {
		t.Fatalf("the company list asked %d times for 2 days of 40 entries (want 2): %v", n, ids)
	}
	// each day's first entry right after the company list (the crash guard of 2.3.4 holds for it)
	for i, id := range ids {
		if id == vchObjectID && (i == 0 || (ids[i-1] != "TDSDeskCompanies" && ids[i-1] != vchObjectID)) {
			t.Fatalf("an entry asked after %q: %v", ids[i-1], ids)
		}
	}
	first := -1
	for i, id := range ids {
		if id == vchObjectID {
			first = i
			break
		}
	}
	if first < 1 || ids[first-1] != "TDSDeskCompanies" {
		t.Fatalf("the first entry not right after the company list: %v", ids)
	}
}

// (a) asked again at once after an answer that could not be read, after a wait (a posting going first) and after the
// person used the computer
func TestR245PaceCompanyListAgainAfterErrorWaitOrPerson(t *testing.T) {
	f, _, _ := pullBridge(t)
	paceIdle(t)
	var types []string
	for i := 0; i < 12; i++ {
		types = append(types, "Sales")
	}
	pullDay(f, "20250915", 7000, types...)
	objs := 0
	f.mu.Lock()
	f.behave = func(w http.ResponseWriter, r *http.Request, id, body string) bool {
		if id == vchObjectID {
			objs++
			if objs == 3 {
				_, _ = w.Write([]byte("<RESPONSE>not an envelope</RESPONSE>"))
				return true
			}
		}
		return false
	}
	f.mu.Unlock()
	applyPeriodDays(pullList("20250915"))
	n0 := len(f.ids())
	// the heads, the heads to FinCom, then 4 entries: the 3rd entry's answer cannot be read
	for i := 0; i < 6; i++ {
		pullStep()
	}
	ids := paceIDs(f, n0)
	if countID(ids, vchObjectID) != 4 || countID(ids, "TDSDeskCompanies") != 2 {
		t.Fatalf("after an unreadable answer the company list is asked again: %v", ids)
	}
	if ids[len(ids)-2] != "TDSDeskCompanies" {
		t.Fatalf("not right before the entry after the error: %v", ids)
	}
	// a posting goes first: the step waits; the next entry asks the list again
	importsInFlight.Add(1)
	pullStep()
	importsInFlight.Add(-1)
	n1 := len(f.ids())
	pullStep()
	if ids := paceIDs(f, n1); len(ids) != 2 || ids[0] != "TDSDeskCompanies" || ids[1] != vchObjectID {
		t.Fatalf("after a wait: %v", ids)
	}
	pullStep()
	if ids := paceIDs(f, n1); len(ids) != 3 || ids[2] != vchObjectID {
		t.Fatalf("the next entry: %v", ids)
	}
	// the person used the computer since the list was asked
	old := pullIdleFn
	pullIdleFn = func() float64 { return 0 }
	n2 := len(f.ids())
	laterBy(t, time.Second)
	pullStep()
	pullIdleFn = old
	if ids := paceIDs(f, n2); len(ids) > 0 && ids[0] != "TDSDeskCompanies" {
		t.Fatalf("after the person used the computer: %v", ids)
	}
	// 10 minutes after the list: asked again
	n3 := len(f.ids())
	pullStep()
	laterBy(t, 11*time.Minute)
	pullStep()
	if ids := paceIDs(f, n3); countID(ids, "TDSDeskCompanies") < 1 {
		t.Fatalf("not asked again after 10 minutes: %v", ids)
	}
}

// (a) a save in Tally for the company since the list was asked: asked again (a company-changed sign)
func TestR245PaceCompanyListAgainAfterSave(t *testing.T) {
	_, _, _ = pullBridge(t)
	paceIdle(t)
	w := &pullWork{it: pullItem{Company: zz, CGUID: b220CoGUID, Day: "20250915"}}
	w.coAt, w.coReal, w.coPort = nowFn(), time.Now(), 9000
	if !pullCoListed(w, 9000) {
		t.Fatal("a fresh list not taken")
	}
	pullIdleFn = func() float64 { return 99999 }
	if pullCoListed(w, 9000) {
		t.Fatal("taken while the person's use of the computer is not known")
	}
	pullIdleFn = func() float64 { return 3600 }
	if pullCoListed(w, 9001) {
		t.Fatal("taken for another port")
	}
	old := pullSavedFn
	pullSavedFn = func(pullItem) time.Time { return time.Now().Add(time.Second) }
	t.Cleanup(func() { pullSavedFn = old })
	if pullCoListed(w, 9000) {
		t.Fatal("taken after a save in Tally")
	}
}

// (b) the night's lighter rest: the period's requests at night rest 100 ms, by day GentleMs; never more than GentleMs
func TestR245PaceNightGentle(t *testing.T) {
	_, _, _ = pullBridge(t)
	setCfg("GentleMs", float64(150))
	applyPeriodDays(nightList(1, false))
	if g := pullGentleMs(); g != 0 {
		t.Fatalf("by day the period rests %d ms (want the setting's)", g)
	}
	applyPeriodDays(nightList(1, true))
	if g := pullGentleMs(); g != 100 {
		t.Fatalf("at night the period rests %d ms (want 100)", g)
	}
	setCfg("GentleMs", float64(60))
	if g := pullGentleMs(); g != 0 {
		t.Fatalf("a setting under 100 ms: %d", g)
	}
	// tallyRaw: the TC's lower rest wins over the setting, never a higher one
	setCfg("GentleMs", float64(400))
	ctx := context.WithValue(context.Background(), gentleKey{}, 100)
	if g := gentleFor(ctx); g != 100 {
		t.Fatalf("gentle %d", g)
	}
	if g := gentleFor(context.WithValue(context.Background(), gentleKey{}, 900)); g != 400 {
		t.Fatalf("gentle above the setting: %d", g)
	}
	if g := gentleFor(context.Background()); g != 400 {
		t.Fatalf("gentle with nothing set: %d", g)
	}
}

// (b) at night the window check before a step is the probe of the request just answered; by day a fresh look each step
func TestR245PaceNightWindowLook(t *testing.T) {
	f, _, _ := pullBridge(t)
	var types []string
	for i := 0; i < 10; i++ {
		types = append(types, "Sales")
	}
	pullDay(f, "20250930", 7000, types...)
	looks := 0
	old := pullRespondsFn
	pullRespondsFn = func() bool { looks++; return true }
	t.Cleanup(func() { pullRespondsFn = old })
	applyPeriodDays(nightList(1, false))
	pullRun(t, 20)
	day := looks
	if day < 10 {
		t.Fatalf("by day %d looks for 11 steps", day)
	}
	pullReset()
	pullDay(f, "20250929", 7100, types...)
	applyPeriodDays(M{"periodDays": []any{M{"company": zz, "company_guid": b220CoGUID, "day": "20250929", "fetch": true}}, "periodNight": true})
	looks = 0
	pullRun(t, 20)
	if looks > 3 {
		t.Fatalf("at night %d looks for 11 steps (the last request's probe stands for it)", looks)
	}
	if !strings.Contains(strings.Join(f.ids(), ","), vchObjectID) {
		t.Fatal("nothing asked")
	}
}
