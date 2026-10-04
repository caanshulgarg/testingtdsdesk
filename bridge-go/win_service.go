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
	"os/user"
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
		// round 20 (the re-review's Medium 1): at the first start of a new version (a bridge that updated itself never
		// ran the install step) the recorder trial's folders are checked and made safe, once, before anything runs
		if exe, err := os.Executable(); err == nil {
			foldersAfterUpdate(filepath.Dir(exe), writeLog)
		}
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
	runMode = "service"
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
		// no one signed in to this session (session 0: a remote or automated install): the user running the setup, unless
		// that is Windows itself (LocalSystem)
		if u, err := user.Current(); err == nil && u.Uid != "S-1-5-18" {
			if i := strings.LastIndex(u.Username, `\`); i >= 0 {
				dom, name = u.Username[:i], u.Username[i+1:]
			} else {
				name = u.Username
			}
		}
	}
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

// the setup's own log: always %LOCALAPPDATA%\FinCom Bridge\install.log of the Windows user running it (the setup writes
// its own steps there too); for the service also %ProgramData%\FinCom Bridge\install.log, as before. Every line has its time
func installLogFiles() []string {
	var o []string
	if d := userInstallDir(); d != "" {
		o = append(o, filepath.Join(d, "install.log"))
	}
	if p := os.Getenv("ProgramData"); p != "" && !perUserSetup {
		o = append(o, filepath.Join(p, "FinCom Bridge", "install.log"))
	}
	return o
}
func installLog(msg string) {
	fmt.Println(msg)
	line := time.Now().Format("2006-01-02 15:04:05") + "  " + msg + "\r\n"
	for _, f := range installLogFiles() {
		_ = appendText(f, line)
	}
}

// a failure: in the log, and in install-result.txt for the setup's last page (what went wrong, what to do); the exit code
func installFailed(code int, reason, todo string) int {
	installLog(fmt.Sprintf("Install: FAILED (code %d): %s %s", code, reason, todo))
	writeInstallResult(reason, todo)
	return code
}

// the start of install: until it ends, the setup's last page reads that it did not finish
func installStarted() {
	writeInstallResult("The setup of FinCom Bridge stopped before it finished.", "Run the setup again; if it stops again, send the install log to FinCom.")
	installLog("Install: Windows " + windowsVersion() + ", program " + func() string { e, _ := os.Executable(); return e }())
}

// the bridge has to answer (this version, as a FinCom Bridge) within 30 seconds; else exit 4 ("installed but not running")
func waitAnswer(port int, by string) int {
	for i := 0; i < 30; i++ {
		if p := pingLocal(port, 2*time.Second); p != nil && str(p["version"]) == BridgeVersion {
			installLog(fmt.Sprintf("Install: done; the bridge answers on 127.0.0.1:%d", port))
			writeInstallResult("", "")
			return 0
		}
		time.Sleep(time.Second)
	}
	reason := fmt.Sprintf("FinCom Bridge was installed but did not answer on 127.0.0.1:%d within 30 seconds.", port)
	todo := "Restart the computer (" + by + "); if the icon near the clock stays red, send the install log to FinCom."
	if tallyPortOpenAt(port) {
		reason += fmt.Sprintf(" Another program answers on port %d.", port)
		todo = fmt.Sprintf("Close the program that uses port %d (often an older bridge), or restart the computer; then run the setup again.", port)
	}
	return installFailed(4, reason, todo)
}

// the owner recorded at the last install (for all users): the install run by the service itself (Switch to main bridge)
// has no one signed in to its session, so the bridge keeps working for the same Windows user
func recordedOwner() (ownerInfo, bool) {
	k, err := registry.OpenKey(registry.LOCAL_MACHINE, regKey, registry.QUERY_VALUE|registry.WOW64_64KEY)
	if err != nil {
		return ownerInfo{}, false
	}
	defer k.Close()
	o := ownerInfo{}
	o.name, _, _ = k.GetStringValue("Owner")
	o.sid, _, _ = k.GetStringValue("OwnerSid")
	o.home, _, _ = k.GetStringValue("Home")
	o.profile = profileOf(o.sid)
	return o, o.name != "" && o.sid != "" && o.home != "" && o.profile != ""
}

// Switch to main bridge: the program's own install in sole mode, detached, exactly as the setup runs it (the service runs
// as LocalSystem, so it may install the service again; installed just for this user, no administrator is needed). It
// stops this bridge, so it must not end with it
func platSwitchToMain(fincom string) error {
	exe, err := os.Executable()
	if err != nil {
		return err
	}
	var args []string
	switch runMode {
	case "user":
		args = []string{"install", "--per-user", "--mode", "sole", "--fincom", fincom}
	case "service":
		args = []string{"install", "--mode", "sole", "--fincom", fincom}
	default:
		return errors.New("this bridge was started by hand (in a window); run the FinCom Bridge setup and choose \"Replace bridge 1.15.0\"")
	}
	for _, away := range []uint32{0x01000000, 0} { // CREATE_BREAKAWAY_FROM_JOB when allowed, else without
		c := exec.Command(exe, args...)
		hideWindow(c)
		c.SysProcAttr.CreationFlags |= 0x00000200 | away // CREATE_NEW_PROCESS_GROUP
		if err = c.Start(); err == nil {
			writeLog(fmt.Sprintf("Switching to the main bridge: %s started (process %d)", strings.Join(args, " "), c.Process.Pid))
			_ = c.Process.Release()
			return nil
		}
	}
	return err
}

// the nightly copy's scheduled task, when it runs this program (bridge 1.15.0's own task, of the same name, stays)
func removeOwnTask() {
	c := exec.Command("schtasks.exe", "/Query", "/TN", taskName, "/V", "/FO", "LIST")
	hideWindow(c)
	out, err := c.Output()
	if err != nil || !strings.Contains(strings.ToLower(string(out)), "fincombridge.exe") {
		return
	}
	d := exec.Command("schtasks.exe", "/Delete", "/TN", taskName, "/F")
	hideWindow(d)
	if d.Run() == nil {
		installLog("Uninstall: removed the scheduled task " + taskName)
	}
}

// the bridge's own files, after the program is stopped (uninstall, both ways)
func removeOwnFilesLogged(home, mode string, keep bool) {
	for _, g := range removeOwnFiles(home, mode, keep) {
		installLog("Uninstall: removed " + g)
	}
	if keep {
		installLog("Uninstall: this computer's pairing with FinCom is kept (a later install connects without a new code)")
	}
}

// the settings 1.15.0 kept that this bridge carries over (the key FinCom pairs with, the cloud, the copy's choices)
var carried = []string{"Key", "TallyHost", "TallyPorts", "OnlyMySession", "PairWindowMin", "GentleMs", "StatusCacheSec", "FallbackPorts", "TallyTimeoutSec", "AllowedOrigins",
	"KeepInStep", "CloudUrl", "CloudKey", "KeepSchedule", "KeepDailyAt", "KeepModes", "KeepCompanies", "KeepFrom", "KeepLightMin", "KeepWatchSec", "CloudWake", "SyncCompanies"}

func installCmd(args []string) int {
	if contains(args, "--per-user") {
		return installUserCmd(args)
	}
	mode := strings.ToLower(flagValue(args, "mode"))
	// 02-Oct-2026: FinCom Bridge is the only bridge; test mode (beside an older bridge) only when asked for by name
	if mode != "test" {
		mode = "sole"
	}
	fincom := flagValue(args, "fincom")
	installStarted()
	o, err := installingUser()
	if err != nil {
		// run by the service itself (Switch to main bridge): no one is signed in to its session; the recorded owner stays
		if r, ok := recordedOwner(); ok {
			o, err = r, nil
		}
	}
	if err != nil {
		return installFailed(2, "The Windows user signed in to this session could not be found ("+err.Error()+").", "Sign in to Windows as the person who uses Tally and run the setup again.")
	}
	installLog(fmt.Sprintf("Install: FinCom Bridge %s for %s (%s), %s mode, folder %s", BridgeVersion, o.name, o.sid, mode, o.home))
	_ = os.MkdirAll(o.home, 0o755)
	stopService()
	cfgPath, code := writeSettings(o, mode, fincom)
	if code != 0 {
		return code
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
	// round 19 (S2): the recorder trial's folders, links refused, their permissions set here (folders.go)
	installFinComFolders(true, installLog)
	if err := createService(exe, cfgPath); err != nil {
		return installFailed(7, "The Windows service could not be made ("+err.Error()+").", "Run the setup again as an administrator; if it fails again, send the install log to FinCom.")
	}
	if err := startService(); err != nil {
		return installFailed(5, "The Windows service FinCom Bridge did not start ("+err.Error()+").", "Restart the computer; if the icon near the clock stays red, send the install log to FinCom.")
	}
	port := 9100
	if mode == "test" {
		port = 9101
	}
	return waitAnswer(port, "Windows starts the service with it")
}

// the settings for the bridge's owner (the same for the service and for an install just for one user): test mode beside
// bridge 1.15.0, with its own file and port; or sole, in bridge 1.15.0's own settings, which then is taken off
func writeSettings(o ownerInfo, mode, fincom string) (string, int) {
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
		carryInstanceID(c)
		c.Set("Mode", "test")
		c.Set("Port", float64(9101))
		c.Set("PsHome", o.home)
		c.Set("SyncDir", filepath.Join(o.home, "go-sync"))
		c.Set("JobsDir", filepath.Join(o.home, "go-jobs"))
		c.Set("LogFile", filepath.Join(o.home, "go-bridge.log"))
		setOwner(c, o, fincom)
		if err := writeOrdered(cfgPath, c); err != nil {
			return "", installFailed(3, "The settings could not be written ("+err.Error()+").", "Close any program that has "+cfgPath+" open, then run the setup again.")
		}
	} else {
		cfgPath = psCfg
		c := newOrdered()
		if exists(cfgPath) {
			_ = c.UnmarshalText(readText(cfgPath))
		}
		// switched from test mode: the same bridge for FinCom (the id FinCom made the main one)
		carryInstanceID(c, filepath.Join(o.home, "go-bridge.config.json"))
		c.Set("Mode", "")
		c.Set("Port", float64(9100))
		// the main bridge on this computer, with no click: told to FinCom on its first contact (claimMainOnce)
		c.Set("ClaimMain", true)
		c.Set("LogFile", filepath.Join(o.home, "tds-bridge.log"))
		setOwner(c, o, fincom)
		if err := writeOrdered(cfgPath, c); err != nil {
			return "", installFailed(3, "The settings could not be written ("+err.Error()+").", "Close any program that has "+cfgPath+" open, then run the setup again.")
		}
		removeOldBridge(o)
	}
	return cfgPath, 0
}

func setOwner(c *Ordered, o ownerInfo, fincom string) {
	c.Set("Owner", o.name)
	c.Set("OwnerSid", o.sid)
	if fincom != "" {
		c.Set("FinComUrl", fincom)
	}
	setPostOnly(c, installPostOnly) // round 11: the pilot posts to ZZ TEST only; a PostOnly set by hand is kept
	if !c.Has("Key") || str(c.Get("Key")) == "" {
		c.Set("Key", newBridgeKey())
	}
}
func writeOrdered(path string, c *Ordered) error {
	guardPorts(c)
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
			kept := filepath.Join(o.home, "replaced-by-FinCom-Bridge")
			_ = os.MkdirAll(kept, 0o755)
			if err := os.Rename(p, filepath.Join(kept, f)); err != nil {
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
	retireOldShortcuts(o)
}

// 02-Oct-2026, the owner's decision: FinCom Bridge is the only bridge. What bridge 1.15.0's setup, the FinCom Connector
// and a user put on the Desktop, in the Start menu and in the Startup folder to start or show the old bridges is moved
// into <home>\replaced-by-FinCom-Bridge (kept, never deleted), with the bridge folder's own starters; the Connector's
// entry in Settings > Apps goes (its values written to that folder first). FinCom Bridge's own shortcuts stay.
const oldShortcutRe = `(?i)^(fincom connector|tds[ -]?desk.*bridge|.*tally bridge|start-tds-bridge|show bridge window|setup-fincom-bridge|run-hidden)\b.*\.(lnk|bat|vbs|cmd|url)$`

func retireOldShortcuts(o ownerInfo) {
	keep := filepath.Join(o.home, "replaced-by-FinCom-Bridge")
	move := func(p, where string) {
		if err := os.MkdirAll(keep, 0o755); err != nil {
			return
		}
		to := filepath.Join(keep, filepath.Base(p))
		if exists(to) {
			to = filepath.Join(keep, time.Now().Format("20060102-150405")+" "+filepath.Base(p))
		}
		if err := os.Rename(p, to); err != nil {
			installLog("Install: could not move " + p + " (" + err.Error() + ")")
			return
		}
		installLog("Install: an old bridge's " + where + " entry " + filepath.Base(p) + " was moved to " + keep)
	}
	// the bridge folder's own starters of bridge 1.15.0
	for _, f := range []string{"run-hidden.vbs", "Show bridge window.bat", "Start-TDS-Bridge.bat"} {
		if p := filepath.Join(o.home, f); exists(p) {
			move(p, "bridge folder")
		}
	}
	dirs := map[string]string{
		filepath.Join(o.profile, `Desktop`): "Desktop",
		filepath.Join(o.profile, `AppData\Roaming\Microsoft\Windows\Start Menu\Programs`):         "Start menu",
		filepath.Join(o.profile, `AppData\Roaming\Microsoft\Windows\Start Menu\Programs\Startup`): "Startup",
	}
	// the Desktop where Windows really keeps it (OneDrive may hold it)
	if k, err := registry.OpenKey(registry.USERS, o.sid+`\Software\Microsoft\Windows\CurrentVersion\Explorer\Shell Folders`, registry.QUERY_VALUE); err == nil {
		if d, _, err := k.GetStringValue("Desktop"); err == nil && d != "" {
			dirs[d] = "Desktop"
		}
		k.Close()
	}
	for d, where := range dirs {
		ents, _ := os.ReadDir(d)
		for _, e := range ents {
			n := e.Name()
			if e.IsDir() {
				// a Start menu folder of an old bridge ("TDS Desk Bridge", "FinCom Connector")
				if where == "Start menu" && re(`(?i)^(fincom connector|tds desk bridge|tally bridge)$`).MatchString(n) {
					move(filepath.Join(d, n), where)
				}
				continue
			}
			if re(oldShortcutRe).MatchString(n) && !re(`(?i)^fincom bridge`).MatchString(n) {
				move(filepath.Join(d, n), where)
			}
		}
	}
	// the Connector's entry in Settings > Apps (this user's)
	if k, err := registry.OpenKey(registry.USERS, o.sid+`\Software\Microsoft\Windows\CurrentVersion\Uninstall\FinComConnector`, registry.QUERY_VALUE); err == nil {
		names, _ := k.ReadValueNames(0)
		var b strings.Builder
		for _, n := range names {
			v, _, _ := k.GetStringValue(n)
			fmt.Fprintf(&b, "%s=%s\r\n", n, v)
		}
		k.Close()
		_ = os.MkdirAll(keep, 0o755)
		_ = saveFile(filepath.Join(keep, "FinCom Connector (Settings - Apps entry).txt"), b.String())
		if registry.DeleteKey(registry.USERS, o.sid+`\Software\Microsoft\Windows\CurrentVersion\Uninstall\FinComConnector`) == nil {
			installLog("Install: the FinCom Connector's entry in Settings > Apps was removed (its values are kept in " + keep + ")")
		}
	}
	// FinCom Bridge 2.0.x installed for all users (a Windows service) in test mode: only an administrator can take it off
	if k, err := registry.OpenKey(registry.LOCAL_MACHINE, regKey, registry.QUERY_VALUE|registry.WOW64_64KEY); err == nil {
		m, _, _ := k.GetStringValue("Mode")
		v, _, _ := k.GetStringValue("Version")
		k.Close()
		if strings.EqualFold(m, "test") && !windows.GetCurrentProcessToken().IsElevated() {
			installLog("Install: FinCom Bridge " + v + " is also installed for all users (a Windows service, test mode). It never posts; to remove it an administrator opens Settings > Apps > FinCom Bridge > Uninstall")
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

// uninstall (run by the uninstaller): the service and the tray go, and the bridge's own files (uninstall.go); bridge
// 1.15.0's files in the same folder stay
func uninstallCmd(args []string) int {
	if contains(args, "--per-user") {
		return uninstallUserCmd(args)
	}
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
	installLog("Uninstall: the FinCom Bridge service and its tray icons were stopped and the service removed")
	removeOwnTask()
	putBackOldBridge(mode, home)
	removeOwnFilesLogged(home, mode, contains(args, "--keep-pairing"))
	_ = registry.DeleteKey(registry.LOCAL_MACHINE, regKey)
	installLog("Uninstall: FinCom Bridge removed (its record in HKLM\\" + regKey + " too); bridge 1.15.0's files in " + home + " are kept")
	return 0
}

// on uninstall after "Replace bridge 1.15.0": bridge 1.15.0's program is put back (it starts again with its own setup)
func putBackOldBridge(mode, home string) {
	if mode == "sole" && home != "" {
		old := filepath.Join(home, "TDSBridge.ps1")
		if exists(old+".replaced-by-go") && !exists(old) {
			_ = os.Rename(old+".replaced-by-go", old)
			installLog("Uninstall: bridge 1.15.0's program put back; run Setup-FinCom-Bridge.bat to start it again")
		}
	}
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
