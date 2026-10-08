package main

// Review of bridge 2.3.0 (97764f7), H1: a cancel / delete line took a GUID without proof that the cancel or delete
// happened in THIS bridge's own Tally. Every Windows user's Tally writes into the one shared recorder folder and a line
// carries no session, so every per-user bridge reads every user's lines: a user working in a copy of a client company
// (the same company GUID) who cancels or deletes MasterID N would make another user's bridge send a cancel / delete of the
// real entry. The owner's rule: no line from another user's session may enter any client's books; keep them held.
//   - a cancel: the GUID only when this bridge's own Tally answers that voucher ISCANCELLED Yes (typed or not); else held
//     with plain words, never the bridge's record, never FinCom's;
//   - a delete: before ANY GUID (the bridge's record or FinCom's), this bridge's Tally is asked by MasterID (the
//     allow-listed FinComVoucherByMaster, the line's date, the 2 s stop, giving way to a posting). Tally still holds it:
//     held; Tally answers it is not there: the record goes on as before; Tally cannot be asked: held;
//   - a held line goes with guidHeld, so FinCom's cloud never looks in its own record for it.
// Run in both stand modes (plain and Tally's typed answers).

import (
	"net/http"
	"strings"
	"testing"
	"time"
)

// the stand Tally no longer holds this voucher (deleted in this Tally)
func (f *standTally) remove(v *tVch) {
	f.mu.Lock()
	defer f.mu.Unlock()
	for i, x := range f.vch {
		if x == v {
			f.vch = append(f.vch[:i], f.vch[i+1:]...)
			return
		}
	}
}

func h1Held(t *testing.T, l M, words string) {
	t.Helper()
	if str(l["object_guid"]) != "" || str(l["heldWhy"]) != words || l["guidHeld"] != true {
		t.Fatalf("held with %q, no GUID, guidHeld: %v", words, l)
	}
}

// a copy of the company in another user's Tally: a cancel there, the voucher not cancelled in this bridge's Tally
func TestH1CancelNotCancelledHereHeld(t *testing.T) {
	bothStands(t, func(t *testing.T) {
		rec, f, c := liveBridge(t, `,"RecorderBodySec":2`)
		td := today()
		f.alter = 10
		noteStartPoint(zz, b220CoGUID, 5, 1)
		v := f.add(td, "Party A", "1", "rent", "-12.00")
		v.typ = "Receipt"
		// even the bridge's own record of that MasterID is not used for it
		liveMidNote(b220CoGUID, v.master, v.guid, "Receipt", "1", td)
		liveAppend(t, liveFilePath(rec, ""), realLine("after_cancel", "", v.master, "", "Receipt", "1", addonDate(td)))
		liveReadOnce()
		n0 := f.n(vchObjectID)
		uploadAll(t)
		if f.n(vchObjectID) != n0+1 {
			t.Fatalf("the cancel is asked of this Tally once by MasterID: %v", f.ids())
		}
		got := sentEvent(c, "cancelled")
		if len(got) != 1 {
			t.Fatalf("the cancel goes (held): %v", c.recSent())
		}
		h1Held(t, got[0], liveCancelHeldWords)
		if logLines("Recorder: "+zz+": cancel of mid "+v.master+": held: "+liveCancelHeldWords) != 1 {
			t.Fatalf("one log line for the decision:\n%s", readText(logFile()))
		}
		// the genuine cancel, here: Tally answers ISCANCELLED Yes, its GUID is taken
		v.cancelled = true
		liveAppend(t, liveFilePath(rec, ""), strings.Replace(realLine("after_cancel", "", v.master, "", "Receipt", "1", addonDate(td)), "t1=5-Oct-26 13:55", "t1=5-Oct-26 13:57", 1))
		liveReadOnce()
		uploadAll(t)
		got = sentEvent(c, "cancelled")
		if len(got) != 2 || str(got[1]["object_guid"]) != v.guid || str(got[1]["heldWhy"]) != "" || got[1]["guidHeld"] != nil {
			t.Fatalf("a cancel this Tally shows goes with Tally's GUID: %v", got)
		}
	})
}

