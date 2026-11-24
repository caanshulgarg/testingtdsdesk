package main

// bridge 2.5.22 (next-bridge-2522): the version. The beat says per linked company why it is not read (skip), why it
// has no change numbers (numbersWhy) and its add-on not heard (addonSilent): tell2522.go, addonsilent2522.go. No request
// is added to Tally and the allow-list's table and hash stay 2.5.21's; the decision and dated lines name 2.5.22 by the
// owner's standing decision of 2026-10-06 (docs/tally-allowlist.md).
import (
	"os"
	"strings"
	"testing"
)

func TestR2522Version(t *testing.T) {
	if BridgeVersion != "2.5.22" || !newerVersion("2.5.22", "2.5.21") || newerVersion("2.5.21", "2.5.22") {
		t.Fatalf("version %s", BridgeVersion)
	}
	for _, f := range []string{"../docs/bridge-2.5.22-test-sheet.txt", "../docs/bridge-2.5.22-notes.md"} {
		if _, err := os.Stat(f); err != nil {
			t.Fatal(err)
		}
	}
	al := readText("../docs/tally-allowlist.md")
	if len(tallyAllowList) != r2521Requests {
		t.Errorf("2.5.22 adds no request: %d on the allow-list, 2.5.21 had %d", len(tallyAllowList), r2521Requests)
	}
	// the table and its hash as 2.5.21's
	if h := allowListHash(allowListRows()); h != r2522TableHash || !strings.Contains(al, "Table hash (SHA-256): "+r2522TableHash) {
		t.Errorf("the allow-list table changed: %s", h)
	}
	if !strings.Contains(al, "(re-measured on 2026-11-24 for 2.5.22: nothing new to measure, no request added or changed") {
		t.Error("no dated line for 2.5.22")
	}
	line := group(`(?m)^(First table: .*)$`, al, 1)
	for _, w := range []string{"allowed for 2.5.22 by the owner's standing decision of 2026-10-06 (2.5.22: no request added or changed", "as for 2.5.21 by the owner's standing decision of 2026-10-06"} {
		if !strings.Contains(line, w) {
			t.Errorf("the decision line does not say %q", w)
		}
	}
	sheet := readText("../docs/bridge-2.5.22-test-sheet.txt")
	for _, w := range []string{"FinComBridge-Setup-2.5.22.exe", "ZZ TEST", "typing", "ownerUnknown", "addonSilent", "no new request"} {
		if !strings.Contains(sheet, w) {
			t.Errorf("the 2.5.22 test sheet does not say %q", w)
		}
	}
	notes := strings.Join(strings.Fields(readText("../docs/bridge-2.5.22-notes.md")), " ")
	for _, w := range []string{`"skip":`, `"numbersWhy":`, `"addonSilent":`, "No new request to Tally", "privacy rule", "FinComDayHeadsPart"} {
		if !strings.Contains(notes, w) {
			t.Errorf("the 2.5.22 notes do not say %q", w)
		}
	}
}

// 2.5.21's table hash (docs/tally-allowlist.md): 2.5.22 keeps it
const r2522TableHash = "86bfeef4aa62999854852cee4177f293b88d8d81d428fb376f2e566472dd63b0"
