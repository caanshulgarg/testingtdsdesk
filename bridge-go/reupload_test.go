package main

// next-bridge-reupload (24-Nov-2026, the owner's rule: an entry that is not really in the books never counts as posted;
// and "dont read from tally" for it). A sales invoice FinCom posted as an Optional voucher was deleted in Tally and posted
// again. FinCom now decides from its own copy of Tally (migration 219, tally_post_copy_resend): the id is released as an
// owner's release and the earlier posting handed back for that entry alone. This bridge already lets such an entry go once
// (the release travels with the posting: releaseFor) and looks for it first (2.5.19's look before a re-sent entry); that
// look took an Optional or cancelled voucher carrying FinCom's mark for the entry. It no longer does. An ordinary new
// posting of the id is still refused on this computer's record (round 15), so a Tally that drops the mark never gets a
// duplicate from it.

import (
	"strings"
	"testing"
	"time"
)

// the stand Tally's entries carrying the mark
func reupTagged(f *standTally, tag string) []*tVch {
	f.mu.Lock()
	defer f.mu.Unlock()
	var out []*tVch
	for _, v := range f.vch {
		if strings.Contains(v.narr, tag) {
			out = append(out, v)
		}
	}
	return out
}

// 2.5.19's look before a re-sent entry: an Optional voucher carrying the mark is not "already posted"
func TestReupResentOptionalNotAlready(t *testing.T) {
	td := today()
	f := newStandTally(t)
	c := newStandCloud(t)
	standBridge(t, f, `,"PostWaitMs":200`+c.cfg())
	v := f.add(td, fgParty, "R-91", "TDSDesk:r91 | posted as Optional, then left", "-91.00")
	v.optional = true
	w := f.add(td, fgParty, "R-92", "TDSDesk:r92 | cancelled", "-92.00")
	w.cancelled = true
	c.mu.Lock()
	c.takeJobs = []M{{"id": "job-reup-e-0001", "company": zz, "payload": M{"vouchers": []any{M{"id": "r91", "xml": finVoucher("r91", fgParty, "R-91", td, "91.00")},
		M{"id": "r92", "xml": finVoucher("r92", fgParty, "R-92", td, "92.00")}}}, "resendOnly": []any{"r91", "r92"}}}
	c.mu.Unlock()
	cloudPostTake()
	time.Sleep(300 * time.Millisecond)
	p := waitJob(t, "job-reup-e-0001")
	if r2519Result(p, "r91", "already") || r2519Result(p, "r92", "already") || len(reupTagged(f, "TDSDesk:r91")) != 2 || len(reupTagged(f, "TDSDesk:r92")) != 2 {
		t.Fatalf("an Optional or cancelled voucher was taken for the entry: %d / %d in Tally, %v", len(reupTagged(f, "TDSDesk:r91")), len(reupTagged(f, "TDSDesk:r92")), p["results"])
	}
}

// the live case end to end on the bridge: posted by this computer from FinCom's queue, left in Tally only as an Optional
// voucher; an ordinary new posting is refused on the record; the earlier posting handed back by FinCom (219: released as an
// owner's release, resendOnly that entry) sends it once
func TestReupHandedBackAfterCopyRelease(t *testing.T) {
	td := today()
	f := newStandTally(t)
	c := newStandCloud(t)
	standBridge(t, f, `,"PostWaitMs":200`+c.cfg())
	x := finVoucher("u1", fgParty, "U-1", td, "41.00")
	take := func(j M) M {
		t.Helper()
		c.mu.Lock()
		c.takeJobs = []M{j}
		c.mu.Unlock()
		cloudPostTake()
		time.Sleep(300 * time.Millisecond)
		return waitJob(t, str(j["id"]))
	}
	take(M{"id": "job-reup-a-0001", "company": zz, "payload": M{"vouchers": []any{M{"id": "u1", "xml": x}}}})
	vs := reupTagged(f, "TDSDesk:u1")
	if len(vs) != 1 {
		t.Fatalf("the first posting: %d in Tally", len(vs))
	}
	f.mu.Lock()
	vs[0].optional = true
	f.mu.Unlock()
	// an ordinary new posting (another job, no release): this computer's record refuses it, nothing asked of Tally
	n0 := f.n(tagCheckID)
	p := take(M{"id": "job-reup-b-0001", "company": zz, "payload": M{"vouchers": []any{M{"id": "u1", "xml": x}}}})
	if !r2519Result(p, "u1", "alreadySent") || len(reupTagged(f, "TDSDesk:u1")) != 1 || f.n(tagCheckID) != n0 {
		t.Fatalf("an ordinary repost: %v (%d in Tally)", p["results"], len(reupTagged(f, "TDSDesk:u1")))
	}
	// handed back by FinCom with the owner's release: sent once
	rel := []any{M{"id": "u1", "at": time.Now().UTC().Format(time.RFC3339), "by": "owner", "why": "FinCom's copy of Tally shows it only as an Optional voucher: posted again"}}
	p = take(M{"id": "job-reup-a-0001", "company": zz, "payload": M{"vouchers": []any{M{"id": "u1", "xml": x}}}, "released": rel, "resendOnly": []any{"u1"}})
	if len(reupTagged(f, "TDSDesk:u1")) != 2 {
		t.Fatalf("handed back with a release, the entry left only as Optional was not sent: %v (%d in Tally)", p["results"], len(reupTagged(f, "TDSDesk:u1")))
	}
	// the same release handed again: not a second time
	p = take(M{"id": "job-reup-a-0001", "company": zz, "payload": M{"vouchers": []any{M{"id": "u1", "xml": x}}}, "released": rel, "resendOnly": []any{"u1"}})
	if len(reupTagged(f, "TDSDesk:u1")) != 2 {
		t.Fatalf("the same release sent it twice: %d in Tally", len(reupTagged(f, "TDSDesk:u1")))
	}
}