// a copy of the company in another user's Tally: a delete there, the voucher still in this bridge's Tally
func TestH1DeleteStillInThisTallyHeld(t *testing.T) {
	bothStands(t, func(t *testing.T) {
		rec, f, c := liveBridge(t, `,"RecorderBodySec":2`)
		td := today()
		f.alter = 10
		noteStartPoint(zz, b220CoGUID, 5, 1)
		v := f.add(td, "Party B", "2", "fees", "-50.00")
		v.typ = "Receipt"
		liveMidNote(b220CoGUID, v.master, v.guid, "Receipt", "2", td) // the bridge's record has its GUID
		liveAppend(t, liveFilePath(rec, ""), realLine("after_delete", "", v.master, "", "Receipt", "2", addonDate(td)))
		liveReadOnce()
		n0 := f.n(vchObjectID)
		uploadAll(t)
		if f.n(vchObjectID) != n0+1 {
			t.Fatalf("the delete is asked of this Tally once by MasterID: %v", f.ids())
		}
		if b := f.bodiesOf(vchObjectID); !strings.Contains(b[len(b)-1], "ID:"+v.master+"</ID>") {
			t.Fatalf("the request: %s", b[len(b)-1])
		}
		got := sentEvent(c, "deleted")
		if len(got) != 1 {
			t.Fatalf("the delete goes (held): %v", c.recSent())
		}
		h1Held(t, got[0], liveDeleteHeldWords)
		if logLines("Recorder: "+zz+": delete of mid "+v.master+": held: "+liveDeleteHeldWords) != 1 {
			t.Fatalf("one log line for the decision:\n%s", readText(logFile()))
		}
	})
}

// this bridge's Tally cannot be asked (it does not answer within the 2 s stop): the delete is never sent unproven
func TestH1DeleteTallyCannotBeAskedHeld(t *testing.T) {
	rec, f, c := liveBridge(t, `,"RecorderBodySec":2`)
	td := today()
	f.alter = 10
	noteStartPoint(zz, b220CoGUID, 5, 1)
	liveMidNote(b220CoGUID, "12", "cccc-imported-00000777", "Receipt", "4", td)
	f.mu.Lock()
	f.behave = silentFor(isID(vchObjectID), nil)
	f.mu.Unlock()
	liveAppend(t, liveFilePath(rec, ""), realLine("after_delete", "", "12", "", "Receipt", "4", addonDate(td)))
	liveReadOnce()
	uploadAll(t)
	// 2.3.1: stopped at 2 s, asked again at each try of the shared retry schedule; stopped 3 times, it goes held
	for i := 0; i < 2; i++ {
		retryDue()
		uploadAll(t)
	}
	got := sentEvent(c, "deleted")
	if len(got) != 1 || str(got[0]["object_guid"]) != "" || got[0]["guidHeld"] != true || !strings.HasPrefix(str(got[0]["heldWhy"]), liveDeleteUnprovenWords) {
		t.Fatalf("held, the bridge's record not used: %v", got)
	}
}

// --- the owner's addition to H1: a cancel / delete held only because this bridge's Tally could not be asked at that
// moment (busy, the 2 s stop, the fetch off for now, no answer) is asked again by itself when Tally is free (the held
// list's re-asks: spaced, bounded, giving way to postings, the 2 s rule), one log line per outcome. Proven then: sent
// with the GUID (line id + ":resolved"); proven not to belong to this Tally: stays held with words

func h1Resolved(c *standCloud, ev string) []M {
	var o []M
	for _, l := range sentEvent(c, ev) {
		if strings.HasSuffix(str(l["line_id"]), ":resolved") {
			o = append(o, l)
		}
	}
	return o
}

// Tally busy: it answers the request by MasterID with something that is not an answer (no envelope)
func h1Busy(w http.ResponseWriter, r *http.Request, id, body string) bool {
	if id != vchObjectID {
		return false
	}
	_, _ = w.Write([]byte("busy"))
	return true
}

func TestH1RetryDeleteTallyBusyThenFree(t *testing.T) {
	bothStands(t, func(t *testing.T) {
		rec, f, c := liveBridge(t, `,"RecorderBodySec":2,"RecorderResolveSec":0`)
		td := today()
		f.alter = 10
		noteStartPoint(zz, b220CoGUID, 5, 1)
		v := f.add(td, "Party D", "6", "fees", "-9.00")
		v.typ = "Receipt"
		v.guid = "eeee-imported-0000d00d"
		liveMidNote(b220CoGUID, v.master, v.guid, "Receipt", "6", td)
		f.mu.Lock()
		f.behave = h1Busy // Tally busy: no answer it can read
		f.mu.Unlock()
		liveAppend(t, liveFilePath(rec, ""), realLine("after_delete", "", v.master, "", "Receipt", "6", addonDate(td)))
		liveReadOnce()
		uploadAll(t)
		got := sentEvent(c, "deleted")
		if len(got) != 1 || str(got[0]["object_guid"]) != "" || got[0]["guidHeld"] != true {
			t.Fatalf("Tally busy: held for now: %v", got)
		}
		// Tally free again, the voucher gone from it: asked again by itself, the delete goes with the GUID
		f.mu.Lock()
		f.behave = nil
		f.mu.Unlock()
		f.remove(v)
		liveResolveTurn()
		uploadAll(t)
		r := h1Resolved(c, "deleted")
		if len(r) != 1 || str(r[0]["object_guid"]) != v.guid || str(r[0]["heldWhy"]) != "" || r[0]["guidHeld"] != nil || str(r[0]["master_id"]) != v.master {
			t.Fatalf("proven when Tally is free: sent with the GUID: %v", sentEvent(c, "deleted"))
		}
		if logLines("delete of mid "+v.master+": GUID from the bridge's record: "+v.guid) != 1 {
			t.Fatalf("the decision:\n%s", readText(logFile()))
		}
		// resolved once: asked no more
		n := f.n(vchObjectID)
		liveResolveTurn()
		uploadAll(t)
		if f.n(vchObjectID) != n || len(h1Resolved(c, "deleted")) != 1 {
			t.Fatalf("asked again after it was resolved: %v", f.ids())
		}
	})
}

