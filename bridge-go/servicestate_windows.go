//go:build windows

// FinCom Bridge 2.5.16 (servicestate.go): the service's folder, made and given its permissions by the elevated steps
// only (the setup's install step, the service's own start); the one copy of the earlier folder read with the owner's
// rights; the bridge not started until the folder is ready.
package main

import (
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"golang.org/x/sys/windows"
	"golang.org/x/sys/windows/registry"
	"golang.org/x/sys/windows/svc/eventlog"
	"golang.org/x/sys/windows/svc/mgr"
)

// the owner the install recorded in HKLM (administrators only)
func platServiceOwner() (string, string) {
	k, err := registry.OpenKey(registry.LOCAL_MACHINE, regKey, registry.QUERY_VALUE|registry.WOW64_64KEY)
	if err != nil {
		return "", ""
	}
	defer k.Close()
	name, _, _ := k.GetStringValue("Owner")
	sid, _, _ := k.GetStringValue("OwnerSid")
	return name, sid
}

// bridge 1.15.0's folder in the owner's profile (the earlier versions' folder)
func platServiceOldHome(sid string) string {
	if sid == "" {
		return ""
	}
	if p := profileOf(sid); p != "" {
		return filepath.Join(p, `AppData\Local\TDS Desk Bridge`)
	}
	return ""
}

// the service's folder the elevated step made fresh (HKLM StateDir), when it is still a plain folder of an administrator's
func platRecordedStateDir(sid string) string {
	k, err := registry.OpenKey(registry.LOCAL_MACHINE, regKey, registry.QUERY_VALUE|registry.WOW64_64KEY)
	if err != nil {
		return ""
	}
	defer k.Close()
	d, _, _ := k.GetStringValue("StateDir")
	if d == "" || !strings.EqualFold(filepath.Base(d), sid) {
		return ""
	}
	return d
}

func validSid(sid string) bool {
	return strings.HasPrefix(sid, "S-1-5-") && !strings.ContainsAny(sid, `\/:*?"<>|. `)
}

// a folder that is plain (no link or junction) and owned by SYSTEM or Administrators
func adminPlainFolder(d string) bool {
	fi, err := os.Lstat(d)
	if err != nil || !fi.IsDir() || isReparse(d, fi) {
		return false
	}
	ok, _ := ownerIsAdmin(d)
	return ok
}

// the service's folder made safe: the usual place (%ProgramData%\FinCom Bridge\state\<SID>: SYSTEM and Administrators
// change it, the owner reads it), its folders above it (Users read). Anything at those paths that is not a plain
// folder of an administrator's is never used: a new folder is made instead, under a name of its own made fresh
// (%ProgramData%\FinCom Bridge state <random>\<SID>), and recorded in HKLM (StateDir)
func prepareServiceStateDir(sid string, log func(string)) (string, error) {
	if !validSid(sid) {
		return "", errors.New("the owner's Windows account is not known")
	}
	say := func(s string) { log("Service state: " + s) }
	try := func(above []string, d string, fresh bool) error {
		for _, f := range above {
			if fresh {
				if err := os.Mkdir(f, 0o755); err != nil {
					return err // made fresh, or not at all
				}
			} else if !exists(f) {
				if err := os.Mkdir(f, 0o755); err != nil && !os.IsExist(err) {
					return err
				}
			}
			if !adminPlainFolder(f) {
				return errors.New(f + " is not a plain folder of an administrator's")
			}
			if err := setACL(say, f, serviceStateACL("")); err != nil {
				return err
			}
		}
		if !exists(d) {
			if err := os.Mkdir(d, 0o755); err != nil {
				return err
			}
		}
		if !adminPlainFolder(d) {
			return errors.New(d + " is not a plain folder of an administrator's")
		}
		if err := setACL(say, d, serviceStateACL(sid)); err != nil {
			return err
		}
		// what is already inside takes the folder's permissions again
		if out, err := icaclsFn(d+`\*`, "/reset", "/T", "/L", "/Q"); err != nil && !strings.Contains(strings.ToLower(out), "no files") {
			say("icacls " + d + `\* /reset /T /L /Q: ` + err.Error() + " " + out)
		}
		return nil
	}
	if d := platRecordedStateDir(sid); d != "" {
		if err := try([]string{filepath.Dir(d)}, d, false); err == nil {
			return d, nil
		}
	}
	base := filepath.Join(programDataDir(), "FinCom Bridge")
	usual := filepath.Join(base, "state", sid)
	err := try([]string{base, filepath.Join(base, "state")}, usual, false)
	if err == nil {
		return usual, nil
	}
	say("the usual folder " + usual + " is not used (" + err.Error() + "); a new one is made")
	for i := 0; i < 5; i++ {
		top := filepath.Join(programDataDir(), "FinCom Bridge state "+randHex16()[:8])
		d := filepath.Join(top, sid)
		if err = try([]string{top}, d, true); err == nil {
			if k, _, kerr := registry.CreateKey(registry.LOCAL_MACHINE, regKey, registry.ALL_ACCESS|registry.WOW64_64KEY); kerr == nil {
				_ = k.SetStringValue("StateDir", d)
				k.Close()
			}
			return d, nil
		}
	}
	return "", err
}

