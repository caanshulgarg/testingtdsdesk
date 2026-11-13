package main

// FinCom Bridge 2.5.16, item 3: each Windows user's own. The recorder folder's files are each their maker's only (no
// other user may read or change them), and FinCom's add-on line is added only to a tally.ini one person uses: on a
// computer several people use the file is left as it is and the words say what the user does instead. Nothing here
// asks anything of Tally. Made-up names only.
import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// the recorder folder: Users may list it and add files to it; each file is its maker's (CREATOR OWNER), and the files
// already there take that again
func TestR2516RecorderFilesPrivate(t *testing.T) {
	base := t.TempDir()
	var calls []string
	oldI := icaclsFn
	icaclsFn = func(args ...string) (string, error) {
		calls = append(calls, strings.Join(args, " "))
		return "processed", nil
	}
	t.Cleanup(func() { icaclsFn = oldI })
	rec := filepath.Join(base, "FinCom", "recorder")
	_ = os.MkdirAll(rec, 0o755)
	_ = os.WriteFile(filepath.Join(rec, "guid-20261113-made-up-a.txt"), []byte("x"), 0o644)
	if _, err := prepareFinComFolders(base, true); err != nil {
		t.Fatal(err)
	}
	var mine []string
	for _, c := range calls {
		if strings.HasPrefix(c, rec+" ") || strings.HasPrefix(c, filepath.Join(rec, "*")+" ") {
			mine = append(mine, c)
		}
	}
	all := strings.Join(mine, "\n")
	if !strings.Contains(all, rec+" /grant *S-1-3-0:(OI)(IO)M /L /Q") || !strings.Contains(all, filepath.Join(rec, "*")+" /reset /L /Q") {
		t.Fatalf("recorder permissions:\n%s", all)
	}
	for _, c := range mine {
		for _, a := range strings.Fields(c) {
			if strings.HasPrefix(a, "*S-1-5-32-545:") && a != "*S-1-5-32-545:(RX,WD)" {
				t.Fatalf("Users are given %s on the recorder's files: %s", a, c)
			}
		}
	}
}

// a tally.ini every user of the computer shares: FinCom's add-on line is not added, nothing is written, and the words
// say what to do; a tally.ini one person uses gets it as before
func TestR2516SharedIniNoAddon(t *testing.T) {
	f := newStandTally(t)
	standBridge(t, f, "")
	orig := "[Tally]\r\nUser TDL = Yes\r\nClient Server = None\r\n"
	_, p := r253Ini(t, orig)
	old := iniSharedFn
	iniSharedFn = func() bool { return true }
	t.Cleanup(func() { iniSharedFn = old })
	e, err := tallyIniApply(p, addonIniPath())
	if err != nil || str(e["state"]) != iniStateShared || !strings.Contains(str(e["why"]), "load it in your own Tally") || str(e["connect"]) != connectSharedOff {
		t.Fatalf("shared: %v %v", e, err)
	}
	if got := r253Read(t, p); got != orig {
		t.Fatalf("the shared file was changed:\n%s", got)
	}
	if _, err := os.Stat(p + ".fincom-bak"); err == nil {
		t.Fatal("a backup was made though nothing was written")
	}
	// the step's log says it, and the read-only look again reports it the same way
	var lines []string
	oldD := tallyIniDirsFn
	tallyIniDirsFn = func() []string { return []string{filepath.Dir(p)} }
	t.Cleanup(func() { tallyIniDirsFn = oldD })
	tallyIniStep(func(s string) { lines = append(lines, s) })
	if !strings.Contains(strings.Join(lines, "\n"), "add-on line is not added") || r253Read(t, p) != orig {
		t.Fatalf("step: %v", lines)
	}
	iniSt.mu.Lock()
	iniSt.rechecked = iniSt.rechecked.AddDate(-1, 0, 0)
	iniSt.mu.Unlock()
	tallyIniRecheckDue()
	for _, x := range tallyIniBeat() {
		if str(obj(x)["path"]) == p && str(obj(x)["state"]) != iniStateShared {
			t.Fatalf("looked at again: %v", x)
		}
	}
	// one person's computer: the line is added, as before
	iniSharedFn = func() bool { return false }
	e, err = tallyIniApply(p, addonIniPath())
	if err != nil || str(e["state"]) != "added" || !strings.Contains(r253Read(t, p), "FinComRecorder.tdl") {
		t.Fatalf("one person's computer: %v %v", e, err)
	}
}

