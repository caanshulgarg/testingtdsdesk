package main

// bridge 2.5.18 (next-fix-audit-bridge with next-payroll): one request added, FinComPayrollImport, by the owner's approval
// of 22-Nov-2026 ("Yes for tally payroll request"; docs/PAYROLL.md section 4). The items' own tests:
//  1. the audit fixes: the typing gate, postings' reports, one Tally, the 2 s rule, measured part sizes and the
//     per-company posting pace (auditbridge_test.go, auditreview_test.go, round15_test.go)
//  2. the payroll import: one Tally payroll voucher per request, its shape pinned, posted alone (payroll2518_test.go;
//     the request driver posts one, allowlist_test.go)
// The allow-list (docs/tally-allowlist.md): the FinComPayrollImport row, not yet measured, allowed for 2.5.18 by the
// owner's decision of 2026-11-22; every other request is 2.5.17's (TestAllowListUnchanged).
import (
	"os"
	"regexp"
	"strings"
	"testing"
)

func TestR2518Version(t *testing.T) {
	if BridgeVersion != "2.5.22" || !newerVersion("2.5.18", "2.5.17") || newerVersion("2.5.17", "2.5.18") {
		t.Fatalf("version %s", BridgeVersion)
	}
	if _, err := os.Stat("../docs/bridge-2.5.18-test-sheet.txt"); err != nil {
		t.Fatal(err)
	}
	al := readText("../docs/tally-allowlist.md")
	line := group(`(?m)^(First table: .*)$`, al, 1)
	for _, w := range []string{"as for 2.5.18 by the owner's decision of 2026-11-22" /* 2.5.19 names the line (r2519_test.go) */, "the owner's approval of 22-Nov-2026 for FinComPayrollImport", "every other request is 2.5.17's", "as for 2.5.17 by the owner's standing decision of 2026-10-06"} {
		if !strings.Contains(line, w) {
			t.Errorf("the decision line does not say %q", w)
		}
	}
	if !regexp.MustCompile(`\(re-measured on 2026-11-22 for 2\.5\.18: the one request added, FinComPayrollImport \(the owner's approval of 22-Nov-2026\), is NOT measured yet[^\n]*2\.5\.18 allowed by the owner's decision of 2026-11-22\)`).MatchString(al) {
		t.Error("no dated line for 2.5.18")
	}
	if strings.Contains(al, "allowed for 2.5.17 by") {
		t.Error("2.5.17's line is still worded as the current one")
	}
	if _, ok := tallyAllowList[payrollImportID]; !ok || payrollImportID != "FinComPayrollImport" {
		t.Fatalf("no FinComPayrollImport on the list (%q)", payrollImportID)
	}
	if !regexp.MustCompile(`(?m)^\| FinComPayrollImport \| [^|]*owner approved 22-Nov-2026[^|]* \| [0-9a-f]{12} \| not yet measured \| - \| bridge \|$`).MatchString(al) {
		t.Error("the FinComPayrollImport row is not in the table as not yet measured")
	}
	sheet := readText("../docs/bridge-2.5.18-test-sheet.txt")
	for _, w := range []string{"2.5.18", "100 employees", "ZZ BIG TEST", "2-second", "Quit", "typing", "pace"} {
		if !strings.Contains(sheet, w) {
			t.Errorf("the 2.5.18 test sheet does not say %q", w)
		}
	}
}
