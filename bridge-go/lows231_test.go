package main

// Bridge 2.3.1: the deferred Lows of the 2.3.0 reviews (round 1 bridge L2/L3, round 2 L1), each test written first.

import (
	"os"
	"testing"
	"time"
)

// 2.3.0 round 1 L2/L3: sync\recorder-guids.json (up to 20,000 MasterIDs a company) was written whole at the end of every
// uploader turn that learnt a GUID. It is now written at most every RecorderGuidsSaveSec (30 s), and when the bridge stops
// (or the record is reloaded); nothing learnt is lost on a clean stop
func TestMidRecordSavedAtMostEveryInterval(t *testing.T) {
	liveBridge(t, "")
	at := time.Date(2026, 10, 6, 10, 0, 0, 0, time.Local)
	nowFn = func() time.Time { return at }
	t.Cleanup(func() { nowFn = time.Now })
	f := sp("recorder-guids.json")
	writes := func() time.Time {
		st, err := os.Stat(f)
		if err != nil {
			return time.Time{}
		}
		return st.ModTime()
	}
	liveMidNote(b220CoGUID, "1", b220CoGUID+"-00000001", "Receipt", "1", "20261002")
	liveMidSaveSoon()
	first := writes()
	if first.IsZero() {
		t.Fatal("the first change is written at once")
	}
	_ = os.Remove(f)
	at = at.Add(5 * time.Second)
	liveMidNote(b220CoGUID, "2", b220CoGUID+"-00000002", "Receipt", "2", "20261002")
	liveMidSaveSoon()
	if !writes().IsZero() {
		t.Fatal("a second change within 30 s is not written yet (the file is not rewritten every turn)")
	}
	at = at.Add(30 * time.Second)
	liveMidSaveSoon()
	if writes().IsZero() {
		t.Fatal("written once 30 s have passed")
	}
	_ = os.Remove(f)
	at = at.Add(time.Second)
	liveMidNote(b220CoGUID, "3", b220CoGUID+"-00000003", "Receipt", "3", "20261002")
	liveMidSaveSoon()
	if !writes().IsZero() {
		t.Fatal("within 30 s again: not written")
	}
	// the bridge stops (or the record is reloaded): what was learnt is written
	liveResetState()
	if writes().IsZero() {
		t.Fatal("written when the bridge stops")
	}
	for _, mid := range []string{"1", "2", "3"} {
		if _, ok := liveMidLookup(b220CoGUID, mid); !ok {
			t.Fatalf("MasterID %s kept over the restart", mid)
		}
	}
}
