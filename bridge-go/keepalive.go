package main

// bridge 2.5.10 (selfheal.go): the keep-alive task. A bridge installed just for one Windows user is started at sign-in
// (HKCU Run) and its supervisor restarts a worker that ends or hangs; nothing started the supervisor itself again if it
// ended. Now its first start makes one scheduled task of this Windows user, "FinCom Bridge keep-alive (<login> <SID>)":
// every 5 minutes while the user is signed in (only in the user's own session, InteractiveToken: no password, no
// administrator), also on battery, it runs "FinComBridge.exe keepalive", which does nothing when this user's bridge runs
// (its supervisor's lock is held), is being stopped (the setup's Stop), or a setup is between its stop and its install
// (SetupAt in HKCU, 30 minutes at most); else it starts the bridge as at sign-in, at normal priority. Made from a task
// file (schtasks /Create /XML: the battery settings have no command-line switch); made again when the program or its
// settings move, or when the task is gone; "NoKeepAlive": true in the settings takes it off; the uninstall removes it.
// Nothing here asks Tally anything.
import (
	"errors"
	"html"
	"os"
	"regexp"
	"strings"
	"time"
	"unicode/utf16"
)

// schtasks.exe with these arguments (win_keepalive.go; a stand-in in the tests)
var schtasksRun = platSchtasks

// review of 2.5.10 (3): one task a Windows user, also on a shared server where two logins have the same short name
// (another domain): the login as Windows gives it, Unicode kept, only the characters a task name cannot hold left out,
// with the user's SID
var reTaskUnsafe = regexp.MustCompile(`[\\/:*?"<>|\x00-\x1f]+`)

func keepAliveTaskName(login, sid string) string {
	l := strings.TrimSpace(reTaskUnsafe.ReplaceAllString(login, ""))
	if l == "" {
		l = "this user"
	}
	l = cutRunes(l, 60)
	if s := strings.TrimSpace(reTaskUnsafe.ReplaceAllString(sid, "")); s != "" {
		l += " " + cutRunes(s, 100)
	}
	return "FinCom Bridge keep-alive (" + l + ")"
}

// the task, as Task Scheduler's own file: every 5 minutes from a day in the past, also on battery, one at a time, at
// most 2 minutes a run, as the user signed in (no password, least privilege), at priority 5 (round 2 of the review: not
// Task Scheduler's default 7, below normal)
func keepAliveTaskXML(exe, config, sid string) (string, error) {
	if exe == "" || strings.ContainsAny(exe+config, "\"\r\n") {
		return "", errors.New("the program's or the settings' path cannot be named in a task")
	}
	args := "keepalive"
	if config != "" {
		args += ` --config "` + config + `"`
	}
	esc := html.EscapeString
	user := ""
	if sid != "" {
		user = "<UserId>" + esc(sid) + "</UserId>"
	}
	return `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo><Description>Starts FinCom Bridge again within 5 minutes if it is not running (this Windows user only).</Description></RegistrationInfo>
  <Triggers>
    <TimeTrigger><Repetition><Interval>PT5M</Interval><StopAtDurationEnd>false</StopAtDurationEnd></Repetition><StartBoundary>2026-01-01T00:00:00</StartBoundary><Enabled>true</Enabled></TimeTrigger>
  </Triggers>
  <Principals><Principal id="Author">` + user + `<LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal></Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>true</AllowHardTerminate>
    <StartWhenAvailable>true</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
    <IdleSettings><StopOnIdleEnd>false</StopOnIdleEnd><RestartOnIdle>false</RestartOnIdle></IdleSettings>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>true</Enabled>
    <Hidden>false</Hidden>
    <RunOnlyIfIdle>false</RunOnlyIfIdle>
    <WakeToRun>false</WakeToRun>
    <ExecutionTimeLimit>PT2M</ExecutionTimeLimit>
    <Priority>5</Priority>
  </Settings>
  <Actions Context="Author"><Exec><Command>` + esc(exe) + `</Command><Arguments>` + esc(args) + `</Arguments></Exec></Actions>
</Task>
`, nil
}

// the file as schtasks reads it: UTF-16 (little-endian, with its mark), as the declaration says
func utf16File(s string) []byte {
	u := utf16.Encode([]rune(s))
	b := make([]byte, 2+2*len(u))
	b[0], b[1] = 0xFF, 0xFE
	for i, c := range u {
		b[2+2*i], b[3+2*i] = byte(c), byte(c>>8)
	}
	return b
}

func keepAliveXMLFile() string { return sp("keepalive-task.xml") }

func keepAliveCreateArgs(name, xmlFile string) []string {
	return []string{"/Create", "/F", "/TN", name, "/XML", xmlFile}
}
func keepAliveQueryArgs(name string) []string  { return []string{"/Query", "/TN", name} }
func keepAliveDeleteArgs(name string) []string { return []string{"/Delete", "/TN", name, "/F"} }

func keepAliveMarkFile() string { return sp("keepalive-task.txt") }

// made once (and again when the program or the settings move, or the task was deleted); taken off with NoKeepAlive
func ensureKeepAlive(exe string) {
	name := keepAliveTaskName(ownerName(), platUserSID())
	if cfgB("NoKeepAlive") {
		if readText(keepAliveMarkFile()) != "" {
			if err := schtasksRun(keepAliveDeleteArgs(name)...); err == nil {
				writeLog("Keep-alive: the scheduled task was taken off (NoKeepAlive in the settings)")
			}
			_ = saveFile(keepAliveMarkFile(), "")
		}
		return
	}
	x, err := keepAliveTaskXML(exe, ConfigPath, platUserSID())
	if err != nil {
		writeLogOnce("keepalive|args", "Keep-alive: no scheduled task ("+err.Error()+"); the bridge still starts at sign-in", time.Hour)
		return
	}
	mark := "2|" + name + "|" + x
	if readText(keepAliveMarkFile()) == mark && schtasksRun(keepAliveQueryArgs(name)...) == nil {
		return // made, and still there
	}
	if err := os.WriteFile(keepAliveXMLFile(), utf16File(x), 0o600); err != nil {
		writeLog("Keep-alive: the task's file could not be written (" + cutRunes(err.Error(), 200) + "); tried again at the next start")
		return
	}
	defer os.Remove(keepAliveXMLFile())
	if err := schtasksRun(keepAliveCreateArgs(name, keepAliveXMLFile())...); err != nil {
		writeLog("Keep-alive: the scheduled task could not be made (" + cutRunes(err.Error(), 200) + "); the bridge still starts at sign-in, and it is tried again at the next start")
		return
	}
	_ = saveFile(keepAliveMarkFile(), mark)
	writeLog("Keep-alive: a scheduled task of this Windows user (\"" + name + "\") starts FinCom Bridge again within 5 minutes if it is not running")
}

func removeKeepAlive(say func(string)) {
	name := keepAliveTaskName(ownerName(), platUserSID())
	if err := schtasksRun(keepAliveDeleteArgs(name)...); err == nil && say != nil {
		say("Uninstall: removed the keep-alive task (" + name + ")")
	}
	_ = saveFile(keepAliveMarkFile(), "")
}

// a setup between its stop and its install (SetupAt, set by the stop): the keep-alive task starts nothing then, for 30
// minutes at most (a setup that never finished does not keep the bridge down)
func setupRunning(at string, now time.Time) bool {
	t, err := time.Parse(time.RFC3339, strings.TrimSpace(at))
	return err == nil && now.Sub(t) < 30*time.Minute && now.Sub(t) > -time.Minute
}
