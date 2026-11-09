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
	oldU, oldS := offUserFn, iniSharedFn
	offUserFn = func() string { return `PC1\made-up-a` }
	iniSharedFn = func() bool { return false } // a computer one person uses, unless a test says otherwise
	t.Cleanup(func() { offUserFn, iniSharedFn = oldU, oldS })
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

// each case's words on a computer one person uses with a writable tally.ini: "close and reopen" only when tally.ini
// changed after the Tally started, says Both / Server and its port is free (review 1)
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
	own := loginOwnPortFree(`PC1\made-up-a`, func(n int) bool { return n == 9000 })

	// saved after this Tally started, Both, its port free: a restart takes it
	r2511Ini(t, dir, "[Tally]\r\nClient Server = Both\r\nServer Port = 9070\r\n", start.Add(time.Hour))
	d, w := tallyOffOf(me, procs, nil)
	if w != offWordsReopen || d["reason"] != offReopen || d["iniAfterStart"] != true || d["want"] != 9070 || d["mode"] != "Both" {
		t.Fatalf("changed after start: %q %v", w, d)
	}
	// review 1: changed after start but acts as None / Client: the mode's words, never "reopen"
	for _, m := range []string{"None", "Client"} {
		r2511Ini(t, dir, "[Tally]\r\nClient Server = "+m+"\r\nServer Port = 9070\r\n", start.Add(time.Hour))
		if d, w = tallyOffOf(me, procs, nil); w != offWordsMode || d["reason"] != offMode || d["mode"] != m || d["iniAfterStart"] != true {
			t.Fatalf("changed after start, acts as %s: %q %v", m, w, d)
		}
	}
	// review 1: changed after start (another login saved the file) naming 9000, held by that login's Tally: the clash
	r2511Ini(t, dir, "[Tally]\r\nClient Server = Both\r\nServer Port = 9000\r\n", start.Add(time.Hour))
	lis := []listener{{9000, 20}}
	d, w = tallyOffOf(me, procs, lis)
	if want := fmt.Sprintf(offWordsClash, 9000, "made-up-b's Tally", fmt.Sprintf("set your own port %d", own)); w != want || d["reason"] != offClash || d["iniAfterStart"] != true {
		t.Fatalf("changed after start, port held: %q %v", w, d)
	}
	// the same file saved before it started: never "reopen"; nothing listens on 9070
	r2511Ini(t, dir, "[Tally]\r\nClient Server = Both\r\nServer Port = 9070\r\n", start.Add(-time.Hour))
	d, w = tallyOffOf(me, procs, nil)
	if w != fmt.Sprintf(offWordsClosed, 9070, 9070) || d["reason"] != offClosed || d["iniAfterStart"] != false || strings.Contains(w, "set but not on yet") {
		t.Fatalf("not listening: %q %v", w, d)
	}
	// (only the folder's name, never the whole path; which tally.ini: the Program Files folder's)
	if d["folder"] != "TallyPrime" || d["iniKind"] != "programFiles" || d["iniFolder"] != "TallyPrime" || strings.Contains(jsonText(d), pf) || d["shared"] != nil || d["unwritable"] != nil {
		t.Fatalf("details: %v", d)
	}
	// acts as Client
	r2511Ini(t, dir, "[Tally]\r\nClient Server = Client\r\nServer Port = 9070\r\n", start.Add(-time.Hour))
	if d, w = tallyOffOf(me, procs, nil); w != offWordsMode || d["reason"] != offMode || d["mode"] != "Client" {
		t.Fatalf("acts as Client: %q %v", w, d)
	}
	// its port is another Windows user's Tally's: this login's own port to set instead
	r2511Ini(t, dir, "[Tally]\r\nClient Server = Both\r\nServer Port = 9000\r\n", start.Add(-time.Hour))
	d, w = tallyOffOf(me, procs, lis)
	if want := fmt.Sprintf(offWordsClash, 9000, "made-up-b's Tally", fmt.Sprintf("set your own port %d", own)); w != want || d["reason"] != offClash || d["heldBy"] != "otherUser" || d["heldUser"] != "made-up-b" || d["ownPort"] != own || own <= 0 {
		t.Fatalf("taken by another user's Tally: %q %v (own %d)", w, d, own)
	}
	// review 6: a Tally whose owner Windows did not give (run as administrator): never "another Windows user's Tally"
	unk := proc{ID: 40, Name: "tally", SessionUnknown: true}
	d, w = tallyOffOf(me, []proc{me, unk}, []listener{{9000, 40}})
	if !strings.Contains(w, "used by another program or a Tally run as administrator: set your own port") || strings.Contains(w, "Windows user") || d["heldBy"] != "tally" {
		t.Fatalf("held by a Tally of unknown owner: %q %v", w, d)
	}
	// review 7: no own port known (the login's name not known): a whole sentence
	offUserFn = func() string { return "" }
	if _, w = tallyOffOf(me, procs, lis); w != fmt.Sprintf(offWordsClash, 9000, "made-up-b's Tally", "set a port of your own") {
		t.Fatalf("no own port: %q", w)
	}
	offUserFn = func() string { return `PC1\made-up-a` }
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
	long := "abcdefghijklmnopqrstuvwxyzabcdefghijklmn's Tally"
	for _, s := range []string{offWordsReopen, offWordsMode, fmt.Sprintf(offWordsClash, 65535, long, "set your own port 65535"), fmt.Sprintf(offWordsClash, 65535, offWhoUnknown, "set a port of your own"),
		fmt.Sprintf(offWordsClosed, 65535, 65535), fmt.Sprintf(offWordsLost, "Earlier today", 65535), fmt.Sprintf(offWordsLost, "On 30-Nov", 65535),
		fmt.Sprintf(offAdminClash, 65535, long) + offWhyNoWrite + offAsk(65535), fmt.Sprintf(offAdminClash, 65535, offWhoUnknown) + offWhyShared + offAsk(65535),
		fmt.Sprintf(offAdminLost, "Earlier today", 65535) + offWhyNoWrite + offAsk(65535), fmt.Sprintf(offAdminClosed, 65535) + offWhyShared + offAsk(65535),
		offAdminMode + offWhyNoWrite + offAsk(65535)} {
		if n := len([]rune(s)); n > 300 {
			t.Fatalf("%d letters (FinCom keeps 300): %s", n, s)
		}
	}
}

