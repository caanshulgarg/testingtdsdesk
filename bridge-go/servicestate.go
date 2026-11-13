// FinCom Bridge 2.5.16: the Windows service's settings and state in its own folder, %ProgramData%\FinCom Bridge\state\
// <owner SID>\ (or a folder of the same kind the elevated step made fresh and recorded in HKLM), made by the installer
// or by the service itself (both elevated): SYSTEM and Administrators may change it, the owner may read it (the tray
// icon reads the settings), nobody else may. Until 2.5.15 the service kept them in the owner's %LOCALAPPDATA%\TDS Desk
// Bridge.
//
// The service never runs from a folder or settings file its owner may change: until its own folder is ready (the
// owner recorded, the folder made safe, the earlier files copied once) it does not start the bridge, says why in
// Windows' event log, and tries again every minute (servicestate_windows.go).
//
// The one copy from the earlier folder is read with the owner's rights (impersonated: nothing the owner may not read
// is copied), refuses links and junctions at every level, leaves out the bridge's logs and settings files, and stops
// at serviceCopyMaxBytes / serviceCopyMaxFiles. From the earlier settings file only plain choices and the browsers' keys
// are taken (serviceSettingsAllowed); FinCom's link waits until FinCom confirms it (cloudpending.go); the FVU, the update
// address and PostOnly are set again.
//
// Whatever the settings file says, the service also keeps these fixed (applyServicePolicy): only its owner's own Tally
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
	"sort"
	"strings"
)

