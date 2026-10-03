package main

// Round 6 (03-Oct-2026): job 3b03cc5e on NWS144 was sent to Tally twice (voucher ids 26298 and 26299). One Go test per
// route by which the same entry could go a second time, and the LASTVCHID lookup first.

import (
	"net/http"
	"strings"
	"testing"
	"time"
)

// a Tally that answers in Windows-1252 and keeps the narration without the tag, and hides the entry from the id lookup
// and the day's list while hide() says so
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

// --- route (i): the cloud hands the same job back as 'waiting' (requeue) with the same items: nothing is sent again,
// the accepted entry is only looked for, and confirmed when Tally shows it
func TestRequeuedJobNeverResent(t *testing.T) {
	hide := true
	f := r6Tally(t, func() bool { return hide })
	standBridge(t, f, `,"PostRecheckMs":200,"PostRecheckTries":1`)
	vch := []any{M{"id": "emuqtw0683g090", "xml": f1Voucher("emuqtw0683g090", "")}}
	if _, err := newPostJob(M{"jobId": "3b03cc5e", "company": zz, "vouchers": vch, "checkFirst": true}); err != nil {
		t.Fatal(err)
	}
	p := r6Done(t, "3b03cc5e")
	if str(p["status"]) != "done" || p["checking"] != true || r6States(p)["emuqtw0683g090"] != "unknown" || f.n("Import") != 1 {
		t.Fatalf("after the first run: %v (%d imports)", p, f.n("Import"))
	}
	// the requeue: the same job id, the same items, as cloudPostTake hands it over
	if _, err := newPostJob(M{"jobId": "3b03cc5e", "company": zz, "vouchers": vch, "checkFirst": true}); err != nil {
		t.Fatal(err)
	}
	p = r6Done(t, "3b03cc5e")
	if f.n("Import") != 1 {
		t.Fatalf("the requeued job sent the entry again (%d imports)", f.n("Import"))
	}
	if r6States(p)["emuqtw0683g090"] != "unknown" || p["checking"] != true {
		t.Fatalf("the requeued job: %v", p)
	}
	if logLines("Posting job 3b03cc5e: 1 entry accepted by Tally") < 2 {
		t.Fatal("the requeued job did not recheck the accepted entry")
	}
	// Tally shows it: the next hand-back confirms it, still without sending
	hide = false
	if _, err := newPostJob(M{"jobId": "3b03cc5e", "company": zz, "vouchers": vch, "checkFirst": true}); err != nil {
		t.Fatal(err)
	}
	p = r6Done(t, "3b03cc5e")
	if f.n("Import") != 1 || r6States(p)["emuqtw0683g090"] != "in_tally" || p["checking"] == true {
		t.Fatalf("after Tally showed it: %v (%d imports)", p, f.n("Import"))
	}
	f.mu.Lock()
	n := len(f.vch)
	f.mu.Unlock()
	if n != 1 {
		t.Fatalf("%d vouchers in Tally", n)
	}
}

// --- route (ii): a new job (Post again, another job id) carrying a FinCom id Tally accepted before: refused with a
// named reason, state unknown (accepted), never failed, never sent
func TestNewJobWithAcceptedIdRefused(t *testing.T) {
	f := r6Tally(t, func() bool { return true })
	standBridge(t, f, `,"PostRecheckMs":200,"PostRecheckTries":1`)
	x := f1Voucher("emuqtw0683g090", "")
	if _, err := newPostJob(M{"jobId": "job-first", "company": zz, "vouchers": []any{M{"id": "emuqtw0683g090", "xml": x}}}); err != nil {
		t.Fatal(err)
	}
	r6Done(t, "job-first")
	if _, err := newPostJob(M{"jobId": "job-second", "company": zz, "vouchers": []any{M{"id": "emuqtw0683g090", "xml": x}}, "checkFirst": true}); err != nil {
		t.Fatal(err)
	}
	p := r6Done(t, "job-second")
	if f.n("Import") != 1 {
		t.Fatalf("the second job sent the entry again (%d imports)", f.n("Import"))
	}
	if str(p["status"]) == "failed" || r6States(p)["emuqtw0683g090"] != "unknown" {
		t.Fatalf("the second job: %v", p)
	}
	r := obj(arr(p["results"])[0])
	if r["accepted"] != true || r["ok"] == true || !strings.Contains(str(r["message"]), "job-first") || !strings.Contains(str(r["message"]), "accepted") {
		t.Fatalf("the reason does not name the earlier job: %v", r)
	}
	e := obj(arr(p["items"])[0])
	if !strings.Contains(str(e["reason"]), "job-first") || e["accepted"] != true {
		t.Fatalf("the item the cloud stores: %v", e)
	}
}

