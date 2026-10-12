package main

// FinCom Bridge 2.4.4 (the owner's decisions of 12-Oct-2026: payroll and salary TDS). Tests written before the code, on
// real TallyPrime answers (testdata/payroll244: tally-versions mode payroll, runs 38236438871 on 3.0 / 5.1 / 7.1 and
// 38253610530 on 7.1 with 500 employees) and the stand-in Tally:
//   1. FinComEmployees exactly as measured (the twelve fields, a CostCentre collection in the fcCollection form, 2,000
//      MasterIDs a request), on the allow-list, pinned, undated; a changed one refused; payroll rows only kept;
//   2. the four pay-head fields on the ledger reads (FinComLedgers, FinComLedgerChanges, FinComLedgerByName);
//   3. the salary payment: BANKEMPLOYEENAME and its AMOUNT kept, never ACCOUNTNUMBER, IFSCODE or PAYMENTFAVOURING, and an
//      allocation that names no employee strips as before;
//   4. the payroll voucher's 3 s (by its type), every other request 2 s;
//   5. the employees read again when Tally's master counter moves (no second id), sent only when the list changed.

import (
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
	"time"
)

var ledFetch244Added = ", PAYTYPE, PAYSTATTYPE, ITCOMPONENT, FORPAYROLL"

// --- 1. the request
func TestPay244EmployeesRequestAsMeasured(t *testing.T) {
	// byte for byte the request timed on real TallyPrime 7.1 (run 38253610530, P1: 43 ms worst on 506 cost centres)
	want := strings.TrimSpace(readText(filepath.Join("testdata", "payroll244", "7.1", "employees-p1.request.xml")))
	if got := employeeChunkRequest("FinCom Spike Co", 0, 0); got != want {
		t.Fatalf("FinComEmployees:\n%s\nwant (as measured)\n%s", got, want)
	}
	if empFetch != "GUID, MASTERID, ALTERID, NAME, PARENT, CATEGORY, FORPAYROLL, ISEMPLOYEEGROUP, PANNUMBER, DATEOFJOIN, DEACTIVATIONDATE, DESIGNATION" {
		t.Fatalf("the fields: %s", empFetch)
	}
	x := employeeChunkRequest("SAMPLE CO", 2000, 4000)
	if !strings.Contains(x, "<TYPE>CostCentre</TYPE>") || !strings.Contains(x, "$MasterID &gt; 2000 AND $MasterID &lt;= 4000") || strings.Count(x, "<COLLECTION ") != 1 ||
		!strings.Contains(x, `ISMODIFY="No"`) || isImportRequest(x) || requestDated(x) {
		t.Fatalf("not one read of the cost centres in a MasterID chunk: %s", x)
	}
	if err := checkAllowed(x); err != nil {
		t.Fatalf("refused: %v", err)
	}
	if requestClass[empListID] != "undated" || tallyAllowList[empListID].measureOnly {
		t.Fatal("FinComEmployees is not an undated bridge request")
	}
	if empChunk() != 2000 {
		t.Fatalf("chunk %d", empChunk())
	}
	setCfg("EmployeeChunk", float64(5000))
	if empChunk() != 2000 {
		t.Fatalf("the chunk went over 2,000: %d", empChunk())
	}
	setCfg("EmployeeChunk", float64(2000))
	// no personal field, no computed field, no other type, no period: a changed request is refused (the pin)
	for _, bad := range []string{
		strings.Replace(x, "DESIGNATION", "DESIGNATION, DATEOFBIRTH", 1),
		strings.Replace(x, "DESIGNATION", "DESIGNATION, AADHARNUMBER", 1),
		strings.Replace(x, "DESIGNATION", "DESIGNATION, BANKACCOUNTNUMBER", 1),
		strings.Replace(x, "PANNUMBER", "*", 1),
		strings.Replace(x, "<TYPE>CostCentre</TYPE>", "<TYPE>Employee</TYPE>", 1),
		strings.Replace(x, "<TYPE>CostCentre</TYPE>", "<TYPE>PayrollITDeclaration</TYPE>", 1),
		strings.Replace(x, " AND $MasterID &lt;= 4000", " AND $MasterID &lt;= 9000", 1),
		strings.Replace(x, "<ID>FinComEmployees</ID>", "<ID>FinComEmployeeChanges</ID>", 1),
		strings.Replace(x, "</STATICVARIABLES>", "<SVFROMDATE>20260401</SVFROMDATE></STATICVARIABLES>", 1),
	} {
		if err := checkAllowed(bad); err == nil {
			t.Fatalf("a changed request passes: %s", bad)
		}
	}
	// the owner did not approve a second id
	for id := range tallyAllowList {
		if strings.Contains(strings.ToLower(id), "employeechange") || strings.Contains(strings.ToLower(id), "attendance") {
			t.Fatalf("%s on the allow-list", id)
		}
	}
}

