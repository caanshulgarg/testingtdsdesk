package main

// Bridge 2.3.1, the owner's last change (06-Oct-2026): "A slow or unanswered request never switches reading off and never
// turns the entry fetch off for a company." The 2-second hard stop per request stays. After a stop or no answer the bridge
// tries again by itself on one shared schedule: 15 s, 30 s, 1 min, 2 min, then every 5 min; the first answer in time puts
// it back to normal. Every background request follows it (the entry fetch, the company list, the ledger changes, the light
// check, the held-line resolve); postings and a person's actions never wait on it. No manual resume. A 2.3.0 bridge's
// self-stop or switch-off saved on disk is cleared at start; the owner's stop from FinCom stays as it is. Lines held under
// 2.3.0 with the "off" words are asked again by the bridge that owns them. Written before the code.

import (
	"net/http"
	"os"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

// the retry schedule's next try is due now (the tests' clock stands still)
func retryDue() {
	retryMu.Lock()
	if retryN > 0 {
		retryUntil = nowFn().Add(-time.Second)
	}
	retryMu.Unlock()
}

// the bridge's clock at base + sec seconds
func retryClock(base time.Time, sec int) {
	nowFn = func() time.Time { return base.Add(time.Duration(sec) * time.Second) }
}

// staging's shape: NWS144's Journal lines of GARG SHEKHAR (MasterIDs 25689 on), held under 2.3.0 while reading was off;
// FinCom lists them in the beat's heldLines (its row has no GUID, a MasterID, no AlterID)
func retryHeldRows(mids ...string) []any {
	var rows []any
	for _, mid := range mids {
		rows = append(rows, M{"line_id": "nws-" + mid, "company": nwsCo, "company_guid": nwsGUID, "event": "created", "master_id": mid,
			"vch_type": "Journal", "vch_no": "", "vch_date": "20261005"})
	}
	return rows
}

// --- Tally silent for 3 minutes, then answering: nothing switched off; one request at each retry (15 s, 30 s after the
// last) while a held line is left to ask; 2.3.2 (issue 232, b): each held line asked and not answered in time waits 1 h
// for its next ask; the first answer in time brings it back and the held lines come in
func TestRetrySilentThreeMinutesThenAnswers(t *testing.T) {
	_, f, c := r222bBridge(t, "")
	base := time.Date(2026, 10, 5, 12, 14, 50, 0, liveZone)
	retryClock(base, 0)
	mids := []string{"25689", "25690", "25691"}
	for i, mid := range mids {
		r222Vch(f, toI64(mid), "Journal", "", "20261005", int64(54700+i))
	}
	var silent atomic.Bool
	silent.Store(true)
	f.mu.Lock()
	f.behave = func(w http.ResponseWriter, r *http.Request, id, body string) bool {
		if silent.Load() && id == vchByMasterID {
			return silentFor(func(string, string) bool { return true }, nil)(w, r, id, body)
		}
		return false
	}
	f.mu.Unlock()
	applyHeldLines(M{"heldLines": retryHeldRows(mids...)})
	asks := func() int { return f.n(vchByMasterID) }
	liveUploadOnce()
	if asks() != 1 {
		t.Fatalf("the first turn asked %d times (want 1: stopped at 2 s, the rest wait for the retry)", asks())
	}
	if readStop() != nil {
		t.Fatalf("reading was switched off: %v", readStop())
	}
	if w := retryWords(); w != "Tally did not answer in time at 12:14; trying again by itself at 12:15" {
		t.Fatalf("the words: %q", w)
	}
	n := 1
	for _, at := range []int{15, 45} {
		retryClock(base, at-1)
		liveUploadOnce()
		if asks() != n {
			t.Fatalf("asked before the retry at %d s (%d asks, want %d)", at, asks(), n)
		}
		retryClock(base, at)
		liveUploadOnce()
		n++
		if asks() != n {
			t.Fatalf("the retry at %d s sent %d request(s) (want 1)", at, asks()-n+1)
		}
	}
	// 2.3.2 (issue 232, b): each held line has had one timed-out try (one at each retry try: 0, 15 and 45 s); its next ask
	// is 1 h after it, not at the retry schedule's later tries (2.3.1 asked again at every try, for 7 days)
	for _, at := range []int{105, 225, 1800, 3599} {
		retryClock(base, at)
		liveUploadOnce()
		if asks() != 3 {
			t.Fatalf("a held line was asked again at %d s (%d asks, want 3)", at, asks())
		}
	}
	silent.Store(false) // Tally answers again
	retryClock(base, 3600+45)
	for i := 0; i < 4; i++ {
		liveUploadOnce()
	}
	if retryHeld() || retryWords() != "" {
		t.Fatalf("not back to normal after an answer in time: %q", retryWords())
	}
	for _, mid := range mids {
		if s := r222cSentID(c, "nws-"+mid+":resolved"); len(s) != 1 || str(s[0]["object_guid"]) != r222GUID(toI64(mid)) || str(s[0]["xml"]) == "" {
			t.Fatalf("held line %s did not come in: %v", mid, s)
		}
	}
	if logLines("trying again by itself at") != 3 { // 2.3.2: three stops (one per held line), then 1 h
		t.Fatalf("one log line per retry: %d\n%s", logLines("trying again by itself at"), readText(logFile()))
	}
	if logLines(" off: ") != 0 || logLines("Reading from Tally stopped") != 0 || readStop() != nil {
		t.Fatalf("something was switched off:\n%s", readText(logFile()))
	}
	b := beatBody(true, "open", "", nil, nil, nil)
	if len(obj(b["recorderBodyFetch"])) != 0 || b["readStopped"] != nil {
		t.Fatalf("the beat says something is off: %v %v", b["recorderBodyFetch"], b["readStopped"])
	}
}

// the schedule: 15 s, 30 s, 1 min, 2 min, then 5 min at most, repeating; an answer in time resets it
func TestRetryScheduleSteps(t *testing.T) {
	f := newStandTally(t)
	standBridge(t, f, "") // the log in the test's own folder
	retryReset()
	t.Cleanup(retryReset)
	base := time.Date(2026, 10, 5, 12, 0, 0, 0, liveZone)
	t.Cleanup(func() { nowFn = time.Now })
	at := 0
	for i, want := range []int{15, 30, 60, 120, 300, 300, 300} {
		retryClock(base, at)
		retryNote(9000, "FinComVoucherByMaster", errRecorderStop)
		if until := retryNext(); !until.Equal(base.Add(time.Duration(at+want) * time.Second)) {
			t.Fatalf("failure %d: next at %s, want %d s later", i+1, until.Format("15:04:05"), want)
		}
		at += want
	}
	retryClock(base, at)
	if retryHeld() {
		t.Fatal("held at the retry time")
	}
	retryNote(9000, "FinComVoucherByMaster", nil)
	if retryHeld() || !retryNext().IsZero() {
		t.Fatal("an answer in time did not end the schedule")
	}
	// another failure (a refusal, a posting going first) is not Tally's silence: no change
	retryNote(9000, "FinComVoucherByMaster", errPreempted)
	if retryHeld() {
		t.Fatal("a request stopped for a posting started the schedule")
	}
}

// a 2.3.0 bridge's self-stop and its switch-offs saved on disk are cleared at start, said once in the log
func TestRetryOldSelfStopClearedAtStart(t *testing.T) {
	f := newStandTally(t)
	standBridge(t, f, "")
	liveFrom(today())
	setCfg("ReadStop", M{"by": "self", "reason": "Tally has not answered since 10:00 (over 2 minutes of requests not answered)", "at": "2026-10-05T10:02:00"})
	saveConfig()
	off := M{"bodies|" + zz + "|guid-1": M{"method": "bodies", "company": zz, "seconds": 2.4, "at": "2026-10-05T10:01:00", "why": "Tally took 2.4 s for the entry bodies (limit 2 s)", "beat": "addon"},
		"B|" + zz + "|guid-1": M{"method": "B", "company": zz, "seconds": 3.1, "at": "2026-10-05T10:01:00", "why": "x", "beat": "addon"}}
	if err := saveFile(liveOffsetsFile(), jsonText(M{"files": M{}, "off": off, "at": nowS()})); err != nil {
		t.Fatal(err)
	}
	live.mu.Lock()
	live.dir = ""
	live.mu.Unlock()
	// a start: the settings read again from the file
	setCfg("ReadStop", nil)
	loadConfig()
	clearOldSwitchOffs()
	if readStop() != nil {
		t.Fatalf("the 2.3.0 self-stop is still in force: %v", readStop())
	}
	if strings.Contains(readText(ConfigPath), `"self"`) {
		t.Fatalf("the self-stop is still in the settings file: %s", readText(ConfigPath))
	}
	if o := readObjFile(liveOffsetsFile()); o["off"] != nil {
		t.Fatalf("the switch-offs are still in the offsets file: %v", o["off"])
	}
	if logLines("a stop saved by an earlier bridge") != 1 || logLines("switch-off(s) saved by an earlier bridge") != 1 {
		t.Fatalf("the clearing is not said once each:\n%s", readText(logFile()))
	}
	if _, err := getLedgerNames(fin, zz, f.port); err != nil {
		t.Fatalf("a read after the start: %v", err)
	}
	// a second start says nothing more
	clearOldSwitchOffs()
	if logLines("a stop saved by an earlier bridge") != 1 {
		t.Fatal("said again")
	}
}

// the owner's stop from FinCom still stops reading (and is not cleared at start), whatever the retries
func TestRetryOwnerStopStillStops(t *testing.T) {
	f := newStandTally(t)
	c := newStandCloud(t)
	standBridge(t, f, c.cfg())
	liveFrom(today())
	c.mu.Lock()
	c.beatReply = M{"readStop": M{"by": "fincom", "reason": "Stopped by the owner from FinCom", "at": "2026-10-05T10:00:00"}}
	c.mu.Unlock()
	beatOnce()
	clearOldSwitchOffs()
	loadConfig()
	if st := readStop(); st == nil || str(st["by"]) != "fincom" {
		t.Fatalf("the owner's stop: %v", st)
	}
	readsRefused(t, f)
	retryNote(f.port, "FinComVoucherByMaster", nil) // an answer in time does not lift it either
	if readStop() == nil {
		t.Fatal("lifted by the retry schedule")
	}
}

// postings, and a person's reads, go at once while a retry is pending; the background reads wait for it
func TestRetryPostingsNotHeld(t *testing.T) {
	td := today()
	f := newStandTally(t)
	standBridge(t, f, "")
	liveFrom(td)
	t.Cleanup(retryReset)
	retryNote(f.port, "FinComVoucherByMaster", errRecorderStop)
	if !retryHeld() {
		t.Fatal("no retry pending")
	}
	n0 := f.n("")
	if r := postOne(t, "rt1", finVoucher("rt1", fgParty, "RT-1", td, "5.00")); r["ok"] != true {
		t.Fatalf("a posting while a retry is pending: %v", r)
	}
	if f.n("Import") != 1 {
		t.Fatal("not posted")
	}
	if _, err := getLedgerNames(fin, zz, f.port); err != nil {
		t.Fatalf("a person's read while a retry is pending: %v", err)
	}
	// a background read: held, nothing sent
	n1 := f.n("")
	if _, err := invokeTally(recorderTC(nil), f.port, companyCheckRequest(zz), 5); err == nil || !strings.Contains(err.Error(), "trying again by itself at") {
		t.Fatalf("a background read went while the retry is pending: %v", err)
	}
	if f.n("") != n1 {
		t.Fatal("sent")
	}
	if n1 == n0 || !retryHeld() {
		t.Fatal("the posting changed the schedule")
	}
	_ = os.Remove(liveOffsetsFile())
}
