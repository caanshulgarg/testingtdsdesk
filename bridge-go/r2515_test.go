package main

// bridge 2.5.15 (13-Nov-2026, the owner's approval of five items): nothing new is asked of Tally. The items' own tests:
//  1. FinCom asked before each part of a queued posting (r2515postok_test.go; tests/run_post_ok_ingest.py)
//  2. an unreadable day is never sent as empty (r2515day_test.go)
//  3. safe file writes: fsync, rename, one .bak (r2515safe_test.go)
//  4. posting paused while posted-ids.json cannot be read (r2515record_test.go)
//  5. the self-update tried a second way, retried, and told to FinCom (r2515update_test.go; tests/run_beat2515_ingest.py)
// The allow-list (docs/tally-allowlist.md) is 2.5.14's, unchanged (TestAllowListUnchanged): no request added or changed.
import (
	"strings"
	"testing"
)

// the version the allow-list's decision lines name: 2.5.14's, left as it was by 2.5.15 (the owner's instruction of
// 13-Nov-2026: docs/tally-allowlist.md and TestAllowListUnchanged unchanged). A later release that changes a request
// (or the owner's decision to name 2.5.15 there) moves it with the doc
const allowListVersion = "2.5.14"

func TestR2515Version(t *testing.T) {
	if BridgeVersion != "2.5.15" || !newerVersion("2.5.15", "2.5.14") || newerVersion("2.5.14", "2.5.15") {
		t.Fatalf("version %s", BridgeVersion)
	}
	// the allow-list is not touched by this release: its decision line still names 2.5.14's decision
	if al := readText("../docs/tally-allowlist.md"); !strings.Contains(al, "allowed for 2.5.14 by the owner's standing decision of 2026-10-06") || strings.Contains(al, "2.5.15") {
		t.Fatal("the allow-list was changed by 2.5.15")
	}
}