// --- 1. payroll rows only, from Tally's real answers; nothing else of a cost centre is kept
func TestPay244EmployeeRowsReal(t *testing.T) {
	raw := gz242(t, filepath.Join("testdata", "payroll244", "7.1", "employees-p1.xml.gz"))
	// a cost centre that is not payroll's, as Tally writes one, with personal fields a request never asks: dropped whole
	other := `<COSTCENTRE NAME="Delhi Branch" RESERVEDNAME=""><GUID TYPE="String">cc-not-payroll</GUID><PARENT TYPE="String">&#4; Primary</PARENT><CATEGORY TYPE="String">Primary Cost Category</CATEGORY>` +
		`<FORPAYROLL TYPE="Logical">No</FORPAYROLL><ISEMPLOYEEGROUP TYPE="Logical">No</ISEMPLOYEEGROUP><PANNUMBER TYPE="String">AAAPZ9999Z</PANNUMBER><MASTERID TYPE="Number"> 9999</MASTERID><ALTERID TYPE="Number"> 9999</ALTERID></COSTCENTRE>`
	raw = strings.Replace(raw, "</COLLECTION>", other+"</COLLECTION>", 1)
	rows, dropped, top := empRowsOf(raw)
	if len(rows) != 506 || dropped != 1 || top != 9999 {
		t.Fatalf("%d rows, %d dropped, top %d", len(rows), dropped, top)
	}
	by := map[string]empRow{}
	groups := 0
	for _, r := range rows {
		by[r.name] = r
		if r.group {
			groups++
		}
		if r.name == "Delhi Branch" || r.pan == "AAAPZ9999Z" {
			t.Fatal("a cost centre that is not payroll's kept")
		}
	}
	e := by["FC Bulk Emp 001"]
	if e.guid != "bfec5f89-b32b-4e27-997d-61327b6f137c-000000e5" || e.mid != 229 || e.alter != 339 || e.parent != "FC Bulk Staff" || e.category != "Primary Cost Category" ||
		e.pan != "ABCPB0001Z" || e.joined != "20250401" || e.left != "" || e.desig != "Accounts Manager" || e.group {
		t.Fatalf("FC Bulk Emp 001: %+v", e)
	}
	if g := by["FC Staff Office"]; !g.group || g.parent != "" {
		t.Fatalf("the employee group: %+v", g)
	}
	if groups != 3 {
		t.Fatalf("%d employee groups", groups)
	}
	// what goes to FinCom: the eleven columns, nothing else
	if a := e.arr(); len(a) != 11 || fmt.Sprint(a) != "[bfec5f89-b32b-4e27-997d-61327b6f137c-000000e5 229 339 FC Bulk Emp 001 FC Bulk Staff Primary Cost Category 0 ABCPB0001Z 20250401  Accounts Manager]" {
		t.Fatalf("the row: %v", a)
	}
	// 3.0 and 5.1 (run 38236438871): the same tags, in Tally's export of every master with every field (Aadhaar, bank,
	// date of birth, UAN, ... as the harness filled them): only the twelve are read
	for _, rel := range []string{"3.0", "5.1"} {
		raw := gz242(t, filepath.Join("testdata", "payroll244", rel, "masters.xml.gz"))
		rows, _, _ := empRowsOf(raw)
		names := map[string]empRow{}
		for _, r := range rows {
			names[r.name] = r
		}
		if len(rows) != 5 || names["FC Emp One"].pan != "ABCPE1001A" || names["FC Emp One"].parent != "FC Staff Office" || !names["FC Staff Office"].group {
			t.Fatalf("%s: %d rows %+v", rel, len(rows), names["FC Emp One"])
		}
		for _, r := range rows {
			if a := fmt.Sprint(r.arr()); strings.Contains(a, "999900001") || strings.Contains(a, "5010012345678") || strings.Contains(a, "19900101") || strings.Contains(a, "Test Street") || strings.Contains(a, "HDFC") || strings.Contains(a, "1002003004") {
				t.Fatalf("%s: a personal field kept: %v", rel, r.arr())
			}
		}
	}
}

