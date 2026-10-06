package main

// Bridge 2.3.1 (the owner's decision of 06-Oct-2026): "let blanks through for every field the 2.3.1 request fetches in
// full; keep the guard only for lines from a bridge older than 2.3.1 that did not ask for the field". The bridge marks a
// line "full": true only when its body is the answer to its 2.3.1 entry request (FinComVoucherByMaster / ByNumber) and
// that request fetches the party GSTIN, place of supply, ref, ref date, company GSTIN and the lines' HSN and rate; the
// cloud then marks the voucher "full" and migration 56 passes it as sent. Test written before the code.

import (
	"strings"
	"testing"
)

func TestFull231FetchHasTheFields(t *testing.T) {
	if !liveFetchFull() {
		t.Fatal("the entry request does not fetch every field 56 keeps")
	}
	for _, f := range liveFullFields {
		if !strings.Contains(", "+liveFetchField+",", ", "+f+",") {
			t.Fatalf("%s is not fetched", f)
		}
	}
	for _, f := range []string{"PARTYGSTIN", "PLACEOFSUPPLY", "REFERENCE", "REFERENCEDATE", "CMPGSTIN", "ALLLEDGERENTRIES.GSTHSNNAME", "ALLLEDGERENTRIES.RATEDETAILS.GSTRATE"} {
		found := false
		for _, g := range liveFullFields {
			found = found || g == f
		}
		if !found {
			t.Fatalf("%s is not among the fields the marker needs", f)
		}
	}
	// 2.3.0's fetch (the trial forms B, D, E, F keep it) has none of them: never full
	if fetchHasAll(liveFetchField222, liveFullFields) {
		t.Fatal("2.3.0's fetch reads as full")
	}
}

func TestFull231MarkedOnlyWithTheEntryRequestsBody(t *testing.T) {
	x := `<VOUCHER><GUID>g-1</GUID><MASTERID> 7</MASTERID><ALTERID> 9</ALTERID><NARRATION>n</NARRATION></VOUCHER>`
	c := &change{company: "ZZ", event: "altered", lineId: "L1", source: "addon", masterId: "7", saveMs: -1}
	if m := c.wire(); m["full"] != nil {
		t.Fatalf("a line without a body is marked: %v", m)
	}
	liveTakeBody(c, x)
	if m := c.wire(); m["full"] != true || str(m["xml"]) == "" {
		t.Fatalf("the entry request's body is not marked: %v", m)
	}
	// a body too big for one line goes without it: no marker
	big := &change{company: "ZZ", event: "altered", lineId: "L2", source: "addon", masterId: "7", saveMs: -1}
	liveTakeBody(big, strings.Replace(x, "<NARRATION>n</NARRATION>", "<NARRATION>"+strings.Repeat("x", liveMaxBytes)+"</NARRATION>", 1))
	if m := big.wire(); m["full"] != nil || str(m["xml"]) != "" {
		t.Fatalf("an oversize line is marked: %v", m["full"])
	}
}

// through the stand: the lines sent with the entry request's body carry the marker
func TestFull231SentLinesCarryTheMarker(t *testing.T) {
	p, _, c := partABridge(t)
	v := partAVchs[0]
	liveAppend(t, p, "FCR1|ev=voucher_accept_post|t0=2-Oct-26 10:55|tw=2-Oct-26 10:55|cguid="+spikeCoGUID+"|cname="+spikeCo+
		"|user=TALLY User|obj=Voucher|guid="+spikeCoGUID+"-00000000|mid="+v.mid+"|aid=0|vtype="+v.typ+"|vno="+v.no+"|vdate=2-Oct-26|name=|parent=|narr=|t1=2-Oct-26 10:55|src=live")
	readAndUploadAll(t)
	sent := c.recSent()
	if len(sent) != 1 || str(sent[0]["xml"]) == "" || sent[0]["full"] != true {
		t.Fatalf("sent: %v", sent)
	}
}
