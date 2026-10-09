package main

// The reviews of next-241 (0f436f6c), the bridge's part. Tests written before the code; each probe a permanent test.
//   H1: two copies of one company (the same Windows user, two Tallys) must never mix: the own data id is learned only from
//       a line that proved itself (Tally's own MasterID answer under the line's GUID, its AlterID above the line's), never
//       replaced without FinCom's choice; a line of an unproven folder is never asked by its number; the copy's Receipt
//       192 (MID 25743) is never sent with the own Tally's MID 26312.
//   H2: a line without dp= of a company this bridge stopped reading goes as 'other_source' too.
//   H5: a location FinCom has not decided on yet (pending) is NOT stopped: its lines are read (FinCom keeps them held).
//   M4: ledger lines of another data location go as 'other_source', never fetched.
//   SR-L1: control characters and bidi overrides are not part of the path, w= or the data id.

import (
	"strings"
	"testing"
)

func d241rAnswer(chosen []string, own, choice string) M {
	ids := []any{}
	for _, c := range chosen {
		ids = append(ids, c)
	}
	return M{"dataSources": []any{M{"company": nwsCo, "company_guid": nwsGUID, "dataId": own, "chosenIds": ids, "choice": choice}}}
}

// the probe of H1: same user, two Tallys, no choice yet. The copy's line comes FIRST (nothing proven): asked by its
// MasterID only (an older entry here), never by its number, sent without a body; then the own line proves the own data
// id; then the copy's next line goes as another location's, never asked
func TestData241rCopyFirstNeverMixes(t *testing.T) {
	p, f, c := r222bBridge(t, "")
	ufAs(t, "user", "anshul")
	r222Vch(f, 25743, "Receipt", "88", "20261005", 50000)  // an older entry in the own Tally (below the starting point 54389)
	r222Vch(f, 26312, "Receipt", "192", "20261005", 54392) // the own Tally's own Receipt 192
	liveAppend(t, p, d241Line("voucher_accept_post", "11:30", nwsGUID+"-00000000", "25743", "0", "Receipt", "192", "5-Oct-2026", "copy", d241Path2, "anshul"))
	readAndUploadAll(t)
	s := d241Sent(c, "192")
	if len(s) != 1 || str(s[0]["xml"]) != "" || strings.Contains(jsonText(s[0]), "26312") || strings.Contains(jsonText(s[0]), r222GUID(26312)) {
		t.Fatalf("the copy's Receipt 192 took the own Tally's MID 26312, or a body: %v", s)
	}
	if f.n(vchByNumberID) != 0 {
		t.Fatalf("a line of an unproven folder was asked by its number: %v", f.ids())
	}
	if dataOwnID(nwsGUID) != "" {
		t.Fatalf("an unproven folder became the own one: %s", dataOwnID(nwsGUID))
	}
	liveAppend(t, p, d241Line("voucher_accept_post", "11:40", r222GUID(26311), "26311", "54391", "Receipt", "191", "5-Oct-2026", "own", d241Path1, "anshul"))
	readAndUploadAll(t)
	if dataOwnID(nwsGUID) != d241ID(d241Path1) {
		t.Fatalf("the own line did not prove the own data id: %q", dataOwnID(nwsGUID))
	}
	liveAppend(t, p, d241Line("voucher_accept_post", "11:50", r222GUID(26313), "26313", "54393", "Receipt", "193", "5-Oct-2026", "copy 2", d241Path2, "anshul"))
	readAndUploadAll(t)
	if s := d241Sent(c, "193"); len(s) != 1 || str(s[0]["event"]) != "other_source" || d241Asked(f, "26313") {
		t.Fatalf("the copy's next line: %v", s)
	}
	if dataOwnID(nwsGUID) != d241ID(d241Path1) {
		t.Fatal("the copy's line replaced the own data id without FinCom's choice")
	}
}

// the own id known: a line of this user's second folder never takes it over without FinCom's choice (dataOther first)
func TestData241rOwnKnownNotReplaced(t *testing.T) {
	p, f, c := r222bBridge(t, "")
	ufAs(t, "user", "anshul")
	liveAppend(t, p, d241Line("voucher_accept_post", "11:30", r222GUID(26311), "26311", "54391", "Receipt", "191", "5-Oct-2026", "own", d241Path1, "anshul"))
	readAndUploadAll(t)
	liveAppend(t, p, d241Line("voucher_accept_post", "11:31", r222GUID(26312), "26312", "54392", "Receipt", "192", "5-Oct-2026", "copy", d241Path2, "anshul"))
	readAndUploadAll(t)
	if s := d241Sent(c, "192"); len(s) != 1 || str(s[0]["event"]) != "other_source" || d241Asked(f, "26312") {
		t.Fatalf("the second folder's line: %v", s)
	}
	if dataOwnID(nwsGUID) != d241ID(d241Path1) {
		t.Fatalf("own id replaced: %s", dataOwnID(nwsGUID))
	}
	// FinCom chose the second folder (the owner's choice): its line is read and then becomes the own one
	applyDataSources(d241rAnswer([]string{d241ID(d241Path2)}, d241ID(d241Path1), "other"))
	liveAppend(t, p, d241Line("voucher_accept_post", "11:40", r222GUID(26313), "26313", "54393", "Receipt", "193", "5-Oct-2026", "now", d241Path2, "anshul"))
	r222Vch(f, 26313, "Receipt", "193", "20261005", 54393)
	readAndUploadAll(t)
	if s := d241Sent(c, "193"); len(s) != 1 || str(s[0]["event"]) == "other_source" || str(s[0]["xml"]) == "" || dataOwnID(nwsGUID) != d241ID(d241Path2) {
		t.Fatalf("after FinCom chose the second folder: %v own %s", s, dataOwnID(nwsGUID))
	}
}

