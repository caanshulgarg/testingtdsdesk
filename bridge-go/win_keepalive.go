//go:build windows

package main

// bridge 2.5.10 (keepalive.go): schtasks.exe, and "FinComBridge.exe keepalive" run by the keep-alive task
import (
	"errors"
	"os"
	"os/exec"
	"strings"
	"syscall"
	"time"

	"golang.org/x/sys/windows/registry"
)

const normalPriorityClass = 0x00000020 // NORMAL_PRIORITY_CLASS

func platUserSID() string { return userSID() }

// SetupAt (HKCU\SOFTWARE\FinCom\Bridge): the setup's stop, cleared once its install starts the bridge again
func setupAtValue() string {
	k, err := registry.OpenKey(registry.CURRENT_USER, regKey, registry.QUERY_VALUE)
	if err != nil {
		return ""
	}
	defer k.Close()
	v, _, _ := k.GetStringValue("SetupAt")
	return v
}

func setSetupAt(on bool) {
	k, _, err := registry.CreateKey(registry.CURRENT_USER, regKey, registry.SET_VALUE)
	if err != nil {
		return
	}
	defer k.Close()
	if on {
		_ = k.SetStringValue("SetupAt", time.Now().UTC().Format(time.RFC3339))
	} else {
		_ = k.DeleteValue("SetupAt")
	}
}

func platSchtasks(args ...string) error {
	c := exec.Command("schtasks.exe", args...)
	hideWindow(c)
	out, err := c.CombinedOutput()
	if err != nil {
		return errors.New(strings.TrimSpace(string(out)) + " (" + err.Error() + ")")
	}
	return nil
}

// the task's run: nothing when this user's bridge runs or is being stopped (the setup, the uninstall); else started as at
// sign-in, with a note so its next run says it was found not running
func keepAliveCmd(args []string) int {
	logEcho = false
	if userLockHeld() {
		return 0
	}
	if ev := userEvent("Stop"); ev != 0 && eventSet(ev) {
		return 0
	}
	if setupRunning(setupAtValue(), time.Now()) {
		return 0 // review of 2.5.10 (3): a setup between its stop and its install
	}
	loadConfigRO()
	exe, err := os.Executable()
	if err != nil {
		return 1
	}
	_ = saveFile(keepAliveHintFile(), time.Now().UTC().Format(time.RFC3339))
	writeLog("Keep-alive: FinCom Bridge was not running for this Windows user; it is started again")
	c := exec.Command(exe, "user", "--config", ConfigPath)
	hideWindow(c)
	// review of 2.5.10 (3): at normal priority, never Task Scheduler's own (below normal) passed on
	if c.SysProcAttr == nil {
		c.SysProcAttr = &syscall.SysProcAttr{}
	}
	c.SysProcAttr.CreationFlags |= normalPriorityClass
	if err := c.Start(); err != nil {
		writeLog("Keep-alive: FinCom Bridge could not be started: " + err.Error())
		return 1
	}
	_ = c.Process.Release()
	return 0
}
