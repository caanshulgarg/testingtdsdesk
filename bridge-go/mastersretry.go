// next-fix-mastersread (staging, a shared Windows server: the first read of a linked company's masters ended 3 s after
// it began with "Tally gave no masters for this company", and nothing asked again though the company stayed open for 30
// more minutes): while a linked company is open in this user's own Tally and FinCom holds no masters of it after a failed
// read (mastersFail, ledgers.go), the light check (every 10 minutes per open company, startpoint.go) asks for one more
// read of it: an Update from Tally of that company alone, as a run nobody pressed (runReq.short: each request under the
// 2 s stop, the company list and check too; not while someone works in Tally, giving up after 2 minutes held; not while
// reading is paused). Only the requests every read makes (no new request to Tally). At most once in 10 minutes per
// company, never while another read or a posting goes (a posting goes first), and no more once MastersRetryMax (3)
// reads in a row failed with the same reason (its list and quoted values left out), nor after MastersRetryDayMax (6)
// retries in a day (said once in the log; the reason stays on FinCom's masters line)
package main

import (
	"fmt"
	"sync"
	"time"
)

var (
	mrMu    sync.Mutex
	mrAt    = map[string]time.Time{} // company key -> when its last retry was started
	mrTold  = map[string]string{}    // company key -> the last reason a retry was not asked (said once)
	mrTries = map[string]int{}       // review N2: company key + "|" + the day -> retries started that day
	mrStart = func(r runReq) bool { return startKeepRun(r) }
	// the port of this bridge's own Tally with the company open ("" : yes; else why not; tests replace it)
	mrOwnTally = func(company string, port int) string {
		_, why := ledOwnPort(company, heldGUID(company), port)
		return why
	}
)

func mastersRetryMax() int    { return keepNum("MastersRetryMax", 3) }
func mastersRetryDayMax() int { return keepNum("MastersRetryDayMax", 6) }
func mastersRetryEvery() time.Duration {
	return time.Duration(keepNum("MastersRetryMin", 10)) * time.Minute
}

// the cloud's links as last answered (cloudLinksHeld), readable without cloudMu
func linkedHeld(company string) bool {
	cloudLinksMu.Lock()
	defer cloudLinksMu.Unlock()
	return cloudLinksHeld[company] || cloudLinksHeld[coTrim(company)]
}

// "" when one more read of the company's masters is due now; else why not
func mastersRetryWhyNot(company string, port int) string {
	key := companyKey(company)
	st := keepStateOf(company)
	switch {
	case !keepOn():
		return "keeping the books in step is off"
	case paused():
		return "background reading is paused"
	case readStopped():
		return "reading from Tally is stopped on this computer"
	case !cloudOn():
		return "FinCom's cloud is not set"
	case !linkedHeld(company):
		return "not linked in FinCom"
	case st == nil || obj(st["mastersFail"]) == nil:
		return "no failed masters read"
	}
	// (review N7: the read time first; the list file only when no full read is known)
	if dir, err := companyDir(company); err == nil && mastersHeld(dir, st) {
		return "its masters are held"
	}
	f := obj(st["mastersFail"])
	if n := toInt(f["n"]); n >= mastersRetryMax() {
		return fmt.Sprintf("%d reads in a row failed with the same reason (%s); asked again only by Update from Tally or Bring masters", n, str(f["why"]))
	}
	mrMu.Lock()
	last, tries := mrAt[key], mrTries[key+"|"+today()]
	mrMu.Unlock()
	switch {
	case tries >= mastersRetryDayMax():
		return fmt.Sprintf("asked again %d times today; asked again only by Update from Tally or Bring masters", tries)
	case !last.IsZero() && nowFn().Sub(last) < mastersRetryEvery():
		return "asked again " + last.Format("15:04")
	case keepRunning():
		return "a read is going"
	case postingGoing():
		return "a posting goes first"
	case typingInTally():
		return "someone is typing in Tally"
	case leaseHeldHere(company):
		return "this bridge holds the company for a posting"
	case !anyBackoff().IsZero():
		return "Tally is left alone for now after it did not answer"
	}
	return mrOwnTally(company, port)
}

// after the light check of a company open in Tally (startpoint.go): one more masters read when due; true when started
func mastersRetryAfterLightCheck(company string, port int) bool {
	key := companyKey(company)
	if why := mastersRetryWhyNot(company, port); why != "" {
		mrMu.Lock()
		say := mrTold[key] != why && why != "no failed masters read" && why != "its masters are held" && why != "not linked in FinCom"
		mrTold[key] = why
		mrMu.Unlock()
		if say {
			writeLog("Masters of " + company + ": not read again now (" + why + ")")
		}
		return false
	}
	f := obj(keepStateOf(company)["mastersFail"])
	mrMu.Lock()
	mrAt[key], mrTold[key] = nowFn(), ""
	mrTries[key+"|"+today()]++ // review N2: every retry started counts, whatever came of it (held, left alone, failed)
	mrMu.Unlock()
	writeLog(fmt.Sprintf("Masters of %s: FinCom holds none and the last read failed (%s); the company is open in this user's own Tally, so they are read once more", company, str(f["why"])))
	return mrStart(runReq{kind: "now", only: []string{company}, why: "masters not in FinCom after a failed read", short: true})
}
