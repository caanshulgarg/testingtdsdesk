// The final review of 2.3.0 (05-Oct-2026), on the stand-in Tally and a stand-in cloud.
//
// H1. "Not in Tally - post again": both reads are one-day reads and FinCom's voucher types number automatically, so an
//
//	empty answer from Tally is never "not found": "notseen" (the owner's rule: a duplicate entry must never be possible
//	from this button); a person confirms "not there" before anything is sent again.
//
// M1. The re-send after "not found" sends ONLY the released entries the cloud names (resendOnly), with the job's local
//
//	record (done or failed) and without it (L2): never the whole job again.
//
// M4. At most 5 checks a turn, and none while a posting is going on.
package main

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

const renumberWords = "FinCom cannot see other dates, so a person must confirm"

// H1: number B-90 sent; Tally keeps the entry as B-91 (its own numbering). Without Tally's id: unable (never not found);
// with it: found through the id
func TestCheckRenumberedNeverNotFound(t *testing.T) {
	td := today()
	f := newStandTally(t)
	v := f.add(td, fgParty, "B-91", "TDSDesk:k11 | Electricity", "-10.00")
	c := newStandCloud(t)
	standBridge(t, f, c.cfg())
	x := finVoucher("k11", fgParty, "B-90", td, "10.00")
	c.mu.Lock()
	c.checks = []M{checkFor("41", "job-k11", "k11", zz, x)}
	c.mu.Unlock()
	cloudPostTake()
	r := lastReport(t, c)
	if str(r["result"]) != "notseen" || !strings.Contains(str(r["words"]), renumberWords) || !strings.Contains(str(r["words"]), "TDSDesk:k11") || !strings.Contains(str(r["words"]), "I looked in Tally: not there") {
		t.Fatalf("renumbered, no Tally id: %v", r)
	}
	ck := checkFor("42", "job-k11", "k11", zz, x)
	ck["vchId"] = v.master
	c.mu.Lock()
	c.checks = []M{ck}
	c.mu.Unlock()
	cloudPostTake()
	if r := lastReport(t, c); str(r["result"]) != "found" || str(r["master"]) != v.master || str(r["vch"]) != "B-91" {
		t.Fatalf("renumbered, Tally's id known: %v", r)
	}
	if f.n("Import") != 0 {
		t.Fatal("sent to Tally")
	}
	checkReadsOnly(t, f)
}

// H1 + the owner's rule for the by-id read: FinComVoucherByMaster always asks one day (the entry's date as the period, as
// the owner approved it), so an empty answer by id never proves "not found" (the entry may have been redated): unable;
// both one-voucher reads, nothing else
func TestCheckIdKnownAbsentNotFound(t *testing.T) {
	td := today()
	f := newStandTally(t)
	f.add(td, "Other Party", "Z-3", "TDSDesk:zz1 | an earlier entry", "-1.00")
	c := newStandCloud(t)
	standBridge(t, f, c.cfg())
	ck := checkFor("43", "job-k12", "k12", zz, finVoucher("k12", fgParty, "B-92", td, "10.00"))
	ck["vchId"] = "999"
	c.mu.Lock()
	c.checks = []M{ck}
	c.mu.Unlock()
	cloudPostTake()
	if r := lastReport(t, c); str(r["result"]) != "notseen" || !strings.Contains(str(r["words"]), "TDSDesk:k12") {
		t.Fatalf("id known, absent on that day: %v", r)
	}
	if f.n(vchByNumberID) != 1 || f.n(vchObjectID) != 1 || f.n("Import") != 0 {
		t.Fatalf("the requests: %v", f.ids())
	}
	checkReadsOnly(t, f)
}

// H1: the posting's result recorded the number Tally gave (vchNumber): the same as the one sent proves Tally kept it,
// so an empty by-number answer is "not found"; another number proves nothing (unable)
func TestCheckNumberKeptProven(t *testing.T) {
	td := today()
	f := newStandTally(t)
	f.add(td, "Other Party", "Z-4", "TDSDesk:zz2 | an earlier entry", "-1.00")
	c := newStandCloud(t)
	standBridge(t, f, c.cfg())
	x := finVoucher("k13", fgParty, "B-93", td, "10.00")
	ck := checkFor("44", "job-k13", "k13", zz, x)
	ck["vchNumber"] = "B-93"
	c.mu.Lock()
	c.checks = []M{ck}
	c.mu.Unlock()
	cloudPostTake()
	if r := lastReport(t, c); str(r["result"]) != "notseen" {
		t.Fatalf("the number kept, proven (still one day only): %v", r)
	}
	ck2 := checkFor("45", "job-k13", "k13", zz, x)
	ck2["vchNumber"] = "B-94"
	c.mu.Lock()
	c.checks = []M{ck2}
	c.mu.Unlock()
	cloudPostTake()
	if r := lastReport(t, c); str(r["result"]) != "notseen" || !strings.Contains(str(r["words"]), renumberWords) {
		t.Fatalf("another number: %v", r)
	}
}

