//go:build windows

package main

// Round 19 on real Windows (the workflow's "Go tests on Windows" job runs -run 'Windows|Shared'):
//   - readShared opens a recorder holding file sharing read, write and delete: Tally's add-on, opening it to append with
//     share mode FILE_SHARE_READ, gets in while the bridge reads;
//   - a holding file another program holds with share mode 0: readShared fails at once (well under 100 ms), never
//     waits or tries again, and logs "recorder file busy, read later";
//   - the recorder trial's lock (lockExclusive) holds the file with share mode 0 for its time, then lets go;
//   - the install step refuses a junction made at FinCom\recorder before the setup ran: moved aside, the junction's
//     target's permissions unchanged.

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"golang.org/x/sys/windows"
)

func r19WinOpen(t *testing.T, p string, access, share uint32) (windows.Handle, error) {
	t.Helper()
	u, _ := windows.UTF16PtrFromString(p)
	return windows.CreateFile(u, access, share, nil, windows.OPEN_EXISTING, windows.FILE_ATTRIBUTE_NORMAL, 0)
}

func TestSharedReadWindowsWriterGetsIn(t *testing.T) {
	f := newStandTally(t)
	standBridge(t, f, "")
	p := filepath.Join(t.TempDir(), "co-guid-1.txt")
	_ = os.WriteFile(p, []byte(r18Line1+"\r\n"), 0o644)
	var werr error
	readSharedHold = func(string) {
		h, err := r19WinOpen(t, p, windows.GENERIC_WRITE, windows.FILE_SHARE_READ)
		werr = err
		if err == nil {
			_, _ = windows.Seek(h, 0, 2)
			var n uint32
			_ = windows.WriteFile(h, []byte("appended\r\n"), &n, nil)
			windows.CloseHandle(h)
		}
	}
	t.Cleanup(func() { readSharedHold = nil })
	if _, err := readShared(p, 1<<20); err != nil {
		t.Fatal(err)
	}
	if werr != nil {
		t.Fatalf("the add-on could not open the file to append while the bridge read it: %v", werr)
	}
	if !strings.Contains(readText(p), "appended") {
		t.Fatal("the append did not land")
	}
	// renamed and deleted by the add-on while open: FILE_SHARE_DELETE
	readSharedHold = func(string) { werr = os.Rename(p, p+".old") }
	if _, err := readShared(p, 1<<20); err != nil || werr != nil {
		t.Fatalf("rename while the bridge read: %v / %v", err, werr)
	}
}

func TestSharedReadWindowsLockedFails(t *testing.T) {
	f := newStandTally(t)
	standBridge(t, f, "")
	p := filepath.Join(t.TempDir(), "co-guid-1.txt")
	_ = os.WriteFile(p, []byte(r18Line1+"\r\n"), 0o644)
	h, err := r19WinOpen(t, p, windows.GENERIC_READ|windows.GENERIC_WRITE, 0)
	if err != nil {
		t.Fatal(err)
	}
	defer windows.CloseHandle(h)
	t0 := time.Now()
	_, err = readShared(p, 1<<20)
	if el := time.Since(t0); err == nil || el > 100*time.Millisecond {
		t.Fatalf("a locked file: %v after %s (want an error within 100 ms)", err, el)
	}
	if logLines("recorder file busy, read later") != 1 {
		t.Fatal("the log does not say the file was busy")
	}
}

func TestSharedLockWindowsHoldsAndReleases(t *testing.T) {
	p := filepath.Join(t.TempDir(), "co-guid-1.txt")
	_ = os.WriteFile(p, []byte("x"), 0o644)
	done := make(chan error, 1)
	held := make(chan struct{})
	go func() { done <- lockExclusive(p, 400*time.Millisecond, func() { close(held) }) }()
	<-held
	if h, err := r19WinOpen(t, p, windows.GENERIC_READ, windows.FILE_SHARE_READ|windows.FILE_SHARE_WRITE|windows.FILE_SHARE_DELETE); err == nil {
		windows.CloseHandle(h)
		t.Fatal("the file could be opened while the trial's lock held it")
	}
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	h, err := r19WinOpen(t, p, windows.GENERIC_WRITE, windows.FILE_SHARE_READ)
	if err != nil {
		t.Fatalf("still locked after the lock's time: %v", err)
	}
	windows.CloseHandle(h)
}

func TestRecorderFolderJunctionRefusedWindows(t *testing.T) {
	base := t.TempDir()
	target := t.TempDir()
	fc := filepath.Join(base, "FinCom")
	if err := os.Mkdir(fc, 0o755); err != nil {
		t.Fatal(err)
	}
	if out, err := exec.Command("cmd", "/c", "mklink", "/J", filepath.Join(fc, "recorder"), target).CombinedOutput(); err != nil {
		t.Fatalf("mklink /J: %v %s", err, out)
	}
	acl := func(p string) string {
		out, _ := exec.Command("icacls", p).CombinedOutput()
		return strings.ReplaceAll(string(out), p, "")
	}
	before := acl(target)
	lines, err := prepareFinComFolders(base, true)
	if err != nil {
		t.Fatalf("%v\n%s", err, strings.Join(lines, "\n"))
	}
	if after := acl(target); after != before {
		t.Fatalf("the junction's target's permissions changed:\n%s\n->\n%s", before, after)
	}
	rec := filepath.Join(fc, "recorder")
	fi, err := os.Lstat(rec)
	if err != nil || !fi.IsDir() || isReparse(rec, fi) {
		t.Fatalf("recorder is not a plain folder now: %v %v", fi, err)
	}
	if !strings.Contains(strings.Join(lines, "\n"), "moved aside") {
		t.Fatalf("the junction was not moved aside:\n%s", strings.Join(lines, "\n"))
	}
	if es, _ := os.ReadDir(target); len(es) != 0 {
		t.Fatalf("something was made in the junction's target: %v", es)
	}
	ra := acl(rec)
	if strings.Contains(ra, "(OI)(CI)(M)") || !strings.Contains(ra, "(OI)(IO)(M)") {
		t.Fatalf("the recorder folder's permissions:\n%s", ra)
	}
}
