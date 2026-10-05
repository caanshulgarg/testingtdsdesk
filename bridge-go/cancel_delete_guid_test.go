package main

// Bridge 2.3.0 (the planned 2.2.5 fix, taken into 2.3.0 by the owner's decision): cancel/delete GUID. On a real
// TallyPrime 7.1 (spike round 3, tally-real-spike: rec-d-cancel / rec-e-delete) the add-on's before/after cancel and
// before/after delete lines carry an EMPTY GUID and no AlterID; the MasterID, type, number and date are there:
//
//	FCR1|ev=after_cancel|...|obj=Voucher|guid=|mid=2|aid=|vtype=Receipt|vno=1|vdate=2-Oct-26|...
//	FCR1|ev=after_delete|...|obj=Voucher|guid=|mid=3|aid=|vtype=Receipt|vno=2|vdate=2-Oct-26|...
//
// Every such line must reach the cloud with Tally's real GUID:
//   - a cancel: the voucher is still in Tally: asked by its MasterID (the allow-listed FinComVoucherByMaster, the 2 s
//     stop), its GUID taken; when Tally cannot be asked, the bridge's own record;
//   - a delete: the voucher is gone: the bridge's own record of MasterID -> GUID (sync\recorder-guids.json, written from
//     Tally's own answers, kept over a restart), else FinCom's record (tally-ingest), else held with plain words;
//   - the GUID a MasterID makes (<company GUID>-<MasterID in 8 hex digits>) is never used on its own;
//   - one log line per decision: "Recorder: <company>: delete of mid N: GUID from <source>".
// Run in both stand modes (plain and Tally's typed answers, STAND_TALLY_TYPED=1).
// Review H1 of 2.3.0 (review230h1_test.go): a cancel takes Tally's GUID only when this bridge's Tally shows it cancelled,
// and a delete goes on only when this bridge's Tally answers (asked by MasterID) that the voucher is not there; else held.
// The genuine cases below model that: the voucher cancelled in the stand Tally, or gone from it.

import (
	"fmt"
	"os"
	"strings"
	"testing"
)

// a line exactly as the add-on wrote it on the real Tally (the spike's round 3): the time to the minute, the date
// d-Mon-yy, and for a cancel / delete no GUID and no AlterID
func realLine(ev, guid, mid, aid, vtype, vno, vdate string) string {
	return "FCR1|ev=" + ev + "|t0=5-Oct-26 13:55|tw=5-Oct-26 13:55|cguid=" + b220CoGUID + "|cname=" + zz + "|user=TALLY User|obj=Voucher|guid=" + guid +
		"|mid=" + mid + "|aid=" + aid + "|vtype=" + vtype + "|vno=" + vno + "|vdate=" + vdate + "|name=|parent=|narr=|t1=5-Oct-26 13:55|src=live"
}

// the voucher's date as the add-on writes it (2-Oct-26)
func addonDate(d string) string { return fromTallyDate(d).Format("2-Jan-06") }

// the plain and the typed stand Tally, each as a subtest
func bothStands(t *testing.T, run func(t *testing.T)) {
	for _, typed := range []bool{false, true} {
		t.Run(map[bool]string{false: "plain", true: "typed"}[typed], func(t *testing.T) {
			standTyped.Store(typed)
			defer standTyped.Store(standTypedBase.Load())
			run(t)
		})
	}
}

func sentEvent(c *standCloud, ev string) []M {
	var o []M
	for _, l := range c.recSent() {
		if str(l["event"]) == ev {
			o = append(o, l)
		}
	}
	return o
}

const deleteWords = "deleted in Tally; FinCom could not tell which entry: upload that day's Day Book to settle it"