// --- 2. the pay-head fields on the ledger reads
func TestPay244LedgerPayFields(t *testing.T) {
	if ledFetch != ledFetch242+ledFetch243Added+ledFetch244Added {
		t.Fatalf("ledFetch: %s", ledFetch)
	}
	for _, x := range []string{ledgerChunkRequest("SAMPLE CO", 0, 2000), ledgerChangesRequest("SAMPLE CO", 0, 200), ledgerByNameRequest("SAMPLE CO", "FC Basic")} {
		if group(`<FETCH>([^<]*)</FETCH>`, x, 1) != ledFetch {
			t.Fatalf("not ledFetch: %s", x)
		}
		if err := checkAllowed(x); err != nil {
			t.Fatal(err)
		}
	}
	// the request measured on real 7.1 (P3: 9 ms worst) is today's FinComLedgers with the four fields
	want := strings.TrimSpace(readText(filepath.Join("testdata", "payroll244", "7.1", "ledgers-p3.request.xml")))
	if got := ledgerChunkRequest("FinCom Spike Co", 0, 0); !strings.Contains(want, "PAYTYPE, PAYSTATTYPE, ITCOMPONENT, FORPAYROLL") || group(`<FETCH>([^<]*)</FETCH>`, got, 1) != group(`<FETCH>([^<]*)</FETCH>`, want, 1) {
		t.Fatalf("not the fields measured:\n%s\n%s", got, want)
	}
	check := func(rel, file string) {
		rows, _ := ledRowsOf(gz242(t, filepath.Join("testdata", "payroll244", rel, file)))
		by := map[string]ledRow{}
		for _, r := range rows {
			by[r.name] = r
		}
		w := map[string][4]string{
			"FC Basic":            {"Earnings for Employees", "", "Basic Salary", "Yes"},
			"FC HRA":              {"Earnings for Employees", "", "House Rent Allowance", "Yes"},
			"FC Income Tax":       {"Employees' Statutory Deductions", "Income Tax", "", "Yes"},
			"FC Professional Tax": {"Employees' Statutory Deductions", "Professional Tax", "", "Yes"},
			"FC PF Employer":      {"Employer's Statutory Contributions", "PF Account (A/c No. 1)", "", "Yes"},
			"FC Salary Payable":   {"", "", "", ""},
			"Cash":                {"", "", "", ""},
		}
		for n, x := range w {
			r, ok := by[n]
			if !ok || [4]string{r.payType, r.payStat, r.itComp, r.forPay} != x {
				t.Errorf("%s %s: %q %q %q %q, want %v", rel, n, r.payType, r.payStat, r.itComp, r.forPay, x)
			}
		}
	}
	check("7.1", "ledgers-p3.xml.gz")
	check("3.0", "masters.xml.gz")
	check("5.1", "masters.xml.gz")
	// a 2.4.3 list held (no pay-head fields) and a ledger that is not a pay head: the same row (no flood of changes)
	r := ledRow{guid: "g", mid: 1, alter: 2, name: "Cash", open: "0.00"}
	held := map[string]ledRow{"g": ledFromArr("g", []any{1, 2, "Cash", "", "0.00", "", "", "", "", "", "", ""})}
	if d := diffLedgers(held, map[string]ledRow{"g": r}); len(d.rows) != 0 {
		t.Fatalf("an unchanged ledger read as changed: %+v", d.rows)
	}
}

