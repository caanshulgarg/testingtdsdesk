package main

// FinCom Bridge 2.5.16, port items (portwatch2516.go): this login's Tally port watched in Windows' list every 3 s, a beat
// at once when it moves (at most one every 10 s); "Tally port not saved" when this login's Tally listens on a port its
// tally.ini does not name. Windows' lists come from the tests' file (TDSBRIDGE_FAKE); nothing is sent to Tally and no
// tally.ini is written. Windows-only: the real process and port lists.

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func r2516PortFake(t *testing.T, path string, ports ...int) {
	t.Helper()
	var ls []string
	for _, p := range ports {
		ls = append(ls, fmt.Sprintf(`{"port": %d, "pid": 10}`, p))
	}
	ls = append(ls, `{"port": 9000, "pid": 20}`) // another login's Tally: never this login's port
	f := filepath.Join(t.TempDir(), "fake.json")
	_ = os.WriteFile(f, []byte(fmt.Sprintf(`{"mySession": 1, "users": {"1": "PC1\\made-up-a", "2": "PC1\\made-up-b"}, "processes": [{"pid": 10, "name": "tally", "session": 1, "path": %q}, {"pid": 20, "name": "tally", "session": 2}], "listeners": [%s]}`, path, strings.Join(ls, ", "))), 0o644)
	t.Setenv("TDSBRIDGE_FAKE", f)
}

func TestR2516PortWatchBeatsWhenTheTallyPortMoves(t *testing.T) {
	r2511Fake(t, `{"pid": 10, "name": "tally", "session": 1}`, ``)
	portWatchReset()
	t.Cleanup(portWatchReset)
	r2510Drain()
	r2516PortFake(t, "", 9001)
	if portWatchTick() || r2510Soon() {
		t.Fatal("a beat at the first look")
	}
	if ps := ownTallyPorts(); len(ps) != 1 || ps[0] != 9001 {
		t.Fatalf("this login's ports: %v (another login's 9000 counted?)", ps)
	}
	if portWatchTick() || r2510Soon() {
		t.Fatal("a beat with nothing changed")
	}
	r2516PortFake(t, "", 9002) // Tally restarted on another port
	if !portWatchTick() || !r2510Soon() {
		t.Fatal("no beat when the port moved")
	}
	r2516PortFake(t, "") // Tally closed: within 10 s of the last: waits
	if portWatchTick() || r2510Soon() {
		t.Fatal("two beats within 10 s")
	}
	portWatch.mu.Lock()
	portWatch.beatAt = time.Now().Add(-11 * time.Second)
	portWatch.mu.Unlock()
	if !portWatchTick() || !r2510Soon() {
		t.Fatal("the change that waited was not told")
	}
	if !strings.Contains(readText(logFile()), "Tally's port on this login: [9002] -> []") {
		t.Fatal("no log line")
	}
}

func TestR2516PortNotSaved(t *testing.T) {
	r2511Fake(t, `{"pid": 10, "name": "tally", "session": 1}`, ``)
	pf, _ := r2511Dirs(t)
	dir := filepath.Join(pf, "TallyPrime")
	ini := r2511Ini(t, dir, "[Tally]\r\nClient Server = Both\r\nServer Port = 9000\r\n", time.Time{})
	before := readText(ini)
	exe := filepath.Join(dir, "tally.exe")
	r2516PortFake(t, exe, 9000)
	if b := portNotSavedBeat(); b != nil {
		t.Fatalf("saved, yet said: %v", b)
	}
	r2516PortFake(t, exe, 9050) // typed in F1 > Settings > Connectivity, not kept
	b := obj(portNotSavedBeat())
	if b == nil || toInt(b["port"]) != 9050 || toInt(b["iniPort"]) != 9000 || !strings.Contains(str(b["words"]), "names port 9000") ||
		!strings.Contains(str(b["words"]), "F1 > Settings > Connectivity, set the port to 9050") {
		t.Fatalf("not said: %v", b)
	}
	if readText(ini) != before {
		t.Fatal("tally.ini was written")
	}
	// the beat carries it
	if x := obj(beatBody(true, "open", "", nil, nil, nil)["tallyPortNotSaved"]); toInt(x["port"]) != 9050 {
		t.Fatalf("the beat: %v", x)
	}
	// another login's Tally on a port its ini does not name: not this login's to say
	r2516PortFake(t, exe)
	if b := portNotSavedBeat(); b != nil {
		t.Fatalf("said for another login's Tally: %v", b)
	}
}
