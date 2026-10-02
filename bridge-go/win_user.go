//go:build windows

// Installed just for one Windows user ("Just for me" in the setup): for a shared Tally server where the user is not an
// administrator, so there is no Windows service. The program lives in %LOCALAPPDATA%\FinCom Bridge, its record is in
// HKCU\Software\FinCom\Bridge, and HKCU\...\Run starts "FinComBridge.exe user" when the user signs in.
//
// "user" is a small supervisor that does what Windows' service recovery does for the service: it starts the bridge
// itself as a child ("worker") and starts it again, with growing pauses, when it stops or crashes; it ends and restarts
// a worker that no longer answers or whose main loop no longer turns (a hang); and it keeps the tray icon running. The
// supervisor does no work of its own, so it has little that can fail. One supervisor per user (a named lock), so the
// start at sign-in and a start by hand never run two bridges. After an update (the worker puts the new program in
// place) the supervisor starts again from the new program.
package main

import (
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"os/user"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"golang.org/x/sys/windows"
	"golang.org/x/sys/windows/registry"
)

const (
	runKey     = `Software\Microsoft\Windows\CurrentVersion\Run`
	runValue   = "FinCom Bridge"
	hangLoop   = 30 * time.Minute // the main loop turns every 0.1 s; half an hour without a turn is a hang, not slowness
	hangAnswer = 3 * time.Minute  // a worker that answered before and then not for this long is ended
	hangStart  = 10 * time.Minute // nor answered at all since it started (it gives up by itself after 5 minutes)
)

var perUserSetup bool // install/uninstall --per-user: the setup's log goes to the user's own folder

var (
	perUserOnce sync.Once
	perUserIs   bool
)

// this program is the one installed just for this user: HKCU's record names its folder (the service's program, in
// Program Files, is not; nor is a copy started by hand for support)
func perUserInstall() bool {
	perUserOnce.Do(func() {
		k, err := registry.OpenKey(registry.CURRENT_USER, regKey, registry.QUERY_VALUE)
		if err != nil {
			return
		}
		defer k.Close()
		dir, _, _ := k.GetStringValue("InstallDir")
		exe, _ := os.Executable()
		perUserIs = dir != "" && strings.EqualFold(filepath.Clean(dir), filepath.Clean(filepath.Dir(exe)))
	})
	return perUserIs
}

// --- names shared by this user's processes (Local\: this Windows session, so other users can neither see nor block them)
func userSID() string {
	if u, err := windows.GetCurrentProcessToken().GetTokenUser(); err == nil {
		return u.User.Sid.String()
	}
	return os.Getenv("USERNAME")
}
func userObj(what string) *uint16 { return u16(`Local\FinComBridge` + what + "-" + userSID()) }

// the one supervisor of this user; false when one runs already
func userLock() (windows.Handle, bool) {
	h, err := windows.CreateMutex(nil, false, userObj("User"))
	if err == windows.ERROR_ALREADY_EXISTS || err == windows.ERROR_ACCESS_DENIED {
		if h != 0 {
			windows.CloseHandle(h)
		}
		return 0, false
	}
	return h, h != 0
}
func userLockHeld() bool {
	h, err := windows.OpenMutex(windows.SYNCHRONIZE, false, userObj("User"))
	if err != nil {
		return false
	}
	windows.CloseHandle(h)
	return true
}

// "Stop": set by the setup and the uninstaller (FinComBridge.exe stop --per-user); the supervisor, the worker and the
// tray all end. "TrayQuit": set by Quit in the tray, so the supervisor does not bring the icon back until the next start.
func userEvent(what string) windows.Handle {
	h, _ := windows.CreateEvent(nil, 1, 0, userObj(what)) // manual reset: every process waiting on it sees it
	return h
}
func eventSet(h windows.Handle) bool {
	ev, _ := windows.WaitForSingleObject(h, 0)
	return h != 0 && ev == windows.WAIT_OBJECT_0
}

// a channel closed when the event is set
func whenSet(h windows.Handle) <-chan struct{} {
	c := make(chan struct{})
	if h == 0 {
		return c
	}
	go func() {
		_, _ = windows.WaitForSingleObject(h, windows.INFINITE)
		close(c)
	}()
	return c
}
func sleepOr(stop <-chan struct{}, d time.Duration) bool {
	select {
	case <-stop:
		return false
	case <-time.After(d):
		return true
	}
}

