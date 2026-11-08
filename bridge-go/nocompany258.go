package main

// Bridge 2.5.8 (the owner's server, 08-Nov-2026: this login's Tally answered the company list at 07:16 with no company
// (Tally just started, the company not loaded yet); a company opened in it at about 07:17 showed in FinCom only at
// 07:27, and the same happened later with another company). The beat repeats the list held (openCompaniesCached, no
// request to Tally) and the light check asked the list afresh only when it was 10 minutes old, so an empty answer stood
// for 10 minutes. Nothing new is sent to Tally: only the light company-list request (TDSDeskCompanies, on the
// allow-list) asked sooner, under every rule it already had (2 s at most, one in flight, postings first) and never
// while someone is typing in Tally right now:
//  1. after a Tally of this login answered with no company, its list is asked again on a short age: 30 s for the
//     first 3 minutes, then 1 minute, then 2 minutes while it stays empty (a list naming a company keeps its 10 minutes);
//  2. a port the list held as closed (nothing listening) that takes a connection now, or a port another Tally program
//     holds now, is asked at once (the minute's wait between such asks is not kept), instead of repeating the old list;
//  3. a person's Check again (the local /status?fresh=1, which the Tally page's Check again and Connect send) asks Tally
//     now, never a list up to 30 s old, unless a posting is going or someone is typing in Tally (then the list held);
//  4. the beat says per port when Tally last answered the list (askedAt) and what it named (list: "named", "empty",
//     "emptyHeld" when it named none but is not being asked again now (held, backed off, or over 5 minutes ago),
//     "kept" when an earlier list stands for one not given in time, "never" when not asked in this run).
//
// The independent review of next-bridge-258: (1) the short age is per port, only for a port that ANSWERED with no
// company, and only those ports are asked (a Tally naming a company keeps its 10 minutes; the log line and the beat
// only when one of them names a company now); (2) the short asks give way to typing in Tally after the lock is taken
// too (bgListTC), and a company's first check right after it appears waits while someone types; (3) a held Check again
// keeps the background's minute, and a press does not ask a Tally still in its wait after no answer in 2 s;
// (4) a port that opened is asked once in a beat (the light check does not ask again within 10 s); (5) the page says
// "checking again" only for "empty".

import (
	"os"
	"path/filepath"
	"sync"
	"time"
)

// Tally's last answer to the company list, per port, in this run
type askNote struct {
	at         time.Time
	pid        int
	empty      bool
	emptySince time.Time // review 1: its first answer with no company in a row (zero: it named one)
}

var (
	askMu    sync.Mutex
	askNotes = map[int]askNote{}
	reopenAt time.Time // review 4: when a port that opened (or changed program) was last asked at once
	// a person's Check again: one at a time (a second press meanwhile gets the answer of the one going)
	personAskMu sync.Mutex
)

// the tests: as at a bridge's start
func resetAsks() {
	askMu.Lock()
	askNotes, reopenAt = map[int]askNote{}, time.Time{}
	askMu.Unlock()
}

// Tally answered the company list on this port now (its own answer, given in time or kept late within the minute)
func noteAsked(port, pid int, empty bool) {
	askMu.Lock()
	n := askNote{at: nowFn(), pid: pid, empty: empty}
	if empty {
		n.emptySince = n.at
		if was, had := askNotes[port]; had && was.empty && was.pid == pid && !was.emptySince.IsZero() {
			n.emptySince = was.emptySince
		}
	}
	askNotes[port] = n
	askMu.Unlock()
}

func askNoteOf(port int) (askNote, bool) {
	askMu.Lock()
	defer askMu.Unlock()
	n, ok := askNotes[port]
	return n, ok
}

// the beat's (and /status's) askedAt and list for a port ("", "" for a port skipped or closed)
func askFields(e M) (string, string) {
	if e["skipped"] == true || str(e["tallyState"]) == "closed" || portReason(e) == "closed" {
		return "", ""
	}
	n, had := askNoteOf(toInt(e["port"]))
	at := ""
	if had {
		at = n.at.Format("2006-01-02T15:04:05")
	}
	switch {
	case e["kept"] == true || e["busy"] == true:
		return at, "kept"
	case !had:
		return at, "never"
	case n.empty && (nowFn().Sub(n.at) > 5*time.Minute || lightCheckBlocked() != "" || retryHeld()):
		return at, "emptyHeld" // review 5: answered with none, but not being asked again now (held, backed off, or long ago)
	case n.empty:
		return at, "empty"
	}
	return at, "named"
}

