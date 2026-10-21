// FinCom Bridge 2.4.5 (ROUND 102; round 81 B; the owner's OK of 21-Oct-2026 on the exact lines): FinCom's add-on loaded
// by Tally itself at its start, from each TallyPrime's tally.ini the bridge finds:
//
//	TDL = C:\ProgramData\FinCom\addon\FinComRecorder.tdl
//
// and "User TDL = Yes" only when the file has no User TDL line at all (TallyPrime's own file has "User TDL = Yes").
// The rule, as the harness's FcIniAdd ran it on TallyPrime 3.0, 4.1, 5.1, 6.2 and 7.1 (tally-versions dbbig run
// 39542962661, checks i1-i4):
//  1. add only: no line is removed, changed or reordered; the file's line ending and encoding (UTF-8 with or without its
//     BOM, UTF-16 LE) are kept;
//  2. the line goes right after the last "TDL =" line, else at the end of the [Tally] section;
//  3. idempotent: a "TDL =" line that already names this file (case, quotes and slashes aside) changes nothing;
//  4. tally.ini.fincom-bak, the file as it was, is written before the first change and never overwritten;
//  5. a file with "User TDL = No" (or any value but Yes) is left untouched: adding Yes after it would switch on every
//     other add-on of the client too (the owner's decision is pending; untouched is the default). It is reported in the
//     beat for Help & support ("tallyIni": state usertdl-no), nothing else.
//
// Which files: tally.ini next to each TallyPrime the bridge may read Tally's own files from (round 19, S3: only folders
// under Program Files / Program Files (x86): each running tally.exe there, then the usual install folders, and every
// "TallyPrime*" folder there). When: the setup's install step (all users and just for one user), and the first start of
// each version (a bridge that updated itself never ran the install step: the service and the per-user bridge both), and
// once in a run for a Tally program seen later. Takes effect at Tally's next start. Nothing is sent to Tally.
package main

import (
	"bytes"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"
	"unicode/utf16"
)

// the add-on's path as the line names it (C:\ProgramData\FinCom\addon\FinComRecorder.tdl on a usual Windows)
func addonIniPath() string {
	return strings.TrimRight(programDataDir(), `\/`) + `\FinCom\addon\FinComRecorder.tdl`
}

var (
	reIniSection = regexp.MustCompile(`^\s*\[(.+)\]\s*$`)
	reIniTDL     = regexp.MustCompile(`(?i)^\s*TDL\s*=\s*(.*)$`)
	reIniUserTDL = regexp.MustCompile(`(?i)^\s*User\s+TDL\s*=\s*(\S*)`)
)

