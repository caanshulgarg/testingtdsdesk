// FinCom Bridge 2.5.3 (the owner's approval of 03-Nov-2026: "it should open.. if anyone is trying to connect with
// FinCom.. it should connect instantly"): TallyPrime's connection switched on in tally.ini, on the add-on's own path
// (tallyini.go tallyIniApply: the same files, the same backup tally.ini.fincom-bak written first and never overwritten,
// the same no-link checks, write, read-back and put-back). Only two settings, nothing else:
//
//	Client Server = Both   ("TallyPrime acts as": None or Client becomes Both; Server or Both left as it is; the line
//	                        added at the end of the [Tally] section when there is none)
//	ServerPort = <n>       (kept when the file names one; else added: 9000 when free, else the first free port of
//	                        9001..9999 outside FinCom Bridge's own 9100..9199, free meaning no other tally.ini names it
//	                        and nothing listens on it now; 2.5.5: this login's own port first, below)
//
// 2.5.5 (the owner's Option B, loginport255.go): when the bridge switches the connection on in a tally.ini only this
// login uses (a computer one person uses) and the file names no port, the port added is FinCom's per-login port, the
// one the Tally page proposes for this login: the first of the login's ports (counted from its name, as the page
// counts) that no other tally.ini names and nothing listens on; none free, the choice above. A file that names a port
// keeps it. A file whose connection is already on and that names no port, while a Tally listens on TallyPrime's own
// 9000, is that Tally's working port: nothing is written (review P1; before 2.5.5 it got 9001). A tally.ini every user
// shares is not written (2.5.4, iniconnect254.go).
//
// The line keeps its own spelling and spacing; only the value changes. A file the bridge's Windows user cannot write is
// not touched ("cannot write"). Each file's state is in the beat (tallyIni[].connect): "enabled; Tally needs one
// restart", "already", "cannot write", "unreadable"; and the beat's tallyConnectSay gives the person's words while the
// user's Tally does not answer yet. Takes effect at Tally's next start. Nothing is sent to Tally.
package main

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"
	"unicode/utf16"
)

const (
	connectEnabled     = "enabled; Tally needs one restart"
	connectAlready     = "already"
	connectCannotWrite = "cannot write"
	connectUnreadable  = "unreadable"
	// the beat's words for the person (tallyConnectSay)
	connectSay = "FinCom switched on Tally's connection. Close and reopen Tally once."
)

var (
	reIniClientServer = regexp.MustCompile(`(?i)^(\s*client\s*server\s*=\s*)(\w*)(.*)$`)
	reIniServerPort   = regexp.MustCompile(`(?i)^\s*server\s*port\s*=\s*(\d+)\s*$`)
)

// tally.ini's text as the add-on rule reads it: UTF-16 LE with its BOM, UTF-8 with its BOM, else bytes as they are
func iniDecode(raw []byte) (string, string, bool) {
	switch {
	case len(raw) >= 2 && raw[0] == 0xFF && raw[1] == 0xFE:
		if len(raw)%2 != 0 {
			return "", "", false
		}
		u := make([]uint16, 0, len(raw)/2-1)
		for i := 2; i+1 < len(raw); i += 2 {
			u = append(u, uint16(raw[i])|uint16(raw[i+1])<<8)
		}
		t := string(utf16.Decode(u))
		return t, "utf16", !strings.ContainsRune(t, 0)
	case len(raw) >= 3 && raw[0] == 0xEF && raw[1] == 0xBB && raw[2] == 0xBF:
		t := string(raw[3:])
		return t, "utf8bom", !strings.ContainsRune(t, 0)
	}
	t := string(raw)
	return t, "plain", !strings.ContainsRune(t, 0)
}

func iniEncode(t, enc string) []byte {
	switch enc {
	case "utf16":
		b := []byte{0xFF, 0xFE}
		for _, u := range utf16.Encode([]rune(t)) {
			b = append(b, byte(u), byte(u>>8))
		}
		return b
	case "utf8bom":
		return append([]byte{0xEF, 0xBB, 0xBF}, t...)
	}
	return []byte(t)
}

