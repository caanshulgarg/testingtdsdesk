package main

// 2.3.4 (the owner's decision of 08-Oct-2026, option (a)): "When FinCom's fast request for one entry takes more than 2
// seconds, the bridge stops waiting as today, sends that entry's line to FinCom as held, and ends it with 'upload that
// day's Day Book to settle it'. The slow answer does not count towards marking the company slow; the company's other
// entries keep being fetched normally. The 2-second stop itself is unchanged."

import (
	"fmt"
	"strings"
	"testing"
	"time"
)

// the stand answers the object export of these MasterIDs in d; everything else at once
func stopSlowMids(f *standTally, d time.Duration, mids ...int64) {
	f.mu.Lock()
	f.slow = func(id, body string) time.Duration {
		if id == vchObjectID {
			for _, m := range mids {
				if strings.Contains(body, fmt.Sprintf("ID:%d<", m)) {
					return d
				}
			}
		}
		return 0
	}
	f.mu.Unlock()
}

// --- a large entry stopped at the limit, again and again on separate occasions (Tally answering everything else in
// time around each): each such line goes up held at once (the owner's answer B: "FinCom asks once more at HH:MM"), is
// asked ONCE more 5 minutes later, stopped again, and ends with the Day Book words (never a third ask, by the retry
// schedule, the held list or FinCom's listing); the company is never marked; its other entries come with their bodies
func TestFast234ObjectStopEndsLineOnly(t *testing.T) {
	p, f, c := slow232Bridge(t)
	big := []int64{25810, 25811, 25812, 25813}
	stopSlowMids(f, 700*time.Millisecond, big...)
	for i, mid := range big {
		r222Vch(f, mid, "Journal", fmt.Sprintf("J-%d", mid), "20261005", int64(54610+i))
		small := mid + 100
		r222Vch(f, small, "Journal", fmt.Sprintf("J-%d", small), "20261005", int64(54710+i))
		slowLook()
		liveAppend(t, p, slowLine(mid, fmt.Sprintf("07:2%d", i))...)
		liveAppend(t, p, slowLine(small, fmt.Sprintf("07:2%d", i))...)
		for k := 0; k < 4; k++ {
			liveReadOnce()
			liveUploadOnce()
			retryDue()
			slowLook()
		}
	}
	// FinCom lists the held lines again, 6 minutes and hours later: asked once more, never a third time
	base := nowFn()
	for _, h := range []int{0, 1, 5, 30} {
		retryClock(base, 360+h*3600)
		fastTurns(2)
		for _, mid := range big {
			for _, s := range slowSentOf(c, mid) {
				applyHeldLines(M{"heldLines": []any{M{"line_id": str(s["line_id"]), "company": nwsCo, "company_guid": nwsGUID, "event": "created", "master_id": fmt.Sprint(mid),
					"vch_type": "Journal", "vch_no": fmt.Sprintf("J-%d", mid), "vch_date": "20261005"}}})
			}
		}
		fastTurns(2)
	}
	if slowMarked(nwsCo, nwsGUID) {
		t.Fatalf("the company was marked by its large entries' stops:\n%s", cutTail(readText(logFile()), 3000))
	}
	for _, mid := range big {
		n := 0
		f.mu.Lock()
		for i, id := range f.reqs {
			if id == vchObjectID && strings.Contains(f.bodies[i], fmt.Sprintf("ID:%d<", mid)) {
				n++
			}
		}
		f.mu.Unlock()
		if n != 2 {
			t.Fatalf("entry %d asked %d times (want twice: its first fetch and one more)", mid, n)
		}
		s := slowSentOf(c, mid)
		if len(s) != 2 || str(s[0]["xml"]) != "" || !strings.Contains(str(s[0]["heldWhy"]), "FinCom asks once more at") ||
			str(s[1]["heldWhy"]) != liveStopEndWords() || !strings.HasSuffix(str(s[1]["line_id"]), ":resolved") {
			t.Fatalf("entry %d went up: %v", mid, s)
		}
		if s := slowSentOf(c, mid+100); len(s) == 0 || str(s[len(s)-1]["xml"]) == "" {
			t.Fatalf("the company's other entry %d: %v", mid+100, s)
		}
	}
}
