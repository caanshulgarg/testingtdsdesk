package main

// Review of bridge 2.3.0 (97764f7), M3: a service-installed bridge (SYSTEM, working for a Windows user) and a "Just for
// me" bridge of the same Windows user read one settings file and one sync folder. The per-user one saw the service's
// listener as another user's, took the next port and wrote it into the shared settings: two processes with the same
// bridge id and folders. Now:
//   - one bridge per settings: the lock file bridge.lock in the sync folder, held open for as long as the bridge runs
//     (Windows: opened with no sharing at all, so a second open fails while the first process lives and the lock goes
//     with it when it ends; elsewhere: flock). A second process with the same settings refuses to start: one message in
//     its log and in the message the tray shows (bridge-start-failed.txt), exit code exitTwice, which neither the
//     per-user supervisor nor the service starts again;
//   - the "Just for me" setup refuses when the Windows service's record (HKLM, OwnerSid) names the same Windows user
//     (win_user.go). Refusing is the safer choice: the per-user setup runs without an administrator's rights, so it could
//     not stop the service anyway, and refusing changes nothing that already runs.

import (
	"fmt"
	"path/filepath"
	"strings"
)

// the bridge stopped because another bridge already runs with the same settings: not started again
const exitTwice = 5

func instanceLockPath() string { return filepath.Join(syncDir(), "bridge.lock") }

// the lock of this settings' sync folder: release lets go (the process ending lets go too); an error: another process
// holds it (or it cannot be opened), in plain words
func takeInstanceLock() (func(), error) {
	p := instanceLockPath()
	rel, err := platLockExclusive(p)
	if err != nil {
		return nil, fmt.Errorf("Another FinCom Bridge already runs with these settings (%s; its lock %s is held: %s), most likely the Windows service working for this same Windows user. This one does not start; use the one that runs, or uninstall one of them",
			ConfigPath, p, err.Error())
	}
	return rel, nil
}

// the "Just for me" setup beside the service: refused when the service works for the same Windows user (its SID); ""
// when it may go on
func perUserBlockedByService(serviceSid, mySid string) string {
	if strings.TrimSpace(serviceSid) == "" || !strings.EqualFold(strings.TrimSpace(serviceSid), strings.TrimSpace(mySid)) {
		return ""
	}
	return "FinCom Bridge is already installed for all users as a Windows service working for this same Windows user; a second bridge \"Just for me\" would share its settings and folders, so it is not installed."
}
