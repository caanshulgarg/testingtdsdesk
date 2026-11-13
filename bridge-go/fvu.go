// FinCom Bridge 2.5.16: the FVU (Protean's File Validation Utility) run on this computer, from this computer's own
// settings only.
//
//   - Where the FVU is and where its output goes come only from the bridge's settings on this computer (FvuJar, FvuOut;
//     standard: <the owner's profile>\TDS-Desk\FVU\FVU_STANDALONE.jar and ...\FVU\out). A request names only the return
//     file's text and name (and, as before, the CSI file the person chose); any other path in a request is not used.
//   - The FVU file's SHA-256 is recorded on this computer when the owner confirms it in the tray icon (Confirm the
//     FVU...); a file that is not confirmed, or that changed since, is not run, and the words say what to do.
//   - Every path is a local one (never a network or \\?\ path, nor one that leads to one), looked at after its links are
//     resolved.
//   - Java runs as the Windows user the bridge works for, never as Windows itself (SYSTEM): under the service the run is
//     handed to a program of the bridge's own started in the owner's signed-in session with the owner's rights
//     (FinComBridge.exe fvu-run, the request on its input, the answer on its output); with no one signed in, the run is
//     refused with the reason.
package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

// the settings' FVU file, else the standard place
func fvuJarPath() string {
	if p := strings.TrimSpace(cfgS("FvuJar")); p != "" {
		return p
	}
	return filepath.Join(ownerProfile(), "TDS-Desk", "FVU", "FVU_STANDALONE.jar")
}

// the settings' output folder, else the standard place
func fvuOutPath() string {
	if p := strings.TrimSpace(cfgS("FvuOut")); p != "" {
		return p
	}
	return filepath.Join(ownerProfile(), "TDS-Desk", "FVU", "out")
}

