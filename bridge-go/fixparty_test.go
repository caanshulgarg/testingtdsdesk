package main

// Fix in place, review of cd7b81337: a ledger's GSTIN or PAN is changed only for a party: a ledger under Sundry Debtors
// or Sundry Creditors, or a group under them. The ledger's PARENT is the one FinComLedgerByName reads just before; a
// sub-group's own parents come from the group list this computer last read from Tally (group-list.json, the existing
// FinComGroupList read; nothing new asked). Not a party, or its group not known: refused, nothing sent. Made-up data.

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// one ledger GSTIN (or PAN) fix of a ledger under parent, with the group list held here; what was sent and the answer
func fixPartyRun(t *testing.T, parent string, groups [][2]string, field string) (M, []string) {
	t.Helper()
	s := &fixStand{}
	s.install(t)
	o1, o2, o3, o4 := fixReadLedgerFn, fixLedgerSendFn, fixBooksFromFn, fixGroupsFn
	t.Cleanup(func() { fixReadLedgerFn, fixLedgerSendFn, fixBooksFromFn, fixGroupsFn = o1, o2, o3, o4 })
	fixBooksFromFn = func(string) (string, error) { return "20250401", nil }
	dir := t.TempDir()
	gl := []any{}
	for _, g := range groups {
		gl = append(gl, []any{g[0], g[1]})
	}
	if groups != nil {
		if err := os.WriteFile(filepath.Join(dir, "group-list.json"), []byte(jsonText(gl)), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	fixGroupsFn = func(string) [][2]string { return heldGroupList(dir) }
	alter, gst, pan := "11", "", ""
	par := ""
	if parent != "" {
		par = "<PARENT>" + parent + "</PARENT>"
	}
	fixReadLedgerFn = func(port int, company, bf, name string) (string, error) {
		return `<ENVELOPE><LEDGER NAME="Sample Ledger"><GUID>g-led-9</GUID><MASTERID>9</MASTERID><ALTERID>` + alter + `</ALTERID><NAME>Sample Ledger</NAME>` + par +
			`<PARTYGSTIN>` + gst + `</PARTYGSTIN><INCOMETAXNUMBER>` + pan + `</INCOMETAXNUMBER></LEDGER></ENVELOPE>`, nil
	}
	fixLedgerSendFn = func(company, guid, bf string, rows []ledRow) error { return nil }
	fixSendFn = func(port int, x string) (string, error) {
		s.sent = append(s.sent, x)
		gst, pan, alter = group(`<PARTYGSTIN>([^<]*)</PARTYGSTIN>`, x, 1), group(`<INCOMETAXNUMBER>([^<]*)</INCOMETAXNUMBER>`, x, 1), "12"
		return "<RESPONSE><ALTERED>1</ALTERED></RESPONSE>", nil
	}
	f := M{"gstin": fxGST}
	if field == "pan" {
		f = M{"pan": "AAAPZ9999Z"}
	}
	ask := M{"company": fxCo, "companyGuid": "co-guid-1", "target": "ledger", "ledger": "Sample Ledger", "alterId": "11", "was": M{"gstin": "", "pan": ""}, "fields": f}
	return runFix(ask), s.sent
}

var fixPartyGroups = [][2]string{{"Current Assets", ""}, {"Cash-in-Hand", "Current Assets"}, {"Bank Accounts", "Current Assets"},
	{"Sundry Debtors", "Current Assets"}, {"Current Liabilities", ""}, {"Sundry Creditors", "Current Liabilities"},
	{"Creditors North", "Sundry Creditors"}, {"Creditors North Small", "Creditors North"}, {"Debtors Retail", "Sundry Debtors"}}

func TestFixLedgerNotAPartyRefused(t *testing.T) {
	for _, c := range []struct{ parent, field string }{{"Cash-in-Hand", "gstin"}, {"Bank Accounts", "gstin"}, {"Bank Accounts", "pan"}, {"Current Assets", "gstin"}} {
		r, sent := fixPartyRun(t, c.parent, fixPartyGroups, c.field)
		what := "GSTIN"
		if c.field == "pan" {
			what = "PAN"
		}
		want := "This ledger is not a party (it is under " + c.parent + "), so its " + what + " is not changed."
		if r["ok"] != false || r["notParty"] != true || str(r["message"]) != want || len(sent) != 0 {
			t.Fatalf("%s (%s): %v, %d sent", c.parent, c.field, r, len(sent))
		}
	}
}

func TestFixLedgerPartyGroupsAllowed(t *testing.T) {
	for _, c := range []struct{ parent, field string }{{"Sundry Creditors", "gstin"}, {"Sundry Debtors", "gstin"}, {"Creditors North", "gstin"},
		{"Creditors North Small", "gstin"}, {"Debtors Retail", "pan"}, {"sundry  creditors", "gstin"}} {
		r, sent := fixPartyRun(t, c.parent, fixPartyGroups, c.field)
		if r["ok"] != true || len(sent) != 1 {
			t.Fatalf("%s (%s), a party: %v, %d sent", c.parent, c.field, r, len(sent))
		}
	}
	// the ledger directly under Sundry Creditors needs no group list
	if r, sent := fixPartyRun(t, "Sundry Creditors", nil, "gstin"); r["ok"] != true || len(sent) != 1 {
		t.Fatalf("under Sundry Creditors, no group list held: %v", r)
	}
}

// the group cannot be told from what was read: refused too, nothing sent
func TestFixLedgerGroupUnknownRefused(t *testing.T) {
	loop := [][2]string{{"Loop A", "Loop B"}, {"Loop B", "Loop A"}}
	for _, c := range []struct {
		name, parent string
		groups       [][2]string
	}{{"no parent read", "", fixPartyGroups}, {"sub-group, no group list", "Creditors North", nil}, {"group not in the list", "Creditors West", fixPartyGroups}, {"a loop", "Loop A", loop}} {
		r, sent := fixPartyRun(t, c.parent, c.groups, "gstin")
		if r["ok"] != false || r["notParty"] != true || len(sent) != 0 || !strings.Contains(str(r["message"]), "so its GSTIN is not changed.") {
			t.Fatalf("%s: %v, %d sent", c.name, r, len(sent))
		}
	}
}
