//go:build windows

package main

// Round 20 on real Windows (the workflow's go-tests-windows job runs -run 'Windows|Shared'):
//   - Medium 1: a junction at FinCom (to another user's folder holding recorder\<file>.txt): nothing is read, watched,
//     looked at or locked; a plain FinCom in the same place (a short temp path included) is read: the final-path check
//     does not refuse a good folder;
//   - Low 4: the trial's lock refuses a holding file with a second name (a hard link).

import (
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"
)

func TestRecorderReadRefusedWhenParentIsJunctionWindows(t *testing.T) {
	pd := t.TempDir()
	other := t.TempDir()
	_ = os.MkdirAll(filepath.Join(other, "recorder"), 0o755)
	_ = os.WriteFile(filepath.Join(other, "recorder", "co-guid-1.txt"), []byte(r18Line1+"\r\n"), 0o644)
	fc := filepath.Join(pd, "FinCom")
	if out, err := exec.Command("cmd", "/c", "mklink", "/J", fc, other).CombinedOutput(); err != nil {
		t.Fatalf("mklink /J: %v %s", err, out)
	}
	rec := r20RecorderAt(t, pd)
	if fs := recorderFiles(); len(fs) != 0 {
		t.Fatalf("recorder files listed through a junction at FinCom: %v", fs)
	}
	if seen, at := recorderHolding("ZZ TEST", "co-guid-1"); seen || at != "" {
		t.Fatalf("recorderHolding looked through a junction: %v %q", seen, at)
	}
	if _, ok := recorderDirChecked(); ok {
		t.Fatal("the recorder folder passed the check through a junction")
	}
	if logLines("Recorder trial: the recorder folder "+rec+" is not read") == 0 {
		t.Fatal("the log does not say why")
	}
	// a plain FinCom: read (the final path equals the expected one)
	if err := os.Remove(fc); err != nil {
		t.Fatal(err)
	}
	_ = os.MkdirAll(rec, 0o755)
	_ = os.WriteFile(filepath.Join(rec, "co-guid-1.txt"), []byte(r18Line1+"\r\n"), 0o644)
	if fs := recorderFiles(); len(fs) != 1 {
		fp, err := finalPathFn(rec)
		t.Fatalf("a plain recorder folder is refused: %v (final path %q %v)", fs, fp, err)
	}
	// a junction at recorder inside a plain FinCom: refused
	_ = os.RemoveAll(rec)
	if out, err := exec.Command("cmd", "/c", "mklink", "/J", rec, filepath.Join(other, "recorder")).CombinedOutput(); err != nil {
		t.Fatalf("mklink /J: %v %s", err, out)
	}
	if fs := recorderFiles(); len(fs) != 0 {
		t.Fatalf("recorder a junction: %v", fs)
	}
}

func TestSharedLockWindowsRefusesHardLink(t *testing.T) {
	d := t.TempDir()
	other := filepath.Join(d, "other.txt")
	_ = os.WriteFile(other, []byte("x"), 0o644)
	p := filepath.Join(d, "co-guid-1.txt")
	if err := os.Link(other, p); err != nil {
		t.Skip("no hard links here: " + err.Error())
	}
	if err := lockExclusive(p, 50*time.Millisecond, nil); err == nil {
		t.Fatal("a file with two names was locked")
	}
	// a plain file: locked
	_ = os.Remove(p)
	_ = os.WriteFile(p, []byte("x"), 0o644)
	if err := lockExclusive(p, 50*time.Millisecond, nil); err != nil {
		t.Fatal(err)
	}
}
