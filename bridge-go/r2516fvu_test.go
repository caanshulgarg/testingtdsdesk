package main

// FinCom Bridge 2.5.16, item 1: the FVU from this computer's own settings. Where the FVU is and where its output goes
// are this computer's settings (a request's own paths are not used), the FVU file's fingerprint is confirmed by the
// owner and checked before every run, network paths are not used, and under the service Java is never run by the
// service itself. Nothing here asks anything of Tally. Made-up names only; a stand-in java (a shell script).
import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

// the settings and log in the test's folder; a stand-in FVU file and java that records what it was given
func r2516FvuHere(t *testing.T) (dir, jar, javaLog string) {
	if runtime.GOOS == "windows" {
		t.Skip("the stand-in java is a shell script")
	}
	dir = t.TempDir()
	r2515LogHere(t, dir)
	jar = filepath.Join(dir, "fvu", "FVU_STANDALONE.jar")
	_ = os.MkdirAll(filepath.Dir(jar), 0o755)
	_ = os.WriteFile(jar, []byte("stand-in FVU 1"), 0o644)
	javaLog = filepath.Join(dir, "java-args.txt")
	java := filepath.Join(dir, "jre", "java")
	_ = os.MkdirAll(filepath.Dir(java), 0o755)
	_ = os.WriteFile(java, []byte("#!/bin/sh\necho \"$@\" >> '"+javaLog+"'\necho made > \"$5/return.fvu\"\n"), 0o755)
	setCfg("FvuJar", jar)
	setCfg("FvuOut", filepath.Join(dir, "out"))
	setCfg("JavaExe", java)
	setCfg("FvuJarSha256", "")
	was := runMode
	runMode = "window"
	t.Cleanup(func() { runMode = was })
	return
}

func r2516Confirm(t *testing.T) {
	g, _ := trayFvuRoute("GET", nil)
	if g["ok"] != true || str(g["sha256"]) == "" || g["confirmed"] == true {
		t.Fatalf("the tray's look: %v", g)
	}
	p, _ := trayFvuRoute("POST", M{"sha256": g["sha256"]})
	if p["ok"] != true || cfgS("FvuJarSha256") != str(g["sha256"]) {
		t.Fatalf("confirm: %v", p)
	}
}

// the FVU file and output folder are this computer's settings; the request's own are not used
func TestR2516FvuUsesLocalSettings(t *testing.T) {
	dir, jar, javaLog := r2516FvuHere(t)
	r2516Confirm(t)
	other := filepath.Join(dir, "elsewhere", "Other.jar")
	_ = os.MkdirAll(filepath.Dir(other), 0o755)
	_ = os.WriteFile(other, []byte("another program"), 0o644)
	r := invokeFvu(M{"text": "FH^NS^R", "name": "26Q_Q1.txt", "fvuJar": other, "outDir": filepath.Join(dir, "elsewhere"), "javaExe": "/bin/sh"})
	if r["ok"] != true || r["accepted"] != true {
		t.Fatalf("the run: %v", r)
	}
	args := readText(javaLog)
	if !strings.Contains(args, "-jar "+jar+" ") || strings.Contains(args, other) {
		t.Fatalf("java was given %q", args)
	}
	if !strings.HasPrefix(str(r["folder"]), filepath.Join(dir, "out")+string(os.PathSeparator)) || !strings.HasSuffix(str(r["input"]), "26Q_Q1.txt") {
		t.Fatalf("the run's folder %v", r["folder"])
	}
	if m, _ := filepath.Glob(filepath.Join(dir, "elsewhere", "*")); len(m) != 1 {
		t.Fatalf("something was written in the request's folder: %v", m)
	}
}

// not run until the owner confirms the file; a file changed since is not run until confirmed again
func TestR2516FvuJarFingerprint(t *testing.T) {
	_, jar, javaLog := r2516FvuHere(t)
	r := invokeFvu(M{"text": "FH^NS^R", "name": "a.txt"})
	if r["ok"] == true || r["needConfirm"] != true || !strings.Contains(str(r["errors"]), "Confirm the FVU...") || exists(javaLog) {
		t.Fatalf("not confirmed yet: %v", r)
	}
	r2516Confirm(t)
	if r := invokeFvu(M{"text": "FH^NS^R", "name": "a.txt"}); r["accepted"] != true {
		t.Fatalf("confirmed: %v", r)
	}
	_ = os.WriteFile(jar, []byte("stand-in FVU 2"), 0o644)
	n := strings.Count(readText(javaLog), "\n")
	r = invokeFvu(M{"text": "FH^NS^R", "name": "a.txt"})
	if r["ok"] == true || r["changed"] != true || strings.Count(readText(javaLog), "\n") != n {
		t.Fatalf("changed since confirmed: %v", r)
	}
	if g, _ := trayFvuRoute("GET", nil); g["confirmed"] == true || g["pinned"] != true {
		t.Fatalf("the tray's look after a change: %v", g)
	}
	// a confirmation for a fingerprint that is not the file's now is not taken
	if p, _ := trayFvuRoute("POST", M{"sha256": strings.Repeat("0", 64)}); p["ok"] == true {
		t.Fatalf("a stale confirmation was taken: %v", p)
	}
	r2516Confirm(t)
	if r := invokeFvu(M{"text": "FH^NS^R", "name": "a.txt"}); r["accepted"] != true {
		t.Fatalf("confirmed again: %v", r)
	}
}

