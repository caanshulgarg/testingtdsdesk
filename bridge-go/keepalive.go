package main

// bridge 2.5.10 (selfheal.go): the keep-alive task. A bridge installed just for one Windows user is started at sign-in
// (HKCU Run) and its supervisor restarts a worker that ends or hangs; nothing started the supervisor itself again if it
// ended. Now its first start makes one scheduled task of this Windows user, "FinCom Bridge keep-alive (<login>)": every
// 5 minutes while the user is signed in (/IT: only in the user's own session; no password, no administrator), it runs
// "FinComBridge.exe keepalive", which does nothing when this user's bridge runs (its supervisor's lock is held) or is
// being stopped (the setup's Stop), and else starts it as at sign-in. Made again when the program or its settings move;
// "NoKeepAlive": true in the settings takes it off; the uninstall removes it. Nothing here asks Tally anything.
import (
	"errors"
	"regexp"
	"strings"
	"time"
)

// schtasks.exe with these arguments (win_keepalive.go; a stand-in in the tests)
var schtasksRun = platSchtasks

var reTaskUnsafe = regexp.MustCompile(`[^A-Za-z0-9 ._-]+`)

func keepAliveTaskName(login string) string {
	l := strings.TrimSpace(reTaskUnsafe.ReplaceAllString(login, ""))
	if l == "" {
		l = "this user"
	}
	if len(l) > 60 {
		l = l[:60]
	}
	return "FinCom Bridge keep-alive (" + l + ")"
}

// the task's command line as schtasks takes it; refused when it cannot be said safely (a quote in a path, or longer than
// the 261 characters schtasks allows for /TR)
func keepAliveTaskArgs(exe, config, login string) ([]string, error) {
	if exe == "" || strings.ContainsAny(exe+config, "\"\r\n") {
		return nil, errors.New("the program's or the settings' path cannot be named in a task")
	}
	tr := `"` + exe + `" keepalive`
	if config != "" {
		tr += ` --config "` + config + `"`
	}
	if len(tr) > 261 {
		return nil, errors.New("the program's path is too long for a scheduled task")
	}
	return []string{"/Create", "/F", "/TN", keepAliveTaskName(login), "/SC", "MINUTE", "/MO", "5", "/IT", "/TR", tr}, nil
}

func keepAliveDeleteArgs(login string) []string {
	return []string{"/Delete", "/TN", keepAliveTaskName(login), "/F"}
}

func keepAliveMarkFile() string { return sp("keepalive-task.txt") }

// made once (and again when the program or the settings move); taken off when the settings say NoKeepAlive
func ensureKeepAlive(exe string) {
	login := pickLogin()
	if cfgB("NoKeepAlive") {
		if readText(keepAliveMarkFile()) != "" {
			if err := schtasksRun(keepAliveDeleteArgs(login)...); err == nil {
				writeLog("Keep-alive: the scheduled task was taken off (NoKeepAlive in the settings)")
			}
			_ = saveFile(keepAliveMarkFile(), "")
		}
		return
	}
	args, err := keepAliveTaskArgs(exe, ConfigPath, login)
	if err != nil {
		writeLogOnce("keepalive|args", "Keep-alive: no scheduled task ("+err.Error()+"); the bridge still starts at sign-in", time.Hour)
		return
	}
	mark := "1|" + strings.Join(args, "|")
	if readText(keepAliveMarkFile()) == mark {
		return
	}
	if err := schtasksRun(args...); err != nil {
		writeLog("Keep-alive: the scheduled task could not be made (" + cutRunes(err.Error(), 200) + "); the bridge still starts at sign-in, and it is tried again at the next start")
		return
	}
	_ = saveFile(keepAliveMarkFile(), mark)
	writeLog("Keep-alive: a scheduled task of this Windows user (\"" + keepAliveTaskName(login) + "\") starts FinCom Bridge again within 5 minutes if it is not running")
}

func removeKeepAlive(say func(string)) {
	if err := schtasksRun(keepAliveDeleteArgs(pickLogin())...); err == nil && say != nil {
		say("Uninstall: removed the keep-alive task (" + keepAliveTaskName(pickLogin()) + ")")
	}
	_ = saveFile(keepAliveMarkFile(), "")
}