// the review of 24-Nov-2026 (B1): a client that posts Optional vouchers by its setting: the entry FinCom sends is itself
// Optional, so an Optional voucher carrying its mark IS that entry: "already", never sent twice. Cancelled is always void
func TestReupOptionalBySettingIsAlready(t *testing.T) {
	td := today()
	f := newStandTally(t)
	c := newStandCloud(t)
	standBridge(t, f, `,"PostWaitMs":200`+c.cfg())
	v := f.add(td, fgParty, "Q-1", "Electricity | TDSDesk:q1", "-41.00")
	v.optional = true
	w := f.add(td, fgParty, "Q-2", "Electricity | TDSDesk:q2", "-42.00")
	w.optional, w.cancelled = true, true
	opt := func(id, no, amt string) string {
		return strings.Replace(finVoucher(id, fgParty, no, td, amt), "<ISOPTIONAL>No</ISOPTIONAL>", "<ISOPTIONAL>Yes</ISOPTIONAL>", 1)
	}
	c.mu.Lock()
	c.takeJobs = []M{{"id": "job-reup-q-0001", "company": zz, "payload": M{"vouchers": []any{M{"id": "q1", "xml": opt("q1", "Q-1", "41.00")}, M{"id": "q2", "xml": opt("q2", "Q-2", "42.00")}}}, "resendOnly": []any{"q1", "q2"}}}
	c.mu.Unlock()
	cloudPostTake()
	time.Sleep(300 * time.Millisecond)
	p := waitJob(t, "job-reup-q-0001")
	if n := len(reupTagged(f, "TDSDesk:q1")); n != 1 || !r2519Result(p, "q1", "already") {
		t.Fatalf("an Optional entry whose Optional voucher is in Tally: %d vouchers carry its mark, %v", n, p["results"])
	}
	if n := len(reupTagged(f, "TDSDesk:q2")); n != 2 {
		t.Fatalf("a cancelled voucher is never the entry, Optional or not: %d vouchers carry its mark", n)
	}
}

// the same in the read back of a part Tally made only partly (post.go readBackTags): an Optional entry is found by its
// Optional voucher; a regular entry never by an Optional one
func TestReupReadBackOptionalBySetting(t *testing.T) {
	td := today()
	f := newStandTally(t)
	standBridge(t, f, "")
	f.add(td, fgParty, "Q-3", "Electricity | TDSDesk:q3", "-43.00").optional = true
	f.add(td, fgParty, "Q-4", "Electricity | TDSDesk:q4", "-44.00").optional = true
	x3 := strings.Replace(finVoucher("q3", fgParty, "Q-3", td, "43.00"), "<ISOPTIONAL>No</ISOPTIONAL>", "<ISOPTIONAL>Yes</ISOPTIONAL>", 1)
	found, _ := readBackTags(f.port, zz, []M{{"id": "q3", "xml": x3}, {"id": "q4", "xml": finVoucher("q4", fgParty, "Q-4", td, "44.00")}}, 0)
	if found["q3"] == nil || found["q4"] != nil {
		t.Fatalf("read back: the Optional entry by its Optional voucher, the regular one never (found %v)", found)
	}
}
