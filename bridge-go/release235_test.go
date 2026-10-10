package main

import (
	"path/filepath"
	"strings"
	"testing"
)

// --- 2.3.5: the version (release-240: 2.4.0 now, with 2.3.5's decision kept as history, "as for 2.3.5: ..."), the
// allow-list's decision line (the owner's standing decision of 2026-10-06: no request added or
// changed; TestAllowListUnchanged keeps the table and its hash as in 2.3.4), and the notes and test sheet with the owner's
// words for what 2.3.5 carries (the Tally pages, Clear notifications, the three held-line fixes and their conditions)
func TestRelease235VersionAndDecisionLine(t *testing.T) {
	if BridgeVersion != "2.4.1" { // 2.4.1 (release241_test.go): this release's decisions kept as history
		t.Fatalf("BridgeVersion %s", BridgeVersion)
	}
	al := readText(filepath.Join("..", "docs", "tally-allowlist.md"))
	line := group(`(?m)^(First table: .*)$`, al, 1)
	for _, w := range []string{
		"as for 2.3.5: the owner's standing decision of 2026-10-06: no request on the list and no request shape changed",
		"as for 2.3.4: the owner's decision of 2026-10-08: the entry request is FinComVoucherObject"} {
		if !strings.Contains(line, w) {
			t.Errorf("the decision line does not say %q", w)
		}
	}
	for _, v := range []string{"2.3.4", "2.3.5"} {
		if strings.Contains(al, "allowed for "+v+" by") {
			t.Errorf("the %s line is still an exception line (release-check accepts one version only)", v)
		}
	}
	if !strings.Contains(al, "for 2.3.5: the table's rows and request shapes are unchanged since 2.3.4") {
		t.Error("no line saying 2.3.5 changed no row and no request shape")
	}
	notes := strings.Join(strings.Fields(readText(filepath.Join("..", "docs", "bridge-2.3.5-notes.md"))), " ")
	for _, w := range []string{"2.3.5", "tally option is so confusing", "if one time any notification is cleared then that notification should not appear",
		"the delete fix must keep the entry id and never create a line without it, and the refused-request change must not hide a real Tally failure from the try count",
		"migration 68", "No request to Tally is added or changed", "Clear notifications", "2.3.4"} {
		if !strings.Contains(notes, w) {
			t.Errorf("the 2.3.5 notes do not say %q", w)
		}
	}
	sheet := strings.Join(strings.Fields(readText(filepath.Join("..", "docs", "bridge-2.3.5-test-sheet.txt"))), " ")
	for _, w := range []string{"2.3.5", "FinComBridge-Setup-2.3.5.exe", "Clear notifications", "reading from Tally is stopped from FinCom", "ROLL BACK", "2.3.4"} {
		if !strings.Contains(sheet, w) {
			t.Errorf("the 2.3.5 test sheet does not say %q", w)
		}
	}
}
