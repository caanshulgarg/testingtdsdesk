package main

// bridge 2.5.20 (next-bridge-2520 with next-bridge-fix-alter): the version. The owner's decisions of 23-Nov-2026: P1 to
// P3 and reading on by default (docs/bridge-2.5.20-notes.md; r2520_test.go), and fix in place (fixalter.go; the
// owner's approval of 23-Nov-2026 for FinComFixVoucher and FinComFixLedger, docs/bridge-fix-in-place-test-sheet.txt).
// The allow-list (docs/tally-allowlist.md): the two fix-in-place rows added, NOT yet measured, allowed for 2.5.20 by
// the owner's decision of 2026-11-23 (TestAllowListUnchanged); P2's read back adds no request (FinComTag and
// FinComCompany, already on the list).
import (
	"os"
	"regexp"
	"strings"
	"testing"
)

func TestR2520Version(t *testing.T) {
	if BridgeVersion != "2.5.22" || !newerVersion("2.5.20", "2.5.19") || newerVersion("2.5.19", "2.5.20") { // 2.5.22 (r2522version_test.go); 2.5.21 (r2521version_test.go)
		t.Fatalf("version %s", BridgeVersion)
	}
	for _, f := range []string{"../docs/bridge-2.5.20-test-sheet.txt", "../docs/bridge-2.5.20-notes.md"} {
		if _, err := os.Stat(f); err != nil {
			t.Fatal(err)
		}
	}
	al := readText("../docs/tally-allowlist.md")
	line := group(`(?m)^(First table: .*)$`, al, 1)
	for _, w := range []string{"as for 2.5.20 by the owner's decision of 2026-11-23" /* 2.5.21 names the line (r2521version_test.go) */, "FinComFixVoucher", "FinComFixLedger", "as for 2.5.19 by the owner's decision of 2026-11-23"} {
		if !strings.Contains(line, w) {
			t.Errorf("the decision line does not say %q", w)
		}
	}
	if !regexp.MustCompile(`\(re-measured on 2026-11-24 for 2\.5\.20: [^\n]*FinComFixVoucher and FinComFixLedger[^\n]*NOT yet measured[^\n]*as allowed in 2\.5\.20 by the owner's decision of 2026-11-23\)`).MatchString(al) {
		t.Error("no dated line for 2.5.20")
	}
	if strings.Contains(line, "allowed for 2.5.19 by") || strings.Contains(al, "for the release after 2.5.20") {
		t.Error("2.5.19's line is still worded as the current one")
	}
	sheet := readText("../docs/bridge-2.5.20-test-sheet.txt")
	for _, w := range []string{"FinComBridge-Setup-2.5.20.exe", "ZZ TEST", "typing", "fix in place"} {
		if !strings.Contains(sheet, w) {
			t.Errorf("the 2.5.20 test sheet does not say %q", w)
		}
	}
}
