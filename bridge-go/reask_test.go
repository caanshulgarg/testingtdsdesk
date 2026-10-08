package main

// Next release, item 2.a (the owner, 07-Oct-2026): "Re-ask a held entry the moment Tally answers again, not every 10
// minutes." The real-Tally run 37492981527 (2.3.1): Tally frozen 16:18:02-16:21:03; a receipt saved meanwhile was held
// ("the entry was not read from Tally") at 16:18:53; Tally answered again at 16:21:38 and a queued posting went at
// 16:21:39, but the held entry waited for its 10-minute spacing. A line held because Tally did not answer is asked again
// at once once Tally answers again (one a turn, in order, after postings); a line held for any other reason keeps its
// spacing; the 2-second stop and the retry schedule are unchanged. Written before the code.

import (
	"fmt"
	"net/http"
	"sync/atomic"
	"testing"
	"time"
)

// Tally answers again: the retry schedule's try (a background request) answers in time
func reaskAnswerAgain(t *testing.T, f *standTally) {
	t.Helper()
	retryDue()
	if _, err := invokeTally(recorderTC(nil), f.port, companyCheckRequest(nwsCo), 5); err != nil {
		t.Fatalf("the try after Tally came back: %v", err)
	}
	if retryHeld() {
		t.Fatal("the schedule did not end on an answer in time")
	}
}

func reaskAsks(f *standTally) int { return f.n(vchObjectID) + f.n(vchByNumberID) }

// held lines put straight into the held list: each its why, last asked now
func reaskHold(t *testing.T, why map[string]string, mids map[string]string) {
	t.Helper()
	heldMu.Lock()
	defer heldMu.Unlock()
	all, items := liveHeldLoad()
	now := nowFn().Format(time.RFC3339)
	for id, w := range why {
		items[id] = heldLine{V234: true, ID: id, Company: nwsCo, CGUID: nwsGUID, Type: "Receipt", No: "", Date: "20261005", MID: mids[id], At: now, Added: now, Last: now, Ev: "altered", Why: w}
	}
	liveHeldSave(all, items)
}

// (a) on the stand Tally: freeze, hold, unfreeze: the held entry is asked within seconds of the first good answer.
// release-240 (merged with 2.3.5): the owner's later decision of 08-Oct-2026 (2.3.4, option (a)) ends an entry whose
// fast request stopped at 2 s with the Day Book words, so that entry is never held to be asked again (first half
// below, as 2.3.4 has it). What Tally's silence still leaves held is a delete / cancel check Tally did not answer (its
// GUID kept, 2.3.5); item 2.a now holds for it: asked within seconds of Tally's first good answer, not 10 minutes later
func TestReaskHeldNoAnswerAtOnceWhenTallyAnswers(t *testing.T) {
	p, f, c := r222bBridge(t, "")
	t.Cleanup(retryReset)
	base := time.Date(2026, 10, 6, 16, 18, 2, 0, liveZone)
	retryClock(base, 0)
	f.mu.Lock()
	for _, v := range f.vch {
		if v.master == "26311" {
			v.alter = 54395
		}
	}
	var frozen atomic.Bool
	frozen.Store(true)
	f.behave = func(w http.ResponseWriter, r *http.Request, id, body string) bool {
		if frozen.Load() && (id == vchObjectID || id == vchByNumberID) {
			return silentFor(func(string, string) bool { return true }, nil)(w, r, id, body)
		}
		return false
	}
	f.mu.Unlock()
	liveAppend(t, p,
		r222Line("voucher_accept_pre", "16:18", r222GUID(26311), "26311", "54391", "Receipt", "191", "5-Oct-2026", "R1"),
		r222Line("voucher_accept_post", "16:18", r222GUID(26311), "26311", "54395", "Receipt", "191", "5-Oct-2026", "R1"))
	readAndUploadAll(t)
	// 2.3.4 (option (a)): the entry's own request stopped at 2 s: sent held and ended with the Day Book words, not kept
	if s := c.recSent(); len(s) != 1 || str(s[0]["xml"]) != "" || str(s[0]["heldWhy"]) != liveStopEndWords() {
		t.Fatalf("the entry stopped at 2 s: %v", s)
	}
	if _, items := liveHeldLoad(); len(items) != 0 {
		t.Fatalf("an entry ended by option (a) is kept to be asked again: %+v", items)
	}
}

func TestReaskHeldDeleteAtOnceWhenTallyAnswers(t *testing.T) {
	t.Cleanup(retryReset)
	// item 2.a: a delete whose check Tally did not answer (the connection closed) is held with its GUID; Tally answers
	// again (16:21:38): the held delete is asked within a few seconds, not 10 minutes later, and goes with its GUID
	h := hs235Bridge(t, `,"RecorderBodySec":2`, false)
	h.f.mu.Lock()
	h.f.behave = hs235Drop
	h.f.mu.Unlock()
	liveAppend(t, liveFilePath(h.rec, ""),
		liveLine("after_delete", "Voucher", h.vDel.guid, h.vDel.master, fmt.Sprint(h.vDel.alter), "Journal", "PC-1", h.td, "", "", "gone"))
	h.drain(t, 1)
	del := hs235First(h.c.recSent(), "deleted", false)
	if del == nil || !truthy(del["guidHeld"]) || str(del["object_guid"]) != "" {
		t.Fatalf("the delete Tally did not answer for was not held: %v", del)
	}
	id := str(del["line_id"])
	if hd := hs235Held(t, id); !liveHeldNoAnswer(hd.Why) {
		t.Fatalf("the delete is not held for Tally's silence: %+v", hd)
	}
	h.f.mu.Lock()
	h.f.behave = nil
	h.f.mu.Unlock()
	at := h.base.Add(3 * time.Minute)
	nowFn = func() time.Time { return at }
	retryDue()
	if _, err := invokeTally(recorderTC(nil), h.f.port, companyCheckRequest(zz), 5); err != nil {
		t.Fatalf("the try after Tally came back: %v", err)
	}
	if answeredAgainLast().IsZero() {
		t.Fatal("Tally's answer again was not noted")
	}
	n0 := len(h.c.recSent())
	at = at.Add(2 * time.Second)
	for i := 0; i < 3; i++ {
		liveUploadOnce()
	}
	dl := hs235First(h.c.recSent()[n0:], "deleted", true)
	if dl == nil || str(dl["object_guid"]) != h.vDel.guid {
		t.Fatalf("the held delete was not asked within seconds of Tally's first good answer: %v\n%s", h.c.recSent()[n0:], cutTail(readText(logFile()), 3000))
	}
	hs235NoBareDelete(t, h.c.recSent())
}