// network paths are not used, for the FVU, its output folder, the CSI file or java
func TestR2516FvuLocalPathsOnly(t *testing.T) {
	dir, _, javaLog := r2516FvuHere(t)
	r2516Confirm(t)
	for _, p := range []string{`\\server\share\FVU.jar`, "//server/share/FVU.jar", `\\?\UNC\server\share\FVU.jar`, "fvu/FVU.jar"} {
		setCfg("FvuJar", p)
		if r := invokeFvu(M{"text": "x", "name": "a.txt"}); r["ok"] == true {
			t.Fatalf("FvuJar %s was used: %v", p, r)
		}
	}
	jar := filepath.Join(dir, "fvu", "FVU_STANDALONE.jar")
	setCfg("FvuJar", jar)
	setCfg("FvuOut", `\\server\share\out`)
	if r := invokeFvu(M{"text": "x", "name": "a.txt"}); r["ok"] == true {
		t.Fatalf("a network output folder was used: %v", r)
	}
	setCfg("FvuOut", filepath.Join(dir, "out"))
	for _, c := range []string{`\\server\share\a.csi`, "//server/share/a.csi", filepath.Join(dir, "fvu", "FVU_STANDALONE.jar"), filepath.Join(dir, "none.csi")} {
		if r := invokeFvu(M{"text": "x", "name": "a.txt", "csi": c}); r["ok"] == true {
			t.Fatalf("CSI %s was used: %v", c, r)
		}
	}
	csi := filepath.Join(dir, "q1.csi")
	_ = os.WriteFile(csi, []byte("csi"), 0o644)
	if r := invokeFvu(M{"text": "x", "name": "a.txt", "csi": csi}); r["accepted"] != true || !strings.Contains(readText(javaLog), csi) {
		t.Fatalf("a local CSI file: %v", r)
	}
	// a link that leads to a network path by its spelling is not followed there
	ln := filepath.Join(dir, "lnk.jar")
	if os.Symlink("//server/share/FVU.jar", ln) == nil {
		setCfg("FvuJar", ln)
		if r := invokeFvu(M{"text": "x", "name": "a.txt"}); r["ok"] == true {
			t.Fatalf("a link to a network path was used: %v", r)
		}
	}
	setCfg("FvuJar", jar)
	setCfg("JavaExe", "//server/share/java")
	if r := invokeFvu(M{"text": "x", "name": "a.txt"}); r["ok"] == true {
		t.Fatalf("a network java was used: %v", r)
	}
	if !netSpelling(`\\a\b`) || !netSpelling("//a/b") || netSpelling(`C:\FVU\x.jar`) || netSpelling("/home/x.jar") {
		t.Fatal("netSpelling")
	}
}

// under the service the run is handed to the owner's session; the service never starts java itself
func TestR2516FvuNotAsService(t *testing.T) {
	_, _, javaLog := r2516FvuHere(t)
	r2516Confirm(t)
	runMode = "service"
	var handed fvuReq
	old := fvuRunAsOwnerFn
	t.Cleanup(func() { fvuRunAsOwnerFn = old })
	fvuRunAsOwnerFn = func(q fvuReq) M { handed = q; return M{"ok": false, "needSignIn": true, "error": "sign in (stand-in)"} }
	r := invokeFvu(M{"text": "FH^NS^R", "name": "a.txt"})
	if r["ok"] == true || r["needSignIn"] != true || exists(javaLog) || handed.Jar == "" || handed.Sha == "" || handed.Text != "FH^NS^R" {
		t.Fatalf("under the service: %v, handed %+v", r, handed)
	}
	// the platform's own hand-over on this system refuses rather than run java here
	fvuRunAsOwnerFn = old
	if r := invokeFvu(M{"text": "FH^NS^R", "name": "a.txt"}); r["ok"] == true || exists(javaLog) {
		t.Fatalf("the platform hand-over: %v", r)
	}
	// fvu-run's own run (as the owner) checks the file again
	runMode = "window"
	handed.Sha = strings.Repeat("1", 64)
	if r := fvuRun(handed); r["ok"] == true || exists(javaLog) {
		t.Fatalf("fvu-run with another fingerprint: %v", r)
	}
}
