package main

// Bridge 2.5.8 (the owner's server, 08-Nov-2026: this login's Tally answered the company list at 07:16 with no company
// (Tally just started, the company not loaded yet); a company opened in it at about 07:17 showed in FinCom only at
// 07:27, and the same happened later with another company). The beat repeats the list held (openCompaniesCached, no
// request to Tally) and the light check asked the list afresh only when it was 10 minutes old, so an empty answer stood
// for 10 minutes. Nothing new is sent to Tally: only the light company-list request (TDSDeskCompanies, on the
// allow-list) asked sooner, under every rule it already had (2 s at most, one in flight, postings first) and never
// while someone is typing in Tally right now:
//  1. after this login's open Tally answered with no company, the list is asked again on a short age: 30 s for the
//     first 3 minutes, then 1 minute, then 2 minutes while it stays empty (a list naming a company keeps its 10 minutes);
//  2. a port the list held as closed (nothing listening) that takes a connection now, or a port another Tally program
//     holds now, is asked at once (the minute's wait between such asks is not kept), instead of repeating the old list;
//  3. a person's Check again (the local /status?fresh=1, which the Tally page's Check again and Connect send) asks Tally
//     now, never a list up to 30 s old, unless a posting is going or someone is typing in Tally (then the list held);
//  4. the beat says per port when Tally last answered the list (askedAt) and what it named (list: "named", "empty",
//     "kept" when an earlier list stands for one not given in time, "never" when not asked in this run).

import (
	"os"
	"path/filepath"
	"sync"
	"time"
)

// Tally's last answer to the company list, per port, in this run
type askNote struct {
	at    time.Time
	pid   int
	empty bool
}

var (
	askMu     sync.Mutex
	askNotes  = map[int]askNote{}
	emptyFrom time.Time // when the own open Tally's list was first seen empty in a row (zero: it is not)
	// a person's Check again: one at a time (a second press meanwhile gets the answer of the one going)
	personAskMu sync.Mutex
)

// the tests: as at a bridge's start
func resetAsks() {
	askMu.Lock()
	askNotes, emptyFrom = map[int]askNote{}, time.Time{}
	askMu.Unlock()
}

// Tally answered the company list on this port now (its own answer, given in time or kept late within the minute)
func noteAsked(port, pid int, empty bool) {
	askMu.Lock()
	askNotes[port] = askNote{at: nowFn(), pid: pid, empty: empty}
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
	case n.empty:
		return at, "empty"
	}
	return at, "named"
}

// 1: the age after which the light check asks the list again when this login's open Tally named no company (ok
// false: a company is named, or no own Tally is open; the list keeps its 10 minutes)
func emptyListWait(sessions []M) (time.Duration, bool) {
	empty := false
	for _, s := range sessions {
		if s["skipped"] == true || s["ok"] != true || s["mine"] == false {
			continue
		}
		if len(sessCompanies(s)) == 0 {
			empty = true
		}
	}
	askMu.Lock()
	defer askMu.Unlock()
	if !empty {
		emptyFrom = time.Time{}
		return 0, false
	}
	now := nowFn()
	if emptyFrom.IsZero() {
		emptyFrom = now
	}
	switch d := now.Sub(emptyFrom); {
	case d < 3*time.Minute:
		return 30 * time.Second, true
	case d < 10*time.Minute:
		return time.Minute, true
	}
	return 2 * time.Minute, true
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

func namesAny(sessions []M) bool {
	for _, s := range sessions {
		if s["skipped"] != true && s["ok"] == true && s["mine"] != false && len(sessCompanies(s)) > 0 {
			return true
		}
	}
	return false
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

// the person's ask: the light list, 2 s at most (tally.go colistMaxSec), giving way to a posting that starts meanwhile
func personCompaniesTC() *TC {
	return &TC{light: true, yield: func() bool { return postingGoing() }}
}

// 3: a person's Check again on this computer (/status?fresh=1: the Tally page's Check again, Connect): Tally asked now,
// unless a posting is going or someone is typing in Tally; the minute's wait of the background ask is not kept
func personCheckNow() []M {
	askAfreshNow()
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
