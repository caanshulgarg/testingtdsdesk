package main

// Round 20 (FinCom Bridge 2.1.9, the re-review of the fixes, docs/reviews/bridge-2.1.9-*.md "Re-review of the fixes
// (457dc64..cec0b8a)"):
//   - Medium 1 / RS1: before any read or lock in the recorder folder, C:\ProgramData\FinCom and its recorder\ must be
//     plain folders (no link, junction or reparse point), owned by SYSTEM or Administrators when the bridge runs as the
//     service, and the recorder folder's final path the expected one; else nothing is read and the log says why. The
//     service runs the install step's folder part once at its first start of a new version (a marker in its own folder);
//   - Low 2 / RL5: start-point.json: the first-seen numbers kept while the file cannot be read, recorded when it can;
//     saveFile never leaves the file missing;
//   - Low 3 / RL1: the change numbers' append does not follow a link;
//   - Low 4 / RL2: the bench is not a "person" request; the lock checks the file it holds;
//   - Low 5 / RL3: the folders' permissions reset before they are set (no stray explicit entry kept);
//   - Low 6 / RL4: the Windows workflow checks, as a user who is not an administrator, what the trial needs.

import (
	"errors"
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// a recorder folder at <pd>/FinCom/recorder for this test (the tests' Tally folder empty)
func r20RecorderAt(t *testing.T, pd string) string {
	t.Helper()
	rec := filepath.Join(pd, "FinCom", "recorder")
	oldR, oldT := recorderDirFn, tallyDirsFn
	recorderDirFn = func() string { return rec }
	tallyDirsFn = func() []string { return []string{t.TempDir()} }
	t.Cleanup(func() { recorderDirFn, tallyDirsFn = oldR, oldT; recorderWatchReset(); recorderRefusedLogged = "" })
	recorderWatchReset()
	recorderRefusedLogged = ""
	return rec
}

// --- Medium 1: C:\ProgramData\FinCom a link (on Windows a junction: round20_windows_test.go) to a folder of another
// user's that holds recorder\<file>.txt: nothing is read, watched, looked at or locked there; the log says why. A plain
// FinCom: read as before. As the service, a FinCom or recorder not owned by SYSTEM or Administrators: refused
func TestRecorderReadRefusedWhenParentIsLink(t *testing.T) {
	pd := t.TempDir()
	other := t.TempDir()
	_ = os.MkdirAll(filepath.Join(other, "recorder"), 0o755)
	secret := filepath.Join(other, "recorder", "co-guid-1.txt")
	_ = os.WriteFile(secret, []byte(r18Line1+"\r\nSECRET OF ANOTHER USER\r\n"), 0o644)
	if err := os.Symlink(other, filepath.Join(pd, "FinCom")); err != nil {
		t.Skip("no symlinks here: " + err.Error())
	}
	rec := r20RecorderAt(t, pd)
	f := newStandTally(t)
	c := newStandCloud(t)
	standBridge(t, f, c.cfg()+`,"Key":"tray-test-key"`)
	trialOn(t)                   // round 21 (2.1.10): the owner's trial tools switched on for this computer in FinCom
	_ = findCompanyPortQuiet(zz) // ZZ TEST's GUID co-guid-1 held
	if fs := recorderFiles(); len(fs) != 0 {
		t.Fatalf("recorder files listed through a linked FinCom: %v", fs)
	}
	recorderWatchOnce()
	recWatchMu.Lock()
	watched := len(recWatchLast)
	recWatchMu.Unlock()
	if watched != 0 {
		t.Fatalf("the watch looked at %d file(s) through a linked FinCom", watched)
	}
	if seen, at := recorderHolding(zz, "co-guid-1"); seen || at != "" {
		t.Fatalf("recorderHolding looked through a linked FinCom: %v %q", seen, at)
	}
	if _, err := recorderLockHolding(zz); err == nil {
		t.Fatal("a file was locked through a linked FinCom")
	}
	code, res := callLocal(t, "POST", "/tray/recorder-send", "", "{}")
	if code != 200 || toInt(res["files"]) != 0 {
		t.Fatalf("send results through a linked FinCom: %d %v", code, res)
	}
	for k, v := range r19Pack(t, c) {
		if strings.Contains(v, "SECRET OF ANOTHER USER") {
			t.Fatalf("%s carries a file of the linked folder", k)
		}
	}
	if logLines("Recorder trial: the recorder folder "+rec+" is not read") == 0 {
		t.Fatal("the log does not say why the recorder folder is not read")
	}
	// a plain FinCom and recorder: read as before
	_ = os.Remove(filepath.Join(pd, "FinCom"))
	_ = os.MkdirAll(rec, 0o755)
	_ = os.WriteFile(filepath.Join(rec, "co-guid-1.txt"), []byte(r18Line1+"\r\n"), 0o644)
	if fs := recorderFiles(); len(fs) != 1 {
		t.Fatalf("a plain recorder folder: %v", fs)
	}
	if seen, _ := recorderHolding(zz, "co-guid-1"); !seen {
		t.Fatal("a plain recorder folder's holding file is not seen")
	}
	// recorder itself a link inside a plain FinCom: refused (as before)
	_ = os.RemoveAll(rec)
	_ = os.Symlink(filepath.Join(other, "recorder"), rec)
	if fs := recorderFiles(); len(fs) != 0 {
		t.Fatalf("recorder a link: %v", fs)
	}
	_ = os.Remove(rec)
	_ = os.MkdirAll(rec, 0o755)
	_ = os.WriteFile(filepath.Join(rec, "co-guid-1.txt"), []byte(r18Line1+"\r\n"), 0o644)
	// as the service: a FinCom (then a recorder) owned by a user: refused
	oldS, oldO := recorderAsService, ownerIsAdmin
	t.Cleanup(func() { recorderAsService, ownerIsAdmin = oldS, oldO })
	recorderAsService = func() bool { return true }
	for _, bad := range []string{filepath.Join(pd, "FinCom"), rec} {
		b := bad
		ownerIsAdmin = func(p string) (bool, string) { return filepath.Clean(p) != filepath.Clean(b), "S-1-5-21-user" }
		if fs := recorderFiles(); len(fs) != 0 {
			t.Fatalf("as the service, %s owned by a user: %v", b, fs)
		}
		if seen, _ := recorderHolding(zz, "co-guid-1"); seen {
			t.Fatalf("as the service, %s owned by a user: the holding file looked at", b)
		}
	}
	ownerIsAdmin = func(string) (bool, string) { return true, "S-1-5-32-544" }
	if fs := recorderFiles(); len(fs) != 1 {
		t.Fatalf("as the service, owned by Administrators: %v", fs)
	}
	// the final path check: a recorder folder whose final path is elsewhere is refused
	oldF := finalPathFn
	t.Cleanup(func() { finalPathFn = oldF })
	finalPathFn = func(p string) (string, error) {
		if filepath.Clean(p) == filepath.Clean(rec) {
			return filepath.Join(other, "recorder"), nil
		}
		return oldF(p)
	}
	if fs := recorderFiles(); len(fs) != 0 {
		t.Fatalf("a recorder folder whose final path is elsewhere: %v", fs)
	}
	if logLines("its final path is") == 0 {
		t.Fatal("the log does not name the final path")
	}
}

// --- Medium 1, the update: a PC that updated itself from 2.1.8 never ran `FinComBridge.exe install` for the folders;
// the service runs the folder step once at its first start of a new version (a marker in its own folder)
func TestFoldersFixedOnFirstStartAfterUpdate(t *testing.T) {
	exeDir, pd := t.TempDir(), t.TempDir()
	t.Setenv("ProgramData", pd)
	target := t.TempDir()
	if err := os.Symlink(target, filepath.Join(pd, "FinCom")); err != nil {
		t.Skip("no symlinks here: " + err.Error())
	}
	var calls [][]string
	fail := false
	oldI := icaclsFn
	icaclsFn = func(args ...string) (string, error) {
		calls = append(calls, args)
		if fail && args[1] != "/setowner" {
			return "denied", errors.New("exit status 5")
		}
		return "processed", nil
	}
	t.Cleanup(func() { icaclsFn = oldI })
	var logged []string
	logf := func(s string) { logged = append(logged, s) }
	if !foldersAfterUpdate(exeDir, logf) {
		t.Fatalf("the folder step did not run at the first start:\n%s", strings.Join(logged, "\n"))
	}
	fc := filepath.Join(pd, "FinCom")
	for _, d := range []string{fc, filepath.Join(fc, "recorder"), filepath.Join(fc, "addon")} {
		fi, err := os.Lstat(d)
		if err != nil || !fi.IsDir() || fi.Mode()&os.ModeSymlink != 0 {
			t.Fatalf("%s is not a plain folder after the first start: %v %v", d, fi, err)
		}
	}
	if m, _ := filepath.Glob(filepath.Join(pd, "FinCom.moved-*")); len(m) != 1 {
		t.Fatalf("the link at FinCom was not moved aside: %v", m)
	}
	if len(calls) == 0 {
		t.Fatal("no permissions set at the first start")
	}
	marker := filepath.Join(exeDir, foldersMarkerName)
	if strings.TrimSpace(readText(marker)) != BridgeVersion {
		t.Fatalf("the marker: %q", readText(marker))
	}
	// the next start of the same version: nothing done
	calls = nil
	if foldersAfterUpdate(exeDir, logf) || len(calls) != 0 {
		t.Fatalf("the folder step ran again at a later start of the same version (%d icacls)", len(calls))
	}
	// a marker of the version before (2.1.8 -> 2.1.9): runs again
	_ = os.WriteFile(marker, []byte("2.1.8"), 0o644)
	if !foldersAfterUpdate(exeDir, logf) || len(calls) == 0 {
		t.Fatal("the folder step did not run after an update")
	}
	// a step that fails leaves the marker unwritten: tried again at the next start
	_ = os.Remove(marker)
	fail = true
	foldersAfterUpdate(exeDir, logf)
	if exists(marker) {
		t.Fatal("the marker was written although the folder step failed")
	}
	fail = false
	if !foldersAfterUpdate(exeDir, logf) || !exists(marker) {
		t.Fatal("not tried again after a failure")
	}
	// the service calls it at its start
	if !strings.Contains(readText("win_service.go"), "foldersAfterUpdate(") {
		t.Fatal("the service does not run the folder step after an update")
	}
}

// --- Low 2: saveFile never leaves the file missing: a rename refused (an antivirus holding the file) keeps the old file
// as it was, and no temporary file is left behind
func TestStartPointSaveNeverLosesFile(t *testing.T) {
	d := t.TempDir()
	p := filepath.Join(d, "start-point.json")
	_ = os.WriteFile(p, []byte(`{"a":1}`), 0o644)
	old := renameFn
	t.Cleanup(func() { renameFn = old })
	renameFn = func(a, b string) error { return errors.New("the file is held by another program") }
	if err := saveFile(p, `{"b":2}`); err == nil {
		t.Fatal("saveFile said it saved although the rename was refused")
	}
	if got := readText(p); got != `{"a":1}` {
		t.Fatalf("the file after a refused rename: %q (want the old content)", got)
	}
	if m, _ := filepath.Glob(filepath.Join(d, "*.tmp")); len(m) != 0 {
		t.Fatalf("temporary files left: %v", m)
	}
	renameFn = old
	if err := saveFile(p, `{"b":2}`); err != nil || readText(p) != `{"b":2}` {
		t.Fatalf("saveFile: %v %q", err, readText(p))
	}
	if strings.Contains(funcSource(t, "util.go", "saveFile"), "os.Remove(path)") {
		t.Fatal("saveFile still removes the file before the rename")
	}
}

// --- Low 2: while start-point.json cannot be read, the first-seen numbers are kept (not the later, higher ones) and
// recorded when the file can be read again (repaired by the owner, or removed); the beat carries them meanwhile
func TestStartPointPendingKeepsFirstNumbers(t *testing.T) {
	for _, repair := range []string{"fixed", "removed"} {
		t.Run(repair, func(t *testing.T) {
			td := today()
			f := newStandTally(t)
			standBridge(t, f, "")
			setAlt := func(n int) {
				for len(f.vch) < n {
					f.add(td, fgParty, "PK-"+itoa(len(f.vch)), "sale", "-1.00")
				}
			}
			cut := `{"other co|g-o": {"company": "OTHER CO", "guid": "g-o", "altvchid": 5, "altmstid": 6, "at": "2026-10-01T10:00:00"`
			_ = os.WriteFile(sp("start-point.json"), []byte(cut), 0o644)
			setAlt(10)
			_, _ = companyCheck(fin, zz, f.port)
			setAlt(20)
			_, _ = companyCheck(fin, zz, f.port)
			if got := readText(sp("start-point.json")); got != cut {
				t.Fatalf("an unreadable start-point.json was rewritten:\n%s", got)
			}
			if b := obj(startPointBeat()[zz]); toI64(b["altvchid"]) != 10 {
				t.Fatalf("the beat while the file cannot be read: %v (want the first-seen 10)", b)
			}
			if repair == "fixed" {
				_ = os.WriteFile(sp("start-point.json"), []byte(cut+"}}"), 0o644)
			} else {
				_ = os.Remove(sp("start-point.json"))
			}
			setAlt(30)
			_, _ = companyCheck(fin, zz, f.port)
			var e M
			for _, v := range readObjFile(sp("start-point.json")) {
				if x := obj(v); str(x["company"]) == zz {
					e = x
				}
			}
			if toI64(e["altvchid"]) != 10 {
				t.Fatalf("ZZ TEST recorded at %v once the file could be read (want the first-seen 10)", e["altvchid"])
			}
			if repair == "fixed" && toI64(obj(readObjFile(sp("start-point.json"))["other co|g-o"])["altvchid"]) != 5 {
				t.Fatal("OTHER CO's starting point lost")
			}
			if v, ok := startPointOf(zz); !ok || v != 10 {
				t.Fatalf("startPointOf: %d %v", v, ok)
			}
		})
	}
}

// --- Low 3: the change numbers' file: a link (or a second name) planted at its place is not appended through
func TestChangeNumbersAppendNoFollow(t *testing.T) {
	d := t.TempDir()
	victim := filepath.Join(t.TempDir(), "victim.txt")
	_ = os.WriteFile(victim, []byte("not to be touched\n"), 0o644)
	p := filepath.Join(d, "recorder-changenumbers.txt")
	if err := os.Symlink(victim, p); err != nil {
		t.Skip("no symlinks here: " + err.Error())
	}
	if err := appendNoFollow(p, "x\r\n"); err == nil {
		t.Fatal("appended through a link")
	}
	if readText(victim) != "not to be touched\n" {
		t.Fatal("the link's target was written")
	}
	_ = os.Remove(p)
	if err := os.Link(victim, p); err == nil {
		if err := appendNoFollow(p, "x\r\n"); err == nil || readText(victim) != "not to be touched\n" {
			t.Fatalf("appended through a hard link: %v", err)
		}
		_ = os.Remove(p)
	}
	if err := appendNoFollow(p, "a\r\n"); err != nil {
		t.Fatal(err)
	}
	if err := appendNoFollow(p, "b\r\n"); err != nil || readText(p) != "a\r\nb\r\n" {
		t.Fatalf("a plain file: %v %q", err, readText(p))
	}
	if !strings.Contains(funcSource(t, "recorder.go", "recorderNoteChangeNumbers"), "appendNoFollow(") {
		t.Fatal("note change numbers does not use appendNoFollow")
	}
}

// --- Low 4: the bench is not a person's request: a dated request through benchTC is refused with ReadDays off; the
// sheets say the bench journals are test entries in the company tested on, which stays linked to its FinCom client
func TestBenchNotPerson(t *testing.T) {
	f := newStandTally(t)
	standBridge(t, f, `,"ReadDays":false`)
	if benchTC.person || !benchTC.bench {
		t.Fatalf("benchTC: %+v (want bench only)", *benchTC)
	}
	if datedRefused(benchTC, "<SVFROMDATE>20260401</SVFROMDATE>") == nil {
		t.Fatal("a dated request through benchTC passes with ReadDays off")
	}
	// round 21 (2.1.10): the sheets name no company: the company tested on stays linked to its FinCom client, and the
	// bench's journals are TRIAL test entries in it
	for _, f := range []string{"../docs/bridge-2.1.10-test-sheet.txt", "../docs/recorder-trial-sheet.txt"} {
		txt := strings.Join(strings.Fields(readText(f)), " ")
		if !strings.Contains(txt, "the company you test on (it must be linked to a FinCom client)") || !strings.Contains(txt, "test entries in the company you test on") || strings.Contains(txt, "must not be linked") {
			t.Fatalf("%s: the bench's wording on the company's link is not the agreed one", f)
		}
	}
}

// --- Low 5: each folder's permissions reset first (icacls /reset /L: any explicit entry an administrator added is
// dropped), then set; the exact argument lists
func TestFolderACLResetFirst(t *testing.T) {
	base := t.TempDir()
	var calls []string
	oldI := icaclsFn
	icaclsFn = func(args ...string) (string, error) {
		calls = append(calls, strings.Join(args, " "))
		return "processed", nil
	}
	t.Cleanup(func() { icaclsFn = oldI })
	if _, err := prepareFinComFolders(base, true); err != nil {
		t.Fatal(err)
	}
	fc := filepath.Join(base, "FinCom")
	rec, add := filepath.Join(fc, "recorder"), filepath.Join(fc, "addon")
	want := []string{
		fc + " /reset /L /Q",
		fc + " /inheritance:r /grant:r *S-1-5-18:(OI)(CI)F *S-1-5-32-544:(OI)(CI)F *S-1-5-32-545:(OI)(CI)RX /L /Q",
		fc + " /setowner *S-1-5-32-544 /L /Q",
		rec + " /reset /L /Q",
		rec + " /inheritance:r /grant:r *S-1-5-18:(OI)(CI)F *S-1-5-32-544:(OI)(CI)F *S-1-5-32-545:(RX,WD) /L /Q",
		rec + " /grant *S-1-5-32-545:(OI)(IO)M /L /Q",
		rec + " /setowner *S-1-5-32-544 /L /Q",
		add + " /reset /L /Q",
		add + " /inheritance:r /grant:r *S-1-5-18:(OI)(CI)F *S-1-5-32-544:(OI)(CI)F *S-1-5-32-545:(OI)(CI)RX /L /Q",
		add + " /setowner *S-1-5-32-544 /L /Q",
	}
	if strings.Join(calls, "\n") != strings.Join(want, "\n") {
		t.Fatalf("icacls calls:\n%s\nwant:\n%s", strings.Join(calls, "\n"), strings.Join(want, "\n"))
	}
	// a /reset that fails stops the step (the grants are not set on a folder whose old entries stay)
	calls = nil
	icaclsFn = func(args ...string) (string, error) {
		calls = append(calls, strings.Join(args, " "))
		if args[1] == "/reset" {
			return "denied", errors.New("exit status 5")
		}
		return "processed", nil
	}
	if _, err := prepareFinComFolders(base, true); err == nil {
		t.Fatalf("a failed /reset did not stop the step: %v", calls)
	}
}

// --- Low 6: the Windows workflow checks, as fctest (not an administrator), that a file can be made and appended in
// recorder\, and that the folder cannot be deleted, renamed or given a subfolder, and addon\ and FinCom\ not written
func TestWorkflowChecksRecorderAsUser(t *testing.T) {
	y := readText("../.github/workflows/bridge-windows.yml")
	i := strings.Index(y, "As fctest, the recorder folder")
	if i < 0 {
		t.Fatal("no step checks the recorder folder as fctest")
	}
	step := y[i:]
	if j := strings.Index(step, "\n      - name:"); j > 0 {
		step = step[:j]
	}
	for _, want := range []string{"Invoke-AsTest", "'create'", "'append'", "'deleteFolder'", "'renameFolder'", "'subfolder'", "'writeAddon'", "'writeFinCom'"} {
		if !strings.Contains(step, want) {
			t.Fatalf("the step lacks %s", want)
		}
	}
}

// the source text of a function in one of the bridge's files
func funcSource(t *testing.T, file, name string) string {
	t.Helper()
	src := readText(file)
	fset := token.NewFileSet()
	af, err := parser.ParseFile(fset, file, src, 0)
	if err != nil {
		t.Fatal(err)
	}
	for _, d := range af.Decls {
		if fd, ok := d.(*ast.FuncDecl); ok && fd.Name.Name == name {
			return src[fset.Position(fd.Pos()).Offset:fset.Position(fd.End()).Offset]
		}
	}
	t.Fatalf("%s has no func %s", file, name)
	return ""
}
