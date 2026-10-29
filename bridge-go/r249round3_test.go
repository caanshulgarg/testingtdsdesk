package main

// 2.4.9 review round 3 (docs/reviews/review-249-round3.md, range f447764ca..e65d62471): each finding's test, written
// before its fix

import (
	"strings"
	"testing"
	"time"
)

// the stopped group's own goroutines (the abandoned request, the retry schedule's lift) done before a test's cleanup
// (round 3 L2: -race clean)
func r3Settle() {
	for end := time.Now().Add(10 * time.Second); earlierBusyAny() && time.Now().Before(end); {
		time.Sleep(50 * time.Millisecond)
	}
	time.Sleep(300 * time.Millisecond)
	retryMu.Lock() // retryLift's own lock, taken after it: what it read happened before this test's cleanup
	retryMu.Unlock()
}

// M1: TallyAbandonMaxSec 0 (the request closed at the stop: Tally's end cannot be watched): a group's stop stops the
// company's period, as 2.4.8 did for any stop
func TestR249R3StopWithAbandonZeroStopsCompany(t *testing.T) {
	f, c, _ := pullBridgeWith(t, `,"TallyAbandonMaxSec":0`)
	stops := r1Stops(c)
	pullDay(f, "20250915", 1000, "Sales", "Sales", "Sales", "Sales", "Sales", "Sales")
	f.mu.Lock()
	f.slow = func(id, body string) time.Duration {
		if id == vchBatchID {
			return 3 * time.Second
		}
		return 0
	}
	f.mu.Unlock()
	applyPeriodDays(pullList("20250915"))
	pullRun(t, 10)
	r3Settle()
	if len(batchBodies(f)) != 1 || len(*stops) != 1 || str((*stops)[0]["why"]) != "over2s" {
		t.Fatalf("groups %d, stops %v", len(batchBodies(f)), *stops)
	}
}

// L1: a FETCH other than the approved one: no group is built and the day is read one by one (not stalled)
func TestR249R3FetchMismatchOneByOne(t *testing.T) {
	f, _, m := pullBridgeWith(t, "")
	pullDay(f, "20250915", 1000, "Sales", "Sales", "Sales", "Sales")
	old := batchFetchText
	t.Cleanup(func() { batchFetchText = old })
	batchFetchText = old + ", ADDRESS"
	applyPeriodDays(pullList("20250915"))
	pullRun(t, 30)
	if len(batchBodies(f)) != 0 || f.n(vchObjectID) != 4 || len(sentEntries(m)) != 4 {
		t.Fatalf("groups %d, one by one %d, sent %d", len(batchBodies(f)), f.n(vchObjectID), len(sentEntries(m)))
	}
}

// L3: the wait for Tally to end a stopped group is bounded by 60 s whatever TallyAbandonWaitSec says, and ends when the
// bridge stops
func TestR249R3AwaitBounded(t *testing.T) {
	if b := pullAwaitBound(10 * time.Minute); b != time.Minute {
		t.Fatalf("bound %v", b)
	}
	if b := pullAwaitBound(20 * time.Second); b != 20*time.Second {
		t.Fatalf("bound %v", b)
	}
	earlierMu.Lock()
	s := &abandonSlot{done: make(chan struct{})}
	earlier[44444] = s
	earlierMu.Unlock()
	t.Cleanup(func() { earlierMu.Lock(); delete(earlier, 44444); earlierMu.Unlock() })
	old := pullStoppingFn
	pullStoppingFn = func() bool { return true }
	t.Cleanup(func() { pullStoppingFn = old })
	t0 := time.Now()
	pullAwaitEarlier(44444, time.Minute)
	if time.Since(t0) > time.Second {
		t.Fatalf("waited %v while the bridge stops", time.Since(t0))
	}
}

// L4: the size a company came down to holds for the period as chosen; chosen again in FinCom: groups of 100 again
func TestR249R3SlowSizeEndsWithAnotherChoice(t *testing.T) {
	it := pullItem{Company: zz, CGUID: b220CoGUID, Day: "20250915", ChosenAt: "2026-10-21T09:00:00Z"}
	pullReset()
	t.Cleanup(pullReset)
	pullBatchCoSet(it, 1)
	if pullBatchCo(it) != 1 {
		t.Fatal("not kept")
	}
	it2 := it
	it2.Day = "20250916"
	if pullBatchCo(it2) != 1 {
		t.Fatal("not kept for the next day")
	}
	it2.ChosenAt = "2026-10-22T09:00:00Z"
	if pullBatchCo(it2) != 0 {
		t.Fatal("kept after the period was chosen again")
	}
}

// round 2 M3 / round 3 L5, as far as the gate shows: a GST line the group gives with no nature, no taxability and no
// type of supply is taken only because FinComVoucherObject gives the same then (gate-3.0.zip: no such line differs);
// a line with a nature and the tag left out is left (TestR249GroupLeavesWhatItGivesOtherwise)
func TestR249R3NoNatureLineAsGate(t *testing.T) {
	v := `<VOUCHER><GUID>g</GUID><ALLLEDGERENTRIES.LIST><LEDGERNAME>Sales</LEDGERNAME><AMOUNT>100</AMOUNT><GSTOVRDNTYPEOFSUPPLY></GSTOVRDNTYPEOFSUPPLY></ALLLEDGERENTRIES.LIST></VOUCHER>`
	if k, _ := batchTOSLines(v); len(k) != 0 {
		t.Fatalf("%v", k)
	}
	if k, _ := batchTOSLines(strings.Replace(v, "<AMOUNT>", "<GSTOVRDNTAXABILITY>Taxable</GSTOVRDNTAXABILITY><AMOUNT>", 1)); len(k) != 1 {
		t.Fatalf("a taxable line without a type of supply: %v", k)
	}
}