// the owner's rule: a tally.ini in TallyPrime's program folder (beside tally.exe, or under Program Files) is shared
// even when one person is signed in: never written, neither the add-on line nor the connection settings
func TestR2516ProgramFolderIniNeverWritten(t *testing.T) {
	f := newStandTally(t)
	standBridge(t, f, "")
	orig := "[Tally]\r\nUser TDL = Yes\r\nClient Server = None\r\n"
	d, p := r253Ini(t, orig)
	old := iniSharedFn
	iniSharedFn = func() bool { return false } // one person signed in
	t.Cleanup(func() { iniSharedFn = old })
	_ = os.WriteFile(filepath.Join(d, "tally.exe"), []byte("stand-in"), 0o644)
	e, err := tallyIniApply(p, addonIniPath())
	if err != nil || str(e["state"]) != iniStateShared || str(e["connect"]) == connectEnabled || r253Read(t, p) != orig {
		t.Fatalf("beside tally.exe: %v %v\n%s", e, err, r253Read(t, p))
	}
	_ = os.Remove(filepath.Join(d, "tally.exe"))
	t.Setenv("ProgramFiles", filepath.Dir(d))
	if e, _ := tallyIniApply(p, addonIniPath()); str(e["state"]) != iniStateShared || r253Read(t, p) != orig {
		t.Fatalf("under Program Files: %v", e)
	}
	if _, err := os.Stat(p + ".fincom-bak"); err == nil {
		t.Fatal("a backup was made though nothing was written")
	}
	if !iniInProgramFolder(p) || iniInProgramFolder(filepath.Join(t.TempDir(), "tally.ini")) {
		t.Fatal("iniInProgramFolder")
	}
}

// failed.txt is made by the folder step for every user: they may add to it, not read it
func TestR2516FailedTxtSharedWriteOnly(t *testing.T) {
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
	f := filepath.Join(base, "FinCom", "recorder", "failed.txt")
	if fi, err := os.Lstat(f); err != nil || !fi.Mode().IsRegular() {
		t.Fatal("failed.txt not made")
	}
	want := f + " /inheritance:r /grant:r *S-1-5-18:F *S-1-5-32-544:F *S-1-5-32-545:(W) /L /Q"
	all := strings.Join(calls, "\n")
	if !strings.Contains(all, want) || strings.Index(all, want) < strings.Index(all, "/reset /L /Q") {
		t.Fatalf("icacls calls:\n%s", all)
	}
}

// a recorder file is a user's only when that user owns it; another user's file without a user name is not read by a
// bridge for one user, and that is said
func TestR2516RecorderFileOwner(t *testing.T) {
	dir := t.TempDir()
	r2515LogHere(t, dir)
	owners := map[string]string{}
	oldO, oldU, oldM := fileOwnerFn, liveWinUserFn, runMode
	t.Cleanup(func() { fileOwnerFn, liveWinUserFn, runMode = oldO, oldU, oldM })
	fileOwnerFn = func(p string) string { return owners[filepath.Base(p)] }
	liveWinUserFn = func() string { return `PC-MADEUP\made-up-a` }
	runMode = "user"
	mine := "co-guid-1-20261113-made-up-a.txt"
	owners[mine] = `PC-MADEUP\made-up-a`
	if !liveFileTrusted(filepath.Join(dir, mine)) {
		t.Fatal("the user's own file")
	}
	owners[mine] = `PC-MADEUP\made-up-b`
	if liveFileTrusted(filepath.Join(dir, mine)) {
		t.Fatal("a file named for this user but owned by another was read")
	}
	old := "co-guid-1-20261113.txt"
	owners[old] = `PC-MADEUP\made-up-b`
	if liveFileTrusted(filepath.Join(dir, old)) || !strings.Contains(readText(logFile()), "no Windows user in its name and is another user's") {
		t.Fatal("another user's file without a user name")
	}
	owners["failed.txt"] = `BUILTIN\Administrators`
	if liveFileTrusted(filepath.Join(dir, "failed.txt")) || !strings.Contains(readText(logFile()), "failed.txt (lines a Tally could not write)") {
		t.Fatal("failed.txt for one user's bridge")
	}
	runMode = "service" // reads every file, each user's only when owned by that user
	if !liveFileTrusted(filepath.Join(dir, old)) || !liveFileTrusted(filepath.Join(dir, "failed.txt")) || liveFileTrusted(filepath.Join(dir, mine)) {
		t.Fatal("the service's look")
	}
	delete(owners, mine) // the owner not known (not Windows): by its name, as before
	if !liveFileTrusted(filepath.Join(dir, mine)) {
		t.Fatal("owner not known")
	}
}
