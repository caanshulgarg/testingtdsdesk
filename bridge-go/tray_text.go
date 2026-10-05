// What the tray icon says, kept apart from the Windows calls so the tests can read it: the one line of its tooltip (and
// menu header), the answer of "Test connection", and which of Windows 11's tray settings is this program's.
package main

import (
	"fmt"
	"strings"
	"unicode/utf8"
)

// the mode in words, first in the tooltip whenever the bridge runs
func modeWords(st M) string {
	switch {
	case truthy(st["testMode"]):
		return "Test mode: reading only, not posting"
	case str(st["readOnly"]) != "":
		return "Main bridge: reading only, not posting (see Status)"
	}
	return "Main bridge: reading and posting"
}

// the tooltip, one line of at most 127 characters (Windows' limit): "FinCom Bridge 2.1.0 - Test mode: reading only, not
// posting", and what is wrong after it, if anything ("- Paused", "- Tally not open", ...); "- not running" when the
// bridge does not answer
func trayTip(st M) string {
	head := "FinCom Bridge " + BridgeVersion
	if st == nil {
		return head + " - not running"
	}
	if v := str(st["version"]); v != "" {
		head = "FinCom Bridge " + v
	}
	parts := []string{head, modeWords(st)}
	switch {
	case truthy(st["switching"]):
		parts = append(parts, "switching to the main bridge")
	case str(st["posting"]) != "":
		parts = append(parts, str(st["posting"])) // a posting going on: its one line ("Waiting for Tally: ..."); also while paused
	case obj(st["readStopped"]) != nil:
		parts = append(parts, "Reading stopped: "+str(obj(st["readStopped"])["reason"]))
	case truthy(st["paused"]):
		parts = append(parts, "Background reading paused")
	case !truthy(st["tallyOpen"]):
		parts = append(parts, "Tally not open")
	case !truthy(st["cloudConnected"]):
		parts = append(parts, "not connected to FinCom")
	case !truthy(st["online"]):
		parts = append(parts, "offline")
	case truthy(st["reconnecting"]):
		parts = append(parts, "reconnecting to FinCom")
	case str(st["notAnsweringSince"]) != "":
		parts = append(parts, "Tally not answering since "+hhmm(str(st["notAnsweringSince"])))
	case str(st["tallyState"]) == "busy":
		parts = append(parts, "Tally busy (answers slowly)")
	}
	return cutRunes(strings.Join(parts, " - "), 127)
}

// "2026-10-02T12:28:05" -> "12:28"
func hhmm(t string) string {
	if len(t) >= 16 {
		return t[11:16]
	}
	return t
}

func cutRunes(s string, n int) string {
	if utf8.RuneCountInString(s) <= n {
		return s
	}
	r := []rune(s)
	return string(r[:n])
}

