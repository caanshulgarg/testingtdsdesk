// 2.5.3: TallyPrime's connection switched on in tally.ini (iniconnect253.go): off -> enabled, already on, a file this
// user cannot write, a port clash; and Connect finds the Tally at once after Tally's restart (no 30 s wait)
package main

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func r253Ini(t *testing.T, body string) (string, string) {
	t.Helper()
	d := filepath.Join(t.TempDir(), "TallyPrime")
	_ = os.MkdirAll(d, 0o755)
	p := filepath.Join(d, "tally.ini")
	_ = os.WriteFile(p, []byte(body), 0o644)
	old := tallyIniDirsFn
	tallyIniDirsFn = func() []string { return []string{d} }
	oldW := iniWritableFn
	t.Cleanup(func() { tallyIniDirsFn, iniWritableFn = old, oldW; resetIniPorts() })
	resetIniPorts()
	return d, p
}

func r253Read(t *testing.T, p string) string {
	b, err := os.ReadFile(p)
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

// off (acts as None) -> Both; the existing port kept; nothing else changed; the backup is the file as it was
func TestR253IniOffToBoth(t *testing.T) {
	f := newStandTally(t)
	standBridge(t, f, "")
	orig := "[Tally]\r\nUser TDL = Yes\r\nClient Server=None\r\nServer Port = 9070\r\nData = D:\\Data\r\n"
	_, p := r253Ini(t, orig)
	e, err := tallyIniApply(p, addonIniPath())
	if err != nil || str(e["connect"]) != connectEnabled || toInt(e["serverPort"]) != 9070 {
		t.Fatalf("apply: %v %v", e, err)
	}
	got := r253Read(t, p)
	if !strings.Contains(got, "Client Server=Both\r\n") || !strings.Contains(got, "Server Port = 9070\r\n") || !strings.Contains(got, "Data = D:\\Data\r\n") || strings.Count(got, "Server Port") != 1 {
		t.Fatalf("file:\n%s", got)
	}
	if bak := r253Read(t, p+".fincom-bak"); bak != orig {
		t.Fatalf("backup:\n%s", bak)
	}
	// the beat: the file's state, and the person's words while Tally does not answer yet
	if say := tallyConnectSay("no Tally running in this login", []any{e}); say != connectSay {
		t.Fatalf("say %q", say)
	}
	if say := tallyConnectSay("", []any{e}); say != "" {
		t.Fatalf("Tally answers: no words, got %q", say)
	}
	old := nowFn
	nowFn = func() time.Time { return time.Now().Add(25 * time.Hour) }
	defer func() { nowFn = old }()
	if say := tallyConnectSay("no Tally running in this login", []any{e}); say != "" {
		t.Fatalf("a day later: no words, got %q", say)
	}
}

// Client acts as Client and no port: Both, and 9000 added
func TestR253IniClientNoPort(t *testing.T) {
	f := newStandTally(t)
	standBridge(t, f, "")
	_, p := r253Ini(t, "[Tally]\nClient Server = Client\nTDL = x.tdl\n[Other]\nServer Port = 1234\n")
	e, err := tallyIniApply(p, addonIniPath())
	if err != nil || str(e["connect"]) != connectEnabled {
		t.Fatalf("apply: %v %v", e, err)
	}
	got := r253Read(t, p)
	if !strings.Contains(got, "Client Server = Both\n") || !strings.Contains(got, "ServerPort = 9000\n[Other]\nServer Port = 1234\n") {
		t.Fatalf("file:\n%s", got)
	}
}

// already on (Both or Server, a port): only the add-on rule as before, the connection left as it is
func TestR253IniAlreadyOn(t *testing.T) {
	f := newStandTally(t)
	standBridge(t, f, "")
	for _, v := range []string{"Both", "Server"} {
		body := fmt.Sprintf("[Tally]\r\nUser TDL = Yes\r\nTDL = %s\r\nClient Server = %s\r\nServer Port = 9898\r\n", addonIniPath(), v)
		_, p := r253Ini(t, body)
		e, err := tallyIniApply(p, addonIniPath())
		if err != nil || str(e["connect"]) != connectAlready || str(e["state"]) != "already" {
			t.Fatalf("%s: %v %v", v, e, err)
		}
		if got := r253Read(t, p); got != body {
			t.Fatalf("%s changed:\n%s", v, got)
		}
		if _, err := os.Lstat(p + ".fincom-bak"); err == nil {
			t.Fatalf("%s: a backup for nothing changed", v)
		}
	}
}

// a file this Windows user may not write: not touched, no backup, "cannot write" in the beat
func TestR253IniCannotWrite(t *testing.T) {
	f := newStandTally(t)
	standBridge(t, f, "")
	orig := "[Tally]\r\nUser TDL = Yes\r\nClient Server = None\r\n"
	_, p := r253Ini(t, orig)
	iniWritableFn = func(string) error { return &os.PathError{Op: "open", Path: p, Err: os.ErrPermission} }
	e, err := tallyIniApply(p, addonIniPath())
	if err == nil || str(e["connect"]) != connectCannotWrite {
		t.Fatalf("apply: %v %v", e, err)
	}
	if got := r253Read(t, p); got != orig {
		t.Fatalf("touched:\n%s", got)
	}
	if _, err := os.Lstat(p + ".fincom-bak"); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("a backup was written for a file not touched")
	}
}

