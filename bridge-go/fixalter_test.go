package main

// Fix in place (the owner's approval of 23-Nov-2026, findings/fix-in-place-plan.md section 2.3): FinComFixVoucher and
// FinComFixLedger, each pinned to its one builder; the plain Import never carries an Alter of a voucher or a ledger; the
// fix itself reads the entry first (its AlterID), sends the one change, reads it back and queues it as an altered line.
// Made-up data only.

import (
	"errors"
	"fmt"
	"net/http"
	"path/filepath"
	"strings"
	"testing"
)

const (
	fxCo   = "ZZ FIX CO"
	fxGUID = "aaaa1111-2222-3333-4444-555566667777-0000002a"
)

func TestFixVoucherShapeExact(t *testing.T) {
	x, why := fixVoucherRequest(fxCo, fxGUID, "Sales", "20260525", fixFields{number: "INV/26-27/0084", pos: "Chhattisgarh"})
	if why != "" {
		t.Fatal(why)
	}
	want := importHead + "Vouchers</REPORTNAME><STATICVARIABLES><SVCURRENTCOMPANY>ZZ FIX CO</SVCURRENTCOMPANY></STATICVARIABLES></REQUESTDESC><REQUESTDATA>" +
		`<TALLYMESSAGE xmlns:UDF="TallyUDF">` +
		`<VOUCHER REMOTEID="` + fxGUID + `" VCHTYPE="Sales" ACTION="Alter">` + "\n" +
		"<DATE>20260525</DATE>\n<VOUCHERTYPENAME>Sales</VOUCHERTYPENAME>\n<VOUCHERNUMBER>INV/26-27/0084</VOUCHERNUMBER>\n" +
		"<PLACEOFSUPPLY>Chhattisgarh</PLACEOFSUPPLY>\n</VOUCHER>\n" +
		"</TALLYMESSAGE></REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>"
	if x != want {
		t.Fatalf("not the approved shape:\n%s\nwant\n%s", x, want)
	}
	if id := tallyRequestID(x); id != fixVoucherID {
		t.Fatalf("id %q", id)
	}
	if err := checkAllowed(x); err != nil {
		t.Fatalf("the approved shape refused: %v", err)
	}
	// the party GSTIN alone (approved in the shape; FinCom fixes GSTINs on the ledger, the owner's decision 5)
	if _, why := fixVoucherRequest(fxCo, fxGUID, "Sales", "20260525", fixFields{gstin: "27AAPFU0939F1ZV"}); why != "" {
		t.Fatal(why)
	}
}

