package main

// Round 8 (03-Oct-2026): the re-read of adabade..0e039fe, bridge side (R4, R5, R9). Round 15 (the owner's decision of
// 03-Oct-2026): R4's held entry became "sent in a batch" on this computer's record; R5 (the release) is unchanged.

import (
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// --- R4. the entries of a partial batch are on disk as sent (round 15 replaces "held": the request's size and Tally's
// last id are noted, no voucher id is inferred): after the job ends failed and the cloud frees the ids, a new job never
// sends them, and says why with the earlier job
func TestPartialBatchNotedOnDisk(t *testing.T) {
	td := today()
	f := newStandTally(t)
	f.ansi = true
	f.importSkip = func(x string) bool { return strings.Contains(x, "TDSDesk:fb3") } // Tally refuses the third of the batch
	standBridge(t, f, "")
	vch := []any{
		M{"id": "fb1", "xml": finVoucher("fb1", fgParty, "FB-1", td, "1.00")},
		M{"id": "fb2", "xml": finVoucher("fb2", fgParty, "FB-2", td, "2.00")},
		M{"id": "fb3", "xml": finVoucher("fb3", fgParty, "FB-3", td, "3.00")},
	}
	if _, err := newPostJob(M{"jobId": "job-held-1", "company": zz, "vouchers": vch}); err != nil {
		t.Fatal(err)
	}
	p := r6Done(t, "job-held-1")
	st := r6States(p)
	if str(p["status"]) != "done" || st["fb1"] != "needs_review" || st["fb2"] != "needs_review" || st["fb3"] != "needs_review" {
		t.Fatalf("the first job: %s %v", p["status"], st)
	}
	imports := f.n("Import")
	f.mu.Lock()
	last := f.lastMaster
	f.mu.Unlock()
	for _, k := range []string{"fb1", "fb2", "fb3"} {
		a := acceptedInfo(k)
		if a == nil || a["sent"] != true || str(a["job"]) != "job-held-1" || str(a["sentAt"]) == "" || str(a["vchId"]) != "" || toInt(a["batchN"]) != 3 || str(a["batchEnd"]) != last || a["held"] == true {
			t.Fatalf("the entry %s is not on disk as sent in a batch of 3: %v", k, a)
		}
	}
	// the cloud freed the ids; a new job carries fb2 (and fb3): refused, nothing sent
	if _, err := newPostJob(M{"jobId": "job-held-2", "company": zz, "vouchers": []any{vch[1], vch[2]}}); err != nil {
		t.Fatal(err)
	}
	p = r6Done(t, "job-held-2")
	if f.n("Import") != imports {
		t.Fatalf("a new job sent an entry of the batch again (%d imports, had %d)", f.n("Import"), imports)
	}
	st = r6States(p)
	r := obj(arr(p["results"])[0])
	if st["fb2"] != "failed" || r["alreadySent"] != true || !strings.HasPrefix(str(r["message"]), "already sent from this computer on ") || !strings.Contains(str(r["message"]), "(Tally ids up to "+last+", sent in a batch of 3), job job-held-1") {
		t.Fatalf("the new job's result: %v (%v)", r, st)
	}
	if e := obj(arr(p["items"])[0]); str(e["reason"]) != str(r["message"]) {
		t.Fatalf("the item the cloud stores: %v", e)
	}
	f.mu.Lock()
	n := len(f.vch)
	f.mu.Unlock()
	if n != 2 {
		t.Fatalf("%d vouchers in Tally, want 2", n)
	}
}

// --- R5. the cloud is the single judge of a release: the bridge resends once per release (by its at+id), never again
// for the same release handed back, and once more for a new release after a new acceptance; no clock comparison here
func TestReleaseHonouredOncePerRelease(t *testing.T) {
	f := r6Tally(t, func() bool { return true })
	c := newStandCloud(t)
	standBridge(t, f, c.cfg())
	id := "emuqtw0683g090"
	vch := []any{M{"id": id, "xml": f1Voucher(id, "")}}
	hand := func(job string, rel []any) M {
		t.Helper()
		c.mu.Lock()
		c.takeJobs = append(c.takeJobs, M{"id": job, "company": zz, "payload": M{"vouchers": vch}, "released": rel})
		c.mu.Unlock()
		cloudPostTake()
		return r6Done(t, job)
	}
	hand("job-hon-1", nil)
	if f.n("Import") != 1 {
		t.Fatalf("%d imports", f.n("Import"))
	}
	// a release whose "at" is OLDER than the send (clocks differ): the cloud handed it, so it is in force: one send
	rel1 := M{"id": id, "at": time.Now().Add(-2 * time.Hour).Format(time.RFC3339), "by": "Anshul", "why": "not in Tally"}
	hand("job-hon-2", []any{rel1})
	if f.n("Import") != 2 {
		t.Fatalf("the release was not honoured (%d imports)", f.n("Import"))
	}
	if logLines("entry "+id+": released by Anshul at "+str(rel1["at"])+" (not in Tally); sent once more") < 1 {
		t.Fatal("the release is not logged")
	}
	a := acceptedInfo(id)
	if a == nil || !contains(strs(a["honoured"]), str(rel1["at"])+"|"+id) || str(a["job"]) != "job-hon-2" {
		t.Fatalf("the note after the resend: %v", a)
	}
	// the same release handed twice more (the same job back, and a new job): no further send
	hand("job-hon-2", []any{rel1})
	hand("job-hon-3", []any{rel1})
	if f.n("Import") != 2 {
		t.Fatalf("the same release caused another send (%d imports)", f.n("Import"))
	}
	// a new release (later at) after the new send: one send
	rel2 := M{"id": id, "at": time.Now().Format(time.RFC3339), "by": "Anshul", "why": "still not in Tally"}
	hand("job-hon-4", []any{rel1, rel2})
	if f.n("Import") != 3 {
		t.Fatalf("the new release was not honoured once (%d imports)", f.n("Import"))
	}
	hand("job-hon-4", []any{rel1, rel2})
	if f.n("Import") != 3 {
		t.Fatalf("a release was honoured twice (%d imports)", f.n("Import"))
	}
	if a := acceptedInfo(id); len(strs(a["honoured"])) != 2 || str(a["sentAt"]) == "" || a["sent"] != true {
		t.Fatalf("the note: %v", a)
	}
}

// --- R9. a listener on the bridge's port that is not this program (the old Node bridge): named as such
func TestBridgeStateOtherProgram(t *testing.T) {
	node := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"ok":true,"bridge":"TDSDesk Tally Bridge","version":"1.15.0"}`))
	}))
	t.Cleanup(node.Close)
	port := node.Listener.Addr().(*net.TCPAddr).Port
	if st := bridgeState(port); st != "other" {
		t.Fatalf("a Node bridge on the port reads %q, want other", st)
	}
	local := 0
	code, said := consoleMeasure(measureOpts{company: zz}, "other", nil, nil, func() (M, error) { local++; return M{}, nil })
	if code != 1 || local != 0 || !strings.Contains(said, "another bridge program is on this port") || strings.Contains(said, "try again in a minute") {
		t.Fatalf("other: code %d, local %d, said %q", code, local, said)
	}
}
