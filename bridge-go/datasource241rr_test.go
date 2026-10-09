package main

// The re-review of next-241 (0f436f6c..d5582c55), the bridge's part. Tests written before the code.
//   H1-r(a): every line says on the wire whether its data id is the one this bridge PROVED its own Tally's (data_proven):
//            FinCom notes a location as the bridge's own only from such a line (or the beat's dataSources), so an
//            unproven folder (the same user's second Tally, a copy) is never chosen by itself.
//   H1-r(b): two forked copies of one company continue the same MasterID, GUID and number sequences, so Tally's answer by
//            MasterID cannot tell them apart. While this Windows user has written two folders for a company and FinCom
//            has chosen neither, nothing is proven (both go as candidates: pending at FinCom, with the alert); and a line
//            with a narration proves only when Tally's NARRATION is the same.

import (
	"strings"
	"testing"
	"time"
)

// H1-r(a): the own line that proved itself goes with data_proven; the copy's line (not proven) goes without it
func TestData241rrWireProven(t *testing.T) {
	p, _, c := r222bBridge(t, "")
	ufAs(t, "user", "anshul")
	liveAppend(t, p, d241Line("voucher_accept_post", "11:30", r222GUID(26311), "26311", "54391", "Receipt", "191", "5-Oct-2026", "", d241Path1, "anshul"))
	readAndUploadAll(t)
	s := d241Sent(c, "191")
	if len(s) != 1 || str(s[0]["data_id"]) != d241ID(d241Path1) || s[0]["data_proven"] != true {
		t.Fatalf("the own line that proved its folder: no data_proven: %v", s)
	}
	dataResetState()
	p2, f2, c2 := r222bBridge(t, "")
	ufAs(t, "user", "anshul")
	r222Vch(f2, 25743, "Receipt", "88", "20261005", 50000) // an older entry: the copy's MasterID proves nothing
	liveAppend(t, p2, d241Line("voucher_accept_post", "11:30", nwsGUID+"-00000000", "25743", "0", "Receipt", "192", "5-Oct-2026", "", d241Path2, "anshul"))
	readAndUploadAll(t)
	s = d241Sent(c2, "192")
	if len(s) != 1 || str(s[0]["data_id"]) != d241ID(d241Path2) {
		t.Fatalf("the copy's line: %v", s)
	}
	if v, had := s[0]["data_proven"]; had && v != false && v != nil {
		t.Fatalf("an unproven folder's line says data_proven: %v", s[0])
	}
}

// H1-r(b), the forked-copies probe: the fork's line (the same MasterID sequence: Tally here has an entry under the same
// GUID with a higher AlterID, but another narration) proves nothing; then the own folder's line proves nothing either
// (two folders of this user, none chosen): both candidates. Once FinCom chose the own folder, its line proves it
func TestData241rrForkedCopies(t *testing.T) {
	p, f, c := r222bBridge(t, "")
	ufAs(t, "user", "anshul")
	r222Vch(f, 26320, "Receipt", "194", "20261005", 54400) // the own Tally's Receipt 194 (narration "Receipt 194")
	r222Vch(f, 26321, "Receipt", "195", "20261005", 54402)
	r222Vch(f, 26322, "Receipt", "196", "20261005", 54404)
	// the fork's save: the same MasterID 26320 and GUID, an AlterID below the own Tally's, its own narration
	liveAppend(t, p, d241Line("voucher_accept_post", "11:30", r222GUID(26320), "26320", "54395", "Receipt", "194", "5-Oct-2026", "Fork sale to Beta", d241Path2, "anshul"))
	readAndUploadAll(t)
	if dataOwnID(nwsGUID) != "" {
		t.Fatalf("the fork's line proved its folder (Tally's narration differs): %s", dataOwnID(nwsGUID))
	}
	// the own folder's line, its narration as Tally's: two folders of this user, none chosen: proves nothing
	liveAppend(t, p, d241Line("voucher_accept_post", "11:40", r222GUID(26321), "26321", "54401", "Receipt", "195", "5-Oct-2026", "Receipt 195", d241Path1, "anshul"))
	readAndUploadAll(t)
	if dataOwnID(nwsGUID) != "" {
		t.Fatalf("with two folders of this user and none chosen, a folder was proven: %s", dataOwnID(nwsGUID))
	}
	for _, no := range []string{"194", "195"} {
		s := d241Sent(c, no)
		if len(s) != 1 || str(s[0]["event"]) == "other_source" {
			t.Fatalf("line %s: not sent as a candidate: %v", no, s)
		}
		if v, had := s[0]["data_proven"]; had && v != false && v != nil {
			t.Fatalf("line %s says data_proven: %v", no, s[0])
		}
	}
	if ds := arr(beatBody(true, "open", "", nil, nil, nil)["dataSources"]); len(ds) != 0 {
		t.Fatalf("the beat named an own folder: %v", ds)
	}
	// FinCom's owner chose the own folder: its next line proves it
	applyDataSources(d241rAnswer([]string{d241ID(d241Path1)}, "", "pending"))
	liveAppend(t, p, d241Line("voucher_accept_post", "11:50", r222GUID(26322), "26322", "54403", "Receipt", "196", "5-Oct-2026", "Receipt 196", d241Path1, "anshul"))
	readAndUploadAll(t)
	if dataOwnID(nwsGUID) != d241ID(d241Path1) {
		t.Fatalf("the chosen folder's line did not prove it: %q", dataOwnID(nwsGUID))
	}
	if s := d241Sent(c, "196"); len(s) != 1 || s[0]["data_proven"] != true {
		t.Fatalf("the proven line: %v", s)
	}
}

