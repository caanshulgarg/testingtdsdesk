//go:build windows

// The Windows service: started by Windows at boot and started again by Windows if it stops (recovery: after 5, 10 and 30
// seconds); it starts the tray icon in its owner's session; an update that does not start properly is undone. And
// install / uninstall, which the installer runs.
package main

import (
	"encoding/base64"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
	"golang.org/x/sys/windows/registry"
	"golang.org/x/sys/windows/svc"
	"golang.org/x/sys/windows/svc/mgr"
)

const serviceName = "FinComBridge"

func b64(b []byte) string   { return base64.StdEncoding.EncodeToString(b) }
func unb64(s string) []byte { b, _ := base64.StdEncoding.DecodeString(s); return b }

type service struct{}

func (service) Execute(args []string, req <-chan svc.ChangeRequest, st chan<- svc.Status) (bool, uint32) {
	st <- svc.Status{State: svc.StartPending}
	done := make(chan int, 1)
	go func() {
		defer func() {
			if r := recover(); r != nil {
				writeLog(fmt.Sprint("The bridge stopped on an error: ", r))
				done <- 9
			}
		}()
		done <- runBridge(false)
	}()
	go updateHealth()
	go trayKeeper()
	st <- svc.Status{State: svc.Running, Accepts: svc.AcceptStop | svc.AcceptShutdown}
	for {
		select {
		case c := <-req:
			switch c.Cmd {
			case svc.Interrogate:
				st <- c.CurrentStatus
			case svc.Stop, svc.Shutdown:
				st <- svc.Status{State: svc.StopPending}
				writeLog("Stopping: Windows asked")
				requestStop(0)
				select {
				case <-done:
				case <-time.After(15 * time.Second):
				}
				return false, 0
			}
		case code := <-done:
			if code == 0 {
				return false, 0
			}
			// a restart asked for (the tray, an update) or a failure: Windows starts the service again (recovery); for a
			// restart asked for, a helper starts it too, so it never waits on Windows' recovery alone
			writeLog(fmt.Sprintf("The bridge stops to start again (code %d)", code))
			if code == 3 {
				startRestartHelper()
			}
			return true, uint32(code)
		}
	}
}

func runService(args []string) int {
	asService = true
	logEcho = false
	undoFailedUpdate()
	if err := svc.Run(serviceName, service{}); err != nil {
		writeLog("The service could not run: " + err.Error())
		return 1
	}
	return 0
}

// --- an update that does not start properly is undone: three starts without two healthy minutes put the old one back
func undoFailedUpdate() {
	exe, _ := os.Executable()
	dir := filepath.Dir(exe)
	pf, old := filepath.Join(dir, "update-pending.json"), filepath.Join(dir, "FinComBridge.old.exe")
	p := readObjFile(pf)
	if p == nil {
		return
	}
	n := toInt(p["starts"]) + 1
	if n > 3 && exists(old) {
		bad := filepath.Join(dir, "FinComBridge.failed.exe")
		_ = os.Remove(bad)
		if os.Rename(exe, bad) == nil && os.Rename(old, exe) == nil {
			_ = os.Remove(pf)
			_ = saveFile(filepath.Join(dir, "update-undone.json"), jsonText(M{"version": BridgeVersion, "back": p["from"], "at": nowS()}))
			os.Exit(5) // Windows starts the previous version again
		}
	}
	p["starts"] = n
	_ = saveFile(pf, jsonText(p))
}
func updateHealth() {
	exe, _ := os.Executable()
	pf := filepath.Join(filepath.Dir(exe), "update-pending.json")
	if !exists(pf) {
		return
	}
	sleepOrStop(2 * time.Minute)
	if stopping() {
		return
	}
	_ = os.Remove(pf)
	_ = os.Remove(filepath.Join(filepath.Dir(exe), "FinComBridge.old.exe"))
	writeLog("Update: FinCom Bridge " + BridgeVersion + " runs well; the previous version was removed")
}

// --- the tray icon in the owner's session(s): started by the service, and again if it stops; not after Quit
var (
	trayQuitMu sync.Mutex
	trayQuit   = map[int]bool{}
	trayPing   = map[int]time.Time{}
)