func TestFixVoucherRefusesOtherShapes(t *testing.T) {
	bad := map[string]fixFields{
		"nothing":           {},
		"number too long":   {number: "INV/2026-27/00841"},
		"number characters": {number: "INV 84'"},
		"number of zeros":   {number: "0000"},
		"state unknown":     {pos: "Atlantis"},
		"GSTIN check digit": {gstin: "27AAPFU0939F1ZA"},
	}
	for name, f := range bad {
		if _, why := fixVoucherRequest(fxCo, fxGUID, "Sales", "20260525", f); why == "" {
			t.Errorf("%s: built", name)
		}
	}
	if _, why := fixVoucherRequest(fxCo, "", "Sales", "20260525", fixFields{number: "A-1"}); why == "" {
		t.Error("no GUID: built")
	}
	if _, why := fixVoucherRequest(fxCo, fxGUID, "Sales", "20260231", fixFields{number: "A-1"}); why == "" {
		t.Error("no real date: built")
	}
	good, _ := fixVoucherRequest(fxCo, fxGUID, "Sales", "20260525", fixFields{number: "A-1"})
	variants := map[string]string{
		"another field":  strings.Replace(good, "</VOUCHER>", "<NARRATION>x</NARRATION>\n</VOUCHER>", 1),
		"a list":         strings.Replace(good, "</VOUCHER>", "<ALLLEDGERENTRIES.LIST><LEDGERNAME>X</LEDGERNAME></ALLLEDGERENTRIES.LIST>\n</VOUCHER>", 1),
		"two vouchers":   strings.Replace(good, "</VOUCHER>\n", "</VOUCHER>\n"+good[strings.Index(good, "<VOUCHER "):strings.Index(good, "</VOUCHER>")]+"</VOUCHER>\n", 1),
		"type differs":   strings.Replace(good, "<VOUCHERTYPENAME>Sales<", "<VOUCHERTYPENAME>Journal<", 1),
		"masters report": strings.Replace(good, "Vouchers</REPORTNAME>", "All Masters</REPORTNAME>", 1),
		"order changed":  strings.Replace(good, "<DATE>20260525</DATE>\n<VOUCHERTYPENAME>Sales</VOUCHERTYPENAME>\n", "<VOUCHERTYPENAME>Sales</VOUCHERTYPENAME>\n<DATE>20260525</DATE>\n", 1),
		"lower case":     strings.Replace(good, `ACTION="Alter"`, `action="alter"`, 1),
	}
	// a Create is a posting (the posting rules), never this id's
	if id := tallyRequestID(strings.Replace(good, `ACTION="Alter"`, `ACTION="Create"`, 1)); id == fixVoucherID {
		t.Error("a Create taken as a fix")
	}
	for name, x := range variants {
		if x == good {
			t.Fatalf("%s: the variant did not change the request", name)
		}
		if err := checkAllowed(x); err == nil {
			t.Errorf("%s: allowed", name)
		}
	}
}

func TestFixLedgerShapeExact(t *testing.T) {
	x, why := fixLedgerGSTRequest(fxCo, "Sample Buyer & Co", "20250401", "Regular", "27AAPFU0939F1ZV")
	if why != "" {
		t.Fatal(why)
	}
	want := importHead + "All Masters</REPORTNAME><STATICVARIABLES><SVCURRENTCOMPANY>ZZ FIX CO</SVCURRENTCOMPANY></STATICVARIABLES></REQUESTDESC><REQUESTDATA>" +
		`<TALLYMESSAGE xmlns:UDF="TallyUDF">` +
		`<LEDGER NAME="Sample Buyer &amp; Co" ACTION="Alter">` + "\n<NAME>Sample Buyer &amp; Co</NAME>\n<LEDGSTREGDETAILS.LIST>\n" +
		"<APPLICABLEFROM>20250401</APPLICABLEFROM>\n<GSTREGISTRATIONTYPE>Regular</GSTREGISTRATIONTYPE>\n<GSTIN>27AAPFU0939F1ZV</GSTIN>\n" +
		"<PLACEOFSUPPLY>Maharashtra</PLACEOFSUPPLY>\n</LEDGSTREGDETAILS.LIST>\n<PARTYGSTIN>27AAPFU0939F1ZV</PARTYGSTIN>\n</LEDGER>\n" +
		"</TALLYMESSAGE></REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>"
	if x != want {
		t.Fatalf("not the approved shape:\n%s\nwant\n%s", x, want)
	}
	if id := tallyRequestID(x); id != fixLedgerID {
		t.Fatalf("id %q", id)
	}
	if err := checkAllowed(x); err != nil {
		t.Fatalf("refused: %v", err)
	}
	p, why := fixLedgerPANRequest(fxCo, "Sample Landlord", "ABCPS9999F")
	if why != "" {
		t.Fatal(why)
	}
	if !strings.Contains(p, `<LEDGER NAME="Sample Landlord" ACTION="Alter">`+"\n<NAME>Sample Landlord</NAME>\n<INCOMETAXNUMBER>ABCPS9999F</INCOMETAXNUMBER>\n</LEDGER>\n") {
		t.Fatalf("PAN shape: %s", p)
	}
	if err := checkAllowed(p); err != nil {
		t.Fatalf("PAN refused: %v", err)
	}
	for name, x := range map[string]string{
		"rename":       strings.Replace(p, "<NAME>Sample Landlord</NAME>", "<NAME>Other</NAME>", 1),
		"parent":       strings.Replace(p, "</LEDGER>", "<PARENT>Sundry Debtors</PARENT>\n</LEDGER>", 1),
		"GST and PAN":  strings.Replace(x, "</LEDGER>", "<INCOMETAXNUMBER>ABCPS9999F</INCOMETAXNUMBER>\n</LEDGER>", 1),
		"wrong state":  strings.Replace(x, "Maharashtra", "Gujarat", 1),
		"opening":      strings.Replace(p, "</LEDGER>", "<OPENINGBALANCE>1.00</OPENINGBALANCE>\n</LEDGER>", 1),
		"vouchers rpt": strings.Replace(p, "All Masters</REPORTNAME>", "Vouchers</REPORTNAME>", 1),
	} {
		if err := checkAllowed(x); err == nil {
			t.Errorf("%s: allowed", name)
		}
	}
	if _, why := fixLedgerPANRequest(fxCo, "Sample Landlord", "ABCP9999F"); why == "" {
		t.Error("a PAN of the wrong form built")
	}
	if _, why := fixLedgerGSTRequest(fxCo, "Sample", "20250401", "Regular", "27AAPFU0939F1ZA"); why == "" {
		t.Error("a GSTIN failing its check digit built")
	}
}

