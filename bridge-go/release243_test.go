package main

import (
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

// --- 2.4.3 (the owner's approval of 11-Oct-2026: TDS challan details and TDS master settings from Tally): the version; the
// allow-list's decision line ("allowed for 2.4.3 by the owner's decision of 2026-10-11") naming the challan fields kept,
// the ledger requests' new fields and the new natures request, 2.4.2's decision kept as history; a dated "re-measured"
// line for 2.4.3; the add-on unchanged from 2.4.2 (the data locations moved to 2.4.4); migration 73 add-only; the notes
// and the test sheet
func TestRelease243VersionAndDecisionLine(t *testing.T) {
	if BridgeVersion != "2.4.9" { // 2.4.9 (r249batch_test.go); 2.4.8 (r248anyport_test.go); 2.4.7 (r247pair_test.go); 2.4.6 (r246pair_test.go); 2.4.5 (r245_test.go): 2.4.3's decision kept as history
		t.Fatalf("BridgeVersion %s", BridgeVersion)
	}
	al := readText(filepath.Join("..", "docs", "tally-allowlist.md"))
	line := group(`(?m)^(First table: .*)$`, al, 1)
	want := []string{
		"as for 2.4.3: the owner's decision of 2026-10-11",
		"FinComVoucherObject", "the request itself is unchanged byte for byte", "shape ce0e72f74e72",
		"FinComLedgers", "FinComLedgerChanges", "FinComLedgerByName", natListID,
		"TDSRATENAME", "TDSDEDUCTEEISSPECIALRATE", "TDSDEDUCTEESPECIALRATE", "LOWERDEDUCTION.NATUREOFPAYMENT",
		"FROMDATE", "TODATE", "SECTIONNO", "CERTIFICATENO", "TDSITRATE", "LOWERDEDUCTIONLIMIT",
		"EXEMPTIONLIMIT", "SINGLEBILLVALUE", "RATEOFTAX", "OTHERRATE", "NOPANRATEOFTAX", "NOPANOTHERRATE", "TDSRATESECTION", "APPLICABLEFROM",
		"real TallyPrime 3.0, 4.1, 5.1, 6.2 and 7.1",
		"as for 2.4.2: the owner's decision of 2026-10-11",
		"as for 2.4.1: the owner's standing decision of 2026-10-06",
		"as for 2.4.0: the owner's decision of 2026-10-07"}
	for _, w := range append(want, tds243Want...) {
		if !strings.Contains(line, w) {
			t.Errorf("the decision line does not say %q", w)
		}
	}
	// (2.4.4 changed the ledger requests' shapes and the table: release244_test.go)
	for _, id := range []string{natListID} {
		if !strings.Contains(line, shapeOf(allowListSamples()[id])) {
			t.Errorf("the decision line does not give %s's shape %s", id, shapeOf(allowListSamples()[id]))
		}
	}
	if !regexp.MustCompile(`re-measured on 2026-10-1[1-9] and 2026-10-12 for 2\.4\.3[^\n]*2\.4\.3 allowed by`).MatchString(al) {
		t.Error("no dated re-measured line for 2.4.3")
	}
	tdl := readText(filepath.Join("addon", "FinComRecorder.tdl"))
	if strings.Contains(tdl, "|dp=") || strings.Contains(tdl, "vDP") {
		t.Error("the add-on writes the data folder (the data locations are 2.4.4's)")
	}
	notes := strings.Join(strings.Fields(readText(filepath.Join("..", "docs", "bridge-2.4.3-notes.md"))), " ")
	for _, w := range append([]string{"2.4.3", "FinComVoucherObject", "FinComTdsNatures", "migration 73", "2.4.4", "No AI in the bridge",
		"add-on unchanged from 2.4.2", "Challan Reconciliation", "licensed", "NWS144", "Stat Payment", "From Tally"}, tds243Want...) {
		if !strings.Contains(notes, w) {
			t.Errorf("the 2.4.3 notes do not say %q", w)
		}
	}
	sheet := strings.Join(strings.Fields(readText(filepath.Join("..", "docs", "bridge-2.4.3-test-sheet.txt"))), " ")
	for _, w := range []string{"2.4.3", "FinComBridge-Setup-2.4.3.exe", "HOW TO ROLL BACK (go back to 2.4.2)", "TRIAL 243", "migration 73", "Challan Reconciliation", "Stat Payment"} {
		if !strings.Contains(sheet, w) {
			t.Errorf("the 2.4.3 test sheet does not say %q", w)
		}
	}
}

// migration 73: add-only (no drop, no delete, no truncate), one transaction, the lock timeout, the one call added to 72's
// tally_ingest_details and nothing else of it changed
func TestRelease243Migration73AddOnly(t *testing.T) {
	m := readText(filepath.Join("..", "server", "tally-cloud", "migration-73-tds-fields.sql"))
	code := regexp.MustCompile(`(?m)--.*$`).ReplaceAllString(strings.ToLower(m), "")
	for _, bad := range []string{"drop ", "delete from", "truncate", "alter column"} {
		if strings.Contains(code, bad) {
			t.Errorf("migration 73 has %q", bad)
		}
	}
	if !strings.Contains(m, "begin;\nset local lock_timeout = '10s';") || !strings.HasSuffix(strings.TrimSpace(m), "commit;") {
		t.Error("migration 73 is not one transaction with the lock timeout")
	}
	fn := func(src string) string {
		return group(`(?s)create or replace function public\.tally_ingest_details\(p_book uuid, p_vouchers jsonb, p_keep boolean\).*?\$function\$(.*?)\$function\$`, src, 1)
	}
	m72 := fn(readText(filepath.Join("..", "server", "tally-cloud", "migration-72-gst-type.sql")))
	m73 := fn(m)
	a72 := "  perform tally_ingest_gsttype(p_book, p_vouchers);     -- 72: each entry's GST type (bridge 2.4.2, the Day Book), before the details' own early return\n"
	a73 := "  perform tally_ingest_tdstally(p_book, p_vouchers);     -- 73: each TDS payment's challan and the TDS references (bridge 2.4.3, the Day Book)\n"
	if m72 == "" || m73 != strings.Replace(m72, a72, a72+a73, 1) {
		t.Error("migration 73's tally_ingest_details is not 72's text with the one line added")
	}
}
