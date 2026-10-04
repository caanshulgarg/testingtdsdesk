// Round 18 (2.1.9): the recorder trial (item 99). The trial add-on in Tally writes its lines in
// C:\ProgramData\FinCom\recorder (recorderline.go). Two tray items, for a person only (as Test reading from Tally):
//   - "Recorder trial: note change numbers": FinComCompany for each company open in Tally, one tiny request each; the
//     line "<company>: ALTVCHID=…, ALTMSTID=…, at <time>" appended to sync\recorder-changenumbers.txt, the bridge's own
//     folder (the installing user's; round 19: never in the recorder folder, which Users may add to; round 20: the
//     append does not follow a link) (the owner presses it before and after a
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

// round 20 (the re-review's Medium 1, RS1): before anything in the recorder folder is listed, looked at, read or locked,
// C:\ProgramData\FinCom and its recorder\ are checked: each a plain folder by os.Lstat (no link, no junction, no other
// reparse point: on Windows FILE_ATTRIBUTE_REPARSE_POINT too), each owned by SYSTEM or Administrators when the bridge
// runs as the service (the install step and the first start after an update make them so), and the recorder folder's
// final path (GetFinalPathNameByHandle on Windows, every link followed; EvalSymlinks elsewhere) the expected one: the
// final path of the folder holding FinCom, then FinCom\recorder. Else nothing is done there and the log says why (once
// per reason). A folder that is not there is not an error (no trial on this computer).
var (
	recorderAsService     = runningAsService // a function so the tests can say "as the service"
	recorderRefusedMu     sync.Mutex
	recorderRefusedLogged string
)

func recorderDirChecked() (string, bool) {
	d := filepath.Clean(recorderDirFn())
	fc := filepath.Dir(d)
	why := ""
	for _, p := range []string{fc, d} {
		fi, err := os.Lstat(p)
		if err != nil {
			if os.IsNotExist(err) {
				return d, false
			}
			why = p + " could not be looked at: " + err.Error()
			break
		}
		if isReparse(p, fi) {
			why = p + " is a link or junction"
			break
		}
		if !fi.IsDir() {
			why = p + " is not a folder"
			break
		}
		if recorderAsService() {
			if ok, owner := ownerIsAdmin(p); !ok {
				why = p + " is owned by " + owner + ", not by SYSTEM or Administrators"
				break
			}
		}
	}
	if why == "" {
		got, err := finalPathFn(d)
		base, err2 := finalPathFn(filepath.Dir(fc))
		want := filepath.Join(base, filepath.Base(fc), filepath.Base(d))
		switch {
		case err != nil || err2 != nil:
			why = "its final path could not be read"
		case !samePath(got, want):
			why = "its final path is " + got + ", not " + want
		}
	}
	recorderRefusedMu.Lock()
	defer recorderRefusedMu.Unlock()
	if why == "" {
		recorderRefusedLogged = ""
		return d, true
	}
	if recorderRefusedLogged != why {
		recorderRefusedLogged = why
		writeLog("Recorder trial: the recorder folder " + d + " is not read: " + why + " (run the setup again as an administrator to make the folders anew)")
	}
	return d, false
}

// two paths name the same place (without case on Windows)
func samePath(a, b string) bool {
	a, b = filepath.Clean(a), filepath.Clean(b)
	if filepath.Separator == '\\' {
		return strings.EqualFold(a, b)
	}
	return a == b
}