// decision 7 of 23-Nov-2026: the approved forms are the only way to change an existing entry or ledger
func TestPlainImportRefusesAlter(t *testing.T) {
	d := today()
	v := strings.Replace(finVoucher("fa1", fgParty, "FA-1", d, "1.00"), `ACTION="Create"`, `ACTION="Alter"`, 1)
	if !strings.Contains(v, `ACTION="Alter"`) {
		t.Fatal("the made-up voucher has no ACTION")
	}
	for name, obj := range map[string]string{
		"voucher alter":  v,
		"ledger alter":   `<LEDGER NAME="A" ACTION="Alter"><NAME>A</NAME><PARTYGSTIN>27AAPFU0939F1ZV</PARTYGSTIN></LEDGER>`,
		"ledger, spaced": `<LEDGER NAME="A"  action = 'alter'><NAME>A</NAME></LEDGER>`,
		"group alter":    `<GROUP NAME="G" ACTION="Alter"><NAME>G</NAME><PARENT>Indirect Expenses</PARENT></GROUP>`,
	} {
		if cannotSend(obj) == "" {
			t.Errorf("%s: the posting rule takes it", name)
		}
		rep := "All Masters"
		if strings.HasPrefix(obj, "<VOUCHER") {
			rep = "Vouchers"
		}
		if checkAllowed(importEnvelope(rep, zz, `<TALLYMESSAGE xmlns:UDF="TallyUDF">`+obj+"</TALLYMESSAGE>")) == nil {
			t.Errorf("%s: the Import pin takes it", name)
		}
	}
	// a voucher type's numbering stays an Alter the plain Import takes
	vt := "<VOUCHERTYPE NAME=\"Journal\" ACTION=\"Alter\">\n<NAME>Journal</NAME>\n<NUMBERINGMETHOD>Automatic</NUMBERINGMETHOD>\n<PREVENTDUPLICATES>No</PREVENTDUPLICATES>\n</VOUCHERTYPE>\n"
	if cannotSend(vt) != "" || checkAllowed(importEnvelope("All Masters", zz, `<TALLYMESSAGE xmlns:UDF="TallyUDF">`+vt+"</TALLYMESSAGE>")) != nil {
		t.Error("the voucher type numbering is refused")
	}
}

func TestFixIdsOnTheList(t *testing.T) {
	for _, id := range []string{fixVoucherID, fixLedgerID} {
		a, ok := tallyAllowList[id]
		if !ok || !strings.Contains(a.purpose, "owner approved 23-Nov-2026") {
			t.Errorf("%s not on the list with the owner's approval", id)
		}
		if requestClass[id] != "import" || !isImportID(id) || !readStopExempt(id) {
			t.Errorf("%s is not a posting", id)
		}
	}
}

