package main

// 2.3.4, the owner's answer B (08-Oct-2026): "B: one more ask. It gives an entry one more chance before it's held, without
// letting it retry forever." A FinComVoucherObject request stopped at 2 s: the line goes up held ("waiting: Tally took
// longer than 2 s; FinCom asks once more at HH:MM") and is asked exactly ONE more time 5 minutes later; a second stop ends
// it with the Day Book words. Never counts toward a slow mark. At most 2 object asks a line in all (the live path and the
// held list alike; an older bridge's line: its upgrade ask, and one more after a stop).

import (
	"fmt"
	"net/http"
	"strings"
	"testing"
	"time"
)

func objAsksOf(f *standTally, mid int64) int {
	n := 0
	f.mu.Lock()
	defer f.mu.Unlock()
	for i, id := range f.reqs {
		if id == vchObjectID && strings.Contains(f.bodies[i], fmt.Sprintf("ID:%d<", mid)) {
			n++
		}
	}
	return n
}

// a live save whose fast request is stopped: held with the once-more words, asked once more at 5 minutes. then: "answers"
// (the second ask comes in time), "stops" (stopped again), "restart" (the bridge restarted between the two asks, then stopped)
func fast234BLive(t *testing.T, then string) {
	p, f, c := slow232Bridge(t)
	const mid = int64(25820)
	r222Vch(f, mid, "Journal", fmt.Sprintf("J-%d", mid), "20261005", 54620)
	stopSlowMids(f, 700*time.Millisecond, mid)
	slowLook()
	base := nowFn()
	retryClock(base, 0)
	liveAppend(t, p, slowLine(mid, "07:20")...)
	for k := 0; k < 3; k++ {
		liveReadOnce()
		liveUploadOnce()
	}
	if n := objAsksOf(f, mid); n != 1 {
		t.Fatalf("first fetch: %d asks (want 1)", n)
	}
	s := slowSentOf(c, mid)
	if len(s) != 1 || str(s[0]["xml"]) != "" || !strings.HasPrefix(str(s[0]["heldWhy"]), "waiting: Tally took longer than 0.2 s; FinCom asks once more at "+base.Add(5*time.Minute).Format("15:04")) {
		t.Fatalf("the line went up: %v", s)
	}
	lid := str(s[0]["line_id"])
	// not before 5 minutes
	for _, sec := range []int{10, 20, 60, 120, 240} {
		retryClock(base, sec)
		fastTurns(2)
	}
	if n := objAsksOf(f, mid); n != 1 {
		t.Fatalf("asked again before 5 minutes: %d asks", n)
	}
	switch then {
	case "answers":
		stopSlowMids(f, 0)
	case "restart":
		fastRestart()
	}
	for _, sec := range []int{301, 330, 600, 3600, 4 * 3600, 86400} {
		retryClock(base, sec)
		fastTurns(2)
	}
	if n := objAsksOf(f, mid); n != 2 {
		t.Fatalf("%d asks in all (want 2: the first fetch and one more)", n)
	}
	r := r222cSentID(c, lid+":resolved")
	if len(r) != 1 {
		t.Fatalf("%d :resolved rows (want 1): %v", len(r), r)
	}
	if then == "answers" {
		if str(r[0]["xml"]) == "" || str(r[0]["heldWhy"]) != "" {
			t.Fatalf("the second ask answered: not sent with its body: %v", r[0])
		}
	} else if str(r[0]["heldWhy"]) != liveStopEndWords() || str(r[0]["xml"]) != "" {
		t.Fatalf("stopped twice: not ended with the Day Book words: %v", r[0])
	}
	if slowMarked(nwsCo, nwsGUID) {
		t.Fatalf("the company was marked:\n%s", cutTail(readText(logFile()), 3000))
	}
}

func TestFast234BLiveStopThenAnswers(t *testing.T) { fast234BLive(t, "answers") }
func TestFast234BLiveStopTwiceEnds(t *testing.T)   { fast234BLive(t, "stops") }
func TestFast234BLiveStopRestart(t *testing.T)     { fast234BLive(t, "restart") }

