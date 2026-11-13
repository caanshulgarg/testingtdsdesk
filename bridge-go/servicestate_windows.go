//go:build windows

// FinCom Bridge 2.5.16 (servicestate.go): the service's folder in %ProgramData%\FinCom Bridge\state\<owner SID>\, made
// and given its permissions by the elevated steps only (the setup's install step, the service's own start).
package main

import (
	"errors"
	"path/filepath"
	"strings"
	"time"

	"golang.org/x/sys/windows/registry"
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

// bridge 1.15.0's folder in the owner's profile (read only by the service: test mode's comparison, the old bridge's files)
func platServiceOldHome(sid string) string {
	if sid == "" {
		return ""
	}
	if p := profileOf(sid); p != "" {
		return filepath.Join(p, `AppData\Local\TDS Desk Bridge`)
	}
	return ""
}

// the service's folder made safe: %ProgramData%\FinCom Bridge and its state folder (SYSTEM and Administrators change
// them, Users read), the owner's folder in it (SYSTEM and Administrators change it, the owner reads it, nobody else).
// Anything at those paths that is not a plain folder of an administrator's is moved aside first (folders.go safeFolder)
func prepareServiceStateDir(sid string, log func(string)) (string, error) {
	if !strings.HasPrefix(sid, "S-1-5-") || strings.ContainsAny(sid, `\/:*?"<>|`) {
		return "", errors.New("the owner's Windows account is not known")
	}
	base := filepath.Join(programDataDir(), "FinCom Bridge")
	st := filepath.Join(base, "state")
	d := filepath.Join(st, sid)
	stamp := time.Now().Format("20060102-150405")
	say := func(s string) { log("Service state: " + s) }
	for _, f := range []string{base, st} {
		if err := safeFolder(f, true, stamp, say); err != nil {
			return "", err
		}
		if err := setACL(say, f, serviceStateACL("")); err != nil {
			return "", err
		}
	}
	if err := safeFolder(d, true, stamp, say); err != nil {
		return "", err
	}
	if err := setACL(say, d, serviceStateACL(sid)); err != nil {
		return "", err
	}
	// what is already inside (an earlier version's copy) takes the folder's permissions again
	if out, err := icaclsFn(d+`\*`, "/reset", "/T", "/L", "/Q"); err != nil && !strings.Contains(strings.ToLower(out), "no files") {
		say("icacls " + d + `\* /reset /T /L /Q: ` + err.Error() + " " + out)
	}
	return d, nil
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

// the service's first start of 2.5.16 (a bridge that updated itself never ran the setup): its settings and state moved
// into its own folder, once; a step that fails is logged and tried again at the next start
func serviceStateAtStart(log func(string)) {
	name, sid := platServiceOwner()
	if sid == "" {
		log("Service state: the owner is not recorded; the settings stay at " + ConfigPath)
		return
	}
	_ = name
	want := serviceStateDir(sid)
	if pathInside(ConfigPath, want) {
		return
	}
	d, err := prepareServiceStateDir(sid, log)
	if err != nil {
		log("Service state: the folder " + want + " could not be made safe (" + err.Error() + "); tried again at the next start")
		return
	}
	cfgName := filepath.Base(ConfigPath)
	if err := copyServiceHome(filepath.Dir(ConfigPath), d, log); err != nil || !exists(filepath.Join(d, cfgName)) {
		log("Service state: the settings could not be copied into " + d + "; tried again at the next start")
		return
	}
	cfgPath := filepath.Join(d, cfgName)
	recordServiceState(d, cfgPath)
	setPaths(cfgPath, d)
	log("Service state: the settings and state are now kept in " + d + " (changed by Windows and administrators only)")
}
