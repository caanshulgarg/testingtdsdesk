package main

// FinCom Bridge 2.4.5, ROUND 104 (g4 of the real-Tally gate 39647340380). Written before the code (keepauto.go).
// The undated TDSDeskKeepList above an AlterID kept Tally busy 1.9-5.1 s on a 30,000-voucher company and its window
// did not answer for up to 4.8 s. In the bridge's own automatic work (source B, the nightly self-check, the bank-date
// route by day and by night) it goes only for a company of at most 5,000 vouchers by Tally's voucher counter, and never
// again for a company after Tally's window did not answer for 2 s while it listed. The person's tools keep it. No
// request added or changed.

import (
	"os"
	"regexp"
	"strings"
	"testing"
	"time"
)

// the stand's counters stand for a company's size in these tests: the real guard (5,000) unless a test says otherwise
func keepAutoMaxSet(t *testing.T, n int64) {
	t.Helper()
	old := keepAutoMaxVch
	keepAutoMaxVch = n
	t.Cleanup(func() { keepAutoMaxVch = old })
}

func keepAutoReset() {
	keepAuto.mu.Lock()
	keepAuto.off, keepAuto.dir = nil, ""
	keepAuto.mu.Unlock()
}

// a source-B bridge whose company's voucher counter is `alter` (the starting point recorded there)
func keepBigSourceB(t *testing.T, alter int64) (*standTally, []M) {
	t.Helper()
	_, f, _ := liveBridge(t, "")
	keepAutoReset()
	t.Cleanup(keepAutoReset)
	applyRecorderSource(M{"recorderSource": "alterid"})
	f.mu.Lock()
	f.alter = alter
	f.mu.Unlock()
	td := today()
	f.add(td, fgParty, "KB-1", "one", "-1.00")
	sessions := openCompaniesWith(fin, true)
	lightCheckOpen(sessions) // the starting point (nothing above it: nothing asked)
	f.mu.Lock()
	f.add(td, fgParty, "KB-2", "two", "-1.00")
	f.mu.Unlock()
	_, _ = companyCheck(fin, zz, f.port)
	return f, sessions
}

func TestR245KeepAutoDefaultAndSetting(t *testing.T) {
	_, _, _ = liveBridge(t, "")
	if keepAutoMax() != 5000 {
		t.Fatalf("the guard %d, want 5,000 vouchers", keepAutoMax())
	}
	setCfg("KeepListAutoMaxVch", float64(100000))
	if keepAutoMax() != 5000 {
		t.Fatalf("a setting raised the guard to %d", keepAutoMax())
	}
	setCfg("KeepListAutoMaxVch", float64(1000))
	if keepAutoMax() != 1000 {
		t.Fatalf("a setting did not lower the guard: %d", keepAutoMax())
	}
}

// g4: source B on a company of more than 5,000 vouchers: nothing sent, one quiet line; a small company is still asked
func TestR245KeepAutoSourceBBigCompanyNotAsked(t *testing.T) {
	f, _ := keepBigSourceB(t, 30000)
	n, err := liveSourceB(zz, f.port)
	if err != nil || n != 0 || f.n("TDSDeskKeepList") != 0 {
		t.Fatalf("source B on a 30,000-voucher company: %d %v, lists %d", n, err, f.n("TDSDeskKeepList"))
	}
	laterBy(t, 2*time.Minute)
	_, _ = liveSourceB(zz, f.port)
	if f.n("TDSDeskKeepList") != 0 || logLines("Tally's list of changed entries is not asked (the company has up to") != 1 {
		t.Fatalf("lists %d; the quiet line once:\n%s", f.n("TDSDeskKeepList"), cutTail(readText(logFile()), 2000))
	}
}

func TestR245KeepAutoSourceBSmallCompanyAsked(t *testing.T) {
	f, _ := keepBigSourceB(t, 4000)
	if n, err := liveSourceB(zz, f.port); err != nil || n != 1 || f.n("TDSDeskKeepList") != 1 {
		t.Fatalf("source B on a 4,000-voucher company: %d %v, lists %d", n, err, f.n("TDSDeskKeepList"))
	}
}

// the freeze safety: Tally's window held 2 s or more while the list was at Tally: never asked again for that company by
// the bridge's own work, across a restart
func TestR245KeepAutoWindowHoldStopsForGood(t *testing.T) {
	f, _ := keepBigSourceB(t, 100)
	old := windowHoldFn
	windowHoldFn = func() func(time.Time) int { return func(time.Time) int { return 2300 } }
	t.Cleanup(func() { windowHoldFn = old })
	if n, err := liveSourceB(zz, f.port); err != nil || n != 1 || f.n("TDSDeskKeepList") != 1 {
		t.Fatalf("the first list: %d %v", n, err)
	}
	if why := keepAutoBlocked(zz, b220CoGUID); why == "" {
		if why2 := keepAutoBlocked(zz, heldGUID(zz)); why2 == "" {
			t.Fatal("not stopped after a 2.3 s window hold")
		}
	}
	if logLines("Tally's window did not answer for 2.3 s while it listed the changed entries; the bridge does not ask that list for this company again") != 1 {
		t.Fatalf("the log:\n%s", cutTail(readText(logFile()), 2000))
	}
	windowHoldFn = old
	keepAutoReset() // a restart: read again from sync\keeplist-auto.json
	f.mu.Lock()
	f.add(today(), fgParty, "KB-3", "three", "-1.00")
	f.mu.Unlock()
	_, _ = companyCheck(fin, zz, f.port)
	laterBy(t, 2*time.Minute)
	if n, _ := liveSourceB(zz, f.port); n != 0 || f.n("TDSDeskKeepList") != 1 {
		t.Fatalf("asked again after the hold: %d lists", f.n("TDSDeskKeepList"))
	}
}