func iniNorm(p string) string {
	return strings.ToLower(strings.ReplaceAll(strings.Trim(strings.TrimSpace(p), `"`), "/", `\`))
}

// the rule on one file's bytes: the new bytes and what was done: "added" (the line, and User TDL = Yes when none was
// there), "already" (nothing to add), "usertdl-no" (left untouched), "unreadable"
func iniAddAddon(raw []byte, addon string) ([]byte, string, []string) {
	// the encoding: UTF-16 LE with its BOM, UTF-8 with its BOM, else bytes as they are (ASCII / ANSI / UTF-8)
	var text string
	enc := "plain"
	switch {
	case len(raw) >= 2 && raw[0] == 0xFF && raw[1] == 0xFE:
		if len(raw)%2 != 0 {
			return nil, "unreadable", nil
		}
		u := make([]uint16, 0, len(raw)/2-1)
		for i := 2; i+1 < len(raw); i += 2 {
			u = append(u, uint16(raw[i])|uint16(raw[i+1])<<8)
		}
		text, enc = string(utf16.Decode(u)), "utf16"
	case len(raw) >= 3 && raw[0] == 0xEF && raw[1] == 0xBB && raw[2] == 0xBF:
		text, enc = string(raw[3:]), "utf8bom"
	default:
		text = string(raw)
	}
	if strings.ContainsRune(text, 0) {
		return nil, "unreadable", nil
	}
	nl := "\n"
	if strings.Contains(text, "\r\n") {
		nl = "\r\n"
	}
	lines := regexp.MustCompile(`\r?\n`).Split(text, -1)
	endNl := false
	if len(lines) > 0 && lines[len(lines)-1] == "" {
		lines, endNl = lines[:len(lines)-1], true
	}
	have, lastTDL, secEnd, inTally := false, -1, len(lines), false
	var user []string
	for i, l := range lines {
		if m := reIniSection.FindStringSubmatch(l); m != nil {
			if inTally {
				secEnd, inTally = i, false
			}
			if strings.EqualFold(strings.TrimSpace(m[1]), "Tally") {
				inTally = true
			}
			continue
		}
		if m := reIniUserTDL.FindStringSubmatch(l); m != nil {
			user = append(user, m[1])
		} else if m := reIniTDL.FindStringSubmatch(l); m != nil {
			lastTDL = i
			if iniNorm(m[1]) == iniNorm(addon) {
				have = true
			}
		}
	}
	for _, u := range user {
		if !strings.EqualFold(u, "Yes") && !strings.EqualFold(u, "Y") {
			return raw, "usertdl-no", nil // the client's own choice: the file is left untouched
		}
	}
	var add []string
	if len(user) == 0 {
		add = append(add, "User TDL = Yes")
	}
	if !have {
		add = append(add, "TDL = "+addon)
	}
	if len(add) == 0 {
		return raw, "already", nil
	}
	at := secEnd
	if lastTDL >= 0 {
		at = lastTDL + 1
	}
	out := make([]string, 0, len(lines)+len(add))
	out = append(out, lines[:at]...)
	out = append(out, add...)
	out = append(out, lines[at:]...)
	t := strings.Join(out, nl)
	if endNl {
		t += nl
	}
	var b []byte
	switch enc {
	case "utf16":
		b = []byte{0xFF, 0xFE}
		for _, u := range utf16.Encode([]rune(t)) {
			b = append(b, byte(u), byte(u>>8))
		}
	case "utf8bom":
		b = append([]byte{0xEF, 0xBB, 0xBF}, t...)
	default:
		b = []byte(t)
	}
	return b, "added", add
}

// tally.ini read only when the file opened is the one looked at (fi, by Lstat): no link swapped in between
func iniReadSame(path string, _ os.FileInfo) ([]byte, error) {
	f, err := openNoLink(path, false)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	b, err := io.ReadAll(io.LimitReader(f, 4<<20+1))
	if err == nil && len(b) > 4<<20 {
		return nil, errors.New("tally.ini is larger than 4 MB: not read or changed") // review 245 R4: never cut short
	}
	return b, err
}

// the file written: the backup first (never overwritten), then the new bytes in place (the file keeps its permissions);
// read back to check. A link, junction or anything but a regular file is never followed or written
var iniWriteFn = func(path string, b []byte) error {
	// review 245 R3: opened without truncating, then checked to be the very file looked at (no link or junction swapped
	// in between), and only then cut and written
	f, err := openNoLink(path, true)
	if err != nil {
		return err
	}
	if err := f.Truncate(0); err != nil {
		f.Close()
		return err
	}
	if _, err := f.Write(b); err != nil {
		f.Close()
		return err
	}
	return f.Close()
}

func tallyIniApply(path, addon string) (M, error) {
	e := M{"path": path, "at": nowFn().Format(time.RFC3339)}
	fi, err := os.Lstat(path)
	if err != nil {
		e["state"] = "missing"
		return e, err
	}
	// review 245 R5: the folder itself is no link or junction to somewhere else
	if di, derr := os.Lstat(filepath.Dir(path)); derr != nil || !di.IsDir() || di.Mode()&(os.ModeSymlink|os.ModeIrregular) != 0 {
		e["state"] = "refused"
		return e, errors.New("the TallyPrime folder is a link or junction to another place: not touched")
	}
	if !fi.Mode().IsRegular() {
		e["state"] = "refused"
		return e, errors.New("not a plain file (a link or a folder): not touched")
	}
	raw, err := iniReadSame(path, fi)
	if err != nil {
		e["state"] = "unreadable"
		return e, err
	}
	nb, state, added := iniAddAddon(raw, addon)
	e["state"] = state
	if state != "added" {
		return e, nil
	}
	bak := path + ".fincom-bak"
	if bi, err := os.Lstat(bak); err == nil && !bi.Mode().IsRegular() {
		e["state"] = "refused"
		return e, fmt.Errorf("the backup %s is not a plain file (a link?): tally.ini not changed", bak)
	} else if err != nil && !errors.Is(err, os.ErrNotExist) {
		e["state"] = "failed"
		return e, fmt.Errorf("the backup %s could not be looked at (%v): tally.ini not changed", bak, err)
	} else if errors.Is(err, os.ErrNotExist) {
		// made new only (O_EXCL: never through a link planted under that name, never over a file)
		bf, err := os.OpenFile(bak, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o644)
		if err == nil {
			_, err = bf.Write(raw)
			if cerr := bf.Close(); err == nil {
				err = cerr
			}
		}
		if err != nil {
			if bf != nil {
				_ = os.Remove(bak) // a backup cut short is not left as the backup
			}
			e["state"] = "failed"
			return e, fmt.Errorf("the backup %s could not be written (%v): tally.ini not changed", bak, err)
		}
	}
	if err := iniWriteFn(path, nb); err != nil {
		// review 245 R1: a write cut short (disk full, an antivirus) may have left the file short: put back as it was
		// (the in-place write keeps the file's own permissions; the backup .fincom-bak holds it too)
		e["state"] = "failed"
		if cur, rerr := os.ReadFile(path); rerr == nil && bytes.Equal(cur, raw) {
			return e, fmt.Errorf("tally.ini could not be written (%v): not changed", err) // never opened: nothing to put back
		}
		if perr := iniWriteFn(path, raw); perr != nil {
			return e, fmt.Errorf("tally.ini could not be written (%v) nor put back (%v): its backup %s.fincom-bak holds it as it was", err, perr, path)
		}
		return e, fmt.Errorf("tally.ini could not be written (%v): put back as it was", err)
	}
	if back, err := os.ReadFile(path); err != nil || !bytes.Equal(back, nb) {
		_ = iniWriteFn(path, raw) // put back as it was
		e["state"] = "failed"
		return e, errors.New("tally.ini did not read back as written: put back as it was")
	}
	e["added"] = toAny(added)
	return e, nil
}

// the TallyPrime folders whose tally.ini is looked at: tallyDirsFn (Program Files only, round 19 S3) and every
// "TallyPrime*" folder under Program Files / Program Files (x86)
var tallyIniDirsFn = func() []string {
	out := tallyDirsFn()
	for _, base := range []string{os.Getenv("ProgramFiles"), os.Getenv("ProgramFiles(x86)")} {
		if base == "" {
			continue
		}
		ms, _ := filepath.Glob(filepath.Join(base, "TallyPrime*"))
		out = append(out, ms...)
	}
	return out
}

var iniSt = struct {
	mu    sync.Mutex
	files map[string]M // path (lower case) -> the last result
	seen  time.Time
}{files: map[string]M{}}

func tallyIniFile() string { return sp("tally-ini.json") }

// the step: each tally.ini found, the rule applied; every result logged and kept (sync\tally-ini.json, the beat)
func tallyIniStep(log func(string)) []M {
	addon := addonIniPath()
	seen := map[string]bool{}
	var out []M
	for _, d := range tallyIniDirsFn() {
		p := filepath.Join(d, "tally.ini")
		k := strings.ToLower(filepath.Clean(p))
		if seen[k] {
			continue
		}
		seen[k] = true
		if _, err := os.Lstat(p); err != nil {
			continue
		}
		e, err := tallyIniApply(p, addon)
		switch str(e["state"]) {
		case "added":
			log(fmt.Sprintf("tally.ini %s: added %s (the backup %s.fincom-bak keeps the file as it was); FinCom's add-on loads at Tally's next start", p, strings.Join(toStrings(e["added"]), " and "), p))
		case "already":
			log("tally.ini " + p + ": FinCom's add-on is already named; nothing changed")
		case "usertdl-no":
			e["why"] = "this Tally is set not to load any add-on (User TDL = No); left as it is, so FinCom's add-on is not loaded automatically on this computer"
			log("tally.ini " + p + ": User TDL = No: the file is left as it is (FinCom's add-on is not loaded automatically; Help & support shows it)")
		default:
			if err != nil {
				e["why"] = cutRunes(err.Error(), 200)
			}
			log("tally.ini " + p + ": not changed (" + str(e["state"]) + ": " + str(e["why"]) + ")")
		}
		out = append(out, e)
	}
	if len(out) == 0 {
		log("tally.ini: no TallyPrime folder with a tally.ini found under Program Files; nothing changed (the add-on can still be loaded from Tally's F1 Help > TDLs & Add-ons)")
	}
	if len(out) == 0 {
		return out // nothing found: nothing kept
	}
	iniSt.mu.Lock()
	for _, e := range out {
		iniSt.files[strings.ToLower(filepath.Clean(str(e["path"])))] = e
	}
	all := tallyIniListLocked()
	iniSt.mu.Unlock()
	_ = saveFile(tallyIniFile(), jsonText(all))
	return out
}

func tallyIniListLocked() []any {
	if len(iniSt.files) == 0 {
		for _, x := range arr(readJSONFile(tallyIniFile())) {
			if e := obj(x); e != nil && str(e["path"]) != "" {
				iniSt.files[strings.ToLower(filepath.Clean(str(e["path"])))] = e
			}
		}
	}
	var ks []string
	for k := range iniSt.files {
		ks = append(ks, k)
	}
	sort.Strings(ks)
	out := []any{}
	for _, k := range ks {
		out = append(out, iniSt.files[k])
	}
	return out
}

// for the beat (Help & support): each tally.ini and what was done to it
func tallyIniBeat() []any {
	iniSt.mu.Lock()
	defer iniSt.mu.Unlock()
	return tallyIniListLocked()
}

// a Tally program seen later in a run (a new TallyPrime installed): the step again, at most once in 10 minutes and only
// when a folder not looked at before is there
func tallyIniSeen() {
	iniSt.mu.Lock()
	if time.Since(iniSt.seen) < 10*time.Minute {
		iniSt.mu.Unlock()
		return
	}
	iniSt.seen = time.Now()
	known := tallyIniListLocked()
	iniSt.mu.Unlock()
	have := map[string]bool{}
	for _, x := range known {
		have[strings.ToLower(filepath.Clean(str(obj(x)["path"])))] = true
	}
	for _, d := range tallyIniDirsFn() {
		p := filepath.Join(d, "tally.ini")
		if _, err := os.Lstat(p); err == nil && !have[strings.ToLower(filepath.Clean(p))] {
			tallyIniStep(writeLog)
			return
		}
	}
}

// the first start of a version (the service's and the per-user bridge's: a bridge that updated itself never ran the
// install step): the step once, the version kept in this marker in the bridge's own folder
const tallyIniMarkerName = "fincom-tallyini-version.txt"

func tallyIniAfterUpdate(dir string, log func(string)) bool {
	marker := filepath.Join(dir, tallyIniMarkerName)
	mk := strings.Fields(readText(marker))
	if len(mk) == 1 && mk[0] == BridgeVersion {
		return false
	}
	// a tally.ini that failed is tried at the next start, three starts at most (review 245 R2: a file this bridge may never
	// write, the per-user bridge's under Program Files, is not tried at every start for ever)
	tries := 0
	if len(mk) == 3 && mk[0] == BridgeVersion && mk[1] == "try" {
		tries = toInt(mk[2])
	}
	log("FinCom Bridge " + BridgeVersion + ", its first start: FinCom's add-on in each TallyPrime's tally.ini (added only, never removed or moved)")
	for _, e := range tallyIniStep(log) {
		// review 245 R1: a tally.ini that could not be read or written (locked by Tally or an antivirus a moment): the
		// marker is not written, so the step runs again at the next start
		if st := str(e["state"]); (st == "failed" || st == "unreadable") && tries < 2 {
			log("tally.ini " + str(e["path"]) + ": tried again at the bridge's next start")
			_ = saveFile(marker, fmt.Sprintf("%s try %d", BridgeVersion, tries+1))
			return true
		}
	}
	if err := saveFile(marker, BridgeVersion); err != nil {
		log("The tally.ini marker " + marker + " could not be written: " + err.Error() + " (the step runs again at the next start)")
	}
	return true
}

func toStrings(v any) []string {
	var o []string
	for _, x := range arr(v) {
		o = append(o, str(x))
	}
	return o
}
