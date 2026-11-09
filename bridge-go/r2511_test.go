// FinCom Bridge 2.5.11: why this login's TallyPrime takes no connection (owntally2511.go): each case's words, the details
// in the beat (tallyOff), the last port remembered, this login's VirtualStore tally.ini read, and the port of this
// login's running Tally's tally.ini in the plan before anything listens there. Made-up Windows users only.
package main

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// Windows' lists as the test file gives them, with made-up users: this login (session 1) and another (session 2)
func r2511Fake(t *testing.T, procs, listeners string) {
	t.Helper()
	r253Server(t, procs, listeners)
	f := filepath.Join(t.TempDir(), "fake.json")
	_ = os.WriteFile(f, []byte(fmt.Sprintf(`{"mySession": 1, "users": {"1": "PC1\\made-up-a", "2": "PC1\\made-up-b"}, "processes": [%s], "listeners": [%s]}`, procs, listeners)), 0o644)
	t.Setenv("TDSBRIDGE_FAKE", f)
	oldU := offUserFn
	offUserFn = func() string { return `PC1\made-up-a` }
	t.Cleanup(func() { offUserFn = oldU })
}

// a Program Files folder and this login's VirtualStore, both made up
func r2511Dirs(t *testing.T) (pf, vs string) {
	t.Helper()
	root := t.TempDir()
	pf, vs = filepath.Join(root, "Program Files"), filepath.Join(root, "Local", "VirtualStore")
	_ = os.MkdirAll(pf, 0o755)
	oldP, oldV := programFilesFn, virtualStoreDirFn
	programFilesFn = func() []string { return []string{pf, ""} }
	virtualStoreDirFn = func() string { return vs }
	t.Cleanup(func() { programFilesFn, virtualStoreDirFn = oldP, oldV; resetOwnIniPorts() })
	resetOwnIniPorts()
	return pf, vs
}