// review 2: a computer several people use, or a tally.ini this login may not write: never "Ctrl+A in F1", the
// administrator's words with this login's own port; this login's own VirtualStore copy keeps the Ctrl+A words
func TestR2511AdminWords(t *testing.T) {
	r254Bridge(t)
	pf, vs := r2511Dirs(t)
	dir := filepath.Join(pf, "TallyPrime")
	exe := filepath.Join(dir, "tally.exe")
	start := time.Now().Add(-2 * time.Hour)
	me := proc{ID: 10, Name: "tally", Session: 1, Path: exe, Started: start}
	other := proc{ID: 20, Name: "tally", Session: 2}
	r2511Fake(t, `{"pid": 10, "name": "tally", "session": 1}, {"pid": 20, "name": "tally", "session": 2}`, `{"port": 9000, "pid": 20}`)
	procs, lis := []proc{me, other}, []listener{{9000, 20}}
	own := loginOwnPortFree(`PC1\made-up-a`, func(n int) bool { return n == 9000 })
	iniSharedFn = func() bool { return true }
	cases := []struct{ body, want string }{
		{"[Tally]\r\nClient Server = None\r\n", offAdminMode + offWhyShared + offAsk(own)},
		{"[Tally]\r\nClient Server = Both\r\nServer Port = 9000\r\n", fmt.Sprintf(offAdminClash, 9000, "made-up-b's Tally") + offWhyShared + offAsk(own)},
		{"[Tally]\r\nClient Server = Both\r\nServer Port = 9114\r\n", fmt.Sprintf(offAdminClosed, 9114) + offWhyShared + offAsk(own)},
	}
	for i, c := range cases {
		r2511Ini(t, dir, c.body, start.Add(-time.Hour))
		d, w := tallyOffOf(me, procs, lis)
		if w != c.want || strings.Contains(w, "Ctrl+A") || d["shared"] != true || !strings.Contains(w, fmt.Sprintf("(yours: %d)", own)) {
			t.Fatalf("shared %d: %q %v", i, w, d)
		}
	}
	// a computer one person uses, the file not writable by this login
	iniSharedFn = func() bool { return false }
	oldW := iniWritableFn
	t.Cleanup(func() { iniWritableFn = oldW })
	iniWritableFn = func(string) error { return os.ErrPermission }
	r2511Ini(t, dir, "[Tally]\r\nClient Server = Client\r\n", start.Add(-time.Hour))
	if d, w := tallyOffOf(me, procs, lis); w != offAdminMode+offWhyNoWrite+offAsk(own) || d["unwritable"] != true || d["shared"] != nil {
		t.Fatalf("not writable: %q %v", w, d)
	}
	// this login's own VirtualStore copy (a 32-bit Tally not run elevated): its own settings, the Ctrl+A words
	iniSharedFn = func() bool { return true }
	r2511Ini(t, filepath.Join(vs, "Program Files", "TallyPrime"), "[Tally]\r\nClient Server = Client\r\nServer Port = 9039\r\n", start.Add(-time.Hour))
	me32 := me
	me32.Wow64, me32.Elevated = triYes, triNo
	if d, w := tallyOffOf(me32, []proc{me32, other}, lis); w != offWordsMode || d["iniKind"] != "virtualStore" || d["shared"] != nil || d["unwritable"] != nil {
		t.Fatalf("own VirtualStore copy: %q %v", w, d)
	}
}

