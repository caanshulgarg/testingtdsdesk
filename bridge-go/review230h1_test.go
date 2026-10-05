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
	"strings"
	"testing"
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
		n0 := f.n(vchByMasterID)
		uploadAll(t)
		if f.n(vchByMasterID) != n0+1 {
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
		n0 := f.n(vchByMasterID)
		uploadAll(t)
		if f.n(vchByMasterID) != n0+1 {
			t.Fatalf("the delete is asked of this Tally once by MasterID: %v", f.ids())
		}
		if b := f.bodiesOf(vchByMasterID); !strings.Contains(b[len(b)-1], "$MasterID = "+v.master) {
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
	f.behave = silentFor(isID(vchByMasterID), nil)
	f.mu.Unlock()
	liveAppend(t, liveFilePath(rec, ""), realLine("after_delete", "", "12", "", "Receipt", "4", addonDate(td)))
	liveReadOnce()
	uploadAll(t)
	got := sentEvent(c, "deleted")
	if len(got) != 1 || str(got[0]["object_guid"]) != "" || got[0]["guidHeld"] != true || !strings.HasPrefix(str(got[0]["heldWhy"]), liveDeleteUnprovenWords) {
		t.Fatalf("held, the bridge's record not used: %v", got)
	}
}