// the program file's size and time: they change when an update (or an update put back) replaces it
func exeStamp(exe string) string {
	fi, err := os.Stat(exe)
	if err != nil {
		return ""
	}
	return fmt.Sprint(fi.Size(), fi.ModTime().UnixNano())
}

// the pause before the next start: short when a restart was asked for (the tray, an update), growing when it keeps failing
func restartDelay(code, fails int) time.Duration {
	if code == 3 {
		return time.Second
	}
	steps := []int{5, 10, 30, 60, 120, 300}
	if fails >= len(steps) {
		fails = len(steps) - 1
	}
	return time.Duration(steps[fails]) * time.Second
}

// --- FinComBridge.exe user: the supervisor
func runUser(args []string) int {
	runMode = "user"
	logEcho = false
	loadConfigRO()
	exe, _ := os.Executable()
	lock, ok := userLock()
	if !ok {
		// already running for this user (started at sign-in, and now by hand): the icon, or its status if it shows
		c := exec.Command(exe, "tray", "--config", ConfigPath)
		_ = c.Start()
		return 0
	}
	stopEv, quitEv := userEvent("Stop"), userEvent("TrayQuit")
	_ = windows.ResetEvent(stopEv) // a stop asked for before this start is over
	_ = windows.ResetEvent(quitEv) // a new start shows the icon again
	stop := whenSet(stopEv)
	writeLog(fmt.Sprintf("FinCom Bridge %s: started just for %s (no service); it keeps the bridge and its icon running", BridgeVersion, ownerName()))
	go keepTray(exe, stop, quitEv)
	stamp := exeStamp(exe)
	fails := 0
	for {
		started := time.Now()
		code, stopped := superviseWorker(exe, stop)
		if stopped {
			writeLog("Stopping: asked to (setup or uninstall)")
			return 0
		}
		if exeStamp(exe) != stamp {
			// updated: this supervisor is the previous program; the new one takes over (and starts the new worker)
			writeLog("The program was replaced (an update, or an update put back): starting again from it")
			windows.CloseHandle(lock)
			c := exec.Command(exe, "user", "--config", ConfigPath)
			if err := c.Start(); err == nil {
				return 0
			}
			if lock, ok = userLock(); !ok {
				return 0
			}
			stamp = exeStamp(exe)
		}
		if time.Since(started) > 10*time.Minute {
			fails = 0
		}
		d := restartDelay(code, fails)
		fails++
		if code != 3 {
			writeLog(fmt.Sprintf("The bridge stopped (code %d); it is started again in %s", code, d))
		}
		if !sleepOr(stop, d) {
			return 0
		}
	}
}

// one run of the worker: its exit code, or stopped when the setup asked everything to stop
func superviseWorker(exe string, stop <-chan struct{}) (int, bool) {
	c := exec.Command(exe, "worker", "--config", ConfigPath, "--home", Home, "--parent", strconv.Itoa(os.Getpid()))
	hideWindow(c)
	if err := c.Start(); err != nil {
		writeLog("The bridge could not be started: " + err.Error())
		return 1, false
	}
	done := make(chan int, 1)
	go func() {
		_ = c.Wait()
		done <- c.ProcessState.ExitCode()
	}()
	pid, start, answered, lastOK := c.Process.Pid, time.Now(), false, time.Now()
	tick := time.NewTicker(20 * time.Second)
	defer tick.Stop()
	for {
		select {
		case code := <-done:
			return code, false
		case <-stop:
			// the worker sees the same stop and ends by itself; it is ended only if it does not
			select {
			case <-done:
			case <-time.After(20 * time.Second):
				writeLog("The bridge did not stop within 20 seconds; it was ended")
				_ = c.Process.Kill()
				<-done
			}
			return 0, true
		case <-tick.C:
			why := ""
			if r := pingWorker(); r != nil && toInt(r["pid"]) == pid {
				answered, lastOK = true, time.Now()
				if l := time.Duration(toInt(r["loopSec"])) * time.Second; l > hangLoop {
					why = fmt.Sprintf("its main loop has not moved for %d minutes", int(l.Minutes()))
				}
			} else if answered && time.Since(lastOK) > hangAnswer {
				why = fmt.Sprintf("it has not answered for %d minutes", int(time.Since(lastOK).Minutes()))
			} else if !answered && time.Since(start) > hangStart {
				why = fmt.Sprintf("it has not answered since it started %d minutes ago", int(time.Since(start).Minutes()))
			}
			if why != "" {
				writeLog("Watchdog: the bridge hangs (" + why + "); it is ended and started again")
				_ = c.Process.Kill()
				<-done
				return 9, false
			}
		}
	}
}

