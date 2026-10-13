package main

// release-240, the owner's rule: only master types proven on all five TallyPrime releases ship. The real-Tally run
// 37840646524 (tally-versions, mhook, the add-on of next-masterhook 9a9031a1) showed Pay Head and Stock Item FAIL on each
// of 3.0, 4.1, 5.1, 6.2 and 7.1, and Godown FAIL on 3.0, 4.1, 5.1 and 6.2 (it passed on 7.1 only). So the shipped add-on
// carries no master-form hook for Godown, Pay Head or Stock Item (nor Unit or Employee, never shipped); the Voucher and
// Ledger hooks and the System Events that were in the add-on before 2.4.0 stay exactly as they were. Migration 66 stays
// (add-only, unused); the bridge's pairing of such lines (masterhook.go) stays inert: no shipped add-on writes them.
// Written before the add-on was changed (red first).

import (
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

func TestMasterHookNoneShippedIn240(t *testing.T) {
	tdl := strings.ReplaceAll(readText(filepath.Join("addon", liveAddonName)), "\r\n", "\n")
	if tdl == "" {
		t.Fatal("the add-on is not there")
	}
	// no master form hooked, no master form's event written
	for _, form := range []string{"Pay Head", "Stock Item", "Godown", "Unit", "Employee"} {
		if regexp.MustCompile(`(?mi)^\s*\[#?Form\s*:\s*` + regexp.QuoteMeta(form) + `\s*\]`).MatchString(tdl) {
			t.Errorf("the shipped add-on hooks the %s form (not proven on all five TallyPrime releases: run 37840646524)", form)
		}
	}
	for _, ev := range []string{"payhead_accept", "stockitem_accept", "godown_accept", "unit_accept", "employee_accept"} {
		if strings.Contains(strings.ToLower(tdl), ev) {
			t.Errorf("the shipped add-on writes %q", ev)
		}
	}
	// only the forms it hooked before 2.4.0
	var forms []string
	for _, m := range regexp.MustCompile(`(?m)^\s*\[#?Form\s*:\s*([^\]]+)\]`).FindAllStringSubmatch(tdl, -1) {
		forms = append(forms, strings.TrimSpace(m[1]))
	}
	if strings.Join(forms, ",") != "Voucher,Ledger" {
		t.Errorf("the add-on hooks the forms %v (want Voucher and Ledger only, as before 2.4.0)", forms)
	}
	// the hooks that were there before 2.4.0, unchanged
	for _, block := range []string{
		"[#Form: Voucher]\n" +
			"    On : Form Accept : @@FCRIsLive : Call : FCRLiveLog : \"voucher_accept_pre\"\n" +
			"    On : Form Accept : Yes          : Form Accept\n" +
			"    On : Form Accept : @@FCRIsLive : Call : FCRLiveLog : \"voucher_accept_post\"\n",
		"[#Form: Ledger]\n" +
			"    On : Form Accept : @@FCRIsLive : Call : FCRLiveLog : \"ledger_accept_pre\"\n" +
			"    On : Form Accept : Yes          : Form Accept\n" +
			"    On : Form Accept : @@FCRIsLive : Call : FCRLiveLog : \"ledger_accept_post\"\n",
		"[System: Events]\n" +
			"    FCRLDelBefore  : Before Delete Object : @@FCRIsLive : Call : FCRLiveLog : \"before_delete\"\n" +
			"    FCRLDelAfter   : After Delete Object  : @@FCRIsLive : Call : FCRLiveLog : \"after_delete\"\n" +
			"    FCRLCanBefore  : Before Cancel Object : @@FCRIsLive : Call : FCRLiveLog : \"before_cancel\"\n" +
			"    FCRLCanAfter   : After Cancel Object  : @@FCRIsLive : Call : FCRLiveLog : \"after_cancel\"\n" +
			"    FCRLImpStart   : Start Import         : @@FCRIsLive : Call : FCRLiveLog : \"start_import\"\n" +
			"    FCRLImpObject  : Import Object        : @@FCRIsLive : Call : FCRLiveLog : \"import_object\"\n" +
			"    FCRLImpAfter   : After Import Object  : @@FCRIsLive : Call : FCRLiveLog : \"after_import_object\"\n" +
			"    FCRLImpEnd     : End Import           : @@FCRIsLive : Call : FCRLiveLog : \"end_import\"\n",
	} {
		if !strings.Contains(tdl, block) {
			t.Errorf("the add-on's pre-2.4.0 hook changed or is gone:\n%s", block)
		}
	}
	if n := len(regexp.MustCompile(`(?m)^\s*FCRL\w+\s*:`).FindAllString(tdl, -1)); n != 8 {
		t.Errorf("%d System Events (want the 8 that were there before 2.4.0)", n)
	}
	// the bridge's list of hooked master forms (TestMasterHookAddon holds the add-on to it) is empty
	if len(liveMasterHooked) != 0 {
		t.Errorf("liveMasterHooked %v (want none in 2.4.0)", liveMasterHooked)
	}
}
