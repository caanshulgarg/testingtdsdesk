package main

// 2.4.0 review, part 1 (next-renumber). Written before the code (red first).
//   HIGH: any fetch error ended the turn without moving past the candidate, so it was asked again for ever and the one job
//   blocked every other company's renumbering. Now (the owner's answer B, as 2.3.4's lines): after a 2 s stop the entry is
//   asked ONE more time 5 minutes later (the job waits; other jobs run meanwhile), a second stop drops it into the alert; an
//   answer that cannot be read, or a form FinCom does not read (errFastShape), drops it into the alert at once; a company
//   not open in Tally pauses that job only.
//   MEDIUM: the entries the cloud could not list by MasterID (unknown) and the dropped ones are counted into the alert.
//   LOW: more entries than the cap: the first later entry is checked first; a type that keeps its numbers raises nothing.

import (
	"fmt"
	"net/http"
	"strings"
	"testing"
	"time"
)

// the stand answers the entry request for these MasterIDs in d (over the 200 ms stop when d is 700 ms)
func renumSlowMids(f *standTally, d time.Duration, mids ...string) {
	f.mu.Lock()
	f.slow = func(id, body string) time.Duration {
		if id != vchObjectID {
			return 0
		}
		for _, m := range mids {
			if strings.Contains(body, "ID:"+m+"</ID>") {
				return d
			}
		}
		return 0
	}
	f.mu.Unlock()
}

// the Payments: 1 (06-Oct, MasterID 26501) and 2 (07-Oct, 26502) as FinCom holds them
var renumPayBefore = map[string]string{"26501": "1", "26502": "2"}

func renumWithPayments(f *standTally, c *standCloud) {
	r222Vch(f, 26501, "Payment", "1", "20261006", 54395)
	r222Vch(f, 26502, "Payment", "2", "20261007", 54396)
	c.mu.Lock()
	c.renumReply = func(b M) (int, M) {
		if str(b["vtype"]) == "Payment" {
			f.mu.Lock()
			var o []any
			for _, v := range f.vch {
				if old, had := renumPayBefore[v.master]; had && v.date >= str(b["from"]) {
					o = append(o, M{"mid": v.master, "guid": v.guid, "day": v.date, "no": old, "alter": v.alter})
				}
			}
			f.mu.Unlock()
			return 200, M{"ok": true, "entries": o, "more": false}
		}
		return 200, M{"ok": true, "entries": renumCopy(f, str(b["from"]), str(b["no"]), str(b["mid"])), "more": false}
	}
	c.mu.Unlock()
}

func renumJobsNow() []*renumJob {
	renum.mu.Lock()
	defer renum.mu.Unlock()
	renumFresh()
	return append([]*renumJob{}, renum.jobs...)
}

