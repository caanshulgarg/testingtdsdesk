package main

// Fix in place, the owner's decision of 24-Nov-2026 (amends decision 5): a GSTIN fix corrects the party ledger AND that
// party's invoices carrying the wrong GSTIN, each by the approved shape A (FinComFixVoucher, its PARTYGSTIN alone), with
// the same checks as any voucher fix: Tally open, the AlterID unchanged, the date and type as read, the typing gate.
// Made-up data only.

import (
	"errors"
	"strings"
	"testing"
)

const fxGST = "27AAPFU0939F1ZV" // made up, its check digit right

func fixGSTAsk(alter, g string) M {
	a := fixAsk(alter)
	a["fields"] = M{"gstin": g}
	return a
}

// the voucher's PARTYGSTIN is sent as shape A, pinned, read before and after, queued as an altered line
func TestFixVoucherGSTINSent(t *testing.T) {
	s := &fixStand{alter: "57", number: "INV-7", gstin: "27AAPFU0939F1ZA", reply: "<RESPONSE><ALTERED>1</ALTERED></RESPONSE>"}
	s.install(t)
	r := runFix(fixGSTAsk("57", " "+strings.ToLower(fxGST)+" "))
	if r["ok"] != true || len(s.sent) != 1 || s.reads != 2 {
		t.Fatalf("not done: %v (sent %d, reads %d)", r, len(s.sent), s.reads)
	}
	x := s.sent[0]
	if tallyRequestID(x) != fixVoucherID || checkAllowed(x) != nil {
		t.Fatalf("not the pinned FinComFixVoucher: %s", x)
	}
	want := `<VOUCHER REMOTEID="` + fxGUID + `" VCHTYPE="Sales" ACTION="Alter">` + "\n<DATE>20260525</DATE>\n<VOUCHERTYPENAME>Sales</VOUCHERTYPENAME>\n" +
		"<PARTYGSTIN>" + fxGST + "</PARTYGSTIN>\n</VOUCHER>\n"
	if !strings.Contains(x, `<TALLYMESSAGE xmlns:UDF="TallyUDF">`+want+"</TALLYMESSAGE>") {
		t.Fatalf("not shape A with the GSTIN alone:\n%s", x)
	}
	if strings.Contains(x, "VOUCHERNUMBER") || strings.Contains(x, "PLACEOFSUPPLY") {
		t.Fatal("a field not asked was sent")
	}
	if str(obj(r["before"])["gstin"]) != "27AAPFU0939F1ZA" || str(obj(r["after"])["gstin"]) != fxGST || r["alsoChanged"] != nil {
		t.Fatalf("result %v", r)
	}
	if len(s.queued) != 1 || s.queued[0].event != "altered" || s.queued[0].source != "fix" {
		t.Fatalf("the altered line: %+v", s.queued)
	}
}

// a GSTIN that is not 15 characters with its check digit right is never sent, nor is Tally read
func TestFixVoucherGSTINMustBeValid(t *testing.T) {
	s := &fixStand{alter: "57", number: "A", reply: "<RESPONSE><ALTERED>1</ALTERED></RESPONSE>"}
	s.install(t)
	for _, g := range []string{"", "  ", "27AAPFU0939F1ZA", "27AAPFU0939F1Z", "27AAPFU0939F1ZVX", "99AAPFU0939F1ZV", "27AAPFU 939F1ZV",
		"27AAPFU0939F1Z&", "<PARTYGSTIN>", fxGST + "\n<NARRATION>x</NARRATION>"} {
		if r := runFix(fixGSTAsk("57", g)); r["ok"] != false || s.reads != 0 || len(s.sent) != 0 {
			t.Fatalf("GSTIN %q: %v (reads %d, sent %d)", g, r, s.reads, len(s.sent))
		}
	}
	// not a text
	a := fixAsk("57")
	a["fields"] = M{"gstin": 27}
	if r := runFix(a); r["ok"] != false || s.reads != 0 || len(s.sent) != 0 {
		t.Fatalf("a number as GSTIN: %v", r)
	}
}