// the folders seen are kept across a restart (recorder-data.json): a restart does not forget the second folder
func TestData241rrSeenSurvivesRestart(t *testing.T) {
	p, f, _ := r222bBridge(t, "")
	ufAs(t, "user", "anshul")
	r222Vch(f, 26321, "Receipt", "195", "20261005", 54402)
	liveAppend(t, p, d241Line("voucher_accept_post", "11:30", nwsGUID+"-00000000", "25743", "0", "Receipt", "192", "5-Oct-2026", "", d241Path2, "anshul"))
	readAndUploadAll(t)
	dataResetState()
	liveAppend(t, p, d241Line("voucher_accept_post", "11:40", r222GUID(26321), "26321", "54401", "Receipt", "195", "5-Oct-2026", "Receipt 195", d241Path1, "anshul"))
	readAndUploadAll(t)
	if dataOwnID(nwsGUID) != "" {
		t.Fatalf("after a restart the second folder was forgotten and the first proven: %s", dataOwnID(nwsGUID))
	}
}

// how many requests to this Tally named the MasterID
func d241AskN(f *standTally, mid string) int {
	f.mu.Lock()
	defer f.mu.Unlock()
	n := 0
	for _, b := range f.bodies {
		if strings.Contains(b, "ID:"+mid+"</ID>") || strings.Contains(b, mid+"</MASTERID>") {
			n++
		}
	}
	return n
}

// the coordinator's item 3: this Tally's entry is never attached to a line of a folder not proven this bridge's own. The
// fork's line is asked once (the only way to prove a folder); Tally's narration differs: it goes WITHOUT a body, held for
// good, never asked again (the held list, the turns after). The owner then chooses the fork's folder: still nothing of it is
// asked of this Tally, no ":resolved" line with a body (its entry comes from the bridge whose own Tally proves that folder,
// or from its Day Book)
func TestData241rrUnprovenNeverTakesThisTally(t *testing.T) {
	p, f, c := r222bBridge(t, "")
	ufAs(t, "user", "anshul")
	r222Vch(f, 26320, "Receipt", "194", "20261005", 54400)
	liveAppend(t, p, d241Line("voucher_accept_post", "11:30", r222GUID(26320), "26320", "54395", "Receipt", "194", "5-Oct-2026", "Fork sale to Beta", d241Path2, "anshul"))
	readAndUploadAll(t)
	s := d241Sent(c, "194")
	if len(s) != 1 || str(s[0]["xml"]) != "" || str(s[0]["data_id"]) != d241ID(d241Path2) {
		t.Fatalf("the unproven fork's line took this Tally's entry: %v", s)
	}
	n0 := d241AskN(f, "26320")
	for i := 0; i < 3; i++ {
		laterBy(t, 11*time.Minute)
		readAndUploadAll(t)
	}
	applyDataSources(d241rAnswer([]string{d241ID(d241Path2)}, "", "pending"))
	for i := 0; i < 3; i++ {
		laterBy(t, 11*time.Minute)
		readAndUploadAll(t)
	}
	if n := d241AskN(f, "26320"); n != n0 {
		t.Fatalf("the unproven line was asked of this Tally again (%d -> %d)", n0, n)
	}
	for _, x := range c.recSent() {
		if strings.HasPrefix(str(x["line_id"]), str(s[0]["line_id"])) && str(x["xml"]) != "" {
			t.Fatalf("this Tally's entry was sent for the fork's line: %v", x)
		}
	}
}

