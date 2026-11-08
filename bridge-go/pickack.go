package main

// bridge 2.5.10 (the owner's request of 08-Nov-2026): the page said "Not started: <why>" for Bring books, Bring another
// year, Bring missing days and Check for changes only by inference (progress counts and beats). The bridge now says it
// itself: when it takes a book's days from the beat answer (periodDays: kind period, check or fill), it notes the
// hand-out and, once the older-entries loop has either sent the first request for it or found why it cannot, it reports a
// small acknowledgement in its next beat (and at once: beatSoon; a refusal at most once every 15 s):
//   {company, guid, kind, chosenAt, takenAt, state: started|refused, pickedAt (local), pickedUtc, day, code, words, login}
// started: the first day taken (the loop's first request for it reached the gate to Tally); refused: a reason code and
// fixed plain words (never a port, a computer's name or Tally's own text). Nothing new is asked of Tally: the reasons are
// the loop's own six conditions (pullMayAsk), looked at where they always were; at most 20 kept, 30 minutes each.
import (
	"sort"
	"strings"
	"sync"
	"time"
)

// the kinds FinCom hands out (the cloud's periodDays kind; an older cloud: check by the day's own flag, else period)
var pickKinds = map[string]bool{"period": true, "check": true, "fill": true}

func pickKindOf(e M) string {
	if k := str(e["kind"]); pickKinds[k] {
		return k
	}
	if e["check"] == true {
		return "check"
	}
	return "period"
}

// the reasons, as codes with their plain words (the page says "Not started: <words>")
var pickWords = map[string]string{
	"tallyClosed":    "Tally is not open on this computer",
	"paused":         "background reading is paused in the FinCom Bridge tray icon",
	"readingStopped": "reading from Tally is stopped from FinCom for this computer",
	"posting":        "a posting into Tally goes first; reading follows by itself",
	"saving":         "a save made in Tally goes to FinCom first; reading follows by itself",
	"typing":         "someone is working in Tally; reading starts once Tally has been left alone for a minute",
	"retryWait":      "Tally did not answer in time lately; FinCom Bridge waits before asking again",
	"noStart":        "the company's starting point is not recorded yet; it is recorded at the next read",
	"slow":           "this company's entries are not asked (finding one took longer than 2 seconds)",
	"notOpen":        "the company is not open in this login's Tally",
	"otherLogin":     "the company is open in another Windows login's Tally, not in this one's",
	"tallyBusy":      "Tally is busy; reading starts once it is free",
	"held":           "Tally is held for a moment (just opened, or FinCom is reading it); reading follows by itself",
	"notAnswering":   "Tally's window is not answering",
	"earlier":        "Tally is still on an earlier request; reading follows by itself",
	"stoppedHere":    "single days are not read from this Tally until FinCom Bridge restarts",
	"otherCompany":   "the company open in Tally here is another copy than the book's (its GUID differs)",
	"stopped":        "reading older entries of this company was stopped because Tally was too slow; choose it again in FinCom",
	"queued":         "other days are being read first, one day at a time; this follows by itself",
}

// the reasons that are about one company (the rest hold every book of this computer alike)
var pickOwnCompany = map[string]bool{"noStart": true, "slow": true, "notOpen": true, "otherLogin": true, "otherCompany": true, "stopped": true}

type pickAck struct {
	company, guid, kind, chosenAt string
	takenAt, listedAt, at         time.Time // the hand-out taken; last listed by FinCom; the last change (the bridge's clock)
	state                         string    // taken (not said yet) | started | refused
	day, code                     string
}

const pickMax, pickKeep, pickRelist = 20, 30 * time.Minute, 10 * time.Minute

var picks = struct {
	mu     sync.Mutex
	m      map[string]*pickAck
	soonAt time.Time // the last early beat a refusal asked for
}{m: map[string]*pickAck{}}

// the beat at once: always for a start; for a refusal at most once every 15 s (a reason that changes at every look waits
// for the next beat, which always carries the latest)
func pickSoon(start bool) {
	now := nowFn()
	picks.mu.Lock()
	go1 := start || now.Sub(picks.soonAt) >= 15*time.Second || now.Before(picks.soonAt)
	if go1 && !start {
		picks.soonAt = now
	}
	picks.mu.Unlock()
	if go1 {
		beatSoon()
	}
}

func pickKey(company, guid, kind string) string {
	return companyKey(company) + "|" + strings.ToLower(guid) + "|" + kind
}

func pickReset() {
	picks.mu.Lock()
	picks.m, picks.soonAt = map[string]*pickAck{}, time.Time{}
	picks.mu.Unlock()
}

