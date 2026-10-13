//go:build !windows

package main

// Round 20, Low 4 (RL2): the trial's lock checks the file it holds: a holding file with a second name (a hard link to
// another file) is not locked (here an flock stands in for Windows' share mode 0)

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestRecorderLockRefusesHardLink(t *testing.T) {
	rec, _ := r18RecorderDirs(t)
	f := newStandTally(t)
	standBridge(t, f, `,"Key":"tray-test-key"`)
	old := recorderLockFor
	recorderLockFor = 300 * time.Millisecond
	t.Cleanup(func() { recorderLockFor = old })
	_ = findCompanyPortQuiet(zz)
	other := filepath.Join(t.TempDir(), "another-users-file.txt")
	_ = os.WriteFile(other, []byte("x"), 0o644)
	p := filepath.Join(rec, "co-guid-1.txt")
	if err := os.Link(other, p); err != nil {
		t.Skip("no hard links here: " + err.Error())
	}
	if _, err := recorderLockHolding(zz); err == nil {
		t.Fatal("a holding file with a second name was locked")
	}
	if r19Locked(t, other) {
		t.Fatal("the other file is held")
	}
	if err := lockExclusive(other, 50*time.Millisecond, nil); err == nil {
		t.Fatal("lockExclusive held a file with two names")
	}
}
