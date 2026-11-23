package main

// FinCom Bridge 2.5.19: the requests the owner approved on 23-Nov-2026 (docs/bridge-2.5.19-new-requests.md): each one's
// builder exactly as the paper shows it, pinned, on the list NOT yet measured, the switches for the names to confirm off;
// and each wired where the owner said: B1 after a day's list is stopped at 2 s, C1 to C4 and C6 in the masters read, C5
// on the entries, C7 on the ledger rows, C8 in the daily idle catch-up only, E before a re-sent entry's first part. Made-up
// data only; nothing reaches a real Tally or cloud.
import (
	"fmt"
	"net/http"
	"regexp"
	"strings"
	"testing"
	"time"
)

// --- the requests as built: byte for byte the paper's XML (SAMPLE CO)

const r2519DayPart = `<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>FinComDayHeadsPart</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVCURRENTCOMPANY>SAMPLE CO</SVCURRENTCOMPANY><SVFROMDATE TYPE="Date">20260401</SVFROMDATE><SVTODATE TYPE="Date">20260401</SVTODATE></STATICVARIABLES><TDL><TDLMESSAGE><COLLECTION NAME="FinComDayHeadsPart" ISMODIFY="No"><TYPE>Voucher</TYPE><FETCH>GUID, MASTERID, ALTERID, DATE</FETCH><FILTERS>FinComDayHeadsPartOnly</FILTERS></COLLECTION><SYSTEM TYPE="Formulae" NAME="FinComDayHeadsPartOnly">$MasterID &gt;= 1 AND $MasterID &lt;= 4000</SYSTEM></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>`
const r2519DayPartEnd = `<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>FinComDayHeadsPart</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVCURRENTCOMPANY>SAMPLE CO</SVCURRENTCOMPANY><SVFROMDATE TYPE="Date">20260401</SVFROMDATE><SVTODATE TYPE="Date">20260401</SVTODATE></STATICVARIABLES><TDL><TDLMESSAGE><COLLECTION NAME="FinComDayHeadsPart" ISMODIFY="No"><TYPE>Voucher</TYPE><FETCH>GUID, MASTERID, ALTERID, DATE</FETCH><FILTERS>FinComDayHeadsPartOnly</FILTERS></COLLECTION><SYSTEM TYPE="Formulae" NAME="FinComDayHeadsPartOnly">$MasterID &gt;= 96001</SYSTEM></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>`
const r2519BillOpen = `<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>FinComBillOpenings</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVCURRENTCOMPANY>SAMPLE CO</SVCURRENTCOMPANY><SVFROMDATE TYPE="Date">20250401</SVFROMDATE><SVTODATE TYPE="Date">20260331</SVTODATE></STATICVARIABLES><TDL><TDLMESSAGE><COLLECTION NAME="FinComBillOpenings" ISMODIFY="No"><TYPE>Ledger</TYPE><FETCH>GUID, MASTERID, ALTERID, NAME, ISBILLWISEON, BILLALLOCATIONS.NAME, BILLALLOCATIONS.BILLDATE, BILLALLOCATIONS.OPENINGBALANCE, BILLALLOCATIONS.BILLCREDITPERIOD, BILLALLOCATIONS.ISADVANCE</FETCH><FILTERS>FinComBillOpeningsOnly</FILTERS></COLLECTION><SYSTEM TYPE="Formulae" NAME="FinComBillOpeningsOnly">$IsBillWiseOn AND $MasterID &gt; 0 AND $MasterID &lt;= 500</SYSTEM></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>`
const r2519VchTypesGst = `<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>FinComVoucherTypes</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVCURRENTCOMPANY>SAMPLE CO</SVCURRENTCOMPANY></STATICVARIABLES><TDL><TDLMESSAGE><COLLECTION NAME="FinComVoucherTypes" ISMODIFY="No"><TYPE>VoucherType</TYPE><FETCH>GUID, MASTERID, ALTERID, NAME, PARENT, NUMBERINGMETHOD, ISACTIVE, AFFECTSSTOCK, ISOPTIONAL, ISDEEMEDPOSITIVE, GSTREGISTRATION</FETCH><FILTERS>FinComVoucherTypesOnly</FILTERS></COLLECTION><SYSTEM TYPE="Formulae" NAME="FinComVoucherTypesOnly">$MasterID &gt; 0 AND $MasterID &lt;= 2000</SYSTEM></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>`
const r2519CostCentres = `<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>FinComCostCentres</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVCURRENTCOMPANY>SAMPLE CO</SVCURRENTCOMPANY></STATICVARIABLES><TDL><TDLMESSAGE><COLLECTION NAME="FinComCostCentres" ISMODIFY="No"><TYPE>CostCentre</TYPE><FETCH>GUID, MASTERID, ALTERID, NAME, PARENT, CATEGORY, FORPAYROLL, ISEMPLOYEEGROUP</FETCH><FILTERS>FinComCostCentresOnly</FILTERS></COLLECTION><SYSTEM TYPE="Formulae" NAME="FinComCostCentresOnly">$MasterID &gt; 0 AND $MasterID &lt;= 2000</SYSTEM></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>`
const r2519CostCats = `<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>FinComCostCategories</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVCURRENTCOMPANY>SAMPLE CO</SVCURRENTCOMPANY></STATICVARIABLES><TDL><TDLMESSAGE><COLLECTION NAME="FinComCostCategories" ISMODIFY="No"><TYPE>CostCategory</TYPE><FETCH>GUID, MASTERID, ALTERID, NAME, ALLOCATEREVENUE, ALLOCATENONREVENUE</FETCH></COLLECTION></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>`
const r2519GstRegs = `<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>FinComGstRegistrations</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVCURRENTCOMPANY>SAMPLE CO</SVCURRENTCOMPANY></STATICVARIABLES><TDL><TDLMESSAGE><COLLECTION NAME="FinComGstRegistrations" ISMODIFY="No"><TYPE>TaxUnit</TYPE><FETCH>GUID, MASTERID, ALTERID, NAME, GSTREGNUMBER, STATENAME, GSTREGISTRATIONTYPE, APPLICABLEFROM, ISACTIVE</FETCH></COLLECTION></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>`
const r2519GroupClosing = `<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>FinComGroupClosing</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVCURRENTCOMPANY>SAMPLE CO</SVCURRENTCOMPANY><SVFROMDATE TYPE="Date">20260401</SVFROMDATE><SVTODATE TYPE="Date">20261122</SVTODATE></STATICVARIABLES><TDL><TDLMESSAGE><COLLECTION NAME="FinComGroupClosing" ISMODIFY="No"><TYPE>Group</TYPE><FETCH>GUID, NAME, PARENT, CLOSINGBALANCE</FETCH><FILTERS>FinComGroupClosingOnly</FILTERS></COLLECTION><SYSTEM TYPE="Formulae" NAME="FinComGroupClosingOnly">$Parent = &#34;&#34;</SYSTEM></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>`