func r2511Ini(t *testing.T, dir, body string, at time.Time) string {
	t.Helper()
	_ = os.MkdirAll(dir, 0o755)
	p := filepath.Join(dir, "tally.ini")
	if err := os.WriteFile(p, []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
	if !at.IsZero() {
		_ = os.Chtimes(p, at, at)
	}
	return p
}

func jsq(s string) string { return strings.ReplaceAll(s, `\`, `\\`) }

// each case's words: "close and reopen" only when tally.ini changed after the Tally started
func TestR2511Words(t *testing.T) {
	r254Bridge(t)
	pf, _ := r2511Dirs(t)
	dir := filepath.Join(pf, "TallyPrime")
	exe := filepath.Join(dir, "tally.exe")
	start := time.Now().Add(-2 * time.Hour)
	me := proc{ID: 10, Name: "tally", Session: 1, Path: exe, Started: start}
	other := proc{ID: 20, Name: "tally", Session: 2}
	r2511Fake(t, `{"pid": 10, "name": "tally", "session": 1}, {"pid": 20, "name": "tally", "session": 2}`, `{"port": 9000, "pid": 20}`)
	procs := []proc{me, other}

	// saved after this Tally started: a restart takes it
	r2511Ini(t, dir, "[Tally]\r\nClient Server = Both\r\nServer Port = 9070\r\n", start.Add(time.Hour))
	d, w := tallyOffOf(me, procs, nil)
	if w != offWordsReopen || d["reason"] != offReopen || d["iniAfterStart"] != true || d["want"] != 9070 || d["mode"] != "Both" {
		t.Fatalf("changed after start: %q %v", w, d)
	}
	// the same file saved before it started: never "reopen"; nothing listens on 9070
	r2511Ini(t, dir, "[Tally]\r\nClient Server = Both\r\nServer Port = 9070\r\n", start.Add(-time.Hour))
	d, w = tallyOffOf(me, procs, nil)
	if w != fmt.Sprintf(offWordsClosed, 9070, 9070) || d["reason"] != offClosed || d["iniAfterStart"] != false || strings.Contains(w, "set but not on yet") {
		t.Fatalf("not listening: %q %v", w, d)
	}
	// (only the folder's name, never the whole path; which tally.ini: the Program Files folder's)
	if d["folder"] != "TallyPrime" || d["iniKind"] != "programFiles" || d["iniFolder"] != "TallyPrime" || strings.Contains(jsonText(d), pf) {
		t.Fatalf("details: %v", d)
	}
	// acts as Client
	r2511Ini(t, dir, "[Tally]\r\nClient Server = Client\r\nServer Port = 9070\r\n", start.Add(-time.Hour))
	if d, w = tallyOffOf(me, procs, nil); w != offWordsMode || d["reason"] != offMode || d["mode"] != "Client" {
		t.Fatalf("acts as Client: %q %v", w, d)
	}
	// its port is another Windows user's Tally's: this login's own port to set instead
	r2511Ini(t, dir, "[Tally]\r\nClient Server = Both\r\nServer Port = 9000\r\n", start.Add(-time.Hour))
	lis := []listener{{9000, 20}}
	own := loginOwnPortFree(`PC1\made-up-a`, func(n int) bool { return n == 9000 })
	d, w = tallyOffOf(me, procs, lis)
	if want := fmt.Sprintf(offWordsClash, 9000, "made-up-b's", fmt.Sprint(own)); w != want || d["reason"] != offClash || d["heldBy"] != "otherUser" || d["heldUser"] != "made-up-b" || d["ownPort"] != own || own <= 0 {
		t.Fatalf("taken by another user's Tally: %q %v (own %d)", w, d, own)
	}
	// another program
	d, w = tallyOffOf(me, []proc{me, {ID: 30, Name: "java", Session: 2}}, []listener{{9000, 30}})
	if w != fmt.Sprintf(connOffWordsPort, 9000) || d["reason"] != offProgram || d["heldBy"] != "program" {
		t.Fatalf("another program: %q %v", w, d)
	}
	// no tally.ini at all: the mode's words
	_ = os.Remove(filepath.Join(dir, "tally.ini"))
	if d, w = tallyOffOf(me, procs, nil); w != offWordsMode || d["iniKind"] != "none" || d["want"] != 9000 {
		t.Fatalf("no tally.ini: %q %v", w, d)
	}
	for _, s := range []string{offWordsReopen, offWordsMode, fmt.Sprintf(offWordsClash, 65535, "abcdefghijklmnopqrstuvwxyzabcdefghijklmn's", "65535"),
		fmt.Sprintf(offWordsClosed, 65535, 65535), fmt.Sprintf(offWordsLost, "Earlier today", 65535), fmt.Sprintf(offWordsLost, "On 30-Nov", 65535)} {
		if n := len([]rune(s)); n > 200 {
			t.Fatalf("%d letters (FinCom keeps 200): %s", n, s)
		}
	}
}

// the last port this login's own Tally answered on: kept in the data folder, said when it is gone and not saved
func TestR2511LastPort(t *testing.T) {
	r254Bridge(t)
	pf, _ := r2511Dirs(t)
	dir := filepath.Join(pf, "TallyPrime")
	r2511Fake(t, `{"pid": 10, "name": "tally", "session": 1}`, ``)
	oldNow := nowFn
	t.Cleanup(func() { nowFn = oldNow })
	day1 := time.Date(2026, 11, 8, 15, 0, 0, 0, time.Local)
	nowFn = func() time.Time { return day1 }
	// another login's, an unknown owner's, a skipped one: never this login's port
	noteTallyPort([]any{M{"port": 9000, "ok": true, "mine": false}, M{"port": 9070, "ok": true, "mine": nil}, M{"port": 9071, "ok": true, "mine": true, "skipped": true}})
	if p, _ := lastTallyPort(); p != 0 {
		t.Fatalf("not this login's: %d", p)
	}
	noteTallyPort([]any{M{"port": 9000, "ok": false, "mine": true}, M{"port": 9039, "ok": true, "mine": true}})
	m := readObjFile(lastPortFile())
	if toInt(m["port"]) != 9039 || str(m["at"]) != day1.Format(time.RFC3339) {
		t.Fatalf("kept: %v", m)
	}
	resetLastPort() // read back from the file, as at the next start
	if p, at := lastTallyPort(); p != 9039 || !at.Equal(day1) {
		t.Fatalf("read back: %d %v", p, at)
	}
	// the next day: Tally runs with tally.ini (saved long before) naming 9114, nothing listening
	nowFn = func() time.Time { return day1.Add(20 * time.Hour) }
	exe := filepath.Join(dir, "tally.exe")
	r2511Ini(t, dir, "[Tally]\r\nClient Server = Both\r\nServer Port = 9114\r\n", day1.Add(-30*24*time.Hour))
	me := proc{ID: 10, Name: "tally", Session: 1, Path: exe, Started: day1.Add(18 * time.Hour)}
	d, w := tallyOffOf(me, []proc{me}, nil)
	if w != "Yesterday your Tally used port 9039 but TallyPrime did not save it. Set it again in F1 → Settings → Connectivity and press Ctrl+A to save." ||
		d["reason"] != offLost || d["lastPort"] != 9039 || d["port"] != 9114 {
		t.Fatalf("lost: %q %v", w, d)
	}
	// tally.ini saved since (a port chosen on purpose): its own words
	r2511Ini(t, dir, "[Tally]\r\nClient Server = Both\r\nServer Port = 9114\r\n", day1.Add(time.Hour))
	if d, _ = tallyOffOf(me, []proc{me}, nil); d["reason"] != offClosed {
		t.Fatalf("saved since: %v", d)
	}
	// the same day: "Earlier today"
	r2511Ini(t, dir, "[Tally]\r\nClient Server = Both\r\nServer Port = 9114\r\n", day1.Add(-time.Hour))
	nowFn = func() time.Time { return day1.Add(3 * time.Hour) }
	if _, w = tallyOffOf(me, []proc{me}, nil); !strings.HasPrefix(w, "Earlier today your Tally used port 9039") {
		t.Fatalf("today: %q", w)
	}
	// noted again within the hour: the file is not written again
	nowFn = func() time.Time { return day1.Add(10 * time.Minute) }
	_ = os.Remove(lastPortFile())
	noteTallyPort([]any{M{"port": 9039, "ok": true, "mine": true}})
	if exists(lastPortFile()) {
		t.Fatal("written again within the hour")
	}
}

// this login's VirtualStore copy of tally.ini: read (only), and taken when it is not older than Program Files' own
func TestR2511VirtualStore(t *testing.T) {
	r254Bridge(t)
	pf, vs := r2511Dirs(t)
	dir := filepath.Join(pf, "TallyPrime")
	exe := filepath.Join(dir, "tally.exe")
	old := time.Now().Add(-48 * time.Hour)
	r2511Ini(t, dir, "[Tally]\r\nClient Server = Both\r\nServer Port = 9114\r\n", old)
	if got := virtualStoreOf(filepath.Join(dir, "tally.ini")); got != filepath.Join(vs, "Program Files", "TallyPrime", "tally.ini") {
		t.Fatalf("its copy: %s", got)
	}
	if virtualStoreOf(filepath.Join(t.TempDir(), "tally.ini")) != "" {
		t.Fatal("not under Program Files: no copy")
	}
	i := ownIniOf(exe)
	if i["kind"] != "programFiles" || toInt(i["port"]) != 9114 {
		t.Fatalf("no copy: %v", i)
	}
	vsIni := r2511Ini(t, filepath.Join(vs, "Program Files", "TallyPrime"), "[Tally]\r\nClient Server = Both\r\nServer Port = 9039\r\n", old.Add(24*time.Hour))
	i = ownIniOf(exe)
	if i["kind"] != "virtualStore" || toInt(i["port"]) != 9039 || toInt(i["otherPort"]) != 9114 || i["iniFolder"] != "TallyPrime" {
		t.Fatalf("its copy, newer: %v", i)
	}
	_ = os.Chtimes(vsIni, old.Add(-time.Hour), old.Add(-time.Hour))
	if i = ownIniOf(exe); i["kind"] != "programFiles" || toInt(i["port"]) != 9114 || toInt(i["otherPort"]) != 9039 {
		t.Fatalf("its copy, older: %v", i)
	}
	if l := virtualStoreInis(); len(l) != 1 || l[0] != vsIni {
		t.Fatalf("the copies: %v", l)
	}
	// never written: the copy as it was
	if b, _ := os.ReadFile(vsIni); !strings.Contains(string(b), "Server Port = 9039") || exists(vsIni+".fincom-bak") {
		t.Fatal("the copy was changed")
	}
}

// the port of this login's running Tally's tally.ini (and its VirtualStore copy) is in the plan before anything listens
func TestR2511PlanHasOwnIniPort(t *testing.T) {
	r254Bridge(t)
	pf, vs := r2511Dirs(t)
	dir := filepath.Join(pf, "TallyPrime")
	exe := filepath.Join(dir, "tally.exe")
	r2511Ini(t, dir, "[Tally]\r\nClient Server = Both\r\nServer Port = 9055\r\n", time.Now().Add(-time.Hour))
	r2511Fake(t, fmt.Sprintf(`{"pid": 10, "name": "tally", "session": 1, "path": "%s"}, {"pid": 20, "name": "tally", "session": 2}`, jsq(exe)), `{"port": 9000, "pid": 20}`)
	has := func(port int) M {
		_, plan := portPlan()
		for _, p := range plan {
			if toInt(p["port"]) == port {
				return p
			}
		}
		return nil
	}
	if p := has(9055); p == nil {
		t.Fatal("9055 (this login's Tally's tally.ini) not in the plan")
	}
	// a port saved in this login's VirtualStore only
	r2511Ini(t, filepath.Join(vs, "Program Files", "TallyPrime2"), "[Tally]\r\nClient Server = Both\r\nServer Port = 9077\r\n", time.Time{})
	resetIniPorts()
	if has(9077) == nil {
		t.Fatal("9077 (VirtualStore) not in the plan")
	}
	// another login's Tally's own tally.ini is never read for it: its program has no path here; only "mine" counts
	r2511Fake(t, fmt.Sprintf(`{"pid": 20, "name": "tally", "session": 2, "path": "%s"}`, jsq(exe)), ``)
	resetIniPorts()
	if l := ownTallyIniPorts(); containsInt(l, 9055) {
		t.Fatalf("another login's Tally's tally.ini: %v", l)
	}
}

// the beat: tallyWhy "connection off" carries tallyOff, the words in tallyConnectSay; nothing when not off
func TestR2511BeatCarriesTallyOff(t *testing.T) {
	r254Bridge(t)
	pf, _ := r2511Dirs(t)
	dir := filepath.Join(pf, "TallyPrime")
	exe := filepath.Join(dir, "tally.exe")
	r2511Ini(t, dir, "[Tally]\r\nClient Server = None\r\n", time.Now().Add(-time.Hour))
	started := time.Now().Add(-10 * time.Minute).UTC().Format(time.RFC3339)
	r2511Fake(t, fmt.Sprintf(`{"pid": 10, "name": "tally", "session": 1, "path": "%s", "started": "%s"}`, jsq(exe), started), ``)
	ports := []any{M{"port": 9000, "reason": "closed"}}
	why := tallyWhy(ports)
	d, _ := tallyOffBeat(why).(M)
	if why != whyConnOff || d == nil || d["reason"] != offMode || d["mode"] != "None" || d["startedAt"] != started || tallyConnectSay(why, nil) != offWordsMode {
		t.Fatalf("off: %q %v %q", why, d, tallyConnectSay(why, nil))
	}
	b := beatBody(false, "closed", "", nil, ports, nil)
	if o := obj(b["tallyOff"]); o == nil || o["reason"] != offMode || b["tallyConnectSay"] != offWordsMode {
		t.Fatalf("beat: %v %v", b["tallyOff"], b["tallyConnectSay"])
	}
	if tallyOffBeat("another user") != nil {
		t.Fatal("not off: no tallyOff")
	}
	// /diagnose names the same words for it
	if dg := diagnosis(); obj(dg["tallyOff"]) == nil {
		t.Fatalf("diagnose: %v", dg["tallyOff"])
	}
}

// 2.5.11: the self-update takes it as newer than 2.5.10 and 2.5.9 (numbers, not text)
func TestR2511Versions(t *testing.T) {
	for _, c := range [][3]string{{"2.5.11", "2.5.10", "1"}, {"2.5.10", "2.5.11", ""}, {"2.5.11", "2.5.9", "1"}, {"2.5.11", "2.5.11", ""}, {"2.5.12", "2.5.11", "1"}} {
		if newerVersion(c[0], c[1]) != (c[2] == "1") {
			t.Fatal(c)
		}
	}
	if BridgeVersion != "2.5.11" || !newerVersion(BridgeVersion, "2.5.10") {
		t.Fatalf("version %s", BridgeVersion)
	}
}