// the beat answer's days, as taken (applyPeriodDays, after its own filter): a new acknowledgement for a book and kind when
// FinCom names a new choice time, or lists it again after 10 minutes of not listing it (a press of Bring missing days
// keeps the choice time); refused: the days FinCom listed that this bridge will not read, with the reason
func pickTake(items []pullItem, refused map[string]pullItem, refusedWhy map[string]string) {
	now := nowFn()
	picks.mu.Lock()
	seen := map[string]bool{}
	for _, it := range items {
		k := pickKey(it.Company, it.CGUID, it.Kind)
		if seen[k] {
			continue // the first day listed of a book and kind is the one named
		}
		seen[k] = true
		a := picks.m[k]
		if a == nil || a.chosenAt != it.ChosenAt || now.Sub(a.listedAt) >= pickRelist || now.Before(a.listedAt) {
			a = &pickAck{company: it.Company, guid: it.CGUID, kind: it.Kind, chosenAt: it.ChosenAt, takenAt: now, at: now, state: "taken", day: it.Day}
			picks.m[k] = a
		}
		a.listedAt = now
	}
	for k, it := range refused {
		if seen[k] {
			continue
		}
		a := picks.m[k]
		if a == nil || a.chosenAt != it.ChosenAt || now.Sub(a.listedAt) >= pickRelist || now.Before(a.listedAt) {
			a = &pickAck{company: it.Company, guid: it.CGUID, kind: it.Kind, chosenAt: it.ChosenAt, takenAt: now, day: it.Day}
			picks.m[k] = a
		}
		a.listedAt = now
		if a.state != "started" && (a.state != "refused" || a.code != refusedWhy[k]) {
			a.state, a.code, a.at = "refused", refusedWhy[k], now
		}
	}
	pickTrimLocked(now)
	picks.mu.Unlock()
	// (days this bridge will not read are said in the next beat as it comes: an early beat for them would only bring the
	// same days back; review 245 R15 L1)
}

// the first request for the day reached the gate to Tally (or the day was already read by the fast window): started,
// once per hand-out, for the choice it was handed out under
func pickStarted(it pullItem) {
	picks.mu.Lock()
	a := picks.m[pickKey(it.Company, it.CGUID, it.Kind)]
	hit := a != nil && a.state != "started" && a.chosenAt == it.ChosenAt
	if hit {
		a.state, a.code, a.day, a.at = "started", "", it.Day, nowFn()
	}
	picks.mu.Unlock()
	if hit {
		pickSoon(true)
	}
}

// the loop found why the day waits (pullMayAskWhy's code): every hand-out not started that it holds (the company's own
// reasons: that company's only) is said refused with it; a change of reason is said again
func pickRefused(it pullItem, code string) {
	if pickWords[code] == "" {
		return
	}
	now := nowFn()
	picks.mu.Lock()
	changed := false
	for _, a := range picks.m {
		if a.state == "started" || (a.state == "refused" && a.code == code) {
			continue
		}
		if pickOwnCompany[code] && (companyKey(a.company) != companyKey(it.Company) || !strings.EqualFold(a.guid, it.CGUID)) {
			continue
		}
		a.state, a.code, a.at, changed = "refused", code, now, true
	}
	picks.mu.Unlock()
	if changed {
		pickSoon(false)
	}
}

// the loop goes on with cur: the other hand-outs not said yet wait their turn (one day at a time)
func pickQueued(cur pullItem) {
	k0 := pickKey(cur.Company, cur.CGUID, cur.Kind)
	now := nowFn()
	picks.mu.Lock()
	changed := false
	for k, a := range picks.m {
		if k != k0 && a.state == "taken" {
			a.state, a.code, a.at, changed = "refused", "queued", now, true
		}
	}
	picks.mu.Unlock()
	if changed {
		pickSoon(false)
	}
}

// at most 20, none older than 30 minutes (the oldest go first)
func pickTrimLocked(now time.Time) {
	for k, a := range picks.m {
		if now.Sub(a.takenAt) >= pickKeep || now.Before(a.takenAt.Add(-time.Hour)) {
			delete(picks.m, k)
		}
	}
	if len(picks.m) <= pickMax {
		return
	}
	ks := make([]string, 0, len(picks.m))
	for k := range picks.m {
		ks = append(ks, k)
	}
	sort.Slice(ks, func(i, j int) bool { return picks.m[ks[i]].takenAt.Before(picks.m[ks[j]].takenAt) })
	for _, k := range ks[:len(ks)-pickMax] {
		delete(picks.m, k)
	}
}

// this login's Windows user without its computer or domain ("SRV01\made-up-a" -> "made-up-a")
func pickLogin() string {
	u := ownerName()
	if i := strings.LastIndexAny(u, `\/`); i >= 0 {
		u = u[i+1:]
	}
	if i := strings.Index(u, "@"); i > 0 {
		u = u[:i]
	}
	return cutRunes(strings.TrimSpace(u), 60)
}

// for the beat: the hand-outs said (started or refused), the newest first; [] when none
func pickBeat() []any {
	now := nowFn()
	picks.mu.Lock()
	pickTrimLocked(now)
	var l []*pickAck
	for _, a := range picks.m {
		if a.state == "started" || a.state == "refused" {
			c := *a
			l = append(l, &c)
		}
	}
	picks.mu.Unlock()
	sort.Slice(l, func(i, j int) bool { return l[i].at.After(l[j].at) })
	login := pickLogin()
	out := []any{}
	for _, a := range l {
		e := M{"company": cutRunes(a.company, 200), "guid": cut(a.guid, 100), "kind": a.kind, "chosenAt": cutRunes(a.chosenAt, 40),
			"takenAt": a.takenAt.UTC().Format(time.RFC3339), "state": a.state, "day": a.day, "login": login}
		if a.state == "started" {
			e["pickedAt"], e["pickedUtc"] = a.at.Format(time.RFC3339), a.at.UTC().Format(time.RFC3339)
		} else {
			e["code"], e["words"], e["at"] = a.code, pickWords[a.code], a.at.UTC().Format(time.RFC3339)
		}
		out = append(out, e)
	}
	return out
}
