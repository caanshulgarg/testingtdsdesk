package main

// Round 6 (03-Oct-2026): job 3b03cc5e on NWS144 was sent to Tally twice (voucher ids 26298 and 26299). One Go test per
// route by which the same entry could go a second time. Round 15 (the owner's decision of 03-Oct-2026): the guard on
// every route is this computer's record of what it sent (posted-ids.json), never a read of Tally.

import (
	"net/http"
	"strings"
	"testing"
	"time"
)

// a Tally that answers in Windows-1252 and keeps the narration without the tag (round 15: a read-back would never
// find the entry; Tally's reply is trusted instead, so hide() no longer matters to a posting and is kept for the
// Check Tally reads)
func r6Tally(t *testing.T, hide func() bool) *standTally {
	f := newStandTally(t)
	f.ansi = true
	f.storeNarr = f1NoTag
	f.behave = func(w http.ResponseWriter, r *http.Request, id, body string) bool {
		if (id == "FinComByMaster" || id == "FinComTag") && hide() && strings.Contains(body, f1Date[:6]) {
			_, _ = w.Write([]byte("<ENVELOPE><BODY><DATA><COLLECTION></COLLECTION></DATA></BODY></ENVELOPE>"))
			return true
		}
		return false
	}
	return f
}

func r6Done(t *testing.T, id string) M {
	t.Helper()
	dir, _ := jobDir(id)
	for i := 0; i < 300; i++ {
		p := readProgress(dir)
		if p != nil && (str(p["status"]) == "done" || str(p["status"]) == "failed") && !jobAlive(id) {
			return p
		}
		time.Sleep(50 * time.Millisecond)
	}
	t.Fatalf("the job %s did not end", id)
	return nil
}

func r6States(p M) map[string]string {
	o := map[string]string{}
	for _, x := range arr(p["items"]) {
		e := obj(x)
		o[str(e["id"])] = str(e["state"])
	}
	return o
}

// --- route (i): the cloud hands the same job back as 'waiting' (requeue) with the same items: nothing is sent again;
// the posted entry stays posted (round 15: by Tally's reply, no checking cycle)
func TestRequeuedJobNeverResent(t *testing.T) {
	f := r6Tally(t, func() bool { return true })
	standBridge(t, f, "")
	vch := []any{M{"id": "emuqtw0683g090", "xml": f1Voucher("emuqtw0683g090", "")}}
	if _, err := newPostJob(M{"jobId": "3b03cc5e", "company": zz, "vouchers": vch}); err != nil {
		t.Fatal(err)
	}
	p := r6Done(t, "3b03cc5e")
	if str(p["status"]) != "done" || p["checking"] == true || r6States(p)["emuqtw0683g090"] != "posted" || f.n("Import") != 1 {
		t.Fatalf("after the first run: %v (%d imports)", p, f.n("Import"))
	}
	// the requeue: the same job id, the same items, as cloudPostTake hands it over
	for i := 0; i < 2; i++ {
		if _, err := newPostJob(M{"jobId": "3b03cc5e", "company": zz, "vouchers": vch}); err != nil {
			t.Fatal(err)
		}
		p = r6Done(t, "3b03cc5e")
		if f.n("Import") != 1 {
			t.Fatalf("the requeued job sent the entry again (%d imports)", f.n("Import"))
		}
		if r6States(p)["emuqtw0683g090"] != "posted" || str(p["status"]) != "done" {
			t.Fatalf("the requeued job: %v", p)
		}
	}
	f.mu.Lock()
	n := len(f.vch)
	f.mu.Unlock()
	if n != 1 {
		t.Fatalf("%d vouchers in Tally", n)
	}
	if f.n(masterCheckID)+f.n(tagCheckID) != 0 {
		t.Fatalf("a hand-back read Tally: %v", f.ids())
	}
}

