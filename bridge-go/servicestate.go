// FinCom Bridge 2.5.16: the Windows service's settings and state in %ProgramData%\FinCom Bridge\state\<owner SID>\,
// made by the installer or by the service itself (both elevated): SYSTEM and Administrators may change it, the owner may
// read it (the tray icon reads the settings), nobody else may. Until 2.5.15 the service kept them in the owner's
// %LOCALAPPDATA%\TDS Desk Bridge. At the first start of 2.5.16 (or its setup) the files there are copied over once
// (plain files only: links, junctions and files with more than one name are left out, and the bridge's logs stay where
// they are); the old folder is left as it was and is no longer read by the service.
//
// Whatever the settings file says, the service also keeps these fixed (servicePolicy): only its owner's own Tally
// (OnlyMySession), its owner as the install recorded it in HKLM (Owner, OwnerSid), Tally on this computer (TallyHost
// 127.0.0.1), no development origins, and its log, copy and postings folders inside its own folder (LogFile, SyncDir,
// JobsDir by their plain names), bridge 1.15.0's folder from the owner's profile (PsHome).
package main

import (
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
)

// the service's folder for one owner
func serviceStateDir(sid string) string {
	return filepath.Join(programDataDir(), "FinCom Bridge", "state", sid)
}

// the permissions (icacls, folders.go setACL): SYSTEM and Administrators change the folder; the owner (sid) reads its
// own folder only; for the folders above it (sid ""), Users read
func serviceStateACL(sid string) [][]string {
	reader := sidUsers + ":(OI)(CI)RX"
	if sid != "" {
		reader = "*" + sid + ":(OI)(CI)RX"
	}
	return [][]string{{"/reset"}, {"/inheritance:r", "/grant:r", sidSystem + ":(OI)(CI)F", sidAdmins + ":(OI)(CI)F", reader}, {"/setowner", sidAdmins}}
}

// the owner the install recorded (HKLM; the platform's), and bridge 1.15.0's folder in that owner's profile
var (
	serviceOwnerFn   = platServiceOwner
	serviceOldHomeFn = platServiceOldHome
)