func r2519Confirm(t *testing.T, keys ...string) {
	t.Helper()
	for _, k := range keys {
		setCfg(k, true)
		k := k
		t.Cleanup(func() { setCfg(k, false) })
	}
}

func TestR2519RequestsAsTheOwnerApproved(t *testing.T) {
	const c = "SAMPLE CO"
	for name, p := range map[string][2]string{
		"B1 band":            {dayPartRequest(c, "20260401", 1, 4000), r2519DayPart},
		"B1 last band":       {dayPartRequest(c, "20260401", 96001, 0), r2519DayPartEnd},
		"C1":                 {billOpenRequest(c, "20250401", 0, 500), r2519BillOpen},
		"C3":                 {costCentresRequest(c, 0, 2000), r2519CostCentres},
		"C4":                 {costCatsRequest(c), r2519CostCats},
		"C6 (as it will be)": {gstRegsRequestBuilt(c), r2519GstRegs},
		"C8 (as it will be)": {groupClosingRequestBuilt(c, "20261122"), r2519GroupClosing},
	} {
		if p[0] != p[1] {
			t.Errorf("%s is not the approved request:\n got %s\nwant %s", name, p[0], p[1])
		}
	}
	// C2: without the name to confirm while its switch is off; with it, exactly the paper's request
	if x := vchTypesRequest(c, 0, 2000); x != strings.Replace(r2519VchTypesGst, ", GSTREGISTRATION", "", 1) {
		t.Errorf("C2 with GSTREGISTRATION unconfirmed: %s", x)
	}
	// C6 and C8 are not built at all while unconfirmed
	if gstRegsRequest(c) != "" || groupClosingRequest(c, "20261122") != "" {
		t.Error("C6 or C8 built before its names are confirmed")
	}
	r2519Confirm(t, "Confirmed2519VchTypeGst", "Confirmed2519GstRegs", "Confirmed2519GroupClosing")
	if vchTypesRequest(c, 0, 2000) != r2519VchTypesGst || gstRegsRequest(c) != r2519GstRegs || groupClosingRequest(c, "20261122") != r2519GroupClosing {
		t.Error("with the names confirmed, C2, C6 or C8 is not the paper's request")
	}
	// C8: the financial year's first day for a day before April
	if fyStartOf("20270215") != "20260401" || fyStartOf("20260401") != "20260401" || fyStartOf("20260331") != "20250401" {
		t.Error("the financial year's first day")
	}
	// B1: nothing for a band that is not one
	for _, x := range []string{dayPartRequest(c, "20260401", 0, 10), dayPartRequest(c, "20260401", 10, 9), dayPartRequest(c, "2026-04-01", 1, 9)} {
		if x != "" {
			t.Errorf("a bad band was built: %s", x)
		}
	}
}

// C7: the ledger request's FETCH: 2.5.18's, then the added fields; the two lists only once confirmed
func TestR2519LedgerFields(t *testing.T) {
	want := ledFetch244 + ", GSTREGISTRATIONTYPE, ISBILLWISEON, BILLCREDITPERIOD, ISCOSTCENTRESON, ADDRESS.LIST, PINCODE, COUNTRYNAME"
	if ledFetch != want || ledFetchNow() != want {
		t.Fatalf("the ledger fields: %s", ledFetchNow())
	}
	for _, x := range []string{ledgerChunkRequestAt(zz, "20250401", 0, 2000), ledgerChangesRequestAt(zz, "20250401", 0, 200), ledgerByNameRequestAt(zz, "20250401", "Party A")} {
		if group(`<FETCH>([^<]*)</FETCH>`, x, 1) != want {
			t.Fatalf("a ledger request without the added fields: %s", x)
		}
	}
	r2519Confirm(t, "Confirmed2519LedgerLists")
	full := ledFetch244 + ", GSTREGISTRATIONTYPE, ISBILLWISEON, BILLCREDITPERIOD, ISCOSTCENTRESON, LEDMAILINGDETAILS.LIST, ADDRESS.LIST, PINCODE, COUNTRYNAME, LEDMSMEREGDETAILS.LIST"
	if ledFetchNow() != full || group(`<FETCH>([^<]*)</FETCH>`, ledgerChunkRequestAt(zz, "20250401", 0, 2000), 1) != full {
		t.Fatal("the confirmed lists are not asked")
	}
	if !ledgerPeriodExact(ledgerChunkRequestAt(zz, "20250401", 0, 2000)) && booksFromOf(zz) == "20250401" {
		t.Fatal("the confirmed form is not pinned")
	}
}

// C5: the post-dated mark kept from the entry's answer, and asked by the group request at the end of its FETCH
func TestR2519PostDatedMark(t *testing.T) {
	if !fastApprovedPaths()["ISPOSTDATED"] {
		t.Fatal("ISPOSTDATED is not kept by the strip")
	}
	if !strings.HasSuffix(batchFetchText, ", ISPOSTDATED") || !batchFetchOK() {
		t.Fatalf("the group request's FETCH does not end with ISPOSTDATED: ...%s", batchFetchText[len(batchFetchText)-60:])
	}
	if strings.Contains(voucherObjectRequest(zz, "7"), "ISPOSTDATED") {
		t.Fatal("the entry request changed (its FETCHLIST is 2.5.18's; Tally sends the whole voucher)")
	}
}

