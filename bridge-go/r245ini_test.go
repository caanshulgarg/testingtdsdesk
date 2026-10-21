package main

// FinCom Bridge 2.4.5: the add-on in tally.ini (tallyini.go). Tests written before the code, on the real files of
// TallyPrime 3.0 and 7.1 (testdata/r245: tally-versions dbbig run 39542962661, cases A-D before and after the harness's
// FcIniAdd, and TallyPrime's own file as installed).

import (
	"bytes"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const iniAddon = `C:\ProgramData\FinCom\addon\FinComRecorder.tdl`

func iniRead(t *testing.T, rel, name string) []byte {
	t.Helper()
	b, err := os.ReadFile(filepath.Join("testdata", "r245", rel, name))
	if err != nil {
		t.Fatal(err)
	}
	return b
}

// the lines of a are the lines of b in the same order, with only added ones between them (never removed or moved)
func iniOnlyAdded(a, b string) bool {
	al, bl := strings.Split(a, "\n"), strings.Split(b, "\n")
	j := 0
	for _, l := range bl {
		if j < len(al) && l == al[j] {
			j++
		}
	}
	return j == len(al)
}

func TestR245TallyIniRealFiles(t *testing.T) {
	for _, rel := range []string{"3.0", "7.1"} {
		for _, c := range []string{"A-other-tdl", "B-no-tdl-lines"} {
			before, after := iniRead(t, rel, "ini-"+c+"-before.txt"), iniRead(t, rel, "ini-"+c+"-after.txt")
			got, st, added := iniAddAddon(before, iniAddon)
			if st != "added" || !bytes.Equal(got, after) || added[len(added)-1] != "TDL = "+iniAddon || (c == "B-no-tdl-lines") != (len(added) == 2) {
				t.Fatalf("%s %s: %s %v\n%q\nwant (the harness's result, proven on real Tally)\n%q", rel, c, st, added, got, after)
			}
			// Tally kept the file as written (after starting and closing)
			if !bytes.Equal(after, iniRead(t, rel, "ini-"+c+"-after-tally-closed.txt")) {
				t.Fatalf("%s %s: Tally rewrote tally.ini", rel, c)
			}
			again, st2, _ := iniAddAddon(got, iniAddon)
			if st2 != "already" || !bytes.Equal(again, got) {
				t.Fatalf("%s %s: a second run changed it (%s)", rel, c, st2)
			}
		}
		// D: the line is already there: nothing
		d := iniRead(t, rel, "ini-D-already-there-before.txt")
		if got, st, _ := iniAddAddon(d, iniAddon); st != "already" || !bytes.Equal(got, d) {
			t.Fatalf("%s D: %s", rel, st)
		}
		// C: User TDL = No: untouched (the harness's own rule added Yes after it, which turned on every other add-on too)
		cb := iniRead(t, rel, "ini-C-usertdl-no-before.txt")
		if got, st, _ := iniAddAddon(cb, iniAddon); st != "usertdl-no" || !bytes.Equal(got, cb) {
			t.Fatalf("%s C: %s %q", rel, st, got)
		}
		// TallyPrime's own file as installed: one line, at the end of its [TALLY] section, nothing else touched
		inst := iniRead(t, rel, "tally-ini-as-installed.txt")
		got, st, added := iniAddAddon(inst, iniAddon)
		if st != "added" || len(added) != 1 || !bytes.Equal(got, append(append([]byte{}, inst...), []byte("TDL = "+iniAddon+"\r\n")...)) {
			t.Fatalf("%s as installed: %s %v\n%s", rel, st, added, got)
		}
		if !iniOnlyAdded(string(inst), string(got)) {
			t.Fatalf("%s: a line removed or moved", rel)
		}
	}
}

func TestR245TallyIniRule(t *testing.T) {
	cases := []struct{ name, in, want, state string }{
		{"no User TDL line: both lines", "[Tally]\r\nLoad = 1\r\n", "[Tally]\r\nLoad = 1\r\nUser TDL = Yes\r\nTDL = " + iniAddon + "\r\n", "added"},
		{"line feeds kept, no last line end", "[Tally]\nUser TDL = Yes\nTDL = C:\\x.tdl", "[Tally]\nUser TDL = Yes\nTDL = C:\\x.tdl\nTDL = " + iniAddon, "added"},
		{"named in another spelling", "[Tally]\r\nUser TDL = Yes\r\ntdl = \"c:/programdata/fincom/addon/fincomrecorder.tdl\"\r\n", "", "already"},
		{"the end of the [Tally] section", "[Tally]\r\nUser TDL = Yes\r\n[Other]\r\nx = 1\r\n", "[Tally]\r\nUser TDL = Yes\r\nTDL = " + iniAddon + "\r\n[Other]\r\nx = 1\r\n", "added"},
		{"after the last TDL line", "[Tally]\r\nTDL = a.tdl\r\nUser TDL = Yes\r\nTDL = b.tdl\r\nColor = Yes\r\n", "[Tally]\r\nTDL = a.tdl\r\nUser TDL = Yes\r\nTDL = b.tdl\r\nTDL = " + iniAddon + "\r\nColor = Yes\r\n", "added"},
		{"User TDL = No, even late", "[Tally]\r\nUser TDL = Yes\r\nUser TDL = No\r\n", "", "usertdl-no"},
		{"User TDL = no, lower case", "[Tally]\r\nuser tdl = no\r\n", "", "usertdl-no"},
		{"a ;;tdl comment is not a line", "[Tally]\r\nUser TDL = Yes\r\n;;tdl = <tdlfile.1>\r\n", "[Tally]\r\nUser TDL = Yes\r\n;;tdl = <tdlfile.1>\r\nTDL = " + iniAddon + "\r\n", "added"},
	}
	for _, c := range cases {
		got, st, _ := iniAddAddon([]byte(c.in), iniAddon)
		want := c.want
		if want == "" {
			want = c.in
		}
		if st != c.state || string(got) != want {
			t.Fatalf("%s: %s\n%q\nwant %s\n%q", c.name, st, got, c.state, want)
		}
	}
	// UTF-16 LE with its BOM, and UTF-8 with its BOM: kept
	u16 := utf16leBOM("[Tally]\r\nUser TDL = Yes\r\n")
	got, st, _ := iniAddAddon(u16, iniAddon)
	if st != "added" || !bytes.Equal(got, utf16leBOM("[Tally]\r\nUser TDL = Yes\r\nTDL = "+iniAddon+"\r\n")) {
		t.Fatalf("UTF-16: %s %q", st, got)
	}
	u8 := append([]byte{0xEF, 0xBB, 0xBF}, "[Tally]\r\nUser TDL = Yes\r\n"...)
	got, st, _ = iniAddAddon(u8, iniAddon)
	if st != "added" || !bytes.Equal(got, append([]byte{0xEF, 0xBB, 0xBF}, ("[Tally]\r\nUser TDL = Yes\r\nTDL = "+iniAddon+"\r\n")...)) {
		t.Fatalf("UTF-8 BOM: %s %q", st, got)
	}
}

// the file: a backup first, kept as the client's original (never overwritten); a link never followed; each file's result
// in the beat; the step once per version at the first start (the service and the per-user bridge)
func TestR245TallyIniApplyAndStep(t *testing.T) {
	standBridge(t, newStandTally(t), "")
	pd := t.TempDir()
	t.Setenv("ProgramData", pd)
	d1, d2, d3 := t.TempDir(), t.TempDir(), t.TempDir()
	old := tallyIniDirsFn
	tallyIniDirsFn = func() []string { return []string{d1, d2, d3, d1} }
	t.Cleanup(func() { tallyIniDirsFn = old })
	iniSt.mu.Lock()
	iniSt.files = map[string]M{}
	iniSt.mu.Unlock()
	orig := "[Tally]\r\nUser TDL = Yes\r\nTDL = C:\\fcother\\Other.tdl\r\n"
	_ = os.WriteFile(filepath.Join(d1, "tally.ini"), []byte(orig), 0o644)
	_ = os.WriteFile(filepath.Join(d2, "tally.ini"), []byte("[Tally]\r\nUser TDL = No\r\n"), 0o644)
	// d3: tally.ini is a link to another file: never followed or written
	target := filepath.Join(t.TempDir(), "elsewhere.ini")
	_ = os.WriteFile(target, []byte("[Tally]\r\n"), 0o644)
	_ = os.Symlink(target, filepath.Join(d3, "tally.ini"))
	var log []string
	res := tallyIniStep(func(s string) { log = append(log, s) })
	if len(res) != 3 {
		t.Fatalf("%d results: %v", len(res), res)
	}
	want := strings.ReplaceAll(pd+`\FinCom\addon\FinComRecorder.tdl`, "/", "/")
	b1, _ := os.ReadFile(filepath.Join(d1, "tally.ini"))
	if string(b1) != orig+"TDL = "+want+"\r\n" {
		t.Fatalf("d1: %q", b1)
	}
	if bak, _ := os.ReadFile(filepath.Join(d1, "tally.ini.fincom-bak")); string(bak) != orig {
		t.Fatalf("the backup: %q", bak)
	}
	if b2, _ := os.ReadFile(filepath.Join(d2, "tally.ini")); string(b2) != "[Tally]\r\nUser TDL = No\r\n" || exists(filepath.Join(d2, "tally.ini.fincom-bak")) {
		t.Fatalf("User TDL = No touched: %q", b2)
	}
	if b3, _ := os.ReadFile(target); string(b3) != "[Tally]\r\n" {
		t.Fatalf("a link followed: %q", b3)
	}
	states := map[string]string{}
	for _, x := range tallyIniBeat() {
		states[filepath.Dir(str(obj(x)["path"]))] = str(obj(x)["state"])
		if str(obj(x)["state"]) == "usertdl-no" && !strings.Contains(str(obj(x)["why"]), "User TDL = No") {
			t.Fatalf("no words for Help & support: %v", x)
		}
	}
	if states[d1] != "added" || states[d2] != "usertdl-no" || states[d3] != "refused" {
		t.Fatalf("the beat: %v", states)
	}
	if !strings.Contains(strings.Join(log, "\n"), "User TDL = No: the file is left as it is") {
		t.Fatalf("the log: %v", log)
	}
	// another change later: the backup stays the client's original
	_ = os.WriteFile(filepath.Join(d1, "tally.ini"), []byte("[Tally]\r\nUser TDL = Yes\r\n"), 0o644)
	tallyIniStep(func(string) {})
	if bak, _ := os.ReadFile(filepath.Join(d1, "tally.ini.fincom-bak")); string(bak) != orig {
		t.Fatalf("the backup overwritten: %q", bak)
	}
	// the first start of a version: once (the marker), again for a new version
	exe := t.TempDir()
	_ = os.WriteFile(filepath.Join(d1, "tally.ini"), []byte("[Tally]\r\nUser TDL = Yes\r\n"), 0o644)
	if !tallyIniAfterUpdate(exe, func(string) {}) || tallyIniAfterUpdate(exe, func(string) {}) {
		t.Fatal("the step at the first start: not once")
	}
	if b, _ := os.ReadFile(filepath.Join(d1, "tally.ini")); !strings.Contains(string(b), "FinComRecorder.tdl") {
		t.Fatalf("not applied at the first start: %q", b)
	}
	old2 := BridgeVersion
	BridgeVersion = "9.9.9"
	t.Cleanup(func() { BridgeVersion = old2 })
	if !tallyIniAfterUpdate(exe, func(string) {}) {
		t.Fatal("a new version did not run the step")
	}
	// the setup's install step runs it too (just for one user here: no permissions are set on this test machine)
	_ = os.WriteFile(filepath.Join(d1, "tally.ini"), []byte("[Tally]\r\nUser TDL = Yes\r\n"), 0o644)
	var ilog []string
	installFinComFolders(false, func(s string) { ilog = append(ilog, s) })
	if b, _ := os.ReadFile(filepath.Join(d1, "tally.ini")); !strings.Contains(string(b), "TDL = "+want) || !strings.Contains(strings.Join(ilog, "\n"), "Install: tally.ini") {
		t.Fatalf("the install step: %q %v", b, ilog)
	}
	if !exists(filepath.Join(pd, "FinCom", "addon", "FinComRecorder.tdl")) {
		t.Fatal("the add-on itself was not written where the line names it")
	}
}

// review 245 R1-9: a write cut short is put back as it was; R1-10: a failed tally.ini leaves the first-start marker unwritten
// (the step runs again at the next start)
func TestR245TallyIniWriteFailsPutBack(t *testing.T) {
	standBridge(t, newStandTally(t), "")
	t.Setenv("ProgramData", t.TempDir())
	d1 := t.TempDir()
	old := tallyIniDirsFn
	tallyIniDirsFn = func() []string { return []string{d1} }
	t.Cleanup(func() { tallyIniDirsFn = old })
	iniSt.mu.Lock()
	iniSt.files = map[string]M{}
	iniSt.mu.Unlock()
	orig := "[Tally]\r\nUser TDL = Yes\r\n"
	p := filepath.Join(d1, "tally.ini")
	_ = os.WriteFile(p, []byte(orig), 0o644)
	ow := iniWriteFn
	fail := true
	iniWriteFn = func(path string, b []byte) error {
		if fail && string(b) != orig {
			_ = os.WriteFile(path, b[:5], 0o644) // cut short, then the error
			return errors.New("disk full")
		}
		return ow(path, b)
	}
	t.Cleanup(func() { iniWriteFn = ow })
	exe := t.TempDir()
	if !tallyIniAfterUpdate(exe, func(string) {}) {
		t.Fatal("the step did not run")
	}
	if b, _ := os.ReadFile(p); string(b) != orig {
		t.Fatalf("not put back: %q", b)
	}
	if exists(filepath.Join(exe, tallyIniMarkerName)) {
		t.Fatal("the marker written though tally.ini failed")
	}
	fail = false
	if !tallyIniAfterUpdate(exe, func(string) {}) || !exists(filepath.Join(exe, tallyIniMarkerName)) {
		t.Fatal("not tried again at the next start")
	}
	if b, _ := os.ReadFile(p); !strings.Contains(string(b), "FinComRecorder.tdl") {
		t.Fatalf("not added the second time: %q", b)
	}
}