// the service's folder for one owner
func serviceStateDir(sid string) string {
	if d := platRecordedStateDir(sid); d != "" {
		return d // made fresh by the elevated step when the usual place was not safe (HKLM StateDir)
	}
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
	if str(v) == "" || !re(`^[A-Za-z0-9][\w.-]{0,63}$`).MatchString(b) || strings.Contains(b, "..") || winDeviceName(b) {
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

// the bridge's own logs and settings files (never copied with the folder: the settings go through serviceSettingsFrom)
var (
	reOwnLogName      = re(`(?i)^(tds|go)-bridge\.log(\..+)?$`)
	reOwnSettingsName = re(`(?i)^(tds|go)-bridge\.config\.json(\..+)?$`)
)

// the copy's limits (variables for the tests)
var (
	serviceCopyMaxBytes int64 = 4 << 30
	serviceCopyMaxFiles       = 200000
)

// how the old folder is read. On Windows the service reads it with its owner's rights only (servicestate_windows.go:
// impersonated), so nothing the owner may not read is ever copied; links and junctions are refused at every level
// either way. The default (other systems, tests): the process's own rights
type treeReader interface {
	Lstat(p string) (os.FileInfo, error)
	ReadDir(p string) ([]os.DirEntry, error)
	Open(p string) (*os.File, error) // without following a link (openNoLink)
}

type osTree struct{}

func (osTree) Lstat(p string) (os.FileInfo, error)     { return os.Lstat(p) }
func (osTree) ReadDir(p string) ([]os.DirEntry, error) { return os.ReadDir(p) }
func (osTree) Open(p string) (*os.File, error)         { return openNoLink(p, false) }

// the plain files of src copied into dst (made new, never over a file): every folder and file looked at without following
// a link or junction (and opened the same way); a link, a junction, any other kind, a Windows device name and a file
// with more than one name are left out and named in skipped; the copy stops at serviceCopyMaxBytes / MaxFiles
func copyPlainTree(rd treeReader, src, dst string, skip func(rel string) bool) (copied int, skipped []string, err error) {
	var bytes int64
	full := false
	var walk func(rel string, depth int) error
	walk = func(rel string, depth int) error {
		if depth > 16 {
			skipped = append(skipped, rel+" (too deep)")
			return nil
		}
		dp := filepath.Join(src, rel)
		if fi, err := rd.Lstat(dp); err != nil || !fi.IsDir() || isReparse(dp, fi) {
			skipped = append(skipped, rel+" (not a plain folder)")
			return nil
		}
		ents, err := rd.ReadDir(dp)
		if err != nil {
			return err
		}
		for _, e := range ents {
			if full {
				return nil
			}
			r := filepath.Join(rel, e.Name())
			if skip != nil && skip(r) {
				continue
			}
			if winDeviceName(e.Name()) {
				skipped = append(skipped, r+" (a device name)")
				continue
			}
			p := filepath.Join(src, r)
			fi, err := rd.Lstat(p)
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
				if copied >= serviceCopyMaxFiles || bytes+fi.Size() > serviceCopyMaxBytes {
					full = true
					skipped = append(skipped, fmt.Sprintf("the rest (more than %d files or %d MB)", serviceCopyMaxFiles, serviceCopyMaxBytes>>20))
					return nil
				}
				n, why := copyPlainFile(rd, p, filepath.Join(dst, r), fi)
				if why != "" {
					skipped = append(skipped, r+" ("+why+")")
					continue
				}
				bytes += n
				copied++
			default:
				skipped = append(skipped, r+" (not a plain file)")
			}
		}
		return nil
	}
	if fi, err := rd.Lstat(src); err != nil || !fi.IsDir() || isReparse(src, fi) {
		return 0, nil, errors.New(src + " is not a plain folder")
	}
	err = walk("", 0)
	return copied, skipped, err
}

// one plain file copied: opened without following a link, the one looked at, one name only, no more than its size;
// its bytes ("" when copied)
func copyPlainFile(rd treeReader, from, to string, fi os.FileInfo) (int64, string) {
	f, err := rd.Open(from)
	if err != nil {
		return 0, "not opened"
	}
	defer f.Close()
	st, err := f.Stat()
	if err != nil || !os.SameFile(fi, st) {
		return 0, "changed while it was opened"
	}
	if linkCount(f) > 1 {
		return 0, "more than one name"
	}
	h, err := os.OpenFile(to, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o644)
	if os.IsExist(err) {
		return 0, "" // copied by an earlier try
	}
	if err != nil {
		return 0, "not written: " + err.Error()
	}
	n, err := io.Copy(h, io.LimitReader(f, st.Size()))
	if cerr := h.Close(); err == nil {
		err = cerr
	}
	if err != nil {
		_ = os.Remove(to)
		return 0, "not written: " + err.Error()
	}
	return n, ""
}

// the old folder's files copied into the service's folder once (until its marker is written: a copy cut short is
// finished at the next try); the bridge's logs and settings files are not copied
const serviceCopiedMarker = "copied-from-user-folder.txt"

func copyServiceHome(rd treeReader, old, dir string, log func(string)) error {
	marker := filepath.Join(dir, serviceCopiedMarker)
	if exists(marker) {
		return nil
	}
	if old == "" || pathInside(old, dir) {
		return saveFile(marker, "nothing to copy\r\n"+nowS()+"\r\n")
	}
	if _, err := rd.Lstat(old); err != nil {
		return saveFile(marker, "nothing to copy\r\n"+nowS()+"\r\n")
	}
	n, skipped, err := copyPlainTree(rd, old, dir, func(rel string) bool {
		b := filepath.Base(rel)
		return reOwnLogName.MatchString(b) || reOwnSettingsName.MatchString(b) || rel == serviceCopiedMarker
	})
	log(fmt.Sprintf("Service state: %d files copied from %s into %s (the old folder is kept as it was and not read by the service any more)", n, logPath(old), logPath(dir)))
	if len(skipped) > 0 {
		if len(skipped) > 20 {
			skipped = append(skipped[:20], fmt.Sprintf("and %d more", len(skipped)-20))
		}
		for i := range skipped {
			skipped[i] = logPath(skipped[i])
		}
		log("Service state: left out: " + strings.Join(skipped, ", "))
	}
	if err != nil {
		return err
	}
	return saveFile(marker, old+"\r\n"+nowS()+"\r\n")
}

// the settings the service takes from a settings file it does not protect (the owner's folder of an earlier version):
// these only. The link to FinCom (CloudUrl, CloudKey) is kept apart until FinCom confirms it (cloudpending.go); the
// FVU, the update address, FinCom's address (FinComUrl: the setup sets it from its own build; the security review's
// L1) and the PostOnly list are set again by the setup, the owner or FinCom
var serviceSettingsAllowed = []string{"Port", "TallyPorts", "FallbackPorts", "PairWindowMin", "GentleMs", "StatusCacheSec", "TallyTimeoutSec",
	"KeepInStep", "KeepSchedule", "KeepDailyAt", "KeepModes", "KeepCompanies", "KeepFrom", "KeepLightMin", "KeepWatchSec",
	"KeepOfficeFrom", "KeepOfficeTo", "SyncCompanies", "InstanceId", "Mode", "ClaimMain",
	// the browsers' keys: a key only lets a page act for this same owner, whose file it was, so a browser that works
	// keeps working until it pairs again (browserkeys.go)
	"Key", "PairedBrowsers", "LegacyKeyRetired"}

// the setup's note in the service's settings: the owner's earlier settings file, to be read at the service's first
// start with the owner's rights (the owner was not signed in when the setup ran)
const earlierSettingsKey = "EarlierSettingsFrom"

// the allowed settings of a file the service does not protect (opened without following a link, 1 MB at most); the
// names left out are logged (never their values)
func serviceSettingsFrom(rd treeReader, path string, log func(string)) *Ordered {
	out := newOrdered()
	f, err := rd.Open(path)
	if err != nil {
		return out
	}
	b, err := io.ReadAll(io.LimitReader(f, 1<<20))
	f.Close()
	in := newOrdered()
	if err != nil || in.UnmarshalText(string(b)) != nil {
		log("Service state: the earlier settings " + logPath(path) + " could not be read; the standard settings are used")
		return out
	}
	allowed := map[string]bool{}
	for _, k := range serviceSettingsAllowed {
		allowed[k] = true
	}
	// the link to FinCom: kept apart until FinCom confirms it is this computer's (cloudpending.go)
	pend := map[string]bool{"CloudUrl": true, "CloudKey": true, "CloudKeyGo": true}
	if u := str(in.Get("CloudUrl")); reCloudURL.MatchString(u) {
		k := str(in.Get("CloudKeyGo"))
		if k == "" || unprotectKey(k) == "" {
			k = str(in.Get("CloudKey"))
		}
		if k != "" {
			out.Set("PendingCloudUrl", u)
			out.Set("PendingCloudKey", k)
		}
	}
	var left []string
	for _, k := range in.keys {
		switch {
		case allowed[k]:
			out.Set(k, in.Get(k))
		case pend[k]:
		default:
			left = append(left, k)
		}
	}
	if len(left) > 0 {
		sort.Strings(left)
		log("Service state: from the earlier settings only the plain choices are kept; set again by the setup, the owner or FinCom: " + cutRunes(strings.Join(left, ", "), 600))
	}
	return out
}

// a path or name as the log shows it: one line, cut
func logPath(p string) string { return logOrigin(p) }

// a Windows device name (CON, PRN, AUX, NUL, COM1-9, LPT1-9, also with an extension or trailing dots and spaces)
func winDeviceName(name string) bool {
	b := strings.ToUpper(strings.TrimRight(name, ". "))
	if i := strings.IndexByte(b, '.'); i >= 0 {
		b = b[:i]
	}
	b = strings.TrimRight(b, " ")
	switch b {
	case "CON", "PRN", "AUX", "NUL", "CONIN$", "CONOUT$":
		return true
	}
	if len(b) == 4 && (strings.HasPrefix(b, "COM") || strings.HasPrefix(b, "LPT")) && b[3] >= '0' && b[3] <= '9' {
		return true
	}
	return len(b) > 3 && (strings.HasPrefix(b, "COM") || strings.HasPrefix(b, "LPT")) && strings.ContainsAny(b[3:], "¹²³")
}

// the service's command line: this program and its settings file, each quoted whole (createService's form)
func serviceCommandLine(exe, cfgPath string) string {
	return `"` + exe + `" service --config "` + cfgPath + `"`
}