// --- the fix itself, with Tally stood in by its seams
type fixStand struct {
	alter    string // the entry's AlterID in Tally
	number   string
	reply    string // Tally's import reply
	sent     []string
	reads    int
	queued   []*change
	typing   bool
	readErr  error
	afterNum string // the number Tally holds after the import ("" : the one sent)
	gstin    string // the entry's PARTYGSTIN in Tally ("" : none on the entry)
	keepGST  bool   // Tally keeps its own PARTYGSTIN after the import
	// review of 0e0e0f3a1: the entry's party ledger (PARTYLEDGERNAME; "-": none on the entry) and its group as
	// FinComLedgerByName reads it ("" : Sundry Debtors; "-": no PARENT); the ledger reads counted apart
	party, partyGroup string
	ledReads          int
}

func (s *fixStand) install(t *testing.T) {
	t.Helper()
	logFileOverride = filepath.Join(t.TempDir(), "tds-bridge.log") // the fix's log line never in the package folder
	t.Cleanup(func() { logFileOverride = "" })
	o1, o2, o3, o4, o5 := fixReadVoucherFn, fixSendFn, fixQueueFn, fixTypingFn, fixPortFn
	t.Cleanup(func() { fixReadVoucherFn, fixSendFn, fixQueueFn, fixTypingFn, fixPortFn = o1, o2, o3, o4, o5 })
	o6, o7, o8 := fixReadLedgerFn, fixBooksFromFn, fixGroupsFn
	t.Cleanup(func() { fixReadLedgerFn, fixBooksFromFn, fixGroupsFn = o6, o7, o8 })
	fixBooksFromFn = func(string) (string, error) { return "20250401", nil }
	fixGroupsFn = func(string) [][2]string { return nil }
	fixReadLedgerFn = func(port int, company, bf, name string) (string, error) {
		s.ledReads++
		par := "<PARENT>" + or(s.partyGroup, "Sundry Debtors") + "</PARENT>"
		if s.partyGroup == "-" {
			par = ""
		}
		return `<ENVELOPE><LEDGER NAME="` + name + `"><GUID>g-led-1</GUID><MASTERID>5</MASTERID><ALTERID>11</ALTERID><NAME>` + name + `</NAME>` + par + `</LEDGER></ENVELOPE>`, nil
	}
	fixPortFn = func(p M) (int, string, error) { return 9000, fxCo, nil }
	fixTypingFn = func() bool { return s.typing }
	fixReadVoucherFn = func(port int, company, mid, date string) (string, error) {
		s.reads++
		if s.readErr != nil {
			return "", s.readErr
		}
		return `<VOUCHER REMOTEID="` + fxGUID + `" VCHTYPE="Sales"><GUID>` + fxGUID + `</GUID><MASTERID>42</MASTERID><ALTERID>` + s.alter +
			`</ALTERID><DATE>20260525</DATE><VOUCHERTYPENAME>Sales</VOUCHERTYPENAME><VOUCHERNUMBER>` + s.number + `</VOUCHERNUMBER>` + partyTag(s.party) + gstTag(s.gstin) + `<NARRATION>made up</NARRATION>` +
			`<ALLLEDGERENTRIES.LIST><LEDGERNAME>Sample Buyer</LEDGERNAME><AMOUNT>-100.00</AMOUNT></ALLLEDGERENTRIES.LIST></VOUCHER>`, nil
	}
	fixSendFn = func(port int, x string) (string, error) {
		s.sent = append(s.sent, x)
		if strings.Contains(s.reply, "<ALTERED>1") {
			s.alter = "99"
			s.number = or(s.afterNum, or(group(`<VOUCHERNUMBER>([^<]*)</VOUCHERNUMBER>`, x, 1), s.number))
			if g := group(`<PARTYGSTIN>([^<]*)</PARTYGSTIN>`, x, 1); g != "" && !s.keepGST {
				s.gstin = g
			}
		}
		return s.reply, nil
	}
	fixQueueFn = func(c *change) { s.queued = append(s.queued, c) }
}

