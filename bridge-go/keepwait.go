package main

// next-fix-read-any-bridge (07-Nov-2026, staging): a run of the copier that waits before reading (someone working in
// Tally, Tally just opened, FinCom reading from Tally, a posting going, reading stopped) is said in the beat
// (keepWait: {reason, words, since, queued}), so FinCom can show it beside Update now. An Update now (or another run)
// that came in meanwhile and waits behind it is said as queued. Nothing here asks Tally anything.

import (
	"sync"
	"time"
)

var (
	keepWaitMu    sync.Mutex
	keepWaitCode  string
	keepWaitLog   string
	keepWaitSince time.Time
)

// under the run (keepWorker): the reason code and the log's words ("" , "": not waiting)
func setKeepWait(code, words string) {
	keepWaitMu.Lock()
	defer keepWaitMu.Unlock()
	if code != keepWaitCode {
		keepWaitSince = time.Now()
	}
	if code == "" {
		keepWaitSince = time.Time{}
	}
	keepWaitCode, keepWaitLog = code, words
}

// the reason code of the run's wait now ("" when no run waits)
func keepWaitWhy() string {
	keepWaitMu.Lock()
	defer keepWaitMu.Unlock()
	return keepWaitCode
}

// the person's words for a wait
func keepWaitWords(code, logWords string) string {
	switch code {
	case "userInTally":
		return "Waiting: someone is working in Tally on this computer. Reading starts once Tally has had no typing or clicks for 15 s."
	case "tallyYoung":
		return "Waiting: Tally has just opened. Reading starts once it has finished loading (about 3 minutes)."
	case "fincomReading":
		return "Waiting: FinCom is reading from Tally on this computer. Reading starts when that is done."
	case "posting":
		return "Waiting: a posting into Tally is going on. Reading starts after it."
	case "stopped":
		if logWords == "" {
			logWords = "reading from Tally is stopped on this computer"
		}
		return "Waiting: " + logWords + "."
	}
	if logWords != "" {
		return "Waiting: " + logWords + "."
	}
	return "Waiting."
}

// the beat's keepWait: nil when no run waits and nothing is queued
func keepWaitBeat() any {
	keepWaitMu.Lock()
	code, lw, since := keepWaitCode, keepWaitLog, keepWaitSince
	keepWaitMu.Unlock()
	kwMu.Lock()
	running, pending := kwRunning, kwPending
	pk := ""
	if pending != nil {
		pk = pending.kind
	}
	kwMu.Unlock()
	if !running || code == "" {
		return nil
	}
	words := keepWaitWords(code, lw)
	out := M{"reason": code, "words": words, "since": since.UTC().Format(time.RFC3339)}
	if pk != "" {
		what := map[string]string{"now": "Update now", "nightly": "The nightly catch-up", "ledgers": "A ledger list", "light": "A light update"}[pk]
		if what == "" {
			what = "An update"
		}
		out["queued"] = what + " is queued: " + words
	}
	return out
}
