package main

import (
	"crypto/md5"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// --- 2.4.0 (release-240): the version; the allow-list's decision line quoting the owner's approval of the one request
// changed (next-tds, 07-Oct-2026) and keeping 2.3.5's and 2.3.4's as history; the notes and the test sheet naming each
// item with the owner's words where they are recorded; and the cloud's 63 and 67 carrying ONE combined
// tally_recorder_line (whichever runs last leaves the same function)
func TestRelease240VersionAndDecisionLine(t *testing.T) {
	if BridgeVersion != "2.4.0" {
		t.Fatalf("BridgeVersion %s", BridgeVersion)
	}
	al := readText(filepath.Join("..", "docs", "tally-allowlist.md"))
	line := group(`(?m)^(First table: .*)$`, al, 1)
	for _, w := range []string{
		"allowed for 2.4.0 by the owner's decision of 2026-10-07",
		`"Ask for all fields of the TDS list and its sub-list on FinComVoucherByMaster, FinComVoucherByNumber and test forms A and C. One entry per request, read only, nothing else added. Work out the rate as tax divided by assessable amount where Tally stores 0, and mark it as worked out."`,
		"FinComVoucherByNumber's fetch adds the two items (its shape 111afcb61eb9 -> 2167477221dc",
		"FinComVoucherObject is unchanged byte for byte (ce0e72f74e72",
		`"renumbering yes"`,
		"as for 2.3.5: the owner's standing decision of 2026-10-06: no request on the list and no request shape changed",
		"as for 2.3.4: the owner's decision of 2026-10-08: the entry request is FinComVoucherObject"} {
		if !strings.Contains(line, w) {
			t.Errorf("the decision line does not say %q", w)
		}
	}
	// release-check accepts one version only
	for _, v := range []string{"2.3.4", "2.3.5"} {
		if strings.Contains(al, "allowed for "+v+" by") {
			t.Errorf("the %s line is still an exception line", v)
		}
	}
	if shapeOf(allowListSamples()[vchObjectID]) != "ce0e72f74e72" || shapeOf(allowListSamples()[vchByNumberID]) != "2167477221dc" {
		t.Errorf("the entry requests' shapes: object %s, by number %s", shapeOf(allowListSamples()[vchObjectID]), shapeOf(allowListSamples()[vchByNumberID]))
	}
	notes := strings.Join(strings.Fields(readText(filepath.Join("..", "docs", "bridge-2.4.0-notes.md"))), " ")
	for _, w := range []string{"2.4.0", "next-inflight", "next-reask", "next-userfile", "next-tds", "next-outbox", "next-realtime",
		"next-selfcheck", "next-masterhook", "next-renumber", "next-push", "next-connect",
		"Its merge is reverted", "NOT in it", "One combined release", "from 2.3.3 straight to 2.4.0", "next-bankdate", "next-ledpage", "next-uploadpage", "next-sentry", "next-outbox-app",
		"Ask for all fields of the TDS list and its sub-list on FinComVoucherByMaster, FinComVoucherByNumber and test forms A and C.",
		"renumbering yes", "The 2-second stop itself is unchanged", "Unit and Employee are left out", "Pay Head, Stock Item and Godown",
		"$$SysInfo:WindowsUser", "10 s for the nightly bank-date list, outside office hours only, by the owner's decision of 2026-10-09", "migrations 62, 63, 64, 65, 66 and 67", "ONE combined text", "NOT built", "No AI in the bridge"} {
		if !strings.Contains(notes, w) {
			t.Errorf("the 2.4.0 notes do not say %q", w)
		}
	}
	sheet := strings.Join(strings.Fields(readText(filepath.Join("..", "docs", "bridge-2.4.0-test-sheet.txt"))), " ")
	for _, w := range []string{"2.4.0", "FinComBridge-Setup-2.4.0.exe", "HOW TO ROLL BACK (go back to 2.3.3)", "docs/bridge-2.3.4-test-sheet.txt", "docs/bridge-2.3.5-test-sheet.txt", "|w=", "TRIAL 240",
		"migration-63-recorder-repeat.sql", "migration-67-recorder-renumbered.sql", "Unit sends nothing"} {
		if !strings.Contains(sheet, w) {
			t.Errorf("the 2.4.0 test sheet does not say %q", w)
		}
	}
	// 63 and 67: one combined tally_recorder_line, both files the same text, each its own marked lines
	fn := func(f string) string {
		b, err := os.ReadFile(filepath.Join("..", "server", "tally-cloud", f))
		if err != nil {
			t.Fatal(err)
		}
		s := string(b)
		i := strings.Index(s, "create or replace function public.tally_recorder_line(")
		j := strings.Index(s, "$function$;")
		if i < 0 || j < i {
			t.Fatalf("%s: no tally_recorder_line", f)
		}
		return s[i:j]
	}
	m63, m67 := fn("migration-63-recorder-repeat.sql"), fn("migration-67-recorder-renumbered.sql")
	if m63 != m67 {
		t.Errorf("63 and 67 carry different tally_recorder_line texts (md5 %x, %x)", md5.Sum([]byte(m63)), md5.Sum([]byte(m67)))
	}
	for _, w := range []string{"-- 63", "already have this line", "-- 67", "renumbered in Tally"} {
		if !strings.Contains(m63, w) {
			t.Errorf("the combined tally_recorder_line lacks %q", w)
		}
	}
	mo := readText(filepath.Join("..", "docs", "MIGRATION-ORDER.md"))
	if !strings.Contains(mo, "→ 60 → 68 → 70 → 62 → 63 → 64 → 65 → 66 → 67") || !strings.Contains(mo, "→ 60 → 68 → 70 → 62 → 67 → 63 → 64 → 65 → 66") {
		t.Error("docs/MIGRATION-ORDER.md does not give both orders with 63 and 67 swapped")
	}
}