// a cancel: asked of Tally by its MasterID, sent with Tally's GUID
func TestCancelGUIDFromTally(t *testing.T) {
	bothStands(t, func(t *testing.T) {
		rec, f, c := liveBridge(t, `,"RecorderBodySec":2`)
		td := today()
		f.alter = 10
		noteStartPoint(zz, b220CoGUID, 5, 1)
		v := f.add(td, "Party A", "1", "rent", "-12.00")
		v.typ = "Receipt"
		// an entry that came by import: its GUID is not the one its MasterID makes, so only Tally can say it
		v.guid = "aaaa1111-2222-3333-4444-555566667777-0000abcd"
		v.cancelled = true // cancelled in this bridge's own Tally (review H1)
		liveAppend(t, liveFilePath(rec, ""),
			realLine("before_cancel", "", v.master, "", "Receipt", "1", addonDate(td)),
			realLine("after_cancel", "", v.master, "", "Receipt", "1", addonDate(td)))
		liveReadOnce()
		n0 := f.n(vchByMasterID)
		uploadAll(t)
		if f.n(vchByMasterID) != n0+1 {
			t.Fatalf("the cancel's entry is asked of Tally once by MasterID: %v", f.ids())
		}
		if b := f.bodiesOf(vchByMasterID); !strings.Contains(b[len(b)-1], "$MasterID = "+v.master) {
			t.Fatalf("the request: %s", b[len(b)-1])
		}
		got := sentEvent(c, "cancelled")
		if len(got) != 1 || str(got[0]["object_guid"]) != v.guid || str(got[0]["master_id"]) != v.master || str(got[0]["heldWhy"]) != "" {
			t.Fatalf("the cancel goes with Tally's GUID: %v", got)
		}
		if logLines("Recorder: "+zz+": cancel of mid "+v.master+": GUID from Tally") != 1 {
			t.Fatalf("one log line for the decision:\n%s", readText(logFile()))
		}
		// and the bridge keeps it: a delete of the same entry later (gone from this Tally) asks Tally only whether it is
		// still there (review H1), and takes the GUID from the bridge's record
		f.remove(v)
		n1 := f.n(vchByMasterID)
		liveAppend(t, liveFilePath(rec, ""),
			realLine("before_delete", "", v.master, "", "Receipt", "1", addonDate(td)),
			realLine("after_delete", "", v.master, "", "Receipt", "1", addonDate(td)))
		liveReadOnce()
		uploadAll(t)
		if f.n(vchByMasterID) != n1+1 {
			t.Fatalf("a delete asks this Tally once by MasterID whether it is still there: %v", f.ids())
		}
		got = sentEvent(c, "deleted")
		if len(got) != 1 || str(got[0]["object_guid"]) != v.guid {
			t.Fatalf("the delete goes with the GUID Tally gave: %v", got)
		}
		if logLines("Recorder: "+zz+": delete of mid "+v.master+": GUID from the bridge's record") != 1 {
			t.Fatalf("the delete's decision is logged:\n%s", readText(logFile()))
		}
	})
}

// a delete: the bridge's own record of MasterID -> GUID (from Tally's own answer to an earlier line), kept over a restart
func TestDeleteGUIDFromBridgeRecordAfterRestart(t *testing.T) {
	bothStands(t, func(t *testing.T) {
		rec, f, c := liveBridge(t, `,"RecorderBodySec":2`)
		td := today()
		f.alter = 10
		noteStartPoint(zz, b220CoGUID, 5, 1)
		v := f.add(td, "Party B", "2", "fees", "-50.00")
		v.typ = "Receipt"
		v.alter = 11
		// the alteration: its body asked of Tally (Tally's GUID and MasterID recorded)
		liveAppend(t, liveFilePath(rec, ""),
			realLine("voucher_accept_pre", v.guid, v.master, "3", "Receipt", "2", addonDate(td)),
			realLine("voucher_accept_post", v.guid, v.master, "3", "Receipt", "2", addonDate(td)))
		liveReadOnce()
		uploadAll(t)
		if len(sentEvent(c, "altered")) != 1 {
			t.Fatalf("the alteration: %v", c.recSent())
		}
		if !exists(sp("recorder-guids.json")) {
			t.Fatal("no sync\\recorder-guids.json")
		}
		// the restart: everything in memory forgotten; the entry deleted in this Tally
		liveResetState()
		f.remove(v)
		n1 := f.n(vchByMasterID)
		liveAppend(t, liveFilePath(rec, ""),
			realLine("before_delete", "", v.master, "", "Receipt", "2", addonDate(td)),
			realLine("after_delete", "", v.master, "", "Receipt", "2", addonDate(td)))
		liveReadOnce()
		uploadAll(t)
		if f.n(vchByMasterID) != n1+1 {
			t.Fatalf("a delete asks this Tally once by MasterID whether it is still there (review H1): %v", f.ids())
		}
		got := sentEvent(c, "deleted")
		if len(got) != 1 || str(got[0]["object_guid"]) != v.guid || str(got[0]["heldWhy"]) != "" || str(got[0]["master_id"]) != v.master {
			t.Fatalf("the delete goes with Tally's GUID from the bridge's record: %v", got)
		}
		if logLines("Recorder: "+zz+": delete of mid "+v.master+": GUID from the bridge's record") != 1 {
			t.Fatalf("one log line for the decision:\n%s", readText(logFile()))
		}
	})
}