// --- HIGH 1. a 2 s stop on the first later entry: asked once more 5 minutes later (never sooner); meanwhile another job
// (the Payments) runs to its end; the second stop drops that entry into the alert and the job goes on with the rest
func TestRenumberStopOnceMoreThenAlert(t *testing.T) {
	p, f, c := renumBridge(t, `,"RecorderLimitMs":200`)
	retryReset()
	t.Cleanup(retryReset)
	renumWithPayments(f, c)
	renumInsert(f, 26400, "20261005", "191")
	renumSlowMids(f, 700*time.Millisecond, "26311") // 191 (now 192) always over the stop
	base := nowFn()
	liveAppend(t, p, renumInsertLines(26400, "191", "5-Oct-2026")...)
	readAndUploadAll(t)
	if n := renumAsked(f)["26311"]; n != 1 {
		t.Fatalf("the stopped entry asked %d times at first (want 1): %v", n, renumAsked(f))
	}
	// a Payment inserted before 1 on 06-Oct: 1 -> 2, 2 -> 3
	f.mu.Lock()
	for _, v := range f.vch {
		if v.typ == "Payment" {
			v.no = fmt.Sprint(toI64(v.no) + 1)
		}
	}
	f.mu.Unlock()
	r222Vch(f, 26500, "Payment", "1", "20261006", 54410)
	ph := nwsGUID + "-00000000"
	liveAppend(t, p, r222Line("voucher_accept_pre", "07:21", ph, "0", "0", "Payment", "1", "6-Oct-2026", "paid"),
		r222Line("voucher_accept_post", "07:21", ph, "26500", "0", "Payment", "1", "6-Oct-2026", "paid"))
	for _, sec := range []int{30, 60, 120, 200, 280} { // the retry schedule's tries come; the 5 minutes not yet
		retryClock(base, sec)
		for i := 0; i < 3; i++ {
			readAndUploadAll(t)
		}
	}
	if n := renumAsked(f)["26311"]; n != 1 {
		t.Fatalf("the stopped entry asked again within 5 minutes (%d asks)", n)
	}
	alt := renumAltered(c)
	if len(alt["26501"]) != 1 || len(alt["26502"]) != 1 || str(alt["26501"][0]["vch_no"]) != "2" {
		t.Fatalf("the Payments' job did not run while the Receipts' waited: %v", alt)
	}
	for _, sec := range []int{320, 400, 700, 1000} {
		retryClock(base, sec)
		for i := 0; i < 3; i++ {
			readAndUploadAll(t)
		}
	}
	if n := renumAsked(f)["26311"]; n != 2 {
		t.Fatalf("the stopped entry asked %d times in all (want 2: once, then one more after 5 minutes)", n)
	}
	alt = renumAltered(c)
	if alt["26311"] != nil || len(alt["26312"]) != 1 || len(alt["26313"]) != 1 || len(alt["26314"]) != 1 {
		t.Fatalf("after the second stop: %v (want 26312..26314 sent, 26311 not)", alt)
	}
	words := "1 entry may have been renumbered in " + nwsCo + "; upload the Day Book from 05-Oct-2026"
	if b := renumBeat(); len(b) != 1 || !strings.Contains(str(obj(b[0])["words"]), words) {
		t.Fatalf("the beat's alert: %v (want %q)", b, words)
	}
	if js := renumJobsNow(); len(js) != 0 {
		t.Fatalf("jobs left: %v", js)
	}
	for i := 0; i < 4; i++ {
		retryClock(base, 2000+i*400)
		readAndUploadAll(t)
	}
	if n := renumAsked(f)["26311"]; n != 2 {
		t.Fatalf("asked again after it was dropped (%d)", n)
	}
}

// --- HIGH 2. a company not open in Tally: that job waits (nothing dropped, nothing counted); another company's job runs
func TestRenumberCompanyNotOpenPausesOnlyThatJob(t *testing.T) {
	_, f, c := renumBridge(t, "")
	const closed, cg = "CLOSED CO", "11111111-2222-3333-4444-555555555555"
	noteCompanyGUID(closed, cg)
	noteStartPoint(closed, cg, 10, 10)
	renumInsert(f, 26400, "20261005", "191")
	at := nowS()
	renumNote([]*renumJob{
		{Key: companyKey(closed) + "|" + cg + "|receipt", Company: closed, CGUID: cg, Type: "Receipt", Date: "20261005", No: "5", Mid: "77", Event: "created", At: at},
	})
	c.mu.Lock()
	inner := c.renumReply
	c.renumReply = func(b M) (int, M) {
		if str(b["company"]) == closed {
			return 200, M{"ok": true, "entries": []any{M{"mid": "78", "guid": cg + "-0000004e", "day": "20261006", "no": "6", "alter": 50}}, "more": false}
		}
		return inner(b)
	}
	c.mu.Unlock()
	readAndUploadAll(t) // the closed company's job: listed, then its company is not open: it waits
	renumNote([]*renumJob{
		{Key: companyKey(nwsCo) + "|" + strings.ToLower(nwsGUID) + "|receipt", Company: nwsCo, CGUID: nwsGUID, Type: "Receipt", Date: "20261005", No: "191", Mid: "26400", Event: "created", At: at},
	})
	for i := 0; i < 6; i++ {
		readAndUploadAll(t)
	}
	if alt := renumAltered(c); len(alt) != 4 {
		t.Fatalf("the open company's job did not run past the closed one's: %v", alt)
	}
	js := renumJobsNow()
	if len(js) != 1 || js[0].Company != closed || len(js[0].Cands) != 1 || js[0].Missed != 0 {
		t.Fatalf("the closed company's job: %+v (want it waiting with its entry, nothing counted)", js)
	}
	if b := renumBeat(); len(b) != 0 {
		t.Fatalf("an alert for a company only closed: %v", b)
	}
	_ = f
}