// review 3: the remembered port is compared with the port it should take (9000 when tally.ini names none), and the mode
// comes first
func TestR2511LostAgainstWant(t *testing.T) {
	r254Bridge(t)
	pf, _ := r2511Dirs(t)
	dir := filepath.Join(pf, "TallyPrime")
	exe := filepath.Join(dir, "tally.exe")
	r2511Fake(t, `{"pid": 10, "name": "tally", "session": 1}`, ``)
	oldNow := nowFn
	t.Cleanup(func() { nowFn = oldNow })
	day1 := time.Date(2026, 11, 8, 15, 0, 0, 0, time.Local)
	nowFn = func() time.Time { return day1 }
	noteTallyPort([]any{M{"port": 9000, "ok": true, "mine": true}})
	nowFn = func() time.Time { return day1.Add(20 * time.Hour) }
	me := proc{ID: 10, Name: "tally", Session: 1, Path: exe, Started: day1.Add(18 * time.Hour)}
	// no port in tally.ini: it takes 9000, the port it used: not "lost"
	r2511Ini(t, dir, "[Tally]\r\nClient Server = Both\r\n", day1.Add(-30*24*time.Hour))
	if d, _ := tallyOffOf(me, []proc{me}, nil); d["reason"] != offClosed || d["want"] != 9000 {
		t.Fatalf("9000 remembered, none named: %v", d)
	}
	// acts as None with a port remembered: the mode's words first
	noteTallyPort([]any{M{"port": 9039, "ok": true, "mine": true}})
	r2511Ini(t, dir, "[Tally]\r\nClient Server = None\r\n", day1.Add(-30*24*time.Hour))
	if d, w := tallyOffOf(me, []proc{me}, nil); d["reason"] != offMode || w != offWordsMode {
		t.Fatalf("mode before lost: %q %v", w, d)
	}
	r2511Ini(t, dir, "[Tally]\r\nClient Server = Both\r\n", day1.Add(-30*24*time.Hour))
	if d, _ := tallyOffOf(me, []proc{me}, nil); d["reason"] != offLost || d["lastPort"] != 9039 {
		t.Fatalf("9039 remembered, 9000 taken now: %v", d)
	}
}

