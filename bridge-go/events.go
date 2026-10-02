// FinCom Bridge 2.1.3: the bridge wakes on events, not on a timer. With no reason to work it sends nothing to Tally: no
// company list every few seconds, no light check, no keep-alive, no warm-up. It works only after one of these, all
// delivered over the cloud connection it already holds (the wake-up channel, with the heartbeat's answer as fallback):
//
//	a. a client is opened in FinCom whose Tally company is kept on this computer: one light update (only what changed
//	   in Tally since the last read, by its change numbers), then idle; opening several clients in a row costs at most
//	   one light update per company every few minutes (OpenDebounceMin, 5)
//	b. Update now pressed in FinCom: read now
//	c. a posting approved and queued: posted now (cloud.go)
//	d. once a night at the hour set (KeepDailyAt, 02:00; shown in the tray): the full catch-up, only when Tally is open
//	   and nobody has used FinCom or posted for 15 minutes (FinCom's cloud says when it was last used; without that, the
//	   last request to this bridge)
//
// "Is Tally open?" is answered without asking Tally anything (its program running, its port taking a connection), and
// "Pause background reading" in the tray stops a and d; postings and Update now still work.
package main

import (
	"fmt"
	"strings"
	"sync"
	"time"
)

var (
	evMu         sync.Mutex
	openSeen     = map[string]time.Time{} // company -> when its last light update was started (debounce)
	openFromBeat = map[string]string{}    // company -> the time of the last "opened" the heartbeat's answer carried
	cloudUseAt   time.Time                // FinCom last used (for this computer's clients), as the cloud says
	ownUseAt     time.Time                // the last request to this bridge from FinCom, or the last posting
	postedFor    = map[string]time.Time{} // companies posted to: their light update follows the posting
	nightTold    string                   // the night (and reason) already said in the log
)

// FinCom used this bridge (a request from FinCom on this computer, a posting, an event)
func noteUse() {
	evMu.Lock()
	ownUseAt = nowFn()
	evMu.Unlock()
}

// the cloud's last-activity signal (the heartbeat's answer)
func noteCloudUse(at string) {
	t, ok := parseTime(at)
	if !ok {
		if tt, err := time.Parse(time.RFC3339Nano, at); err == nil {
			t, ok = tt.Local(), true
		}
	}
	if !ok {
		return
	}
	evMu.Lock()
	if t.After(cloudUseAt) {
		cloudUseAt = t
	}
	evMu.Unlock()
}

// when FinCom was last used: the cloud's signal when there is one, else the last request to this bridge
func lastActivity() time.Time {
	evMu.Lock()
	defer evMu.Unlock()
	if !cloudUseAt.IsZero() {
		if ownUseAt.After(cloudUseAt) {
			return ownUseAt
		}
		return cloudUseAt
	}
	return ownUseAt
}

// a. a client opened in FinCom: one light update of its company, then idle. false: nothing was started (paused, Tally
// closed, left alone after a failure, the company not kept here, or one was started for it a few minutes ago)
func wakeOpen(company, source string) bool {
	company = strings.TrimSpace(company)
	if company == "" || !keepOn() {
		return false
	}
	if paused() {
		return false // background reading paused in the tray: a client opened in FinCom does not read Tally
	}
	st := readKeepState(syncFolder(company))
	if st == nil || str(st["phase"]) != "live" {
		return false // not kept in step here yet: its first copy comes with the nightly catch-up or Update now
	}
	if !anyBackoff().IsZero() {
		return false // Tally is left alone after a failure (said once when it began); the next event tries again
	}
	now := nowFn()
	evMu.Lock()
	last, had := openSeen[company]
	if had && now.Sub(last) < time.Duration(keepNum("OpenDebounceMin", 5))*time.Minute {
		evMu.Unlock()
		return false
	}
	evMu.Unlock()
	if tallyOpenNow() == 0 {
		return false // Tally is closed: nothing to read (asked nothing)
	}
	evMu.Lock()
	openSeen[company] = now
	evMu.Unlock()
	return startKeepRun(runReq{kind: "light", only: []string{company}, why: source})
}

// b. Update now: read now (not stopped by "Pause background reading"); company "" for every company open in Tally
func wakeUpdate(company string) {
	noteUse()
	requestKeepNow()
	r := runReq{kind: "now", why: "Update now"}
	if company != "" {
		r.only = []string{company}
	}
	startKeepRun(r)
}

// a posting went into Tally: once it is finished, the entries posted go into the copy and on to the cloud (one light
// update of that company; the entries themselves are not read back from Tally again)
func afterPosting(company string) {
	noteUse()
	if company == "" {
		return
	}
	evMu.Lock()
	postedFor[company] = nowFn()
	evMu.Unlock()
}
func postedDue() {
	evMu.Lock()
	if len(postedFor) == 0 {
		evMu.Unlock()
		return
	}
	evMu.Unlock()
	if len(activeJobs()) > 0 {
		return // still posting
	}
	evMu.Lock()
	var cos []string
	for c, t := range postedFor {
		if nowFn().Sub(t) >= 3*time.Second {
			cos = append(cos, c)
			delete(postedFor, c)
		}
	}
	evMu.Unlock()
	for _, c := range cos {
		evMu.Lock()
		delete(openSeen, c) // a posting is not held back by the opening debounce
		evMu.Unlock()
		wakeOpen(c, "after a posting")
	}
}