// pinned: each new id goes only as its builder makes it from its own parameters
func TestR2519Pinned(t *testing.T) {
	r2519Confirm(t, "Confirmed2519VchTypeGst", "Confirmed2519GstRegs", "Confirmed2519GroupClosing")
	ok := []string{dayPartRequest(zz, "20250831", 201, 600), dayPartRequest(zz, "20250831", 601, 0), billOpenRequest(zz, "20250401", 500, 1000), vchTypesRequest(zz, 0, 2000),
		costCentresRequest(zz, 2000, 0), costCatsRequest(zz), gstRegsRequest(zz), groupClosingRequest(zz, "20261122")}
	for _, x := range ok {
		if !pinnedToBuilder(tallyRequestID(x), x) {
			t.Errorf("not pinned to its builder: %s", x)
		}
	}
	bad := []string{
		strings.Replace(ok[0], "GUID, MASTERID", "GUID, NARRATION, MASTERID", 1),
		strings.Replace(ok[0], "&gt;= 201", "&gt;= 0201", 1),
		strings.Replace(ok[0], `<SVTODATE TYPE="Date">20250831`, `<SVTODATE TYPE="Date">20250901`, 1),
		strings.Replace(ok[2], "$IsBillWiseOn AND ", "", 1),
		strings.Replace(ok[3], "<TYPE>VoucherType</TYPE>", "<TYPE>Ledger</TYPE>", 1),
		strings.Replace(ok[5], "ALLOCATENONREVENUE", "ALLOCATENONREVENUE, CLOSINGBALANCE", 1),
		strings.Replace(ok[7], `<SVFROMDATE TYPE="Date">20260401`, `<SVFROMDATE TYPE="Date">20250401`, 1),
		strings.Replace(ok[7], "$Parent = &#34;&#34;", "$Parent = &#34;Assets&#34;", 1),
	}
	for _, x := range bad {
		if pinnedToBuilder(tallyRequestID(x), x) {
			t.Errorf("a changed request passes its pin: %s", x)
		}
	}
	setCfg("Confirmed2519GroupClosing", false)
	setCfg("Confirmed2519GstRegs", false)
	if pinnedToBuilder(groupClosingID, ok[7]) || pinnedToBuilder(gstRegsID, ok[6]) {
		t.Error("C6 or C8 passes its pin while its names are unconfirmed")
	}
}

// on the list, NOT yet measured, each with the owner's decision; the classes
func TestR2519OnTheList(t *testing.T) {
	for _, id := range []string{dayPartID, billOpenID, vchTypesID, costCentresID, costCatsID, gstRegsID, groupClosingID} {
		a, ok := tallyAllowList[id]
		if !ok || a.maxSec != 0 || a.measuredOn != "" || a.measureOnly || !strings.Contains(a.purpose, "allowed for 2.5.19 by the owner's decision of 2026-11-23, NOT yet measured") {
			t.Errorf("%s: %+v %v", id, a, ok)
		}
		if !strings.Contains(allowListRows(), "| "+id+" |") || requestClass[id] == "" {
			t.Errorf("%s is not in the table or has no class", id)
		}
	}
	if requestClass[dayPartID] != "exception" || requestClass[groupClosingID] != "exception" || requestClass[billOpenID] != "ledgerPeriod" || requestClass[costCatsID] != "undated" {
		t.Error("the classes")
	}
	if computedFigure(billOpenRequest(zz, "20250401", 0, 500)) != "" {
		t.Error("C1's stored opening bills with the books' first year are taken for a figure Tally works out")
	}
	if computedFigure(groupClosingRequestBuilt(zz, "20261122")) != "" {
		t.Error("C8 is not the narrow exception the owner allowed")
	}
	if computedFigure(strings.Replace(groupClosingRequestBuilt(zz, "20261122"), "<TYPE>Group</TYPE>", "<TYPE>Ledger</TYPE>", 1)) == "" {
		t.Error("a ledger closing balance passes as C8")
	}
}

// --- C1 to C4, C6 and C7 in the masters read: asked exactly as built, the rows sent with the ledger list

func r2519MastersAnswer(f *standTally) {
	f.behave = func(w http.ResponseWriter, r *http.Request, id, body string) bool {
		x := ""
		switch id {
		case vchTypesID:
			x = `<VOUCHERTYPE NAME="Sales - Delhi"><GUID>vt-1</GUID><MASTERID> 41</MASTERID><ALTERID> 7</ALTERID><PARENT>Sales</PARENT><NUMBERINGMETHOD>Automatic</NUMBERINGMETHOD><ISACTIVE>Yes</ISACTIVE><AFFECTSSTOCK>No</AFFECTSSTOCK><ISOPTIONAL>No</ISOPTIONAL><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE></VOUCHERTYPE>`
		case costCentresID:
			x = `<COSTCENTRE NAME="Branch East"><GUID>cc-1</GUID><MASTERID> 51</MASTERID><ALTERID> 8</ALTERID><PARENT>&#4; Primary</PARENT><CATEGORY>Primary Cost Category</CATEGORY><FORPAYROLL>No</FORPAYROLL><ISEMPLOYEEGROUP>No</ISEMPLOYEEGROUP></COSTCENTRE>` +
				`<COSTCENTRE NAME="Asha Rao"><GUID>cc-2</GUID><MASTERID> 52</MASTERID><ALTERID> 9</ALTERID><PARENT>Office Staff</PARENT><CATEGORY>Primary Cost Category</CATEGORY><FORPAYROLL>Yes</FORPAYROLL><ISEMPLOYEEGROUP>No</ISEMPLOYEEGROUP></COSTCENTRE>`
		case costCatsID:
			x = `<COSTCATEGORY NAME="Primary Cost Category"><GUID>ck-1</GUID><MASTERID> 3</MASTERID><ALTERID> 3</ALTERID><ALLOCATEREVENUE>Yes</ALLOCATEREVENUE><ALLOCATENONREVENUE>No</ALLOCATENONREVENUE></COSTCATEGORY>`
		case billOpenID:
			if strings.Contains(body, "$MasterID &gt; 0 AND") {
				x = `<LEDGER NAME="Customer A"><GUID>led-a</GUID><MASTERID> 2</MASTERID><ALTERID> 2</ALTERID><ISBILLWISEON>Yes</ISBILLWISEON><BILLALLOCATIONS.LIST><NAME>INV-01</NAME><BILLDATE>20250310</BILLDATE><OPENINGBALANCE>-1500.00</OPENINGBALANCE><BILLCREDITPERIOD>30 Days</BILLCREDITPERIOD><ISADVANCE>No</ISADVANCE></BILLALLOCATIONS.LIST></LEDGER>`
			}
		case gstRegsID:
			x = `<TAXUNIT NAME="Delhi Registration"><GUID>tu-1</GUID><MASTERID> 61</MASTERID><ALTERID> 4</ALTERID><GSTREGNUMBER>07AAAAA0000A1Z5</GSTREGNUMBER><STATENAME>Delhi</STATENAME><GSTREGISTRATIONTYPE>Regular</GSTREGISTRATIONTYPE><APPLICABLEFROM>20250401</APPLICABLEFROM><ISACTIVE>Yes</ISACTIVE></TAXUNIT>`
		default:
			return false
		}
		_, _ = w.Write([]byte(`<ENVELOPE><BODY><DATA><COLLECTION>` + x + `</COLLECTION></DATA></BODY></ENVELOPE>`))
		return true
	}
}