// "Test connection": one line for each check, in order, each OK or what is wrong and what to do.
// ping: the bridge's /ping (nil: it does not answer); chk: its /tray/check (Tally asked now, and a hello to FinCom's cloud)
func connectionReport(port int, ping, chk M) string {
	var l []string
	if ping == nil {
		l = append(l, fmt.Sprintf("The bridge on this computer: NOT ANSWERING on 127.0.0.1:%d. Choose Restart from this icon; if it stays, choose \"Send install log to FinCom\".", port))
		l = append(l, "Tally, FinCom's cloud, pairing: not checked (the bridge does not answer).")
		return strings.Join(l, "\n\n")
	}
	l = append(l, fmt.Sprintf("The bridge on this computer: OK (FinCom Bridge %s on 127.0.0.1:%d).", str(ping["version"]), port))
	if chk == nil {
		l = append(l, "Tally, FinCom's cloud, pairing: not checked (the bridge did not answer the check; choose Restart and try again).")
		return strings.Join(l, "\n\n")
	}
	t := obj(chk["tally"])
	switch {
	case truthy(t["ok"]) && len(strs(t["companies"])) > 0:
		l = append(l, fmt.Sprintf("Tally: OK on port %s; open: %s.", strings.Join(strs(t["ports"]), ", "), strings.Join(strs(t["companies"]), ", ")))
	case truthy(t["ok"]):
		l = append(l, fmt.Sprintf("Tally: answers on port %s, but no company is open. Open your company in TallyPrime.", strings.Join(strs(t["ports"]), ", ")))
	default:
		why := str(t["error"])
		if why == "" {
			why = "TallyPrime is not running in your Windows login"
		}
		l = append(l, "Tally: NOT ANSWERING ("+why+"). Open TallyPrime with your company; in TallyPrime, F1 Help > Settings > Connectivity: set \"TallyPrime acts as\" to Both and the port to 9000.")
	}
	c := obj(chk["cloud"])
	switch {
	case !truthy(c["url"]):
		l = append(l, "FinCom's cloud: not checked (this computer is not connected to FinCom yet).")
	case toInt(c["code"]) == 0:
		l = append(l, "FinCom's cloud: NOT REACHED ("+str(c["error"])+"). Check this computer's internet connection (and proxy or firewall); changes from Tally wait here meanwhile.")
	case toInt(c["code"]) == 200:
		firm := str(c["firm"])
		if firm == "" {
			firm = "your firm"
		}
		l = append(l, "FinCom's cloud: OK, connected to "+firm+".")
	default:
		l = append(l, fmt.Sprintf("FinCom's cloud: answers (HTTP %d).", toInt(c["code"])))
	}
	switch {
	case !truthy(c["url"]) || !truthy(c["key"]):
		l = append(l, "Pairing: this computer is not connected to FinCom yet. Choose \"Connect FinCom on this computer...\" from this icon.")
	case toInt(c["code"]) == 0:
		l = append(l, "Pairing: not checked (FinCom's cloud was not reached).")
	case toInt(c["code"]) == 200:
		l = append(l, "Pairing: OK, FinCom accepts this computer's key.")
	default:
		l = append(l, "Pairing: FinCom's cloud refused this computer's key ("+str(c["error"])+"). In FinCom: Settings > Tally Bridge, connect this computer again.")
	}
	return strings.Join(l, "\n\n")
}

// Windows 11 keeps each tray icon's settings under HKCU\Control Panel\NotifyIconSettings, with the program's path written
// with known folders as their ids ({6D809377-...}\FinCom Bridge\FinComBridge.exe): is that path this program's?
var knownFolders = [][2]string{
	{"{6D809377-6AF0-444B-8957-A3773F02200E}", "ProgramW6432"}, // Program Files
	{"{905E63B6-C1BF-494E-B29C-65B732D3D21A}", "ProgramFiles"},
	{"{7C5A40EF-A0FB-4BFC-874A-C0F2E0B9FA8E}", "ProgramFiles(x86)"},
	{"{F1B32785-6FBA-4FCF-9D55-7B8E7F157091}", "LOCALAPPDATA"},
	{"{3EB685DB-65F9-4CF6-A03A-E3EF65729F3D}", "APPDATA"},
}

func sameProgramPath(saved, exe string, env func(string) string) bool {
	norm := func(p string) string { return strings.ToLower(strings.TrimRight(strings.ReplaceAll(p, "/", `\`), `\`)) }
	for _, k := range knownFolders {
		if len(saved) >= len(k[0]) && strings.EqualFold(saved[:len(k[0])], k[0]) {
			if v := env(k[1]); v != "" {
				saved = v + saved[len(k[0]):]
				break
			}
		}
	}
	return saved != "" && norm(saved) == norm(exe)
}

type trayItem struct {
	id   int
	text string
}

// round 21 (2.1.10): the five trial items of the tray menu, shown only while FinCom's "Trial tools on this computer"
// (the owner's switch on the Tally page) is on; none of them names a company (each works on the company open in Tally
// and names it in its yes/no or its answer)
func trayTrialItems(st M) []trayItem {
	if st == nil || st["trialTools"] != true {
		return nil
	}
	return []trayItem{{18, "Test reading from Tally"}, {24, "Test fetching an entry"}, {19, "Recorder trial: note change numbers"}, {20, "Recorder trial: send results"},
		{21, "Recorder trial: lock the holding file for 30 s"}, {22, "Recorder trial: time saving"}}
}
