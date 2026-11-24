package main

// bridge 2.5.19 (next-bridge-2519 with next-fast-bankpost): the version. The owner's decisions of 23-Nov-2026: B1, C1
// to C8 and E (docs/bridge-2.5.19-new-requests.md; r2519req_test.go), the tray's Quit bringing the icon back
// (trayquit2519.go), and the faster bank posting (fastbank_test.go; the same Import request, no request added).
// The allow-list (docs/tally-allowlist.md): seven rows added and four FETCHes grown, all NOT yet measured, allowed for
// 2.5.19 by the owner's decision of 2026-11-23 (TestAllowListUnchanged; 2.5.18's table otherwise: r2519hist_test.go).
import (
	"os"
	"regexp"
	"strings"
	"testing"
)

func TestR2519Version(t *testing.T) {
	if BridgeVersion != "2.5.21" || !newerVersion("2.5.19", "2.5.18") || newerVersion("2.5.18", "2.5.19") {
		t.Fatalf("version %s", BridgeVersion)
	}
	if _, err := os.Stat("../docs/bridge-2.5.19-test-sheet.txt"); err != nil {
		t.Fatal(err)
	}
	al := readText("../docs/tally-allowlist.md")
	line := group(`(?m)^(First table: .*)$`, al, 1)
	for _, w := range []string{"as for 2.5.19 by the owner's decision of 2026-11-23" /* 2.5.20 names the line (r2520version_test.go) */, "the faster bank posting", "as for 2.5.18 by the owner's decision of 2026-11-22"} {
		if !strings.Contains(line, w) {
			t.Errorf("the decision line does not say %q", w)
		}
	}
	if !regexp.MustCompile(`\(re-measured on 2026-11-23 for 2\.5\.19: [^\n]*NONE of them is measured yet[^\n]*2\.5\.19 allowed by the owner's decision of 2026-11-23\)`).MatchString(al) {
		t.Error("no dated line for 2.5.19")
	}
	if strings.Contains(al, "allowed for 2.5.18 by") || strings.Contains(al, "Next: for 2.5.19") {
		t.Error("2.5.18's line is still worded as the current one")
	}
	sheet := readText("../docs/bridge-2.5.19-test-sheet.txt")
	for _, w := range []string{"2.5.19", "ZZ BIG TEST", "bank", "674", "typing"} {
		if !strings.Contains(sheet, w) {
			t.Errorf("the 2.5.19 test sheet does not say %q", w)
		}
	}
}