func r2519Round(t *testing.T, confirm ...string) (*standTally, M) {
	t.Helper()
	f := newStandTally(t)
	c := newStandCloud(t)
	for _, n := range []string{"Customer A", "Supplier B"} {
		f.addLed(n, "Sundry Debtors", "0.00")
	}
	f.mu.Lock()
	r2519MastersAnswer(f)
	f.mu.Unlock()
	standBridge(t, f, `,"KeepBudgetSec":600`+c.cfg())
	r2519Confirm(t, confirm...)
	liveFrom(today())
	runNow(t, "now")
	cloudMu.Lock()
	cloudLinksAt = time.Time{}
	cloudMu.Unlock()
	invokeCloudPush()
	c.mu.Lock()
	defer c.mu.Unlock()
	if len(c.ledList) == 0 {
		t.Fatalf("no ledger_list; Tally was asked %v", f.ids())
	}
	return f, c.ledList[0]
}

func TestR2519MastersReadSendsTheBooksMasters(t *testing.T) {
	f, body := r2519Round(t)
	bf := booksFromOf(zz)
	for _, id := range []string{vchTypesID, costCentresID, costCatsID, billOpenID} {
		if f.n(id) < 1 {
			t.Fatalf("%s not asked in the masters read: %v", id, f.ids())
		}
	}
	if f.n(gstRegsID) != 0 {
		t.Fatal("C6 asked before its names are confirmed")
	}
	for _, b := range r2516Bodies(f, billOpenID) {
		if !pinnedToBuilder(billOpenID, b) || !strings.Contains(b, ledgerPeriodVars(bf)) {
			t.Fatalf("C1 not as built with the books' first year: %s", b)
		}
	}
	for _, b := range r2516Bodies(f, vchTypesID) {
		if !pinnedToBuilder(vchTypesID, b) || strings.Contains(b, "GSTREGISTRATION") {
			t.Fatalf("C2 not as built: %s", b)
		}
	}
	books := obj(body["books"])
	if books == nil {
		t.Fatalf("no books masters with the ledger list: %v", body)
	}
	vt := arr(books["voucherTypes"])
	if len(vt) != 1 || str(at(arr(vt[0]), 3)) != "Sales - Delhi" || str(at(arr(vt[0]), 4)) != "Sales" || str(at(arr(vt[0]), 5)) != "Automatic" {
		t.Fatalf("voucher types: %v", books["voucherTypes"])
	}
	cc := arr(books["costCentres"])
	if len(cc) != 1 || str(at(arr(cc[0]), 3)) != "Branch East" || str(at(arr(cc[0]), 4)) != "" {
		t.Fatalf("cost centres (the payroll one dropped, Primary as none): %v", books["costCentres"])
	}
	if ck := arr(books["costCategories"]); len(ck) != 1 || str(at(arr(ck[0]), 3)) != "Primary Cost Category" {
		t.Fatalf("cost categories: %v", books["costCategories"])
	}
	bo := arr(books["billOpenings"])
	if len(bo) != 1 || jsonText(at(arr(bo[0]), 4)) != `[["INV-01","20250310","-1500.00","30 Days",false]]` {
		t.Fatalf("bill openings: %v", books["billOpenings"])
	}
	if _, has := books["gstRegistrations"]; has {
		t.Fatal("GST registrations sent while unconfirmed")
	}
	if strings.Contains(jsonText(body), "Asha Rao") {
		t.Fatal("a payroll centre went with the books masters")
	}
}

func TestR2519GstRegistrationsOnceConfirmed(t *testing.T) {
	f, body := r2519Round(t, "Confirmed2519GstRegs")
	if f.n(gstRegsID) != 1 {
		t.Fatalf("C6 asked %d times", f.n(gstRegsID))
	}
	g := arr(obj(body["books"])["gstRegistrations"])
	if len(g) != 1 || str(at(arr(g[0]), 4)) != "07AAAAA0000A1Z5" || str(at(arr(g[0]), 5)) != "Delhi" {
		t.Fatalf("GST registrations: %v", g)
	}
}

// a books master Tally does not answer in time never holds the ledger list: it goes without that kind this round
func TestR2519BooksMasterStoppedNeverHoldsLedgers(t *testing.T) {
	f := newStandTally(t)
	c := newStandCloud(t)
	f.addLed("Customer A", "Sundry Debtors", "0.00")
	f.mu.Lock()
	r2519MastersAnswer(f)
	f.slow = func(id, body string) time.Duration {
		if id == costCentresID {
			return 2600 * time.Millisecond
		}
		return 0
	}
	f.mu.Unlock()
	standBridge(t, f, `,"KeepBudgetSec":600`+c.cfg())
	liveFrom(today())
	runNow(t, "now")
	cloudMu.Lock()
	cloudLinksAt = time.Time{}
	cloudMu.Unlock()
	invokeCloudPush()
	c.mu.Lock()
	defer c.mu.Unlock()
	if len(c.ledList) != 1 {
		t.Fatalf("the ledger list did not go: %d", len(c.ledList))
	}
	books := obj(c.ledList[0]["books"])
	if _, has := books["costCentres"]; has || len(arr(books["voucherTypes"])) != 1 {
		t.Fatalf("after a stopped cost-centre read: %v", books)
	}
	if !strings.Contains(readText(logFile()), "the cost centres were not read") {
		t.Fatal("no log line for the stopped read")
	}
}

// the heavy tier: with someone using Tally in the last minute the books' masters wait for a later round; the ledger list goes
func TestR2519BooksMastersWaitForTyping(t *testing.T) {
	f := newStandTally(t)
	c := newStandCloud(t)
	f.addLed("Customer A", "Sundry Debtors", "0.00")
	f.mu.Lock()
	r2519MastersAnswer(f)
	f.mu.Unlock()
	standBridge(t, f, `,"KeepBudgetSec":600`+c.cfg())
	liveFrom(today())
	r2516Person(t, 30)
	runNow(t, "now")
	for _, id := range []string{vchTypesID, costCentresID, costCatsID, billOpenID} {
		if f.n(id) != 0 {
			t.Fatalf("%s asked while someone used Tally 30 s ago", id)
		}
	}
	if f.n(ledListID) == 0 {
		t.Fatal("the ledger list did not go")
	}
}