// 1 (review 1): the ports of this login's open Tallys that ANSWERED with no company (not one that failed, or that is
// only open), each with when it is due again: 30 s for the first 3 minutes of its answers with none, then 1 minute, then
// 2 minutes. held: the list as the bridge holds it (open-companies.json), for a Tally that answered with none before
// this run (its file's time). A port naming a company is not here: it keeps its 10 minutes
func emptyPorts(sessions, held []M, fileAt time.Time) map[int]time.Time {
	out := map[int]time.Time{}
	heldBy := map[int]M{}
	for _, h := range held {
		heldBy[toInt(h["port"])] = h
	}
	for _, s := range sessions {
		if s["skipped"] == true || s["ok"] != true || s["mine"] == false || len(sessCompanies(s)) > 0 {
			continue
		}
		port := toInt(s["port"])
		n, had := askNoteOf(port)
		if !had {
			// answered with none before this run: the held entry says Tally answered (ok, no error) with no company
			h := heldBy[port]
			if h == nil || h["ok"] != true || str(h["error"]) != "" || len(sessCompanies(h)) > 0 || fileAt.IsZero() {
				continue
			}
			n = askNote{at: fileAt, empty: true, emptySince: fileAt}
		}
		if !n.empty {
			continue
		}
		wait := 2 * time.Minute
		switch d := n.at.Sub(n.emptySince); {
		case d < 3*time.Minute:
			wait = 30 * time.Second
		case d < 10*time.Minute:
			wait = time.Minute
		}
		out[port] = n.at.Add(wait - emptyWaitSlack)
	}
	return out
}

// the beat turns every 30 s and the list's age is taken at the ask: a little early, so a 30 s wait never skips a turn
const emptyWaitSlack = 5 * time.Second

// someone is typing or clicking in Tally right now: the new asks wait for the next turn (keep.go keepTypingNow)
func typingInTally() bool { return keepTypingFn() }

// the light check's list asked again and it names a company now where it named none: the beat goes at once
func beatSoon() {
	select {
	case beatNow <- struct{}{}:
	default:
	}
}

// review 1: one of the ports asked names a company now
func namesAnyOf(sessions []M, ports map[int]bool) []string {
	var names []string
	for _, s := range sessions {
		if ports[toInt(s["port"])] && s["skipped"] != true && s["ok"] == true && s["mine"] != false {
			for _, c := range sessCompanies(s) {
				names = append(names, str(c["name"]))
			}
		}
	}
	return names
}

// review 2: the short re-asks (an empty list, a port that opened) give way to a posting and to someone typing in Tally,
// looked at again once Tally's lock is taken
func bgListTC(only map[int]bool) *TC {
	tc := bgCompaniesTC()
	y := tc.yield
	tc.yield = func() bool { return y() || typingInTally() }
	tc.only, tc.typingGive = only, true
	return tc
}

// review 4: a port that opened was asked at once a moment ago: the light check does not ask again in the same beat
func reopenAskedLately() bool {
	askMu.Lock()
	defer askMu.Unlock()
	return !reopenAt.IsZero() && nowFn().Sub(reopenAt) < 10*time.Second
}

func noteReopenAsk() {
	askMu.Lock()
	reopenAt = nowFn()
	askMu.Unlock()
}

// 3: why a person's Check again does not ask Tally now ("" : it asks)
func personAskBlocked() string {
	if postingGoing() {
		return "a posting is going"
	}
	if typingInTally() {
		return "someone is typing in Tally"
	}
	return ""
}

// the person's ask: the light list, 2 s at most (tally.go colistMaxSec), giving way to a posting that starts meanwhile;
// review 3: a Tally in its wait after no answer in 2 s is not asked at this press (colistHold)
func personCompaniesTC() *TC {
	return &TC{light: true, holdOK: true, yield: func() bool { return postingGoing() }}
}

// 3: a person's Check again on this computer (/status?fresh=1: the Tally page's Check again, Connect): Tally asked now,
// unless a posting is going or someone is typing in Tally; the minute's wait of the background ask is not kept
func personCheckNow() []M {
	if why := personAskBlocked(); why != "" {
		writeLogOnce("person-check-held", "Check again: the company list held is shown ("+why+"; Tally is asked after it)", time.Minute)
		return openCompaniesCachedOnce(false)
	}
	if !personAskMu.TryLock() {
		personAskMu.Lock() // the ask going: its answer
		personAskMu.Unlock()
		return openCompaniesCachedOnce(false)
	}
	defer personAskMu.Unlock()
	askAfreshNow() // review 3: only when Tally is asked now
	shared := filepath.Join(syncDir(), "open-companies.json")
	before, had := mtime(shared)
	l, ok := openCompaniesAsk(personCompaniesTC(), true)
	switch {
	case ok:
		_ = os.Chtimes(shared, nowFn(), nowFn())
	case had:
		_ = os.Chtimes(shared, before, before) // not given afresh: as old as it was (the light check asks it again)
	}
	return l
}

// a line said at most once in the period (per key)
var (
	logOnceMu sync.Mutex
	logOnceAt = map[string]time.Time{}
)

func writeLogOnce(key, line string, every time.Duration) {
	logOnceMu.Lock()
	t, had := logOnceAt[key]
	due := !had || time.Since(t) >= every
	if due {
		logOnceAt[key] = time.Now()
	}
	logOnceMu.Unlock()
	if due {
		writeLog(line)
	}
}