// M4: at most 5 checks a turn; none while a posting is going on (postings first)
func TestChecksFivePerTurnNotDuringPosting(t *testing.T) {
	td := today()
	f := newStandTally(t)
	c := newStandCloud(t)
	standBridge(t, f, c.cfg())
	var cs []M
	for i := 0; i < 7; i++ {
		cs = append(cs, checkFor(fmt.Sprint(50+i), fmt.Sprintf("job-m4-%d", i), fmt.Sprintf("m4e%d", i), zz, finVoucher(fmt.Sprintf("m4e%d", i), fgParty, "", td, "10.00")))
	}
	c.mu.Lock()
	c.checks = cs
	c.mu.Unlock()
	cloudPostTake()
	c.mu.Lock()
	n := len(c.checkReports)
	c.mu.Unlock()
	if n != 5 {
		t.Fatalf("checks answered in one turn: %d (want 5)", n)
	}
	jobsMu.Lock()
	jobsRunning["job-m4-going"] = true
	jobsMu.Unlock()
	defer func() { jobsMu.Lock(); delete(jobsRunning, "job-m4-going"); jobsMu.Unlock() }()
	before := len(f.ids())
	cloudPostTake()
	c.mu.Lock()
	n2 := len(c.checkReports)
	c.mu.Unlock()
	if n2 != n {
		t.Fatalf("a check was answered while a posting was going on: %d -> %d", n, n2)
	}
	for _, id := range f.ids()[before:] {
		if id == vchByNumberID || id == vchObjectID {
			t.Fatalf("Tally was asked for a voucher during a posting: %v", f.ids()[before:])
		}
	}
}

// M1 / L2: the cloud hands a posting back after "not found" with resendOnly: only those entries go, whether this
// computer still has the job's record (done; failed) or not
func TestResendOnlyReleasedEntries(t *testing.T) {
	td := today()
	f := newStandTally(t)
	c := newStandCloud(t)
	standBridge(t, f, `,"PostWaitMs":200`+c.cfg())
	rel := func(id string) []any {
		return []any{M{"id": id, "at": time.Now().UTC().Format(time.RFC3339), "by": "owner", "why": "not in Tally (checked by the bridge)"}}
	}
	take := func(j M) {
		c.mu.Lock()
		c.takeJobs = []M{j}
		c.mu.Unlock()
		cloudPostTake()
		time.Sleep(300 * time.Millisecond)
		waitJob(t, str(j["id"]))
	}
	// (a) no record of the job on this computer: only the released entry is sent
	va := []any{M{"id": "r23", "xml": finVoucher("r23", fgParty, "R-23", td, "23.00")}, M{"id": "r24", "xml": finVoucher("r24", fgParty, "R-24", td, "24.00")}}
	take(M{"id": "job-r2-000001", "company": zz, "payload": M{"vouchers": va}, "released": rel("r24"), "resendOnly": []any{"r24"}})
	if f.tagged("TDSDesk:r23") != 0 || f.tagged("TDSDesk:r24") != 1 {
		t.Fatalf("no record: r23 %d, r24 %d in Tally (only r24 may go)", f.tagged("TDSDesk:r23"), f.tagged("TDSDesk:r24"))
	}
	// (b) the job failed here (Tally refused both): only the released one goes again
	f.mu.Lock()
	f.importSkip = func(x string) bool { return true }
	f.mu.Unlock()
	vb := []any{M{"id": "r25", "xml": finVoucher("r25", fgParty, "R-25", td, "25.00")}, M{"id": "r26", "xml": finVoucher("r26", fgParty, "R-26", td, "26.00")}}
	if _, err := newPostJob(M{"jobId": "job-r3-000001", "company": zz, "vouchers": vb}); err != nil {
		t.Fatal(err)
	}
	if p := waitJob(t, "job-r3-000001"); str(p["status"]) != "failed" {
		t.Fatalf("the first send: %v %q", p["status"], p["message"])
	}
	f.mu.Lock()
	f.importSkip = nil
	f.mu.Unlock()
	take(M{"id": "job-r3-000001", "company": zz, "payload": M{"vouchers": vb}, "released": rel("r26"), "resendOnly": []any{"r26"}})
	if f.tagged("TDSDesk:r25") != 0 || f.tagged("TDSDesk:r26") != 1 {
		t.Fatalf("failed here: r25 %d, r26 %d in Tally (only r26 may go)", f.tagged("TDSDesk:r25"), f.tagged("TDSDesk:r26"))
	}
	// (c) done here: only the released one goes again
	vc := []any{M{"id": "r27", "xml": finVoucher("r27", fgParty, "R-27", td, "27.00")}, M{"id": "r28", "xml": finVoucher("r28", fgParty, "R-28", td, "28.00")}}
	if _, err := newPostJob(M{"jobId": "job-r4-000001", "company": zz, "vouchers": vc}); err != nil {
		t.Fatal(err)
	}
	if p := waitJob(t, "job-r4-000001"); str(p["status"]) != "done" {
		t.Fatalf("the first send: %v %q", p["status"], p["message"])
	}
	f.mu.Lock()
	kept := f.vch[:0]
	for _, v := range f.vch {
		if !hasTag(v.narr, "TDSDesk:r28") {
			kept = append(kept, v)
		}
	}
	f.vch = kept // r28 deleted in Tally by hand
	f.mu.Unlock()
	take(M{"id": "job-r4-000001", "company": zz, "payload": M{"vouchers": vc}, "released": rel("r28"), "resendOnly": []any{"r28"}})
	if f.tagged("TDSDesk:r27") != 1 || f.tagged("TDSDesk:r28") != 1 {
		t.Fatalf("done here: r27 %d, r28 %d in Tally", f.tagged("TDSDesk:r27"), f.tagged("TDSDesk:r28"))
	}
}