// C7: the added fields go as the ledger row's 19th column, an object
func TestR2519LedgerRowAddedFields(t *testing.T) {
	raw := `<ENVELOPE><LEDGER NAME="Customer A"><GUID>led-a</GUID><MASTERID> 2</MASTERID><ALTERID> 2</ALTERID><PARENT>Sundry Debtors</PARENT><OPENINGBALANCE>0</OPENINGBALANCE>` +
		`<GSTREGISTRATIONTYPE>Regular</GSTREGISTRATIONTYPE><ISBILLWISEON>Yes</ISBILLWISEON><BILLCREDITPERIOD>45 Days</BILLCREDITPERIOD><ISCOSTCENTRESON>No</ISCOSTCENTRESON>` +
		`<ADDRESS.LIST TYPE="String"><ADDRESS>12 Made-up Road</ADDRESS><ADDRESS>Sample Town</ADDRESS></ADDRESS.LIST><PINCODE>110001</PINCODE><COUNTRYNAME>India</COUNTRYNAME>` +
		`<LEDMSMEREGDETAILS.LIST><MSMEENTERPRISETYPE>Micro</MSMEENTERPRISETYPE><UDYAMREGNUMBER>UDYAM-XX-00-0000000</UDYAMREGNUMBER></LEDMSMEREGDETAILS.LIST></LEDGER></ENVELOPE>`
	rows, _ := ledRowsOf(raw)
	if len(rows) != 1 || rows[0].books != `{"address":["12 Made-up Road","Sample Town"],"billWise":"Yes","costCentres":"No","country":"India","creditPeriod":"45 Days","gstRegType":"Regular","pincode":"110001"}` {
		t.Fatalf("the added fields: %+v", rows)
	}
	r2519Confirm(t, "Confirmed2519LedgerLists")
	rows, _ = ledRowsOf(raw)
	if !strings.Contains(rows[0].books, `"udyam":"UDYAM-XX-00-0000000"`) || !strings.Contains(rows[0].books, `"msmeType":"Micro"`) {
		t.Fatalf("the confirmed MSME fields: %s", rows[0].books)
	}
	// held, read back and sent: the column after the pay-head fields
	r := rows[0]
	back := ledFromArr(r.guid, append(append(r.arr(), r.state, r.dtype, r.nature, r.special, r.ldc), r.payArr()...))
	if back != r {
		t.Fatalf("held and read back: %+v", back)
	}
	if c := ledBooksCol(r.books); len(c) != 1 || obj(c[0])["billWise"] != "Yes" {
		t.Fatalf("the column: %v", c)
	}
	if ledBooksCol("") != nil {
		t.Fatal("a ledger with none of the fields gets a column")
	}
}

// --- B1: a day too big for its one list, read in MasterID bands in the day

func r2519Bands(f *standTally, outside bool) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.behave = func(w http.ResponseWriter, r *http.Request, id, body string) bool {
		if id != dayPartID {
			return false
		}
		m := reDayPart.FindStringSubmatch(body)
		day, _ := pinDates(body)
		lo, hi := toI64(m[1]), toI64(m[2])
		var o strings.Builder
		o.WriteString(`<ENVELOPE><BODY><DATA><COLLECTION>`)
		f.mu.Lock()
		for _, v := range f.vch {
			mv := toI64(v.master)
			if v.date == day && mv >= lo && (hi == 0 || mv <= hi) || (outside && hi > 0 && mv == hi+1 && v.date == day) {
				fmt.Fprintf(&o, `<VOUCHER REMOTEID="%s" VCHTYPE="%s"><DATE TYPE="Date">%s</DATE><GUID>%s</GUID><VOUCHERTYPENAME>%s</VOUCHERTYPENAME><ALTERID TYPE="Number"> %d</ALTERID><MASTERID TYPE="Number"> %s</MASTERID></VOUCHER>`,
					v.guid, esc(v.typ), v.date, v.guid, esc(v.typ), v.alter, v.master)
			}
		}
		f.mu.Unlock()
		o.WriteString(`</COLLECTION></DATA></BODY></ENVELOPE>`)
		_, _ = w.Write([]byte(o.String()))
		return true
	}
}

func r2519BandDay(t *testing.T) (*standTally, *r2516Cloud, *pullModel) {
	t.Helper()
	f, c, m := pullBridge(t)
	x := r2516Stops(t, c)
	pullDay(f, "20250831", 1000, "Sales", "Sales", "Receipt", "Payment")
	pullDay(f, "20250830", 1500, "Sales") // another day's entry inside the bands' MasterIDs: never taken
	r2516SlowDay(f, "20250831")           // the day's one list (F1) over 2 s
	altMu.Lock()
	companyAlts[companyKey(zz)] = 2000 // the company check's AltVchId: the bands' span
	altMu.Unlock()
	return f, x, m
}

func TestR2519HeavyDayReadInBands(t *testing.T) {
	f, x, m := r2519BandDay(t)
	r2519Bands(f, false)
	r2516Person(t, 70)
	applyPeriodDays(pullList("20250831"))
	pullRun(t, 5)
	retryReset()
	pullRun(t, 40)
	bands := r2516Bodies(f, dayPartID)
	if len(bands) < 2 {
		t.Fatalf("%d bands asked: %v", len(bands), f.ids())
	}
	next := int64(1)
	for i, b := range bands {
		mm := reDayPart.FindStringSubmatch(b)
		if mm == nil || toI64(mm[1]) != next || !pinnedToBuilder(dayPartID, b) {
			t.Fatalf("band %d is not the next one as built (want from %d): %s", i, next, b)
		}
		if mm[2] == "" {
			if i != len(bands)-1 {
				t.Fatalf("an open band before the last: %s", b)
			}
			break
		}
		next = toI64(mm[2]) + 1
		if i == len(bands)-1 {
			t.Fatalf("the last band is not open-ended: %s", b)
		}
	}
	if len(r2516Bodies(f, dayHeadsID)) != 1 {
		t.Fatalf("the one-day list asked %d times (the by-type form must not follow it)", len(r2516Bodies(f, dayHeadsID)))
	}
	var via string
	for _, h := range m.heads {
		if str(h["day"]) == "20250831" && !truthy(h["upload"]) {
			via = str(h["via"])
			if h["partial"] == true {
				t.Fatal("a day read in bands told as partial")
			}
		}
	}
	if m.n["20250831"] != 4 || via != "bands" || f.n(vchObjectID) != 4 {
		t.Fatalf("the day in bands: n %v via %q, %d entries asked", m.n, via, f.n(vchObjectID))
	}
	if len(x.dayStops) != 0 || len(x.stops) != 0 {
		t.Fatalf("a day read in bands was stopped: %v %v", x.dayStops, x.stops)
	}
	if !strings.Contains(readText(logFile()), "read in pieces") {
		t.Fatal("no log line")
	}
}

