package main

// Fault 1 (03-Oct-2026, NWS144, real books, bridge 2.1.5): a Journal dated 04-Feb-2026 (the previous FY), party
// "VIVEK GUPTA &amp; ASSOCIATES", narration "Being invoice dated — from VIVEK GUPTA & ASSOCIATES ... | TDSDesk:<id>".
// Tally replied CREATED 1 / LASTVCHID 26298 / ERRORS 0; the read-back (FinComTag, that date) listed the day's entries
// but none "carried the tag", and the bridge ended the entry FAILED ("cannot be found in ... or in any other company").
//
// The cause (TestNarrationWithEmDashParsed): Tally answers non-ASCII text in its Windows code page, so the em dash came
// back as the one byte 0x97, which is not UTF-8; Go's XML decoder stops at that byte, so the NARRATION's text (and every
// voucher after it in the answer) was lost: the tag at the END of the narration was never seen. Rules from here:
//   - Tally's bytes that are not UTF-8 (nor UTF-16) are read as Windows-1252, never cut
//   - CREATED/ALTERED with a voucher id is never FAILED and never sent again. Round 15 (03-Oct-2026, the owner's
//     decision): Tally's reply is trusted outright: the entry is POSTED by the reply (no read-back, no checking cycle,
//     no voucher-id lookup from a posting); FinComByMaster and FinComTag stay allow-listed for Check Tally and the
//     read test only

import (
	"path/filepath"
	"strings"
	"testing"
	"time"
)

const (
	f1Party = "VIVEK GUPTA &amp; ASSOCIATES"
	f1Date  = "20260204" // the previous FY (today is in FY 2026-27)
)

// the NWS144 voucher: an em dash and an ampersand in the narration, the tag at its end (as FinCom wrote it then)
func f1Voucher(id, narrTail string) string {
	x := finVoucher(id, f1Party, "VG/0126", f1Date, "11800.00")
	return strings.Replace(x, "<NARRATION>Electricity | TDSDesk:"+id+"</NARRATION>",
		"<NARRATION>Being invoice dated — from VIVEK GUPTA &amp; ASSOCIATES for professional fees "+narrTail+" | TDSDesk:"+id+"</NARRATION>", 1)
}

// a Tally that kept the narration without the tag (wherever the bridge put it)
func f1NoTag(n string) string {
	return strings.Trim(strings.TrimSpace(reTag.ReplaceAllString(n, "")), "| ")
}

func (f *standTally) bodiesOf(id string) []string {
	f.mu.Lock()
	defer f.mu.Unlock()
	var o []string
	for i, r := range f.reqs {
		if r == id {
			o = append(o, f.bodies[i])
		}
	}
	return o
}

// --- the cause: a Windows-1252 em dash in Tally's answer must not cut the narration (nor the vouchers after it)
func TestNarrationWithEmDashParsed(t *testing.T) {
	two := "<ENVELOPE><BODY><DATA><COLLECTION>" +
		"<VOUCHER><DATE>20260204</DATE><MASTERID>26298</MASTERID><NARRATION>Being invoice dated — from VIVEK GUPTA &amp; ASSOCIATES | TDSDesk:emuqtw0683g090</NARRATION></VOUCHER>" +
		"<VOUCHER><DATE>20260204</DATE><MASTERID>26299</MASTERID><NARRATION>plain | TDSDesk:next1</NARRATION></VOUCHER>" +
		"</COLLECTION></DATA></BODY></ENVELOPE>"
	for name, raw := range map[string]string{
		"windows-1252 bytes":      textFromBytes(cp1252Bytes(two)),
		"utf-8":                   two,
		"a bare 0x97 in the text": strings.Replace(two, "—", "\x97", 1),
	} {
		vs := xmlDoc(raw).All("VOUCHER")
		if len(vs) != 2 {
			t.Fatalf("%s: %d voucher(s) parsed, want 2 (the decoder stopped at the em dash)", name, len(vs))
		}
		k := keyOfVoucher(vs[0])
		if k.tag != "TDSDesk:emuqtw0683g090" || !strings.Contains(k.narration, "—") || !strings.Contains(k.narration, "GUPTA & ASSOCIATES") {
			t.Fatalf("%s: narration %q, tag %q", name, k.narration, k.tag)
		}
		if keyOfVoucher(vs[1]).tag != "TDSDesk:next1" {
			t.Fatalf("%s: the voucher after the em dash was lost", name)
		}
	}
}