func trayAlive(session int) {
	trayQuitMu.Lock()
	trayPing[session] = time.Now()
	trayQuitMu.Unlock()
}
func trayQuitSession(session int) {
	trayQuitMu.Lock()
	trayQuit[session] = true
	trayQuitMu.Unlock()
}

func trayKeeper() {
	sleepOrStop(10 * time.Second)
	for !stopping() {
		live := map[int]bool{}
		for _, s := range sessions() {
			if s.id == 0 || s.state != windows.WTSActive || !sameUser(s.user, ownerName()) {
				continue
			}
			live[s.id] = true
			trayQuitMu.Lock()
			quit, ping := trayQuit[s.id], trayPing[s.id]
			trayQuitMu.Unlock()
			if quit || time.Since(ping) < 40*time.Second {
				continue
			}
			if err := startTrayIn(uint32(s.id)); err == nil {
				trayAlive(s.id) // give it time to start
			}
		}
		trayQuitMu.Lock()
		for id := range trayQuit {
			if !live[id] {
				delete(trayQuit, id) // signed out: the next sign-in gets the icon again
			}
		}
		trayQuitMu.Unlock()
		sleepOrStop(20 * time.Second)
	}
}

func startTrayIn(session uint32) error {
	var tok windows.Token
	if err := windows.WTSQueryUserToken(session, &tok); err != nil {
		return err
	}
	defer tok.Close()
	var env *uint16
	_ = windows.CreateEnvironmentBlock(&env, tok, false)
	if env != nil {
		defer windows.DestroyEnvironmentBlock(env)
	}
	exe, _ := os.Executable()
	cmd, _ := windows.UTF16PtrFromString(`"` + exe + `" tray`)
	desk, _ := windows.UTF16PtrFromString(`winsta0\default`)
	si := &windows.StartupInfo{Cb: uint32(unsafe.Sizeof(windows.StartupInfo{})), Desktop: desk}
	var pi windows.ProcessInformation
	err := windows.CreateProcessAsUser(tok, nil, cmd, nil, nil, false, windows.CREATE_UNICODE_ENVIRONMENT|windows.CREATE_NO_WINDOW, env, nil, si, &pi)
	if err != nil {
		return err
	}
	windows.CloseHandle(pi.Thread)
	windows.CloseHandle(pi.Process)
	return nil
}

// --- install (run by the installer, as an administrator)
type ownerInfo struct{ name, sid, profile, home string }