// the held list: a line whose ask there is stopped (a new save sent held before Tally was asked; an older bridge's line on
// its upgrade ask): asked once more 5 minutes later, never a third time
func fast234BHeld(t *testing.T, item M, then string) {
	_, f, c := slow232Bridge(t)
	r222Vch(f, 25791, "Journal", "", "20261005", 54591)
	stopSlowMids(f, 700*time.Millisecond, 25791)
	if err := saveFile(liveHeldFile(), jsonText(M{"items": M{"held-slow": item}})); err != nil {
		t.Fatal(err)
	}
	fastRestart()
	base := nowFn()
	for _, sec := range []int{0, 20, 60, 240} {
		retryClock(base, sec)
		fastTurns(2)
	}
	if n := f.n(vchObjectID); n != 1 {
		t.Fatalf("%d asks in the first 4 minutes (want 1)", n)
	}
	if s := r222cSentID(c, "held-slow:resolved"); len(s) != 0 {
		t.Fatalf("ended at its first stop: %v", s)
	}
	if then == "answers" {
		stopSlowMids(f, 0)
	}
	if then == "restart" {
		fastRestart()
	}
	for _, sec := range []int{301, 330, 600, 3600, 86400} {
		retryClock(base, sec)
		fastTurns(2)
	}
	if n := f.n(vchObjectID); n != 2 {
		t.Fatalf("%d asks in all (want 2)", n)
	}
	s := r222cSentID(c, "held-slow:resolved")
	if len(s) != 1 {
		t.Fatalf("%d :resolved rows (want 1): %v", len(s), s)
	}
	if then == "answers" {
		if str(s[0]["xml"]) == "" {
			t.Fatalf("answered on its one more ask, not sent with its body: %v", s[0])
		}
	} else if str(s[0]["heldWhy"]) != liveStopEndWords() {
		t.Fatalf("not ended with the stop words: %v", s[0])
	}
	if slowMarked(nwsCo, nwsGUID) {
		t.Fatal("marked")
	}
}

func heldFreshItem() M {
	now := nowFn().Format(time.RFC3339)
	return M{"company": nwsCo, "companyGuid": nwsGUID, "type": "Journal", "no": "", "date": "20261005", "masterId": "25791", "savedAt": now, "added": now,
		"last": "", "tries": 0, "event": "created", "why": "waiting: Tally busy", "final": false, "fresh": true, "freshTries": 0, "allow": 2, "v234": true}
}

func heldOlderItem() M {
	yest := nowFn().Add(-20 * time.Hour).Format(time.RFC3339)
	return M{"company": nwsCo, "companyGuid": nwsGUID, "type": "Journal", "no": "", "date": "20261005", "masterId": "25791", "savedAt": yest, "added": yest,
		"last": yest, "tries": 20, "event": "created", "why": "not given", "final": true, "triesVersion": "2.3.2"}
}

func TestFast234BHeldStopTwiceEnds(t *testing.T)      { fast234BHeld(t, heldFreshItem(), "stops") }
func TestFast234BHeldStopThenAnswers(t *testing.T)    { fast234BHeld(t, heldFreshItem(), "answers") }
func TestFast234BHeldStopRestart(t *testing.T)        { fast234BHeld(t, heldFreshItem(), "restart") }
func TestFast234BOlderLineStopTwiceEnds(t *testing.T) { fast234BHeld(t, heldOlderItem(), "stops") }
func TestFast234BOlderLineStopThenAnswers(t *testing.T) {
	fast234BHeld(t, heldOlderItem(), "answers")
}

// answer B: never a third fast ask, whatever comes back (here an answer that cannot be read, not counted as a try)
func TestFast234BNeverThirdAsk(t *testing.T) {
	_, f, _ := slow232Bridge(t)
	r222Vch(f, 25791, "Journal", "", "20261005", 54591)
	f.mu.Lock()
	f.behave = func(w http.ResponseWriter, r *http.Request, id, body string) bool {
		if id == vchObjectID {
			fmt.Fprint(w, "<RESPONSE>Unknown Request, cannot be processed</RESPONSE>")
			return true
		}
		return false
	}
	f.mu.Unlock()
	if err := saveFile(liveHeldFile(), jsonText(M{"items": M{"held-unread": heldFreshItem()}})); err != nil {
		t.Fatal(err)
	}
	fastRestart()
	base := nowFn()
	for _, sec := range []int{0, 20, 60, 301, 600, 3600, 7200, 86400} {
		retryClock(base, sec)
		fastTurns(2)
	}
	if n := f.n(vchObjectID); n > liveObjAsksMax {
		t.Fatalf("%d fast asks (at most %d)", n, liveObjAsksMax)
	}
}