// the ledger rows to FinCom carry the four pay-head columns (ledger_list and ledger_changes), and an older outbox row
// goes without them
func TestPay244LedgerRowsToCloud(t *testing.T) {
	rec, f, c := led231Bridge(t)
	_ = rec
	f.mu.Lock()
	f.mid++
	f.alter++
	f.led = append(f.led, &tLed{guid: "led-basic", name: "FC Basic", parent: "Indirect Expenses", open: "0.00", mid: f.mid, alter: f.alter})
	f.mu.Unlock()
	f.mu.Lock()
	payFieldsOf = func(name string) string {
		if name == "FC Basic" {
			return "<PAYTYPE>Earnings for Employees</PAYTYPE><PAYSTATTYPE>&#4; Not Applicable</PAYSTATTYPE><ITCOMPONENT>Basic Salary</ITCOMPONENT><FORPAYROLL>Yes</FORPAYROLL>"
		}
		return "<PAYTYPE>&#4; Not Applicable</PAYTYPE><PAYSTATTYPE>&#4; Not Applicable</PAYSTATTYPE><FORPAYROLL>No</FORPAYROLL>"
	}
	f.mu.Unlock()
	t.Cleanup(func() { payFieldsOf = nil })
	led231Numbers(t, f)
	if n, err := ledChangesCheck(zz); n != 1 || err != nil {
		t.Fatalf("%d %v", n, err)
	}
	c.mu.Lock()
	rows := led231Rows(c.ledChanges[len(c.ledChanges)-1])
	c.mu.Unlock()
	if a := rows["FC Basic"]; len(a) != 18 || fmt.Sprint(a[14:]) != "[Earnings for Employees  Basic Salary Yes]" {
		t.Fatalf("the ledger_changes row: %v", a)
	}
	// the outbox: a 2.4.3 row (13 columns) goes with 14; a 2.4.4 row with 18
	dir := t.TempDir()
	d := ledDiff{rows: []ledRow{{guid: "g1", mid: 1, alter: 1, name: "FC HRA", payType: "Earnings for Employees", itComp: "House Rent Allowance", forPay: "Yes"}}, openChg: map[string]bool{}}
	mergeLedOut(dir, d, nil, "r1", []string{"g1", "g0"}, nil)
	o := readObjFile(ledOutFile(dir))
	rs := obj(o["rows"])
	rs["g0"] = []any{1, 1, "Old Row", "", "0.00", "", "", false, "", "", "", "", ""}
	o["rows"] = rs
	_ = saveFile(ledOutFile(dir), jsonText(o))
	if err := pushLedgerList(zz, dir); err != nil {
		t.Fatal(err)
	}
	c.mu.Lock()
	last := c.ledList[len(c.ledList)-1]
	c.mu.Unlock()
	lr := led231Rows(last)
	if len(lr["FC HRA"]) != 18 || str(lr["FC HRA"][14]) != "Earnings for Employees" || str(lr["FC HRA"][16]) != "House Rent Allowance" || str(lr["FC HRA"][17]) != "Yes" || len(lr["Old Row"]) != 14 {
		t.Fatalf("ledger_list rows: %v / %v", lr["FC HRA"], lr["Old Row"])
	}
}

