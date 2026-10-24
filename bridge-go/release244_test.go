package main

import (
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

// --- 2.4.4 (the owner's decisions of 12-Oct-2026: payroll and salary TDS from Tally): the version; the allow-list's
// decision line ("allowed for 2.4.4 by the owner's decision of 2026-10-12") naming the new request, its twelve fields, the
// ledger requests' four fields, the two salary-payment fields kept, the fields never kept and the payroll voucher's 3 s,
// 2.4.3's decision kept as history; a dated "re-measured" line for 2.4.4; the table and its hash; the add-on unchanged
// from 2.4.3 (the data locations are not in 2.4.4); migration 74 add-only; the notes and the test sheet
func TestRelease244VersionAndDecisionLine(t *testing.T) {
	if BridgeVersion != "2.4.7" { // 2.4.7 (r247pair_test.go); 2.4.6 (r246pair_test.go); 2.4.5 (r245_test.go): kept as history
		t.Fatalf("BridgeVersion %s", BridgeVersion)
	}
	al := readText(filepath.Join("..", "docs", "tally-allowlist.md"))
	line := group(`(?m)^(First table: .*)$`, al, 1)
	want := []string{
		"as for 2.4.4: the owner's decision of 2026-10-12",
		empListID, "GUID, MASTERID, ALTERID, NAME, PARENT, CATEGORY, FORPAYROLL, ISEMPLOYEEGROUP, PANNUMBER, DATEOFJOIN, DEACTIVATIONDATE, DESIGNATION",
		"2,000 MasterIDs a request at most", "only payroll rows", "before anything is logged, stored or sent", "FinComEmployeeChanges not approved",
		"FinComLedgers", "FinComLedgerChanges", "FinComLedgerByName", "PAYTYPE, PAYSTATTYPE, ITCOMPONENT and FORPAYROLL",
		"ALLLEDGERENTRIES.BANKALLOCATIONS.BANKEMPLOYEENAME", "ALLLEDGERENTRIES.BANKALLOCATIONS.AMOUNT", "never ACCOUNTNUMBER, IFSCODE or PAYMENTFAVOURING",
		"FinComVoucherObject", "the request itself is unchanged byte for byte", "shape ce0e72f74e72", "up to 3 s", "payroll voucher",
		"every other request keeps 2 s", "one request in flight", "no date of birth, Aadhaar, bank or other personal field",
		"real TallyPrime 3.0, 4.1, 5.1, 6.2 and 7.1", "no AI",
		"as for 2.4.3: the owner's decision of 2026-10-11",
		"as for 2.4.2: the owner's decision of 2026-10-11",
		"as for 2.4.1: the owner's standing decision of 2026-10-06",
		"as for 2.4.0: the owner's decision of 2026-10-07"}
	for _, w := range want {
		if !strings.Contains(line, w) {
			t.Errorf("the decision line does not say %q", w)
		}
	}
	for _, id := range []string{empListID, ledListID, ledChangesID, ledByNameID} {
		if !strings.Contains(line, shapeOf(allowListSamples()[id])) {
			t.Errorf("the decision line does not give %s's shape %s", id, shapeOf(allowListSamples()[id]))
		}
	}
	if !strings.Contains(al, "Table hash (SHA-256): "+allowListHash(allowListRows())) {
		t.Error("the table hash in the doc is not the table's")
	}
	if !regexp.MustCompile(`re-measured on 2026-10-12 for 2\.4\.4[^\n]*2\.4\.4 allowed by`).MatchString(al) {
		t.Error("no dated re-measured line for 2.4.4")
	}
	// every row the bridge sends measured (release-check step 5): the new one among them
	if a := tallyAllowList[empListID]; a.maxSec <= 0 || a.measuredOn == "" {
		t.Error("FinComEmployees is not measured")
	}
	tdl := readText(filepath.Join("addon", "FinComRecorder.tdl"))
	if strings.Contains(tdl, "|dp=") || strings.Contains(tdl, "vDP") {
		t.Error("the add-on writes the data folder (the data locations are not in 2.4.4)")
	}
	notes := strings.Join(strings.Fields(readText(filepath.Join("..", "docs", "bridge-2.4.4-notes.md"))), " ")
	for _, w := range []string{"2.4.4", empListID, "FORPAYROLL", "PAYTYPE", "PAYSTATTYPE", "ITCOMPONENT", "BANKEMPLOYEENAME", "3 s", "migration 74",
		"No AI in the bridge", "add-on unchanged from 2.4.3", "Annexure I", "Annexure II", "Form 16", "check before filing", "senior citizen", "date of birth"} {
		if !strings.Contains(notes, w) {
			t.Errorf("the 2.4.4 notes do not say %q", w)
		}
	}
	sheet := strings.Join(strings.Fields(readText(filepath.Join("..", "docs", "bridge-2.4.4-test-sheet.txt"))), " ")
	for _, w := range []string{"2.4.4", "FinComBridge-Setup-2.4.4.exe", "HOW TO ROLL BACK (go back to 2.4.3)", "TRIAL 244", "migration 74", "Payroll", "Employees"} {
		if !strings.Contains(sheet, w) {
			t.Errorf("the 2.4.4 test sheet does not say %q", w)
		}
	}
}

// migration 74: add-only (no drop, no delete, no truncate), one transaction, the lock timeout, the one call added to 73's
// tally_ingest_details and nothing else of it changed
func TestRelease244Migration74AddOnly(t *testing.T) {
	m := readText(filepath.Join("..", "server", "tally-cloud", "migration-74-payroll.sql"))
	code := regexp.MustCompile(`(?m)--.*$`).ReplaceAllString(strings.ToLower(m), "")
	for _, bad := range []string{"drop ", "delete from", "truncate", "alter column", "birth", "aadha", "ifsc", "account_n"} {
		if strings.Contains(code, bad) {
			t.Errorf("migration 74 has %q", bad)
		}
	}
	if !strings.Contains(m, "begin;\nset local lock_timeout = '10s';") || !strings.HasSuffix(strings.TrimSpace(m), "commit;") {
		t.Error("migration 74 is not one transaction with the lock timeout")
	}
	fn := func(src string) string {
		return group(`(?s)create or replace function public\.tally_ingest_details\(p_book uuid, p_vouchers jsonb, p_keep boolean\).*?\$function\$(.*?)\$function\$`, src, 1)
	}
	m73 := fn(readText(filepath.Join("..", "server", "tally-cloud", "migration-73-tds-fields.sql")))
	m74 := fn(m)
	a73 := "  perform tally_ingest_tdstally(p_book, p_vouchers);     -- 73: each TDS payment's challan and the TDS references (bridge 2.4.3, the Day Book)\n"
	a74 := "  perform tally_ingest_salpay(p_book, p_vouchers);     -- 74: the salary paid to each employee (bridge 2.4.4, the Day Book)\n"
	if m73 == "" || m74 != strings.Replace(m73, a73, a73+a74, 1) {
		t.Error("migration 74's tally_ingest_details is not 73's text with the one line added")
	}
}
