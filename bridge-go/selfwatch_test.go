package main

// Plan item 10: the self-watch. Every request's kind and time go into the heartbeat; a request over 20 s, or Tally not
// answering for over 2 minutes, stops all reading on this computer (kept in the settings, so a restart keeps it) while
// postings go on; the tray's "Resume reading" clears it.

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
	_, _ = getLedgerNames(fin, zz, f.port) // its second request (the groups) is already refused
	st := readStop()
	if st == nil || str(st["by"]) != "self" || !strings.Contains(str(st["reason"]), "TDSDeskNames") || str(st["at"]) == "" {
		t.Fatalf("not stopped by itself after a slow request: %v", st)
	}
	if logLines("Reading from Tally stopped on this computer by the bridge itself") != 1 {
		t.Fatal("the stop is not in the log")
	}
	f.mu.Lock()
	f.slow = nil
	f.mu.Unlock()
	readsRefused(t, f)
	// the tray shows why
	if tip := trayTip(trayStatus()); !strings.Contains(tip, "Reading stopped") {
		t.Fatalf("the tray tip: %q", tip)
	}
}

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
	resetSilence()
	start := time.Now()
	at := func(sec int) { nowFn = func() time.Time { return start.Add(time.Duration(sec) * time.Second) } }
	at(0)
	_, _ = getLedgerNames(fin, zz, f.port) // not answered
	// the small check once a minute, not answered either: 61 s, still under 2 minutes
	at(61)
	_, _ = getLedgerNames(fin, zz, f.port)
	selfWatchTick()
	if readStop() != nil {
		t.Fatal("stopped after a minute")
	}
	// 122 s: Tally has answered nothing for over 2 minutes while being asked
	at(122)
	_, _ = getLedgerNames(fin, zz, f.port)
	selfWatchTick()
	st := readStop()
	if st == nil || str(st["by"]) != "self" || !strings.Contains(str(st["reason"]), "has not answered") {
		t.Fatalf("not stopped after Tally was silent for over 2 minutes: %v", st)
	}
	silent.Store(false)
	nowFn = time.Now
	clearProbe(f.port)
	readsRefused(t, f)
}

func TestPostingWorksWhenStopped(t *testing.T) {
	td := today()
	f := newStandTally(t)
	standBridge(t, f, "")
	liveFrom(td)
	setReadStop("self", "a request to Tally (Day Book) took 21 s")
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

func TestStopSurvivesRestart(t *testing.T) {
	f := newStandTally(t)
	standBridge(t, f, "")
	liveFrom(today())
	setReadStop("self", "a request to Tally (FinComLedgers) took 24 s")
	// a restart: the settings read again from the file
	setCfg("ReadStop", nil)
	loadConfig()
	st := readStop()
	if st == nil || str(st["by"]) != "self" || !strings.Contains(str(st["reason"]), "FinComLedgers") {
		t.Fatalf("the stop after a restart: %v", st)
	}
	readsRefused(t, f)
	// the tray: Resume reading
	if _, err := trayResumeReading(); err != nil {
		t.Fatal(err)
	}
	if readStop() != nil {
		t.Fatal("still stopped after Resume reading")
	}
	loadConfig()
	if readStop() != nil {
		t.Fatal("the stop came back after a restart")
	}
	if _, err := getLedgerNames(fin, zz, f.port); err != nil {
		t.Fatalf("a read after Resume reading: %v", err)
	}
	if logLines("Reading from Tally resumed from the tray icon") != 1 {
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
	rs := obj(b["readStopped"])
	if rs == nil || str(rs["by"]) != "self" || str(rs["reason"]) == "" {
		t.Fatalf("readStopped in the beat: %v", b["readStopped"])
	}
	// no stop: readStopped is null
	clearReadStop("tray")
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
	// a stop by the bridge itself is not lifted by readStop: null, nor replaced by FinCom's stop
	setReadStop("self", "a request to Tally (Day Book) took 22 s")
	reply(M{"readStop": nil})
	reply(M{"readStop": M{"by": "fincom", "reason": "Stopped by the owner from FinCom"}})
	if st := readStop(); st == nil || str(st["by"]) != "self" {
		t.Fatalf("the bridge's own stop: %v", st)
	}
	// only FinCom's resume clears it
	reply(M{"readStop": nil, "readResume": true})
	if readStop() != nil {
		t.Fatal("still stopped after FinCom's resume")
	}
	if logLines("Reading from Tally resumed from FinCom") < 2 {
		t.Fatal("the resume is not in the log")
	}
	// the beat says what is stopped
	setReadStop("self", "Tally has not answered since 10:00 (over 2 minutes)")
	reply(M{})
	c.mu.Lock()
	rs := obj(c.lastBeat["readStopped"])
	c.mu.Unlock()
	if rs == nil || str(rs["by"]) != "self" {
		t.Fatalf("the beat's readStopped: %v", rs)
	}
}
