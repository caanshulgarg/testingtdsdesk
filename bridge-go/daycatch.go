// next-fix-mastersread, item 8 (the owner: nobody opens Tally at night, so the nightly catch-up from 19:00 hardly ever
// runs): the same catch-up also runs once a day by day. At the first quiet moment while a linked company is open in this
// user's own Tally (nobody has used FinCom for DayCatchQuietMin (2) minutes, nobody works in Tally, no read or posting
// going, Tally not left alone after a failure), when the company has not been read in full today, a nightly-kind run of
// those companies starts (runReq.day, .short): the requests every read makes (no new request to Tally), each under the
// 2 s stop, giving up after 2 minutes held; a company tried and not done is tried again DayCatchRetryMin (30) minutes on, DayCatchMax (4) times a day at most
// (the tries kept in day-check.json, so a restart does not run it again at once).
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
	was := obj(all[k])
	if !ok && was != nil && truthy(was["ok"]) && str(was["day"]) == dcToday() {
		return
	}
	e := M{"company": company, "day": dcToday(), "at": nowS(), "ok": ok, "why": cutRunes(why, 300)}
	if was != nil && str(was["day"]) == dcToday() {
		e["tries"], e["triedAt"] = was["tries"], was["triedAt"] // review N4: the day's tries kept
	}
	all[k] = e
	_ = saveFile(dayCheckFile(), jsonText(all))
}

// review N4: a daily catch-up started for the company now: counted in day-check.json (a restart does not run it again at
// once); at most DayCatchMax (4) a day
func dayCheckTried(company string, now time.Time) {
	dcMu.Lock()
	defer dcMu.Unlock()
	all := readObjFile(dayCheckFile())
	if all == nil {
		all = M{}
	}
	k, td := companyKey(company), tallyDate(now)
	e := obj(all[k])
	if e == nil || str(e["day"]) != td {
		e = M{"company": company, "day": td, "ok": false}
	}
	e["tries"], e["triedAt"] = toInt(e["tries"])+1, now.Format(time.RFC3339)
	all[k] = e
	_ = saveFile(dayCheckFile(), jsonText(all))
}

func dayCheckDone(company string) bool {
	m := dayCheckOf(company)
	return m != nil && truthy(m["ok"]) && str(m["day"]) == dcToday()
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
		if e := dayCheckOf(n); e != nil && str(e["day"]) == tallyDate(now) {
			if toInt(e["tries"]) >= keepNum("DayCatchMax", 4) {
				continue
			}
			if t, err := time.Parse(time.RFC3339, str(e["triedAt"])); err == nil && now.Sub(t) < every && !t.After(now) {
				continue
			}
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
	for _, n := range due {
		dayCheckTried(n, now)
	}
	return dcStart(runReq{kind: "nightly", only: due, why: "not read in full today", short: true, day: true})
}

// the day by the bridge's clock (nowFn), as the catch-up's own checks count it
func dcToday() string { return tallyDate(nowFn()) }