func TestH1RetryCopyCompanyStaysHeld(t *testing.T) {
	bothStands(t, func(t *testing.T) {
		rec, f, c := liveBridge(t, `,"RecorderBodySec":2,"RecorderResolveSec":0`)
		td := today()
		f.alter = 10
		noteStartPoint(zz, b220CoGUID, 5, 1)
		v := f.add(td, "Party E", "7", "rent", "-3.00")
		v.typ = "Receipt"
		w := f.add(td, "Party F", "8", "rent", "-4.00")
		w.typ = "Receipt"
		liveMidNote(b220CoGUID, v.master, v.guid, "Receipt", "7", td)
		f.mu.Lock()
		f.behave = h1Busy
		f.mu.Unlock()
		liveAppend(t, liveFilePath(rec, ""), realLine("after_delete", "", v.master, "", "Receipt", "7", addonDate(td)),
			realLine("after_cancel", "", w.master, "", "Receipt", "8", addonDate(td)))
		liveReadOnce()
		uploadAll(t)
		// Tally free: still holds the voucher (deleted in a copy), and the other not cancelled here: both stay held
		f.mu.Lock()
		f.behave = nil
		f.mu.Unlock()
		liveResolveTurn()
		uploadAll(t)
		if r := append(h1Resolved(c, "deleted"), h1Resolved(c, "cancelled")...); len(r) != 0 {
			t.Fatalf("a copy company's line was sent: %v", r)
		}
		if logLines("held: "+liveDeleteHeldWords+" (not asked again)") != 1 || logLines("held: "+liveCancelHeldWords+" (not asked again)") != 1 {
			t.Fatalf("one line per outcome:\n%s", readText(logFile()))
		}
		n := f.n(vchObjectID)
		liveResolveTurn()
		if f.n(vchObjectID) != n {
			t.Fatalf("a line proven not this Tally's is asked again: %v", f.ids())
		}
	})
}

// the 2 s stop: 2.3.1 (the owner's last change) switches nothing off; the cancel is asked again at each try of the shared
// retry schedule, goes held after 3 stops, and is asked again by itself (a held line) 1 h later (2.3.2, issue 232: a
// held line whose asks timed out waits hours), then sent with Tally's GUID
func TestH1RetryCancelAfterTwoSecondStop(t *testing.T) {
	rec, f, c := liveBridge(t, `,"RecorderBodySec":2,"RecorderResolveSec":0`)
	td := today()
	f.alter = 10
	noteStartPoint(zz, b220CoGUID, 5, 1)
	v := f.add(td, "Party G", "9", "rent", "-5.00")
	v.typ = "Receipt"
	v.cancelled = true
	f.mu.Lock()
	f.behave = silentFor(isID(vchObjectID), nil)
	f.mu.Unlock()
	liveAppend(t, liveFilePath(rec, ""), realLine("after_cancel", "", v.master, "", "Receipt", "9", addonDate(td)))
	liveReadOnce()
	uploadAll(t)
	// 2.3.1: stopped at 2 s, asked again at each try of the retry schedule; stopped 3 times, it goes held for now
	for i := 0; i < 2; i++ {
		retryDue()
		uploadAll(t)
	}
	if got := sentEvent(c, "cancelled"); len(got) != 1 || got[0]["guidHeld"] != true {
		t.Fatalf("held for now: %v", got)
	}
	f.mu.Lock()
	f.behave = nil
	f.mu.Unlock()
	n := f.n(vchObjectID)
	liveResolveTurn()
	if f.n(vchObjectID) != n {
		t.Fatalf("asked before the retry's time: %v", f.ids())
	}
	retryDue() // the next try, by itself
	liveResolveTurn()
	if f.n(vchObjectID) != n {
		t.Fatalf("2.3.2 (issue 232, b): a line whose asks timed out was asked again before 1 h: %v", f.ids())
	}
	// 2.3.2 (b): its asks timed out (one timed-out try): asked again after 1 h
	at := time.Now().Add(time.Hour + time.Minute)
	nowFn = func() time.Time { return at }
	t.Cleanup(func() { nowFn = time.Now })
	retryDue()
	liveResolveTurn()
	uploadAll(t)
	r := h1Resolved(c, "cancelled")
	if len(r) != 1 || str(r[0]["object_guid"]) != v.guid || r[0]["guidHeld"] != nil {
		t.Fatalf("sent with Tally's GUID once on again: %v", sentEvent(c, "cancelled"))
	}
}
