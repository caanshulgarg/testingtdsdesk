package main

// Round 8 (03-Oct-2026): the re-read of adabade..0e039fe, bridge side (R4, R5, R9)

import (
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// --- R4. a held entry of a partial batch is noted on disk: after the job ends failed (another entry) and the cloud frees
// the id, a new job never sends it; once Tally lists its tag it is confirmed
func TestHeldEntryNotedOnDisk(t *testing.T) {
	td := today()
	f := newStandTally(t)
	f.ansi = true
	f.importSkip = func(x string) bool { return strings.Contains(x, "TDSDesk:fb3") }                               // Tally refuses the third of the batch
	f.importAt = func(id, body string) (bool, time.Duration) { return !strings.Contains(body, "TDSDesk:opt1"), 0 } // and the Optional one, on its own
	f.storeNarr = func(n string) string {
		if strings.Contains(n, "TDSDesk:fb2") {
			return f1NoTag(n) // kept without its tag: not found by the day's read
		}
		return n
	}
	f.behave = func(w http.ResponseWriter, r *http.Request, id, body string) bool {
		if id == "FinComByMaster" {
			_, _ = w.Write([]byte("<ENVELOPE><BODY><DATA><COLLECTION></COLLECTION></DATA></BODY></ENVELOPE>"))
			return true
		}
		return false
	}
	standBridge(t, f, `,"PostRecheckMs":200,"PostRecheckTries":1`)
	opt := strings.Replace(finVoucher("opt1", fgParty, "OPT-1", td, "4.00"), "<ISOPTIONAL>No</ISOPTIONAL>", "<ISOPTIONAL>Yes</ISOPTIONAL>", 1)
	vch := []any{
		M{"id": "fb1", "xml": finVoucher("fb1", fgParty, "FB-1", td, "1.00")},
		M{"id": "fb2", "xml": finVoucher("fb2", fgParty, "FB-2", td, "2.00")},
		M{"id": "fb3", "xml": finVoucher("fb3", fgParty, "FB-3", td, "3.00")},
		M{"id": "opt1", "xml": opt},
	}
	if _, err := newPostJob(M{"jobId": "job-held-1", "company": zz, "vouchers": vch}); err != nil {
		t.Fatal(err)
	}
	p := r6Done(t, "job-held-1")
	st := r6States(p)
	if str(p["status"]) != "failed" || st["fb2"] != "unknown" || st["fb3"] != "unknown" || st["opt1"] != "failed" || st["fb1"] != "in_tally" {
		t.Fatalf("the first job: %s %v", p["status"], st)
	}
	imports := f.n("Import")
	for _, k := range []string{"fb2", "fb3"} {
		a := acceptedInfo(k)
		if a == nil || a["held"] != true || str(a["job"]) != "job-held-1" || str(a["acceptedAt"]) == "" || str(a["lastVchId"]) != "" || a["verified"] != false {
			t.Fatalf("the held entry %s is not on disk as held: %v", k, a)
		}
	}
	// the cloud freed the ids; a new job carries fb2 (and fb3): refused, nothing sent
	if _, err := newPostJob(M{"jobId": "job-held-2", "company": zz, "vouchers": []any{vch[1], vch[2]}}); err != nil {
		t.Fatal(err)
	}
	p = r6Done(t, "job-held-2")
	if f.n("Import") != imports {
		t.Fatalf("a new job sent a held entry again (%d imports, had %d)", f.n("Import"), imports)
	}
	st = r6States(p)
	r := obj(arr(p["results"])[0])
	want := "Tally may have made this entry in a batch on " + td + " (job job-held-1) and it is not confirmed yet; being checked, not sent again"
	if st["fb2"] != "unknown" || str(r["message"]) != want || r["ok"] == true {
		t.Fatalf("the new job's result: %v (%v)", r, st)
	}
	if e := obj(arr(p["items"])[0]); str(e["reason"]) != want {
		t.Fatalf("the item the cloud stores: %v", e)
	}
	// Tally lists fb2's tag: confirmed on the next hand-back; fb3 (never made) stays unknown
	f.mu.Lock()
	for _, v := range f.vch {
		if v.no == "FB-2" {
			v.narr = "Electricity | TDSDesk:fb2"
		}
	}
	f.mu.Unlock()
	if _, err := newPostJob(M{"jobId": "job-held-3", "company": zz, "vouchers": []any{vch[1], vch[2]}}); err != nil {
		t.Fatal(err)
	}
	p = r6Done(t, "job-held-3")
	st = r6States(p)
	if f.n("Import") != imports || st["fb2"] != "in_tally" || st["fb3"] != "unknown" {
		t.Fatalf("after Tally listed the tag: %v (%d imports)", st, f.n("Import"))
	}
	if a := acceptedInfo("fb2"); a == nil || a["verified"] != true || str(a["masterId"]) == "" {
		t.Fatalf("the confirmed note: %v", a)
	}
}

// --- R5. the cloud is the single judge of a release: the bridge resends once per release (by its at+id), never again
// for the same release handed back, and once more for a new release after a new acceptance; no clock comparison here
func TestReleaseHonouredOncePerRelease(t *testing.T) {
	f := r6Tally(t, func() bool { return true })
	c := newStandCloud(t)
	standBridge(t, f, c.cfg()+`,"PostRecheckMs":200,"PostRecheckTries":1`)
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
	// a release whose "at" is OLDER than the acceptance (clocks differ): the cloud handed it, so it is in force: one send
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
	// a new release (later at) after the new acceptance: one send
	rel2 := M{"id": id, "at": time.Now().Format(time.RFC3339), "by": "Anshul", "why": "still not in Tally"}
	hand("job-hon-4", []any{rel1, rel2})
	if f.n("Import") != 3 {
		t.Fatalf("the new release was not honoured once (%d imports)", f.n("Import"))
	}
	hand("job-hon-4", []any{rel1, rel2})
	if f.n("Import") != 3 {
		t.Fatalf("a release was honoured twice (%d imports)", f.n("Import"))
	}
	if a := acceptedInfo(id); len(strs(a["honoured"])) != 2 || str(a["acceptedAt"]) == "" {
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