// --- a posting Tally accepted (CREATED with LASTVCHID) whose tag this Tally does not keep in the narration: posted by
// Tally's reply, at once, with Tally's voucher id; nothing is read back and no checking cycle starts (round 15: the
// owner's decision of 03-Oct-2026 replaces the "accepted, being checked" state of round 5)
func TestCreatedReplyIsPostedWithoutReadBack(t *testing.T) {
	f := newStandTally(t)
	f.ansi = true
	f.storeNarr = f1NoTag // this Tally keeps the narration without the tag: a read-back would never have found it
	standBridge(t, f, "")
	j, err := newPostJob(M{"jobId": "job-f1-posted", "company": zz, "vouchers": []any{M{"id": "emu1", "xml": f1Voucher("emu1", "")}}})
	if err != nil {
		t.Fatal(err)
	}
	p := waitJob(t, str(j["id"]))
	if str(p["status"]) != "done" || p["checking"] == true {
		t.Fatalf("the job: %v", p)
	}
	f.mu.Lock()
	master := f.lastMaster
	f.mu.Unlock()
	r := obj(arr(p["results"])[0])
	e := obj(arr(p["items"])[0])
	if r["ok"] != true || r["byReply"] != true || r["verified"] != false || str(r["vchId"]) != master || str(r["lastVchId"]) != master {
		t.Fatalf("not posted by Tally's reply: %v", r)
	}
	if str(e["state"]) != "posted" || str(e["vchId"]) != master {
		t.Fatalf("the item: %v", e)
	}
	if f.n("Import") != 1 || f.n(masterCheckID) != 0 || f.n(tagCheckID) != 0 || f.n(dupCheckID) != 0 {
		t.Fatalf("requests: %v", f.ids())
	}
	if logLines("ACCEPTED BUT UNCONFIRMED") > 0 || logLines("being checked") > 0 {
		t.Fatal("the checking cycle of round 5 ran")
	}
	if a := acceptedInfo("emu1"); a == nil || a["sent"] != true || str(a["vchId"]) != master {
		t.Fatalf("the record: %v", a)
	}
	onlyPostingRequests(t, f, 0)
}

// --- a date in the previous financial year goes to Tally as it is (never clamped to this FY); nothing is read back
func TestPreviousFYDateSentAsIs(t *testing.T) {
	f := newStandTally(t)
	f.ansi = true
	standBridge(t, f, "")
	if f1Date >= tallyDate(fyStart(time.Now())) {
		t.Fatalf("the test date %s is not in a previous FY", f1Date)
	}
	r := postOne(t, "emu2", f1Voucher("emu2", ""))
	if r["ok"] != true || r["byReply"] != true || str(r["vchDate"]) != f1Date {
		t.Fatalf("a previous-FY entry: %v", r)
	}
	imp := f.bodiesOf("Import")
	if len(imp) != 1 || !strings.Contains(imp[0], "<DATE>"+f1Date+"</DATE>") {
		t.Fatalf("the import does not carry the voucher's own date: %v", imp)
	}
	if len(f.bodiesOf(tagCheckID))+len(f.bodiesOf(dupCheckID))+len(f.bodiesOf(masterCheckID)) != 0 {
		t.Fatalf("a read went with the posting: %v", f.ids())
	}
}

// --- a party with "&": the import carries it escaped once; the entry is posted, and refused the second time on this
// computer's record
func TestPartyWithAmpersandPosted(t *testing.T) {
	f := newStandTally(t)
	f.ansi = true
	standBridge(t, f, "")
	r := postOne(t, "emu3", f1Voucher("emu3", "(bill no. 7)"))
	if r["ok"] != true || r["byReply"] != true {
		t.Fatalf("not posted: %v", r)
	}
	imp := f.bodiesOf("Import")
	if len(imp) != 1 || !strings.Contains(imp[0], "<PARTYLEDGERNAME>VIVEK GUPTA &amp; ASSOCIATES</PARTYLEDGERNAME>") || strings.Contains(imp[0], "&amp;amp;") {
		t.Fatalf("the party in the import: %s", cut(imp[0], 600))
	}
	again := postOne(t, "emu3", f1Voucher("emu3", "(bill no. 7)"))
	if again["ok"] == true || again["alreadySent"] != true || f.n("Import") != 1 {
		t.Fatalf("the same id again: %v (%d imports)", again, f.n("Import"))
	}
}

