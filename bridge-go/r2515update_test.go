package main

// bridge 2.5.15, item 5 (the owner's approval of 13-Nov-2026): a computer never stays on an old bridge silently. The
// download is tried a second way when the first fails or does not match; a download or a putting in place that fails
// keeps the running program, is looked for again a little later, and FinCom is told (the beat's update.failed: the
// version, the step, why, how many looks). The SHA-256 and signature checks are as before. Made-up versions only.
import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func r2515UpdBridge(t *testing.T) (*updServer, *standCloud) {
	t.Helper()
	u := newUpdServer(t, "9.9.9", "")
	c := releaseBridge(t, u)
	beatWith(c, M{"release": M{"version": "9.9.9", "allowed": true}})
	oldP, oldF, oldW := updAltPauseFn, fetchFn, updRetryWaits
	updAltPauseFn, updRetryWaits = func() {}, []time.Duration{10 * time.Millisecond, 10 * time.Millisecond}
	t.Cleanup(func() { updAltPauseFn, fetchFn, updRetryWaits = oldP, oldF, oldW; updFailClear() })
	updFailClear()
	return u, c
}

// the first download cut off: the second way brings it, it is put in place, nothing is said as failed
func TestR2515UpdateDownloadSecondWay(t *testing.T) {
	u, _ := r2515UpdBridge(t)
	fetchFn = func(url string, max int64) ([]byte, error) {
		if strings.HasSuffix(url, ".exe") {
			return nil, errors.New("connection reset (stand)")
		}
		return fetch(url, max)
	}
	r := checkForUpdate(false)
	if u.nApplied() != 1 || r["applying"] != true || updateBeat()["failed"] != nil {
		t.Fatalf("the second way did not bring the update: %v, failed %v", r, updateBeat()["failed"])
	}
	if logLines("Update: downloaded the second way") != 1 {
		t.Fatal("the log does not say the second way was used")
	}
}

// both ways fail: the running program kept, FinCom told the version, the step and why, the looks counted
func TestR2515UpdateDownloadFailsTold(t *testing.T) {
	u, c := r2515UpdBridge(t)
	fetchFn = func(url string, max int64) ([]byte, error) {
		if strings.HasSuffix(url, ".exe") {
			return nil, errors.New("connection reset (stand)")
		}
		return fetch(url, max)
	}
	oldAlt := fetchAltFn
	fetchAltFn = func(url string, max int64) ([]byte, error) { return nil, errors.New("HTTP 502") }
	t.Cleanup(func() { fetchAltFn = oldAlt })
	for i := 1; i <= 2; i++ {
		r := checkForUpdate(false)
		f := updFailNow()
		if u.nApplied() != 0 || r["applying"] == true || f == nil || str(f["version"]) != "9.9.9" || str(f["step"]) != "download" || toInt(f["tries"]) != i ||
			str(f["from"]) != BridgeVersion || !strings.Contains(str(f["words"]), "HTTP 502") {
			t.Fatalf("look %d: %v, failed %v", i, r, f)
		}
	}
	beatOnce()
	c.mu.Lock()
	ub := obj(c.lastBeat["update"])
	c.mu.Unlock()
	if f := obj(ub["failed"]); str(f["version"]) != "9.9.9" || str(f["step"]) != "download" || toInt(f["tries"]) != 2 {
		t.Fatalf("the beat does not tell FinCom: %v", ub)
	}
	if !updFailRetryable() || updFailRetryable() {
		t.Fatal("a failed download is to be looked for again once, a little later")
	}
}

// putting it in place fails: the running program kept; looked for again a little later; the next look puts it in place
// and the failure is no longer said
func TestR2515UpdateApplyFailsRetried(t *testing.T) {
	u, _ := r2515UpdBridge(t)
	var n atomic.Int32
	old := applyUpdateFn
	applyUpdateFn = func(exe string, b []byte) error {
		if n.Add(1) == 1 {
			return errors.New("the program file is held by another program (stand)")
		}
		return old(exe, b)
	}
	updateLookWithRetries()
	if n.Load() != 2 || u.nApplied() != 1 || updateInfo()["applying"] != true || updFailNow() != nil {
		t.Fatalf("tried %d times, applied %d, applying %v, failed %v", n.Load(), u.nApplied(), updateInfo()["applying"], updFailNow())
	}
	if logLines("could not be put in place: the program file is held by another program (stand); "+BridgeVersion+" keeps running") != 1 {
		t.Fatal("the log does not say the running version is kept")
	}
	updMu.Lock()
	updLast["applying"] = false
	updMu.Unlock()
	updChecking.Store(false)
}

// a list that does not match what comes: tried the second way too, then said (SHA-256), never put in place
func TestR2515UpdateWrongDownloadNeverUsed(t *testing.T) {
	u := newUpdServer(t, "9.9.9", strings.Repeat("0", 64))
	c := releaseBridge(t, u)
	beatWith(c, M{"release": M{"version": "9.9.9", "allowed": true}})
	oldP := updAltPauseFn
	updAltPauseFn = func() {}
	t.Cleanup(func() { updAltPauseFn = oldP; updFailClear() })
	r := checkForUpdate(false)
	if u.nApplied() != 0 || u.exeGets.Load() != 2 || !strings.Contains(str(r["message"]), "SHA-256") || str(updFailNow()["step"]) != "sha" {
		t.Fatalf("%v: %d downloads, failed %v", r, u.exeGets.Load(), updFailNow())
	}
}

// the replace itself: the new program in place, the running one kept aside; a rename refused: the running one put back
func TestR2515ReplaceProgram(t *testing.T) {
	dir := t.TempDir()
	exe := filepath.Join(dir, "FinComBridge.exe")
	_ = os.WriteFile(exe, []byte("MZ running"), 0o755)
	if err := replaceProgram(exe, []byte("MZ new")); err != nil || readText(exe) != "MZ new" || readText(filepath.Join(dir, "FinComBridge.old.exe")) != "MZ running" ||
		!exists(filepath.Join(dir, "update-pending.json")) {
		t.Fatalf("the replace: %v %q", err, readText(exe))
	}
	_ = os.WriteFile(exe, []byte("MZ running"), 0o755)
	_ = os.Remove(filepath.Join(dir, "update-pending.json"))
	old := updRenameFn
	t.Cleanup(func() { updRenameFn = old })
	updRenameFn = func(a, b string) error {
		if filepath.Base(a) == "FinComBridge.new.exe" && b == exe {
			return &os.LinkError{Op: "rename", Old: a, New: b, Err: os.ErrPermission}
		}
		return old(a, b)
	}
	if err := replaceProgram(exe, []byte("MZ new")); err == nil || readText(exe) != "MZ running" || exists(filepath.Join(dir, "update-pending.json")) || exists(filepath.Join(dir, "FinComBridge.new.exe")) {
		t.Fatalf("a refused rename: %v, program %q", err, readText(exe))
	}
	// putting the running one back by a rename refused too: its bytes copied back
	updRenameFn = func(a, b string) error {
		if b == exe && !strings.HasSuffix(a, ".tmp") {
			return &os.LinkError{Op: "rename", Old: a, New: b, Err: os.ErrPermission}
		}
		return old(a, b)
	}
	if err := replaceProgram(exe, []byte("MZ new")); err == nil || readText(exe) != "MZ running" {
		t.Fatalf("not put back: %v, program %q", err, readText(exe))
	}
}