// a delete of an entry the bridge never saw (gone from this Tally: asked by MasterID only, review H1), no GUID built from
// the MasterID; sent for FinCom's own record, held with plain words when FinCom cannot tell either; FinCom's record taken
// when it can
func TestDeleteGUIDUnknownHeldWithWords(t *testing.T) {
	bothStands(t, func(t *testing.T) {
		rec, f, c := liveBridge(t, "")
		td := today()
		f.alter = 10
		noteStartPoint(zz, b220CoGUID, 5, 1)
		var answers []M
		c.mu.Lock()
		c.recReply = func(b M) (int, M) {
			res := []any{}
			for _, x := range arr(b["lines"]) {
				l := obj(x)
				answers = append(answers, l)
				r := M{"line_id": l["line_id"], "state": "held", "why": "no entry GUID on the line"}
				if str(l["master_id"]) == "41" {
					r = M{"line_id": l["line_id"], "state": "applied", "why": nil, "guid": "bbbb-from-copy-00000029"}
				}
				res = append(res, r)
			}
			return 200, M{"ok": true, "results": res}
		}
		c.mu.Unlock()
		n0 := f.n(vchByMasterID)
		liveAppend(t, liveFilePath(rec, ""),
			realLine("before_delete", "", "40", "", "Receipt", "9", addonDate(td)),
			realLine("after_delete", "", "40", "", "Receipt", "9", addonDate(td)),
			realLine("after_delete", "", "41", "", "Receipt", "10", addonDate(td)))
		liveReadOnce()
		uploadAll(t)
		if f.n(vchByMasterID) != n0+1 || f.n(vchByNumberID) != 0 {
			t.Fatalf("the deletes are asked of this Tally once, by MasterID only: %v", f.ids())
		}
		var del []M
		for _, l := range answers {
			if str(l["event"]) == "deleted" {
				del = append(del, l)
			}
		}
		if len(del) != 2 {
			t.Fatalf("the deletes sent: %v", answers)
		}
		for _, l := range del {
			if str(l["object_guid"]) != "" {
				t.Fatalf("never the GUID a MasterID makes on its own: %v", l)
			}
			if str(l["heldWhy"]) != deleteWords {
				t.Fatalf("the plain words: %q", str(l["heldWhy"]))
			}
		}
		if logLines("Recorder: "+zz+": delete of mid 40: GUID not known to the bridge") != 1 ||
			logLines("Recorder: "+zz+": delete of mid 40: held: "+deleteWords) != 1 {
			t.Fatalf("the decisions for mid 40:\n%s", readText(logFile()))
		}
		if logLines("Recorder: "+zz+": delete of mid 41: GUID from FinCom's record (bbbb-from-copy-00000029)") != 1 {
			t.Fatalf("FinCom's record for mid 41:\n%s", readText(logFile()))
		}
	})
}

// the bridge's record is used only for the same entry: a record of another type or date (Tally's MasterIDs renumbered
// by a rewrite, a restored copy) is not this delete's GUID
func TestDeleteGUIDRecordMustBeTheSameEntry(t *testing.T) {
	rec, f, c := liveBridge(t, "")
	td := today()
	f.alter = 10
	noteStartPoint(zz, b220CoGUID, 5, 1)
	liveMidNote(b220CoGUID, "77", b220CoGUID+"-0000004d", "Payment", "5", td)
	liveMidSave()
	liveAppend(t, liveFilePath(rec, ""), realLine("after_delete", "", "77", "", "Receipt", "5", addonDate(td)))
	liveReadOnce()
	uploadAll(t)
	got := sentEvent(c, "deleted")
	if len(got) != 1 || str(got[0]["object_guid"]) != "" || str(got[0]["heldWhy"]) != deleteWords {
		t.Fatalf("a record of another entry is not used: %v", got)
	}
	if logLines("Recorder: "+zz+": delete of mid 77: GUID not known to the bridge") != 1 {
		t.Fatalf("the decision:\n%s", readText(logFile()))
	}
}

// a cancel Tally cannot answer for (it does not answer within the 2 s stop). Review H1 of 2.3.0: nothing proves it
// happened in this bridge's Tally, so both are held with words, the bridge's record NOT used, never the GUID its
// MasterID makes
func TestCancelGUIDTallySilentFallsBack(t *testing.T) {
	rec, f, c := liveBridge(t, `,"RecorderBodySec":2`)
	td := today()
	f.alter = 10
	noteStartPoint(zz, b220CoGUID, 5, 1)
	liveMidNote(b220CoGUID, "12", "cccc-imported-00000777", "Receipt", "4", td)
	f.mu.Lock()
	f.behave = silentFor(isID(vchByMasterID), nil)
	f.mu.Unlock()
	liveAppend(t, liveFilePath(rec, ""),
		realLine("after_cancel", "", "12", "", "Receipt", "4", addonDate(td)),
		realLine("after_cancel", "", "13", "", "Receipt", "5", addonDate(td)))
	liveReadOnce()
	uploadAll(t)
	got := sentEvent(c, "cancelled")
	if len(got) != 2 {
		t.Fatalf("both cancels go: %v", got)
	}
	for _, l := range got {
		if str(l["object_guid"]) != "" || l["guidHeld"] != true || !strings.HasPrefix(str(l["heldWhy"]), liveCancelUnprovenWords) {
			t.Fatalf("held with words when this Tally cannot be asked; not the bridge's record, never the GUID its MasterID makes: %v", l)
		}
	}
	if logLines("Recorder: "+zz+": cancel of mid 12: held: "+liveCancelUnprovenWords) != 1 || logLines("cancel of mid 12: GUID from") != 0 {
		t.Fatalf("the decision:\n%s", readText(logFile()))
	}
}

