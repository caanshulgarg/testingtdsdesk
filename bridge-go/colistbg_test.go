package main

// Review M1 (06-Oct-2026): every background ask of the company list (TDSDeskCompanies) goes through bgCompaniesTC (the
// 2-second hard stop) and its back-off (coListHeld): the ledger-changes check (ledchanges.go ledOwnPort), the recorder's
// body fetch (recorder_live.go), its resolve of held lines and its GUID ask (recorder_resolve.go, recorder_guids.go).
// A person's actions (Update now, Test connection, postings) are unchanged. Test written before the code (the
// reviewer's probe: one ledChangesCheck waited 7.3 s).

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func colistSlow(f *standTally) {
	f.mu.Lock()
	f.slow = func(id, body string) time.Duration {
		if id == "TDSDeskCompanies" {
			return 3307 * time.Millisecond
		}
		return 0
	}
	f.mu.Unlock()
}

func colistStale() {
	old := time.Now().Add(-5 * time.Minute)
	_ = os.Chtimes(filepath.Join(syncDir(), "open-companies.json"), old, old)
	coMu.Lock()
	coCacheAt = old
	coMu.Unlock()
}

// during the back-off: the company list is not asked at all; the companies named last time stand
func TestColistBgLedgerChangesHeldOff(t *testing.T) {
	_, f, c := led231Bridge(t)
	t.Cleanup(coListReset)
	led231Alter(f, "Customer A", func(l *tLed) { l.gstin = "27AAACA1234B1Z5" })
	led231Numbers(t, f)
	openCompaniesWith(fin, true) // a look before (the light check's, a person's): the companies named last time
	coListMu.Lock()
	coListN, coListUntil = 1, time.Now().Add(5*time.Minute)
	coListMu.Unlock()
	colistStale()
	colistSlow(f)
	n0 := f.n("TDSDeskCompanies")
	t0 := time.Now()
	n, err := ledChangesCheck(zz)
	took := time.Since(t0)
	if f.n("TDSDeskCompanies") != n0 {
		t.Fatalf("the ledger-changes check asked the company list during the back-off (%d asks, %s)", f.n("TDSDeskCompanies")-n0, took)
	}
	if err != nil || n != 1 || len(c.ledChanges) != 1 {
		t.Fatalf("the ledger changes did not go with the companies named last time: %d %v %d", n, err, len(c.ledChanges))
	}
}

// not backed off, the list stale and slow: asked under the 2 s hard stop (not its 3.3 s), and the stop backs the list off.
// Timed against the same check with a list that answers at once (the stand's other waits are the same in both)
func TestColistBgLedgerChangesTwoSecondStop(t *testing.T) {
	_, f, _ := led231Bridge(t)
	t.Cleanup(coListReset)
	coListReset()
	led231Alter(f, "Customer A", func(l *tLed) { l.gstin = "27AAACA1234B1Z5" })
	led231Numbers(t, f)
	colistStale()
	t0 := time.Now()
	_, _ = ledChangesCheck(zz)
	base := time.Since(t0)
	led231Alter(f, "Supplier B", func(l *tLed) { l.gstin = "29AABCS1111C1Z1" })
	led231Numbers(t, f)
	colistStale()
	colistSlow(f)
	n0 := f.n("TDSDeskCompanies")
	t0 = time.Now()
	_, _ = ledChangesCheck(zz)
	took := time.Since(t0)
	if f.n("TDSDeskCompanies") == n0 {
		t.Fatal("the stale list was not asked")
	}
	if took-base > 2800*time.Millisecond {
		t.Fatalf("the background company list was waited for %s more than an answer at once (no 2 s stop)", took-base)
	}
	if !coListHeld() {
		t.Fatal("a stopped background ask of the company list did not back it off")
	}
}