// the nightly self-check on a company over the guard: Tally is not asked; recorded "not checked" with its words
func TestR245KeepAutoSelfCheckBigCompany(t *testing.T) {
	f, c := scBridge(t, "")
	keepAutoReset()
	t.Cleanup(keepAutoReset)
	for i, d := range []string{"20261006", "20261006"} {
		f.add(d, "Party B", string(rune('2'+i)), "", "50.00")
	}
	led231Numbers(t, f)
	setCfg("KeepListAutoMaxVch", float64(1)) // the company (counter 3) stands for one over the guard
	r, err := selfCheckStart(zz, f.port)
	if err != nil || r == nil {
		t.Fatalf("not started: %v %v", r, err)
	}
	if f.n("TDSDeskKeepList") != 0 {
		t.Fatalf("the list was sent: %v", f.ids())
	}
	if !strings.Contains(r.stopped, "more than 5,000 vouchers") && !strings.Contains(r.stopped, "Tally would take longer than 2 s") {
		t.Fatalf("stopped: %q", r.stopped)
	}
	if err := selfCheckFinish(r); err != nil {
		t.Fatal(err)
	}
	rec := scSteps(c, "record")
	if len(rec) != 1 || str(rec[0]["stopped"]) == "" || len([]rune(str(rec[0]["stopped"]))) > 300 {
		t.Fatalf("the record: %v", rec)
	}
}

// the bank-date route on NWS144's company (counter 54,392): no list by day nor at night; the alert says to upload the Day
// Book; nothing is re-read
func TestR245KeepAutoBankBigCompany(t *testing.T) {
	_, f, _ := bankBridge(t, "")
	keepAutoMaxSet(t, 5000) // the real guard (bankBridge raises it for the route's own tests)
	keepAutoReset()
	t.Cleanup(keepAutoReset)
	bankSet(f, "26311", "20261007")
	bankCheck(t, f)
	if n := len(bankLists(f)); n != 0 {
		t.Fatalf("lists by day: %d", n)
	}
	bankForceNight(nwsCo)
	night := time.Date(2026, 10, 6, 2, 30, 0, 0, liveZone)
	nowFn = func() time.Time { return night }
	t.Cleanup(func() { nowFn = time.Now })
	bankSet(f, "26312", "20261008")
	retryReset()
	bankCheck(t, f)
	bankNightTurn()
	if n := len(bankLists(f)); n != 0 || len(bankAsked(f)) != 0 {
		t.Fatalf("at night: %d lists, entries asked %v", n, bankAsked(f))
	}
	lg := readText(logFile())
	if !strings.Contains(lg, "may not have reached FinCom for "+nwsCo) || !strings.Contains(lg, "upload the Day Book") {
		t.Fatalf("no alert:\n%s", cutTail(lg, 2000))
	}
}

// the person's tools keep the list; every automatic sender looks at the guard first (the source)
func TestR245KeepAutoEverySenderGuarded(t *testing.T) {
	reFn := regexp.MustCompile(`(?s)\nfunc [^\n]*\{.*?\n\}\n`)
	for file, want := range map[string]bool{"recorder_live.go": true, "selfcheck.go": true, "bankdate.go": true, "readtest.go": false, "measure.go": false} {
		b, err := os.ReadFile(file)
		if err != nil {
			t.Fatal(err)
		}
		found := 0
		for _, fn := range reFn.FindAllString(string(b), -1) {
			if !strings.Contains(fn, "keepListAboveRequest(") {
				continue
			}
			found++
			if got := strings.Contains(fn, "keepAutoBlocked(") || strings.Contains(fn, "keepAutoWatch(") || strings.Contains(fn, "bankList"); got != want {
				t.Errorf("%s: a function sending the list guarded %v, want %v:\n%s", file, got, want, cutRunes(fn, 300))
			}
		}
		if found == 0 {
			t.Errorf("%s: no sender found", file)
		}
	}
	// the bank route's one sender (bankList) is reached only after the guard
	b, _ := os.ReadFile("bankdate.go")
	for _, fn := range regexp.MustCompile(`(?s)\nfunc (bankAfterLightCheck|bankNightTurn)\(.*?\n\}\n`).FindAllString(string(b), -1) {
		i, j := strings.Index(fn, "keepAutoBlocked("), strings.Index(fn, "bankList(")
		if i < 0 || j < 0 || i > j {
			t.Errorf("the bank route sends its list before the guard:\n%s", cutRunes(fn, 200))
		}
	}
}
