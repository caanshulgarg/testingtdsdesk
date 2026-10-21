// ROUND 103 (1d, the owner's decision of 21-Oct-2026): "Test reading old days (read-only)", a tray item. Before reading
// older entries is switched on for a computer (its switch in FinCom, off by default), the owner confirms on his own
// licensed Tally that a day's list answers quickly: the bridge asks FinComDayHeads (the approved form F1, unchanged) for
// three days of a past month (the 1st, the 15th and the last day), one at a time, each under the 2 s hard stop, Tally's
// window watched while it is at Tally (windowHoldFn). A stop or a window held 2 s or more ends the test there. The rows
// are counted only: nothing is kept, stored, posted or sent to FinCom but the result itself (times, counts, the reason a
// test stopped), which the heartbeat carries for the Tally page ("Old-days test on <PC>: 0.21 s / 0.34 s / 0.18 s · no
// freeze"). Started by a person only (the tray): a web page, FinCom's own included, is refused (server.go).
package main

import (
	"errors"
	"fmt"
	"sort"
	"strings"
	"sync"
	"time"
)

var oldTest = struct {
	mu      sync.Mutex
	last    M               // the last result (also in the beat)
	allowed map[string]bool // company key | day: the days the running test may ask (the dated guard's exception)
}{allowed: map[string]bool{}}

// the three days: the 1st, the 15th and the last day of the month before this one
func oldTestDays(now time.Time) []string {
	first := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, now.Location()).AddDate(0, -1, 0)
	last := first.AddDate(0, 1, -1)
	return []string{first.Format("20060102"), first.AddDate(0, 0, 14).Format("20060102"), last.Format("20060102")}
}

// the companies open in this bridge's own Tally, the smallest first (by Tally's entry counter, as the beat keeps it)
func oldTestCompanies() []M {
	var out []M
	seen := map[string]bool{}
	for _, s := range openCompaniesCached() {
		if s["skipped"] == true || s["ok"] != true || s["mine"] == false {
			continue
		}
		for _, c := range sessCompanies(s) {
			n := str(c["name"])
			if n == "" || seen[companyKey(n)] {
				continue
			}
			seen[companyKey(n)] = true
			size := int64(-1)
			if cur, _ := latestNumbers(n); cur != nil {
				size = toI64(cur["altvchid"])
			}
			out = append(out, M{"company": n, "size": size})
		}
	}
	sort.SliceStable(out, func(a, b int) bool {
		x, y := toI64(out[a]["size"]), toI64(out[b]["size"])
		if (x < 0) != (y < 0) {
			return x >= 0
		}
		return x < y
	})
	return out
}

// POST /tray/oldtest {preview: true}: the companies, the smallest first (nothing sent to Tally)
func oldTestPreview() M {
	cs := oldTestCompanies()
	if len(cs) == 0 {
		return M{"ok": false, "error": "No company is open in Tally: open the company to test, then try again."}
	}
	return M{"ok": true, "companies": oldTestList(cs), "days": toAny(oldTestDays(nowFn()))}
}

func oldTestList(l []M) []any {
	o := []any{}
	for _, x := range l {
		o = append(o, x)
	}
	return o
}

// POST /tray/oldtest {company}: started at once; GET: how far (the tray polls)
func startOldTest(company string) M {
	company = strings.TrimSpace(company)
	ok := false
	for _, c := range oldTestCompanies() {
		if companyKey(str(c["company"])) == companyKey(company) {
			company, ok = str(c["company"]), true
		}
	}
	if !ok {
		return M{"ok": false, "error": "That company is not open in this computer's Tally."}
	}
	oldTest.mu.Lock()
	if oldTest.last != nil && str(oldTest.last["state"]) == "running" {
		oldTest.mu.Unlock()
		return M{"ok": false, "error": "A test is already running; wait for its message box."}
	}
	days := oldTestDays(nowFn())
	oldTest.last = M{"ok": true, "state": "running", "company": company, "days": toAny(days), "at": nowFn().Format(time.RFC3339)}
	oldTest.mu.Unlock()
	go func() {
		r := runOldTest(company, days)
		oldTest.mu.Lock()
		oldTest.last = r
		oldTest.mu.Unlock()
	}()
	return M{"ok": true, "started": true, "company": company, "days": toAny(days)}
}

