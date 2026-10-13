// Security-review hardening (2.1.5): a company's name never takes its folder out of the sync folder.
package main

import (
	"os"
	"path/filepath"
	"testing"
)

// a company's name never takes its folder out of the sync folder
func TestSafeNameNoTraversal(t *testing.T) {
	for _, bad := range []string{"", " ", ".", "..", " .. ", ".hidden", "..\\..\\Windows", "../../etc", "./x", "...", "\x00"} {
		if n, err := safeName(bad); err == nil {
			t.Fatalf("safeName(%q) = %q, want an error", bad, n)
		}
	}
	for in, want := range map[string]string{"ZZ BIG TEST": "ZZ BIG TEST", "A/B Traders": "A_B Traders", `C:\x`: "C__x", "Shah & Co. Pvt. Ltd.": "Shah & Co. Pvt. Ltd."} {
		if got, err := safeName(in); err != nil || got != want {
			t.Fatalf("safeName(%q) = %q, %v (want %q)", in, got, err, want)
		}
	}
	f := newStandTally(t)
	standBridge(t, f, "")
	for _, bad := range []string{"..", ".", "../outside"} {
		if dir, err := companyDir(bad); err == nil {
			t.Fatalf("companyDir(%q) = %q, want an error", bad, dir)
		}
		if _, err := importKeepSeed(bad, "20260401", "20260430", "<ENVELOPE/>"); err == nil {
			t.Fatalf("importKeepSeed(%q): no error", bad)
		}
		if _, err := importKeepOpening(bad, "<ENVELOPE/>"); err == nil {
			t.Fatalf("importKeepOpening(%q): no error", bad)
		}
		if _, err := loadHeld(bad); err == nil {
			t.Fatalf("loadHeld(%q): no error", bad)
		}
	}
	// nothing was written next to the sync folder
	ents, _ := os.ReadDir(filepath.Dir(syncDir()))
	for _, e := range ents {
		if e.Name() == "keep.json" || e.Name() == "manifest.json" {
			t.Fatalf("a file was written outside the sync folder: %s", e.Name())
		}
	}
	for _, p := range []string{"/synced?company=..", "/syncfile?company=..&file=balances.json"} {
		if code, _ := callLocal(t, "GET", p, "", ""); code == 200 {
			t.Fatalf("%s answered 200", p)
		}
	}
}

// the tests' shorthand for a company's folder (a name that cannot be one fails the test run)
func syncFolder(company string) string {
	dir, err := companyDir(company)
	if err != nil {
		panic(err)
	}
	return dir
}
