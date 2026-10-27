package main

// Fixes from the code review of f21b29f..HEAD: a refused or held request never marks a ledger as hanging Tally;
// FinCom's ledger lists skip the ledgers that hang Tally; a ledger's entries from the copy include item invoices'
// ledgers; the silence stop counts only Tally not answering requests being sent; the measuring tool never stops reading.

import (
	"fmt"
	"net/http"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

// one pass of the ledger-list round, as a run's step makes it
func ledRound(t *testing.T, k *keepRun, port int) error {
	t.Helper()
	dir := syncFolder(zz)
	st := readKeepState(dir)
	save := func() { saveKeepState(dir, st) }
	_, err := k.ledgerList(zz, port, dir, st, func() bool { return true }, save)
	save()
	return err
}

func TestPoisonNotMarkedWhenRefused(t *testing.T) {
	f := ledgerTally(t, 40, `,"LedgerChunk":8,"LedgerChunkMin":4`)
	dir := syncFolder(zz)
	sizeOK := func(what string) {
		t.Helper()
		st := readKeepState(dir)
		if p := poisonMids(st); len(p) > 0 {
			t.Fatalf("%s: ledger(s) %v marked as hanging Tally though no request to them went unanswered", what, p)
		}
		if ls := obj(st["led"]); ls != nil && toInt(ls["size"]) < 8 {
			t.Fatalf("%s: the chunk was halved to %d for a request never sent", what, toInt(ls["size"]))
		}
	}
	// (a) reading stopped in the middle of the list
	var n, late atomic.Int32
	f.mu.Lock()
	f.behave = func(w http.ResponseWriter, r *http.Request, id, body string) bool {
		if id == ledListID && readStopped() {
			late.Add(1)
		}
		if id == ledListID && n.Add(1) == 3 {
			setReadStop("fincom", "test: stopped from FinCom in the middle of the ledger list")
		}
		return false
	}
	f.mu.Unlock()
	k := newRun("now", "refused")
	for i := 0; i < 20; i++ {
		_ = ledRound(t, k, f.port)
	}
	sizeOK("reading stopped")
	if n.Load() < 3 || late.Load() != 0 {
		t.Fatalf("%d chunk requests, %d of them after reading stopped (want none after)", n.Load(), late.Load())
	}
	clearReadStop("fincom-lifted")
	// (b) Tally did not answer a moment ago: requests are held (nothing sent) until the small check may go
	f.mu.Lock()
	f.behave = nil
	f.mu.Unlock()
	setProbeAfterTimeout(f.port)
	n0 := f.n(ledListID)
	k2 := newRun("now", "held")
	for i := 0; i < 20; i++ {
		_ = ledRound(t, k2, f.port)
	}
	sizeOK("held after a timeout")
	if f.n(ledListID) != n0 {
		t.Fatal("a chunk went while requests are held")
	}
}

func TestLedgerChunksSkipPoison(t *testing.T) {
	const poison = 13
	f := ledgerTally(t, 40, `,"LedgerChunk":8`)
	dir := syncFolder(zz)
	st := readKeepState(dir)
	st["ledPoison"] = []any{[]any{poison, "Party 00013", "this ledger does not answer and holds Tally"}}
	saveKeepState(dir, st)
	f.mu.Lock()
	f.behave = func(w http.ResponseWriter, r *http.Request, id, body string) bool {
		if id != "TDSDeskNames" && id != "TDSDeskLedgers" && id != ledListID {
			return false
		}
		var after, upto int64 = 0, 1 << 62
		if m := reMidRange.FindStringSubmatch(body); m != nil {
			after = toI64(m[1])
			if m[2] != "" {
				upto = toI64(m[2])
			}
		}
		if poison > after && poison <= upto {
			t.Errorf("%s asked for the ledger that hangs Tally (MasterID %d-%d)", id, after, upto)
			<-r.Context().Done()
			return true
		}
		var b strings.Builder
		b.WriteString("<ENVELOPE><BODY><DATA><COLLECTION>")
		for _, l := range f.led {
			if l.mid > after && l.mid <= upto {
				fmt.Fprintf(&b, `<LEDGER NAME="%s"><NAME>%s</NAME><PARENT>%s</PARENT><GUID>%s</GUID></LEDGER>`, esc(l.name), esc(l.name), esc(l.parent), l.guid)
			}
		}
		b.WriteString("</COLLECTION></DATA></BODY></ENVELOPE>")
		_, _ = w.Write([]byte(b.String()))
		return true
	}
	f.mu.Unlock()
	for name, get := range map[string]func() (M, error){
		"/ledgernames": func() (M, error) { return getLedgerNames(fin, zz, f.port) },
		"/ledgers":     func() (M, error) { return getLedgers(zz, f.port) },
	} {
		r, err := get()
		if err != nil {
			t.Fatalf("%s: %v", name, err)
		}
		if len(arr(r["ledgers"])) != 39 {
			t.Fatalf("%s: %d ledgers (want 39: all but the one that hangs)", name, len(arr(r["ledgers"])))
		}
		sk := arr(r["skipped"])
		if len(sk) != 1 || toI64(at(arr(sk[0]), 0)) != poison || str(at(arr(sk[0]), 1)) != "Party 00013" {
			t.Fatalf("%s: the answer does not name the ledger skipped: %v", name, r["skipped"])
		}
	}
}

func TestHeldLedgerVouchersItemInvoice(t *testing.T) {
	td := today()
	f := newStandTally(t)
	standBridge(t, f, "")
	liveFrom(td)
	dir := syncFolder(zz)
	inv := `<VOUCHER VCHTYPE="Sales"><DATE>` + td + `</DATE><GUID>inv-1</GUID><MASTERID>7</MASTERID><VOUCHERTYPENAME>Sales</VOUCHERTYPENAME><VOUCHERNUMBER>S-1</VOUCHERNUMBER>` +
		`<PARTYLEDGERNAME>Buyer</PARTYLEDGERNAME><NARRATION>an item invoice</NARRATION><ISOPTIONAL>No</ISOPTIONAL><ISCANCELLED>No</ISCANCELLED>` +
		`<ALLINVENTORYENTRIES.LIST><STOCKITEMNAME>Widget</STOCKITEMNAME><AMOUNT>1000.00</AMOUNT><ACCOUNTINGALLOCATIONS.LIST><LEDGERNAME>Sales GST</LEDGERNAME><AMOUNT>1000.00</AMOUNT></ACCOUNTINGALLOCATIONS.LIST></ALLINVENTORYENTRIES.LIST>` +
		`<LEDGERENTRIES.LIST><LEDGERNAME>Buyer</LEDGERNAME><AMOUNT>-1180.00</AMOUNT><BILLALLOCATIONS.LIST><NAME>S-1</NAME></BILLALLOCATIONS.LIST></LEDGERENTRIES.LIST>` +
		`<LEDGERENTRIES.LIST><LEDGERNAME>Output IGST</LEDGERNAME><AMOUNT>180.00</AMOUNT></LEDGERENTRIES.LIST></VOUCHER>`
	_ = saveFile(filepath.Join(dir, "days", td+".xml"), "<ENVELOPE>"+inv+"</ENVELOPE>")
	_ = saveFile(filepath.Join(dir, "balances.json"), jsonText(M{"ok": true, "from": td, "openAsOn": addDays(td, -1), "ledgers": []any{}}))
	n0 := f.n("")
	for _, c := range []struct {
		ledger string
		sum    float64
	}{{"Sales GST", 1000}, {"Buyer", -1180}, {"Output IGST", 180}} {
		ll, err := getLedgerLines(zz, c.ledger, td, td, f.port)
		if err != nil || str(ll["via"]) != "copy" || len(arr(ll["vouchers"])) != 1 {
			t.Fatalf("/ledgerlines %s: %v %v", c.ledger, ll, err)
		}
		got := 0.0
		for _, e := range arr(obj(arr(ll["vouchers"])[0])["entries"]) {
			if str(obj(e)["ledger"]) == c.ledger {
				got += num(amtText(str(obj(e)["amount"])))
			}
		}
		b, err := heldLedgerBalance(zz, c.ledger, td, td, false)
		if err != nil {
			t.Fatal(err)
		}
		if r2s(got) != r2s(c.sum) || r2s(num(b["close"])-num(b["open"])) != r2s(got) {
			t.Fatalf("%s: /ledgerlines %.2f, /ledgerbalance moved %s-%s, want %.2f", c.ledger, got, b["open"], b["close"], c.sum)
		}
		lv, err := getLedgerVouchers(zz, c.ledger, td, td, f.port)
		if err != nil || toInt(lv["count"]) != 1 {
			t.Fatalf("/ledgervouchers %s: %v %v", c.ledger, lv, err)
		}
	}
	if f.n("") != n0 {
		t.Fatal("Tally was asked")
	}
}

func TestNoSelfStopWhenIdleAfterOneError(t *testing.T) {
	f := newStandTally(t)
	f.behave = silentFor(isID("TDSDeskNames"), nil)
	standBridge(t, f, `,"TallyMaxSec":1`)
	if _, err := getLedgerNames(fin, zz, f.port); err == nil {
		t.Fatal("answered")
	}
	// nobody asks Tally anything for ten minutes (the bridge's clock, and the stuck file's, moved on)
	start := time.Now()
	nowFn = func() time.Time { return start.Add(10 * time.Minute) }
	if o := readObjFile(stuckFile()); o != nil {
		o["since"] = start.Add(-10 * time.Minute).Format("2006-01-02T15:04:05")
		_ = saveFile(stuckFile(), jsonText(o))
	}
	// 2.3.1: the bridge never stops reading by itself (the self-watch's stop is gone): nothing stopped, the heartbeat ran
	beatBody(true, "open", "", nil, nil, nil)
	if st := readStop(); st != nil {
		t.Fatalf("stopped after one error and ten idle minutes: %v", st)
	}
}

func TestNoSelfStopFromOldStuckFile(t *testing.T) {
	f := newStandTally(t)
	standBridge(t, f, "")
	// left by an earlier bridge: Tally not answering since an hour ago
	_ = saveFile(stuckFile(), jsonText(M{"port": f.port, "since": time.Now().Add(-time.Hour).Format("2006-01-02T15:04:05"), "last": time.Now().Add(-50 * time.Minute).Format("2006-01-02T15:04:05")}))
	beatBody(true, "open", "", nil, nil, nil)
	if st := readStop(); st != nil {
		t.Fatalf("stopped by a stuck file from before: %v", st)
	}
}

func TestMeasureDoesNotSelfStop(t *testing.T) {
	f := newStandTally(t)
	f.slow = func(id, body string) time.Duration {
		if id == "FinComMeasureLedO" && strings.Contains(body, "Profit") {
			return 3 * time.Second
		}
		return 0
	}
	standBridge(t, f, `,"TallyMaxSec":1,"TallyProbeEverySec":1,"SelfStopSec":1`)
	r, err := runMeasure(measureOpts{company: zz, ledgers: "8-9"})
	if err != nil {
		t.Fatal(err)
	}
	if st := readStop(); st != nil {
		t.Fatalf("the measuring tool stopped reading: %v", st)
	}
	if !strings.Contains(str(r["report"]), "reading was not stopped") {
		t.Fatalf("the report does not say a request hit the limit:\n%s", r["report"])
	}
	if logLines("Measure Tally: a request (FinComMeasureLedO) took") < 1 {
		t.Fatal("the log does not say a request hit the limit")
	}
}