func oldTestStatus() M {
	oldTest.mu.Lock()
	defer oldTest.mu.Unlock()
	if oldTest.last == nil {
		return M{"ok": true, "state": "none"}
	}
	return oldTest.last
}

// for the beat: the last finished test (nil before one)
func oldTestBeat() M {
	oldTest.mu.Lock()
	defer oldTest.mu.Unlock()
	if oldTest.last == nil || str(oldTest.last["state"]) == "running" {
		return nil
	}
	return oldTest.last
}

// the dated guard's exception for the running test: exactly F1, one of its three days, its company
func oldTestAllows(company, day string) bool {
	oldTest.mu.Lock()
	defer oldTest.mu.Unlock()
	return oldTest.allowed[companyKey(company)+"|"+day]
}

func runOldTest(company string, days []string) M {
	port, err := findCompanyPort(company, 0)
	res := M{"ok": true, "state": "done", "company": company, "at": nowFn().Format(time.RFC3339), "results": []any{}}
	if err != nil {
		res["ok"], res["state"], res["error"] = false, "failed", "the company is not open in Tally ("+cutRunes(err.Error(), 120)+")"
		return res
	}
	oldTest.mu.Lock()
	for _, d := range days {
		oldTest.allowed[companyKey(company)+"|"+d] = true
	}
	oldTest.mu.Unlock()
	defer func() {
		oldTest.mu.Lock()
		oldTest.allowed = map[string]bool{}
		oldTest.mu.Unlock()
	}()
	var rs []any
	var words []string
	for _, d := range days {
		held := windowHoldFn()
		t0 := time.Now()
		raw, err := invokeTally(recorderTC(nil), port, dayHeadsRequest(company, d), 5)
		ms := int(time.Since(t0).Milliseconds())
		hold := held()
		e := M{"day": d, "ms": ms, "holdMs": hold}
		switch {
		case errors.Is(err, errRecorderStop):
			e["stopped"] = "over 2 s"
			res["stopped"] = "Tally took longer than 2 s to give " + liveDay(d) + "; the test stopped there"
		case hold >= 2000:
			e["stopped"] = "window"
			res["stopped"] = fmt.Sprintf("Tally's window did not answer for %.1f s on %s; the test stopped there", float64(hold)/1000, liveDay(d))
		case err != nil:
			e["error"] = cutRunes(err.Error(), 160)
			res["stopped"] = "Tally did not answer for " + liveDay(d) + " (" + cutRunes(err.Error(), 120) + "); the test stopped there"
		default:
			rows, bad := pullRowsOf(raw, d)
			e["rows"] = len(rows)
			if bad != "" {
				e["otherDate"] = bad
				res["stopped"] = "Tally answered " + liveDay(d) + " with an entry of " + liveDay(bad) + " (the date was not applied); the test stopped there"
			}
		}
		raw = ""
		rs = append(rs, e)
		words = append(words, fmt.Sprintf("%.2f s", float64(ms)/1000))
		writeLog(fmt.Sprintf("Old-days test (read only) of %s: %s: %d ms, %v row(s), Tally's window held at most %d ms%s", company, liveDay(d), ms, e["rows"], hold,
			map[bool]string{true: " - " + str(e["stopped"]) + str(e["error"]), false: ""}[e["stopped"] != nil || e["error"] != nil]))
		if res["stopped"] != nil {
			break
		}
		keepRest(300 * time.Millisecond)
	}
	res["results"] = rs
	line := strings.Join(words, " / ")
	if s := str(res["stopped"]); s != "" {
		line += " · " + s
	} else {
		line += " · no freeze"
	}
	res["line"] = line
	writeLog("Old-days test (read only) of " + company + ": " + line + " (nothing kept, stored or posted)")
	return res
}