func TestR2519BandRowOutsideDropsTheDay(t *testing.T) {
	f, x, m := r2519BandDay(t)
	r2519Bands(f, true)
	pullDay(f, "20250831", 201, "Sales") // MasterID 201 just past the first band [1, 200]: the stand lists it there too
	r2516Person(t, 70)
	applyPeriodDays(pullList("20250831"))
	pullRun(t, 5)
	retryReset()
	pullRun(t, 40)
	for _, h := range m.heads {
		if str(h["day"]) == "20250831" && !truthy(h["upload"]) {
			t.Fatalf("a list with a row outside its band was sent: %v", h)
		}
	}
	if len(x.dayStops) != 1 || str(x.dayStops[0]["why"]) != "dates" {
		t.Fatalf("the day is not held: %v", x.dayStops)
	}
}

func TestR2519BandStoppedHalvesThenStopsTheDay(t *testing.T) {
	f, x, _ := r2519BandDay(t)
	r2519Bands(f, false)
	f.mu.Lock()
	prev := f.slow
	f.slow = func(id, body string) time.Duration {
		if id == dayPartID {
			return 2500 * time.Millisecond // every band over 2 s
		}
		return prev(id, body)
	}
	f.mu.Unlock()
	r2516Person(t, 70)
	applyPeriodDays(pullList("20250831"))
	pullRun(t, 5)
	for i := 0; i < 6; i++ {
		retryReset()
		pullRun(t, 5)
	}
	bands := r2516Bodies(f, dayPartID)
	if len(bands) < 1 || len(bands) > 3 {
		t.Fatalf("%d bands asked", len(bands))
	}
	if len(x.dayStops) != 1 || str(x.dayStops[0]["why"]) != "over2s" {
		t.Fatalf("the day is not stopped after its smallest band: %v", x.dayStops)
	}
}

// with no span known (the company check gave no AltVchId) the bands are not used: 2.5.16's way
func TestR2519NoSpanNoBands(t *testing.T) {
	f, _, _ := r2519BandDay(t)
	altMu.Lock()
	companyAlts[companyKey(zz)] = 0
	altMu.Unlock()
	r2519Bands(f, false)
	r2516Person(t, 70)
	applyPeriodDays(pullList("20250831"))
	pullRun(t, 5)
	retryReset()
	pullRun(t, 20)
	if f.n(dayPartID) != 0 {
		t.Fatal("bands asked with no span")
	}
}

// the gate: a band goes only for the day being read in bands, under the 2 s stop
func TestR2519BandGate(t *testing.T) {
	x := dayPartRequest(zz, "20250831", 1, 200)
	if err := datedRefused(&TC{limitMs: 2000, copier: true}, x); err == nil {
		t.Fatal("a band went with no day being read in bands")
	}
}

// --- C8: the daily idle catch-up asks the primary groups' closings once a day; never otherwise

func r2519TieCloud(c *standCloud) *[]M {
	var got []M
	c.mu.Lock()
	prev := c.other
	c.other = func(k string, b M) (int, M) {
		if k == "tieout_groups" {
			got = append(got, b)
			return 200, M{"ok": true}
		}
		if prev != nil {
			return prev(k, b)
		}
		return 200, M{"ok": true}
	}
	c.mu.Unlock()
	return &got
}

func r2519TieTally(f *standTally) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.behave = func(w http.ResponseWriter, r *http.Request, id, body string) bool {
		if id != groupClosingID {
			return false
		}
		_, _ = w.Write([]byte(`<ENVELOPE><BODY><DATA><COLLECTION><GROUP NAME="Capital Account"><GUID>g-1</GUID><PARENT/><CLOSINGBALANCE>250000.00</CLOSINGBALANCE></GROUP>` +
			`<GROUP NAME="Sundry Debtors"><GUID>g-2</GUID><PARENT>&#4; Primary</PARENT><CLOSINGBALANCE>-4200.00</CLOSINGBALANCE></GROUP>` +
			`<GROUP NAME="Branch Debtors"><GUID>g-3</GUID><PARENT>Sundry Debtors</PARENT><CLOSINGBALANCE>-100.00</CLOSINGBALANCE></GROUP></COLLECTION></DATA></BODY></ENVELOPE>`))
		return true
	}
}

func r2519DayRun(t *testing.T) {
	t.Helper()
	if !startKeepRun(runReq{kind: "nightly", why: "test", short: true, day: true}) {
		t.Fatal("no daily catch-up started")
	}
	time.Sleep(50 * time.Millisecond)
	waitIdle(t)
}

func TestR2519TieOutInTheDailyCatchUpOnly(t *testing.T) {
	f := newStandTally(t)
	c := newStandCloud(t)
	f.addLed("Customer A", "Sundry Debtors", "0.00")
	r2519TieTally(f)
	got := r2519TieCloud(c)
	standBridge(t, f, `,"KeepBudgetSec":600`+c.cfg())
	liveFrom(today())
	// unconfirmed: never asked
	r2519DayRun(t)
	if f.n(groupClosingID) != 0 {
		t.Fatal("C8 asked before its filter is confirmed")
	}
	r2519Confirm(t, "Confirmed2519GroupClosing")
	// a plain Update now: never
	runNow(t, "now")
	if f.n(groupClosingID) != 0 {
		t.Fatal("C8 asked by Update now (the daily catch-up only)")
	}
	_ = saveFile(dayCheckFile(), "{}")
	r2519DayRun(t)
	if f.n(groupClosingID) != 1 {
		t.Fatalf("C8 asked %d times in the daily catch-up", f.n(groupClosingID))
	}
	b := r2516Bodies(f, groupClosingID)[0]
	if b != groupClosingRequest(zz, today()) {
		t.Fatalf("C8 not as built for today: %s", b)
	}
	if len(*got) != 1 {
		t.Fatalf("%d tie-outs sent", len(*got))
	}
	rows := arr((*got)[0]["groups"])
	if len(rows) != 2 || str(at(arr(rows[0]), 1)) != "Capital Account" || str(at(arr(rows[1]), 2)) != "-4200.00" || str((*got)[0]["at"]) != today() {
		t.Fatalf("the tie-out sent (primary groups only): %v", (*got)[0])
	}
	// once a day
	_ = saveFile(dayCheckFile(), "{}")
	r2519DayRun(t)
	if f.n(groupClosingID) != 1 {
		t.Fatal("C8 asked twice in a day")
	}
}