// every voucher check holds for a GSTIN fix
func TestFixVoucherGSTINChecks(t *testing.T) {
	// no AlterID from FinCom
	s := &fixStand{alter: "57", number: "A", reply: "<RESPONSE><ALTERED>1</ALTERED></RESPONSE>"}
	s.install(t)
	if r := runFix(fixGSTAsk("", fxGST)); r["ok"] != false || s.reads != 0 || len(s.sent) != 0 {
		t.Fatalf("no AlterID, yet: %v", r)
	}
	// the AlterID moved since FinCom read it
	if r := runFix(fixGSTAsk("56", fxGST)); r["ok"] != false || r["changed"] != true || len(s.sent) != 0 || str(r["xml"]) == "" {
		t.Fatalf("changed since, yet: %v", r)
	}
	// the date or type not as read
	for k, v := range map[string]string{"vchDate": "20260526", "vchType": "Purchase"} {
		a := fixGSTAsk("57", fxGST)
		a[k] = v
		if r := runFix(a); r["ok"] != false || r["changed"] != true || len(s.sent) != 0 {
			t.Fatalf("%s not as read, yet: %v", k, r)
		}
	}
	// someone types in Tally: held, not read, not sent
	s.typing = true
	if r := runFix(fixGSTAsk("57", fxGST)); r["held"] != true || len(s.sent) != 0 {
		t.Fatalf("typing, yet: %v", r)
	}
	s.typing = false
	// typing starts during the read: held before the send
	read := fixReadVoucherFn
	fixReadVoucherFn = func(port int, company, mid, date string) (string, error) {
		s.typing = true
		return read(port, company, mid, date)
	}
	if r := runFix(fixGSTAsk("57", fxGST)); r["held"] != true || len(s.sent) != 0 {
		t.Fatalf("typing during the read, yet: %v", r)
	}
	fixReadVoucherFn, s.typing = read, false
	// Tally closed: held
	port := fixPortFn
	fixPortFn = func(p M) (int, string, error) { return 0, "", errors.New("Tally is closed") }
	if r := runFix(fixGSTAsk("57", fxGST)); r["held"] != true || len(s.sent) != 0 {
		t.Fatalf("Tally closed, yet: %v", r)
	}
	fixPortFn = port
}

// Tally takes the Alter but keeps its own GSTIN: not taken as done
func TestFixVoucherGSTINKept(t *testing.T) {
	s := &fixStand{alter: "57", number: "A", gstin: "27AAPFU0939F1ZA", keepGST: true, reply: "<RESPONSE><ALTERED>1</ALTERED></RESPONSE>"}
	s.install(t)
	r := runFix(fixGSTAsk("57", fxGST))
	if r["ok"] != false || r["kept"] != true || len(s.sent) != 1 {
		t.Fatalf("Tally kept its GSTIN, yet: %v", r)
	}
}

// the GSTIN goes only as the approved PARTYGSTIN of shape A: no other field of a voucher is opened by it
func TestFixVoucherGSTINOnlyTheApprovedField(t *testing.T) {
	s := &fixStand{alter: "57", number: "A", reply: "<RESPONSE><ALTERED>1</ALTERED></RESPONSE>"}
	s.install(t)
	for _, f := range []M{{"gstin": fxGST, "narration": "x"}, {"partygstin": fxGST}, {"gstin": fxGST, "ledger": "Other"}, {"GSTIN": fxGST}} {
		a := fixAsk("57")
		a["fields"] = f
		if r := runFix(a); r["ok"] != false || s.reads != 0 || len(s.sent) != 0 {
			t.Fatalf("%v: %v", f, r)
		}
	}
	// the pin takes the GSTIN form and nothing more
	x, why := fixVoucherRequest(fxCo, fxGUID, "Sales", "20260525", fixFields{gstin: fxGST})
	if why != "" || len(fixVoucherRebuild(x)) != 1 || fixVoucherRebuild(x)[0] != x {
		t.Fatalf("the GSTIN form is not pinned: %q", why)
	}
	bad := strings.Replace(x, "</PARTYGSTIN>\n", "</PARTYGSTIN>\n<NARRATION>x</NARRATION>\n", 1)
	if checkAllowed(bad) == nil {
		t.Fatal("an extra field passed the pin")
	}
	if checkAllowed(strings.Replace(x, fxGST, "27AAPFU0939F1ZA", 1)) == nil {
		t.Fatal("a GSTIN failing its check digit passed the pin")
	}
}