// the worker's /ping (no key needed): which process answers, and how long ago its main loop turned
func pingWorker() M {
	loadConfigRO() // the port may have been changed in the settings
	hc := &http.Client{Timeout: 15 * time.Second, Transport: &http.Transport{Proxy: nil}}
	r, err := hc.Get(fmt.Sprintf("http://127.0.0.1:%d/ping", toInt(cfg("Port"))))
	if err != nil {
		return nil
	}
	defer r.Body.Close()
	b, _ := io.ReadAll(io.LimitReader(r.Body, 1<<16))
	return parseObj(string(b))
}

// a tray icon is running in this Windows session
func trayRunning() bool {
	h, err := windows.OpenMutex(windows.SYNCHRONIZE, false, u16(`Local\FinComBridgeTray`))
	if err != nil {
		return false
	}
	windows.CloseHandle(h)
	return true
}

// the tray icon, started again if it crashes; not after Quit (until the next start or sign-in)
func keepTray(exe string, stop <-chan struct{}, quitEv windows.Handle) {
	fails := 0
	for {
		select {
		case <-stop:
			return
		default:
		}
		if eventSet(quitEv) || trayRunning() {
			if !sleepOr(stop, 30*time.Second) {
				return
			}
			continue
		}
		started := time.Now()
		c := exec.Command(exe, "tray", "--quiet", "--config", ConfigPath)
		code := -1
		if err := c.Run(); err == nil || c.ProcessState != nil {
			code = c.ProcessState.ExitCode()
		}
		select {
		case <-stop:
			return
		default:
		}
		if time.Since(started) > 10*time.Minute {
			fails = 0
		}
		// 0: Quit, another icon already shows, or it started again from a new program; else it crashed
		d := 30 * time.Second
		if code != 0 {
			d = restartDelay(code, fails)
			fails++
			writeLog(fmt.Sprintf("The tray icon stopped (code %d); it is started again in %s", code, d))
		}
		if !sleepOr(stop, d) {
			return
		}
	}
}

// --- FinComBridge.exe worker: the bridge itself, under the supervisor
func runWorker(args []string) int {
	runMode = "user"
	logEcho = false
	undoFailedUpdate() // an update that does not start properly is undone, as for the service (the supervisor notices)
	if ev := userEvent("Stop"); ev != 0 {
		go func() {
			<-whenSet(ev)
			requestStop(0)
		}()
	}
	// the supervisor gone (ended in the Task Manager): this worker ends too, so a new start does not find the port taken
	if pid, _ := strconv.Atoi(flagValue(args, "parent")); pid > 0 {
		if h, err := windows.OpenProcess(windows.SYNCHRONIZE, false, uint32(pid)); err == nil {
			go func() {
				_, _ = windows.WaitForSingleObject(h, windows.INFINITE)
				writeLog("Stopping: the FinCom Bridge supervisor has ended")
				requestStop(0)
			}()
		}
	}
	go updateHealth()
	code := 9
	func() {
		defer func() {
			if r := recover(); r != nil {
				writeLog(fmt.Sprint("The bridge stopped on an error: ", r))
			}
		}()
		code = runBridge(false)
	}()
	return code
}

// FinComBridge.exe stop --per-user: this user's supervisor, worker and tray end (at most half a minute)
func stopUser() {
	ev := userEvent("Stop")
	if ev == 0 {
		return
	}
	defer windows.CloseHandle(ev)
	_ = windows.SetEvent(ev)
	for i := 0; i < 60 && userLockHeld(); i++ {
		time.Sleep(500 * time.Millisecond)
	}
}

// --- install --per-user (the setup, "Just for me", no administrator)

// the Windows user running the setup (this process's own user: no administrator's password is typed for this install)
func currentOwner() (ownerInfo, error) {
	u, err := user.Current()
	if err != nil {
		return ownerInfo{}, err
	}
	o := ownerInfo{name: u.Username, sid: u.Uid}
	o.profile = profileOf(o.sid)
	if o.profile == "" {
		o.profile = u.HomeDir
	}
	la := localAppData()
	if la == "" {
		la = filepath.Join(o.profile, `AppData\Local`)
	}
	if la == "" || o.profile == "" {
		return o, errors.New("the user's profile folder was not found")
	}
	o.home = filepath.Join(la, "TDS Desk Bridge") // where bridge 1.15.0 keeps its settings, pairing and copy
	return o, nil
}