// a port clash: 9000 named by another TallyPrime's tally.ini and 9001 listened on: the first free port is taken
func TestR253IniPortClash(t *testing.T) {
	f := newStandTally(t)
	standBridge(t, f, "")
	root := t.TempDir()
	mine, other := filepath.Join(root, "TallyPrime"), filepath.Join(root, "TallyPrime (1)")
	_ = os.MkdirAll(mine, 0o755)
	_ = os.MkdirAll(other, 0o755)
	p := filepath.Join(mine, "tally.ini")
	_ = os.WriteFile(p, []byte("[Tally]\r\nClient Server = None\r\n"), 0o644)
	_ = os.WriteFile(filepath.Join(other, "tally.ini"), []byte("[Tally]\r\nClient Server = Both\r\nServer Port = 9000\r\n"), 0o644)
	old := tallyIniDirsFn
	tallyIniDirsFn = func() []string { return []string{mine, other} }
	t.Cleanup(func() { tallyIniDirsFn = old; resetIniPorts() })
	fake := filepath.Join(root, "fake.json")
	_ = os.WriteFile(fake, []byte(`{"mySession": 1, "processes": [{"pid": 30, "name": "svc", "session": 1}], "listeners": [{"port": 9001, "pid": 30}]}`), 0o644)
	t.Setenv("TDSBRIDGE_FAKE", fake)
	e, err := tallyIniApply(p, addonIniPath())
	if err != nil || str(e["connect"]) != connectEnabled || toInt(e["serverPort"]) != 9002 {
		t.Fatalf("apply: %v %v", e, err)
	}
	if got := r253Read(t, p); !strings.Contains(got, "ServerPort = 9002\r\n") || !strings.Contains(got, "Client Server = Both\r\n") {
		t.Fatalf("file:\n%s", got)
	}
	// FinCom Bridge's own range is never given to Tally
	used := func(p int) bool { return p < 9200 }
	if p := freeTallyPort(used); p != 9200 {
		t.Fatalf("free port %d", p)
	}
}

// the file's encoding is kept (UTF-16 LE with its BOM)
func TestR253IniUTF16Kept(t *testing.T) {
	raw := iniEncode("[Tally]\r\nClient Server = None\r\nServer Port = 9070\r\n", "utf16")
	nb, st, port, _ := iniConnect(raw, nil)
	text, enc, ok := iniDecode(nb)
	if st != connectEnabled || port != 9070 || enc != "utf16" || !ok || text != "[Tally]\r\nClient Server = Both\r\nServer Port = 9070\r\n" {
		t.Fatalf("%s %d %s %q", st, port, enc, text)
	}
}

// Connect (/status?fresh=1) right after Tally's restart: the list held (closed, from 10 s ago) is not taken; Tally is
// asked at once and found
func TestR253ConnectFindsRestartedTallyAtOnce(t *testing.T) {
	mine := newStandTally(t)
	standBridge(t, mine, "")
	r253Server(t, `{"pid": 10, "name": "tally", "session": 1}`, fmt.Sprintf(`{"port": %d, "pid": 10}`, mine.port))
	_, plan := portPlan()
	held := []M{}
	for _, pp := range plan {
		e := planEntry(pp)
		e["tallyState"] = "closed"
		held = append(held, e)
	}
	coMu.Lock()
	coCache, coCacheAt = held, time.Now()
	coMu.Unlock()
	e := r253Entry(t, openCompanies(false), mine.port)
	if e["ok"] != true || len(sessCompanies(e)) == 0 {
		t.Fatalf("the list of before Tally's restart was taken: %v", e)
	}
	// and while it matches Windows' list now, the list held stands (Tally is not asked again within the 30 s)
	n := len(mine.ids())
	openCompanies(false)
	if len(mine.ids()) != n {
		t.Fatal("Tally asked again although nothing changed")
	}
}
