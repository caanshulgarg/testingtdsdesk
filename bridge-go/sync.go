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

func companySync(company string, port int) (M, error) {
	dir := syncFolder(company)
	_ = os.MkdirAll(dir, 0o755)
	td := time.Now()
	from := fyStart(td)
	// after the year ends, keep the last year too until its audit is done (to 30 November)
	if td.Month() >= 4 && td.Month() <= 11 {
		from = from.AddDate(-1, 0, 0)
	}
	months := []any{}
	for m := from; !m.After(td); m = m.AddDate(0, 1, 0) {
		end := m.AddDate(0, 1, -1)
		if end.After(td) {
			end = td
		}
		f, t := tallyDate(m), tallyDate(end)
		x, err := getDayBookXML(fin, company, f, t, port)
		if err != nil {
			return nil, err
		}
		file := filepath.Join(dir, "daybook-"+m.Format("200601")+".xml")
		_ = saveFile(file, x)
		months = append(months, M{"ym": m.Format("200601"), "from": f, "to": t, "bytes": len(x)})
	}
	bal, err := getBalances(company, tallyDate(from), tallyDate(td), port, false)
	if err != nil {
		return nil, err
	}
	_ = saveFile(filepath.Join(dir, "balances.json"), jsonText(bal))
	led, err := getLedgers(company, port)
	if err != nil {
		return nil, err
	}
	_ = saveFile(filepath.Join(dir, "ledgers.json"), jsonText(led))
	man := M{"ok": true, "company": company, "at": nowS(), "from": tallyDate(from), "to": tallyDate(td), "months": months, "bridge": BridgeVersion}
	_ = saveFile(filepath.Join(dir, "manifest.json"), jsonText(man))
	return man, nil
}

func nightlySync() M {
	done, failed := []any{}, []any{}
	want := strs(cfg("SyncCompanies"))
	for _, s := range openCompanies(true) {
		if s["skipped"] == true {
			continue
		}
		for _, c := range sessCompanies(s) {
			n := str(c["name"])
			if len(want) > 0 && !contains(want, n) {
				continue
			}
			if _, err := companySync(n, toInt(s["port"])); err != nil {
				failed = append(failed, n+": "+err.Error())
				writeLog("Nightly copy of " + n + " FAILED: " + err.Error())
			} else {
				done = append(done, n)
				writeLog("Nightly copy of " + n + ": done")
			}
		}
	}
	sum := M{"at": nowS(), "done": done, "failed": failed}
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
	if !on {
		_ = exec.Command("schtasks.exe", "/Delete", "/TN", taskName, "/F").Run()
		return getSchedule(), nil
	}
	if !re(`^\d{2}:\d{2}$`).MatchString(t) {
		t = "02:00"
	}
	exe, _ := os.Executable()
	cmd := `"` + exe + `" sync --config "` + ConfigPath + `"`
	if err := exec.Command("schtasks.exe", "/Create", "/F", "/SC", "DAILY", "/ST", t, "/TN", taskName, "/TR", cmd).Run(); err != nil {
		return nil, errors.New("Windows did not accept the nightly task.")
	}
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
