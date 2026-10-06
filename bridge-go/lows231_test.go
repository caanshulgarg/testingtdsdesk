package main

// Bridge 2.3.1: the deferred Lows of the 2.3.0 reviews (round 1 bridge L2/L3, round 2 L1), each test written first.

import (
	"os"
	"strings"
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

// 2.3.0 round 2 L1: the keeper's end-of-run cleanup released every lease this bridge held, also the lease a posting
// running at the same time holds (the cloud then let another bridge read or post the company mid-posting). It now
// releases only its own (read) leases
func TestKeeperCleanupKeepsPostingLease(t *testing.T) {
	leaseMu.Lock()
	leases["CO POST"], leasePurp["CO POST"] = time.Now().Add(time.Minute), "post"
	leases["CO READ"], leasePurp["CO READ"] = time.Now().Add(time.Minute), "read"
	leaseMu.Unlock()
	t.Cleanup(func() {
		leaseMu.Lock()
		delete(leases, "CO POST")
		delete(leasePurp, "CO POST")
		delete(leases, "CO READ")
		delete(leasePurp, "CO READ")
		leaseMu.Unlock()
	})
	keepReleaseLeases()
	if !leaseHeldHere("CO POST") {
		t.Fatal("the lease a running posting holds is kept")
	}
	if leaseHeldHere("CO READ") {
		t.Fatal("the keeper's own read lease is released")
	}
}

// 2.2.3 review L1: after the 10-minute wait for a MasterID the test goes on without one; a MasterID typed after that was
// refused with "not waiting" and the tray asked again until Cancel. The words now say the wait ended and C, D and E were
// skipped
func TestFetchTestMasterWaitEndedSaysSo(t *testing.T) {
	f := newStandTally(t)
	f.mu.Lock()
	f.behave = fetchTestStand(func(l string) bool { return false }, nil)
	f.mu.Unlock()
	standBridge(t, f, `,"Key":"tray-test-key"`)
	trialOn(t)
	fetchTestReset()
	old := fetchTestMasterWait
	fetchTestMasterWait = 300 * time.Millisecond
	t.Cleanup(func() { fetchTestMasterWait = old })
	callLocal(t, "POST", "/tray/fetchtest", "", `{"company":"ZZ TEST","type":"Receipt","number":"212","date":"05-Oct-2026"}`)
	fetchTestWait(t, "needMaster")
	fetchTestWait(t, "done")
	code, r := callLocal(t, "POST", "/tray/fetchtest", "", `{"masterId":"777"}`)
	if code != 200 || r["ok"] != false || !strings.Contains(str(r["error"]), "stopped waiting") || !strings.Contains(str(r["error"]), "C, D and E were skipped") {
		t.Fatalf("a MasterID after the wait ended: %d %v", code, r)
	}
}

// 2.2.4 review L3: an empty or self-closed <VOUCHER .../> was counted by the text (countVouchers: none) and by the decoder
// (vchNodes: one) differently, so a Day Book holding one read as incomplete. Both now count only a voucher with fields
func TestVoucherCountsAgreeOnEmptyVoucher(t *testing.T) {
	real := `<VOUCHER REMOTEID="g-1" VCHTYPE="Receipt"><GUID>g-1</GUID><DATE>20261002</DATE></VOUCHER>`
	for _, x := range []string{
		`<VOUCHER REMOTEID="g-2" VCHTYPE="Receipt"/>`,
		`<VOUCHER REMOTEID="g-2" VCHTYPE="Receipt"></VOUCHER>`,
		`<VOUCHER REMOTEID="g-2" VCHTYPE="Receipt">  </VOUCHER>`,
		`<VOUCHER/>`,
		`<CMPINFO><VOUCHER>4</VOUCHER></CMPINFO>`,
	} {
		env := `<ENVELOPE><HEADER><VERSION>1</VERSION></HEADER><BODY><DATA><TALLYMESSAGE>` + x + `</TALLYMESSAGE><TALLYMESSAGE>` + real + `</TALLYMESSAGE></DATA></BODY></ENVELOPE>`
		if a, b := countVouchers(env), len(vchNodes(xmlDoc(env))); a != 1 || b != 1 {
			t.Fatalf("%s: the text counts %d, the decoder %d (one real voucher)", x, a, b)
		}
		if w := dayBookIncomplete(env); w != "" {
			t.Fatalf("%s: a complete Day Book: %s", x, w)
		}
	}
}

// 2.3.0 review round 3 L3, the bridge's side (the same pattern as the cloud's parse.js): a self-closed CMPINFO with
// attributes was taken as an opening one, and the counters' drop ran on to the next </CMPINFO> over the vouchers between
func TestDropCmpInfoSelfClosedWithAttributes(t *testing.T) {
	v := `<VOUCHER REMOTEID="g-1"><GUID>g-1</GUID></VOUCHER>`
	for _, x := range []string{`<CMPINFO TYPE="x"/>` + v + `<CMPINFO><VOUCHER>2</VOUCHER></CMPINFO>`, `<CMPINFO/>` + v, `<CMPINFO TYPE="x"><VOUCHER>4</VOUCHER></CMPINFO>` + v} {
		if got := dropCmpInfo(x); !strings.Contains(got, v) || strings.Contains(got, "CMPINFO") {
			t.Fatalf("%s -> %s", x, got)
		}
	}
}