// a network path by its spelling: \\server\share, //server/share, \\?\ and \\.\ (Windows' own prefixes)
func netSpelling(p string) bool {
	p = strings.TrimSpace(p)
	return strings.HasPrefix(p, `\\`) || strings.HasPrefix(p, "//") || strings.HasPrefix(p, `\/`) || strings.HasPrefix(p, `/\`)
}

// a path on this computer: absolute, not a network path by its spelling nor once its links are resolved (on Windows also
// not on a network drive: platRemotePath). The resolved path is given back; a path that does not exist yet is resolved
// by its nearest folder that does
func localPath(p string) (string, error) {
	p = strings.TrimSpace(p)
	if p == "" {
		return "", errors.New("no path")
	}
	if netSpelling(p) || platRemotePath(p) {
		return "", errors.New(p + " is a network location; only a folder on this computer is used")
	}
	if !filepath.IsAbs(p) {
		return "", errors.New(p + " is not a full path on this computer")
	}
	p = filepath.Clean(p)
	rest := ""
	cur := p
	for i := 0; i < 64; i++ {
		if r, err := filepath.EvalSymlinks(cur); err == nil {
			full := r
			if rest != "" {
				full = filepath.Join(r, rest)
			}
			if netSpelling(full) || platRemotePath(full) {
				return "", errors.New(p + " leads to a network location; only a folder on this computer is used")
			}
			return full, nil
		}
		up := filepath.Dir(cur)
		if up == cur {
			break
		}
		rest = filepath.Join(filepath.Base(cur), rest)
		cur = up
	}
	return "", errors.New(p + " could not be looked at")
}

// the SHA-256 of a regular file (lower-case hex)
func fvuFileSHA256(p string) (string, error) {
	fi, err := os.Stat(p)
	if err != nil {
		return "", err
	}
	if !fi.Mode().IsRegular() {
		return "", errors.New(p + " is not a file")
	}
	f, err := os.Open(p)
	if err != nil {
		return "", err
	}
	defer f.Close()
	h := sha256.New()
	if _, err := io.Copy(h, io.LimitReader(f, 512<<20)); err != nil {
		return "", err
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}

// the FVU file as this computer's settings name it: its resolved path and fingerprint, or why it cannot be used
func fvuJarLooked() (path, sha string, err error) {
	raw := fvuJarPath()
	if !strings.HasSuffix(strings.ToLower(raw), ".jar") {
		return raw, "", errors.New("The FVU set on this computer (" + raw + ") is not a .jar file.")
	}
	p, lerr := localPath(raw)
	if lerr != nil {
		return raw, "", errors.New("The FVU is not used from " + raw + ": " + lerr.Error() + ".")
	}
	if !exists(p) {
		return p, "", errors.New("The FVU was not found at " + p + ". Install Protean's FVU there (or set FvuJar in the bridge's settings on this computer), then confirm it in the FinCom Bridge icon near the clock (Confirm the FVU...).")
	}
	s, herr := fvuFileSHA256(p)
	if herr != nil {
		return p, "", errors.New("The FVU at " + p + " could not be read: " + herr.Error())
	}
	return p, s, nil
}

// the request handed to the run (here, or to fvu-run in the owner's session)
type fvuReq struct {
	Jar  string `json:"jar"`
	Sha  string `json:"sha"`
	Out  string `json:"out"`
	Java string `json:"java"`
	Csi  string `json:"csi"`
	Name string `json:"name"`
	Text string `json:"text"`
}

// POST /fvu {text, name, csi}: the return file checked by the FVU set and confirmed on this computer. FinCom shows the
// FVU's errors: the reason a file was not run is given there too
func invokeFvu(o M) M {
	res := fvuAsked(o)
	if res["ok"] != true && str(res["errors"]) == "" {
		res["errors"] = res["error"]
	}
	return res
}

func fvuAsked(o M) M {
	text := str(o["text"])
	if text == "" {
		return M{"ok": false, "error": "The return file is empty."}
	}
	name := filepath.Base(str(o["name"]))
	if !re(`^[\w .()-]+\.txt$`).MatchString(name) {
		name = "return.txt"
	}
	jar, sha, err := fvuJarLooked()
	if err != nil {
		return M{"ok": false, "error": err.Error()}
	}
	pin := strings.ToLower(strings.TrimSpace(cfgS("FvuJarSha256")))
	if pin == "" {
		return M{"ok": false, "needConfirm": true, "error": "One step first: right-click the FinCom Bridge icon near the clock, choose Confirm the FVU..., and say Yes for " + jar + ". Then try Check with FVU again."}
	}
	if pin != sha {
		writeLog("FVU: " + jar + " is not the file confirmed on this computer (fingerprint " + sha[:12] + "..., confirmed " + cutRunes(pin, 12) + "...): not run")
		return M{"ok": false, "changed": true, "error": "The FVU file " + jar + " has changed since it was allowed (a new FVU version?). Right-click the FinCom Bridge icon near the clock, choose Confirm the FVU..., say Yes, then try again."}
	}
	out, err := localPath(fvuOutPath())
	if err != nil {
		return M{"ok": false, "error": "The FVU's output folder is not used: " + err.Error() + "."}
	}
	csi := ""
	if c := strings.TrimSpace(str(o["csi"])); c != "" {
		lc, cerr := localPath(c)
		if cerr != nil || !strings.HasSuffix(strings.ToLower(lc), ".csi") {
			return M{"ok": false, "error": "The CSI file is not used: it must be a .csi file on this computer (" + c + ")."}
		}
		if fi, serr := os.Stat(lc); serr != nil || !fi.Mode().IsRegular() {
			return M{"ok": false, "error": "The CSI file was not found on this computer (" + c + ")."}
		}
		csi = lc
	}
	req := fvuReq{Jar: jar, Sha: sha, Out: out, Java: strings.TrimSpace(cfgS("JavaExe")), Csi: csi, Name: name, Text: text}
	var res M
	if runMode == "service" {
		res = fvuRunAsOwnerFn(req)
	} else {
		res = fvuRun(req)
	}
	st := "errors"
	if truthy(res["accepted"]) {
		st = "accepted"
	} else if res["ok"] != true {
		st = "not run: " + str(res["error"])
	}
	writeLog("FVU run on " + name + ": " + st)
	return res
}

// java: the settings' JavaExe when it is a local java program, else the one on this user's PATH; a local path only
func fvuJava(set string) (string, error) {
	j := set
	if j == "" {
		lp, err := exec.LookPath("java")
		if err != nil {
			return "", errors.New("Java is not installed on this computer. The FVU needs Java to run.")
		}
		j = lp
	}
	if b := strings.ToLower(filepath.Base(j)); b != "java" && b != "java.exe" && b != "javaw.exe" {
		return "", errors.New("JavaExe in the bridge's settings must name java.exe")
	}
	p, err := localPath(j)
	if err != nil || !filepath.IsAbs(p) || !exists(p) {
		return "", errors.New("Java is not used from " + j + " (a program on this computer only).")
	}
	return p, nil
}

// the run itself, as the Windows user the bridge works for: the FVU file checked again, a new folder for this run
// under the output folder, the return file in it, Java for three minutes at most
func fvuRun(q fvuReq) M {
	if s, err := fvuFileSHA256(q.Jar); err != nil || s != q.Sha {
		return M{"ok": false, "changed": true, "error": "The FVU at " + q.Jar + " changed while it was being started; not run."}
	}
	java, err := fvuJava(q.Java)
	if err != nil {
		return M{"ok": false, "error": err.Error()}
	}
	if err := os.MkdirAll(q.Out, 0o755); err != nil {
		return M{"ok": false, "error": "The FVU's output folder " + q.Out + " could not be made: " + err.Error()}
	}
	if out, err := localPath(q.Out); err != nil || !strings.EqualFold(filepath.Clean(out), filepath.Clean(q.Out)) {
		return M{"ok": false, "error": "The FVU's output folder " + q.Out + " changed while it was being made; not run."}
	}
	runDir := filepath.Join(q.Out, time.Now().Format("20060102-150405.000")+"-"+newUUID()[:6])
	if err := os.Mkdir(runDir, 0o755); err != nil {
		return M{"ok": false, "error": "The FVU's folder for this run could not be made: " + err.Error()}
	}
	in := filepath.Join(runDir, q.Name)
	if err := writeFresh(in, []byte(q.Text)); err != nil {
		return M{"ok": false, "error": "The return file could not be written for the FVU: " + err.Error()}
	}
	errFile := strings.TrimSuffix(in, filepath.Ext(in)) + ".err"
	args := []string{"-jar", q.Jar, in, errFile, runDir}
	if q.Csi != "" {
		args = append(args, q.Csi)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()
	cmd := exec.CommandContext(ctx, java, args...)
	cmd.Dir = runDir
	var so bytes.Buffer
	cmd.Stdout, cmd.Stderr = &so, &so
	hideWindow(cmd)
	_ = cmd.Run()
	if ctx.Err() != nil {
		return M{"ok": false, "error": "The FVU did not finish in three minutes."}
	}
	fvus, _ := filepath.Glob(filepath.Join(runDir, "*.fvu"))
	sort.Strings(fvus)
	fvu := ""
	if len(fvus) > 0 {
		fvu = fvus[len(fvus)-1]
	}
	outText := so.String()
	if len(outText) > 1<<20 {
		outText = outText[len(outText)-1<<20:]
	}
	return M{"ok": true, "accepted": fvu != "", "fvu": fvu, "errors": readText(errFile), "output": outText, "folder": runDir, "input": in}
}

// FinComBridge.exe fvu-run: started by the service in the owner's session with the owner's rights; the request on its
// input, the answer (JSON) on its output. Nothing else is read or written by it
func fvuRunCmd() int {
	var q fvuReq
	b, err := io.ReadAll(io.LimitReader(os.Stdin, 64<<20))
	if err == nil {
		err = json.Unmarshal(b, &q)
	}
	var res M
	if err != nil || q.Jar == "" || q.Out == "" || q.Name == "" {
		res = M{"ok": false, "error": "The FVU run was not asked properly."}
	} else {
		res = fvuRun(q)
	}
	_, _ = os.Stdout.WriteString(jsonText(res))
	return 0
}

// the run under the service: handed to the owner's session (platform: fvu_windows.go); a hook for the tests
var fvuRunAsOwnerFn = platFvuRunAsOwner

// GET /tray/fvu: the FVU this computer's settings name, its fingerprint and whether it is the confirmed one;
// POST /tray/fvu {sha256}: the owner confirms that file (the fingerprint shown must still be the file's)
func trayFvuRoute(method string, body M) (M, error) {
	jar, sha, err := fvuJarLooked()
	pin := strings.ToLower(strings.TrimSpace(cfgS("FvuJarSha256")))
	if method != "POST" {
		r := M{"ok": err == nil, "path": jar, "sha256": sha, "confirmed": pin != "" && pin == sha, "pinned": pin != ""}
		if err != nil {
			r["error"] = err.Error()
		}
		return r, nil
	}
	if err != nil {
		return M{"ok": false, "error": err.Error()}, nil
	}
	want := strings.ToLower(strings.TrimSpace(str(body["sha256"])))
	if want == "" || want != sha {
		return M{"ok": false, "error": "The FVU file changed while it was being confirmed; choose Confirm the FVU... again."}, nil
	}
	setCfg("FvuJarSha256", sha)
	setCfg("FvuJarConfirmedAt", nowS())
	saveConfig()
	writeLog("FVU: " + jar + " confirmed by the owner on this computer (fingerprint " + sha + ")")
	return M{"ok": true, "path": jar, "sha256": sha, "confirmed": true}, nil
}
