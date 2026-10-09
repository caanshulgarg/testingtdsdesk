package main

import (
	"path/filepath"
	"strings"
	"testing"
)

// --- 2.4.1 (the owner's approval of 09-Oct-2026): the version; the allow-list's decision line (the owner's standing
// decision of 2026-10-06: no request on the list and no request shape changed; the add-on's line is not a request) with
// 2.4.0's decision kept as history; the table and its hash unchanged (TestAllowListUnchanged); the notes and the test sheet
func TestRelease241VersionAndDecisionLine(t *testing.T) {
	if BridgeVersion != "2.4.1" {
		t.Fatalf("BridgeVersion %s", BridgeVersion)
	}
	al := readText(filepath.Join("..", "docs", "tally-allowlist.md"))
	line := group(`(?m)^(First table: .*)$`, al, 1)
	for _, w := range []string{
		"allowed for 2.4.1 by the owner's standing decision of 2026-10-06: no request on the list and no request shape changed (the add-on line change is not a request",
		"as for 2.4.0: the owner's decision of 2026-10-07"} {
		if !strings.Contains(line, w) {
			t.Errorf("the decision line does not say %q", w)
		}
	}
	for _, v := range []string{"2.3.4", "2.3.5", "2.4.0"} {
		if strings.Contains(al, "allowed for "+v+" by") {
			t.Errorf("the %s line is still an exception line (release-check accepts one version only)", v)
		}
	}
	if !strings.Contains(al, "Table hash (SHA-256): 9637918f31adcc340317881fb83853fe63297c78ed7d36531473a98c0547473c") {
		t.Error("the table hash changed")
	}
	if shapeOf(allowListSamples()[vchObjectID]) != "ce0e72f74e72" || shapeOf(allowListSamples()[vchByNumberID]) != "2167477221dc" {
		t.Errorf("the entry requests' shapes: object %s, by number %s", shapeOf(allowListSamples()[vchObjectID]), shapeOf(allowListSamples()[vchByNumberID]))
	}
	notes := strings.Join(strings.Fields(readText(filepath.Join("..", "docs", "bridge-2.4.1-notes.md"))), " ")
	for _, w := range []string{"2.4.1", "|dp=", "$Destination:Company:##SVCurrentCompany", "other_source", "migration 71", "tally_company_source_choose", "Use ①", "Decide later",
		"FinComVoucherByNumber", "reverses 2.3.4's L5", "starting day", "received_at", "S-M1", "not a request", "No AI in the bridge", "NOT run"} {
		if !strings.Contains(notes, w) {
			t.Errorf("the 2.4.1 notes do not say %q", w)
		}
	}
	sheet := strings.Join(strings.Fields(readText(filepath.Join("..", "docs", "bridge-2.4.1-test-sheet.txt"))), " ")
	for _, w := range []string{"2.4.1", "FinComBridge-Setup-2.4.1.exe", "HOW TO ROLL BACK (go back to 2.4.0)", "TRIAL 241", "migration-71-company-sources.sql", "|dp="} {
		if !strings.Contains(sheet, w) {
			t.Errorf("the 2.4.1 test sheet does not say %q", w)
		}
	}
}