func gstTag(g string) string {
	if g == "" {
		return ""
	}
	return "<PARTYGSTIN>" + g + "</PARTYGSTIN>"
}

func fixAsk(alter string) M {
	return M{"company": fxCo, "companyGuid": "co-guid-1", "target": "voucher", "guid": fxGUID, "masterId": "42", "alterId": alter,
		"vchType": "Sales", "vchDate": "20260525", "fields": M{"number": "INV/26-27/0084"}}
}

func TestFixSendsOneAlterAndReadsBack(t *testing.T) {
	s := &fixStand{alter: "57", number: "INV/2026-27/0084'", reply: "<RESPONSE><CREATED>0</CREATED><ALTERED>1</ALTERED><ERRORS>0</ERRORS></RESPONSE>"}
	s.install(t)
	r := runFix(fixAsk("57"))
	if r["ok"] != true {
		t.Fatalf("not done: %v", r)
	}
	if len(s.sent) != 1 || tallyRequestID(s.sent[0]) != fixVoucherID || checkAllowed(s.sent[0]) != nil {
		t.Fatalf("sent %d, %v", len(s.sent), s.sent)
	}
	if s.reads != 2 {
		t.Fatalf("%d reads of the entry (one before, one after)", s.reads)
	}
	if str(r["alterBefore"]) != "57" || str(r["alterAfter"]) != "99" || str(obj(r["before"])["number"]) != "INV/2026-27/0084'" || str(obj(r["after"])["number"]) != "INV/26-27/0084" {
		t.Fatalf("result %v", r)
	}
	if !strings.Contains(str(r["xml"]), "<VOUCHERNUMBER>INV/26-27/0084</VOUCHERNUMBER>") {
		t.Fatal("the entry read back is not in the result")
	}
	if len(s.queued) != 1 || s.queued[0].event != "altered" || s.queued[0].guid != fxGUID || s.queued[0].alterId != "99" || s.queued[0].xml == "" || s.queued[0].source != "fix" {
		t.Fatalf("the altered line: %+v", s.queued)
	}
}

func TestFixNeverOverwritesALaterChange(t *testing.T) {
	s := &fixStand{alter: "60", number: "INV/X", reply: "<RESPONSE><ALTERED>1</ALTERED></RESPONSE>"}
	s.install(t)
	r := runFix(fixAsk("57"))
	if r["ok"] != false || r["changed"] != true || len(s.sent) != 0 {
		t.Fatalf("sent over a later change: %v, %d sent", r, len(s.sent))
	}
	if str(obj(r["now"])["number"]) != "INV/X" || str(r["alterNow"]) != "60" || str(r["xml"]) == "" {
		t.Fatalf("the entry as it is now is not given: %v", r)
	}
}

func TestFixTallyRefusesInItsWords(t *testing.T) {
	s := &fixStand{alter: "57", number: "A", reply: "<RESPONSE><CREATED>0</CREATED><ALTERED>0</ALTERED><ERRORS>1</ERRORS><LINEERROR>Voucher Number &apos;X&apos; already exists!</LINEERROR></RESPONSE>"}
	s.install(t)
	r := runFix(fixAsk("57"))
	if r["ok"] != false || r["refused"] != true || !strings.Contains(str(r["message"]), "already exists") {
		t.Fatalf("%v", r)
	}
	if len(s.queued) != 0 {
		t.Fatal("a refused change queued as altered")
	}
}

func TestFixWaitsWhileTyping(t *testing.T) {
	s := &fixStand{alter: "57", typing: true}
	s.install(t)
	r := runFix(fixAsk("57"))
	if r["ok"] != false || r["held"] != true || s.reads != 0 || len(s.sent) != 0 {
		t.Fatalf("%v (reads %d)", r, s.reads)
	}
}

