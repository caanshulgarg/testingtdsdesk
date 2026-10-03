// The self-watch (plan item 10) and the read stop (items 10 and 11). Every request to Tally is timed here (from
// invokeTally): the heartbeat carries today's count, the last and the longest request and how many took over 20 s. A
// request over SelfStopSec (20 s), or Tally not answering for over SelfStopSilenceSec (2 minutes), stops all reading on
// this computer: the background reads, Update now, the ledger lists, the catch-up and FinCom's reads are refused before
// anything is sent. Postings go on (the company list and check, the duplicate and FinCom id checks, the import, the
// small check after a timeout). The stop is kept in the settings (ReadStop), so a restart keeps it.
//
// Who stops and who resumes: a stop by the bridge itself ("self") is cleared only by the tray's "Resume reading" or by
// FinCom's resume (the heartbeat's answer readResume: true). A stop from FinCom ("fincom", the heartbeat's answer
// readStop) lifts when FinCom's answer no longer carries one (readStop: null), or from the tray.
package main

import (
	"errors"
	"fmt"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

func selfStopSec() int        { return keepNum("SelfStopSec", 20) }
func selfStopSilenceSec() int { return keepNum("SelfStopSilenceSec", 120) }

// requests of the measuring tool over the limit (they do not stop reading; the report says so)
var measureOver atomic.Int32

// --- today's requests
type reqNote struct {
	kind string
	ms   int64
	at   string
}

var (
	swMu      sync.Mutex
	swDay     string
	swLast    *reqNote
	swLongest *reqNote
	swOver    int
	swN       int
)

func resetSelfWatch() {
	swMu.Lock()
	swDay, swLast, swLongest, swOver, swN = "", nil, nil, 0, 0
	swMu.Unlock()
}

func dayISO(t time.Time) string { return t.Format("2006-01-02") }

// one request sent to Tally, and how long it held Tally
func noteRequest(x string, d time.Duration, fail string) {
	kind := tallyRequestID(x)
	n := &reqNote{kind: kind, ms: d.Milliseconds(), at: time.Now().Format("2006-01-02T15:04:05")}
	over := d > time.Duration(selfStopSec())*time.Second
	if over && kind == "Import" {
		// review of 2.1.8, finding 7: an import request has its own timeout (importTimeoutSec); its time is import time,
		// never the self-watch's over-the-limit read
		writeLog(fmt.Sprintf("Posting: an import request took %.1f s (%d voucher(s)); that is import time, not counted against the %d s read limit", d.Seconds(), strings.Count(x, "<VOUCHER "), selfStopSec()))
		over = false
	}
	swMu.Lock()
	if day := dayISO(time.Now()); day != swDay {
		swDay, swLongest, swOver, swN = day, nil, 0, 0
	}
	swN++
	swLast = n
	if swLongest == nil || n.ms > swLongest.ms {
		swLongest = n
	}
	if over {
		swOver++
	}
	swMu.Unlock()
	if over && measuring.Load() > 0 {
		// the measuring tool hits the limit on purpose (a ledger that hangs Tally): said in its report, reading goes on
		measureOver.Add(1)
		writeLog(fmt.Sprintf("Measure Tally: a request (%s) took %.1f s, more than %d s; reading was not stopped (the measuring tool is running)", kind, d.Seconds(), selfStopSec()))
	} else if over {
		setReadStop("self", fmt.Sprintf("a request to Tally (%s) took %.1f s, more than %d s", kind, d.Seconds(), selfStopSec()))
	}
}

// --- silence: Tally took requests and answered none of them (the small check included) for over two minutes while they
// were being sent. Kept in memory from this bridge's own requests (an old "not answering" file left from before is not
// silence), and measured between the first request not answered and the latest one: one failure followed by idle time
// is not silence
var (
	silMu    sync.Mutex
	silFirst time.Time // the first request not answered since Tally last answered
	silLast  time.Time // the latest request not answered
)

func resetSilence() {
	silMu.Lock()
	silFirst, silLast = time.Time{}, time.Time{}
	silMu.Unlock()
}

// a request sent to Tally: answered (err nil), or not (a timeout, an answer cut off); other errors say nothing
func noteSilence(err error) {
	if err != nil && !tallyNoAnswer(err) {
		return
	}
	silMu.Lock()
	if err == nil {
		silFirst, silLast = time.Time{}, time.Time{}
	} else {
		if silFirst.IsZero() {
			silFirst = nowFn()
		}
		silLast = nowFn()
	}
	silMu.Unlock()
	if err != nil {
		selfWatchTick()
	}
}

// Tally silent for over SelfStopSilenceSec while being asked: reading stops (also called from the heartbeat loop)
func selfWatchTick() {
	silMu.Lock()
	first, last := silFirst, silLast
	silMu.Unlock()
	if first.IsZero() || last.Sub(first) <= time.Duration(selfStopSilenceSec())*time.Second {
		return
	}
	if measuring.Load() > 0 {
		return // the measuring tool waits for Tally on purpose (measure.go); its report says what happened
	}
	setReadStop("self", fmt.Sprintf("Tally has not answered since %s (over %d minutes of requests not answered)", first.Format("15:04"), selfStopSilenceSec()/60))
}

// the heartbeat's reqs: {day, last: {kind, ms, at}, longest: {kind, ms, at}, over20, n}
func beatReqs() M {
	swMu.Lock()
	defer swMu.Unlock()
	day := dayISO(time.Now())
	if swDay != day {
		return M{"day": day, "last": noteM(swLast), "longest": nil, "over20": 0, "n": 0}
	}
	return M{"day": day, "last": noteM(swLast), "longest": noteM(swLongest), "over20": swOver, "n": swN}
}
func noteM(n *reqNote) any {
	if n == nil {
		return nil
	}
	return M{"kind": n.kind, "ms": n.ms, "at": n.at}
}

// --- the read stop, kept in the settings
var rsMu sync.Mutex

// {by: "self"|"fincom", reason, at}, or nil when reading goes on
func readStop() M {
	o := obj(cfg("ReadStop"))
	if o == nil || str(o["by"]) == "" {
		return nil
	}
	return o
}
func readStopped() bool { return readStop() != nil }

// the stop for JSON answers: null when reading goes on
func readStopAny() any {
	if st := readStop(); st != nil {
		return st
	}
	return nil
}

// stop reading. A stop by the bridge itself is not replaced by FinCom's (it needs the tray or FinCom's resume)
func setReadStop(by, reason string) { setReadStopAt(by, reason, "") }

func setReadStopAt(by, reason, at string) {
	if at == "" {
		at = nowS()
	}
	rsMu.Lock()
	cur := readStop()
	if cur != nil && (str(cur["by"]) == "self" || (str(cur["by"]) == by && str(cur["reason"]) == reason)) {
		rsMu.Unlock()
		return
	}
	setCfg("ReadStop", M{"by": by, "reason": reason, "at": at})
	saveConfig()
	rsMu.Unlock()
	who := map[string]string{"self": "by the bridge itself", "fincom": "from FinCom"}[by]
	again := "from the tray icon (Resume reading) or from FinCom"
	if by == "fincom" {
		again = "from FinCom"
	}
	writeLog("Reading from Tally stopped on this computer " + who + ": " + reason + ". Postings still go; reading starts again only " + again)
}

// clear the stop: how = "tray" (the bridge's own stop only: a stop made from FinCom is lifted in FinCom),
// "fincom-resume" (any stop), "fincom-lifted" (FinCom's own stop only)
func clearReadStop(how string) bool {
	rsMu.Lock()
	cur := readStop()
	if cur == nil || (how == "fincom-lifted" && str(cur["by"]) != "fincom") || (how == "tray" && str(cur["by"]) != "self") {
		rsMu.Unlock()
		return false
	}
	setCfg("ReadStop", nil)
	saveConfig()
	rsMu.Unlock()
	switch how {
	case "tray":
		writeLog("Reading from Tally resumed from the tray icon (it was stopped: " + str(cur["reason"]) + ")")
	default:
		writeLog("Reading from Tally resumed from FinCom (it was stopped: " + str(cur["reason"]) + ")")
	}
	return true
}

// the tray's "Resume reading": a stop by the bridge itself only; a stop made from FinCom stays until FinCom lifts it
func trayResumeReading() (M, error) {
	if !clearReadStop("tray") {
		if st := readStop(); st != nil && str(st["by"]) == "fincom" {
			return M{"ok": true, "resumed": false, "byFinCom": true}, nil
		}
		return M{"ok": true, "resumed": false}, nil
	}
	return M{"ok": true, "resumed": true}, nil
}

// the requests that go on while reading is stopped: what a posting needs
func readStopExempt(id string) bool {
	switch id {
	case "Import", dupCheckID, tagCheckID, "FinComCompany", "FinComFree", "TDSDeskCompanies", "TDSDeskCompanyInfo":
		return true
	}
	return false
}

var errReadStopped = errors.New("Reading from Tally is stopped")

// nil when this request may go: a read is refused while reading is stopped (nothing sent)
func readStopRefuses(x string) error {
	st := readStop()
	if st == nil || readStopExempt(tallyRequestID(x)) {
		return nil
	}
	who, again := "by the bridge itself", "the tray icon (Resume reading) or FinCom"
	if str(st["by"]) == "fincom" {
		who, again = "from FinCom", "FinCom (Resume reading for this computer)"
	}
	return fmt.Errorf("%w on this computer %s (%s, %s); nothing was sent to Tally. Postings still go. Resume from %s",
		errReadStopped, who, str(st["reason"]), strings.Replace(str(st["at"]), "T", " ", 1), again)
}

// a read asked of this bridge (FinCom's, or the measuring tool's): refused at once while reading is stopped, before even
// the company is looked for
func readsAllowed() error {
	if readStop() == nil {
		return nil
	}
	return readStopRefuses("<ENVELOPE><HEADER><ID>read</ID></HEADER></ENVELOPE>")
}

// the heartbeat's answer (plan item 11): readResume: true clears any stop (the only way FinCom clears the bridge's own);
// readStop: {by, reason, at} stops reading from FinCom; readStop: null lifts FinCom's own stop only. An answer without
// these fields (an older cloud) changes nothing
func applyReadControl(j M) {
	if j == nil {
		return
	}
	if truthy(j["readResume"]) {
		clearReadStop("fincom-resume")
	}
	v, ok := j["readStop"]
	if !ok {
		return
	}
	if o := obj(v); o != nil {
		reason := str(o["reason"])
		if reason == "" {
			reason = "stopped by the owner from FinCom"
		}
		setReadStopAt("fincom", reason, str(o["at"]))
		return
	}
	clearReadStop("fincom-lifted")
}