// the record is a small file written whole and atomically (as start-point.json), capped per company
func TestMidRecordFileCapped(t *testing.T) {
	liveBridge(t, "")
	for i := 1; i <= midRecordCap+10; i++ {
		liveMidNote(b220CoGUID, fmt.Sprint(i), fmt.Sprintf("%s-%08x", b220CoGUID, i), "Receipt", fmt.Sprint(i), "20261002")
	}
	liveMidSave()
	if _, err := os.Stat(sp("recorder-guids.json")); err != nil {
		t.Fatal(err)
	}
	liveResetState()
	if _, ok := liveMidLookup(b220CoGUID, "1"); ok {
		t.Fatal("the oldest MasterIDs are dropped past the cap")
	}
	if e, ok := liveMidLookup(b220CoGUID, fmt.Sprint(midRecordCap+10)); !ok || e.G != fmt.Sprintf("%s-%08x", b220CoGUID, midRecordCap+10) {
		t.Fatalf("the newest kept: %v %v", e, ok)
	}
}

// an alteration and the delete of the same entry read in one turn. Review H1 of 2.3.0: the one request by MasterID finds
// the voucher still in this bridge's Tally, so the delete is not proven here and is held (the alteration takes Tally's
// GUID into the bridge's record); once the voucher is gone from this Tally, a delete of it takes that recorded GUID
func TestDeleteGUIDSameTurnAsAlteration(t *testing.T) {
	bothStands(t, func(t *testing.T) {
		rec, f, c := liveBridge(t, `,"RecorderBodySec":2`)
		td := today()
		f.alter = 10
		noteStartPoint(zz, b220CoGUID, 5, 1)
		v := f.add(td, "Party C", "3", "fees", "-70.00")
		v.typ = "Receipt"
		v.guid = "dddd-imported-0000beef" // not the GUID its MasterID makes: only Tally's answer can give it
		liveAppend(t, liveFilePath(rec, ""),
			realLine("voucher_accept_pre", v.guid, v.master, "3", "Receipt", "3", addonDate(td)),
			realLine("voucher_accept_post", v.guid, v.master, "3", "Receipt", "3", addonDate(td)),
			realLine("before_delete", "", v.master, "", "Receipt", "3", addonDate(td)),
			realLine("after_delete", "", v.master, "", "Receipt", "3", addonDate(td)))
		liveReadOnce()
		uploadAll(t)
		if alt := sentEvent(c, "altered"); len(alt) != 1 || str(alt[0]["object_guid"]) != v.guid {
			t.Fatalf("the alteration goes with Tally's GUID: %v", alt)
		}
		got := sentEvent(c, "deleted")
		if len(got) != 1 || str(got[0]["object_guid"]) != "" || str(got[0]["heldWhy"]) != liveDeleteHeldWords || got[0]["guidHeld"] != true {
			t.Fatalf("still in this Tally: the delete is held: %v", got)
		}
		f.remove(v)
		liveAppend(t, liveFilePath(rec, ""),
			strings.Replace(realLine("after_delete", "", v.master, "", "Receipt", "3", addonDate(td)), "t1=5-Oct-26 13:55", "t1=5-Oct-26 13:58", 1))
		liveReadOnce()
		uploadAll(t)
		got = sentEvent(c, "deleted")
		if len(got) != 2 || str(got[1]["object_guid"]) != v.guid || str(got[1]["heldWhy"]) != "" || got[1]["guidHeld"] != nil {
			t.Fatalf("gone from this Tally: the delete goes with the GUID Tally gave for the alteration: %v", got)
		}
		if logLines("Recorder: "+zz+": delete of mid "+v.master+": GUID from the bridge's record: "+v.guid) != 1 {
			t.Fatalf("the decision:\n%s", readText(logFile()))
		}
	})
}
