package main

// Bridge 2.3.1, the owner's last change (06-Oct-2026): "A slow or unanswered request never switches reading off and never
// turns the entry fetch off for a company." Each background request keeps its 2-second hard stop (TC.limitMs). After a
// stop, or a request Tally did not answer, the bridge tries again by itself on ONE shared schedule: 15 s, 30 s, 1 min,
// 2 min, then every 5 min at most. Until the next try nothing of the background is sent; the try is one request (the first
// background request due), and its answer in time puts everything back to normal. The background requests are the
// entry fetch (by MasterID, by type and number, sources B and C), the company list asked in the background, the ledger
// changes, the light company check and the held-line resolve (TC.bg). Postings and a person's actions (Update now, the
// tray's tests, FinCom's reads, the read-back and checks of a posting) never wait on it. Nothing to resume by hand: the
// tries go on by themselves. Each try is one line in the log, and the Tally page says it in plain words (the beat's
// tallyRetry). This replaces 2.3.0's self-stop of reading (a request over 20 s, or Tally silent for 2 minutes, kept
// until resumed), the 2-second rule's switch-off of the entry fetch, sources B and C and the ledger changes per company
// (until the owner changed where the changes come from), and 2.3.1's 5/10/20/30-minute back-off of the company list.

import (
	"errors"
	"fmt"
	"sync"
	"time"
)

var retrySteps = []time.Duration{15 * time.Second, 30 * time.Second, time.Minute, 2 * time.Minute, 5 * time.Minute}

var (
	retryMu    sync.Mutex
	retryN     int       // stops or requests not answered in a row
	retryAt    time.Time // when Tally last did not answer in time
	retryUntil time.Time // no background request before this
	retryGoing bool      // the try is at Tally now: the other background requests wait for its answer
	// 2.3.3 (the slow-company rule with only entry requests going): a small check (the beat's light company check, the
	// company list) found the schedule waiting at this time: the next try is kept for it (RecorderSmallTrySec, 120 s at
	// most), so Tally's answer in time to another request is seen between two entry stops
	retrySmallWant time.Time
	retryTakes     int64 // tries taken (the uploader's turn order: the resolver at most every other try, 2.3.3)
)

// 2.3.3: the small checks a try is kept for (existing requests of the allow-list; none added or changed)
func retrySmall(id string) bool {
	return id == "FinComCompany" || id == cnReportID || id == "TDSDeskCompanies" || id == "FinComFree"
}

// the number of tries taken so far
func retryTakesNow() int64 {
	retryMu.Lock()
	defer retryMu.Unlock()
	return retryTakes
}

// a background request held by the schedule (nothing sent): not a posting going first (gaveWay is false), not counted
// as a try of anything
var errRetryWait = errors.New("Tally did not answer in time")

type retryErr struct{ at, next time.Time }

func (e *retryErr) Error() string {
	return fmt.Sprintf("Tally did not answer in time at %s; trying again by itself at %s (nothing was sent)", e.at.Format("15:04"), e.next.Format("15:04"))
}
func (e *retryErr) Is(t error) bool { return t == errRetryWait }

func retryStep(n int) time.Duration {
	if n < 1 {
		n = 1
	}
	if n > len(retrySteps) {
		n = len(retrySteps)
	}
	return retrySteps[n-1]
}

// whether a background request would be held now
func retryHeld() bool {
	retryMu.Lock()
	defer retryMu.Unlock()
	return retryN > 0 && (nowFn().Before(retryUntil) || retryGoing)
}

// when the next try goes (zero: no try pending)
func retryNext() time.Time {
	retryMu.Lock()
	defer retryMu.Unlock()
	if retryN == 0 {
		return time.Time{}
	}
	return retryUntil
}

func retryReset() {
	retryMu.Lock()
	retryN, retryAt, retryUntil, retryGoing = 0, time.Time{}, time.Time{}, false
	retrySmallWant = time.Time{}
	retryMu.Unlock()
}

// a background request about to be sent (id: its request id): it goes (try: it is the schedule's try), or why it waits.
// 2.3.3: a small check that found the schedule waiting has the next try kept for it, 120 s at most after it is due
func retryTake(id string) (try bool, err error) {
	retryMu.Lock()
	defer retryMu.Unlock()
	if retryN == 0 {
		return false, nil
	}
	now := nowFn()
	small := retrySmall(id)
	if now.Before(retryUntil) || retryGoing {
		if small {
			retrySmallWant = now
		}
		return false, &retryErr{retryAt, retryUntil}
	}
	keep := time.Duration(keepNum("RecorderSmallTrySec", 120)) * time.Second
	if !small && !retrySmallWant.IsZero() && now.Sub(retrySmallWant) <= keep && now.Sub(retryUntil) <= keep {
		return false, &retryErr{retryAt, retryUntil} // the try is kept for the small check waiting for it
	}
	if small {
		retrySmallWant = time.Time{}
	}
	retryGoing = true
	retryTakes++
	return true, nil
}

// a background request that is not the try, at the moment it would be sent: why it waits (nil: it goes)
func retryWaiting() error {
	retryMu.Lock()
	defer retryMu.Unlock()
	if retryN > 0 && (nowFn().Before(retryUntil) || retryGoing) {
		return &retryErr{retryAt, retryUntil}
	}
	return nil
}

// what a background request came to: an answer in time ends the schedule; a stop at 2 s or no answer is the next step;
// anything else (refused before sending, a posting going first, Tally closed) changes nothing
func retryNote(port int, id string, err error) {
	retryMu.Lock()
	defer retryMu.Unlock()
	retryGoing = false
	switch {
	case err == nil:
		if retryN > 0 {
			writeLog(fmt.Sprintf("Tally %d answered in time again (%s): the background requests are back to normal", port, id))
		}
		retryN, retryAt, retryUntil = 0, time.Time{}, time.Time{}
	case errors.Is(err, errRecorderStop) || tallyNoAnswer(err):
		retryN++
		retryAt = nowFn()
		retryUntil = retryAt.Add(retryStep(retryN))
		writeLog(fmt.Sprintf("Tally %d did not answer in time at %s (%s, try %d); trying again by itself at %s",
			port, retryAt.Format("15:04:05"), id, retryN, retryUntil.Format("15:04:05")))
	}
}

// next-inflight: Tally finished the request given up within the 20 s wait after the stop: the next background request
// may go now (the step count stays: another stop waits longer)
func retryLift() {
	retryMu.Lock()
	defer retryMu.Unlock()
	if retryN > 0 && !retryGoing && nowFn().Before(retryUntil) {
		retryUntil = nowFn()
	}
}

// the Tally page's words: "Tally did not answer in time at 12:14; trying again by itself at 12:15"; "" when normal
func retryWords() string {
	retryMu.Lock()
	defer retryMu.Unlock()
	if retryN == 0 {
		return ""
	}
	return fmt.Sprintf("Tally did not answer in time at %s; trying again by itself at %s", retryAt.Format("15:04"), retryUntil.Format("15:04"))
}

// the beat's tallyRetry: {words, at, next, tries}, or nil when the background requests go as normal
func retryBeat() any {
	w := retryWords()
	if w == "" {
		return nil
	}
	retryMu.Lock()
	defer retryMu.Unlock()
	return M{"words": w, "at": retryAt.Format("2006-01-02T15:04:05"), "next": retryUntil.Format("2006-01-02T15:04:05"), "tries": retryN}
}