// --- E: an entry handed out again is looked for in Tally (FinComTag, its date) before its first part

func TestR2519ResentEntryLookedForFirst(t *testing.T) {
	td := today()
	f := newStandTally(t)
	c := newStandCloud(t)
	standBridge(t, f, `,"PostWaitMs":200`+c.cfg())
	f.add(td, fgParty, "R-31", "TDSDesk:r31 | posted from another computer", "-31.00") // already in Tally
	rel := func(id string) []any {
		return []any{M{"id": id, "at": time.Now().UTC().Format(time.RFC3339), "by": "owner", "why": "not in Tally (checked by the bridge)"}}
	}
	take := func(j M) M {
		c.mu.Lock()
		c.takeJobs = []M{j}
		c.mu.Unlock()
		cloudPostTake()
		time.Sleep(300 * time.Millisecond)
		return waitJob(t, str(j["id"]))
	}
	n0 := f.n(tagCheckID)
	va := []any{M{"id": "r31", "xml": finVoucher("r31", fgParty, "R-31", td, "31.00")}, M{"id": "r32", "xml": finVoucher("r32", fgParty, "R-32", td, "32.00")}}
	p := take(M{"id": "job-e1-000001", "company": zz, "payload": M{"vouchers": va}, "released": rel("r31"), "resendOnly": []any{"r31", "r32"}})
	if f.tagged("TDSDesk:r31") != 1 {
		t.Fatalf("r31 posted again: %d in Tally", f.tagged("TDSDesk:r31"))
	}
	if f.tagged("TDSDesk:r32") != 1 {
		t.Fatalf("r32 (not in Tally) not posted: %d", f.tagged("TDSDesk:r32"))
	}
	tags := r2516Bodies(f, tagCheckID)[n0:]
	if len(tags) != 1 || tags[0] != tagCheckRequest(zz, td) {
		t.Fatalf("the look in Tally: %d requests (one per date) %v", len(tags), tags)
	}
	found := false
	for _, r := range arr(p["results"]) {
		o := obj(r)
		if str(o["id"]) == "r31" && o["already"] == true && o["sameId"] == true && str(o["guid"]) != "" {
			found = true
		}
	}
	if !found {
		t.Fatalf("r31's result does not say it is in Tally already: %v", p["results"])
	}
	// an ordinary posting (nothing handed out before): no look in Tally
	n1 := f.n(tagCheckID)
	if _, err := newPostJob(M{"jobId": "job-e2-000001", "company": zz, "guid": "co-guid-1", "vouchers": []any{M{"id": "r33", "xml": finVoucher("r33", fgParty, "R-33", td, "33.00")}}}); err != nil {
		t.Fatal(err)
	}
	waitJob(t, "job-e2-000001")
	if f.n(tagCheckID) != n1 || f.tagged("TDSDesk:r33") != 1 {
		t.Fatalf("an ordinary posting: %d looks, r33 %d", f.n(tagCheckID)-n1, f.tagged("TDSDesk:r33"))
	}
}

// E: a job of this computer handed back with an owner's release (the entry was let go after a stop, then posted by
// another computer meanwhile) is looked for in Tally again before it goes, and not posted twice
func TestR2519HandedBackJobLookedForAgain(t *testing.T) {
	td := today()
	f := newStandTally(t)
	c := newStandCloud(t)
	standBridge(t, f, `,"PostWaitMs":200`+c.cfg())
	va := []any{M{"id": "r61", "xml": finVoucher("r61", fgParty, "R-61", td, "61.00")}}
	if _, err := newPostJob(M{"jobId": "job-e5-000001", "company": zz, "guid": "co-guid-1", "vouchers": va}); err != nil {
		t.Fatal(err)
	}
	waitJob(t, "job-e5-000001")
	if f.tagged("TDSDesk:r61") != 1 {
		t.Fatalf("r61 not posted: %d", f.tagged("TDSDesk:r61"))
	}
	n0 := f.n(tagCheckID)
	rel := []any{M{"id": "r61", "at": time.Now().UTC().Format(time.RFC3339), "by": "owner", "why": "not in Tally (checked by the bridge)"}}
	if _, err := newPostJob(M{"jobId": "job-e5-000001", "company": zz, "guid": "co-guid-1", "vouchers": va, "released": rel, "resendOnly": []any{"r61"}}); err != nil {
		t.Fatal(err)
	}
	time.Sleep(300 * time.Millisecond)
	waitJob(t, "job-e5-000001")
	if f.tagged("TDSDesk:r61") != 1 {
		t.Fatalf("r61 posted twice: %d in Tally", f.tagged("TDSDesk:r61"))
	}
	if f.n(tagCheckID) <= n0 {
		t.Fatal("the handed-back entry was not looked for in Tally")
	}
	// handed back once more, with a later release: looked for again (the job's earlier look is not taken for this one)
	n1 := f.n(tagCheckID)
	rel2 := []any{M{"id": "r61", "at": time.Now().Add(time.Minute).UTC().Format(time.RFC3339), "by": "owner", "why": "not in Tally (checked by the bridge)"}}
	if _, err := newPostJob(M{"jobId": "job-e5-000001", "company": zz, "guid": "co-guid-1", "vouchers": va, "released": rel2, "resendOnly": []any{"r61"}}); err != nil {
		t.Fatal(err)
	}
	time.Sleep(300 * time.Millisecond)
	waitJob(t, "job-e5-000001")
	if f.tagged("TDSDesk:r61") != 1 || f.n(tagCheckID) <= n1 {
		t.Fatalf("handed back twice: %d in Tally, %d looks", f.tagged("TDSDesk:r61"), f.n(tagCheckID)-n1)
	}
}