// the Windows user who runs the installer (the person signed in to this session, even when an administrator's password
// was typed to install)
func installingUser() (ownerInfo, error) {
	s := uint32(ownSession())
	name := wtsString(s, wtsUserName)
	dom := wtsString(s, wtsDomainName)
	if name == "" {
		return ownerInfo{}, errors.New("the signed-in Windows user could not be found")
	}
	full := name
	if dom != "" {
		full = dom + `\` + name
	}
	sid, _, _, err := windows.LookupSID("", full)
	if err != nil {
		return ownerInfo{}, err
	}
	o := ownerInfo{name: full, sid: sid.String()}
	o.profile = profileOf(o.sid)
	if o.profile == "" {
		return o, errors.New("the user's profile folder was not found")
	}
	o.home = filepath.Join(o.profile, `AppData\Local\TDS Desk Bridge`)
	return o, nil
}

func flagValue(args []string, name string) string {
	for i, a := range args {
		if a == "--"+name && i+1 < len(args) {
			return args[i+1]
		}
		if strings.HasPrefix(a, "--"+name+"=") {
			return strings.TrimPrefix(a, "--"+name+"=")
		}
	}
	return ""
}

func installLog(msg string) {
	fmt.Println(msg)
	if p := os.Getenv("ProgramData"); p != "" {
		_ = appendText(filepath.Join(p, "FinCom Bridge", "install.log"), time.Now().Format("2006-01-02 15:04:05")+"  "+msg+"\r\n")
	}
}

// the settings 1.15.0 kept that this bridge carries over (the key FinCom pairs with, the cloud, the copy's choices)
var carried = []string{"Key", "TallyHost", "TallyPorts", "OnlyMySession", "PairWindowMin", "GentleMs", "StatusCacheSec", "FallbackPorts", "TallyTimeoutSec", "AllowedOrigins",
	"KeepInStep", "CloudUrl", "CloudKey", "KeepSchedule", "KeepDailyAt", "KeepModes", "KeepCompanies", "KeepFrom", "KeepLightMin", "KeepWatchSec", "CloudWake", "SyncCompanies"}

func installCmd(args []string) int {
	mode := strings.ToLower(flagValue(args, "mode"))
	if mode != "test" && mode != "sole" {
		mode = "test"
	}
	fincom := flagValue(args, "fincom")
	o, err := installingUser()
	if err != nil {
		installLog("Install: " + err.Error())
		return 2
	}
	installLog(fmt.Sprintf("Install: FinCom Bridge %s for %s (%s), %s mode, folder %s", BridgeVersion, o.name, o.sid, mode, o.home))
	_ = os.MkdirAll(o.home, 0o755)
	stopService()
	psCfg := filepath.Join(o.home, "tds-bridge.config.json")
	var cfgPath string
	if mode == "test" {
		cfgPath = filepath.Join(o.home, "go-bridge.config.json")
		c := newOrdered()
		if exists(cfgPath) {
			_ = c.UnmarshalText(readText(cfgPath))
		} else if exists(psCfg) {
			pc := newOrdered()
			if pc.UnmarshalText(readText(psCfg)) == nil {
				for _, k := range carried {
					if pc.Has(k) {
						c.Set(k, pc.Get(k))
					}
				}
			}
		}
		c.Set("Mode", "test")
		c.Set("Port", float64(9101))
		c.Set("PsHome", o.home)
		c.Set("SyncDir", filepath.Join(o.home, "go-sync"))
		c.Set("JobsDir", filepath.Join(o.home, "go-jobs"))
		c.Set("LogFile", filepath.Join(o.home, "go-bridge.log"))
		setOwner(c, o, fincom)
		if err := writeOrdered(cfgPath, c); err != nil {
			installLog("Install: the settings could not be written: " + err.Error())
			return 3
		}
	} else {
		cfgPath = psCfg
		c := newOrdered()
		if exists(cfgPath) {
			_ = c.UnmarshalText(readText(cfgPath))
		}
		c.Set("Mode", "")
		c.Set("Port", float64(9100))
		c.Set("LogFile", filepath.Join(o.home, "tds-bridge.log"))
		setOwner(c, o, fincom)
		if err := writeOrdered(cfgPath, c); err != nil {
			installLog("Install: the settings could not be written: " + err.Error())
			return 3
		}
		removeOldBridge(o)
	}
	exe, _ := os.Executable()
	k, _, err := registry.CreateKey(registry.LOCAL_MACHINE, regKey, registry.ALL_ACCESS|registry.WOW64_64KEY)
	if err == nil {
		_ = k.SetStringValue("Home", o.home)
		_ = k.SetStringValue("Config", cfgPath)
		_ = k.SetStringValue("Owner", o.name)
		_ = k.SetStringValue("OwnerSid", o.sid)
		_ = k.SetStringValue("Mode", mode)
		_ = k.SetStringValue("Version", BridgeVersion)
		k.Close()
	}
	if err := createService(exe, cfgPath); err != nil {
		installLog("Install: the Windows service could not be made: " + err.Error())
		return 4
	}
	if err := startService(); err != nil {
		installLog("Install: the service did not start: " + err.Error())
		return 5
	}
	port := 9100
	if mode == "test" {
		port = 9101
	}
	for i := 0; i < 30; i++ {
		if tallyPortOpenAt(port) {
			installLog(fmt.Sprintf("Install: done; the bridge answers on 127.0.0.1:%d", port))
			return 0
		}
		time.Sleep(time.Second)
	}
	installLog("Install: the service runs but did not answer yet; see the bridge's log")
	return 0
}

func setOwner(c *Ordered, o ownerInfo, fincom string) {
	c.Set("Owner", o.name)
	c.Set("OwnerSid", o.sid)
	if fincom != "" {
		c.Set("FinComUrl", fincom)
	}
	if !c.Has("Key") || str(c.Get("Key")) == "" {
		c.Set("Key", newBridgeKey())
	}
}
func writeOrdered(path string, c *Ordered) error {
	b, err := c.MarshalJSON()
	if err != nil {
		return err
	}
	return saveFile(path, string(b))
}

func tallyPortOpenAt(port int) bool {
	cfgMu.Lock()
	Cfg.Set("TallyHost", "127.0.0.1")
	cfgMu.Unlock()
	return tallyPortOpen(port)
}

// the final install: bridge 1.15.0 is stopped and taken off (its files, settings and copy stay; this bridge uses them)
func removeOldBridge(o ownerInfo) {
	startup := filepath.Join(o.profile, `AppData\Roaming\Microsoft\Windows\Start Menu\Programs\Startup`)
	for _, f := range []string{"TDS Desk Tally Bridge.vbs", "FinCom Connector.lnk"} {
		p := filepath.Join(startup, f)
		if exists(p) {
			if err := os.Rename(p, filepath.Join(o.home, f+".replaced-by-go")); err != nil {
				_ = os.Remove(p)
			}
			installLog("Install: bridge 1.15.0 no longer starts at sign-in (" + f + ")")
		}
	}
	// the FinCom Connector's start at sign-in
	if k, err := registry.OpenKey(registry.USERS, o.sid+`\Software\Microsoft\Windows\CurrentVersion\Run`, registry.ALL_ACCESS); err == nil {
		names, _ := k.ReadValueNames(0)
		for _, n := range names {
			v, _, _ := k.GetStringValue(n)
			if strings.Contains(strings.ToLower(v), "fincomconnector.exe") || strings.Contains(strings.ToLower(v), "tdsbridge.ps1") {
				_ = k.DeleteValue(n)
				installLog("Install: removed the start at sign-in " + n)
			}
		}
		k.Close()
	}
	// the running bridge 1.15.0 of this user (its restarter, the bridge, its workers, the Connector)
	user := o.name
	if i := strings.LastIndex(user, `\`); i >= 0 {
		user = user[i+1:]
	}
	ps := `Get-CimInstance Win32_Process | Where-Object { ($_.CommandLine -like '*TDSBridge.ps1*' -or $_.CommandLine -like '*run-hidden.vbs*' -or $_.Name -eq 'FinComConnector.exe') } | ` +
		`Where-Object { (Invoke-CimMethod -InputObject $_ -MethodName GetOwner).User -eq '` + strings.ReplaceAll(user, "'", "''") + `' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue; $_.ProcessId }`
	for i := 0; i < 2; i++ { // twice: the restarter may start it again in between
		c := exec.Command("powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", ps)
		hideWindow(c)
		out, _ := c.CombinedOutput()
		if s := strings.TrimSpace(string(out)); s != "" {
			installLog("Install: stopped bridge 1.15.0 (process " + strings.Join(strings.Fields(s), ", ") + ")")
		}
		time.Sleep(time.Second)
	}
	old := filepath.Join(o.home, "TDSBridge.ps1")
	if exists(old) {
		if err := os.Rename(old, old+".replaced-by-go"); err == nil {
			installLog("Install: bridge 1.15.0's program kept as TDSBridge.ps1.replaced-by-go (put back on uninstall)")
		}
	}
	for _, f := range []string{"FinComConnector.exe"} {
		p := filepath.Join(o.home, f)
		if exists(p) {
			_ = os.Rename(p, p+".replaced-by-go")
		}
	}
}

func createService(exe, cfgPath string) error {
	m, err := mgr.Connect()
	if err != nil {
		return err
	}
	defer m.Disconnect()
	args := []string{"service", "--config", cfgPath}
	s, err := m.OpenService(serviceName)
	if err == nil {
		c, _ := s.Config()
		c.BinaryPathName = `"` + exe + `" service --config "` + cfgPath + `"`
		c.StartType = mgr.StartAutomatic
		c.DisplayName = "FinCom Bridge"
		c.Description = "Connects TallyPrime on this computer with FinCom (FinCom Bridge " + BridgeVersion + ")."
		if err := s.UpdateConfig(c); err != nil {
			// made again instead (the service is stopped; its settings were the old program's)
			_ = s.Delete()
			s.Close()
			for i := 0; i < 20; i++ {
				time.Sleep(500 * time.Millisecond)
				if s, err = m.CreateService(serviceName, exe, mgr.Config{DisplayName: "FinCom Bridge", StartType: mgr.StartAutomatic,
					Description: "Connects TallyPrime on this computer with FinCom (FinCom Bridge " + BridgeVersion + ")."}, args...); err == nil {
					break
				}
			}
			if err != nil {
				return err
			}
		}
	} else {
		s, err = m.CreateService(serviceName, exe, mgr.Config{DisplayName: "FinCom Bridge", StartType: mgr.StartAutomatic,
			Description: "Connects TallyPrime on this computer with FinCom (FinCom Bridge " + BridgeVersion + ")."}, args...)
		if err != nil {
			return err
		}
	}
	defer s.Close()
	_ = s.SetRecoveryActions([]mgr.RecoveryAction{{Type: mgr.ServiceRestart, Delay: 5 * time.Second}, {Type: mgr.ServiceRestart, Delay: 10 * time.Second}, {Type: mgr.ServiceRestart, Delay: 30 * time.Second}}, 86400)
	_ = s.SetRecoveryActionsOnNonCrashFailures(true)
	return nil
}
func startService() error {
	m, err := mgr.Connect()
	if err != nil {
		return err
	}
	defer m.Disconnect()
	s, err := m.OpenService(serviceName)
	if err != nil {
		return err
	}
	defer s.Close()
	return s.Start()
}
func stopService() {
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
	if st, err := s.Query(); err == nil && st.State != svc.Stopped {
		_ = s.SetRecoveryActions(nil, 0) // no restart while it is being stopped on purpose
		_, _ = s.Control(svc.Stop)
		for i := 0; i < 30; i++ {
			if st, err := s.Query(); err != nil || st.State == svc.Stopped {
				break
			}
			time.Sleep(500 * time.Millisecond)
		}
	}
}

// uninstall (run by the uninstaller): the service and the tray go; the bridge's folder (settings, copy, log) stays
func uninstallCmd(args []string) int {
	stopService()
	if m, err := mgr.Connect(); err == nil {
		if s, err := m.OpenService(serviceName); err == nil {
			_ = s.Delete()
			s.Close()
		}
		m.Disconnect()
	}
	home, mode := regString("Home"), regString("Mode")
	// the tray icons of every session
	c := exec.Command("taskkill.exe", "/F", "/FI", "IMAGENAME eq FinComBridge.exe", "/FI", fmt.Sprintf("PID ne %d", os.Getpid()))
	hideWindow(c)
	_ = c.Run()
	if mode == "sole" && home != "" {
		old := filepath.Join(home, "TDSBridge.ps1")
		if exists(old+".replaced-by-go") && !exists(old) {
			_ = os.Rename(old+".replaced-by-go", old)
			installLog("Uninstall: bridge 1.15.0's program put back; run Setup-FinCom-Bridge.bat to start it again")
		}
	}
	_ = registry.DeleteKey(registry.LOCAL_MACHINE, regKey)
	installLog("Uninstall: FinCom Bridge removed; its folder " + home + " (settings, copy, log) is kept")
	return 0
}

// FinComBridge.exe restart-service: waits until the service has stopped, then starts it (at most a minute)
func startRestartHelper() {
	exe, _ := os.Executable()
	c := exec.Command(exe, "restart-service")
	hideWindow(c)
	_ = c.Start()
}
func restartServiceCmd() int {
	m, err := mgr.Connect()
	if err != nil {
		return 1
	}
	defer m.Disconnect()
	s, err := m.OpenService(serviceName)
	if err != nil {
		return 1
	}
	defer s.Close()
	for i := 0; i < 120; i++ {
		time.Sleep(500 * time.Millisecond)
		st, err := s.Query()
		if err != nil {
			return 1
		}
		if st.State == svc.Running || st.State == svc.StartPending {
			return 0 // Windows' recovery was first
		}
		if st.State == svc.Stopped {
			if s.Start() == nil {
				return 0
			}
		}
	}
	return 1
}