// forked (two folders of this user, none chosen): a line of either folder is not asked of this Tally at all
func TestData241rrForkedNotAsked(t *testing.T) {
	p, f, c := r222bBridge(t, "")
	ufAs(t, "user", "anshul")
	r222Vch(f, 26321, "Receipt", "195", "20261005", 54402)
	liveAppend(t, p, d241Line("voucher_accept_post", "11:30", nwsGUID+"-00000000", "25743", "0", "Receipt", "192", "5-Oct-2026", "", d241Path2, "anshul"))
	readAndUploadAll(t)
	liveAppend(t, p, d241Line("voucher_accept_post", "11:40", r222GUID(26321), "26321", "54401", "Receipt", "195", "5-Oct-2026", "Receipt 195", d241Path1, "anshul"))
	readAndUploadAll(t)
	if d241AskN(f, "26321") != 0 {
		t.Fatal("a line of a forked company (two folders, none chosen) was asked of this Tally")
	}
	if s := d241Sent(c, "195"); len(s) != 1 || str(s[0]["xml"]) != "" || str(s[0]["data_id"]) != d241ID(d241Path1) {
		t.Fatalf("the forked line: %v", s)
	}
}

// the coordinator's item 2: FinCom lists this computer's older lines without a data id (verifyLines) once its bridge proved
// a chosen location. Each is asked of THIS (proven) Tally by its MasterID, one a turn: Tally's entry with the same GUID, an
// AlterID not below the line's and the same narration goes as "<line id>:verified" with the entry; an entry that does not
// match (the line was saved while another folder was open) goes as verify_failed, without the entry. Each asked once
func TestData241rrVerifyOlderLines(t *testing.T) {
	_, f, c := b230Bridge(t, `,"RecorderResolveSec":0`)
	ufAs(t, "user", "anshul")
	r222Vch(f, 26330, "Receipt", "201", "20261005", 54420) // narration "Receipt 201"
	r222Vch(f, 26331, "Receipt", "202", "20261005", 54421) // narration "Receipt 202"
	// this bridge proved the chosen folder
	dataSt.mu.Lock()
	dataFresh()
	dataSt.own[dataKey(nwsGUID)] = dataOwnSt{ID: d241ID(d241Path1), Path: d241Path1, Company: nwsCo, CGUID: nwsGUID, W: "anshul"}
	dataSave()
	dataSt.mu.Unlock()
	row := func(id, mid, no, alter, narr string) M {
		return M{"line_id": id, "company": nwsCo, "company_guid": nwsGUID, "event": "created", "master_id": mid, "vch_type": "Receipt", "vch_no": no, "vch_date": "2026-10-05",
			"guid": r222GUID(toI64(mid)), "alter_id": alter, "narration": narr}
	}
	applyVerifyLines(M{"verifyLines": []any{row("old-ok", "26330", "201", "54420", "Receipt 201"), row("old-bad", "26331", "202", "54421", "A sale in the other folder")}})
	b230Turns(4)
	ok, bad := r222cSentID(c, "old-ok:verified"), r222cSentID(c, "old-bad:verified")
	if len(ok) != 1 || str(ok[0]["xml"]) == "" || str(ok[0]["object_guid"]) != r222GUID(26330) || str(ok[0]["data_id"]) != d241ID(d241Path1) || ok[0]["data_proven"] != true || ok[0]["verify_failed"] == true {
		t.Fatalf("the matching line: %v", ok)
	}
	if len(bad) != 1 || str(bad[0]["xml"]) != "" || bad[0]["verify_failed"] != true {
		t.Fatalf("the line that does not match: %v", bad)
	}
	if d241AskN(f, "26330") != 1 || d241AskN(f, "26331") != 1 {
		t.Fatalf("asked %d and %d times (want once each)", d241AskN(f, "26330"), d241AskN(f, "26331"))
	}
	// listed again (FinCom has not taken the answers yet): nothing more is asked or sent
	applyVerifyLines(M{"verifyLines": []any{row("old-ok", "26330", "201", "54420", "Receipt 201"), row("old-bad", "26331", "202", "54421", "A sale in the other folder")}})
	b230Turns(3)
	if d241AskN(f, "26330") != 1 || d241AskN(f, "26331") != 1 || len(r222cSentID(c, "old-ok:verified")) != 1 {
		t.Fatal("asked or sent again")
	}
}

// not proven here: nothing is asked
func TestData241rrVerifyNeedsProof(t *testing.T) {
	_, f, c := b230Bridge(t, `,"RecorderResolveSec":0`)
	ufAs(t, "user", "anshul")
	r222Vch(f, 26330, "Receipt", "201", "20261005", 54420)
	applyVerifyLines(M{"verifyLines": []any{M{"line_id": "old-ok", "company": nwsCo, "company_guid": nwsGUID, "event": "created", "master_id": "26330", "vch_type": "Receipt",
		"vch_no": "201", "vch_date": "2026-10-05", "guid": r222GUID(26330), "alter_id": "54420", "narration": "Receipt 201"}}})
	b230Turns(3)
	if d241AskN(f, "26330") != 0 || len(r222cSentID(c, "old-ok:verified")) != 0 {
		t.Fatal("a line was verified by a bridge that proved no data folder")
	}
}
