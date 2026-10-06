// The self-watch (plan item 10) and the read stop (item 11). Every request to Tally is timed here (from invokeTally): the
// heartbeat carries today's count, the last and the longest request and how many took over 20 s.
//
// 2.3.1 (the owner's last change, 06-Oct-2026): "A slow or unanswered request never switches reading off." The bridge no
// longer stops reading by itself (2.3.0 stopped all reading after a request over 20 s, or Tally silent for 2 minutes, kept
// until resumed): a request over 20 s is counted for the beat, and the background requests try again by themselves on the
// shared schedule (retry.go). A stop by itself saved by a 2.3.0 bridge is ignored and cleared at start (clearOldSwitchOffs).
// The owner's stop from FinCom is as before: the heartbeat's answer readStop stops reading on this computer (postings go
// on), and it lifts when FinCom's answer no longer carries one (readStop: null) or FinCom resumes (readResume: true).
package main

import (
	"errors"
	"fmt"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

func selfStopSec() int { return keepNum("SelfStopSec", 20) }

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
		// the measuring tool hits the limit on purpose (a ledger that hangs Tally): said in its report
		measureOver.Add(1)
		writeLog(fmt.Sprintf("Measure Tally: a request (%s) took %.1f s, more than %d s (the measuring tool is running)", kind, d.Seconds(), selfStopSec()))
	} else if over {
		// 2.3.1: counted for the beat (over20) and said; reading is never stopped for it
		writeLog(fmt.Sprintf("Tally: a request (%s) took %.1f s, more than %d s; reading goes on (the background requests try again by themselves when one is not answered in time)", kind, d.Seconds(), selfStopSec()))
	}
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

// {by: "fincom", reason, at}, or nil when reading goes on. 2.3.1: a stop by the bridge itself ("self", saved by 2.3.0) is
// no stop: it is ignored here and cleared at start (clearOldSwitchOffs)
func readStop() M {
	o := obj(cfg("ReadStop"))
	if o == nil || str(o["by"]) == "" || str(o["by"]) == "self" {
		return nil
	}
	return o
}

// 2.3.1, at start: a stop of reading by the bridge itself and the 2-second rule's switch-offs that a 2.3.0 bridge saved
// (the settings' ReadStop, the recorder's offsets file) are cleared, each said once in the log. The owner's stop from
// FinCom is kept
func clearOldSwitchOffs() {
	rsMu.Lock()
	o := obj(cfg("ReadStop"))
	if o != nil && str(o["by"]) == "self" {
		setCfg("ReadStop", nil)
		saveConfig()
		rsMu.Unlock()
		writeLog("Reading from Tally: a stop saved by an earlier bridge (by itself, " + strings.Replace(str(o["at"]), "T", " ", 1) + ": " + str(o["reason"]) +
			") is cleared; this bridge never stops reading by itself (a request not answered in time is tried again by itself)")
	} else {
		rsMu.Unlock()
	}
	live.mu.Lock()
	liveFresh()
	n := len(live.offWas)
	drop := live.offDrop
	live.offDrop = false
	live.mu.Unlock()
	if drop {
		writeLog(fmt.Sprintf("Recorder: %d switch-off(s) saved by an earlier bridge (the 2-second rule: the entry fetch, a source or the ledger changes off for a company) cleared; nothing is switched off now (a request not answered in time is tried again by itself)", n))
		liveSaveOffsets()
	}
}
func readStopped() bool { return readStop() != nil }

// the stop for JSON answers: null when reading goes on
func readStopAny() any {
	if st := readStop(); st != nil {
		return st
	}
	return nil
}

// stop reading (FinCom's stop: by "fincom")
func setReadStop(by, reason string) { setReadStopAt(by, reason, "") }

func setReadStopAt(by, reason, at string) {
	if at == "" {
		at = nowS()
	}
	rsMu.Lock()
	cur := readStop()
	if cur != nil && str(cur["by"]) == by && str(cur["reason"]) == reason {
		rsMu.Unlock()
		return
	}
	setCfg("ReadStop", M{"by": by, "reason": reason, "at": at})
	saveConfig()
	rsMu.Unlock()
	writeLog("Reading from Tally stopped on this computer from FinCom: " + reason + ". Postings still go; reading starts again only from FinCom")
}

// clear FinCom's stop: how = "fincom-resume" or "fincom-lifted" (FinCom's resume, or its answer without a stop)
func clearReadStop(how string) bool {
	rsMu.Lock()
	cur := readStop()
	if cur == nil {
		rsMu.Unlock()
		return false
	}
	setCfg("ReadStop", nil)
	saveConfig()
	rsMu.Unlock()
	writeLog("Reading from Tally resumed from FinCom (it was stopped: " + str(cur["reason"]) + ")")
	return true
}

// the tray's "Resume reading": 2.3.1 has no stop of its own to resume (never a manual resume); a stop made from FinCom
// stays until FinCom lifts it
func trayResumeReading() (M, error) {
	if st := readStop(); st != nil && str(st["by"]) == "fincom" {
		return M{"ok": true, "resumed": false, "byFinCom": true}, nil
	}
	return M{"ok": true, "resumed": false}, nil
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
	return fmt.Errorf("%w on this computer from FinCom (%s, %s); nothing was sent to Tally. Postings still go. Resume from FinCom (Resume reading for this computer)",
		errReadStopped, str(st["reason"]), strings.Replace(str(st["at"]), "T", " ", 1))
}

// a read asked of this bridge (FinCom's, or the measuring tool's): refused at once while reading is stopped, before even
// the company is looked for
func readsAllowed() error {
	if readStop() == nil {
		return nil
	}
	return readStopRefuses("<ENVELOPE><HEADER><ID>read</ID></HEADER></ENVELOPE>")
}

// the heartbeat's answer (plan item 11): readResume: true clears FinCom's stop; readStop: {by, reason, at} stops reading
// from FinCom; readStop: null lifts it. An answer without these fields (an older cloud) changes nothing
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
