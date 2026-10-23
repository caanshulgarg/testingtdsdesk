package main

// The owner's rule of 05-Oct-2026: new bridge versions go to every computer by themselves, no pilot and no approval.
// FinCom's heartbeat answer says release: {newest: true, allowed: true, held: [versions]}: the newest version on FinCom's
// signed list (latest.json) installs on every bridge, owner's or staff's, unless the firm's owner HELD that version (or
// withdrew it). The owner's "Roll back to <version>": release: {version, allowed: true, rollback: true}: no newer version
// installs, and a bridge that keeps exactly that version as its previous one puts it back (as the tray's "Roll back to
// the previous version" does, the owner's choice: automatic updates stay on, so clearing the rollback lets the bridge
// update again); a bridge that keeps another version stays as it is and says so once. Signature and SHA-256 still
// checked; an older answer {version, allowed} works as before.

import (
	"crypto/sha256"
	"encoding/hex"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestNewestVersionGoesToEveryBridge(t *testing.T) {
	u := newUpdServer(t, "9.9.9", "")
	c := releaseBridge(t, u)
	beatWith(c, M{"release": M{"newest": true, "allowed": true, "held": []any{}}})
	r := checkForUpdate(false)
	if u.nApplied() != 1 || !truthy(r["applying"]) {
		t.Fatalf("the newest version did not install by itself: %v", r)
	}
}

func TestHeldVersionIsNotInstalled(t *testing.T) {
	u := newUpdServer(t, "9.9.9", "")
	c := releaseBridge(t, u)
	beatWith(c, M{"release": M{"newest": true, "allowed": true, "held": []any{"9.9.9"}}})
	r := checkForUpdate(false)
	if u.nApplied() != 0 || u.exeGets.Load() != 0 || !strings.Contains(str(r["message"]), "held") {
		t.Fatalf("a held version was downloaded or put in place: %v", r)
	}
	// the owner lets it go again
	beatWith(c, M{"release": M{"newest": true, "allowed": true, "held": []any{"9.9.8"}}})
	checkForUpdate(false)
	if u.nApplied() != 1 {
		t.Fatal("not installed once it is no longer held")
	}
}

func TestStillChecksSHAForTheNewest(t *testing.T) {
	u := newUpdServer(t, "9.9.9", strings.Repeat("0", 64))
	c := releaseBridge(t, u)
	beatWith(c, M{"release": M{"newest": true, "allowed": true}})
	r := checkForUpdate(false)
	if u.nApplied() != 0 || !strings.Contains(str(r["message"]), "SHA-256") {
		t.Fatalf("a download not matching its SHA-256 was put in place: %v", r)
	}
}

// a bridge program as an update leaves it: the running one, and the one it replaced kept for a rollback
func keptPrevious(t *testing.T, prevVersion string) (dir, exe string) {
	dir = t.TempDir()
	exe = filepath.Join(dir, "FinComBridge.exe")
	_ = os.WriteFile(exe, []byte("running "+BridgeVersion), 0o755)
	old := []byte("old " + prevVersion)
	h := sha256.Sum256(old)
	_ = os.WriteFile(previousExe(dir), old, 0o755)
	_ = saveFile(filepath.Join(dir, "previous-version.json"), jsonText(M{"version": prevVersion, "sha256": hex.EncodeToString(h[:])}))
	oldExe, oldRestart := exePathFn, rollbackRestart
	exePathFn, rollbackRestart = func() string { return exe }, func() {}
	t.Cleanup(func() { exePathFn, rollbackRestart = oldExe, oldRestart })
	return dir, exe
}

func TestOwnerRollbackPutsBackTheKeptVersion(t *testing.T) {
	u := newUpdServer(t, "9.9.9", "")
	c := releaseBridge(t, u)
	dir, exe := keptPrevious(t, "1.0.0")
	beatWith(c, M{"release": M{"version": "1.0.0", "allowed": true, "rollback": true}})
	if b, _ := os.ReadFile(exe); string(b) != "old 1.0.0" {
		t.Fatalf("the owner's rollback did not put back 1.0.0: %q", b)
	}
	if str(readObjFile(filepath.Join(dir, "update-undone.json"))["by"]) != "owner" {
		t.Fatalf("who rolled it back: %v", readObjFile(filepath.Join(dir, "update-undone.json")))
	}
	if cfgB("NoAutoUpdate") {
		t.Fatal("the owner's rollback must leave automatic updates on (clearing it lets the bridge update again)")
	}
	if logLines("Rolled back from "+BridgeVersion+" to 1.0.0 by the firm's owner") != 1 {
		t.Fatal("the log does not say the owner rolled it back")
	}
	// while the rollback stands, no newer version installs
	checkForUpdate(false)
	if u.nApplied() != 0 {
		t.Fatal("a newer version installed during the owner's rollback")
	}
}

func TestOwnerRollbackToAnotherVersionChangesNothing(t *testing.T) {
	u := newUpdServer(t, "9.9.9", "")
	c := releaseBridge(t, u)
	_, exe := keptPrevious(t, "1.0.0")
	for i := 0; i < 3; i++ {
		beatWith(c, M{"release": M{"version": "0.9.0", "allowed": true, "rollback": true}})
	}
	if b, _ := os.ReadFile(exe); string(b) != "running "+BridgeVersion {
		t.Fatalf("changed although it keeps another version: %q", b)
	}
	if n := logLines("The firm's owner rolled FinCom Bridge back to 0.9.0"); n != 1 {
		t.Fatalf("said once, not every beat: %d", n)
	}
	checkForUpdate(false)
	if u.nApplied() != 0 {
		t.Fatal("a newer version installed during the owner's rollback")
	}
}