// /diagnose: one finding for this login's Tally, the port its text names the port its words name (review 8)
func TestR2511DiagnoseOnePort(t *testing.T) {
	r254Bridge(t)
	pf, _ := r2511Dirs(t)
	dir := filepath.Join(pf, "TallyPrime")
	exe := filepath.Join(dir, "tally.exe")
	r2511Ini(t, dir, "[Tally]\r\nClient Server = Both\r\nServer Port = 9000\r\n", time.Now().Add(-3*time.Hour))
	r2511Fake(t, fmt.Sprintf(`{"pid": 10, "name": "tally", "session": 1, "path": "%s"}, {"pid": 20, "name": "tally", "session": 2}`, jsq(exe)), `{"port": 9000, "pid": 20}`)
	dg := diagnosis()
	var bad []M
	for _, x := range dg["findings"].([]M) {
		if x["level"] == "bad" {
			bad = append(bad, x)
		}
	}
	if len(bad) != 1 || !strings.Contains(str(bad[0]["text"]), "port 9000 is already taken by made-up-b's Tally") || !strings.HasPrefix(str(bad[0]["fix"]), "Your TallyPrime's port 9000 is used by made-up-b's Tally") {
		t.Fatalf("findings: %v", dg["findings"])
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

// this login's VirtualStore copy of tally.ini: read (only), and taken only for a 32-bit Tally not run elevated, never by
// the files' dates (review 4); not known: Program Files', and said so
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
	if i := ownIniOf(exe, triYes); i["kind"] != "programFiles" || toInt(i["port"]) != 9114 {
		t.Fatalf("no copy: %v", i)
	}
	// the copy OLDER than Program Files' file: still the one a 32-bit Tally not run elevated reads
	vsIni := r2511Ini(t, filepath.Join(vs, "Program Files", "TallyPrime"), "[Tally]\r\nClient Server = Both\r\nServer Port = 9039\r\n", old.Add(-24*time.Hour))
	if i := ownIniOf(exe, triYes); i["kind"] != "virtualStore" || toInt(i["port"]) != 9039 || toInt(i["otherPort"]) != 9114 || i["iniFolder"] != "TallyPrime" {
		t.Fatalf("32-bit, not elevated: %v", i)
	}
	// newer, but a 64-bit or an elevated Tally: never redirected
	_ = os.Chtimes(vsIni, time.Now(), time.Now())
	for _, p := range []proc{{Wow64: triNo, Elevated: triNo}, {Wow64: triYes, Elevated: triYes}, {Wow64: triNo}} {
		if vsRule(p) != triNo {
			t.Fatalf("rule %v: %d", p, vsRule(p))
		}
	}
	if i := ownIniOf(exe, triNo); i["kind"] != "programFiles" || toInt(i["port"]) != 9114 || toInt(i["otherPort"]) != 9039 || i["vsUnsure"] != nil {
		t.Fatalf("64-bit: %v", i)
	}
	// Windows did not say: Program Files', and said so (the beat's iniUnsure)
	if vsRule(proc{}) != triUnknown || vsRule(proc{Wow64: triYes}) != triUnknown || vsRule(proc{Wow64: triYes, Elevated: triNo}) != triYes {
		t.Fatal("the rule")
	}
	if i := ownIniOf(exe, triUnknown); i["kind"] != "programFiles" || i["vsUnsure"] != true {
		t.Fatalf("not known: %v", i)
	}
	me := proc{ID: 10, Name: "tally", Session: 1, Path: exe}
	r2511Fake(t, `{"pid": 10, "name": "tally", "session": 1}`, ``)
	if d, _ := tallyOffOf(me, []proc{me}, nil); d["iniUnsure"] != true || d["iniKind"] != "programFiles" || d["port"] != 9114 {
		t.Fatalf("details, not known: %v", d)
	}
	if l := virtualStoreInis(); len(l) != 1 || l[0] != vsIni {
		t.Fatalf("the copies: %v", l)
	}
	// review 5: no folder for the VirtualStore (a service whose owner's profile is not known): none read
	virtualStoreDirFn = func() string { return "" }
	if virtualStoreOf(filepath.Join(dir, "tally.ini")) != "" || virtualStoreInis() != nil || ownIniOf(exe, triYes)["kind"] != "programFiles" {
		t.Fatal("no VirtualStore folder: none read")
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
	// review 9: one look a beat (tallyWhy once: Windows' lists and tally.ini read once)
	n, real := 0, connOffFn
	connOffFn = func(p []any) (bool, string, M) { n++; return real(p) }
	t.Cleanup(func() { connOffFn = real })
	b := beatBody(false, "closed", "", nil, ports, nil)
	if n != 1 {
		t.Fatalf("the connection looked at %d times in one beat", n)
	}
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
	if !newerVersion(BridgeVersion, "2.5.10") { // 2.5.12: the version itself in r2512_test.go
		t.Fatalf("version %s", BridgeVersion)
	}
}