// --- 3. the salary payment: the employee and the amount paid kept, the bank details never
func TestPay244SalaryPaymentKept(t *testing.T) {
	for _, rel := range []string{"7.1", "3.0", "5.1"} {
		vs := reVchBlock.FindAllString(gz242(t, filepath.Join("testdata", "payroll244", rel, "obj-SAL-PAY-NOV.xml.gz")), -1)
		if len(vs) != 1 {
			t.Fatalf("%s: %d vouchers", rel, len(vs))
		}
		s := fastStripVoucher(cleanXML(vs[0]))
		for _, w := range []string{"<BANKEMPLOYEENAME>FC Emp One</BANKEMPLOYEENAME>", "<BANKEMPLOYEENAME>FC Emp Two</BANKEMPLOYEENAME>", "<BANKEMPLOYEENAME>FC Emp Three</BANKEMPLOYEENAME>"} {
			if !strings.Contains(s, w) {
				t.Errorf("%s: lacks %s", rel, w)
			}
		}
		bk := regexp.MustCompile(`(?s)<BANKALLOCATIONS\.LIST>.*?</BANKALLOCATIONS\.LIST>`).FindAllString(s, -1)
		if len(bk) != 3 {
			t.Fatalf("%s: %d bank allocations kept: %s", rel, len(bk), s)
		}
		for _, b := range bk {
			if !regexp.MustCompile(`<AMOUNT>-?\d+\.\d\d</AMOUNT>`).MatchString(b) {
				t.Errorf("%s: no amount in %s", rel, b)
			}
		}
		if rel == "7.1" && !strings.Contains(bk[0], "<AMOUNT>75000.00</AMOUNT>") {
			t.Errorf("FC Emp One's amount: %s", bk[0])
		}
		for _, never := range []string{"ACCOUNTNUMBER", "IFSCODE", "PAYMENTFAVOURING", "50100123456781", "HDFC0001001", "BANKNAME>", "DENOMINATION"} {
			if strings.Contains(s, never) {
				t.Errorf("%s: %s kept", rel, never)
			}
		}
		ok := fastApprovedPaths()
		for _, p := range fastLeafPaths(s) {
			if !fastPathOK(ok, p) {
				t.Errorf("%s: %s kept (not an approved field)", rel, p)
			}
		}
	}
	// a bank allocation that names no employee: its amount is not kept (every other entry strips as in 2.4.3)
	v := `<VOUCHER REMOTEID="g" VCHTYPE="Payment"><DATE>20261001</DATE><LEDGERENTRIES.LIST><LEDGERNAME>HDFC</LEDGERNAME><AMOUNT>100.00</AMOUNT><BANKALLOCATIONS.LIST><DATE>20261001</DATE><NAME>CHQ1</NAME><BANKEMPLOYEENAME></BANKEMPLOYEENAME><ACCOUNTNUMBER>123</ACCOUNTNUMBER><AMOUNT>100.00</AMOUNT></BANKALLOCATIONS.LIST></LEDGERENTRIES.LIST></VOUCHER>`
	want := `<VOUCHER REMOTEID="g" VCHTYPE="Payment"><DATE>20261001</DATE><ALLLEDGERENTRIES.LIST><LEDGERNAME>HDFC</LEDGERNAME><AMOUNT>100.00</AMOUNT><BANKALLOCATIONS.LIST><DATE>20261001</DATE><NAME>CHQ1</NAME></BANKALLOCATIONS.LIST></ALLLEDGERENTRIES.LIST></VOUCHER>`
	if got := fastStripVoucher(v); got != want {
		t.Fatalf("got  %s\nwant %s", got, want)
	}
	// with an employee: the name and amount, never the account, IFSC or the name in favour
	v2 := strings.Replace(strings.Replace(v, "<BANKEMPLOYEENAME></BANKEMPLOYEENAME>", "<BANKEMPLOYEENAME>A Person</BANKEMPLOYEENAME><IFSCODE>HDFC0001</IFSCODE><PAYMENTFAVOURING>A Person</PAYMENTFAVOURING>", 1), "", "", 1)
	want2 := `<VOUCHER REMOTEID="g" VCHTYPE="Payment"><DATE>20261001</DATE><ALLLEDGERENTRIES.LIST><LEDGERNAME>HDFC</LEDGERNAME><AMOUNT>100.00</AMOUNT><BANKALLOCATIONS.LIST><DATE>20261001</DATE><NAME>CHQ1</NAME><BANKEMPLOYEENAME>A Person</BANKEMPLOYEENAME><AMOUNT>100.00</AMOUNT></BANKALLOCATIONS.LIST></ALLLEDGERENTRIES.LIST></VOUCHER>`
	if got := fastStripVoucher(v2); got != want2 {
		t.Fatalf("got  %s\nwant %s", got, want2)
	}
	// the request is unchanged byte for byte (none of these in its FETCHLIST)
	if shapeOf(allowListSamples()[vchObjectID]) != "ce0e72f74e72" {
		t.Fatal("the entry request changed")
	}
	if strings.Join(liveKeepPay244, ",") != "ALLLEDGERENTRIES.BANKALLOCATIONS.BANKEMPLOYEENAME,ALLLEDGERENTRIES.BANKALLOCATIONS.AMOUNT" {
		t.Fatalf("kept: %v", liveKeepPay244)
	}
}

// the payroll entries strip as in 2.4.3: each employee's amount per pay head, as cost-centre allocations (real 7.1, 3.0,
// 5.1); the 500-employee payroll strips whole
func TestPay244PayrollStripReal(t *testing.T) {
	for _, rel := range []string{"7.1", "3.0", "5.1"} {
		vs := reVchBlock.FindAllString(gz242(t, filepath.Join("testdata", "payroll244", rel, "obj-PR-NOV.xml.gz")), -1)
		s := fastStripVoucher(cleanXML(vs[0]))
		for _, w := range []string{"<LEDGERNAME>FC Basic</LEDGERNAME>", "<NAME>FC Emp One</NAME><AMOUNT>-50000.00</AMOUNT>", "<NAME>FC Emp Two</NAME><AMOUNT>-30000.00</AMOUNT>"} {
			if !strings.Contains(s, w) {
				t.Errorf("%s: lacks %s", rel, w)
			}
		}
	}
	vs := reVchBlock.FindAllString(gz242(t, filepath.Join("testdata", "payroll244", "7.1", "obj-PR-BULK-500.xml.gz")), -1)
	t0 := time.Now()
	s, why := fastStripWhy(cleanXML(vs[0]))
	if why != "" || strings.Count(s, "<COSTCENTREALLOCATIONS.LIST>") != 3500 {
		t.Fatalf("the 500-employee payroll: %q, %d allocations", why, strings.Count(s, "<COSTCENTREALLOCATIONS.LIST>"))
	}
	t.Logf("the 500-employee payroll stripped in %v to %d bytes", time.Since(t0), len(s))
}

