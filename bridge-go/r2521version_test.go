package main

// bridge 2.5.21 (next-bridge-2521-rel: next-bridge-reupload): the version. A re-sent entry whose voucher in Tally is
// Optional or cancelled is not "already posted" (resent2519.go), unless the entry itself is Optional by the client's
// setting (entryOptional; post.go readBackTags the same). No request is added to Tally: the allow-list holds 2.5.20's
// requests; its decision and dated lines and the stock row's version word name 2.5.21 (docs/tally-allowlist.md).
import (
	"os"
	"strings"
	"testing"
)

func TestR2521Version(t *testing.T) {
	if BridgeVersion != "2.5.21" || !newerVersion("2.5.21", "2.5.20") || newerVersion("2.5.20", "2.5.21") {
		t.Fatalf("version %s", BridgeVersion)
	}
	for _, f := range []string{"../docs/bridge-2.5.21-test-sheet.txt", "../docs/bridge-2.5.21-notes.md"} {
		if _, err := os.Stat(f); err != nil {
			t.Fatal(err)
		}
	}
	al := readText("../docs/tally-allowlist.md")
	// no request added: the same requests as 2.5.20 (its table differs only by the stock row's version word)
	if len(tallyAllowList) != r2521Requests {
		t.Errorf("2.5.21 adds no request: %d on the allow-list, 2.5.20 had %d", len(tallyAllowList), r2521Requests)
	}
	if !strings.Contains(al, "(re-measured on 2026-11-24 for 2.5.21: nothing new to measure, no request added or changed") {
		t.Error("no dated line for 2.5.21")
	}
	line := group(`(?m)^(First table: .*)$`, al, 1)
	for _, w := range []string{"allowed for 2.5.21 by the owner's standing decision of 2026-11-23 (2.5.21: no request added or changed", "as for 2.5.20 by the owner's decision of 2026-11-23"} {
		if !strings.Contains(line, w) {
			t.Errorf("the decision line does not say %q", w)
		}
	}
	sheet := readText("../docs/bridge-2.5.21-test-sheet.txt")
	for _, w := range []string{"FinComBridge-Setup-2.5.21.exe", "ZZ TEST", "typing", "Optional", "no new request"} {
		if !strings.Contains(sheet, w) {
			t.Errorf("the 2.5.21 test sheet does not say %q", w)
		}
	}
}

// the requests on 2.5.20's allow-list (2.5.21 adds none)
const r2521Requests = 54
