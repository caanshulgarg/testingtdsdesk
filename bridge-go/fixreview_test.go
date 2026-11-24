package main

// Fix in place, the review of 595554fbe (24-Nov-2026): the entry's date and type as read, the typing gate just before
// the send, what Tally changed beyond what was asked, a ledger's AlterID, an encoded ACTION, no PARTYGSTIN on a voucher
// (decision 5), the registration type as read, the recorder line's source. Made-up data only.

import (
	"strings"
	"testing"
)

// B1: FinCom's date or type is not the one just read: "changed since", nothing sent
func TestFixRefusesDateOrTypeNotAsRead(t *testing.T) {
	s := &fixStand{alter: "57", number: "A", reply: "<RESPONSE><ALTERED>1</ALTERED></RESPONSE>"}
	s.install(t)
	for k, v := range map[string]string{"vchDate": "20260526", "vchType": "Purchase"} {
		a := fixAsk("57")
		a[k] = v
		r := runFix(a)
		if r["ok"] != false || r["changed"] != true || len(s.sent) != 0 || str(r["xml"]) == "" || str(obj(r["now"])["date"]) != "20260525" {
			t.Fatalf("%s %s not as read, yet: %v (%d sent)", k, v, r, len(s.sent))
		}
	}
}

// the typing gate looked at again just before the send (someone started typing during the read)
func TestFixTypingRecheckedBeforeSend(t *testing.T) {
	s := &fixStand{alter: "57", number: "A", reply: "<RESPONSE><ALTERED>1</ALTERED></RESPONSE>"}
	s.install(t)
	read := fixReadVoucherFn
	fixReadVoucherFn = func(port int, company, mid, date string) (string, error) {
		s.typing = true // typing began while the entry was read
		return read(port, company, mid, date)
	}
	r := runFix(fixAsk("57"))
	if r["ok"] != false || r["held"] != true || len(s.sent) != 0 {
		t.Fatalf("sent while someone types: %v (%d sent)", r, len(s.sent))
	}
	// a ledger too
	s.typing = false
	o1, o2, o3 := fixReadLedgerFn, fixLedgerSendFn, fixBooksFromFn
	t.Cleanup(func() { fixReadLedgerFn, fixLedgerSendFn, fixBooksFromFn = o1, o2, o3 })
	fixBooksFromFn = func(string) (string, error) { return "20250401", nil }
	fixReadLedgerFn = func(port int, company, bf, name string) (string, error) {
		s.typing = true
		return `<ENVELOPE><LEDGER NAME="Sample Vendor"><GUID>g-led-2</GUID><MASTERID>6</MASTERID><ALTERID>21</ALTERID><NAME>Sample Vendor</NAME><PARENT>Sundry Creditors</PARENT></LEDGER></ENVELOPE>`, nil
	}
	ask := M{"company": fxCo, "companyGuid": "co-guid-1", "target": "ledger", "ledger": "Sample Vendor", "alterId": "21", "was": M{"pan": ""}, "fields": M{"pan": "AAAPZ9999Z"}}
	if r := runFix(ask); r["held"] != true || len(s.sent) != 0 {
		t.Fatalf("a ledger sent while someone types: %v", r)
	}
}

// after the send, what Tally changed that was not asked (its date, type or any other field) is said plainly
func TestFixReportsWhatElseChanged(t *testing.T) {
	s := &fixStand{alter: "57", number: "A", reply: "<RESPONSE><ALTERED>1</ALTERED></RESPONSE>"}
	s.install(t)
	read := fixReadVoucherFn
	fixReadVoucherFn = func(port int, company, mid, date string) (string, error) {
		x, err := read(port, company, mid, date)
		if s.alter == "99" { // after the Alter: Tally moved the date and dropped the narration
			x = strings.Replace(x, "<DATE>20260525</DATE>", "<DATE>20260601</DATE>", 1)
			x = strings.Replace(x, "<NARRATION>made up</NARRATION>", "<NARRATION></NARRATION>", 1)
		}
		return x, err
	}
	r := runFix(fixAsk("57"))
	also := strs(r["alsoChanged"])
	if r["ok"] != true || !contains(also, "date") || !contains(also, "narration") || contains(also, "number") || contains(also, "change number") {
		t.Fatalf("what else Tally changed: %v", r)
	}
	if m := str(r["message"]); !strings.Contains(m, "Tally also changed") || !strings.Contains(m, "date") {
		t.Fatalf("not said plainly: %q", m)
	}
	// nothing else changed: nothing said
	s2 := &fixStand{alter: "57", number: "A", reply: "<RESPONSE><ALTERED>1</ALTERED></RESPONSE>"}
	s2.install(t)
	if r := runFix(fixAsk("57")); r["ok"] != true || r["alsoChanged"] != nil || str(r["message"]) != "Saved in Tally." {
		t.Fatalf("%v", r)
	}
}

// a ledger fix needs the ledger's AlterID (FinCom sends it): refused without it, nothing read or sent
func TestFixLedgerNeedsAlterID(t *testing.T) {
	s := &fixStand{}
	s.install(t)
	o1 := fixReadLedgerFn
	t.Cleanup(func() { fixReadLedgerFn = o1 })
	reads := 0
	fixReadLedgerFn = func(port int, company, bf, name string) (string, error) { reads++; return "", nil }
	for _, f := range []M{{"gstin": "27AAPFU0939F1ZV"}, {"pan": "AAAPZ9999Z"}} {
		ask := M{"company": fxCo, "companyGuid": "co-guid-1", "target": "ledger", "ledger": "Sample Vendor", "was": M{}, "fields": f}
		if r := runFix(ask); r["ok"] != false || reads != 0 || len(s.sent) != 0 || !strings.Contains(str(r["message"]), "change number") {
			t.Fatalf("no AlterID, yet: %v (reads %d)", r, reads)
		}
	}
}

