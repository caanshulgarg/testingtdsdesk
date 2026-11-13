package main

// bridge 2.5.16 (the security review's findings, test first): nothing new is asked of Tally. The items' own tests:
//  1. the FVU from this computer's settings, its fingerprint confirmed (r2516fvu_test.go)
//  2. the service's settings in its own folder, its fixed settings (r2516service_test.go)
//  3. the recorder files each user's own; the add-on line only in a tally.ini one person uses (r2516recorder_test.go;
//     tests/run_beat254_ingest.py)
//  4. a new bridge key at every pairing; FinCom's sites by build; refusals logged with a cap (r2516key_test.go)
//  5. the 2.5.15 review's two lows (r2516low_test.go; tests/run_post_ok_ingest.py)
// The allow-list (docs/tally-allowlist.md): wording only (TestAllowListUnchanged).
import (
	"os"
	"regexp"
	"strings"
	"testing"
)

func TestR2516Version(t *testing.T) {
	if BridgeVersion != "2.5.16" || !newerVersion("2.5.16", "2.5.15") || newerVersion("2.5.15", "2.5.16") {
		t.Fatalf("version %s", BridgeVersion)
	}
	if _, err := os.Stat("../docs/bridge-2.5.16-test-sheet.txt"); err != nil {
		t.Fatal(err)
	}
	al := readText("../docs/tally-allowlist.md")
	line := group(`(?m)^(First table: .*)$`, al, 1)
	for _, w := range []string{"allowed for 2.5.16 by the owner's standing decision of 2026-10-06", "the requests are 2.5.15's", "as for 2.5.15 by the owner's standing decision of 2026-10-06"} {
		if !strings.Contains(line, w) {
			t.Errorf("the decision line does not say %q", w)
		}
	}
	if !regexp.MustCompile(`re-measured on 2026-11-13 for 2\.5\.16: no request was measured again[^\n]*allowed for 2\.5\.16 by the owner's standing decision of 2026-10-06`).MatchString(al) {
		t.Error("no dated line for 2.5.16")
	}
	if strings.Contains(line, "allowed for 2.5.15 by") || strings.Contains(al, "allowed for 2.5.15 by") {
		t.Error("2.5.15's line is still worded as the current one")
	}
}
