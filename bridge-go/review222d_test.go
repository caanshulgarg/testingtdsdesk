package main

// Bridge 2.2.2, the second-round review of 4dc55ef..cbca321 (05-Oct-2026): four Lows, one test each, written before
// the fix.

import (
	"errors"
	"strings"
	"sync"
	"testing"
	"time"
)

// --- L-A: a background read already waiting for the Tally lock when a recorder read is stopped is not sent into the
// busy Tally once it gets the lock
func TestR222dQueuedCopierHeldAfterStop(t *testing.T) {
	_, f, _ := r222bBridge(t, "")
	f.mu.Lock()
	f.slow = func(id, body string) time.Duration {
		if id == "TDSDeskNames" {
			return 1500 * time.Millisecond
		}
		return 0
	}
	f.mu.Unlock()
	var wg sync.WaitGroup
	wg.Add(2)
	go func() { defer wg.Done(); _, _ = getLedgerNames(&TC{copier: true, person: true}, nwsCo, f.port) }()
	time.Sleep(300 * time.Millisecond)
	var err error
	go func() {
		defer wg.Done()
		_, err = fetchVouchersByMasterIn(recorderTC(nil), nwsCo, f.port, "20261005", []string{"26312"}, 10)
	}()
	time.Sleep(300 * time.Millisecond)
	retryNote(f.port, vchByMasterID, errRecorderStop) // a recorder read was stopped meanwhile (2.3.1: the retry schedule)
	wg.Wait()
	if !errors.Is(err, errRetryWait) || f.n(vchByMasterID) != 0 {
		t.Fatalf("the queued background read went into the busy Tally: %v (%d requests)", err, f.n(vchByMasterID))
	}
}

// --- L-B: the light company check and the open-company list are not held by the cool-down after a stop
func TestR222dLightCheckNotHeldByStop(t *testing.T) {
	f := newStandTally(t)
	standBridge(t, f, "")
	bgMu.Lock()
	stopHold[f.port] = nowFn().Add(time.Hour)
	bgMu.Unlock()
	n0, c0 := f.n("FinComCompany"), f.n("TDSDeskCompanies")
	lightCheckOpen(openCompaniesWith(fin, true))
	if f.n("FinComCompany") == n0 || f.n("TDSDeskCompanies") == c0 {
		t.Fatalf("the light check was held by the cool-down: %v", f.ids())
	}
	if logLines("gave way to a posting") != 0 {
		t.Fatal("the log says it gave way to a posting")
	}
}

// --- L-C (bridge): a FinCom id moved to lineFid is not sent in the narration either (the cloud would take it from
// there); an oversize line carries no object_guid and no tag
func TestR222dNoTagWhenLineFid(t *testing.T) {
	p, f, c := r222bBridge(t, "")
	src := r222Vch(f, 25414, "Journal", "J-10", "20261005", 51986)
	src.narr = "TDSDesk:fin9 | rent"
	nv := r222Vch(f, 25683, "Journal", "J-55", "20261005", 54500)
	nv.narr = "TDSDesk:fin9 | rent"
	big := r222Vch(f, 25971, "Journal", "J-99", "20261005", 54571)
	big.narr = "TDSDesk:fin7 | " + strings.Repeat("n", liveMaxBytes+10)
	liveAppend(t, p,
		r222Line("voucher_accept_pre", "13:00", src.guid, "25414", "51986", "Journal", "J-55", "5-Oct-2026", "TDSDesk:fin9 | rent"),
		r222Line("voucher_accept_post", "13:00", src.guid, "25683", "51986", "Journal", "J-55", "5-Oct-2026", "TDSDesk:fin9 | rent"),
		r222Line("voucher_accept_post", "13:01", big.guid, "25971", "54560", "Journal", "J-99", "5-Oct-2026", "TDSDesk:fin7 | big"))
	readAndUploadAll(t)
	s := r222bSent(c, "J-55")
	if len(s) != 1 || str(s[0]["lineFid"]) != "fin9" || str(s[0]["fid"]) != "" || strings.Contains(str(s[0]["narration"]), "TDSDesk:") || str(s[0]["object_guid"]) != nv.guid {
		t.Fatalf("the copied entry: %s", cut(jsonText(s), 600))
	}
	b := r222bSent(c, "J-99")
	if len(b) != 1 || b[0]["oversize"] != true || str(b[0]["object_guid"]) != "" || str(b[0]["fid"]) != "" || strings.Contains(str(b[0]["narration"]), "TDSDesk:") {
		t.Fatalf("the oversize line: %s", cut(jsonText(b), 600))
	}
}

// --- L-D: the FinCom-import exemption only for a GUID Tally made for that MasterID; an import with another GUID is
// fetched
func TestR222dImportExemptOnlyOwnGUID(t *testing.T) {
	p, f, c := r222bBridge(t, "")
	foreign := "9a9a9a9a-1111-2222-3333-444444444444-00001234"
	f.mu.Lock()
	f.vch = append(f.vch, &tVch{guid: foreign, master: "26500", date: "20261005", typ: "Journal", no: "J-400", narr: "Bill | TDSDesk:fp2", party: "Customer A",
		alter: 54700, lines: [][2]string{{"Customer A", "1.00"}, {"Bank", "-1.00"}}})
	f.mu.Unlock()
	liveAppend(t, p,
		r222Line("import_object", "13:10", foreign, "26500", "54700", "Journal", "J-400", "5-Oct-2026", "Bill | TDSDesk:fp2"),
		r222Line("after_import_object", "13:10", foreign, "26500", "54700", "Journal", "J-400", "5-Oct-2026", "Bill | TDSDesk:fp2"))
	readAndUploadAll(t)
	s := r222bSent(c, "J-400")
	if f.n(vchByMasterID) != 1 || len(s) != 1 || str(s[0]["xml"]) == "" || str(s[0]["object_guid"]) != foreign || str(s[0]["fid"]) != "fp2" {
		t.Fatalf("an import with a GUID Tally did not make for that MasterID: %v (%v)", s, f.ids())
	}
}