func TestFixHeldWhenTallyClosed(t *testing.T) {
	s := &fixStand{alter: "57"}
	s.install(t)
	fixPortFn = func(p M) (int, string, error) { return 0, "", errors.New("Tally is closed") }
	r := runFix(fixAsk("57"))
	if r["ok"] != false || r["held"] != true || s.reads != 0 {
		t.Fatalf("%v", r)
	}
}

func TestFixRefusesWhatWasNotApproved(t *testing.T) {
	s := &fixStand{alter: "57", number: "A", reply: "<RESPONSE><ALTERED>1</ALTERED></RESPONSE>"}
	s.install(t)
	a := fixAsk("57")
	a["fields"] = M{"narration": "x"}
	if r := runFix(a); r["ok"] != false || len(s.sent) != 0 || s.reads != 0 {
		t.Fatalf("%v", r)
	}
	a = fixAsk("")
	if r := runFix(a); r["ok"] != false || len(s.sent) != 0 {
		t.Fatalf("no AlterID given, yet sent: %v", r)
	}
}

func TestFixNoAnswerDecidedByTheReadBack(t *testing.T) {
	s := &fixStand{alter: "57", number: "A"}
	s.install(t)
	fixSendFn = func(port int, x string) (string, error) {
		s.sent = append(s.sent, x)
		s.alter, s.number = "58", "INV/26-27/0084" // Tally made it, its answer lost
		return "", errTimeout
	}
	r := runFix(fixAsk("57"))
	if r["ok"] != true || len(s.queued) != 1 {
		t.Fatalf("made but not taken as made: %v", r)
	}
}

func TestFixPlaceOfSupplyByCode(t *testing.T) {
	s := &fixStand{alter: "57", number: "A", reply: "<RESPONSE><ALTERED>1</ALTERED></RESPONSE>"}
	s.install(t)
	a := fixAsk("57")
	a["fields"] = M{"pos": "22"}
	runFix(a)
	if len(s.sent) != 1 || !strings.Contains(s.sent[0], "<PLACEOFSUPPLY>Chhattisgarh</PLACEOFSUPPLY>\n") {
		t.Fatalf("sent %v", s.sent)
	}
}

func TestFixLedgerGSTIN(t *testing.T) {
	s := &fixStand{}
	s.install(t)
	o1, o2, o3 := fixReadLedgerFn, fixLedgerSendFn, fixBooksFromFn
	t.Cleanup(func() { fixReadLedgerFn, fixLedgerSendFn, fixBooksFromFn = o1, o2, o3 })
	fixBooksFromFn = func(string) (string, error) { return "20250401", nil }
	gst, alter := "", "11"
	led := func() string {
		return `<ENVELOPE><LEDGER NAME="Sample Buyer"><GUID>g-led-1</GUID><MASTERID>5</MASTERID><ALTERID>` + alter + `</ALTERID><NAME>Sample Buyer</NAME><PARENT>Sundry Debtors</PARENT>` +
			`<PARTYGSTIN>` + gst + `</PARTYGSTIN><LEDGSTREGDETAILS.LIST><APPLICABLEFROM>20240401</APPLICABLEFROM><GSTREGISTRATIONTYPE>Unregistered/Consumer</GSTREGISTRATIONTYPE><GSTIN>` + gst +
			`</GSTIN></LEDGSTREGDETAILS.LIST></LEDGER></ENVELOPE>`
	}
	reads, sentUp := 0, 0
	fixReadLedgerFn = func(port int, company, bf, name string) (string, error) { reads++; return led(), nil }
	fixLedgerSendFn = func(company, guid, bf string, rows []ledRow) error { sentUp++; return nil }
	fixSendFn = func(port int, x string) (string, error) {
		s.sent = append(s.sent, x)
		gst, alter = group(`<GSTIN>([^<]*)</GSTIN>`, x, 1), "12"
		return "<RESPONSE><ALTERED>1</ALTERED></RESPONSE>", nil
	}
	ask := M{"company": fxCo, "companyGuid": "co-guid-1", "target": "ledger", "ledger": "Sample Buyer", "alterId": "11", "was": M{"gstin": ""}, "fields": M{"gstin": "27AAPFU0939F1ZV"}}
	r := runFix(ask)
	if r["ok"] != true || len(s.sent) != 1 || reads != 2 || sentUp != 1 {
		t.Fatalf("%v sent %d reads %d up %d", r, len(s.sent), reads, sentUp)
	}
	// the dated record as read; read as Unregistered/Consumer and given a GSTIN: sent as Regular
	if !strings.Contains(s.sent[0], "<APPLICABLEFROM>20240401</APPLICABLEFROM>\n<GSTREGISTRATIONTYPE>Regular</GSTREGISTRATIONTYPE>") || checkAllowed(s.sent[0]) != nil {
		t.Fatalf("not the approved shape with the dated record as read (an unregistered party given a GSTIN as Regular): %s", s.sent[0])
	}
	// FinCom showed a GSTIN Tally no longer has: nothing sent
	ask["was"], ask["alterId"] = M{"gstin": "27AAAAA0000A1Z5"}, "12"
	if r := runFix(ask); r["changed"] != true || len(s.sent) != 1 {
		t.Fatalf("sent over a later change: %v", r)
	}
}

