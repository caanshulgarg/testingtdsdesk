package main

// Bridge 2.3.1 (parts A and B together): the party ledger's deductee type. The owner asked for the TDS details with the
// "deductee type" (part A); Tally keeps it on the ledger master (TDSDEDUCTEETYPE), not on the entry, so it comes with the
// ledger requests: the ledger list (FinComLedgers) and part B's FinComLedgerChanges and FinComLedgerByName, which keep
// exactly the ledger list's fields. It goes to FinCom as the 11th column of the ledger list's row (index 10), for both
// ledger_list and ledger_changes; FinCom stores it in tally_ledgers.tds_deductee_type (migration 57).
// Test written before the code.

import (
	"fmt"
	"strings"
	"testing"
	"time"
)

// the three ledger requests ask the one stored field more, the same FETCH, and pass the allow-list
func TestDeductee231Requests(t *testing.T) {
	if !strings.HasSuffix(ledFetch, ", LEDSTATENAME, TDSDEDUCTEETYPE") {
		t.Fatalf("the ledger fields: %s", ledFetch)
	}
	for _, x := range []string{ledgerChangesRequest("SAMPLE CO", 5, 205), ledgerByNameRequest("SAMPLE CO", "Supplier B"), ledgerChunkRequest("SAMPLE CO", 0, 2000)} {
		if f := group(`<FETCH>([^<]*)</FETCH>`, x, 1); f != ledFetch || !strings.Contains(f, "TDSDEDUCTEETYPE") {
			t.Fatalf("no deductee type: %s", x)
		}
		if err := checkAllowed(x); err != nil {
			t.Fatalf("refused: %v", err)
		}
	}
}

// part B's path: a ledger altered in Tally (its deductee type set) and one asked by its name go with the type at index 10;
// a ledger without one sends ""
func TestDeductee231LedgerChangesCarryType(t *testing.T) {
	_, f, c := led231Bridge(t)
	led231Alter(f, "Supplier B", func(l *tLed) { l.dtype = "Company - Resident" })
	led231Alter(f, "Customer A", func(l *tLed) { l.gstin = "27AAACA1234B1Z5" })
	led231Numbers(t, f)
	if n, err := ledChangesCheck(zz); n != 2 || err != nil {
		t.Fatalf("sent %d: %v", n, err)
	}
	rows := led231Rows(c.ledChanges[0])
	if r := rows["Supplier B"]; len(r) != 11 || str(r[10]) != "Company - Resident" || str(r[9]) != "" {
		t.Fatalf("Supplier B's row: %v", r)
	}
	if r := rows["Customer A"]; len(r) != 11 || str(r[10]) != "" {
		t.Fatalf("Customer A's row: %v", r)
	}
	// by name (an entry names a ledger FinCom does not have)
	np := f.addLed("New Contractor", "Sundry Creditors", "0.00")
	f.mu.Lock()
	np.dtype = "Individual/HUF - Resident"
	f.mu.Unlock()
	ledWantedRun(M{"ledgersWanted": []any{M{"company": zz, "company_guid": b220CoGUID, "name": "New Contractor"}}})
	if len(c.ledChanges) != 2 || str(c.ledChanges[1]["why"]) != "wanted" {
		t.Fatalf("the ledger did not go: %v", c.ledChanges)
	}
	if r := led231Rows(c.ledChanges[1])["New Contractor"]; len(r) != 11 || str(r[10]) != "Individual/HUF - Resident" {
		t.Fatalf("New Contractor's row: %v", r)
	}
}

// the ledger list's path: the row carries the type at index 10; a list held from 2.3.0 (no type) sends the ledgers whose
// type Tally has once, and nothing again after that
func TestDeductee231LedgerListCarriesType(t *testing.T) {
	f := newStandTally(t)
	c := newStandCloud(t)
	for i := 1; i <= 3; i++ {
		f.addLed(fmt.Sprintf("Party %02d", i), "Sundry Creditors", "0.00")
	}
	f.mu.Lock()
	f.led[1].dtype = "Company - Resident"
	f.mu.Unlock()
	standBridge(t, f, `,"KeepBudgetSec":600`+c.cfg())
	liveFrom(today())
	runNow(t, "now")
	cloudMu.Lock()
	cloudLinksAt = time.Time{}
	cloudMu.Unlock()
	invokeCloudPush()
	c.mu.Lock()
	if len(c.ledList) != 1 {
		c.mu.Unlock()
		t.Fatalf("%d ledger_list calls", len(c.ledList))
	}
	byGUID := map[string][]any{}
	for _, x := range arr(c.ledList[0]["ledgers"]) {
		a := arr(x)
		byGUID[str(at(a, 0))] = a
	}
	c.mu.Unlock()
	for i, want := range map[int]string{0: "", 1: "Company - Resident", 2: ""} {
		a := byGUID[f.led[i].guid]
		if len(a) != 11 || str(at(a, 10)) != want {
			t.Fatalf("the row of %s: %v (want 11 columns, deductee type %q)", f.led[i].name, a, want)
		}
	}
	// the list held here keeps the type: an unchanged ledger is not changed
	held := loadLedList(syncFolder(zz))
	if held[f.led[1].guid].dtype != "Company - Resident" || held[f.led[0].guid].dtype != "" {
		t.Fatalf("the list held: %+v", held[f.led[1].guid])
	}
	// a list held by 2.3.0 (10 columns, no type): only the ledger with a type reads as changed
	old := map[string]ledRow{}
	for g, r := range held {
		r.dtype = ""
		old[g] = r
	}
	d := diffLedgers(old, held)
	if len(d.rows) != 1 || d.rows[0].guid != f.led[1].guid || d.added != 0 || len(d.renamed) != 0 || len(d.openChg) != 0 {
		t.Fatalf("the diff from a 2.3.0 list: %+v", d)
	}
	if r := ledFromArr("g", []any{1, 2, "n", "p", "0.00", "", "", "Delhi"}); r.dtype != "" || r.state != "Delhi" {
		t.Fatalf("a 2.3.0 row: %+v", r)
	}
}
