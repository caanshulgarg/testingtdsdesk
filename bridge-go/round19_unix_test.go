//go:build !windows

package main

// Round 19, the owner's question B: "Recorder trial: lock the holding file for 30 s" (on Windows share mode 0; here an
// exclusive flock stands in for it): the company's holding file, found by the GUID the bridge holds for it; held for its
// time, then let go; a company with no GUID held refused; a web page refused. Round 21 (2.1.10): any company (ZZ TEST
// here is just the company open)

import (
	"os"
	"path/filepath"
	"syscall"
	"testing"
	"time"
)

func r19Locked(t *testing.T, p string) bool {
	t.Helper()
	f, err := os.Open(p)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	if err := syscall.Flock(int(f.Fd()), syscall.LOCK_EX|syscall.LOCK_NB); err != nil {
		return true
	}
	_ = syscall.Flock(int(f.Fd()), syscall.LOCK_UN)
	return false
}

func TestRecorderLockHoldingFile(t *testing.T) {
	rec, _ := r18RecorderDirs(t)
	f := newStandTally(t)
	standBridge(t, f, `,"Key":"tray-test-key"`)
	trialOn(t) // round 21 (2.1.10): the owner's trial tools switched on for this computer in FinCom
	old := recorderLockFor
	recorderLockFor = 400 * time.Millisecond
	t.Cleanup(func() { recorderLockFor = old })
	if code, _ := callLocal(t, "POST", "/tray/recorder-lock", "https://app.fincom.live", "{}"); code != 403 {
		t.Fatalf("from a web page: %d", code)
	}
	if _, err := recorderLockHolding("OTHER CO"); err == nil {
		t.Fatal("another company's file was locked")
	}
	// no GUID held for ZZ TEST yet: refused
	if _, err := recorderLockHolding(zz); err == nil {
		t.Fatal("locked with no GUID held for ZZ TEST")
	}
	_ = findCompanyPortQuiet(zz) // the GUID co-guid-1 held
	if heldGUID(zz) != "co-guid-1" {
		t.Fatalf("held GUID %q", heldGUID(zz))
	}
	p := filepath.Join(rec, "co-guid-1.txt")
	_ = os.WriteFile(p, []byte(r18Line1+"\r\n"), 0o644)
	code, res := callLocal(t, "POST", "/tray/recorder-lock", "", "{}")
	if code != 200 || res["ok"] != true || str(res["file"]) != p {
		t.Fatalf("lock: %d %v", code, res)
	}
	if !r19Locked(t, p) {
		t.Fatal("the file is not held")
	}
	if logLines("Recorder trial: the holding file "+p+" is locked") != 1 {
		t.Fatal("the start is not in the log")
	}
	time.Sleep(700 * time.Millisecond)
	if r19Locked(t, p) {
		t.Fatal("still held after its time")
	}
	if logLines("Recorder trial: the holding file "+p+" is released") != 1 {
		t.Fatal("the end is not in the log")
	}
	// a link at the holding file's name: refused
	_ = os.Remove(p)
	_ = os.Symlink(filepath.Join(t.TempDir(), "x"), p)
	if _, err := recorderLockHolding(zz); err == nil {
		t.Fatal("a link was locked")
	}
}
