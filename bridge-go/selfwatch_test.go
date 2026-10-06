package main

// Plan item 10: the self-watch. Every request's kind and time go into the heartbeat. 2.3.1 (the owner's last change): a
// request over 20 s, or Tally not answering for over 2 minutes, no longer stops reading (retry231_test.go); the owner's
// stop from FinCom stops reading on this computer (kept in the settings) while postings go on.

import (
	"net/http"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

// reading refused, nothing sent
func readsRefused(t *testing.T, f *standTally) {
	t.Helper()
	n0 := f.n("")
	if _, err := getLedgerNames(fin, zz, f.port); err == nil || !strings.Contains(err.Error(), "Reading from Tally is stopped") {
		t.Fatalf("a read while stopped: %v", err)
	}
	if startKeepRun(runReq{kind: "now", why: "test"}) {
		waitIdle(t)
	}
	if startKeepRun(runReq{kind: "nightly", why: "test"}) {
		waitIdle(t)
	}
	if _, err := getDayBookXML(fin, zz, today(), today(), f.port); err == nil {
		t.Fatal("the day book was read while stopped")
	}
	if got := f.ids()[n0:]; len(got) != 0 {
		t.Fatalf("sent while reading is stopped: %v", got)
	}
}

// 2.3.1 (the owner's last change): a request over 20 s is counted and said; reading is never stopped for it
func TestSelfStopOnSlowRequest(t *testing.T) {
	f := newStandTally(t)
	f.slow = func(id, body string) time.Duration {
		if id == "TDSDeskNames" {
			return 1500 * time.Millisecond
		}
		return 0
	}
	standBridge(t, f, `,"TallyMaxSec":3,"SelfStopSec":1`)
	liveFrom(today())
	if selfStopSec := keepNum("SelfStopSec", 20); selfStopSec != 1 {
		t.Fatal("config")
	}
	if _, err := getLedgerNames(fin, zz, f.port); err != nil {
		t.Fatalf("the ledger list with a slow request: %v", err)
	}
	if st := readStop(); st != nil || obj(cfg("ReadStop")) != nil {
		t.Fatalf("reading was stopped by itself after a slow request: %v", st)
	}
	if logLines("Reading from Tally stopped") != 0 || logLines("a request (TDSDeskNames) took") != 1 {
		t.Fatalf("the log:\n%s", readText(logFile()))
	}
	if toInt(obj(beatReqs())["over20"]) != 1 {
		t.Fatalf("not counted: %v", beatReqs())
	}
	f.mu.Lock()
	f.slow = nil
	f.mu.Unlock()
	n0 := f.n("")
	if _, err := getLedgerNames(fin, zz, f.port); err != nil || f.n("") == n0 {
		t.Fatalf("a read after it: %v", err)
	}
	if tip := trayTip(trayStatus()); strings.Contains(tip, "Reading stopped") {
		t.Fatalf("the tray tip: %q", tip)
	}
}

// 2.3.1: Tally silent for over 2 minutes stops nothing; the small check goes once a minute as before and reads go again
// once Tally answers
func TestSelfStopOnSilence(t *testing.T) {
	f := newStandTally(t)
	var silent atomic.Bool
	silent.Store(true)
	f.behave = func(w http.ResponseWriter, r *http.Request, id, body string) bool {
		if silent.Load() {
			return silentFor(func(string, string) bool { return true }, nil)(w, r, id, body)
		}
		return false
	}
	standBridge(t, f, `,"TallyMaxSec":1,"TallyProbeSec":1`)
	liveFrom(today())
	start := time.Now()
	at := func(sec int) { nowFn = func() time.Time { return start.Add(time.Duration(sec) * time.Second) } }
	t.Cleanup(func() { nowFn = time.Now })
	for _, sec := range []int{0, 61, 122, 183} {
		at(sec)
		_, _ = getLedgerNames(fin, zz, f.port) // not answered
		if readStop() != nil {
			t.Fatalf("reading stopped after %d s of silence", sec)
		}
	}
	silent.Store(false)
	at(244)
	if _, err := getLedgerNames(fin, zz, f.port); err != nil {
		t.Fatalf("a read once Tally answers again: %v", err)
	}
	if logLines("Reading from Tally stopped") != 0 {
		t.Fatalf("the log:\n%s", readText(logFile()))
	}
}

// postings go while FinCom's owner has stopped reading on this computer
func TestPostingWorksWhenStopped(t *testing.T) {
	td := today()
	f := newStandTally(t)
	standBridge(t, f, "")
	liveFrom(td)
	setReadStop("fincom", "Stopped by the owner from FinCom")
	n0 := f.n("")
	if r := postOne(t, "st1", finVoucher("st1", fgParty, "ST-1", td, "5.00")); r["ok"] != true || r["byReply"] != true {
		t.Fatalf("a posting while reading is stopped: %v", r)
	}
	for _, id := range f.ids()[n0:] {
		if !readStopExempt(id) {
			t.Fatalf("a read went with the posting: %s", id)
		}
	}
	if f.n("Import") != 1 {
		t.Fatal("not posted")
	}
	// the same id again: this computer's record still refuses it (round 15), not posted
	if r := postOne(t, "st1", finVoucher("st1", fgParty, "ST-1", td, "5.00")); r["ok"] == true || r["alreadySent"] != true {
		t.Fatalf("posted twice: %v", r)
	}
	readsRefused(t, f)
}

// FinCom's stop is kept across a restart; the tray cannot lift it (FinCom does); a 2.3.0 stop by itself is not kept
func TestStopSurvivesRestart(t *testing.T) {
	f := newStandTally(t)
	standBridge(t, f, "")
	liveFrom(today())
	setReadStop("fincom", "Stopped by the owner from FinCom")
	// a restart: the settings read again from the file
	setCfg("ReadStop", nil)
	loadConfig()
	clearOldSwitchOffs()
	st := readStop()
	if st == nil || str(st["by"]) != "fincom" {
		t.Fatalf("the stop after a restart: %v", st)
	}
	readsRefused(t, f)
	if r, err := trayResumeReading(); err != nil || r["resumed"] != false || r["byFinCom"] != true {
		t.Fatalf("the tray: %v %v", r, err)
	}
	if readStop() == nil {
		t.Fatal("the tray lifted FinCom's stop")
	}
	applyReadControl(M{"readStop": nil})
	loadConfig()
	if readStop() != nil {
		t.Fatal("the stop came back after a restart")
	}
	if _, err := getLedgerNames(fin, zz, f.port); err != nil {
		t.Fatalf("a read after FinCom lifted the stop: %v", err)
	}
	if logLines("Reading from Tally resumed from FinCom") != 1 {
		t.Fatal("the resume is not in the log")
	}
}

func TestBeatCarriesTimings(t *testing.T) {
	td := today()
	f := newStandTally(t)
	f.slow = func(id, body string) time.Duration {
		if id == "TDSDeskGroupNames" {
			return 1200 * time.Millisecond
		}
		return 0
	}
	c := newStandCloud(t)
	standBridge(t, f, `,"TallyMaxSec":3,"SelfStopSec":1`+c.cfg())
	resetSelfWatch()
	if _, err := getLedgerNames(fin, zz, f.port); err != nil {
		t.Fatal(err)
	}
	b := beatBody(true, "open", "", nil, nil, nil)
	rq := obj(b["reqs"])
	if rq == nil || str(rq["day"]) != td[:4]+"-"+td[4:6]+"-"+td[6:] || toInt(rq["n"]) < 2 || toInt(rq["over20"]) != 1 {
		t.Fatalf("reqs in the beat: %v", b["reqs"])
	}
	last, long := obj(rq["last"]), obj(rq["longest"])
	if str(last["kind"]) != "TDSDeskGroupNames" || str(long["kind"]) != "TDSDeskGroupNames" || toInt(long["ms"]) < 1100 || str(long["at"]) == "" {
		t.Fatalf("last %v, longest %v", last, long)
	}
	if b["readStopped"] != nil {
		t.Fatalf("a slow request stopped reading: %v", b["readStopped"])
	}
	setReadStop("fincom", "Stopped by the owner from FinCom")
	rs := obj(beatBody(true, "open", "", nil, nil, nil)["readStopped"])
	if rs == nil || str(rs["by"]) != "fincom" || str(rs["reason"]) == "" {
		t.Fatalf("readStopped in the beat: %v", rs)
	}
	// no stop: readStopped is null
	clearReadStop("fincom-lifted")
	if b := beatBody(true, "open", "", nil, nil, nil); b["readStopped"] != nil {
		t.Fatalf("readStopped without a stop: %v", b["readStopped"])
	}
	if _, ok := beatBody(true, "open", "", nil, nil, nil)["readStopped"]; !ok {
		t.Fatal("readStopped is left out instead of null")
	}
	// the beat as sent: the timings and the version running
	beatOnce()
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.lastBeat == nil || obj(c.lastBeat["reqs"]) == nil || str(c.lastBeat["version"]) != BridgeVersion {
		t.Fatalf("the beat sent: %v", c.lastBeat)
	}
}

// --- plan item 11: FinCom's owner stops reading on this computer through the heartbeat's answer; postings go on
func TestRemoteStopFromBeat(t *testing.T) {
	td := today()
	f := newStandTally(t)
	c := newStandCloud(t)
	standBridge(t, f, c.cfg())
	liveFrom(td)
	reply := func(m M) {
		c.mu.Lock()
		c.beatReply = m
		c.mu.Unlock()
		beatOnce()
	}
	// a stop from FinCom
	reply(M{"readStop": M{"by": "fincom", "reason": "Stopped by the owner from FinCom", "at": "2026-10-02T10:00:00"}})
	st := readStop()
	if st == nil || str(st["by"]) != "fincom" || str(st["reason"]) != "Stopped by the owner from FinCom" {
		t.Fatalf("FinCom's stop: %v", st)
	}
	readsRefused(t, f)
	if r := postOne(t, "rs1", finVoucher("rs1", fgParty, "RS-1", td, "3.00")); r["ok"] != true {
		t.Fatalf("a posting while FinCom stopped reading: %v", r)
	}
	// the next beat says the same: no change, one line in the log
	reply(M{"readStop": M{"by": "fincom", "reason": "Stopped by the owner from FinCom", "at": "2026-10-02T10:00:00"}})
	if logLines("Reading from Tally stopped on this computer from FinCom") != 1 {
		t.Fatal("the stop was said more than once")
	}
	// an answer without the field (an older cloud): no change
	reply(M{})
	if readStop() == nil {
		t.Fatal("lifted by an answer that does not speak of it")
	}
	// FinCom lifts it: reading goes on
	reply(M{"readStop": nil})
	if readStop() != nil {
		t.Fatal("still stopped after FinCom lifted its stop")
	}
	if _, err := getLedgerNames(fin, zz, f.port); err != nil {
		t.Fatalf("a read after FinCom lifted the stop: %v", err)
	}
	// FinCom's resume clears its stop too
	reply(M{"readStop": M{"by": "fincom", "reason": "Stopped by the owner from FinCom"}})
	reply(M{"readStop": nil, "readResume": true})
	if readStop() != nil {
		t.Fatal("still stopped after FinCom's resume")
	}
	if logLines("Reading from Tally resumed from FinCom") < 2 {
		t.Fatal("the resume is not in the log")
	}
	// the beat says what is stopped
	reply(M{"readStop": M{"by": "fincom", "reason": "Stopped by the owner from FinCom"}})
	reply(M{"readStop": M{"by": "fincom", "reason": "Stopped by the owner from FinCom"}})
	c.mu.Lock()
	rs := obj(c.lastBeat["readStopped"])
	c.mu.Unlock()
	if rs == nil || str(rs["by"]) != "fincom" {
		t.Fatalf("the beat's readStopped: %v", rs)
	}
}