// M3: the member's FinCom page hands this bridge a NEW computer key (its old one shared with another Windows user's
// bridge): before anything else, the bridge asks FinCom with the new key, the old one in its body, to move its identity
// (only a program holding both keys can); a first link, or the same key again, asks nothing
func TestCloudLinkMovesItself(t *testing.T) {
	f := newStandTally(t)
	c := newStandCloud(t)
	standBridge(t, f, c.cfg())
	oldKey, newKey := "fcd_"+strings.Repeat("0", 48), "fcd_"+strings.Repeat("1", 48)
	ff := filepath.Join(t.TempDir(), "fake.json") // the stand cloud's 127.0.0.1 address is accepted only for a stand-in
	_ = os.WriteFile(ff, []byte("{}"), 0o644)
	t.Setenv("TDSBRIDGE_FAKE", ff)
	if _, err := setCloudLink(M{"url": c.srv.URL + "/", "key": newKey}); err != nil {
		t.Fatal(err)
	}
	c.mu.Lock()
	kinds, keys, raw := append([]string{}, c.kinds...), append([]string{}, c.devKeys...), append([]string{}, c.raw...)
	c.mu.Unlock()
	i := -1
	for n, k := range kinds {
		if k == "own_key" {
			i = n
			break
		}
	}
	if i < 0 || keys[i] != newKey || str(parseObj(raw[i])["oldKey"]) != oldKey || str(obj(parseObj(raw[i])["bridge"])["id"]) != myBridgeID() {
		t.Fatalf("own_key not asked with the new key and the old one: %v", kinds)
	}
	for _, k := range kinds[:i] {
		if k == "hello" {
			t.Fatalf("hello went before own_key (the new key would refuse the id): %v", kinds)
		}
	}
	if cloudKey() != newKey {
		t.Fatal("the new key is not kept")
	}
	n := len(kinds)
	if _, err := setCloudLink(M{"url": c.srv.URL + "/", "key": newKey}); err != nil {
		t.Fatal(err)
	}
	c.mu.Lock()
	again := append([]string{}, c.kinds[n:]...)
	c.mu.Unlock()
	for _, k := range again {
		if k == "own_key" {
			t.Fatalf("the same key again asked to move: %v", again)
		}
	}
}

// the redated entry: Tally keeps it (with its FinCom id) on another day; the by-id read asks the entry's own day and
// gets nothing: never "not found" (unable, in words); nothing sent
func TestCheckRedatedNeverNotFound(t *testing.T) {
	td := today()
	f := newStandTally(t)
	v := f.add(addDays(td, -1), fgParty, "", "TDSDesk:k14 | Electricity", "-10.00") // redated by hand in Tally
	c := newStandCloud(t)
	standBridge(t, f, c.cfg())
	for i, no := range []string{"", "B-95"} {
		ck := checkFor(fmt.Sprint(46+i), "job-k14", "k14", zz, finVoucher("k14", fgParty, no, td, "10.00"))
		ck["vchId"] = v.master
		c.mu.Lock()
		c.checks = []M{ck}
		c.mu.Unlock()
		cloudPostTake()
		if r := lastReport(t, c); str(r["result"]) == "notfound" || (str(r["result"]) != "notseen" && str(r["result"]) != "found") {
			t.Fatalf("redated (number %q): %v", no, r)
		}
	}
	if f.n("Import") != 0 {
		t.Fatal("sent to Tally")
	}
	checkReadsOnly(t, f)
}