// --- an entry sent is never queued again: not by the worker's list of what is left, nor by a resume after a restart
func TestSentNeverQueuedTwice(t *testing.T) {
	all := []M{{"id": "a", "kind": "voucher"}, {"id": "b", "kind": "voucher"}, {"id": "c", "kind": "voucher"}}
	left := itemsToSend(all, []M{
		{"id": "a", "ok": true, "byReply": true, "lastVchId": "26298"}, // posted by Tally's reply: never again
		{"id": "b", "ok": false, "outcomeUnknown": true, "sent": true}, // sent, no answer: never again
	})
	if len(left) != 1 || str(left[0]["id"]) != "c" {
		t.Fatalf("what is left to send: %v", left)
	}
	// the job: posted, the bridge restarts, the job is resumed: nothing is imported again
	f := newStandTally(t)
	f.ansi = true
	f.storeNarr = f1NoTag
	standBridge(t, f, "")
	j, err := newPostJob(M{"jobId": "job-f1-resume", "company": zz, "vouchers": []any{M{"id": "emu4", "xml": f1Voucher("emu4", "")}}})
	if err != nil {
		t.Fatal(err)
	}
	id := str(j["id"])
	dir, _ := jobDir(id)
	p := waitJob(t, id)
	if obj(arr(p["results"])[0])["byReply"] != true || f.n("Import") != 1 {
		t.Fatalf("results %v, %d imports", p["results"], f.n("Import"))
	}
	// as after a restart part-way: the worker gone, the job running
	p["status"], p["updatedAt"] = "running", time.Now().Add(-time.Minute).Format(time.RFC3339Nano)
	_ = saveFile(filepath.Join(dir, "progress.json"), jsonText(p))
	if str(jobView(dir)["status"]) != "interrupted" {
		t.Fatal("the job is not seen as interrupted")
	}
	if _, err := resumePostJob(id); err != nil {
		t.Fatal(err)
	}
	p = waitJob(t, id)
	if str(p["status"]) != "done" || f.n("Import") != 1 {
		t.Fatalf("the resume sent the posted entry again (%d imports): %v", f.n("Import"), p["message"])
	}
	r := obj(arr(p["results"])[0])
	if r["ok"] != true || r["byReply"] != true {
		t.Fatalf("after the resume: %v", r)
	}
}

// --- Tally's own voucher id (LASTVCHID) is the entry's vchId only when the request held that one entry; FinComByMaster
// stays on the allow-list for Check Tally, and no posting sends it
func TestLastVchIdNeverInferred(t *testing.T) {
	f := newStandTally(t)
	f.ansi = true
	f.storeNarr = f1NoTag
	standBridge(t, f, "")
	r := postOne(t, "emu5", f1Voucher("emu5", ""))
	f.mu.Lock()
	master := f.lastMaster
	f.mu.Unlock()
	if r["ok"] != true || str(r["vchId"]) != master || toInt(r["batchN"]) != 1 {
		t.Fatalf("one entry: %v", r)
	}
	j, err := newPostJob(M{"jobId": "job-f1-two", "company": zz, "vouchers": []any{M{"id": "emu6", "xml": f1Voucher("emu6", "(a)")}, M{"id": "emu7", "xml": f1Voucher("emu7", "(b)")}}})
	if err != nil {
		t.Fatal(err)
	}
	p := waitJob(t, str(j["id"]))
	f.mu.Lock()
	master = f.lastMaster
	f.mu.Unlock()
	for _, x := range arr(p["results"]) {
		r := obj(x)
		if _, has := r["vchId"]; has {
			t.Fatalf("a voucher id was inferred for an entry of a request of 2: %v", r)
		}
		if str(r["batchEnd"]) != master || toInt(r["batchN"]) != 2 || r["ok"] != true {
			t.Fatalf("the entry: %v", r)
		}
	}
	if f.n(masterCheckID) != 0 {
		t.Fatal("a posting looked an entry up by Tally's voucher id")
	}
	a, ok := tallyAllowList["FinComByMaster"]
	if !ok || a.measureOnly {
		t.Fatal("FinComByMaster is not on the allow-list for Check Tally")
	}
	if f.n("Import") != 2 {
		t.Fatalf("%d imports", f.n("Import"))
	}
}