// the whole path against the stand-in Tally: this user's own Tally, the linked company, the entry read by MasterID, the
// one Alter through every check of invokeTally (the allow-list, the pin), the entry read back, the altered line queued
func TestFixThroughTheBridge(t *testing.T) {
	f := newStandTally(t)
	standBridge(t, f, "")
	v := f.add(today(), fgParty, "J/0001'", "made up", "10.00")
	var imports []string
	f.behave = func(w http.ResponseWriter, r *http.Request, id, body string) bool {
		if id != "Import" || !strings.Contains(body, `ACTION="Alter"`) {
			return false
		}
		f.mu.Lock()
		imports = append(imports, body)
		f.alter++
		v.no, v.alter = group(`<VOUCHERNUMBER>([^<]*)</VOUCHERNUMBER>`, body, 1), f.alter
		f.mu.Unlock()
		_, _ = w.Write([]byte("<RESPONSE><CREATED>0</CREATED><ALTERED>1</ALTERED><DELETED>0</DELETED><LASTVCHID>0</LASTVCHID><LASTMID>0</LASTMID><COMBINED>0</COMBINED><IGNORED>0</IGNORED><ERRORS>0</ERRORS><CANCELLED>0</CANCELLED></RESPONSE>"))
		return true
	}
	ask := M{"company": zz, "companyGuid": "co-guid-1", "target": "voucher", "guid": v.guid, "masterId": v.master, "alterId": fmt.Sprint(v.alter),
		"vchType": "Journal", "vchDate": v.date, "fields": M{"number": "J/0001"}}
	r := runFix(ask)
	if r["ok"] != true || len(imports) != 1 || tallyRequestID(imports[0]) != fixVoucherID {
		t.Fatalf("%v (%d imports)", r, len(imports))
	}
	if n := f.n(vchObjectID); n != 2 {
		t.Fatalf("%d reads of the entry", n)
	}
	live.mu.Lock()
	q := 0
	for _, c := range live.queue {
		if c.guid == v.guid && c.event == "altered" && strings.Contains(c.xml, "J/0001<") {
			q++
		}
	}
	live.mu.Unlock()
	if q != 1 {
		t.Fatalf("%d altered lines queued", q)
	}
	// asked again with the AlterID it had: changed since, nothing sent
	if r := runFix(ask); r["changed"] != true || len(imports) != 1 {
		t.Fatalf("%v", r)
	}
}