// the rule on one file's bytes: the new bytes, the state (connectEnabled, connectAlready, connectUnreadable), the server
// port the file names after it, and the lines changed or added. used: a port another tally.ini names or something
// listens on
func iniConnect(raw []byte, used func(int) bool) ([]byte, string, int, []string) {
	return iniConnectPref(raw, used, nil)
}

// 2.5.5 (review P1): a Tally listens on this port now (Windows' listener table and the program that holds it); a hook
// for the tests
var iniTallyListensFn = func(port int) bool {
	ok, procs, lis := netState()
	if !ok {
		return false
	}
	names := map[int]string{}
	for _, p := range procs {
		names[p.ID] = p.Name
	}
	for _, l := range lis {
		if l.Port == port && reTally.MatchString(names[l.Pid]) {
			return true
		}
	}
	return false
}

// 2.5.5: the rule with this login's own port preferred: prefer is asked only when a port is to be added to a file whose
// connection this write switches on (it was off: no "Client Server" line, or None / Client), with used: the port it
// gives is taken (0: none preferred, or none free), else freeTallyPort's
func iniConnectPref(raw []byte, used func(int) bool, prefer func(used func(int) bool) int) ([]byte, string, int, []string) {
	text, enc, ok := iniDecode(raw)
	if !ok {
		return raw, connectUnreadable, 0, nil
	}
	nl := "\n"
	if strings.Contains(text, "\r\n") {
		nl = "\r\n"
	}
	lines := regexp.MustCompile(`\r?\n`).Split(text, -1)
	endNl := false
	if len(lines) > 0 && lines[len(lines)-1] == "" {
		lines, endNl = lines[:len(lines)-1], true
	}
	csAt, port, secEnd, inTally, anySection := -1, 0, len(lines), false, false
	for i, l := range lines {
		if m := reIniSection.FindStringSubmatch(l); m != nil {
			if inTally {
				secEnd, inTally = i, false
			}
			anySection = true
			if strings.EqualFold(strings.TrimSpace(m[1]), "Tally") {
				inTally = true
			}
			continue
		}
		if !inTally && anySection {
			continue // another section's line: not Tally's settings
		}
		if m := reIniClientServer.FindStringSubmatch(l); m != nil && csAt < 0 {
			csAt = i
		} else if m := reIniServerPort.FindStringSubmatch(l); m != nil && port == 0 {
			if p := toInt(m[1]); p > 0 && p < 65536 {
				port = p
			}
		}
	}
	var changed []string
	if csAt >= 0 {
		m := reIniClientServer.FindStringSubmatch(lines[csAt])
		if v := strings.ToLower(m[2]); v != "both" && v != "server" {
			lines[csAt] = m[1] + "Both" + m[3]
			changed = append(changed, strings.TrimSpace(lines[csAt]))
		}
	}
	var add []string
	if csAt < 0 {
		add = append(add, "Client Server = Both")
	}
	switching := csAt < 0 || len(changed) > 0
	if port == 0 && !switching && len(add) == 0 && iniTallyListensFn(tallyDefaultPort) {
		// 2.5.5 (review P1): the connection is on, the file names no port, and a Tally listens on TallyPrime's own
		// 9000: that is this file's working port. Nothing is written
		return raw, connectAlready, tallyDefaultPort, nil
	}
	if port == 0 {
		// 2.5.5: this login's own port, only when this write switches the connection on (no working port to change)
		if switching && prefer != nil {
			if p := prefer(used); p > 0 && p < 65536 && (used == nil || !used(p)) {
				port = p
			}
		}
		if port == 0 {
			port = freeTallyPort(used)
		}
		add = append(add, fmt.Sprintf("ServerPort = %d", port)) // TallyPrime's own spelling (proof72 p4)
	}
	if len(changed) == 0 && len(add) == 0 {
		return raw, connectAlready, port, nil
	}
	out := make([]string, 0, len(lines)+len(add)+1)
	out = append(out, lines[:secEnd]...)
	out = append(out, add...)
	out = append(out, lines[secEnd:]...)
	t := strings.Join(out, nl)
	if endNl {
		t += nl
	}
	return iniEncode(t, enc), connectEnabled, port, append(changed, add...)
}

