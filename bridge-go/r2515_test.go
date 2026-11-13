package main

// bridge 2.5.15 (13-Nov-2026, the owner's approval of five items): nothing new is asked of Tally. The items' own tests:
//  1. FinCom asked before each part of a queued posting (r2515postok_test.go; tests/run_post_ok_ingest.py)
//  2. an unreadable day is never sent as empty (r2515day_test.go)
//  3. safe file writes: fsync, rename, one .bak (r2515safe_test.go)
//  4. posting paused while posted-ids.json cannot be read (r2515record_test.go)
//  5. the self-update tried a second way, retried, and told to FinCom (r2515update_test.go; tests/run_beat2515_ingest.py)
// The allow-list (docs/tally-allowlist.md): wording only (the decision and dated lines, the stock row), no request changed.
import (
	"os"
	"regexp"
	"strings"
	"testing"
)

func TestR2515Version(t *testing.T) {
	if BridgeVersion != "2.5.15" || !newerVersion("2.5.15", "2.5.14") || newerVersion("2.5.14", "2.5.15") {
		t.Fatalf("version %s", BridgeVersion)
	}
	if _, err := os.Stat("../docs/bridge-2.5.15-test-sheet.txt"); err != nil {
		t.Fatal(err)
	}
	// the allow-list: wording only (the decision line, the dated line, the stock row's version word), no request changed
	al := readText("../docs/tally-allowlist.md")
	line := group(`(?m)^(First table: .*)$`, al, 1)
	for _, w := range []string{"allowed for 2.5.15 by the owner's standing decision of 2026-10-06", "the requests are 2.5.14's", "as for 2.5.14 by the owner's standing decision of 2026-10-06"} {
		if !strings.Contains(line, w) {
			t.Errorf("the decision line does not say %q", w)
		}
	}
	if !regexp.MustCompile(`re-measured on 2026-11-13 for 2\.5\.15: no request was measured again[^\n]*allowed for 2\.5\.15 by the owner's standing decision of 2026-10-06`).MatchString(al) {
		t.Error("no dated line for 2.5.15")
	}
	if strings.Contains(line, "allowed for 2.5.14 by") {
		t.Error("2.5.14's line is still worded as the current one")
	}
}
