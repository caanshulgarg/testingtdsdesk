package main

// bridge 2.5.17 (next-fix-linkedguid with next-fix-mastersread): nothing new is asked of Tally. The items' own tests:
//  1. a posting goes only into the client's linked Tally company, by its GUID; nothing by name (linkguid_test.go,
//     linkguid_review_test.go, linkguid_round3_test.go, linkguid_round4_test.go, linkguid_closed_test.go; parts sized
//     by Tally's reply time: postbench_test.go)
//  2. the masters read says why it failed and is read again; the Tally page's four Masters states (mastersread_test.go;
//     tests/run_masters_states.py)
//  3. the daily catch-up by day at a quiet moment (mastersread_test.go)
//  4. reads use the postings' one rule for whose Tally is this user's own (ownrule_test.go)
// The allow-list (docs/tally-allowlist.md): wording only (TestAllowListUnchanged).
import (
	"os"
	"regexp"
	"strings"
	"testing"
)

func TestR2517Version(t *testing.T) {
	if BridgeVersion != "2.5.22" || !newerVersion("2.5.17", "2.5.16") || newerVersion("2.5.16", "2.5.17") { // 2.5.18 (r2518_test.go)
		t.Fatalf("version %s", BridgeVersion)
	}
	if _, err := os.Stat("../docs/bridge-2.5.17-test-sheet.txt"); err != nil {
		t.Fatal(err)
	}
	al := readText("../docs/tally-allowlist.md")
	line := group(`(?m)^(First table: .*)$`, al, 1)
	for _, w := range []string{"as for 2.5.17 by the owner's standing decision of 2026-10-06", "the requests are 2.5.16's" /* 2.5.18 names the line (r2518_test.go) */, "as for 2.5.16 by the owner's standing decision of 2026-10-06"} {
		if !strings.Contains(line, w) {
			t.Errorf("the decision line does not say %q", w)
		}
	}
	if !regexp.MustCompile(`re-measured on 2026-11-20 for 2\.5\.17: no request was measured again[^\n]*2\.5\.17 allowed by the owner's standing decision of 2026-10-06`).MatchString(al) {
		t.Error("no dated line for 2.5.17")
	}
	if strings.Contains(line, "allowed for 2.5.16 by") || strings.Contains(al, "allowed for 2.5.16 by") {
		t.Error("2.5.16's line is still worded as the current one")
	}
}