// --- route (ii): a new job (Post again, another job id) carrying a FinCom id this computer sent before: refused on the
// record with a named reason (the earlier job and Tally's id), never sent
func TestNewJobWithSentIdRefused(t *testing.T) {
	f := r6Tally(t, func() bool { return true })
	standBridge(t, f, "")
	x := f1Voucher("emuqtw0683g090", "")
	if _, err := newPostJob(M{"jobId": "job-first", "company": zz, "vouchers": []any{M{"id": "emuqtw0683g090", "xml": x}}}); err != nil {
		t.Fatal(err)
	}
	r6Done(t, "job-first")
	f.mu.Lock()
	master := f.lastMaster
	f.mu.Unlock()
	if _, err := newPostJob(M{"jobId": "job-second", "company": zz, "vouchers": []any{M{"id": "emuqtw0683g090", "xml": x}}}); err != nil {
		t.Fatal(err)
	}
	p := r6Done(t, "job-second")
	if f.n("Import") != 1 {
		t.Fatalf("the second job sent the entry again (%d imports)", f.n("Import"))
	}
	if str(p["status"]) != "failed" || r6States(p)["emuqtw0683g090"] != "failed" {
		t.Fatalf("the second job: %v", p)
	}
	r := obj(arr(p["results"])[0])
	if r["alreadySent"] != true || r["ok"] == true || !strings.Contains(str(r["message"]), "job job-first") || !strings.Contains(str(r["message"]), "(Tally id "+master+")") {
		t.Fatalf("the reason does not name the earlier job and Tally's id: %v", r)
	}
	e := obj(arr(p["items"])[0])
	if !strings.HasPrefix(str(e["reason"]), "already sent from this computer on ") || e["alreadySent"] != true {
		t.Fatalf("the item the cloud stores: %v", e)
	}
}

// --- route (iii): a Retry of a job after a reply that needs review (Tally made 1 of 2): both entries were recorded as
// sent (which one Tally made is not known, and no voucher id is inferred), so the Retry sends nothing; the owner's
// Check Tally settles it (round 15 replaces the held-entry rule of round 7)
func TestRetryAfterNeedsReviewSendsNothing(t *testing.T) {
	f := r6Tally(t, func() bool { return true })
	td := today()
	f.importSkip = func(x string) bool { return strings.Contains(x, "TDSDesk:bad1") } // Tally refuses this one (ERRORS 1)
	standBridge(t, f, "")
	vch := []any{M{"id": "emuqtw0683g090", "xml": f1Voucher("emuqtw0683g090", "")}, M{"id": "bad1", "xml": finVoucher("bad1", fgParty, "B-1", td, "5.00")}}
	if _, err := newPostJob(M{"jobId": "job-retry", "company": zz, "vouchers": vch}); err != nil {
		t.Fatal(err)
	}
	p := r6Done(t, "job-retry")
	st := r6States(p)
	if str(p["status"]) != "done" || str(p["message"]) != "Posted 0 of 2; 2 need review" || st["emuqtw0683g090"] != "needs_review" || st["bad1"] != "needs_review" {
		t.Fatalf("the first run: %v %v", p["status"], st)
	}
	for _, x := range arr(p["results"]) {
		r := obj(x)
		if r["accepted"] != true || !strings.HasPrefix(str(r["message"]), "Tally's reply: created 1 of 2, errors 1") {
			t.Fatalf("the result: %v", r)
		}
		if a := acceptedInfo(str(r["id"])); a == nil || a["sent"] != true {
			t.Fatalf("%s not recorded as sent: %v", r["id"], a)
		}
	}
	imports := f.n("Import")
	f.mu.Lock()
	f.importSkip = nil
	f.mu.Unlock()
	if _, err := newPostJob(M{"jobId": "job-retry", "company": zz, "vouchers": vch}); err != nil {
		t.Fatal(err)
	}
	p = r6Done(t, "job-retry")
	if f.n("Import") != imports {
		t.Fatalf("the retry sent an entry recorded as sent (%d imports, had %d)", f.n("Import"), imports)
	}
	for _, x := range arr(p["results"]) {
		r := obj(x)
		if r["accepted"] != true || r["needsReview"] != true {
			t.Fatalf("the retry changed a kept result: %v", r)
		}
	}
	// (a done job handed back is not run again; nothing to retry)
}