// an ACTION value with a character reference ('&') is refused by the posting rule and every pin, so an encoded "Alter"
// can never pass as a plain Import
func TestImportRefusesEncodedAction(t *testing.T) {
	d := today()
	base := finVoucher("fe1", fgParty, "FE-1", d, "1.00")
	for _, enc := range []string{`ACTION="&#65;lter"`, `ACTION="Alt&#101;r"`, `ACTION='&#x41;lter'`, `ACTION="&#67;reate"`, `ACTION=&#65;lter`} {
		v := strings.Replace(base, `ACTION="Create"`, enc, 1)
		if cannotSend(v) == "" {
			t.Errorf("%s: the posting rule takes it", enc)
		}
		if checkAllowed(importEnvelope("Vouchers", zz, `<TALLYMESSAGE xmlns:UDF="TallyUDF">`+v+"</TALLYMESSAGE>")) == nil {
			t.Errorf("%s: a pin takes it", enc)
		}
		l := `<LEDGER NAME="A" ` + enc + `><NAME>A</NAME></LEDGER>`
		if cannotSend(l) == "" || checkAllowed(importEnvelope("All Masters", zz, `<TALLYMESSAGE xmlns:UDF="TallyUDF">`+l+"</TALLYMESSAGE>")) == nil {
			t.Errorf("%s: a ledger with it is taken", enc)
		}
	}
	// a plain Create still goes
	if cannotSend(base) != "" || checkAllowed(importEnvelope("Vouchers", zz, `<TALLYMESSAGE xmlns:UDF="TallyUDF">`+base+"</TALLYMESSAGE>")) != nil {
		t.Fatal("a plain posting is refused")
	}
}

// decision 5: a GSTIN is changed on the party ledger only, never on a voucher through /fix
func TestFixRefusesVoucherGSTIN(t *testing.T) {
	s := &fixStand{alter: "57", number: "A", reply: "<RESPONSE><ALTERED>1</ALTERED></RESPONSE>"}
	s.install(t)
	for _, f := range []M{{"gstin": "27AAPFU0939F1ZV"}, {"number": "INV-2", "gstin": "27AAPFU0939F1ZV"}} {
		a := fixAsk("57")
		a["fields"] = f
		if r := runFix(a); r["ok"] != false || s.reads != 0 || len(s.sent) != 0 || !strings.Contains(str(r["message"]), "party ledger") {
			t.Fatalf("a voucher's GSTIN: %v (reads %d, sent %d)", r, s.reads, len(s.sent))
		}
	}
}

// the registration type goes as read (any of Tally's types), not turned into Regular; none read: Regular
func TestFixLedgerRegTypeAsRead(t *testing.T) {
	for _, c := range []struct{ read, want string }{{"Unregistered/Consumer", "Unregistered/Consumer"}, {"Composition", "Composition"}, {"Regular", "Regular"}, {"", "Regular"}} {
		s := &fixStand{}
		s.install(t)
		o1, o2, o3 := fixReadLedgerFn, fixLedgerSendFn, fixBooksFromFn
		fixBooksFromFn = func(string) (string, error) { return "20250401", nil }
		gst, alter := "", "11"
		reg := ""
		if c.read != "" {
			reg = `<LEDGSTREGDETAILS.LIST><APPLICABLEFROM>20240401</APPLICABLEFROM><GSTREGISTRATIONTYPE>` + c.read + `</GSTREGISTRATIONTYPE><GSTIN></GSTIN></LEDGSTREGDETAILS.LIST>`
		}
		fixReadLedgerFn = func(port int, company, bf, name string) (string, error) {
			return `<ENVELOPE><LEDGER NAME="Sample Buyer"><GUID>g-led-1</GUID><MASTERID>5</MASTERID><ALTERID>` + alter + `</ALTERID><NAME>Sample Buyer</NAME><PARENT>Sundry Debtors</PARENT><PARTYGSTIN>` + gst + `</PARTYGSTIN>` + reg + `</LEDGER></ENVELOPE>`, nil
		}
		fixLedgerSendFn = func(company, guid, bf string, rows []ledRow) error { return nil }
		fixSendFn = func(port int, x string) (string, error) {
			s.sent = append(s.sent, x)
			gst, alter = group(`<GSTIN>([^<]*)</GSTIN>`, x, 1), "12"
			return "<RESPONSE><ALTERED>1</ALTERED></RESPONSE>", nil
		}
		ask := M{"company": fxCo, "companyGuid": "co-guid-1", "target": "ledger", "ledger": "Sample Buyer", "alterId": "11", "was": M{"gstin": ""}, "fields": M{"gstin": "27AAPFU0939F1ZV"}}
		r := runFix(ask)
		fixReadLedgerFn, fixLedgerSendFn, fixBooksFromFn = o1, o2, o3
		if r["ok"] != true || len(s.sent) != 1 || !strings.Contains(s.sent[0], "<GSTREGISTRATIONTYPE>"+c.want+"</GSTREGISTRATIONTYPE>") || checkAllowed(s.sent[0]) != nil {
			t.Fatalf("read %q: %v %v", c.read, r, s.sent)
		}
	}
}