// --- MEDIUM. an entry Tally keeps in a form FinCom does not read, an answer that cannot be read, and entries the cloud
// could not list by MasterID (unknown): each counted into the one alert; the readable ones sent
func TestRenumberUnreadAndUnknownCounted(t *testing.T) {
	p, f, c := renumBridge(t, "")
	renumInsert(f, 26400, "20261005", "191")
	f.mu.Lock()
	f.behave = func(w http.ResponseWriter, r *http.Request, id, body string) bool {
		if id != vchObjectID {
			return false
		}
		switch {
		case strings.Contains(body, "ID:26312</ID>"):
			_, _ = w.Write([]byte("<ENVELOPE><LINEERROR>Tally could not export this voucher</LINEERROR></ENVELOPE>"))
			return true
		case strings.Contains(body, "ID:26313</ID>"):
			_, _ = w.Write([]byte("Memory Access Violation"))
			return true
		}
		return false
	}
	f.mu.Unlock()
	c.mu.Lock()
	c.renumReply = func(b M) (int, M) {
		return 200, M{"ok": true, "entries": renumCopy(f, str(b["from"]), str(b["no"]), str(b["mid"])), "more": false, "unknown": 2}
	}
	c.mu.Unlock()
	liveAppend(t, p, renumInsertLines(26400, "191", "5-Oct-2026")...)
	for i := 0; i < 6; i++ {
		readAndUploadAll(t)
	}
	alt := renumAltered(c)
	if len(alt) != 2 || alt["26311"] == nil || alt["26314"] == nil {
		t.Fatalf("sent %v (want 26311 and 26314)", alt)
	}
	if a := renumAsked(f); a["26312"] != 1 || a["26313"] != 1 {
		t.Fatalf("asked %v (each unreadable one once)", a)
	}
	words := "4 entries may have been renumbered in " + nwsCo + "; upload the Day Book from 05-Oct-2026"
	if b := renumBeat(); len(b) != 1 || !strings.Contains(str(obj(b[0])["words"]), words) {
		t.Fatalf("the beat's alert: %v (want %q)", b, words)
	}
	if js := renumJobsNow(); len(js) != 0 {
		t.Fatalf("jobs left: %v", js)
	}
}

// --- LOW. more entries than the cap, but the type keeps its numbers: the first later entry is checked first; unchanged:
// no alert at all (and the unknown ones are not counted either)
func TestRenumberOverCapRetainNoAlert(t *testing.T) {
	p, f, c := renumBridge(t, `,"RenumberMax":3`)
	r222Vch(f, 26400, "Receipt", "195", "20261005", 54400) // made back-dated, numbered at the end
	c.mu.Lock()
	c.renumReply = func(b M) (int, M) {
		return 200, M{"ok": true, "entries": renumCopy(f, str(b["from"]), str(b["no"]), str(b["mid"]))[:2], "more": true, "unknown": 3}
	}
	c.mu.Unlock()
	liveAppend(t, p, renumInsertLines(26400, "195", "5-Oct-2026")...)
	for i := 0; i < 4; i++ {
		readAndUploadAll(t)
	}
	if b := renumBeat(); len(b) != 0 {
		t.Fatalf("an alert though the type keeps its numbers: %v", b)
	}
	if n := len(renumAsked(f)); n != 2 {
		t.Fatalf("Tally asked %v (want the new entry and the first later one)", renumAsked(f))
	}
}