// d. the nightly catch-up: due from the hour set for NightlyWindowMin (240) minutes, once a night
func nightlyDue(now time.Time) (bool, string) {
	var h, mi int
	fmt.Sscanf(keepDailyAt(), "%d:%d", &h, &mi)
	at := time.Date(now.Year(), now.Month(), now.Day(), h, mi, 0, 0, now.Location())
	if now.Before(at) {
		at = at.AddDate(0, 0, -1) // just after midnight, a window that started yesterday
	}
	if now.Sub(at) >= time.Duration(keepNum("NightlyWindowMin", 240))*time.Minute {
		return false, ""
	}
	night := tallyDate(at)
	if keepLastRun() >= night {
		return false, ""
	}
	if t, ok := parseTime(readText(sp("keep-tried.txt"))); ok && now.Sub(t) < 30*time.Minute && !t.Before(at) {
		return false, ""
	}
	return true, night
}

var nightAt time.Time

func nightlyCheck() {
	now := nowFn()
	if now.Sub(nightAt) < 30*time.Second && !nightAt.After(now) {
		return
	}
	nightAt = now
	if !keepOn() || paused() || keepRunning() {
		return
	}
	due, night := nightlyDue(now)
	if !due {
		return
	}
	say := func(k, msg string) {
		if nightTold != night+k {
			nightTold = night + k
			writeLog(msg)
		}
	}
	if tallyOpenNow() == 0 {
		say("closed", "Nightly catch-up ("+keepDailyAt()+"): Tally is not open, so nothing is read; looked at again until the night's window ends")
		return
	}
	if u := anyBackoff(); !u.IsZero() {
		return
	}
	q := time.Duration(keepNum("NightlyQuietMin", 15)) * time.Minute
	if a := lastActivity(); !a.IsZero() && now.Sub(a) < q {
		say("used"+a.Format("1504"), fmt.Sprintf("Nightly catch-up waits: FinCom was used at %s; it starts after %d quiet minutes", a.Format("15:04"), int(q.Minutes())))
		return
	}
	_ = saveFile(sp("keep-tried.txt"), now.Format("2006-01-02T15:04:05"))
	startKeepRun(runReq{kind: "nightly", why: "nightly catch-up"})
}

// "opened" from the heartbeat's answer (company -> when), the fallback for the wake-up channel
func openedFromBeat(m M) {
	for co, v := range m {
		at := str(v)
		evMu.Lock()
		seen := openFromBeat[co]
		if at != "" && at > seen {
			openFromBeat[co] = at
		}
		evMu.Unlock()
		if at != "" && at > seen {
			// only a recent one (10 minutes): an old mark is not a client being opened now
			if t, err := time.Parse(time.RFC3339Nano, at); err == nil && nowFn().Sub(t) > 10*time.Minute {
				continue
			}
			wakeOpen(co, "opened in FinCom")
		}
	}
}

// --- the main loop's turn (every 100 ms): nothing in it asks Tally anything unless an event is due
var (
	turnCfgAt  time.Time
	turnPushAt time.Time
	turnFirst  = true
)

func bridgeTurn(safe func(string, func())) {
	safe("Posting queue", syncCloudPosts) // FinCom's cloud only; a posting found there goes to Tally (c)
	now := nowFn()
	if now.Sub(turnCfgAt) >= time.Duration(keepNum("KeepStartSec", 60))*time.Second || now.Before(turnCfgAt) {
		turnCfgAt = now
		syncConfig()
		safe("Check", showDiagnosis) // Windows' list of programs and ports; Tally is asked nothing
	}
	if turnFirst {
		turnFirst = false
		// Update now asked before a restart: still wanted
		if exists(sp("keep-now.txt")) && keepOn() {
			startKeepRun(runReq{kind: "now", why: "Update now (asked before the bridge started again)"})
		}
	}
	safe("Nightly catch-up", nightlyCheck)
	safe("After a posting", postedDue)
	// the outbox goes on without the copier too (days kept while offline go as soon as FinCom can be reached)
	if !keepRunning() && (now.Sub(turnPushAt) >= 60*time.Second || now.Before(turnPushAt)) {
		turnPushAt = now
		go safe("Cloud", func() { invokeCloudPush() })
	}
}

// the last read from Tally that came in, of any company kept here ("" when none)
func lastReadAt() string {
	last := ""
	for _, d := range keptDirs() {
		if st := readKeepState(d); st != nil && str(st["readAt"]) > last {
			last = str(st["readAt"])
		}
	}
	return last
}