// the stripped bodies as bridge 2.4.4 sends them (golden: tests/run_parse_payroll.mjs reads them as FinCom's cloud does)
func TestPay244StrippedGolden(t *testing.T) {
	for _, id := range []string{"PR-NOV", "PR-DEC", "SAL-PAY-NOV", "TDS-SAL-NOV", "PF-NOV"} {
		f := filepath.Join("testdata", "payroll244", "7.1", "obj-"+id+".xml.gz")
		vs := reVchBlock.FindAllString(gz242(t, f), -1)
		if len(vs) != 1 {
			t.Fatalf("%s: %d vouchers", id, len(vs))
		}
		s := fastStripVoucher(cleanXML(vs[0]))
		if s == "" {
			t.Fatalf("%s held", id)
		}
		out := strings.TrimSuffix(f, ".xml.gz") + "-stripped.xml"
		if os.Getenv("PAY244_GOLDEN") != "" {
			if err := os.WriteFile(out, []byte(s), 0o644); err != nil {
				t.Fatal(err)
			}
		} else if readText(out) != s {
			t.Errorf("%s: not what the strip makes now (PAY244_GOLDEN=1 rewrites it)", out)
		}
	}
}

// --- 4. the payroll voucher's 3 s, every other request 2 s
func TestPay244PayrollLimit(t *testing.T) {
	_, _, _ = r222bBridge(t, "")
	tc := recorderTC(nil)
	if entryTC(tc, nwsCo, "Payroll").limitMs != 3000 || entryTC(tc, nwsCo, " payroll ").limitMs != 3000 {
		t.Fatal("Payroll is not 3 s")
	}
	for _, typ := range []string{"Payment", "Journal", "Sales", "", "Payroll x", "Salary JV"} {
		if entryTC(tc, nwsCo, typ).limitMs != 2000 {
			t.Fatalf("%q is not 2 s", typ)
		}
	}
	setCfg("PayrollLimitMs", float64(9000))
	if payrollLimitMs() != 3000 {
		t.Fatalf("the payroll limit went over 3 s: %d", payrollLimitMs())
	}
	setCfg("RecorderLimitMs", float64(9000))
	if recorderLimitMs() != 2000 || entryTC(tc, nwsCo, "Payment").limitMs != 2000 {
		t.Fatal("the 2-second rule moved")
	}
	// a type the bridge saw carrying employees' pay heads is payroll's, for that company only
	v := gz242(t, filepath.Join("testdata", "payroll244", "7.1", "obj-PR-NOV.xml.gz"))
	payrollLearn(nwsCo, strings.Replace(v, "<VOUCHERTYPENAME>Payroll</VOUCHERTYPENAME>", "<VOUCHERTYPENAME>Salary JV</VOUCHERTYPENAME>", 1))
	if entryTC(tc, nwsCo, "Salary JV").limitMs != 3000 || entryTC(tc, "Another Co", "Salary JV").limitMs != 2000 {
		t.Fatal("the learned payroll type")
	}
	// a payment (no employees' pay heads) teaches nothing
	payrollLearn(nwsCo, gz242(t, filepath.Join("testdata", "payroll244", "7.1", "obj-SAL-PAY-NOV.xml.gz")))
	if entryTC(tc, nwsCo, "Payment").limitMs != 2000 {
		t.Fatal("a payment learned as payroll")
	}
	// kept across a restart
	payTypesMu.Lock()
	payTypes = nil
	payTypesMu.Unlock()
	if !payrollEntry(nwsCo, "salary jv") {
		t.Fatal("not kept on disk")
	}
	// the other TCs are untouched (the posting check, a person's)
	if entryTC(checkTC(), nwsCo, "Payroll").limitMs != checkTC().limitMs {
		t.Fatal("the posting check's limit moved")
	}
}

