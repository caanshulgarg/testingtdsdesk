package main

// Bridge 2.2.2, the next round (05-Oct-2026): (1) the lines the cloud holds come back in the beat's answer (heldLines)
// and are asked again of Tally by their MasterID, every acceptance rule unchanged; (2) the owner's decision 3: FinCom's
// own posting coming back is not fetched, but a later alteration of it in a form is. Tests written before the code.

import (
	"strings"
	"testing"
)

func r222cRow(id, event, mid, typ, no, date string) M {
	return M{"line_id": id, "company": nwsCo, "company_guid": nwsGUID, "event": event, "master_id": mid, "vch_type": typ, "vch_no": no, "vch_date": date}
}

func r222cSentID(c *standCloud, id string) []M {
	var o []M
	for _, s := range c.recSent() {
		if str(s["line_id"]) == id {
			o = append(o, s)
		}
	}
	return o
}

// --- 1. held lines from the beat's answer: staging's lines 9 and 15 (2.2.0 sent them without a body although their GUID
// agrees with their MasterID) are asked by MasterID and sent as <line_id>:resolved with Tally's GUID and body; a row
// whose MasterID gives another voucher is held once with words; a forged row (a day before the starting point, a voucher
// below it) takes nothing
func TestR222cHeldLinesFromBeat(t *testing.T) {
	_, f, c := r222bBridge(t, `,"RecorderResolveSec":0`)
	r222Vch(f, 25000, "Journal", "J-OLD", "20261001", 54000) // below the starting point (54389)
	j := M{"heldLines": []any{
		r222cRow("st-9", "altered", "26311", "Receipt", "191", "2026-10-05"),
		r222cRow("st-15", "created", "26312", "Receipt", "192", "20261005"),
		r222cRow("st-x", "created", "26309", "Journal", "J-1", "20261005"),
		r222cRow("st-forged", "altered", "25000", "Journal", "J-OLD", "20261001"),
		r222cRow("st-bad:resolved", "created", "26312", "Receipt", "192", "20261005"),
		M{"line_id": "st-deleted", "company": nwsCo, "company_guid": nwsGUID, "event": "deleted", "master_id": "26312", "vch_date": "20261005"},
	}}
	applyHeldLines(j)
	applyHeldLines(j) // twice: once in the list
	_, items := liveHeldLoad()
	if len(items) != 4 {
		t.Fatalf("held list from the beat: %d items %v", len(items), items)
	}
	for i := 0; i < 4; i++ {
		liveUploadOnce()
	}
	s9, s15 := r222cSentID(c, "st-9:resolved"), r222cSentID(c, "st-15:resolved")
	if len(s9) != 1 || str(s9[0]["event"]) != "altered" || str(s9[0]["object_guid"]) != r222GUID(26311) || str(s9[0]["xml"]) == "" || toI64(s9[0]["alter_id"]) != 54391 {
		t.Fatalf("line 9: %v", s9)
	}
	if len(s15) != 1 || str(s15[0]["event"]) != "created" || str(s15[0]["object_guid"]) != r222GUID(26312) || str(s15[0]["xml"]) == "" {
		t.Fatalf("line 15: %v", s15)
	}
	if len(r222cSentID(c, "st-x:resolved")) != 0 || len(r222cSentID(c, "st-forged:resolved")) != 0 {
		t.Fatalf("a wrong or forged row resolved: %v", c.recSent())
	}
	_, items = liveHeldLoad()
	x, forged := items["st-x"], items["st-forged"]
	if !x.Final || !strings.Contains(x.Why, "is a Receipt of 05-Oct-2026, not this Journal") {
		t.Fatalf("the row whose MasterID gives another voucher: %+v", x)
	}
	if !forged.Final || forged.Why != "Tally's voucher with that MasterID is not a change after the starting point" {
		t.Fatalf("the forged row: %+v", forged)
	}
	// once: asked no more, and a row already resolved is not taken again
	n := f.n(vchObjectID)
	for i := 0; i < 3; i++ {
		liveUploadOnce()
	}
	applyHeldLines(j)
	liveUploadOnce()
	if f.n(vchObjectID) != n {
		t.Fatalf("asked again: %d -> %d", n, f.n(vchObjectID))
	}
	if len(r222cSentID(c, "st-9:resolved")) != 1 {
		t.Fatal("line 9 resolved twice")
	}
}

// --- 2. the owner's decision 3: FinCom's own posting coming back (imported, its FinCom id, ids agreeing) goes short, not
// fetched; a later alteration of that entry in a form is fetched and sent like any other (the FinCom id kept: Tally's
// body carries it), with Tally's AlterID
func TestR222cOwnPostingAlteredLater(t *testing.T) {
	p, f, c := r222bBridge(t, "")
	v := r222Vch(f, 26400, "Journal", "J-300", "20261005", 54600)
	v.narr = "Bill | TDSDesk:fp1"
	liveAppend(t, p,
		r222Line("import_object", "12:00", v.guid, "26400", "54600", "Journal", "J-300", "5-Oct-2026", "Bill | TDSDesk:fp1"),
		r222Line("after_import_object", "12:00", v.guid, "26400", "54600", "Journal", "J-300", "5-Oct-2026", "Bill | TDSDesk:fp1"))
	readAndUploadAll(t)
	s := r222bSent(c, "J-300")
	if len(s) != 1 || str(s[0]["event"]) != "imported" || str(s[0]["fid"]) != "fp1" || str(s[0]["xml"]) != "" || str(s[0]["object_guid"]) != v.guid || f.n(vchObjectID) != 0 {
		t.Fatalf("FinCom's own posting: %v (%v)", s, f.ids())
	}
	f.mu.Lock()
	v.alter = 54610
	f.mu.Unlock()
	liveAppend(t, p,
		r222Line("voucher_accept_pre", "12:05", v.guid, "26400", "54600", "Journal", "J-300", "5-Oct-2026", "Bill | TDSDesk:fp1"),
		r222Line("voucher_accept_post", "12:05", v.guid, "26400", "54610", "Journal", "J-300", "5-Oct-2026", "Bill | TDSDesk:fp1"))
	readAndUploadAll(t)
	s = r222bSent(c, "J-300")
	if len(s) != 2 || str(s[1]["event"]) != "altered" || str(s[1]["xml"]) == "" || toI64(s[1]["alter_id"]) != 54610 || str(s[1]["fid"]) != "fp1" || f.n(vchObjectID) != 1 {
		t.Fatalf("the alteration in a form: %v", s)
	}
}
