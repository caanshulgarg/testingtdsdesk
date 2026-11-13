// The nightly copy (bridge 1.10): each company's day book, balances and ledgers kept in a folder, ready in the morning;
// the FVU is in fvu.go (2.5.16).
package main

import (
	"errors"
	"fmt"
	"os/exec"
	"path/filepath"
	"runtime"
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
	dir, err := companyDir(company)
	if err != nil {
		return nil, err
	}
	if m := readObjFileBak(filepath.Join(dir, "manifest.json")); m != nil {
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

var _ = fmt.Sprint
