// 2.3.0 (part 3): on a shared server each bridge talks only to the Tally in its own Windows session (OnlyMySession,
// isMine): another user's Tally is never asked, neither found by itself nor named by FinCom (a port hint) nor set by hand
// in the settings (TallyPorts); and the heartbeat says which Tally (port, data folder) and which Windows user it is.
package main

import (
	"fmt"
	"os"
	"path/filepath"
	"testing"
)

// two Tallys on the server: anshul's (session 1, this bridge's) and ravi's (session 2)
func twoUsersServer(t *testing.T) (mine, theirs *standTally) {
	mine, theirs = newStandTally(t), newStandTally(t)
	standBridge(t, mine, "")
	dir := t.TempDir()
	_ = os.MkdirAll(filepath.Join(dir, "anshul"), 0o755)
	_ = os.WriteFile(filepath.Join(dir, "anshul", "tally.ini"), []byte("[Tally]\r\nClient Server = Both\r\nServer Port = 9000\r\nData = D:\\TallyData\\Anshul\r\n"), 0o644)
	fake := filepath.Join(dir, "fake.json")
	_ = os.WriteFile(fake, []byte(fmt.Sprintf(`{"mySession": 1, "users": {"1": "anshul", "2": "ravi"},
		"processes": [{"pid": 10, "name": "tally", "session": 1, "path": %q}, {"pid": 20, "name": "tally", "session": 2, "path": "C:\\Tally\\tally.exe"}],
		"listeners": [{"port": %d, "pid": 10}, {"port": %d, "pid": 20}]}`, filepath.ToSlash(filepath.Join(dir, "anshul", "tally.exe")), mine.port, theirs.port)), 0o644)
	t.Setenv("TDSBRIDGE_FAKE", fake)
	setCfg("TallyPorts", "auto")
	setCfg("OnlyMySession", true)
	coMu.Lock()
	coCache = nil
	coMu.Unlock()
	_ = os.Remove(filepath.Join(syncDir(), "open-companies.json"))
	return mine, theirs
}

func TestOnlyMySessionTally(t *testing.T) {
	mine, theirs := twoUsersServer(t)
	ss := openCompanies(true)
	var sawMine, skippedTheirs bool
	for _, s := range ss {
		switch toInt(s["port"]) {
		case mine.port:
			sawMine = s["ok"] == true && s["skipped"] != true
		case theirs.port:
			skippedTheirs = s["skipped"] == true && str(s["error"]) == "Tally of ravi"
		}
	}
	if !sawMine || !skippedTheirs {
		t.Fatalf("sessions: %v", jsonText(ss))
	}
	// FinCom names ravi's port as the hint: the company is still found in anshul's Tally only
	port, _, err := findCompanyNow("ZZ TEST", theirs.port)
	if err != nil || port != mine.port {
		t.Fatalf("hint of another user's Tally: port %d %v", port, err)
	}
	if n := len(theirs.ids()); n != 0 {
		t.Fatalf("another user's Tally was asked %d time(s): %v", n, theirs.ids())
	}
}

// a port set by hand in the settings that is another user's Tally (found listening in another session) is not used
func TestOnlyMySessionConfiguredPort(t *testing.T) {
	mine, theirs := twoUsersServer(t)
	setCfg("TallyPorts", []any{float64(theirs.port), float64(mine.port)})
	for _, s := range openCompanies(true) {
		if toInt(s["port"]) == theirs.port && s["skipped"] != true {
			t.Fatalf("another user's Tally, set by hand, was not skipped: %v", s)
		}
	}
	if _, _, err := findCompanyNow("ZZ TEST", theirs.port); err != nil {
		t.Fatal(err)
	}
	if n := len(theirs.ids()); n != 0 {
		t.Fatalf("another user's Tally (set by hand) was asked %d time(s): %v", n, theirs.ids())
	}
	// switched off by hand (OnlyMySession false): as before, every Tally is used
	setCfg("OnlyMySession", false)
	openCompanies(true)
	if len(theirs.ids()) == 0 {
		t.Fatal("OnlyMySession off: every Tally is asked, as before")
	}
}

// the heartbeat: the Windows user, the bridge's own port, its Tally's port and data folder
func TestBeatSaysTallyAndUser(t *testing.T) {
	mine, _ := twoUsersServer(t)
	setCfg("Port", float64(9102))
	ss := openCompanies(true)
	open, ports, tally, cos := beatParts(ss)
	b := beatBody(tally, "open", "", open, ports, cos)
	if str(b["windowsUser"]) != ownerName() || toInt(b["bridgePort"]) != 9102 || toInt(b["tallyPort"]) != mine.port || str(b["dataFolder"]) != `D:\TallyData\Anshul` {
		t.Fatalf("beat: windowsUser %v bridgePort %v tallyPort %v dataFolder %v", b["windowsUser"], b["bridgePort"], b["tallyPort"], b["dataFolder"])
	}
	if id := bridgeIdentity(); str(id["user"]) != ownerName() || toInt(id["port"]) != 9102 {
		t.Fatalf("identity: %v", id)
	}
}
