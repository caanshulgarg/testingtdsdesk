package main

// Bridge 2.2.0, round 2 of the reviews (docs/reviews/bridge-2.2.0-*-review.md, "Round 2"): written before the fixes.

import (
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// --- R2-1: source C starts at the switch, asks nothing above a rise of 500, waits 5 s at most
func TestSourceCBounded(t *testing.T) {
	f, _ := sliceReady(t, 0)
	f.mu.Lock()
	f.alter += 700
	f.mu.Unlock()
	_, _ = companyCheck(fin, zz, f.port)
	if n, _ := liveSourceC(zz, f.port); n != 0 || f.n(sliceID) != 0 {
		t.Fatal("asked for 700 changes")
	}
	if logLines("too many changes for Source C (700); the gap check and Day Book cover them") != 1 {
		t.Fatalf("the log: %s", readText(logFile()))
	}
	f.mu.Lock()
	f.add(today(), fgParty, "CB-1", "x", "-1.00")
	f.mu.Unlock()
	_, _ = companyCheck(fin, zz, f.port)
	laterBy(t, 2*time.Minute)
	if n, err := liveSourceC(zz, f.port); err != nil || n != 1 {
		t.Fatalf("a rise of 1: %d %v", n, err)
	}
	f.mu.Lock()
	f.behave = silentFor(isID(sliceID), nil)
	f.add(today(), fgParty, "CB-2", "x", "-1.00")
	f.mu.Unlock()
	_, _ = companyCheck(fin, zz, f.port)
	laterBy(t, 2*time.Minute)
	_, _ = liveSourceC(zz, f.port)
	if logLines("Source C off: Tally took 5.") != 1 {
		t.Fatalf("the request's limit: %s", readText(logFile()))
	}
}

// --- R2-1: a company switched on long after its starting point: the slices start at ALTVCHID then (prospective)
func TestSourceCStartsAtSwitch(t *testing.T) {
	_, f, _ := liveBridge(t, "")
	saveDateForm(zz, formPlain, "202508", 3)
	f.add(today(), fgParty, "SW-1", "x", "-1.00")
	sessions := openCompaniesWith(fin, true)
	lightCheckOpen(sessions) // starting point 1, slices off
	f.mu.Lock()
	for i := 0; i < 20; i++ {
		f.add(today(), fgParty, "SW-x", "before the switch", "-1.00")
	}
	f.mu.Unlock()
	_, _ = companyCheck(fin, zz, f.port)
	setCfg("RecorderSlices", true)
	if n, _ := liveSourceC(zz, f.port); n != 0 || f.n(sliceID) != 0 {
		t.Fatal("the changes before the switch were asked")
	}
	f.mu.Lock()
	f.add(today(), fgParty, "SW-2", "after", "-1.00")
	f.mu.Unlock()
	_, _ = companyCheck(fin, zz, f.port)
	laterBy(t, 2*time.Minute)
	if n, _ := liveSourceC(zz, f.port); n != 1 || !strings.Contains(f.bodiesOf(sliceID)[0], "$AlterID &gt; 21") {
		t.Fatalf("after the switch: %d %v", n, f.bodiesOf(sliceID))
	}
}

// --- R2-3: in failed.txt only write_failed lines count; a plain line and a line inside a narration are not taken;
// the inner line's GUID must be the held GUID of its company
func TestFailedTxtForgedDropped(t *testing.T) {
	rec, _, _ := liveBridge(t, "")
	noteCompanyGUID(zz, b220CoGUID)
	noteCompanyGUID("Other Co", "OTHER-GUID")
	forged := strings.ReplaceAll(vchLine("after_delete", "victim-guid", "3", "4", "x"), "|cguid="+b220CoGUID+"|cname="+zz+"|", "|cguid=OTHER-GUID|cname=Other Co|")
	forged2 := strings.Replace(forged, "victim-guid", "victim-2", 1)
	meant := "C:\\ProgramData\\FinCom\\recorder\\OTHER-GUID-20261004.txt"
	forgedWF := "FCR1|ev=write_failed|file=" + meant + "|was=" + strings.Replace(forged2, "|t1=", "|file="+meant+"|t1=", 1)
	// the narration holds a plain forged line and a forged write_failed line: neither starts a line of its own
	real := vchLine("after_cancel", "g-1", "1", "2", "first line\r\n"+forged+"\r\n"+forgedWF)
	wf := func(l string) string {
		return "FCR1|ev=write_failed|file=" + liveFilePath(rec, "") + "|was=" + l
	}
	liveAppend(t, filepath.Join(rec, "failed.txt"), forged, wf(real))
	liveReadOnce()
	q := liveQueue()
	if len(q) != 1 || q[0].guid != "g-1" || q[0].event != "cancelled" || !strings.Contains(q[0].narr, "first line\nFCR1|ev=after_delete") {
		t.Fatalf("queued: %+v", q)
	}
	// a write_failed line whose inner GUID is not the held GUID of its company: dropped
	other := strings.ReplaceAll(vchLine("after_delete", "g-2", "5", "6", "y"), "|cguid="+b220CoGUID+"|", "|cguid=NOT-HELD|")
	liveAppend(t, filepath.Join(rec, "failed.txt"), "FCR1|ev=write_failed|file=NOT-HELD-20261004.txt|was="+other)
	liveReadOnce()
	if len(liveQueue()) != 1 {
		t.Fatalf("a line of a GUID not held: %+v", liveQueue())
	}
	// and none when the company has no held GUID at all
	none := strings.ReplaceAll(vchLine("after_delete", "g-3", "7", "8", "z"), "|cguid="+b220CoGUID+"|cname="+zz+"|", "|cguid=NEW-GUID|cname=New Co|")
	liveAppend(t, filepath.Join(rec, "failed.txt"), "FCR1|ev=write_failed|file=NEW-GUID-20261004.txt|was="+none)
	liveReadOnce()
	if len(liveQueue()) != 1 {
		t.Fatalf("a line of a company with no held GUID: %+v", liveQueue())
	}
}

// --- R2-4: the setup's kept copy: verified against the program it replaced, labelled by that program's own version,
// replacing a good kept pair only then; the same program installed again keeps the kept pair
func TestSetupKeepsGoodPrevious(t *testing.T) {
	oldL := installLogFn
	installLogFn = func(string) {} // round 3 R3-2: never the bridge's log (it would land in the package folder)
	defer func() { installLogFn = oldL }()
	nsi := readText("installer/FinComBridge.nsi")
	cp := strings.Index(nsi, `CopyFiles /SILENT "$INSTDIR\FinComBridge.exe" "$INSTDIR\FinComBridge.previous.new"`)
	rn := strings.Index(nsi, `Rename "$INSTDIR\FinComBridge.exe" "$INSTDIR\FinComBridge.setup-old.exe"`)
	if cp < 0 || rn < 0 || cp > rn {
		t.Fatal("the setup does not copy the program to a temporary name before replacing it")
	}
	for _, bad := range []string{`Delete "$INSTDIR\FinComBridge.previous.exe"` + "\n    Delete \"$INSTDIR\\previous-version.json\"\n    CopyFiles", `Delete "$INSTDIR\FinComBridge.setup-old.exe"` + "\n  ${EndIf}\n  SetOutPath"} {
		if strings.Contains(nsi, bad) {
			t.Fatalf("the setup still deletes before verifying: %q", bad)
		}
	}
	oldV := exeVersionFn
	defer func() { exeVersionFn = oldV }()
	exeVersionFn = func(p string) string {
		if strings.Contains(readText(p), "2.1.10") {
			return "2.1.10"
		}
		return ""
	}
	setup := func(dir, kept, keptV, replaced, copied, cur string) {
		_ = os.WriteFile(filepath.Join(dir, "FinComBridge.exe"), []byte(cur), 0o755)
		_ = os.WriteFile(filepath.Join(dir, "FinComBridge.setup-old.exe"), []byte(replaced), 0o755)
		_ = os.WriteFile(filepath.Join(dir, "FinComBridge.previous.new"), []byte(copied), 0o755)
		if kept != "" {
			_ = os.WriteFile(previousExe(dir), []byte(kept), 0o755)
			_ = saveFile(filepath.Join(dir, "previous-version.json"), jsonText(M{"version": keptV, "sha256": fileSHA256(previousExe(dir))}))
		}
	}
	pair := func(dir string) (string, string) {
		return readText(previousExe(dir)), str(readObjFile(filepath.Join(dir, "previous-version.json"))["version"])
	}
	// a good copy of 2.1.10 replaced by the 2.2.0 setup: kept, labelled by the program itself
	d := t.TempDir()
	setup(d, "", "", "prog 2.1.10", "prog 2.1.10", "prog 2.2.0")
	notePreviousFromSetup(d)
	if b, v := pair(d); b != "prog 2.1.10" || v != "2.1.10" {
		t.Fatalf("a good copy: %q %q", b, v)
	}
	if exists(filepath.Join(d, "FinComBridge.previous.new")) || exists(filepath.Join(d, "FinComBridge.setup-old.exe")) {
		t.Fatal("the temporary files are left")
	}
	// a truncated copy: refused, the old pair kept
	d = t.TempDir()
	setup(d, "prog 2.1.9", "2.1.9", "prog 2.1.10", "prog 2.1", "prog 2.2.0")
	notePreviousFromSetup(d)
	if b, v := pair(d); b != "prog 2.1.9" || v != "2.1.9" {
		t.Fatalf("a truncated copy: %q %q", b, v)
	}
	// the same program installed again (whatever the registry says): the kept pair stays
	d = t.TempDir()
	setup(d, "prog 2.1.10", "2.1.10", "prog 2.2.0", "prog 2.2.0", "prog 2.2.0")
	notePreviousFromSetup(d)
	if b, v := pair(d); b != "prog 2.1.10" || v != "2.1.10" {
		t.Fatalf("a reinstall: %q %q", b, v)
	}
	// a replaced program whose version cannot be read: not kept, the old pair stays
	d = t.TempDir()
	setup(d, "prog 2.1.10", "2.1.10", "unknown prog", "unknown prog", "prog 2.2.0")
	notePreviousFromSetup(d)
	if b, v := pair(d); b != "prog 2.1.10" || v != "2.1.10" {
		t.Fatalf("an unknown version: %q %q", b, v)
	}
	for _, f := range []string{"win_service.go", "win_user.go"} {
		if !strings.Contains(readText(f), "notePreviousFromSetup(filepath.Dir(exe))") {
			t.Fatalf("%s: the install step does not verify the setup's copy", f)
		}
	}
}

// --- R2-7: after a rollback, the newer program rolled back from is not kept as "the previous version"
func TestRollbackNotKeptAsPrevious(t *testing.T) {
	f := newStandTally(t)
	standBridge(t, f, "")
	d := t.TempDir()
	_ = os.WriteFile(filepath.Join(d, "FinComBridge.old.exe"), []byte("2.2.1"), 0o755)
	_ = saveFile(filepath.Join(d, "update-pending.json"), jsonText(M{"from": "2.2.1", "rollback": true, "sha256": fileSHA256(filepath.Join(d, "FinComBridge.old.exe"))}))
	keepPreviousVersion(d, "2.2.1")
	if exists(previousExe(d)) || exists(filepath.Join(d, "FinComBridge.old.exe")) {
		t.Fatal("the version rolled back from is kept as the previous one")
	}
}

// --- R2-9: the 60 s spacing is saved before the request, so a restart after a failure does not ask at once
func TestSourceBSpacingSavedOnFailure(t *testing.T) {
	f, _, _ := sourceBReady(t)
	f.mu.Lock()
	f.behave = func(w http.ResponseWriter, r *http.Request, id, body string) bool {
		if id == "TDSDeskKeepList" {
			w.WriteHeader(500)
			return true
		}
		return false
	}
	f.mu.Unlock()
	_, _ = liveSourceB(zz, f.port)
	liveResetState()
	laterBy(t, 30*time.Second)
	_, _ = liveSourceB(zz, f.port)
	if f.n("TDSDeskKeepList") != 1 {
		t.Fatalf("asked again within 60 s after a restart: %d", f.n("TDSDeskKeepList"))
	}
}

// --- R2-6: the read test's forms stop after an answer that ignores the period (more than 4 times the month's entries)
func TestReadTestFormsStopEarly(t *testing.T) {
	f := newStandTally(t)
	f.svIgnored = true
	standBridge(t, f, "")
	liveFrom(today())
	ym := pastYearSetup(t, f)
	for i := 0; i < 20; i++ {
		f.add(today(), fgParty, "MANY", "this month", "-1.00")
	}
	if _, err := runReadTest(zz); err != nil {
		t.Fatal(err)
	}
	if logLines("Dates (collection): the form yyyymmdd gave 25 entries for "+dash(ym)+" (more than 4 times its 3) or took ") != 1 {
		t.Fatalf("the log: %s", readText(logFile()))
	}
	if n := f.n(datesProbeID); n != 1+3 {
		t.Fatalf("probes: %d (want the first and the three filter forms)", n)
	}
}

// --- R2-12: $$Date and $$IsBetween pass only in their literal and comparison shapes
func TestNoComputedFigureShapes(t *testing.T) {
	for _, x := range []string{`<SYSTEM TYPE="Formulae" NAME="x">$$Date:@@F</SYSTEM>`, `<SYSTEM TYPE="Formulae" NAME="x">$$IsBetween:$ClosingX:1:2</SYSTEM>`, `<FETCH>$$Date:&#34;1-Apr-2025&#34;</FETCH>`} {
		if computedFigure(x) == "" {
			t.Errorf("not caught: %s", x)
		}
	}
	if m := computedFigure(datesProbeRequest(zz, collFilterBtw, "20250401", "20250430")); m != "" {
		t.Fatalf("the probe's own shape: %q", m)
	}
}