// --- route (iii): a Retry of a job that failed for another entry keeps the accepted one: only the refused entry goes again
func TestRetryKeepsAcceptedEntry(t *testing.T) {
	f := r6Tally(t, func() bool { return true })
	td := today()
	refuse := true
	f.importAt = func(id, body string) (bool, time.Duration) {
		if refuse && strings.Contains(body, "TDSDesk:bad1") {
			return false, 0 // Tally refuses this one (CREATED 0)
		}
		return true, 0
	}
	standBridge(t, f, `,"PostRecheckMs":200,"PostRecheckTries":1`)
	// (round 7, F5: two tagged entries would go as one batch, where a refusal cannot be told apart from a success and both
	// are held; the refused one is an Optional voucher here, which goes on its own)
	bad := strings.Replace(finVoucher("bad1", fgParty, "B-1", td, "5.00"), "<ISOPTIONAL>No</ISOPTIONAL>", "<ISOPTIONAL>Yes</ISOPTIONAL>", 1)
	vch := []any{M{"id": "emuqtw0683g090", "xml": f1Voucher("emuqtw0683g090", "")}, M{"id": "bad1", "xml": bad}}
	if _, err := newPostJob(M{"jobId": "job-retry", "company": zz, "vouchers": vch}); err != nil {
		t.Fatal(err)
	}
	p := r6Done(t, "job-retry")
	st := r6States(p)
	if str(p["status"]) != "failed" || st["emuqtw0683g090"] != "unknown" || st["bad1"] != "failed" {
		t.Fatalf("the first run: %v %v", p["status"], st)
	}
	imports := f.n("Import")
	refuse = false
	if _, err := newPostJob(M{"jobId": "job-retry", "company": zz, "vouchers": vch}); err != nil {
		t.Fatal(err)
	}
	p = r6Done(t, "job-retry")
	st = r6States(p)
	if st["bad1"] != "in_tally" || st["emuqtw0683g090"] != "unknown" {
		t.Fatalf("after the retry: %v", st)
	}
	f.mu.Lock()
	var sent []string
	for i, id := range f.reqs {
		if id == "Import" && i >= 0 {
			sent = append(sent, f.bodies[i])
		}
	}
	f.mu.Unlock()
	if len(sent) != imports+1 || strings.Contains(sent[len(sent)-1], "TDSDesk:emuqtw0683g090") {
		t.Fatalf("the retry sent the accepted entry again (%d imports)", len(sent))
	}
}

// --- before any send: the id already in Tally (an older posting; the local set empty, as after a fresh install), the
// narration with an em dash in Tally's code page: the sameId check refuses it, nothing is sent
func TestPreSendSameIdCheckWithDash(t *testing.T) {
	f := newStandTally(t)
	f.ansi = true
	f.add(f1Date, "VIVEK GUPTA & ASSOCIATES", "VG/0126", "Being invoice dated — from VIVEK GUPTA & ASSOCIATES for professional fees | TDSDesk:emuqtw0683g090", "11800.00")
	standBridge(t, f, "")
	if acceptedInfo("emuqtw0683g090") != nil {
		t.Fatal("the local set is not empty")
	}
	r := postOne(t, "emuqtw0683g090", f1Voucher("emuqtw0683g090", ""))
	if r["ok"] == true || r["sameId"] != true || r["already"] != true || f.n("Import") != 0 {
		t.Fatalf("not refused on the id: %v (%d imports)", r, f.n("Import"))
	}
}

// --- C: Tally's LASTVCHID is looked up directly first (FinComByMaster with that id), the tag read-back second
func TestLastVchIdLookedUpFirst(t *testing.T) {
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
	if r["verified"] != true || str(r["masterId"]) != master {
		t.Fatalf("not confirmed: %v", r)
	}
	if len(after) == 0 || after[0] != "FinComByMaster" {
		t.Fatalf("the first read after the import is not the voucher-id lookup: %v", after)
	}
	bm := f.bodiesOf("FinComByMaster")
	if len(bm) != 1 || !strings.Contains(bm[0], "$MasterID = "+master) {
		t.Fatalf("the lookup does not use the id Tally gave: %v", bm)
	}
	if logLines("confirmed by Tally's voucher id "+master) < 1 {
		t.Fatal("the log does not say so")
	}
	// the voucher id confirmed it: no tag read-back after the import (the FinComTag before it is the check before sending)
	for _, id := range after {
		if id == "FinComTag" {
			t.Fatalf("the tag read-back ran although the voucher id confirmed the entry: %v", after)
		}
	}
}

// --- the accepted set is on disk: written when Tally accepts and when an entry is confirmed, read by a later job
func TestAcceptedSetOnDisk(t *testing.T) {
	f := r6Tally(t, func() bool { return true })
	standBridge(t, f, `,"PostRecheckMs":200,"PostRecheckTries":1`)
	if _, err := newPostJob(M{"jobId": "job-disk", "company": zz, "vouchers": []any{M{"id": "emu-8", "xml": f1Voucher("emu8", "")}}}); err != nil {
		t.Fatal(err)
	}
	r6Done(t, "job-disk")
	e := readObjFile(acceptedFile())
	if e == nil || obj(e["emu8"]) == nil || str(obj(e["emu8"])["lastVchId"]) == "" || obj(e["emu8"])["verified"] != false || str(obj(e["emu8"])["job"]) != "job-disk" {
		t.Fatalf("posted-ids.json after an accepted entry: %v", e)
	}
	// a confirmed entry is written too
	td := today()
	if r := postOne(t, "ok-9", finVoucher("ok9", fgParty, "OK-9", td, "9.00")); r["verified"] != true {
		t.Fatalf("posting: %v", r)
	}
	e = readObjFile(acceptedFile())
	if obj(e["ok9"]) == nil || obj(e["ok9"])["verified"] != true || str(obj(e["ok9"])["masterId"]) == "" {
		t.Fatalf("posted-ids.json after a confirmed entry: %v", e)
	}
	if acceptedKey("emu-8", f1Voucher("emu8", "")) != "emu8" || acceptedKey("a.b-c", "<VOUCHER/>") != "abc" {
		t.Fatal("acceptedKey")
	}
}
