package main

import (
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

// --- 2.4.5 (ROUND 102, the owner's change and decisions of 21-Oct-2026): the version; the allow-list's decision line
// ("allowed for 2.4.5 by the owner's decision of 2026-10-21") naming the two new ids, their shapes and the rules, 2.4.4's
// decision kept as history; a dated "re-measured" line for 2.4.5; the table and its hash; every row measured; the notes and
// the test sheet; migration 98 add-only with its own grants
func TestRelease245VersionAndDecisionLine(t *testing.T) {
	if BridgeVersion != "2.4.9" { // 2.4.9 (r249batch_test.go); 2.4.8 (r248anyport_test.go); 2.4.7 (r247pair_test.go): kept as history
		t.Fatalf("BridgeVersion %s", BridgeVersion)
	}
	al := readText(filepath.Join("..", "docs", "tally-allowlist.md"))
	line := group(`(?m)^(First table: .*)$`, al, 1)
	for _, w := range []string{
		"as for 2.4.5: the owner's decision of 2026-10-21", // 2.4.6: kept as history (r246pair_test.go)
		dayHeadsID, ledIdsID, "GUID, MASTERID, ALTERID, DATE", "MASTERID",
		"as for 2.4.4: the owner's decision of 2026-10-12"} {
		if !strings.Contains(line, w) {
			t.Errorf("the decision line does not say %q", w)
		}
	}
	for _, id := range []string{dayHeadsID, ledIdsID} {
		if !strings.Contains(line, shapeOf(allowListSamples()[id])) {
			t.Errorf("the decision line does not give %s's shape %s", id, shapeOf(allowListSamples()[id]))
		}
		if a := tallyAllowList[id]; a.maxSec <= 0 || a.maxSec > 2 || a.measuredOn == "" {
			t.Errorf("%s is not measured under 2 s", id)
		}
	}
	if !strings.Contains(al, "Table hash (SHA-256): "+allowListHash(allowListRows())) {
		t.Error("the table hash in the doc is not the table's")
	}
	if !regexp.MustCompile(`re-measured on 2026-10-21 for 2\.4\.5[^\n]*2\.4\.5 allowed by the owner's decision of 2026-10-21`).MatchString(al) {
		t.Error("no dated re-measured line for 2.4.5")
	}
	notes := strings.Join(strings.Fields(readText(filepath.Join("..", "docs", "bridge-2.4.5-notes.md"))), " ")
	for _, w := range []string{"2.4.5", dayHeadsID, ledIdsID, "8,412 of 12,960 vouchers (65%) · 4,548 left", "312 of 1,240 ledgers",
		"User TDL = No", "tally.ini.fincom-bak", "migration 98", "no AI", "never a blanket fetch", "Day Book report is not used", "one request in flight"} {
		if !strings.Contains(notes, w) {
			t.Errorf("the 2.4.5 notes do not say %q", w)
		}
	}
	sheet := strings.Join(strings.Fields(readText(filepath.Join("..", "docs", "bridge-2.4.5-test-sheet.txt"))), " ")
	for _, w := range []string{"2.4.5", "FinComBridge-Setup-2.4.5.exe", "HOW TO ROLL BACK (go back to 2.4.4)", "migration 98", "User TDL = No", "Bring older entries from Tally"} {
		if !strings.Contains(sheet, w) {
			t.Errorf("the 2.4.5 test sheet does not say %q", w)
		}
	}
}

// migration 98: add-only (no drop, no delete, no truncate, no existing function replaced), one transaction, the lock
// timeout, RLS on and explicit grants for each new table (ROUND 101)
func TestRelease245Migration98AddOnly(t *testing.T) {
	m := readText(filepath.Join("..", "server", "tally-cloud", "migration-98-period-pull.sql"))
	code := regexp.MustCompile(`(?m)--.*$`).ReplaceAllString(strings.ToLower(m), "")
	for _, bad := range []string{"drop ", "truncate", "alter column", "delete from public.tally_vouchers", "delete from public.tally_ledgers"} {
		// (ROUND 103: three columns added to tally_devices, "add column if not exists"; nothing dropped or changed)
		if strings.Contains(code, bad) {
			t.Errorf("migration 98 has %q", bad)
		}
	}
	if !strings.Contains(m, "begin;\nset local lock_timeout = '10s';") || !strings.HasSuffix(strings.TrimSpace(m), "commit;") {
		t.Error("migration 98 is not one transaction with the lock timeout")
	}
	for _, f := range regexp.MustCompile(`create or replace function public\.(\w+)`).FindAllStringSubmatch(code, -1) {
		if !strings.HasPrefix(f[1], "tally_period_") && f[1] != "tally_ledger_progress_save" && f[1] != "tally_device_period_fetch" && f[1] != "tally_device_period_night" {
			t.Errorf("migration 98 replaces %s (not one of its own)", f[1])
		}
	}
	for _, tb := range []string{"tally_period_pulls", "tally_period_days", "tally_ledger_progress"} {
		if !strings.Contains(code, "alter table public."+tb+" enable row level security") {
			t.Errorf("%s: no row level security", tb)
		}
		if !regexp.MustCompile(`grant select, insert, update, delete on (table )?public\.` + tb + ` to service_role`).MatchString(code) {
			t.Errorf("%s: no explicit grant to service_role", tb)
		}
	}
}