// the install's record and the service's command line name the settings in the service's folder
func recordServiceState(home, cfgPath string) {
	if k, _, err := registry.CreateKey(registry.LOCAL_MACHINE, regKey, registry.ALL_ACCESS|registry.WOW64_64KEY); err == nil {
		_ = k.SetStringValue("Home", home)
		_ = k.SetStringValue("Config", cfgPath)
		k.Close()
	}
	m, err := mgr.Connect()
	if err != nil {
		return
	}
	defer m.Disconnect()
	s, err := m.OpenService(serviceName)
	if err != nil {
		return
	}
	defer s.Close()
	if c, err := s.Config(); err == nil && !strings.Contains(strings.ToLower(c.BinaryPathName), strings.ToLower(cfgPath)) {
		if i := strings.Index(c.BinaryPathName, " service"); i > 0 {
			c.BinaryPathName = c.BinaryPathName[:i] + ` service --config "` + cfgPath + `"`
			_ = s.UpdateConfig(c)
		}
	}
}

// --- the earlier folder read with the owner's rights: each look and each open is made on a thread impersonating the
// owner (a token of the owner's signed-in session), so nothing the owner may not read is ever reached; the handles
// opened then are read as the service
type ownerTree struct{ imp windows.Token }

func (o ownerTree) as(fn func()) error {
	runtime.LockOSThread()
	defer runtime.UnlockOSThread()
	if err := windows.SetThreadToken(nil, o.imp); err != nil {
		return err
	}
	defer windows.RevertToSelf()
	fn()
	return nil
}
func (o ownerTree) Lstat(p string) (fi os.FileInfo, err error) {
	if e := o.as(func() { fi, err = os.Lstat(p) }); e != nil {
		return nil, e
	}
	return
}
func (o ownerTree) ReadDir(p string) (l []os.DirEntry, err error) {
	if e := o.as(func() { l, err = os.ReadDir(p) }); e != nil {
		return nil, e
	}
	return
}
func (o ownerTree) Open(p string) (f *os.File, err error) {
	if e := o.as(func() { f, err = openNoLink(p, false) }); e != nil {
		return nil, e
	}
	return
}

// the owner's rights to read with: an impersonation token from the owner's signed-in session
func ownerReader() (ownerTree, func(), error) {
	tok, err := ownerSessionToken()
	if err != nil {
		return ownerTree{}, nil, err
	}
	defer tok.Close()
	var imp windows.Token
	if err := windows.DuplicateTokenEx(tok, windows.TOKEN_IMPERSONATE|windows.TOKEN_QUERY|windows.TOKEN_DUPLICATE, nil, windows.SecurityImpersonation, windows.TokenImpersonation, &imp); err != nil {
		return ownerTree{}, nil, err
	}
	return ownerTree{imp: imp}, func() { imp.Close() }, nil
}

// the service's start: its own folder ready (the owner recorded, the folder made safe, the earlier folder's settings
// and files copied once with the owner's rights); false: not ready (said in the event log), the bridge is not started
func serviceStateAtStart() (bool, string) {
	_, sid := platServiceOwner()
	if !validSid(sid) {
		return false, "the Windows user this service works for is not recorded; run the FinCom Bridge setup again"
	}
	var lines []string
	log := func(s string) { lines = append(lines, s) }
	flush := func() {
		for _, l := range lines {
			writeLog(l)
		}
	}
	d, err := prepareServiceStateDir(sid, log)
	if err != nil {
		return false, "its folder could not be made safe (" + err.Error() + ")"
	}
	cfgName := filepath.Base(ConfigPath)
	if !reOwnSettingsName.MatchString(cfgName) {
		cfgName = "tds-bridge.config.json"
	}
	cfgPath := filepath.Join(d, cfgName)
	old := platServiceOldHome(sid)
	needCopy := !exists(filepath.Join(d, serviceCopiedMarker)) && old != "" && exists(old)
	needSettings := !exists(cfgPath)
	if needCopy || needSettings {
		rd, done, err := ownerReader()
		if err != nil {
			return false, "its earlier settings and files are read with the rights of the Windows user it works for, who is not signed in to this computer now; it starts once that user signs in"
		}
		defer done()
		home := Home
		Home = d // the copy's own log lines go into the new folder
		if needSettings {
			src := ConfigPath
			if pathInside(src, d) || !exists(src) {
				src = filepath.Join(old, cfgName)
			}
			c := serviceSettingsFrom(rd, src, log)
			b, _ := c.MarshalJSON()
			if werr := saveFile(cfgPath, string(b)); werr != nil {
				Home = home
				return false, "its settings could not be written in " + d + " (" + werr.Error() + ")"
			}
		}
		if needCopy {
			if cerr := copyServiceHome(rd, old, d, log); cerr != nil {
				Home = home
				return false, "its earlier files could not be copied (" + cerr.Error() + ")"
			}
		}
		Home = home
	}
	if !pathInside(ConfigPath, d) {
		recordServiceState(d, cfgPath)
	}
	setPaths(cfgPath, d)
	logOff.Store(false)
	flush()
	writeLog("Service state: the settings and state are kept in " + d + " (changed by Windows and administrators only)")
	return true, ""
}

// the service waits for its folder: nothing is written anywhere until then; the reason in Windows' event log (once per
// reason), tried again every minute
func serviceWaitForState() bool {
	said := ""
	for !stopping() {
		ok, why := serviceStateAtStart()
		if ok {
			return true
		}
		if why != said {
			said = why
			if el, err := eventlog.Open(serviceName); err == nil {
				_ = el.Error(1, "FinCom Bridge did not start: "+why+". It tries again every minute.")
				el.Close()
			}
		}
		sleepOrStop(time.Minute)
	}
	return false
}