// the owner's decision of 24-Nov-2026 (B2): a ledger FinCom holds no AlterID for is read from Tally by its name first
// (FinComLedgerByName, the 2 s stop, the typing gate, Tally open), in the same Save; that read sends nothing and gives
// the ledger as Tally holds it now with its AlterID, which FinCom then sends the fix with
func TestFixLedgerReadFirst(t *testing.T) {
	s := &fixStand{}
	s.install(t)
	o1, o2, o3 := fixReadLedgerFn, fixLedgerSendFn, fixBooksFromFn
	t.Cleanup(func() { fixReadLedgerFn, fixLedgerSendFn, fixBooksFromFn = o1, o2, o3 })
	fixBooksFromFn = func(string) (string, error) { return "20250401", nil }
	reads := 0
	fixReadLedgerFn = func(port int, company, bf, name string) (string, error) {
		reads++
		return `<ENVELOPE><LEDGER NAME="Sample Buyer"><GUID>g-led-1</GUID><MASTERID>5</MASTERID><ALTERID>31</ALTERID><NAME>Sample Buyer</NAME><PARENT>Sundry Debtors</PARENT><PARTYGSTIN>27AAPFU0939F1ZA</PARTYGSTIN></LEDGER></ENVELOPE>`, nil
	}
	ask := M{"company": fxCo, "companyGuid": "co-guid-1", "target": "ledger", "ledger": "Sample Buyer", "readFirst": true, "was": M{"gstin": "27AAPFU0939F1ZA"}, "fields": M{"gstin": fxGST}}
	r := runFix(ask)
	if r["ok"] != false || r["read"] != true || reads != 1 || len(s.sent) != 0 || str(r["alterNow"]) != "31" || str(obj(r["now"])["gstin"]) != "27AAPFU0939F1ZA" {
		t.Fatalf("the read first: %v (reads %d, sent %d)", r, reads, len(s.sent))
	}
	// typing: held, not read
	s.typing = true
	if r := runFix(ask); r["held"] != true || reads != 1 {
		t.Fatalf("read while someone types: %v", r)
	}
	s.typing = false
	// Tally closed: held
	fixPortFn = func(p M) (int, string, error) { return 0, "", errTimeout }
	if r := runFix(ask); r["held"] != true || reads != 1 {
		t.Fatalf("Tally closed: %v", r)
	}
	fixPortFn = func(p M) (int, string, error) { return 9000, fxCo, nil }
	// no such ledger
	fixReadLedgerFn = func(port int, company, bf, name string) (string, error) { reads++; return `<ENVELOPE></ENVELOPE>`, nil }
	if r := runFix(ask); r["gone"] != true || len(s.sent) != 0 {
		t.Fatalf("no ledger: %v", r)
	}
	// still not valid fields: nothing read
	n := reads
	bad := M{"company": fxCo, "companyGuid": "co-guid-1", "target": "ledger", "ledger": "Sample Buyer", "readFirst": true, "fields": M{"gstin": "27AAPFU0939F1ZA"}}
	if r := runFix(bad); r["ok"] != false || reads != n {
		t.Fatalf("an invalid GSTIN read first: %v", r)
	}
}
