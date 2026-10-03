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
//   - CREATED/ALTERED with a voucher id is never FAILED and never sent again: the entry is "unknown" (accepted, being
//     checked), the job stays checking, and the entry is looked for again later, by its tag on its date AND by Tally's
//     own voucher id (LASTVCHID = MasterID, FinComByMaster, allow-listed)

import (
	"net/http"
	"os"
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

// --- a posting Tally accepted (CREATED with LASTVCHID) that the read-back cannot confirm: never failed, never sent
// again; "unknown" (accepted, being checked); the job stays checking and confirms it later
func TestCreatedButUnconfirmedIsNotFailed(t *testing.T) {
	f := newStandTally(t)
	f.ansi = true
	f.storeNarr = f1NoTag // this Tally kept the narration without the tag
	noMaster := true      // neither the day's list nor the voucher-id lookup shows it, until Tally is set right
	f.behave = func(w http.ResponseWriter, r *http.Request, id, body string) bool {
		if (id == "FinComByMaster" || id == "FinComTag") && noMaster {
			_, _ = w.Write([]byte("<ENVELOPE><BODY><DATA><COLLECTION></COLLECTION></DATA></BODY></ENVELOPE>"))
			return true
		}
		return false
	}
	standBridge(t, f, `,"PostRecheckMs":300`)
	j, err := newPostJob(M{"jobId": "job-f1-unconfirmed", "company": zz, "vouchers": []any{M{"id": "emu1", "xml": f1Voucher("emu1", "")}}})
	if err != nil {
		t.Fatal(err)
	}
	dir, _ := jobDir(str(j["id"]))
	var p M
	for i := 0; i < 100; i++ {
		p = readProgress(dir)
		if p != nil && (str(p["status"]) == "done" || str(p["status"]) == "failed") {
			break
		}
		time.Sleep(50 * time.Millisecond)
	}
	if p == nil || str(p["status"]) == "failed" {
		t.Fatalf("the job FAILED although Tally replied CREATED with a voucher id: %v", p)
	}
	r := obj(arr(p["results"])[0])
	e := obj(arr(p["items"])[0])
	// round 5 (C7): ok false (not posted as far as FinCom knows), accepted true (never failed, never sent again)
	if r["ok"] != false || r["outcomeUnknown"] != true || r["accepted"] != true || r["verified"] != nil || str(r["lastVchId"]) == "" {
		t.Fatalf("the accepted entry is not 'unknown, accepted': %v", r)
	}
	if str(e["state"]) != "unknown" || p["checking"] != true {
		t.Fatalf("FinCom is not shown unknown + checking: item %v, checking %v", e, p["checking"])
	}
	if !strings.Contains(strings.ToLower(str(r["message"])), "not sent again") || strings.Contains(strings.ToLower(str(r["message"])), "cannot be found") {
		t.Fatalf("the message: %q", r["message"])
	}
	if logLines("ACCEPTED BUT UNCONFIRMED") < 1 || logLines("LASTVCHID "+str(r["lastVchId"])) < 1 {
		t.Fatal("the log does not name the accepted, unconfirmed entry with Tally's voucher id")
	}
	if f.n("Import") != 1 {
		t.Fatalf("sent %d times", f.n("Import"))
	}
	// Tally answers the voucher-id lookup from now on: the later check confirms it, nothing is sent again
	f.mu.Lock()
	noMaster = false
	f.mu.Unlock()
	p = waitJob(t, str(j["id"]))
	r = obj(arr(p["results"])[0])
	if r["verified"] != true || r["outcomeUnknown"] == true || str(r["masterId"]) == "" || p["checking"] == true {
		t.Fatalf("not confirmed later: %v (checking %v)", r, p["checking"])
	}
	if f.n("Import") != 1 {
		t.Fatalf("sent again while being checked (%d imports)", f.n("Import"))
	}
}

// --- a date in the previous financial year: the read-back asks for that very date (never clamped to this FY)
func TestConfirmPreviousFYByDate(t *testing.T) {
	f := newStandTally(t)
	f.ansi = true
	standBridge(t, f, "")
	if f1Date >= tallyDate(fyStart(time.Now())) {
		t.Fatalf("the test date %s is not in a previous FY", f1Date)
	}
	r := postOne(t, "emu2", f1Voucher("emu2", ""))
	if r["ok"] != true || r["verified"] != true {
		t.Fatalf("a previous-FY entry was not confirmed: %v", r)
	}
	tags := f.bodiesOf("FinComTag")
	if len(tags) == 0 {
		t.Fatal("no FinComTag read-back")
	}
	for _, b := range tags {
		if !strings.Contains(b, "<SVFROMDATE>"+f1Date+"</SVFROMDATE><SVTODATE>"+f1Date+"</SVTODATE>") {
			t.Fatalf("the read-back does not ask for the voucher's own date: %s", cut(b, 400))
		}
	}
	for _, b := range f.bodiesOf(dupCheckID) {
		if !strings.Contains(b, "<SVFROMDATE>"+f1Date+"</SVFROMDATE>") {
			t.Fatalf("the duplicate check does not ask for the voucher's own date: %s", cut(b, 400))
		}
	}
}

// --- a party with "&": the check's formula carries it escaped once; the entry is confirmed, and refused the second time
func TestConfirmPartyWithAmpersand(t *testing.T) {
	f := newStandTally(t)
	f.ansi = true
	standBridge(t, f, "")
	r := postOne(t, "emu3", f1Voucher("emu3", "(bill no. 7)"))
	if r["ok"] != true || r["verified"] != true {
		t.Fatalf("not confirmed: %v", r)
	}
	for _, b := range f.bodiesOf(dupCheckID) {
		formula := group(`<SYSTEM TYPE="Formulae" NAME="TDSDeskDupParty">([^<]*)</SYSTEM>`, b, 1)
		if formula == "" || !strings.Contains(formula, "GUPTA &amp; ASSOCIATES") || strings.Contains(formula, "&amp;amp;") {
			t.Fatalf("the party formula: %q", formula)
		}
	}
	again := postOne(t, "emu3", f1Voucher("emu3", "(bill no. 7)"))
	if again["ok"] == true || again["sameId"] != true || f.n("Import") != 1 {
		t.Fatalf("the same id again: %v (%d imports)", again, f.n("Import"))
	}
}

// --- an accepted, unconfirmed entry is never queued again: not by the worker's list of what is left, nor by a resume
func TestUnconfirmedNeverQueuedTwice(t *testing.T) {
	all := []M{{"id": "a", "kind": "voucher"}, {"id": "b", "kind": "voucher"}, {"id": "c", "kind": "voucher"}}
	left := itemsToSend(all, []M{
		{"id": "a", "ok": true, "outcomeUnknown": true, "accepted": true, "lastVchId": "26298"}, // Tally accepted it: never again
		{"id": "b", "ok": false, "outcomeUnknown": true},                                        // the answer was lost: looked for, then maybe sent
	})
	if len(left) != 2 || str(left[0]["id"]) != "b" || str(left[1]["id"]) != "c" {
		t.Fatalf("what is left to send: %v", left)
	}
	// the job: accepted but unconfirmed, the bridge restarts, the job is resumed: nothing is imported again
	f := newStandTally(t)
	f.ansi = true
	f.storeNarr = f1NoTag
	f.behave = func(w http.ResponseWriter, r *http.Request, id, body string) bool {
		if id == "FinComByMaster" || id == "FinComTag" {
			_, _ = w.Write([]byte("<ENVELOPE><BODY><DATA><COLLECTION></COLLECTION></DATA></BODY></ENVELOPE>"))
			return true
		}
		return false
	}
	standBridge(t, f, `,"PostRecheckMs":200,"PostRecheckTries":2`)
	j, err := newPostJob(M{"jobId": "job-f1-resume", "company": zz, "vouchers": []any{M{"id": "emu4", "xml": f1Voucher("emu4", "")}}})
	if err != nil {
		t.Fatal(err)
	}
	id := str(j["id"])
	dir, _ := jobDir(id)
	var p M
	for i := 0; i < 200; i++ {
		p = readProgress(dir)
		if p != nil && str(p["status"]) == "done" && !jobAlive(id) {
			break
		}
		time.Sleep(50 * time.Millisecond)
	}
	if p == nil || str(p["status"]) != "done" || jobAlive(id) {
		t.Fatalf("the job did not end its checks: %v", p)
	}
	if obj(arr(p["results"])[0])["accepted"] != true || f.n("Import") != 1 {
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
	// the resumed job ends still checking (Tally never shows the entry here): done, worker gone, nothing imported again
	for i := 0; i < 300; i++ {
		p = readProgress(dir)
		if p != nil && str(p["status"]) == "done" && !jobAlive(id) && p["resumed"] == true && str(p["message"]) != "Resuming" {
			break
		}
		time.Sleep(50 * time.Millisecond)
	}
	if p == nil || str(p["status"]) != "done" || jobAlive(id) {
		t.Fatalf("the resumed job did not end: %v", p)
	}
	if f.n("Import") != 1 {
		t.Fatalf("the resume sent the accepted entry again (%d imports)", f.n("Import"))
	}
	r := obj(arr(p["results"])[0])
	if r["ok"] != false || r["verified"] != nil || r["accepted"] != true {
		t.Fatalf("after the resume: %v", r)
	}
	_ = os.Remove(filepath.Join(dir, "cancel"))
}

// --- Tally's own voucher id (LASTVCHID = MasterID) confirms an entry whose narration came back without the tag
func TestConfirmByLastVchId(t *testing.T) {
	f := newStandTally(t)
	f.ansi = true
	f.storeNarr = f1NoTag
	hideDay := false
	f.behave = func(w http.ResponseWriter, r *http.Request, id, body string) bool {
		if id == "FinComTag" && hideDay {
			_, _ = w.Write([]byte("<ENVELOPE><BODY><DATA><COLLECTION></COLLECTION></DATA></BODY></ENVELOPE>"))
			return true
		}
		return false
	}
	standBridge(t, f, "")
	// (a) the day's list shows the entry (its narration without the tag): confirmed by Tally's voucher id among the heads
	r := postOne(t, "emu5", f1Voucher("emu5", ""))
	f.mu.Lock()
	master := f.lastMaster
	f.mu.Unlock()
	if r["ok"] != true || r["verified"] != true || str(r["masterId"]) != master {
		t.Fatalf("not confirmed by the voucher id %s: %v", master, r)
	}
	if logLines("voucher emu5: confirmed by Tally's voucher id "+master) < 1 {
		t.Fatal("the log does not say the entry was confirmed by Tally's voucher id")
	}
	// (b) the day's list does not show it at all: the voucher-id lookup in its month (FinComByMaster) confirms it
	f.mu.Lock()
	hideDay = true
	f.mu.Unlock()
	r = postOne(t, "emu6", f1Voucher("emu6", "(second)"))
	f.mu.Lock()
	master = f.lastMaster
	f.mu.Unlock()
	if r["ok"] != true || r["verified"] != true || str(r["masterId"]) != master {
		t.Fatalf("not confirmed by the voucher-id lookup %s: %v", master, r)
	}
	if logLines("voucher emu6: confirmed by Tally's voucher id "+master) < 1 {
		t.Fatal("the log does not say the entry was confirmed by Tally's voucher id (looked up)")
	}
	bm := f.bodiesOf("FinComByMaster")
	if len(bm) != 1 || !strings.Contains(bm[0], "$MasterID = "+master) {
		t.Fatalf("the voucher-id lookup: %v", bm)
	}
	if !strings.Contains(bm[0], "<SVFROMDATE>"+f1Date[:6]+"01</SVFROMDATE><SVTODATE>"+monthEnd(f1Date[:6])+"</SVTODATE>") {
		t.Fatalf("the voucher-id lookup is not limited to the voucher's month: %s", cut(bm[0], 400))
	}
	a, ok := tallyAllowList["FinComByMaster"]
	if !ok || a.measureOnly {
		t.Fatal("FinComByMaster is not on the allow-list for the bridge")
	}
	if f.n("Import") != 2 {
		t.Fatalf("%d imports", f.n("Import"))
	}
}
