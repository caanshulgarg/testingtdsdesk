// Round 18 (2.1.9): the recorder trial (item 99). The trial add-on in Tally writes its lines in
// C:\ProgramData\FinCom\recorder (recorderline.go). Two tray items, for a person only (as Test reading from Tally):
//   - "Recorder trial: note change numbers": FinComCompany for each company open in Tally, one tiny request each; the
//     line "<company>: ALTVCHID=…, ALTMSTID=…, at <time>" appended to sync\recorder-changenumbers.txt, the bridge's own
//     folder (round 19: never in the recorder folder, which Users may change) (the owner presses it before and after a
//     delete and a cancel).
//   - "Recorder trial: send results": the recorder folder's .txt files, Tally's tdlerror.log, tally.imp and tally.ini
//     (read only, from the folder of the running tally.exe under Program Files, round 19), the last 500 lines of the bridge's log and a summary the
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

// the folders Tally's own files are read from: round 19 (S3), only folders under Program Files / Program Files (x86)
// (where a user without administrator rights cannot write): the folder of each running tally.exe that is there, then
// the usual install folders
var tallyDirsFn = func() []string {
	pf, pf86 := os.Getenv("ProgramFiles"), os.Getenv("ProgramFiles(x86)")
	if pf == "" {
		pf = `C:\Program Files`
	}
	if pf86 == "" {
		pf86 = `C:\Program Files (x86)`
	}
	var out []string
	if ok, ps, _ := platNetState(); ok {
		for _, p := range ps {
			if p.Path != "" && reTally.MatchString(p.Name) && (underDir(p.Path, pf) || underDir(p.Path, pf86)) {
				out = append(out, filepath.Dir(p.Path))
			}
		}
	}
	return append(out, filepath.Join(pf, "TallyPrime"), filepath.Join(pf86, "TallyPrime"))
}

// path is inside dir (not dir itself), compared without case, after cleaning (no "..")
func underDir(path, dir string) bool {
	p, d := strings.ToLower(filepath.Clean(path)), strings.ToLower(filepath.Clean(dir))
	return d != "" && d != "." && strings.HasPrefix(p, d+string(filepath.Separator))
}

// round 19 (S3): at most this many recorder files, this many bytes each (their end) and in all
const (
	recorderMaxFiles     = 50
	recorderMaxFileBytes = 4 << 20
	recorderMaxAllBytes  = 32 << 20
)

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

// the recorder folder's .txt files (the first 50 by name); none when the folder itself is a link or a junction
func recorderFiles() []string {
	d := recorderDirFn()
	fi, err := os.Lstat(d)
	if err != nil || !fi.IsDir() || isReparse(d, fi) {
		return nil
	}
	m, _ := filepath.Glob(filepath.Join(d, "*.txt"))
	sort.Strings(m)
	if len(m) > recorderMaxFiles {
		m = m[:recorderMaxFiles]
	}
	return m
}

// one look at the folder
func recorderWatchOnce() {
	for _, f := range recorderFiles() {
		fi, err := os.Lstat(f) // its time and size only: the file is never opened by the watch
		if err != nil || !fi.Mode().IsRegular() {
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
func recorderSummary(read map[string][]byte) string {
	var b strings.Builder
	fmt.Fprintf(&b, "FinCom Bridge %s: recorder trial summary\r\nComputer: %s\r\nMade: %s\r\nFolder: %s\r\n", BridgeVersion, computerName(), time.Now().Format("2006-01-02 15:04:05.000"), recorderDirFn())
	for _, f := range recorderFiles() {
		raw, ok := read[f]
		if !ok {
			continue
		}
		n := filepath.Base(f)
		lines := parseRecorderText(decodeRecorderText(raw))
		if len(lines) > 2000 {
			lines = lines[len(lines)-2000:]
		}
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
	read := map[string][]byte{}
	total := 0
	for _, f := range recorderFiles() {
		if total >= recorderMaxAllBytes {
			break
		}
		max := int64(recorderMaxFileBytes)
		if left := int64(recorderMaxAllBytes - total); left < max {
			max = left
		}
		raw, err := readShared(f, max)
		if err != nil {
			continue
		}
		total += len(raw)
		read[f] = raw
		files++
		for _, l := range strings.Split(strings.ReplaceAll(decodeRecorderText(raw), "\r\n", "\n"), "\n") {
			if strings.TrimSpace(l) != "" {
				lines++
			}
		}
		add("recorder/"+filepath.Base(f), raw)
	}
	// round 19 (S1): the change numbers the bridge noted, from its own folder
	if b, err := readTail(changeNumbersFile(), 1<<20, false); err == nil {
		add("bridge/changenumbers.txt", b)
	}
	got := map[string]bool{}
	for _, d := range tallyDirsFn() {
		for _, n := range []string{"tdlerror.log", "tally.imp", "tally.ini"} {
			if got[n] {
				continue
			}
			if b, err := readShared(filepath.Join(d, n), 1<<20); err == nil {
				got[n] = true
				add("tally/"+n, b)
			}
		}
	}
	logTail, _ := readTail(logFile(), 2<<20, false)
	add("bridge-log-last-500-lines.txt", []byte(lastLines(string(logTail), 500)))
	add("recorder-summary.txt", []byte(recorderSummary(read)))
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

// round 19 (S1): the change numbers are kept in the bridge's own sync folder (not writable by Users), never in recorder\
func changeNumbersFile() string { return sp("recorder-changenumbers.txt") }

// "Recorder trial: note change numbers": FinComCompany for each company open in Tally; a company that does not answer
// is listed and the others are noted (round 19)
func recorderNoteChangeNumbers() (M, error) {
	if err := readsAllowed(); err != nil {
		return nil, err
	}
	var noted, missed []any
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
				missed = append(missed, name+": "+err.Error())
				continue
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
		if len(missed) > 0 {
			return nil, errors.New("Tally did not answer for " + strings.Join(strs(missed), "; "))
		}
		return nil, errors.New("No company is open in Tally: open the company, then try again.")
	}
	f := changeNumbersFile()
	if err := appendText(f, b.String()); err != nil {
		return nil, err
	}
	writeLog("Recorder trial: change numbers noted: " + strings.Join(strs(noted), "; "))
	if len(missed) > 0 {
		writeLog("Recorder trial: change numbers not noted (Tally did not answer): " + strings.Join(strs(missed), "; "))
	}
	return M{"ok": true, "lines": noted, "missed": missed, "file": f}, nil
}
