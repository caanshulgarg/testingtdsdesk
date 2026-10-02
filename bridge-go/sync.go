// The nightly copy (bridge 1.10): each company's day book, balances and ledgers kept in a folder, ready in the morning;
// and the FVU (Protean's File Validation Utility) run on this computer behind the bridge key.
package main

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"time"
)

// FinCom's "Fetch from Tally" (/syncnow): 2.1.5 reads only what changed (Update now for the company) and answers with
// the copy's list of months; the year is never read again, and no balance is asked of Tally
func companySync(company string, port int) (M, error) {
	if company == "" {
		return nil, errors.New("Say which company.")
	}
	wakeUpdate(company)
	until := time.Now().Add(10 * time.Minute)
	for time.Now().Before(until) && !stopping() {
		sleepOrStop(500 * time.Millisecond)
		if !keepRunning() {
			break
		}
	}
	if m := readObjFile(filepath.Join(syncFolder(company), "manifest.json")); m != nil {
		return m, nil
	}
	return nil, errors.New("The bridge has no copy of " + company + " yet; it is read at Update now or the nightly run.")
}

// the "sync" command of the old scheduled task (bridge 1.10): 2.1.5 reads nothing (it read the whole year and every
// ledger's balance each night); the running bridge's nightly run reads only what changed. The task is taken off
func nightlySync() M {
	_ = exec.Command("schtasks.exe", "/Delete", "/TN", taskName, "/F").Run()
	writeLog("The old nightly copy task is not used any more: the bridge's own nightly run reads only what changed in Tally")
	sum := M{"at": nowS(), "done": []any{}, "failed": []any{}, "retired": true}
	_ = saveFile(sp("last-run.json"), jsonText(sum))
	return sum
}

const taskName = "TDS Desk - nightly Tally copy"

func getSchedule() M {
	if runtime.GOOS != "windows" {
		return M{"ok": true, "on": false}
	}
	out, err := exec.Command("schtasks.exe", "/Query", "/TN", taskName, "/FO", "LIST").Output()
	if err != nil || len(out) == 0 {
		return M{"ok": true, "on": false}
	}
	next := ""
	for _, l := range strings.Split(string(out), "\n") {
		if strings.HasPrefix(l, "Next Run Time") {
			next = strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(l), "Next Run Time:"))
		}
	}
	return M{"ok": true, "on": true, "next": next, "last": readJSONFile(sp("last-run.json"))}
}
func setSchedule(on bool, t string) (M, error) {
	if runtime.GOOS != "windows" {
		return getSchedule(), nil
	}
	// 2.1.5: the old nightly copy task (the whole year and every balance) is never made again; the bridge's own nightly
	// run reads only what changed
	_ = exec.Command("schtasks.exe", "/Delete", "/TN", taskName, "/F").Run()
	if on {
		writeLog("The old nightly copy task was asked for: not made (the bridge's own nightly run at " + keepDailyAt() + " reads only what changed)")
	}
	_ = t
	return getSchedule(), nil
}

func invokeFvu(o M) M {
	homeDir := ownerProfile()
	jar := str(o["fvuJar"])
	if jar == "" {
		jar = filepath.Join(homeDir, "TDS-Desk", "FVU", "FVU_STANDALONE.jar")
	}
	outDir := str(o["outDir"])
	if outDir == "" {
		outDir = filepath.Join(homeDir, "TDS-Desk", "FVU", "out")
	}
	if !strings.HasSuffix(strings.ToLower(jar), ".jar") || !exists(jar) {
		return M{"ok": false, "error": "The FVU was not found at " + jar + ". Install Protean's FVU and set its path in FinCom."}
	}
	java, err := exec.LookPath("java")
	if err != nil {
		return M{"ok": false, "error": "Java is not installed on this computer. The FVU needs Java to run."}
	}
	text := str(o["text"])
	if text == "" {
		return M{"ok": false, "error": "The return file is empty."}
	}
	name := filepath.Base(str(o["name"]))
	if !re(`^[\w .()-]+\.txt$`).MatchString(name) {
		name = "return.txt"
	}
	runDir := filepath.Join(outDir, time.Now().Format("20060102-150405.000")+"-"+newUUID()[:6])
	_ = os.MkdirAll(runDir, 0o755)
	in := filepath.Join(runDir, name)
	_ = os.WriteFile(in, []byte(text), 0o644)
	errFile := strings.TrimSuffix(in, filepath.Ext(in)) + ".err"
	args := []string{"-jar", jar, in, errFile, runDir}
	if csi := str(o["csi"]); csi != "" && exists(csi) {
		args = append(args, csi)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()
	cmd := exec.CommandContext(ctx, java, args...)
	var so bytes.Buffer
	cmd.Stdout, cmd.Stderr = &so, &so
	hideWindow(cmd)
	if err := cmd.Run(); ctx.Err() != nil {
		return M{"ok": false, "error": "The FVU did not finish in three minutes."}
	} else {
		_ = err
	}
	fvus, _ := filepath.Glob(filepath.Join(runDir, "*.fvu"))
	sort.Strings(fvus)
	fvu := ""
	if len(fvus) > 0 {
		fvu = fvus[len(fvus)-1]
	}
	st := "errors"
	if fvu != "" {
		st = "accepted"
	}
	writeLog("FVU run on " + name + ": " + st)
	return M{"ok": true, "accepted": fvu != "", "fvu": fvu, "errors": readText(errFile), "output": so.String(), "folder": runDir, "input": in}
}

var _ = fmt.Sprint