// a payroll entry Tally answers in 2.5 s is fetched (and is not "over" for the slow-company mark); a payment answered in
// 2.5 s is stopped at 2 s; one request in flight
func TestPay244PayrollAnsweredIn3s(t *testing.T) {
	_, f, _ := r222bBridge(t, "")
	pay := gz242(t, filepath.Join("testdata", "payroll244", "7.1", "obj-PR-NOV.xml.gz"))
	sal := gz242(t, filepath.Join("testdata", "payroll244", "7.1", "obj-SAL-PAY-NOV.xml.gz"))
	f.mu.Lock()
	f.behave = func(w http.ResponseWriter, r *http.Request, id, body string) bool {
		if id != vchObjectID {
			return false
		}
		select {
		case <-time.After(2500 * time.Millisecond):
		case <-r.Context().Done():
			return true
		}
		if strings.Contains(body, "ID:2<") {
			fmt.Fprint(w, pay)
		} else {
			fmt.Fprint(w, sal)
		}
		return true
	}
	f.mu.Unlock()
	port, err := findCompanyPortBg(nwsCo, 0)
	if err != nil {
		t.Fatal(err)
	}
	s0 := slowSeen(nwsCo)
	got, err := fetchVouchersByMasterIn(entryTC(recorderTC(nil), nwsCo, "Payroll"), nwsCo, port, "20261101", []string{"2"}, 5)
	if err != nil || !strings.Contains(got["2"], "<NAME>FC Emp One</NAME>") {
		t.Fatalf("the payroll entry in 2.5 s: %v %d", err, len(got["2"]))
	}
	if s1 := slowSeen(nwsCo); s1.answered != s0.answered+1 || s1.over != s0.over {
		t.Fatalf("the payroll entry counted as over: %+v -> %+v", s0, s1)
	}
	retryReset()
	time.Sleep(3 * time.Second) // Tally finishes before the next ask (one request in flight)
	_, err = fetchVouchersByMasterIn(entryTC(recorderTC(nil), nwsCo, "Payment"), nwsCo, port, "20261202", []string{"5"}, 5)
	if err == nil {
		t.Fatal("a payment answered in 2.5 s was not stopped at 2 s")
	}
	f.mu.Lock()
	mf := f.maxFlight
	f.mu.Unlock()
	if mf != 1 {
		t.Fatalf("%d requests in flight", mf)
	}
}

// --- 5. the employees read again when the master counter moves; sent only when changed; no second id
func pay244AddEmp(f *standTally, name, parent string, payroll, group bool, pan string) *tEmp {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.mid++
	f.alter++
	e := &tEmp{guid: fmt.Sprintf("cc-%d", f.mid), name: name, parent: parent, category: "Primary Cost Category", pan: pan, joined: "20250401",
		payroll: payroll, group: group, desig: "Accountant", mid: f.mid, alter: f.alter}
	f.emp = append(f.emp, e)
	return e
}

