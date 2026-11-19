// next-fix-mastersread, item 8 (the owner: nobody opens Tally at night, so the nightly catch-up from 19:00 hardly ever
// runs): the same catch-up also runs once a day by day. At the first quiet moment while a linked company is open in this
// user's own Tally (nobody has used FinCom for DayCatchQuietMin (2) minutes, nobody works in Tally, no read or posting
// going, Tally not left alone after a failure), when the company has not been read in full today, a nightly-kind run of
// those companies starts (runReq.day, .short): the requests every read makes (no new request to Tally), each under the
// 2 s stop, giving up after 2 minutes held; a company tried and not done is tried again DayCatchRetryMin (30) minutes on.
// The night's slot stays as it was (its own key, keep-lastnight.txt). Each company's day is kept in day-check.json
// ({company, day, at, ok, why}): done by any full read of the day (Update from Tally, the nightly or daily catch-up); the
// beat's lastRun and companies[].lastRead, and the round's tally_ledger_rounds row, say it as before
package main

import (
	"sort"
	"sync"
	"time"
)

var (
	dcMu    sync.Mutex
	dcAt    time.Time
	dcTried = map[string]time.Time{} // company key -> the last daily catch-up started for it
	dcStart = func(r runReq) bool { return startKeepRun(r) }
	// the companies open in this user's own Tally (the company list as last given; Tally is not asked; tests replace it)
	dcOwnOpen = func() []string {
		var o []string
		for _, s := range openCompaniesCached() {
			if s["skipped"] == true || s["ok"] != true || s["mine"] == false {
				continue
			}
			for _, c := range sessCompanies(s) {
				if n := str(c["name"]); n != "" {
					o = append(o, n)
				}
			}
		}
		return o
	}
)

func dayCheckFile() string { return sp("day-check.json") }

// the company's check of the day as kept ({company, day, at, ok, why}); nil when none
func dayCheckOf(company string) M {
	dcMu.Lock()
	defer dcMu.Unlock()
	return obj(readObjFile(dayCheckFile())[companyKey(company)])
}

// a full read of the company ended: done (ok), or why not. A day done stays done (a later failure the same day is not
// kept over it)
func dayCheckNote(company string, ok bool, why string) {
	if company == "" {
		return
	}
	dcMu.Lock()
	defer dcMu.Unlock()
	all := readObjFile(dayCheckFile())
	if all == nil {
		all = M{}
	}
	k := companyKey(company)
	if was := obj(all[k]); !ok && was != nil && truthy(was["ok"]) && str(was["day"]) == today() {
		return
	}
	all[k] = M{"company": company, "day": today(), "at": nowS(), "ok": ok, "why": cutRunes(why, 300)}
	_ = saveFile(dayCheckFile(), jsonText(all))
}

func dayCheckDone(company string) bool {
	m := dayCheckOf(company)
	return m != nil && truthy(m["ok"]) && str(m["day"]) == today()
}

// "" when the daily catch-up may start now (the bridge, Tally and FinCom quiet); else why not
func dayCatchWhyNot(now time.Time) string {
	if in, _ := nightWindow(now); in {
		return "the night's catch-up runs now"
	}
	switch {
	case !keepOn():
		return "keeping the books in step is off"
	case paused():
		return "background reading is paused"
	case readStopped():
		return "reading from Tally is stopped on this computer"
	case !cloudOn():
		return "FinCom's cloud is not set"
	case keepRunning():
		return "a read is going"
	case postingGoing():
		return "a posting goes first"
	case !anyBackoff().IsZero():
		return "Tally is left alone for now after it did not answer"
	case typingInTally():
		return "someone is typing in Tally"
	}
	if _, h := keepHoldWhy(); h != "" {
		return h
	}
	q := time.Duration(keepNum("DayCatchQuietMin", 2)) * time.Minute
	if a := lastActivity(); !a.IsZero() && now.Sub(a) < q && !a.After(now) {
		return "FinCom is in use"
	}
	return ""
}

// the linked companies open in this user's own Tally not read in full today (nor tried a moment ago)
func dayCatchDue(now time.Time) []string {
	every := time.Duration(keepNum("DayCatchRetryMin", 30)) * time.Minute
	seen := map[string]bool{}
	var o []string
	for _, n := range dcOwnOpen() {
		k := companyKey(n)
		if seen[k] || !linkedHeld(n) || dayCheckDone(n) {
			continue
		}
		seen[k] = true
		dcMu.Lock()
		t := dcTried[k]
		dcMu.Unlock()
		if !t.IsZero() && now.Sub(t) < every && !t.After(now) {
			continue
		}
		o = append(o, n)
	}
	sort.Strings(o)
	return o
}

// the main loop's turn (bridgeTurn), every 30 s at most: the daily catch-up when due; true when one was started
func dayCatchCheck() bool {
	now := nowFn()
	dcMu.Lock()
	if now.Sub(dcAt) < 30*time.Second && !dcAt.After(now) {
		dcMu.Unlock()
		return false
	}
	dcAt = now
	dcMu.Unlock()
	if dayCatchWhyNot(now) != "" {
		return false
	}
	due := dayCatchDue(now)
	if len(due) == 0 {
		return false
	}
	dcMu.Lock()
	for _, n := range due {
		dcTried[companyKey(n)] = now
	}
	dcMu.Unlock()
	return dcStart(runReq{kind: "nightly", only: due, why: "not read in full today", short: true, day: true})
}
