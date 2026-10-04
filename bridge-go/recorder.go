// Round 18 (2.1.9): the recorder trial (item 99). The trial add-on in Tally writes its lines in
// C:\ProgramData\FinCom\recorder (recorderline.go). Two tray items, for a person only (as Test reading from Tally):
//   - "Recorder trial: note change numbers": FinComCompany for each company open in Tally, one tiny request each; the
//     line "<company>: ALTVCHID=…, ALTMSTID=…, at <time>" appended to changenumbers.txt in the recorder folder (the
//     owner presses it before and after a delete and a cancel).
//   - "Recorder trial: send results": the recorder folder's .txt files, Tally's tdlerror.log, tally.imp and tally.ini
//     (read only, from the folder of the running tally.exe), the last 500 lines of the bridge's log and a summary the
//     bridge writes (per file the FCR1 lines per event, the write times the bridge's folder watch saw, to the
//     millisecond, and this computer's name) go to FinCom support as a support pack, note "recorder trial".
//
// The folder watch looks at the recorder folder's .txt files once a second (only their times and sizes; nothing is
// sent to Tally) while the folder exists.
package main

import (
	"archive/zip"
	"bytes"
	"encoding/base64"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

// the recorder folder (a function so the tests use their own)
var recorderDirFn = func() string {
	pd := os.Getenv("ProgramData")
	if pd == "" {
		pd = `C:\ProgramData`
	}
	return filepath.Join(pd, "FinCom", "recorder")
}

// the folders Tally's own files are read from: the folder of each running tally.exe, then the usual install folders
var tallyDirsFn = func() []string {
	var out []string
	if ok, ps, _ := platNetState(); ok {
		for _, p := range ps {
			if p.Path != "" && reTally.MatchString(p.Name) {
				out = append(out, filepath.Dir(p.Path))
			}
		}
	}
	pf, pf86 := os.Getenv("ProgramFiles"), os.Getenv("ProgramFiles(x86)")
	if pf == "" {
		pf = `C:\Program Files`
	}
	if pf86 == "" {
		pf86 = `C:\Program Files (x86)`
	}
	return append(out, filepath.Join(pf, "TallyPrime"), `C:\TallyPrime`, filepath.Join(pf86, "TallyPrime"))
}

// --- the folder watch: each change of a .txt file's last-write time, as the bridge saw it (milliseconds)
var (
	recWatchMu   sync.Mutex
	recWatchLast = map[string]time.Time{}   // file -> its last write time seen
	recWatchSeen = map[string][]time.Time{} // file -> every write time seen (at most 5,000)
)

func recorderWatchReset() {
	recWatchMu.Lock()
	recWatchLast, recWatchSeen = map[string]time.Time{}, map[string][]time.Time{}
	recWatchMu.Unlock()
}

func recorderFiles() []string {
	m, _ := filepath.Glob(filepath.Join(recorderDirFn(), "*.txt"))
	sort.Strings(m)
	return m
}

// one look at the folder
func recorderWatchOnce() {
	for _, f := range recorderFiles() {
		fi, err := os.Stat(f)
		if err != nil {
			continue
		}
		n := filepath.Base(f)
		recWatchMu.Lock()
		if t := fi.ModTime(); !t.Equal(recWatchLast[n]) {
			recWatchLast[n] = t
			if s := recWatchSeen[n]; len(s) < 5000 {
				recWatchSeen[n] = append(s, t)
			}
		}
		recWatchMu.Unlock()
	}
}

// once a second while the bridge runs; nothing while the folder is not there
func recorderWatchLoop() {
	for !stopping() {
		if fi, err := os.Stat(recorderDirFn()); err == nil && fi.IsDir() {
			recorderWatchOnce()
		}
		sleepOrStop(time.Second)
	}
}

// the summary for support: this computer, and per recorder file its FCR1 lines per event and each line with the write
// time the watch saw for it (the n-th write seen beside the n-th line: the add-on writes a line at a time)
func recorderSummary() string {
	var b strings.Builder
	fmt.Fprintf(&b, "FinCom Bridge %s: recorder trial summary\r\nComputer: %s\r\nMade: %s\r\nFolder: %s\r\n", BridgeVersion, computerName(), time.Now().Format("2006-01-02 15:04:05.000"), recorderDirFn())
	for _, f := range recorderFiles() {
		raw, _ := os.ReadFile(f)
		n := filepath.Base(f)
		lines := parseRecorderText(decodeRecorderText(raw))
		if len(lines) == 0 {
			fmt.Fprintf(&b, "\r\n%s: no FCR1 line\r\n", n)
			continue
		}
		by := map[string]int{}
		var evs []string
		for _, l := range lines {
			if by[l.Ev] == 0 {
				evs = append(evs, l.Ev)
			}
			by[l.Ev]++
		}
		sort.Strings(evs)
		var parts []string
		for _, e := range evs {
			parts = append(parts, fmt.Sprintf("%s %d", e, by[e]))
		}
		fmt.Fprintf(&b, "\r\n%s: %d FCR1 line(s): %s\r\n", n, len(lines), strings.Join(parts, ", "))
		recWatchMu.Lock()
		seen := append([]time.Time{}, recWatchSeen[n]...)
		recWatchMu.Unlock()
		for i, l := range lines {
			obs := "no write seen by the watch"
			if i < len(seen) {
				obs = "observed write " + seen[i].Format("15:04:05.000")
			}
			fmt.Fprintf(&b, "  %d. ev=%s t0=%s tw=%s t1=%s vtype=%s vno=%s vdate=%s: %s\r\n", i+1, l.Ev, l.T0, l.Tw, l.T1, l.VType, l.VNo, l.VDate, obs)
		}
		if len(seen) > len(lines) {
			fmt.Fprintf(&b, "  (%d more write(s) seen than lines)\r\n", len(seen)-len(lines))
		}
	}
	return b.String()
}

// "Recorder trial: send results"
func recorderSendResults() (M, error) {
	if !cloudOn() {
		return nil, errors.New("This computer is not connected to FinCom, so the results cannot be sent. The files are in " + recorderDirFn() + ".")
	}
	recorderWatchOnce()
	var buf bytes.Buffer
	z := zip.NewWriter(&buf)
	add := func(name string, data []byte) {
		if w, err := z.Create(name); err == nil {
			_, _ = w.Write(data)
		}
	}
	files, lines := 0, 0
	for _, f := range recorderFiles() {
		raw, err := os.ReadFile(f)
		if err != nil {
			continue
		}
		if len(raw) > 4<<20 {
			raw = raw[len(raw)-4<<20:]
		}
		files++
		for _, l := range strings.Split(strings.ReplaceAll(decodeRecorderText(raw), "\r\n", "\n"), "\n") {
			if strings.TrimSpace(l) != "" {
				lines++
			}
		}
		add("recorder/"+filepath.Base(f), raw)
	}
	got := map[string]bool{}
	for _, d := range tallyDirsFn() {
		for _, n := range []string{"tdlerror.log", "tally.imp", "tally.ini"} {
			if got[n] {
				continue
			}
			if p := filepath.Join(d, n); exists(p) {
				got[n] = true
				add("tally/"+n, []byte(fileTail(p, 1<<20)))
			}
		}
	}
	add("bridge-log-last-500-lines.txt", []byte(lastLines(fileTail(logFile(), 2<<20), 500)))
	add("recorder-summary.txt", []byte(recorderSummary()))
	if err := z.Close(); err != nil {
		return nil, err
	}
	if buf.Len() > 9<<20 {
		return nil, fmt.Errorf("the results are too large to send (%d MB); send the folder %s to FinCom support by email", buf.Len()>>20, recorderDirFn())
	}
	r := invokeCloud(M{"kind": "support", "zip": base64.StdEncoding.EncodeToString(buf.Bytes()), "note": "recorder trial"}, 120)
	if r.code != 200 {
		return nil, fmt.Errorf("the results could not be sent to FinCom support: %s", or(r.err, fmt.Sprint("HTTP ", r.code)))
	}
	writeLog(fmt.Sprintf("Recorder trial: %d lines in %d files sent", lines, files))
	ref := ""
	if r.json != nil {
		ref = str(r.json["path"])
	}
	return M{"ok": true, "files": files, "lines": lines, "ref": ref}, nil
}

// "Recorder trial: note change numbers": FinComCompany for each company open in Tally
func recorderNoteChangeNumbers() (M, error) {
	if err := readsAllowed(); err != nil {
		return nil, err
	}
	var noted []any
	var b strings.Builder
	for _, s := range openCompaniesWith(fin, true) {
		if s["skipped"] == true || s["ok"] != true {
			continue
		}
		port := toInt(s["port"])
		for _, c := range sessCompanies(s) {
			name := str(c["name"])
			raw, err := invokeTally(fin, port, companyCheckRequest(name), 15)
			if err != nil {
				return nil, fmt.Errorf("Tally did not answer for %s: %s", name, err.Error())
			}
			noteCompanyAlts(name, raw)
			for _, x := range xmlDoc(raw).All("COMPANY") {
				if n := nameOf(x); n != "" && !sameCompany(n, name) {
					continue
				}
				v, m := re(`\D`).ReplaceAllString(nt(x, "ALTVCHID"), ""), re(`\D`).ReplaceAllString(nt(x, "ALTMSTID"), "")
				line := fmt.Sprintf("%s: ALTVCHID=%s, ALTMSTID=%s, at %s", name, v, m, time.Now().Format("2006-01-02 15:04:05"))
				b.WriteString(line + "\r\n")
				noted = append(noted, line)
				break
			}
		}
	}
	if len(noted) == 0 {
		return nil, errors.New("No company is open in Tally: open the company, then try again.")
	}
	d := recorderDirFn()
	_ = os.MkdirAll(d, 0o755)
	if err := appendText(filepath.Join(d, "changenumbers.txt"), b.String()); err != nil {
		return nil, err
	}
	writeLog("Recorder trial: change numbers noted: " + strings.Join(strs(noted), "; "))
	return M{"ok": true, "lines": noted, "file": filepath.Join(d, "changenumbers.txt")}, nil
}