// H2: stopped (FinCom reads another location): a line without dp= (an add-on before 2.4.1 still loaded) goes as other_source
func TestData241rNoDPWhenStopped(t *testing.T) {
	p, f, c := r222bBridge(t, "")
	ufAs(t, "user", "anshul")
	liveAppend(t, p, d241Line("voucher_accept_post", "11:30", r222GUID(26311), "26311", "54391", "Receipt", "191", "5-Oct-2026", "own", d241Path1, "anshul"))
	readAndUploadAll(t)
	applyDataSources(d241rAnswer([]string{d241ID(d241Path2)}, d241ID(d241Path1), "other"))
	if !dataStopped(nwsGUID) {
		t.Fatal("not stopped")
	}
	liveAppend(t, p, ufLineNWS("voucher_accept_post", "11:41", r222GUID(26312), "26312", "54392", "Receipt", "192", "anshul"))
	readAndUploadAll(t)
	if s := d241Sent(c, "192"); len(s) != 1 || str(s[0]["event"]) != "other_source" || d241Asked(f, "26312") {
		t.Fatalf("a line without dp= while stopped: %v", s)
	}
}

// H5: pending (FinCom has not decided yet: maybe one data folder under two paths): the bridge goes on reading
func TestData241rPendingNotStopped(t *testing.T) {
	p, f, c := r222bBridge(t, "")
	ufAs(t, "user", "Ranjeet")
	liveAppend(t, p, d241Line("voucher_accept_post", "11:30", r222GUID(26311), "26311", "54391", "Receipt", "191", "5-Oct-2026", "two", d241Path2, "Ranjeet"))
	readAndUploadAll(t)
	applyDataSources(d241rAnswer([]string{d241ID(d241Path1)}, d241ID(d241Path2), "pending"))
	if dataStopped(nwsGUID) {
		t.Fatal("a pending location is stopped")
	}
	liveAppend(t, p, d241Line("voucher_accept_post", "11:31", r222GUID(26312), "26312", "54392", "Receipt", "192", "5-Oct-2026", "two b", d241Path2, "Ranjeet"))
	readAndUploadAll(t)
	if s := d241Sent(c, "192"); len(s) != 1 || str(s[0]["event"]) == "other_source" || str(s[0]["xml"]) == "" || str(s[0]["data_id"]) != d241ID(d241Path2) || !d241Asked(f, "26312") {
		t.Fatalf("the pending location's line: %v", s)
	}
}

// M4: a ledger line of another data location: other_source, its ledger never asked of Tally
func TestData241rLedgerOtherSource(t *testing.T) {
	p, f, c := r222bBridge(t, "")
	ufAs(t, "user", "anshul")
	liveAppend(t, p, d241Line("voucher_accept_post", "11:30", r222GUID(26311), "26311", "54391", "Receipt", "191", "5-Oct-2026", "own", d241Path1, "anshul"))
	readAndUploadAll(t)
	n0 := len(f.ids())
	l := strings.NewReplacer("ev=voucher_accept_post", "ev=ledger_accept_post", "|obj=Voucher|", "|obj=Master|", "|vtype=Receipt|", "|vtype=|", "|vno=L1|", "|vno=|", "|name=|", "|name=Copy Ledger|").
		Replace(d241Line("voucher_accept_post", "11:32", nwsGUID+"-00000077", "77", "300", "Receipt", "L1", "5-Oct-2026", "", d241Path2, "anshul"))
	liveAppend(t, p, l)
	readAndUploadAll(t)
	var got M
	for _, x := range c.recSent() {
		if str(x["of"]) == "ledger_altered" || str(x["event"]) == "ledger_altered" || str(x["event"]) == "ledger_created" || str(x["of"]) == "ledger_created" {
			got = x
		}
	}
	if got == nil || str(got["event"]) != "other_source" || len(f.ids()) != n0 {
		t.Fatalf("the other location's ledger line: %v (requests %v)", got, f.ids()[n0:])
	}
}

// SR-L1: control characters and bidi overrides are stripped from the path, w= and the computer; the id the same
func TestData241rControlChars(t *testing.T) {
	if dataIDOf("D:\\x\u202e\\100000\u0007") != dataIDOf(`D:\x\100000`) {
		t.Error("a bidi override or a control character changes the data id")
	}
	if g := dataClean("ab\u0000c\u200fd\u2066e\u009bf"); g != "abcdef" {
		t.Errorf("dataClean %q", g)
	}
}
