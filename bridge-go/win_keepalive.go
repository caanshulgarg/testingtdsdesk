//go:build windows

package main

// bridge 2.5.10 (keepalive.go): schtasks.exe, and "FinComBridge.exe keepalive" run by the keep-alive task
import (
	"errors"
	"os"
	"os/exec"
	"strings"
	"time"
)

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
	loadConfigRO()
	exe, err := os.Executable()
	if err != nil {
		return 1
	}
	_ = saveFile(keepAliveHintFile(), time.Now().UTC().Format(time.RFC3339))
	writeLog("Keep-alive: FinCom Bridge was not running for this Windows user; it is started again")
	c := exec.Command(exe, "user", "--config", ConfigPath)
	hideWindow(c)
	if err := c.Start(); err != nil {
		writeLog("Keep-alive: FinCom Bridge could not be started: " + err.Error())
		return 1
	}
	_ = c.Process.Release()
	return 0
}