func installUserCmd(args []string) int {
	perUserSetup = true
	mode := strings.ToLower(flagValue(args, "mode"))
	if mode != "test" && mode != "sole" {
		mode = "test"
	}
	fincom := flagValue(args, "fincom")
	installStarted()
	o, err := currentOwner()
	if err != nil {
		return installFailed(2, "This Windows user's folders could not be found ("+err.Error()+").", "Sign in to Windows as the person who uses Tally and run the setup again.")
	}
	installLog(fmt.Sprintf("Install (just for this user, no service): FinCom Bridge %s for %s (%s), %s mode, folder %s", BridgeVersion, o.name, o.sid, mode, o.home))
	_ = os.MkdirAll(o.home, 0o755)
	stopUser()
	cfgPath, code := writeSettings(o, mode, fincom)
	if code != 0 {
		return code
	}
	exe, _ := os.Executable()
	k, _, err := registry.CreateKey(registry.CURRENT_USER, regKey, registry.ALL_ACCESS)
	if err != nil {
		return installFailed(6, "The install could not be recorded in the registry (HKCU\\"+regKey+": "+err.Error()+").", "Run the setup again; if it fails again, send the install log to FinCom.")
	}
	_ = k.SetStringValue("Home", o.home)
	_ = k.SetStringValue("Config", cfgPath)
	_ = k.SetStringValue("Owner", o.name)
	_ = k.SetStringValue("OwnerSid", o.sid)
	_ = k.SetStringValue("Mode", mode)
	_ = k.SetStringValue("Version", BridgeVersion)
	_ = k.SetStringValue("InstallDir", filepath.Dir(exe))
	_ = k.SetStringValue("RunMode", "user")
	k.Close()
	// started when this user signs in (HKCU Run needs no administrator, and runs in the user's own session with the tray)
	rk, _, err := registry.CreateKey(registry.CURRENT_USER, runKey, registry.SET_VALUE)
	if err == nil {
		err = rk.SetStringValue(runValue, `"`+exe+`" user`)
		rk.Close()
	}
	if err != nil {
		return installFailed(7, "The start at sign-in could not be set (HKCU\\"+runKey+": "+err.Error()+"); a policy of this computer may forbid it.", "Ask the administrator to allow programs to start at sign-in, or to install FinCom Bridge for all users.")
	}
	installLog("Install: starts when " + o.name + " signs in to Windows (HKCU Run)")
	c := exec.Command(exe, "user", "--config", cfgPath)
	if err := c.Start(); err != nil {
		return installFailed(5, "FinCom Bridge did not start ("+err.Error()+"); an antivirus may have blocked "+exe+".", "Allow FinCom Bridge in the antivirus, or sign out and in again; if it stays, send the install log to FinCom.")
	}
	_ = c.Process.Release()
	port := 9100
	if mode == "test" {
		port = 9101
	}
	return waitAnswer(port, "it starts when you sign in")
}

// uninstall --per-user: the start at sign-in and the record go, the bridge stops, and its own files (uninstall.go); bridge
// 1.15.0's files in the same folder stay
func uninstallUserCmd(args []string) int {
	perUserSetup = true
	stopUser()
	var home, mode string
	if k, err := registry.OpenKey(registry.CURRENT_USER, regKey, registry.QUERY_VALUE); err == nil {
		home, _, _ = k.GetStringValue("Home")
		mode, _, _ = k.GetStringValue("Mode")
		k.Close()
	}
	installLog("Uninstall (just for this user): this user's FinCom Bridge (supervisor, bridge, tray icon) was stopped")
	if rk, err := registry.OpenKey(registry.CURRENT_USER, runKey, registry.SET_VALUE); err == nil {
		if rk.DeleteValue(runValue) == nil {
			installLog("Uninstall: removed the start at sign-in (HKCU\\" + runKey + ", " + runValue + ")")
		}
		rk.Close()
	}
	removeOwnTask()
	putBackOldBridge(mode, home)
	removeOwnFilesLogged(home, mode, contains(args, "--keep-pairing"))
	_ = registry.DeleteKey(registry.CURRENT_USER, regKey)
	installLog("Uninstall (just for this user): FinCom Bridge removed (its record in HKCU\\" + regKey + " too); bridge 1.15.0's files in " + home + " are kept")
	return 0
}