// E: the look's rows are taken only for the date asked (Tally not applying FinComTag's plain yyyymmdd period answers
// other dates: a mark on another date is not the entry)
func TestR2519ResentLookDateChecked(t *testing.T) {
	td := today()
	other := tallyDate(time.Now().AddDate(0, 0, -3))
	f := newStandTally(t)
	c := newStandCloud(t)
	standBridge(t, f, `,"PostWaitMs":200`+c.cfg())
	f.add(other, fgParty, "R-41", "TDSDesk:r41 | other day", "-41.00")
	f.mu.Lock()
	f.dates = func(id, body string) (string, string) {
		if id == tagCheckID {
			return "", "" // the date not applied: every entry answered
		}
		return group(`<SVFROMDATE>(\d{8})</SVFROMDATE>`, body, 1), group(`<SVTODATE>(\d{8})</SVTODATE>`, body, 1)
	}
	f.mu.Unlock()
	c.mu.Lock()
	c.takeJobs = []M{{"id": "job-e3-000001", "company": zz, "payload": M{"vouchers": []any{M{"id": "r41", "xml": finVoucher("r41", fgParty, "R-41", td, "41.00")}}}, "resendOnly": []any{"r41"}}}
	c.mu.Unlock()
	cloudPostTake()
	time.Sleep(300 * time.Millisecond)
	waitJob(t, "job-e3-000001")
	if f.tagged("TDSDesk:r41") != 2 {
		t.Fatalf("a mark on another date stopped the posting (%d in Tally)", f.tagged("TDSDesk:r41"))
	}
}

// E: the look is stopped at 2 s like every request; then nothing of that date is sent (it waits)
func TestR2519ResentLookStopped(t *testing.T) {
	td := today()
	f := newStandTally(t)
	c := newStandCloud(t)
	standBridge(t, f, `,"PostWaitMs":200`+c.cfg())
	f.mu.Lock()
	f.slow = func(id, body string) time.Duration {
		if id == tagCheckID {
			return 2600 * time.Millisecond
		}
		return 0
	}
	f.mu.Unlock()
	c.mu.Lock()
	c.takeJobs = []M{{"id": "job-e4-000001", "company": zz, "payload": M{"vouchers": []any{M{"id": "r51", "xml": finVoucher("r51", fgParty, "R-51", td, "51.00")}}}, "resendOnly": []any{"r51"}}}
	c.mu.Unlock()
	t0 := time.Now()
	cloudPostTake()
	time.Sleep(300 * time.Millisecond)
	p := waitJob(t, "job-e4-000001")
	if f.tagged("TDSDesk:r51") != 0 || f.n("Import") != 0 {
		t.Fatal("sent although Tally could not be looked at")
	}
	if time.Since(t0) > 15*time.Second {
		t.Fatal("the look was not stopped at 2 s")
	}
	ok := false
	for _, r := range arr(p["results"]) {
		if o := obj(r); str(o["id"]) == "r51" && o["checkFailed"] == true && o["notSent"] == true {
			ok = true
		}
	}
	if !ok {
		t.Fatalf("r51's result: %v", p["results"])
	}
}

// the typing gate: a band is the heavy tier: nothing goes while someone used Tally in the last minute
func TestR2519BandsWaitForTyping(t *testing.T) {
	f, _, _ := r2519BandDay(t)
	r2519Bands(f, false)
	r2516Person(t, 70)
	applyPeriodDays(pullList("20250831"))
	pullRun(t, 5) // the day's one list, stopped at 2 s: the bands begin
	retryReset()
	r2516Idle(10) // someone typed in Tally 10 s ago
	n := f.n(dayPartID)
	pullRun(t, 10)
	if f.n(dayPartID) != n {
		t.Fatalf("%d band(s) asked while someone works in Tally", f.n(dayPartID)-n)
	}
	r2516Idle(70)
	pullRun(t, 40)
	if f.n(dayPartID) <= n {
		t.Fatal("the bands did not go on once Tally was left alone")
	}
}

// the band sizing: doubled when empty, aimed at 1.35 s, never more than doubled or less than halved
func TestR2519BandSizing(t *testing.T) {
	for _, c := range []struct {
		n    int64
		k    int
		ms   float64
		want int64
	}{{200, 0, 50, 400}, {1000, 100, 100, 2000}, {1000, 4000, 1600, 500}, {1000, 1000, 1335, 1176}} {
		if got := partNext(c.n, c.k, c.ms); got != c.want {
			t.Errorf("partNext(%d, %d, %.0f) = %d, want %d", c.n, c.k, c.ms, got, c.want)
		}
	}
}

// C8 keeps the typing gate and postings first: nothing asked while someone used Tally in the last minute
func TestR2519TieOutWaitsForTyping(t *testing.T) {
	f := newStandTally(t)
	c := newStandCloud(t)
	f.addLed("Customer A", "Sundry Debtors", "0.00")
	r2519TieTally(f)
	r2519TieCloud(c)
	standBridge(t, f, `,"KeepBudgetSec":600`+c.cfg())
	liveFrom(today())
	r2519Confirm(t, "Confirmed2519GroupClosing")
	r2516Person(t, 10)
	r2519DayRun(t)
	if f.n(groupClosingID) != 0 {
		t.Fatal("C8 asked while someone works in Tally")
	}
	if tieOutDone(zz, today()) {
		t.Fatal("a tie-out not asked is kept as done for the day")
	}
}

// E's gate: FinComTag with ReadDays off goes only as the look before a re-sent entry, under the 2 s stop
func TestR2519ResentLookGate(t *testing.T) {
	x := tagCheckRequest(zz, "20261123")
	tc := *fin
	tc.limitMs, tc.resentLook = 2000, true
	if resentAsking(&tc, x) {
		t.Fatal("a look not going now passes")
	}
	resentAsk.Store(x, true)
	defer resentAsk.Delete(x)
	if !resentAsking(&tc, x) {
		t.Fatal("the look going now is refused")
	}
	plain := *fin
	if resentAsking(&plain, x) {
		t.Fatal("FinComTag without the look's TC passes")
	}
	tc.limitMs = 0
	if resentAsking(&tc, x) {
		t.Fatal("the look without its 2 s stop passes")
	}
	y := strings.Replace(x, "NARRATION, ", "", 1)
	resentAsk.Store(y, true)
	defer resentAsk.Delete(y)
	tc.limitMs = 2000
	if resentAsking(&tc, y) {
		t.Fatal("a changed FinComTag passes")
	}
}

var _ = regexp.MustCompile