func TestPay244EmployeesOnCounter(t *testing.T) {
	_, f, c := led231Bridge(t)
	clock := time.Date(2026, 10, 12, 10, 0, 0, 0, time.Local)
	nowFn = func() time.Time { return clock }
	t.Cleanup(func() { nowFn = time.Now })
	pay244AddEmp(f, "Office Staff", "", true, true, "")
	pay244AddEmp(f, "Asha Rao", "Office Staff", true, false, "ABCPR1234K")
	pay244AddEmp(f, "Delhi Branch", "", false, false, "AAAPZ9999Z")
	led231Numbers(t, f)
	n, err := employeesCheck(zz)
	// one chunk up to the master counter, then the open end
	if err != nil || n != 2 || f.n(empListID) != 2 {
		t.Fatalf("first read: %d %v, %d requests", n, err, f.n(empListID))
	}
	c.mu.Lock()
	b := c.empPosts[0]
	c.mu.Unlock()
	if str(b["company_guid"]) != b220CoGUID || !truthy(b["complete"]) || len(arr(b["employees"])) != 2 || strings.Contains(jsonText(b), "Delhi Branch") || strings.Contains(jsonText(b), "AAAPZ9999Z") {
		t.Fatalf("the employees sent: %s", jsonText(b))
	}
	// the counter did not move: nothing asked
	if n, err := employeesCheck(zz); n != 0 || err != nil || f.n(empListID) != 2 {
		t.Fatalf("asked with the counter unmoved: %d", f.n(empListID))
	}
	// the counter moved (a ledger altered), within the gap: nothing asked yet; after it: read, unchanged, nothing sent
	f.addLed("New Ledger", "Sundry Debtors", "0.00")
	led231Numbers(t, f)
	clock = clock.Add(10 * time.Minute)
	if n, _ := employeesCheck(zz); n != 0 || f.n(empListID) != 2 {
		t.Fatalf("asked within the gap: %d", f.n(empListID))
	}
	clock = clock.Add(25 * time.Minute)
	if n, err := employeesCheck(zz); n != 0 || err != nil || f.n(empListID) != 4 || len(c.empPosts) != 1 {
		t.Fatalf("after the gap: %d %v, %d requests, %d posts", n, err, f.n(empListID), len(c.empPosts))
	}
	// an employee leaves (a date of leaving) and one joins: the whole list goes again
	f.mu.Lock()
	f.emp[1].left = "20261031"
	f.alter++
	f.emp[1].alter = f.alter
	f.mu.Unlock()
	pay244AddEmp(f, "Ravi Kumar", "Office Staff", true, false, "ABCPK4321L")
	led231Numbers(t, f)
	clock = clock.Add(31 * time.Minute)
	if n, err := employeesCheck(zz); n != 3 || err != nil {
		t.Fatalf("changed: %d %v", n, err)
	}
	c.mu.Lock()
	last := c.empPosts[len(c.empPosts)-1]
	c.mu.Unlock()
	rows := map[string][]any{}
	for _, x := range arr(last["employees"]) {
		rows[str(at(arr(x), 3))] = arr(x)
	}
	if str(rows["Asha Rao"][9]) != "20261031" || str(rows["Ravi Kumar"][7]) != "ABCPK4321L" || toInt(rows["Office Staff"][6]) != 1 {
		t.Fatalf("the list: %s", jsonText(last))
	}
	// only FinComEmployees, only undated, never a second id
	f.mu.Lock()
	for i, id := range f.reqs {
		if strings.Contains(id, "Employee") && id != empListID || id == empListID && requestDated(f.bodies[i]) {
			t.Fatalf("sent %s", id)
		}
	}
	f.mu.Unlock()
}

// chunks of 2,000 MasterIDs up to the master counter, then the open end; a posting first; FinCom not taking the list:
// read and sent again later
func TestPay244EmployeesChunked(t *testing.T) {
	_, f, c := led231Bridge(t)
	clock := time.Date(2026, 10, 12, 10, 0, 0, 0, time.Local)
	nowFn = func() time.Time { return clock }
	t.Cleanup(func() { nowFn = time.Now })
	pay244AddEmp(f, "Asha Rao", "", true, false, "ABCPR1234K")
	f.mu.Lock()
	f.mid += 4500
	f.alter += 4500
	f.mu.Unlock()
	pay244AddEmp(f, "Late Joiner", "", true, false, "ABCPL1111M")
	led231Numbers(t, f)
	c.mu.Lock()
	c.empReply = func(b M) (int, M) { return 500, M{"error": "down"} }
	c.mu.Unlock()
	if n, err := employeesCheck(zz); n != 0 || err == nil {
		t.Fatalf("FinCom refused, yet %d %v", n, err)
	}
	var spans []string
	f.mu.Lock()
	for i, id := range f.reqs {
		if id == empListID {
			spans = append(spans, group(`<SYSTEM TYPE="Formulae" NAME="FinComEmployeesOnly">([^<]*)</SYSTEM>`, f.bodies[i], 1))
		}
	}
	f.mu.Unlock()
	if strings.Join(spans, " | ") != "$MasterID &gt; 0 AND $MasterID &lt;= 2000 | $MasterID &gt; 2000 AND $MasterID &lt;= 4000 | $MasterID &gt; 4000 AND $MasterID &lt;= 6000 | $MasterID &gt; 6000" {
		t.Fatalf("spans: %v", spans)
	}
	c.mu.Lock()
	c.empReply = nil
	c.mu.Unlock()
	clock = clock.Add(31 * time.Minute)
	if n, err := employeesCheck(zz); n != 2 || err != nil {
		t.Fatalf("sent again: %d %v", n, err)
	}
}
