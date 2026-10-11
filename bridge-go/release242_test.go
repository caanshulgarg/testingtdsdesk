package main

import (
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

// --- 2.4.2 (round 44 part B, the owner's approval of 11-Oct-2026: "the bridge sends each entry's GST type"): the version;
// the allow-list's decision line ("allowed for 2.4.2 by the owner's decision of 2026-10-11") naming the fields kept and
// that the request is unchanged, 2.4.1's decision kept as history; a dated "re-measured" line for 2.4.2; the table and its
// hash unchanged (TestAllowListUnchanged); the add-on unchanged from 2.4.1 (the data locations moved to 2.4.3); migration
// 72 add-only; the notes and the test sheet
func TestRelease242VersionAndDecisionLine(t *testing.T) {
	if BridgeVersion != "2.4.2" {
		t.Fatalf("BridgeVersion %s", BridgeVersion)
	}
	al := readText(filepath.Join("..", "docs", "tally-allowlist.md"))
	line := group(`(?m)^(First table: .*)$`, al, 1)
	for _, w := range append([]string{
		"allowed for 2.4.2 by the owner's decision of 2026-10-11",
		"FinComVoucherObject",
		"the request itself is unchanged byte for byte",
		"shape ce0e72f74e72",
		"real TallyPrime 3.0, 4.1, 5.1, 6.2 and 7.1",
		"as for 2.4.1: the owner's standing decision of 2026-10-06",
		"as for 2.4.0: the owner's decision of 2026-10-07"}, gst242Want...) {
		if !strings.Contains(line, w) {
			t.Errorf("the decision line does not say %q", w)
		}
	}
	if !strings.Contains(al, "Table hash (SHA-256): 9637918f31adcc340317881fb83853fe63297c78ed7d36531473a98c0547473c") {
		t.Error("the table hash changed")
	}
	if !regexp.MustCompile(`re-measured on 2026-10-1[1-9][^\n]*allowed for 2\.4\.2`).MatchString(al) {
		t.Error("no dated re-measured line for 2.4.2")
	}
	tdl := readText(filepath.Join("addon", "FinComRecorder.tdl"))
	if strings.Contains(tdl, "|dp=") || strings.Contains(tdl, "vDP") {
		t.Error("the add-on writes the data folder (the data locations are 2.4.3's)")
	}
	notes := strings.Join(strings.Fields(readText(filepath.Join("..", "docs", "bridge-2.4.2-notes.md"))), " ")
	for _, w := range append([]string{"2.4.2", "GST type", "FinComVoucherObject", "unchanged", "migration 72", "2.4.3", "No AI in the bridge",
		"add-on unchanged from 2.4.1", "17(5)"}, gst242Want...) {
		if !strings.Contains(notes, w) {
			t.Errorf("the 2.4.2 notes do not say %q", w)
		}
	}
	sheet := strings.Join(strings.Fields(readText(filepath.Join("..", "docs", "bridge-2.4.2-test-sheet.txt"))), " ")
	for _, w := range []string{"2.4.2", "FinComBridge-Setup-2.4.2.exe", "HOW TO ROLL BACK (go back to 2.4.1)", "TRIAL 242", "migration 72"} {
		if !strings.Contains(sheet, w) {
			t.Errorf("the 2.4.2 test sheet does not say %q", w)
		}
	}
}

// migration 72: add-only (no drop, no delete, no truncate), one transaction, the lock timeout, the one call added to 62's
// tally_ingest_details and nothing else of it changed
func TestRelease242Migration72AddOnly(t *testing.T) {
	m := readText(filepath.Join("..", "server", "tally-cloud", "migration-72-gst-type.sql"))
	low := strings.ToLower(m)
	for _, bad := range []string{"drop ", "delete from", "truncate", "alter column"} {
		code := regexp.MustCompile(`(?m)--.*$`).ReplaceAllString(low, "")
		if strings.Contains(code, bad) {
			t.Errorf("migration 72 has %q", bad)
		}
	}
	if !strings.Contains(m, "begin;\nset local lock_timeout = '10s';") || !strings.HasSuffix(strings.TrimSpace(m), "commit;") {
		t.Error("migration 72 is not one transaction with the lock timeout")
	}
	fn := func(src string) string {
		return group(`(?s)create or replace function public\.tally_ingest_details\(p_book uuid, p_vouchers jsonb, p_keep boolean\).*?\$function\$(.*?)\$function\$`, src, 1)
	}
	m62 := fn(readText(filepath.Join("..", "server", "tally-cloud", "migration-62-tds-rate-worked-out.sql")))
	m72 := fn(m)
	add := "  perform tally_ingest_gsttype(p_book, p_vouchers);     -- 72: each entry's GST type (bridge 2.4.2, the Day Book), before the details' own early return\n"
	if m62 == "" || m72 != strings.Replace(m62, "  if f is null then return; end if;\n", "  if f is null then return; end if;\n"+add, 1) {
		t.Error("migration 72's tally_ingest_details is not 62's text with the one line added")
	}
}