// a folder or file of the service's own: its plain name under Home (the default when the setting is no plain name)
func underHome(v any, def string) string {
	b := filepath.Base(strings.ReplaceAll(str(v), `\`, "/"))
	if str(v) == "" || !re(`^[A-Za-z0-9][\w.-]{0,63}$`).MatchString(b) || strings.Contains(b, "..") {
		b = def
	}
	return filepath.Join(Home, b)
}

// the settings the service keeps fixed, whatever the file says (a no-op for a bridge that is not the service)
func applyServicePolicy(c *Ordered) {
	if runMode != "service" || c == nil {
		return
	}
	c.Set("OnlyMySession", true)
	c.Set("DevOrigins", false)
	c.Set("TallyHost", "127.0.0.1")
	if name, sid := serviceOwnerFn(); sid != "" {
		c.Set("OwnerSid", sid)
		if name != "" {
			c.Set("Owner", name)
		}
	}
	c.Set("LogFile", underHome(c.Get("LogFile"), "tds-bridge.log"))
	c.Set("SyncDir", underHome(c.Get("SyncDir"), "sync"))
	c.Set("JobsDir", underHome(c.Get("JobsDir"), "jobs"))
	c.Set("PsHome", serviceOldHomeFn(str(c.Get("OwnerSid"))))
}

// "only my own Tally": always for the service, else as set
func onlyMySession() bool {
	return runMode == "service" || cfgB("OnlyMySession")
}

// p is inside dir (or dir itself), compared without regard to case
func pathInside(p, dir string) bool {
	p, dir = strings.ToLower(filepath.Clean(p)), strings.ToLower(filepath.Clean(dir))
	return p == dir || strings.HasPrefix(p, dir+string(os.PathSeparator))
}

// the bridge's own logs (left where they are when the folder is copied)
var reOwnLogName = re(`(?i)^(tds|go)-bridge\.log(\..+)?$`)

// the plain files of src copied into dst (made new, never over a file): folders are walked without following a link or
// junction; a link, a junction, any other kind, and a file with more than one name are left out and named in skipped
func copyPlainTree(src, dst string, skip func(rel string) bool) (copied int, skipped []string, err error) {
	var walk func(rel string, depth int) error
	walk = func(rel string, depth int) error {
		if depth > 16 {
			skipped = append(skipped, rel+" (too deep)")
			return nil
		}
		ents, err := os.ReadDir(filepath.Join(src, rel))
		if err != nil {
			return err
		}
		for _, e := range ents {
			r := filepath.Join(rel, e.Name())
			if skip != nil && skip(r) {
				continue
			}
			p := filepath.Join(src, r)
			fi, err := os.Lstat(p)
			if err != nil {
				skipped = append(skipped, r)
				continue
			}
			switch {
			case isReparse(p, fi):
				skipped = append(skipped, r+" (a link or junction)")
			case fi.IsDir():
				if err := os.Mkdir(filepath.Join(dst, r), 0o755); err != nil && !os.IsExist(err) {
					return err
				}
				if di, err := os.Lstat(filepath.Join(dst, r)); err != nil || !di.IsDir() || isReparse(filepath.Join(dst, r), di) {
					return fmt.Errorf("%s changed while it was being made", filepath.Join(dst, r))
				}
				if err := walk(r, depth+1); err != nil {
					return err
				}
			case fi.Mode().IsRegular():
				if why := copyPlainFile(p, filepath.Join(dst, r), fi); why != "" {
					skipped = append(skipped, r+" ("+why+")")
					continue
				}
				copied++
			default:
				skipped = append(skipped, r+" (not a plain file)")
			}
		}
		return nil
	}
	if fi, err := os.Lstat(src); err != nil || !fi.IsDir() || isReparse(src, fi) {
		return 0, nil, errors.New(src + " is not a plain folder")
	}
	err = walk("", 0)
	return copied, skipped, err
}

// one plain file copied: opened without following a link, the one looked at, one name only; "" when copied
func copyPlainFile(from, to string, fi os.FileInfo) string {
	f, err := openNoLink(from, false)
	if err != nil {
		return "not opened"
	}
	defer f.Close()
	st, err := f.Stat()
	if err != nil || !os.SameFile(fi, st) {
		return "changed while it was opened"
	}
	if linkCount(f) > 1 {
		return "more than one name"
	}
	h, err := os.OpenFile(to, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o644)
	if os.IsExist(err) {
		return "" // copied by an earlier try
	}
	if err != nil {
		return "not written: " + err.Error()
	}
	_, err = io.Copy(h, f)
	if cerr := h.Close(); err == nil {
		err = cerr
	}
	if err != nil {
		_ = os.Remove(to)
		return "not written: " + err.Error()
	}
	return ""
}

// the old folder's files copied into the service's folder once (until its marker is written: a copy cut short is
// finished at the next try); the bridge's logs stay where they are
const serviceCopiedMarker = "copied-from-user-folder.txt"

func copyServiceHome(old, dir string, log func(string)) error {
	marker := filepath.Join(dir, serviceCopiedMarker)
	if exists(marker) || old == "" || !exists(old) || pathInside(old, dir) {
		return nil
	}
	n, skipped, err := copyPlainTree(old, dir, func(rel string) bool {
		return reOwnLogName.MatchString(filepath.Base(rel)) || rel == serviceCopiedMarker
	})
	log(fmt.Sprintf("Service state: %d files copied from %s into %s (the old folder is kept as it was and not read by the service any more)", n, old, dir))
	if len(skipped) > 0 {
		if len(skipped) > 20 {
			skipped = append(skipped[:20], fmt.Sprintf("and %d more", len(skipped)-20))
		}
		log("Service state: left out (not plain files): " + strings.Join(skipped, ", "))
	}
	if err != nil {
		return err
	}
	return saveFile(marker, old+"\r\n"+nowS()+"\r\n")
}
