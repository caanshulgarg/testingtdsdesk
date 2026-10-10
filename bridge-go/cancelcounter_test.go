package main

// Re-review M-B (06-Oct-2026): a cancel this bridge's Tally showed, sent without an AlterID, carries Tally's voucher
// counter (ALTVCHID) read then with the existing FinComCompany request (no new or changed request): FinCom cancels again
// only a body at or below it (migration 57). A delete never carries one (no bound: always deleted again). Test written
// before the code.

import (
	"testing"
)

func TestCancelCounterOnLine(t *testing.T) {
	_, f, _ := led231Bridge(t)
	f.mu.Lock()
	f.alter = 777
	f.mu.Unlock()
	can := &change{company: zz, companyGuid: b220CoGUID, event: "cancelled", guid: b220CoGUID + "-00000063", lineId: "C1", source: "addon", masterId: "99", saveMs: -1}
	del := &change{company: zz, companyGuid: b220CoGUID, event: "deleted", guid: b220CoGUID + "-00000064", lineId: "D1", source: "addon", masterId: "100", saveMs: -1}
	withAlter := &change{company: zz, companyGuid: b220CoGUID, event: "cancelled", guid: b220CoGUID + "-00000065", alterId: "12", lineId: "C2", source: "addon", masterId: "101", saveMs: -1}
	n0 := f.n(cnReportID) + f.n("FinComCompany")
	liveCancelCounters(bgCompaniesTC(), zz, f.port, []*change{can, del, withAlter})
	if f.n(cnReportID)+f.n("FinComCompany") != n0+1 {
		t.Fatalf("FinComCompany asked %d times (want once for the group)", f.n(cnReportID)+f.n("FinComCompany")-n0)
	}
	if m := can.wire(); toI64(m["vch_counter"]) != 777 {
		t.Fatalf("the cancel without an AlterID: vch_counter %v (want Tally's 777)", m["vch_counter"])
	}
	if m := del.wire(); m["vch_counter"] != nil {
		t.Fatalf("a delete carries a counter: %v", m["vch_counter"])
	}
	if m := withAlter.wire(); m["vch_counter"] != nil {
		t.Fatalf("a cancel with its own AlterID carries a counter: %v", m["vch_counter"])
	}
	// nothing to ask for: Tally not asked
	n1 := f.n("FinComCompany")
	liveCancelCounters(bgCompaniesTC(), zz, f.port, []*change{del, withAlter})
	if f.n("FinComCompany") != n1 {
		t.Fatal("FinComCompany asked with no cancel needing it")
	}
}
