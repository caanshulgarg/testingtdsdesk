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
	"testing"
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