// (b) a line held for another reason (Tally said the voucher is not there) keeps its 10-minute spacing: no hammering
func TestReaskOtherReasonKeepsSpacing(t *testing.T) {
	_, f, _ := r222bBridge(t, "")
	t.Cleanup(retryReset)
	base := time.Date(2026, 10, 6, 16, 18, 0, 0, liveZone)
	retryClock(base, 0)
	reaskHold(t, map[string]string{"gone-1": "voucher with MasterID 26999: Tally has no such voucher"}, map[string]string{"gone-1": "26999"})
	retryNote(f.port, vchObjectID, errRecorderStop)
	retryClock(base, 120)
	reaskAnswerAgain(t, f)
	n0 := reaskAsks(f)
	for i := 0; i < 4; i++ {
		retryClock(base, 121+i)
		liveUploadOnce()
	}
	if reaskAsks(f) != n0 {
		t.Fatalf("a line Tally said is not there was asked again within 10 minutes: %v", f.ids())
	}
	retryClock(base, 601)
	liveUploadOnce()
	if reaskAsks(f) == n0 {
		t.Fatal("not asked after its 10 minutes")
	}
}

// (c) after Tally recovers, the lines held for its silence are asked one a turn (never a burst), in order, and a
// posting going first holds them
func TestReaskOneATurnPostingsFirst(t *testing.T) {
	_, f, c := r222bBridge(t, "")
	t.Cleanup(retryReset)
	base := time.Date(2026, 10, 6, 16, 18, 0, 0, liveZone)
	retryClock(base, 0)
	r222Vch(f, 26313, "Receipt", "193", "20261005", 54396)
	stop := "the entry was not read from Tally: " + errRecorderStop.Error()
	reaskHold(t, map[string]string{"h-1": stop, "h-2": stop, "h-3": stop}, map[string]string{"h-1": "26311", "h-2": "26312", "h-3": "26313"})
	retryNote(f.port, vchObjectID, errRecorderStop)
	retryClock(base, 200)
	reaskAnswerAgain(t, f)
	n0 := reaskAsks(f)
	// a posting going: nothing asked
	postTaking.Store(true)
	liveUploadOnce()
	postTaking.Store(false)
	if reaskAsks(f) != n0 {
		t.Fatalf("asked during a posting: %v", f.ids())
	}
	for i, id := range []string{"h-1", "h-2", "h-3"} {
		retryClock(base, 201+i)
		liveUploadOnce()
		if reaskAsks(f) != n0+i+1 {
			t.Fatalf("turn %d: %d asks (want one a turn)", i+1, reaskAsks(f)-n0)
		}
		if len(r222cSentID(c, id+":resolved")) != 1 {
			t.Fatalf("turn %d did not take %s (in order): %v", i+1, id, c.recSent())
		}
	}
	// once asked, a line is spaced as before
	retryClock(base, 210)
	liveUploadOnce()
	if reaskAsks(f) != n0+3 {
		t.Fatalf("asked again: %v", f.ids())
	}
}

// (c, the other half) a line held for Tally's silence is not asked while Tally still does not answer: it waits for the
// retry schedule as before
func TestReaskNotWhileStillSilent(t *testing.T) {
	_, f, _ := r222bBridge(t, "")
	t.Cleanup(retryReset)
	base := time.Date(2026, 10, 6, 16, 18, 0, 0, liveZone)
	retryClock(base, 0)
	retryNote(f.port, vchObjectID, errRecorderStop)
	reaskHold(t, map[string]string{"s-1": "the entry was not read from Tally: " + errRecorderStop.Error()}, map[string]string{"s-1": "26311"})
	retryClock(base, 5)
	liveUploadOnce()
	if reaskAsks(f) != 0 {
		t.Fatalf("asked before Tally answered again: %v", f.ids())
	}
}

// (d) the 2-second stop and the retry schedule are unchanged
func TestReaskStopAndScheduleUnchanged(t *testing.T) {
	if tc := recorderTC(nil); tc.limitMs != 2000 || !tc.bg {
		t.Fatalf("the background stop: %d ms (bg %v)", tc.limitMs, tc.bg)
	}
	want := []time.Duration{15 * time.Second, 30 * time.Second, time.Minute, 2 * time.Minute, 5 * time.Minute}
	if len(retrySteps) != len(want) {
		t.Fatalf("the schedule: %v", retrySteps)
	}
	for i := range want {
		if retrySteps[i] != want[i] {
			t.Fatalf("the schedule: %v", retrySteps)
		}
	}
	if keepNumZero("RecorderResolveSec", 600) != 600 {
		t.Fatal("the held lines' spacing changed")
	}
}
