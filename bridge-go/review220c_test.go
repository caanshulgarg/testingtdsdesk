package main

// Bridge 2.2.0, round 3 of the reviews: written before the fixes.

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// --- R3-1: the FinComSlice guard holds for EVERY date form, the filter-only one included; a request whose dates sit
// only in a TDL filter counts as dated
func TestSliceGuardEveryForm(t *testing.T) {
	f := newStandTally(t)
	standBridge(t, f, "")
	noteStartPoint(zz, "co-guid-1", 5, 3)
	ym := nowFn().Format("200601")
	for _, form := range collForms {
		saveDateForm(zz, form, "202508", 3)
		ok := sliceRequest(zz, form, ym, 5)
		if datedRefused(fin, ok) != nil {
			t.Errorf("%s: the calibrated slice is refused", form)
		}
		end, end2 := monthEnd(ym), monthEnd(nextYm(ym))
		bad := map[string]string{
			"2019-04 above 0":           sliceRequest(zz, form, "201904", 0),
			"2099-12":                   sliceRequest(zz, form, "209912", 5),
			"AlterID 0":                 sliceRequest(zz, form, ym, 0),
			"below the starting point":  sliceRequest(zz, form, ym, 4),
			"before the starting point": sliceRequest(zz, form, nowFn().AddDate(0, -1, 0).Format("200601"), 5),
			"next month":                sliceRequest(zz, form, nextYm(ym), 5),
			"two months": strings.NewReplacer(">"+end+"<", ">"+end2+"<", ">"+tallyDMY(end)+"<", ">"+tallyDMY(end2)+"<",
				"&#34;"+tallyDMY(end)+"&#34;", "&#34;"+tallyDMY(end2)+"&#34;").Replace(ok),
			"another company": sliceRequest("OTHER CO", form, ym, 5),
		}
		for _, other := range collForms {
			if other != form {
				bad["the form "+other] = sliceRequest(zz, other, ym, 5)
			}
		}
		for name, x := range bad {
			if x == ok {
				t.Fatalf("%s/%s: the bad case is the good one", form, name)
			}
			if datedRefused(fin, x) == nil {
				t.Errorf("%s: %s passes the dated guard", form, name)
			}
		}
	}
	// any request with its dates only in a filter is dated: refused with ReadDays off unless one of the two exceptions
	for _, form := range []string{collFilterOnly, collFilterGE, collFilterBtw} {
		x := formCollection(tagCheckID, zz, form, "20250401", "20250430", "GUID, DATE", "")
		if datedRefused(fin, x) == nil {
			t.Errorf("a FinComTag with %s passes the dated guard", form)
		}
	}
	x := fcCollection(tagCheckID, zz, "", "Voucher", "GUID", `$Date &gt; $$Date:"1-Apr-2019"`)
	if datedRefused(fin, x) == nil {
		t.Error("a $Date filter passes the dated guard")
	}
	// the body fetch always goes through its own check, with or without dates
	vb := voucherByMasterRequest(zz, "20261004", []string{"5"})
	noDates := strings.Replace(vb, "<SVFROMDATE>20261004</SVFROMDATE><SVTODATE>20261004</SVTODATE>", "", 1)
	if noDates == vb || datedRefused(fin, noDates) == nil {
		t.Error("a FinComVoucherByMaster without its period passes the guard")
	}
}

// --- R3-3: the same version with other bytes is said so
func TestSetupSameVersionOtherBytes(t *testing.T) {
	var said []string
	oldL, oldV := installLogFn, exeVersionFn
	installLogFn = func(s string) { said = append(said, s) }
	exeVersionFn = func(string) string { return BridgeVersion }
	defer func() { installLogFn, exeVersionFn = oldL, oldV }()
	d := t.TempDir()
	_ = os.WriteFile(filepath.Join(d, "FinComBridge.exe"), []byte("new build"), 0o755)
	_ = os.WriteFile(filepath.Join(d, "FinComBridge.setup-old.exe"), []byte("older build"), 0o755)
	_ = os.WriteFile(filepath.Join(d, "FinComBridge.previous.new"), []byte("older build"), 0o755)
	notePreviousFromSetup(d)
	if !strings.Contains(fmt.Sprint(said), "is the same version ("+BridgeVersion+") as the one installed, another build of it: it is not kept for a rollback") {
		t.Fatalf("said: %v", said)
	}
}

// --- R3-2: no test leaves a log in the package folder
func TestNoLogInPackageFolder(t *testing.T) {
	if exists("tds-bridge.log") {
		t.Fatal("bridge-go/tds-bridge.log exists: a test wrote the log into the package folder")
	}
	if !strings.Contains(readText("../.gitignore"), "bridge-go/tds-bridge.log") {
		t.Fatal(".gitignore does not name bridge-go/tds-bridge.log")
	}
}