// the recorder folder's .txt files (the first 50 by name); none when the folder or C:\ProgramData\FinCom fails the check
func recorderFiles() []string {
	d, ok := recorderDirChecked()
	if !ok {
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

// once a second while the bridge runs; nothing while the folder is not there or fails the check (recorderFiles)
// 2.2.0: each turn also reads the live add-on's new lines (recorder_live.go: readSharedFrom only, never a write)
func recorderWatchLoop() {
	for !stopping() {
		recorderWatchOnce()
		func() {
			defer func() {
				if r := recover(); r != nil {
					writeLog(fmt.Sprint("Recorder: ", r))
				}
			}()
			liveReadOnce()
		}()
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

// the recorder files "send results" would send: each file's end (bounded as below), in file-name order
func recorderReadAll() ([]string, map[string][]byte) {
	var order []string
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
		order = append(order, f)
	}
	return order, read
}

// round 22 (the 2.1.10 reviews' Medium 3 / S3): since 2.1.10 the recorder lines may be any company's books, so "send
// results" asks first. The preview reads the same files the send would and names, in file order, each company named
// in their lines (cname=) with its count of lines, and says what a line holds; it sends nothing. The tray shows
// "confirm" in a yes/no and sends only on Yes (POST {confirm:true}); a send without the confirm is refused
const recorderLineHolds = "Each line holds what Tally saved: the voucher's narration, number and date, the party and ledger names, master names and their groups, and the Tally user name."

func recorderSendPreview() (M, error) {
	if !cloudOn() {
		return nil, errors.New("This computer is not connected to FinCom, so the results cannot be sent. The files are in " + recorderDirFn() + ".")
	}
	order, read := recorderReadAll()
	var names []string
	count := map[string]int{}
	noName := 0
	for _, f := range order {
		for _, l := range parseRecorderText(decodeRecorderText(read[f])) {
			n := strings.TrimSpace(l.CName)
			if n == "" {
				noName++
				continue
			}
			if count[n] == 0 {
				names = append(names, n)
			}
			count[n]++
		}
	}
	var parts []string
	for _, n := range names {
		parts = append(parts, n+" ("+plural(count[n], "line")+")")
	}
	if noName > 0 {
		parts = append(parts, "no company named ("+plural(noName, "line")+")")
	}
	what := "no recorder line"
	if len(parts) > 0 {
		what = strings.Join(parts, ", ")
	}
	if names == nil {
		names = []string{}
	}
	conf := fmt.Sprintf("Send the recorder trial results to FinCom support?\n\nThe %d recorder file(s) in %s hold the lines of: %s.\n\n%s\n\nAlso sent: Tally's tdlerror.log, tally.imp and tally.ini, the change numbers the bridge noted and the last 500 lines of its log.",
		len(order), recorderDirFn(), what, recorderLineHolds)
	return M{"ok": true, "files": len(order), "companies": names, "confirm": conf}, nil
}

func plural(n int, w string) string {
	if n == 1 {
		return "1 " + w
	}
	return fmt.Sprintf("%d %ss", n, w)
}

// "Recorder trial: send results" (after the tray's yes/no on recorderSendPreview)
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
	order, read := recorderReadAll()
	for _, f := range order {
		raw := read[f]
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

// round 19 (S1): the change numbers are kept in the bridge's own sync folder, never in recorder\. Round 20 (the
// re-review's Low 3): that folder is the installing user's (the service's Home is that user's %LOCALAPPDATA%\TDS Desk
// Bridge), so it is not writable by every member of Users, but that one user can change it; the append does not follow
// a link (appendNoFollow)
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
			// 2.2.0: the company check with its two forms (safety.go companyCheck: NATIVEMETHOD, then the report)
			_, given, err := companyCheckNumbers(fin, name, port)
			if err != nil {
				missed = append(missed, name+": "+err.Error())
				continue
			}
			// round 5 R5-3: what this check gave, never a number kept from before
			v, m := "not given", "not given"
			if given {
				v, m = fmt.Sprint(companyAlter(name)), fmt.Sprint(companyAlterM(name))
			}
			line := fmt.Sprintf("%s: ALTVCHID=%s, ALTMSTID=%s, at %s", name, v, m, time.Now().Format("2006-01-02 15:04:05"))
			b.WriteString(line + "\r\n")
			noted = append(noted, line)
		}
	}
	if len(noted) == 0 {
		if len(missed) > 0 {
			return nil, errors.New("Tally did not answer for " + strings.Join(strs(missed), "; "))
		}
		return nil, errors.New("No company is open in Tally: open the company, then try again.")
	}
	f := changeNumbersFile()
	if err := appendNoFollow(f, b.String()); err != nil {
		return nil, err
	}
	writeLog("Recorder trial: change numbers noted: " + strings.Join(strs(noted), "; "))
	if len(missed) > 0 {
		writeLog("Recorder trial: change numbers not noted (Tally did not answer): " + strings.Join(strs(missed), "; "))
	}
	return M{"ok": true, "lines": noted, "missed": missed, "file": f}, nil
}