// --- before any send: an id on this computer's record (an earlier posting here), the narration with an em dash: the
// record refuses it, nothing is sent and nothing is asked of Tally. (Until 2.1.7 Tally was read for the id; round 15:
// an id in Tally that this computer never sent is the cloud's lock's business, see TestDupRecordNotTally)
func TestPreSendRecordCheckWithDash(t *testing.T) {
	f := newStandTally(t)
	f.ansi = true
	f.add(f1Date, "VIVEK GUPTA & ASSOCIATES", "VG/0126", "Being invoice dated — from VIVEK GUPTA & ASSOCIATES for professional fees | TDSDesk:emuqtw0683g090", "11800.00")
	standBridge(t, f, "")
	if err := noteSent("emuqtw0683g090", zz, "job-earlier", "26298", 1, "26298", "26298"); err != nil {
		t.Fatal(err)
	}
	n0 := f.n("")
	r := postOne(t, "emuqtw0683g090", f1Voucher("emuqtw0683g090", ""))
	if r["ok"] == true || r["alreadySent"] != true || f.n("Import") != 0 || !strings.Contains(str(r["message"]), "(Tally id 26298)") {
		t.Fatalf("not refused on the record: %v (%d imports)", r, f.n("Import"))
	}
	onlyPostingRequests(t, f, n0)
}

// --- C: after the import nothing is asked of Tally: no voucher-id lookup, no tag read-back (round 15)
func TestNothingAfterTheImport(t *testing.T) {
	f := newStandTally(t)
	f.ansi = true
	standBridge(t, f, "")
	r := postOne(t, "emu7", f1Voucher("emu7", ""))
	f.mu.Lock()
	master := f.lastMaster
	var after []string
	seen := false
	for _, id := range f.reqs {
		if seen {
			after = append(after, id)
		}
		if id == "Import" {
			seen = true
		}
	}
	f.mu.Unlock()
	if r["ok"] != true || str(r["vchId"]) != master {
		t.Fatalf("not posted with Tally's id: %v", r)
	}
	if len(after) != 0 {
		t.Fatalf("requests after the import: %v (want none)", after)
	}
	if logLines("confirmed by Tally's voucher id") > 0 {
		t.Fatal("a read-back confirmation was logged")
	}
}

// --- the record is on disk: written when Tally's reply accepts an entry (and when no answer comes), read by a later job
func TestSentRecordOnDisk(t *testing.T) {
	f := r6Tally(t, func() bool { return true })
	standBridge(t, f, "")
	if _, err := newPostJob(M{"jobId": "job-disk", "company": zz, "vouchers": []any{M{"id": "emu-8", "xml": f1Voucher("emu8", "")}}}); err != nil {
		t.Fatal(err)
	}
	r6Done(t, "job-disk")
	e := readObjFile(acceptedFile())
	n := obj(e["emu8"])
	if n == nil || n["sent"] != true || str(n["lastVchId"]) == "" || str(n["vchId"]) != str(n["lastVchId"]) || toInt(n["batchN"]) != 1 || str(n["job"]) != "job-disk" || str(n["sentAt"]) == "" {
		t.Fatalf("posted-ids.json after a posting: %v", e)
	}
	if _, err := time.Parse(time.RFC3339, str(n["sentAt"])); err != nil {
		t.Fatalf("sentAt %q is not RFC3339", n["sentAt"])
	}
	// a batch: the request's size and Tally's last id, no vchId
	td := today()
	if _, err := newPostJob(M{"jobId": "job-disk-2", "company": zz, "vouchers": []any{M{"id": "ok-9", "xml": finVoucher("ok9", fgParty, "OK-9", td, "9.00")}, M{"id": "ok-10", "xml": finVoucher("ok10", fgParty, "OK-10", td, "10.00")}}}); err != nil {
		t.Fatal(err)
	}
	r6Done(t, "job-disk-2")
	e = readObjFile(acceptedFile())
	if n := obj(e["ok9"]); n == nil || n["sent"] != true || toInt(n["batchN"]) != 2 || str(n["batchEnd"]) == "" || str(n["vchId"]) != "" {
		t.Fatalf("posted-ids.json after a batch: %v", e)
	}
	if acceptedKey("emu-8", f1Voucher("emu8", "")) != "emu8" || acceptedKey("a.b-c", "<VOUCHER/>") != "abc" {
		t.Fatal("acceptedKey")
	}
}
