package main

// Review L4 (06-Oct-2026): a ledger FinCom waits for whose name can never be asked from Tally (a quote mark or a line
// break, which a TDL string cannot hold; or a name FinCom keeps cleaned, which Tally does not have) is said once in plain
// words and not asked again every 10 minutes. Test written before the code.

import (
	"strings"
	"testing"
	"time"
)

func TestLedWantedNeverAskableSaidOnce(t *testing.T) {
	_, f, _ := led231Bridge(t)
	old := nowFn
	t.Cleanup(func() { nowFn = old })
	at := time.Now()
	nowFn = func() time.Time { return at }
	bad, gone := `Q "X" Traders`, "Not In Tally Traders"
	want := M{"ledgersWanted": []any{M{"company": zz, "company_guid": b220CoGUID, "name": bad}, M{"company": zz, "company_guid": b220CoGUID, "name": gone}}}
	for i := 0; i < 3; i++ {
		ledWantedRun(want)
		at = at.Add(11 * time.Minute) // past the 10-minute gap each time
	}
	if n := f.n(ledByNameID); n != 1 {
		t.Fatalf("asked Tally %d times (want once: the name Tally has no ledger of, never again; the quoted name never)", n)
	}
	for _, b := range f.bodiesOf(ledByNameID) {
		if strings.Contains(b, "Q &#34;X&#34;") {
			t.Fatal("the quoted name was asked")
		}
	}
	if n := logLines("cannot be asked from Tally by its name"); n != 1 {
		t.Fatalf("the quoted name said %d times, want once", n)
	}
	if n := logLines("Tally has no ledger of that name"); n != 1 {
		t.Fatalf("the name Tally does not have said %d times, want once", n)
	}
}