// 9000 first, then 9001..9999 outside FinCom Bridge's own 9100..9199
func freeTallyPort(used func(int) bool) int {
	for p := 9000; p <= 9999; p++ {
		if p >= bridgePortFirst && p <= bridgePortLast {
			continue
		}
		if used == nil || !used(p) {
			return p
		}
	}
	return 9000
}

// 2.5.5: this login's own port (loginport255.go) for a tally.ini only this login uses: none on a computer several
// people use (its tally.ini is shared: 2.5.4's rule stands) or when the login's name is not known; a hook for the tests
var iniLoginPortFn = func(used func(int) bool) int { return iniLoginPort(ownerName(), used) }

// TallyPrime's own port when its tally.ini names none
const tallyDefaultPort = 9000

func iniLoginPort(windowsUser string, used func(int) bool) int {
	if iniSharedFn() {
		return 0
	}
	return loginOwnPortFree(windowsUser, used)
}

// a port another tally.ini names, or something listens on now (Windows' listener table; else a connection tried)
func iniPortUsed(self string) func(int) bool {
	others := map[int]bool{}
	for _, d := range tallyIniDirsFn() {
		p := filepath.Join(d, "tally.ini")
		if strings.EqualFold(filepath.Clean(p), filepath.Clean(self)) {
			continue
		}
		if n := toInt(tallyIni(filepath.Join(d, "tally.exe"))["port"]); n > 0 {
			others[n] = true
		}
	}
	ok, _, lis := netState()
	for _, l := range lis {
		others[l.Port] = true
	}
	return func(p int) bool {
		if others[p] {
			return true
		}
		if !ok {
			return tallyPortOpen(p)
		}
		return false
	}
}

// the bridge's Windows user may write the file: opened for writing (nothing written, not cut) and closed (a hook for
// the tests)
var iniWritableFn = func(path string) error {
	f, err := openNoLink(path, true)
	if err != nil {
		return err
	}
	return f.Close()
}

func isNoWrite(err error) bool {
	return err != nil && (errors.Is(err, os.ErrPermission) || strings.Contains(strings.ToLower(err.Error()), "access is denied"))
}

// the setup switched the connection on, and the bridge's own first start finds it on ("already"): the file's state
// stays "enabled; Tally needs one restart" (with the time it was switched on) for 24 hours, so the beat still says it
// until Tally has been restarted and answers (gate g253 n2 on TallyPrime 7.1)
func keepConnectEnabled(e, prev M) {
	if prev == nil || str(e["connect"]) != connectAlready || str(prev["connect"]) != connectEnabled {
		return
	}
	at, err := time.Parse(time.RFC3339, or(str(prev["connectAt"]), str(prev["at"])))
	if err != nil || nowFn().Sub(at) >= 24*time.Hour {
		return
	}
	e["connect"], e["connectAt"] = connectEnabled, at.Format(time.RFC3339)
	if p := prev["serverPort"]; p != nil && e["serverPort"] == nil {
		e["serverPort"] = p
	}
}

// the beat's words for the person: while one of the tally.ini files was switched on in the last 24 hours and none of
// the user's Tallys answers yet ("" otherwise)
//
// 2.5.4: "Tally's connection is off" (tallyWhy whyConnOff) gives its own plain fix (owntally254.go); the restart words
// are never given on a computer several people use (the file is theirs too: the words may not be true for this user)
func tallyConnectSay(why string, ini []any) string {
	if why == "" {
		return ""
	}
	if why == whyConnOff {
		return connOffWords()
	}
	if iniSharedFn() {
		return ""
	}
	for _, x := range ini {
		o := obj(x)
		if str(o["connect"]) != connectEnabled {
			continue
		}
		if at, err := time.Parse(time.RFC3339, or(str(o["connectAt"]), str(o["at"]))); err == nil && nowFn().Sub(at) < 24*time.Hour {
			return connectSay
		}
	}
	return ""
}
