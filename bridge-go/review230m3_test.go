package main

// Review of bridge 2.3.0 (97764f7), M3: a service-installed bridge (SYSTEM, working for a Windows user) and a "Just for me"
// bridge of the SAME Windows user share one settings file and sync folder. The per-user one saw the SYSTEM listener as
// foreign, took the next port and wrote Port into the shared settings: two processes with the same id and folders. Now:
//   - one bridge per settings: a lock file in the sync folder (bridge.lock), held open (exclusively on Windows: no sharing;
//     flock elsewhere) for as long as the bridge runs; a second process with the same settings refuses to start, says so
//     in its log and in the message the tray shows, and is not started again by its supervisor;
//   - the "Just for me" setup refuses when the service's record (HKLM) names the same Windows user (OwnerSid): it has no
//     administrator's rights to stop the service, and refusing changes nothing that runs (the safer of the two).

import (
	"os"
	"strings"
	"testing"
)

func TestM3InstanceLockSecondRefuses(t *testing.T) {
	standBridge(t, newStandTally(t), "")
	rel, err := takeInstanceLock()
	if err != nil {
		t.Fatalf("the first bridge takes the lock: %v", err)
	}
	if _, err := takeInstanceLock(); err == nil {
		t.Fatal("a second bridge on the same settings took the lock")
	}
	// the second process's start: refused, said, not started again
	code := runBridge(false)
	if code != exitTwice || restartAfter(code) {
		t.Fatalf("exit code %d (want %d, not restarted)", code, exitTwice)
	}
	if logLines("Another FinCom Bridge already runs with these settings") != 1 {
		t.Fatalf("said in the log:\n%s", readText(logFile()))
	}
	if !strings.Contains(startFailedText(), "Another FinCom Bridge already runs with these settings") {
		t.Fatalf("the tray's message: %q", startFailedText())
	}
	rel()
	rel2, err := takeInstanceLock()
	if err != nil {
		t.Fatalf("taken again once the first let go: %v", err)
	}
	rel2()
	_ = os.Remove(startFailedFile())
}

func TestM3PerUserInstallRefusedBesideServiceOfSameUser(t *testing.T) {
	sid := "S-1-5-21-1-2-3-1001"
	if why := perUserBlockedByService(sid, sid); !strings.Contains(why, "Windows service") {
		t.Fatalf("the same user's service: %q", why)
	}
	if why := perUserBlockedByService(strings.ToLower(sid), sid); why == "" {
		t.Fatal("SIDs compared without case")
	}
	if why := perUserBlockedByService("S-1-5-21-1-2-3-1002", sid); why != "" {
		t.Fatalf("another user's service: %q", why)
	}
	if why := perUserBlockedByService("", sid); why != "" {
		t.Fatalf("no service: %q", why)
	}
}
