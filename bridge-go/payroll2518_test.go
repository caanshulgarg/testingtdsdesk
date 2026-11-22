package main

// 2.5.18: the payroll import (FinComPayrollImport), approved by the owner on 22-Nov-2026 (docs/PAYROLL.md section 4)

import (
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"testing"
)

func payrollFixture(t *testing.T) string {
	t.Helper()
	b, err := os.ReadFile(filepath.Join("..", "tests", "fixtures", "payroll_voucher.xml"))
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

func payrollEnv(v string) string {
	return importEnvelope("Vouchers", zz, `<TALLYMESSAGE xmlns:UDF="TallyUDF">`+v+"</TALLYMESSAGE>")
}

func TestPayrollVoucherShape(t *testing.T) {
	x := payrollFixture(t)
	if !strings.HasSuffix(x, "\n") {
		x += "\n"
	}
	if why := payrollVoucherShape(x); why != "" {
		t.Fatalf("the fixture is refused: %s", why)
	}
	if checkAllowed(payrollEnv(x)) != nil {
		t.Fatal("the fixture's request is refused")
	}
	emp := x[strings.Index(x, "<EMPLOYEEENTRIES.LIST>") : strings.Index(x, "</EMPLOYEEENTRIES.LIST>")+len("</EMPLOYEEENTRIES.LIST>\n")]
	bad := map[string]string{
		"payable not the net":            strings.Replace(x, "</LEDGERNAME>\n<ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>\n<AMOUNT>", "</LEDGERNAME>\n<ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>\n<AMOUNT>1", 1),
		"alter, not create":              strings.Replace(x, `ACTION="Create"`, `ACTION="Alter"`, 1),
		"a REMOTEID":                     strings.Replace(x, `OBJVIEW="PaySlip Voucher View">`, `OBJVIEW="PaySlip Voucher View" REMOTEID="abcd-1234">`, 1),
		"an extra element":               strings.Replace(x, "</NARRATION>", "</NARRATION>\n<ISOPTIONAL>Yes</ISOPTIONAL>", 1),
		"a comment":                      strings.Replace(x, "</NARRATION>", "<!-- x --></NARRATION>", 1),
		"CDATA":                          strings.Replace(x, "</NARRATION>", "<![CDATA[x]]></NARRATION>", 1),
		"an amount changed":              strings.Replace(x, "<AMOUNT>-45500.00</AMOUNT>", "<AMOUNT>-45400.00</AMOUNT>", 1),
		"a wrong sign":                   strings.Replace(x, "<ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>", "<ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>", 1),
		"a second voucher":               x + x,
		"the same employee twice (case)": strings.Replace(x, emp, emp+strings.Replace(emp, "Ravi Kumar", "RAVI KUMAR ", 1), 1),
		"an 11-digit amount":             strings.Replace(x, "<AMOUNT>-45500.00</AMOUNT>", "<AMOUNT>-10000000000.00</AMOUNT>", 1),
	}
	for why, y := range bad {
		if payrollVoucherShape(y) == "" {
			t.Errorf("%s: accepted by the shape", why)
		}
		if checkAllowed(payrollEnv(y)) == nil {
			t.Errorf("%s: accepted by the allow-list", why)
		}
	}
	// 101 employees refused, 100 accepted (each employee renamed)
	var many strings.Builder
	for i := 0; i < 101; i++ {
		many.WriteString(strings.Replace(emp, "Ravi Kumar", "Employee "+strconv.Itoa(i), 1))
	}
	empAmt := prPaise(group(`<AMOUNT>(-?\d+\.\d{2})</AMOUNT>`, emp, 1))
	mk := func(n int) string {
		parts := strings.SplitAfter(many.String(), "</EMPLOYEEENTRIES.LIST>\n")[:n]
		head := x[:strings.Index(x, "<EMPLOYEEENTRIES.LIST>")]
		tail := x[strings.LastIndex(x, "</EMPLOYEEENTRIES.LIST>\n")+len("</EMPLOYEEENTRIES.LIST>\n"):]
		net := -empAmt * int64(n)
		tail = regexp.MustCompile(`(</LEDGERNAME>\n<ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>\n<AMOUNT>)[0-9.]+`).ReplaceAllString(tail, "${1}"+fmt.Sprintf("%d.%02d", net/100, net%100))
		return head + strings.Join(parts, "") + tail
	}
	if why := payrollVoucherShape(mk(100)); why != "" {
		t.Fatalf("100 employees refused: %s", why)
	}
	if payrollVoucherShape(mk(101)) == "" {
		t.Fatal("101 employees accepted")
	}
}

func TestPayrollNeverPlainImport(t *testing.T) {
	x := payrollFixture(t)
	for _, y := range []string{
		strings.NewReplacer("EMPLOYEEENTRIES.LIST", "employeeentries.list", "PAYHEADALLOCATIONS.LIST", "payheadallocations.list", "CATEGORYENTRY.LIST", "categoryentry.list", "PaySlip Voucher View", "Payslip Voucher View").Replace(x),
		strings.NewReplacer("EMPLOYEEENTRIES.LIST", "EmployeeEntries.List", `OBJVIEW="PaySlip Voucher View"`, `OBJVIEW='PaySlip Voucher View'`).Replace(x),
		strings.Replace(strings.ToLower(x), `action="create"`, `ACTION="Alter"`, 1),
	} {
		e := payrollEnv(y)
		if tallyRequestID(e) != payrollImportID {
			t.Errorf("a case variant is routed as %q", tallyRequestID(e))
		}
		if checkAllowed(e) == nil {
			t.Error("a case variant of a payroll voucher is allowed")
		}
		if pinnedToBuilder("Import", e) {
			t.Error("a payroll-shaped body passes the plain Import pin")
		}
	}
}

func TestPayrollPostsAlone(t *testing.T) {
	x := payrollFixture(t)
	reqs := planImports(nil, []M{{"id": "j1", "xml": "<VOUCHER VCHTYPE=\"Journal\" ACTION=\"Create\"></VOUCHER>"}, {"id": "p1", "xml": x}, {"id": "j2", "xml": "<VOUCHER VCHTYPE=\"Journal\" ACTION=\"Create\"></VOUCHER>"}})
	alone := false
	for _, r := range reqs {
		for _, it := range r.items {
			if it["id"] == "p1" {
				alone = len(r.items) == 1
			}
		}
	}
	if !alone {
		t.Fatal("a payroll voucher shares a request with other vouchers")
	}
	// the posting job's queue too (review of e6b6994a2)
	j := func(id string) M {
		return M{"id": id, "xml": "<VOUCHER VCHTYPE=\"Journal\" ACTION=\"Create\"></VOUCHER>"}
	}
	q := newPostQueue(nil, []M{j("j1"), j("j2"), {"id": "p1", "xml": x}, j("j3")})
	var got [][]string
	for q.left() && len(got) < 10 {
		r := q.next()
		var ids []string
		for _, it := range r.items {
			ids = append(ids, str(it["id"]))
		}
		got = append(got, ids)
		q.done(r, 0.1, nil)
	}
	for _, p := range got {
		for _, id := range p {
			if id == "p1" && len(p) != 1 {
				t.Fatalf("the job queue puts the payroll voucher with others: %v", got)
			}
		}
	}
	if len(got) < 3 {
		t.Fatalf("parts: %v", got)
	}
}

func TestPayrollImportOwnID(t *testing.T) {
	x := importEnvelope("Vouchers", zz, `<TALLYMESSAGE xmlns:UDF="TallyUDF">`+payrollFixture(t)+"</TALLYMESSAGE>")
	if id := tallyRequestID(x); id != payrollImportID {
		t.Fatalf("a payroll voucher's import is %q, not %s", id, payrollImportID)
	}
	plain := importEnvelope("Vouchers", zz, `<TALLYMESSAGE xmlns:UDF="TallyUDF"><VOUCHER VCHTYPE="Journal" ACTION="Create"><DATE>20261031</DATE></VOUCHER></TALLYMESSAGE>`)
	if id := tallyRequestID(plain); id != "Import" {
		t.Fatalf("a plain import is %q", id)
	}
	// a payroll body with anything wider is refused by its pin
	wide := strings.Replace(x, "</VOUCHER>", "</VOUCHER><LEDGER NAME=\"X\" ACTION=\"Create\"></LEDGER>", 1)
	if checkAllowed(wide) == nil {
		t.Fatal("a payroll import carrying a ledger master passes")
	}
	if requestClass[payrollImportID] != "import" || !readStopExempt(payrollImportID) {
		t.Fatal("the payroll import is not classed as a posting")
	}
}