// postings first: while an import goes to Tally a fix is held, nothing read or sent
func TestFixWaitsForAPosting(t *testing.T) {
	s := &fixStand{alter: "57", number: "A", reply: "<RESPONSE><ALTERED>1</ALTERED></RESPONSE>"}
	s.install(t)
	importsInFlight.Add(1)
	r := runFix(fixAsk("57"))
	importsInFlight.Add(-1)
	if r["ok"] != false || r["held"] != true || s.reads != 0 || len(s.sent) != 0 {
		t.Fatalf("not held behind the posting: %v (reads %d, sent %d)", r, s.reads, len(s.sent))
	}
	if r := runFix(fixAsk("57")); r["ok"] != true || len(s.sent) != 1 {
		t.Fatalf("not sent once the posting went: %v", r)
	}
}

// a ledger's PAN: the PAN form only (no GST part); its AlterID, when FinCom gives one, is checked first; Tally's words
func TestFixLedgerPAN(t *testing.T) {
	s := &fixStand{}
	s.install(t)
	o1, o2, o3 := fixReadLedgerFn, fixLedgerSendFn, fixBooksFromFn
	t.Cleanup(func() { fixReadLedgerFn, fixLedgerSendFn, fixBooksFromFn = o1, o2, o3 })
	fixBooksFromFn = func(string) (string, error) { return "20250401", nil }
	pan, alter, reply := "", "21", "<RESPONSE><ALTERED>1</ALTERED></RESPONSE>"
	fixReadLedgerFn = func(port int, company, bf, name string) (string, error) {
		return `<ENVELOPE><LEDGER NAME="Sample Vendor"><GUID>g-led-2</GUID><MASTERID>6</MASTERID><ALTERID>` + alter + `</ALTERID><NAME>Sample Vendor</NAME><PARENT>Sundry Creditors</PARENT>` +
			`<INCOMETAXNUMBER>` + pan + `</INCOMETAXNUMBER></LEDGER></ENVELOPE>`, nil
	}
	fixLedgerSendFn = func(company, guid, bf string, rows []ledRow) error { return nil }
	fixSendFn = func(port int, x string) (string, error) {
		s.sent = append(s.sent, x)
		if strings.Contains(reply, "<ALTERED>1") {
			pan, alter = group(`<INCOMETAXNUMBER>([^<]*)</INCOMETAXNUMBER>`, x, 1), "22"
		}
		return reply, nil
	}
	ask := M{"company": fxCo, "companyGuid": "co-guid-1", "target": "ledger", "ledger": "Sample Vendor", "alterId": "20", "was": M{"pan": ""}, "fields": M{"pan": "AAAPZ9999Z"}}
	if r := runFix(ask); r["changed"] != true || len(s.sent) != 0 {
		t.Fatalf("sent over a later change (AlterID 20, Tally 21): %v", r)
	}
	ask["alterId"] = "21"
	reply = "<RESPONSE><ALTERED>0</ALTERED><ERRORS>1</ERRORS><LINEERROR>Made-up refusal words</LINEERROR></RESPONSE>"
	if r := runFix(ask); r["refused"] != true || !strings.Contains(str(r["message"]), "Made-up refusal words") {
		t.Fatalf("Tally's own words not given: %v", r)
	}
	reply = "<RESPONSE><ALTERED>1</ALTERED></RESPONSE>"
	r := runFix(ask)
	if r["ok"] != true || len(s.sent) != 2 {
		t.Fatalf("%v (%d sent)", r, len(s.sent))
	}
	x := s.sent[1]
	if strings.Contains(x, "GSTIN") || strings.Contains(x, "LEDGSTREGDETAILS") || !strings.Contains(x, "<INCOMETAXNUMBER>AAAPZ9999Z</INCOMETAXNUMBER>\n</LEDGER>") ||
		tallyRequestID(x) != fixLedgerID || checkAllowed(x) != nil {
		t.Fatalf("not the approved PAN form: %s", x)
	}
}

// the entry's PARTYLEDGERNAME in the stand ("" : Sample Buyer; "-": none)
func partyTag(p string) string {
	if p == "-" {
		return ""
	}
	return "<PARTYLEDGERNAME>" + or(p, "Sample Buyer") + "</PARTYLEDGERNAME>"
}
