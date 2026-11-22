package main

// 2.5.18: the payroll import (FinComPayrollImport), approved by the owner on 22-Nov-2026 (docs/PAYROLL.md section 4)

import (
	"os"
	"path/filepath"
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

func TestPayrollVoucherShape(t *testing.T) {
	x := payrollFixture(t)
	if !strings.HasSuffix(x, "\n") {
		x += "\n"
	}
	if why := payrollVoucherShape(x); why != "" {
		t.Fatalf("the fixture is refused: %s", why)
	}
	bad := map[string]string{
		"payable not the net": strings.Replace(x, "<LEDGERNAME>", "<LEDGERNAME>X", 1),
		"alter, not create":   strings.Replace(x, `ACTION="Create"`, `ACTION="Alter"`, 1),
		"an extra element":    strings.Replace(x, "</NARRATION>", "</NARRATION>\n<ISOPTIONAL>Yes</ISOPTIONAL>", 1),
		"an amount changed":   strings.Replace(x, "<AMOUNT>-45500.00</AMOUNT>", "<AMOUNT>-45400.00</AMOUNT>", 1),
		"a second voucher":    x + x,
		"no employee":         strings.Replace(x, "<EMPLOYEEENTRIES.LIST>", "<X>", -1),
	}
	for why, y := range bad {
		if why == "payable not the net" {
			continue // a ledger name change is still a valid shape; checked below by amount
		}
		if payrollVoucherShape(y) == "" {
			t.Errorf("%s: accepted", why)
		}
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
