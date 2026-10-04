// Round 19 (the code review's finding 3, the security review's S2): the recorder trial's folders, made by the exe's
// install step (FinComBridge.exe install, run by the setup) instead of the setup script:
//
//	C:\ProgramData\FinCom           SYSTEM and Administrators full, Users read (all users)
//	C:\ProgramData\FinCom\recorder  SYSTEM and Administrators full; Users read and add files to the folder itself
//	                                (RX,WD: no DELETE on the folder, no subfolders) and Modify on the files only
//	                                ((OI)(IO)M), so Tally's add-on (running as the desk user) writes its holding files
//	C:\ProgramData\FinCom\addon     SYSTEM and Administrators full, Users read; the add-on's .tdl files (built in)
//
// Any user may create folders under C:\ProgramData, so before the setup runs someone could have made FinCom, or a link
// or junction at FinCom\recorder or FinCom\addon pointing somewhere else. Each folder is looked at with os.Lstat (never
// followed): a link, a junction or another reparse point, a file, or (for all users) a FinCom folder not owned by SYSTEM
// or Administrators is moved aside (renamed, kept, logged) and the folder is made anew; when it cannot be moved aside the
// step stops and nothing more is made. The permissions are set with icacls /L (the folder itself, never a target) and
// inheritance removed. FinCom is made safe first, so nothing can be swapped inside it afterwards. A setup just for one
// user (not elevated) makes the folders the same way, links refused, and leaves their permissions as Windows gives them.
package main

import (
	"embed"
	"fmt"
	"os"
	"os/exec"
	"path"
	"path/filepath"
	"strings"
	"time"
)

//go:embed addon/*.tdl
var addonFiles embed.FS

const (
	sidSystem = "*S-1-5-18"
	sidAdmins = "*S-1-5-32-544"
	sidUsers  = "*S-1-5-32-545"
)

// icacls (a function so the tests see the calls); args[0] is the folder
var icaclsFn = func(args ...string) (string, error) {
	c := exec.Command("icacls.exe", args...)
	hideWindow(c)
	out, err := c.CombinedOutput()
	return strings.TrimSpace(string(out)), err
}

// C:\ProgramData (the base the folders are made in)
func programDataDir() string {
	if pd := os.Getenv("ProgramData"); pd != "" {
		return pd
	}
	return `C:\ProgramData`
}

// the install step: the folders made, the .tdl written, each line in the install log; a failure is logged and the
// install goes on (only the recorder trial needs them)
func installFinComFolders(allUsers bool, log func(string)) {
	lines, err := prepareFinComFolders(programDataDir(), allUsers)
	for _, l := range lines {
		log(l)
	}
	if err != nil {
		log("Install: the recorder trial's folders were NOT made (" + err.Error() + "); the bridge works without them")
	}
}

func prepareFinComFolders(base string, allUsers bool) ([]string, error) {
	var lines []string
	say := func(s string) { lines = append(lines, "Install: "+s) }
	fc := filepath.Join(base, "FinCom")
	stamp := time.Now().Format("20060102-150405")
	if err := safeFolder(fc, allUsers, stamp, say); err != nil {
		return lines, err
	}
	if allUsers {
		if err := setACL(say, fc, [][]string{{"/inheritance:r", "/grant:r", sidSystem + ":(OI)(CI)F", sidAdmins + ":(OI)(CI)F", sidUsers + ":(OI)(CI)RX"}, {"/setowner", sidAdmins}}); err != nil {
			return lines, err
		}
	}
	rec, add := filepath.Join(fc, "recorder"), filepath.Join(fc, "addon")
	for _, d := range []string{rec, add} {
		if err := safeFolder(d, allUsers, stamp, say); err != nil {
			return lines, err
		}
	}
	if allUsers {
		if err := setACL(say, rec, [][]string{
			{"/inheritance:r", "/grant:r", sidSystem + ":(OI)(CI)F", sidAdmins + ":(OI)(CI)F", sidUsers + ":(RX,WD)"},
			{"/grant", sidUsers + ":(OI)(IO)M"},
			{"/setowner", sidAdmins}}); err != nil {
			return lines, err
		}
		if err := setACL(say, add, [][]string{{"/inheritance:r", "/grant:r", sidSystem + ":(OI)(CI)F", sidAdmins + ":(OI)(CI)F", sidUsers + ":(OI)(CI)RX"}, {"/setowner", sidAdmins}}); err != nil {
			return lines, err
		}
	}
	names, _ := addonFiles.ReadDir("addon")
	for _, e := range names {
		b, err := addonFiles.ReadFile(path.Join("addon", e.Name()))
		if err != nil {
			continue
		}
		if err := writeFresh(filepath.Join(add, e.Name()), b); err != nil {
			say("the add-on " + e.Name() + " was not written in " + add + ": " + err.Error())
			continue
		}
		say("the add-on " + e.Name() + " written in " + add)
	}
	say(fmt.Sprintf("the recorder folder %s and the add-on folder %s are ready (%s)", rec, add, map[bool]string{true: "all users: Users may add files to the recorder folder only", false: "just for this user"}[allUsers]))
	return lines, nil
}

// a folder that is a plain folder made by this step or by an administrator: anything else at its path moved aside first
func safeFolder(d string, allUsers bool, stamp string, say func(string)) error {
	fi, err := os.Lstat(d)
	switch {
	case os.IsNotExist(err):
	case err != nil:
		return fmt.Errorf("%s could not be looked at: %v", d, err)
	default:
		why := ""
		if isReparse(d, fi) {
			why = "a link or junction"
		} else if !fi.IsDir() {
			why = "not a folder"
		} else if allUsers {
			if ok, owner := ownerIsAdmin(d); !ok {
				why = "owned by " + owner + ", not by SYSTEM or Administrators"
			}
		}
		if why == "" {
			return nil
		}
		aside := d + ".moved-" + stamp
		if err := os.Rename(d, aside); err != nil {
			return fmt.Errorf("%s is %s and could not be moved aside: %v", d, why, err)
		}
		say(fmt.Sprintf("%s was %s: moved aside to %s (kept, not used)", d, why, aside))
	}
	if err := os.Mkdir(d, 0o755); err != nil {
		return fmt.Errorf("%s could not be made: %v", d, err)
	}
	// looked at again: a plain folder (nothing swapped in between)
	if fi, err := os.Lstat(d); err != nil || !fi.IsDir() || isReparse(d, fi) {
		return fmt.Errorf("%s changed while it was being made", d)
	}
	return nil
}

// icacls on the folder itself (/L: a link is never followed), each command in turn
func setACL(say func(string), d string, cmds [][]string) error {
	for _, c := range cmds {
		args := append(append([]string{d}, c...), "/L", "/Q")
		if out, err := icaclsFn(args...); err != nil {
			if c[0] == "/setowner" {
				// the folder was made by this (elevated) step: its owner is already this administrator's; logged only
				say(fmt.Sprintf("icacls %s: %v %s (the owner is left as it is)", strings.Join(args, " "), err, out))
				continue
			}
			return fmt.Errorf("icacls %s: %v %s", strings.Join(args, " "), err, out)
		}
		say("icacls " + strings.Join(args, " "))
	}
	return nil
}

// a file written anew: whatever is at its path (a link, a hard link) is removed first, then created exclusively
func writeFresh(p string, b []byte) error {
	if err := os.Remove(p); err != nil && !os.IsNotExist(err) {
		return err
	}
	h, err := os.OpenFile(p, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o644)
	if err != nil {
		return err
	}
	if _, err := h.Write(b); err != nil {
		h.Close()
		return err
	}
	return h.Close()
}
