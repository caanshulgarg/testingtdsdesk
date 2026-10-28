// FinCom Bridge 2.4.8 (the owner's approval of 28-Oct-2026: "on any port Tally should accept, or as you suggested put
// the port and it got connected"): TallyPrime on ANY port, never another Windows user's.
//
//	a. Automatic: every port a TallyPrime program of THIS Windows user listens on (Windows' TCP listener table with each
//	   listener's process, GetExtendedTcpTable; the process's Windows session the owner's, as before: tallyListeners) is
//	   tried, whatever its number, and is kept only while it answers as Tally (Tally's XML, <ENVELOPE ...>) to the light
//	   company list (TDSDeskCompanies, the request it was always asked: no new request). A port of a Tally program that
//	   answers but not as Tally (another of its listeners) is noted and left out of the plan while that same program holds
//	   it. tally.ini's port is only a hint: Tally found on another port is used. When Windows does not let the bridge list
//	   programs, the ports the tally.ini files name are tried before FallbackPorts.
//	b. Typed: POST /ports/use {"port": n} (FinCom's "Use this port"): the bridge tries 127.0.0.1:n once with the same light
//	   company list under the 2-second stop, through the same one-request-in-flight path (postings first), and keeps the
//	   port (TallyPorts [n]) only when it answers as Tally AND Windows says the program listening there is this Windows
//	   user's. Else it says why in plain words: nothing listening, not Tally, another user's Tally (or program), no answer
//	   in 2 seconds, a posting going on. {"port": 0}: back to automatic.
package main

import (
	"errors"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// Tally's own answer: its XML envelope (as keep.go and dupcheck.go recognise it)
func isTallyAnswer(raw string) bool { return re(`(?i)<ENVELOPE[\s>]`).MatchString(raw) }

// --- a. ports of a Tally program that answered, but not as Tally: port -> the program (pid) and when
type notTallyMark struct {
	pid int
	at  time.Time
}

var (
	notTallyMu sync.Mutex
	notTally   = map[int]notTallyMark{}
)

// a mark lasts while the same program holds the port, at most this long (then the port is asked again)
const notTallyKeep = 30 * time.Minute

func noteNotTally(port, pid int) {
	notTallyMu.Lock()
	notTally[port] = notTallyMark{pid, time.Now()}
	notTallyMu.Unlock()
}

func clearNotTally(port int) {
	notTallyMu.Lock()
	delete(notTally, port)
	notTallyMu.Unlock()
}

func resetNotTally() {
	notTallyMu.Lock()
	notTally = map[int]notTallyMark{}
	notTallyMu.Unlock()
}

// the port is held by the program (pid) that answered there not as Tally, and the mark is recent
func knownNotTally(port, pid int) bool {
	notTallyMu.Lock()
	defer notTallyMu.Unlock()
	m, ok := notTally[port]
	return ok && pid != 0 && m.pid == pid && time.Since(m.at) < notTallyKeep
}

// the Tally listeners found by Windows, without the ports known not to be Tally's
func tallyHTTPListeners(l []M) []M {
	if l == nil {
		return nil
	}
	out := []M{}
	for _, f := range l {
		if knownNotTally(toInt(f["port"]), toInt(f["pid"])) {
			continue
		}
		out = append(out, f)
	}
	return out
}

// the ports the tally.ini files of the TallyPrime folders name (Server Port), kept a minute; for the fallback only
var (
	iniPortsMu sync.Mutex
	iniPortsAt time.Time
	iniPortsL  []int
)

func tallyIniPorts() []int {
	iniPortsMu.Lock()
	defer iniPortsMu.Unlock()
	if !iniPortsAt.IsZero() && time.Since(iniPortsAt) < time.Minute {
		return append([]int{}, iniPortsL...)
	}
	var out []int
	for _, d := range tallyIniDirsFn() {
		p := toInt(tallyIni(filepath.Join(d, "tally.exe"))["port"])
		if p > 0 && p < 65536 && !containsInt(out, p) {
			out = append(out, p)
		}
	}
	iniPortsAt, iniPortsL = time.Now(), out
	return append([]int{}, out...)
}

func resetIniPorts() {
	iniPortsMu.Lock()
	iniPortsAt, iniPortsL = time.Time{}, nil
	iniPortsMu.Unlock()
}

// --- b. the typed port
const (
	useNothing   = "nothing"   // nothing listens on the port
	useNotTally  = "nottally"  // something answers, not as Tally
	useOtherUser = "otheruser" // Windows says the program there is another Windows user's
	useTimeout   = "timeout"   // no answer within 2 seconds
	useBusy      = "busy"      // a posting is going on / Tally left alone after no answer: try again
	useBad       = "bad"       // not a port number, or the bridge's own port
	useUnknown   = "unknown"   // Windows could not say whose program it is
)

// the typed port's light request: the company list, the 2-second stop, postings first (a background read gives way)
func usePortTC() *TC { return &TC{copier: true, light: true, limitMs: recorderLimitMs()} }

// what one try of a typed port found (no settings changed)
func tryTypedPort(port int) (M, error) {
	me := ownerName()
	fail := func(code, words string) (M, error) {
		return M{"ok": false, "port": port, "reason": code, "error": words}, nil
	}
	if port <= 0 || port > 65535 {
		return fail(useBad, "Type a port number from 1 to 65535 (TallyPrime shows its port in F1 Help > Settings > Connectivity).")
	}
	if port == toInt(cfg("Port")) {
		return fail(useBad, fmt.Sprintf("Port %d is FinCom Bridge's own port, not TallyPrime's. Type the port shown in TallyPrime: F1 Help > Settings > Connectivity.", port))
	}
	// whose Tally: another Windows user's TallyPrime by its session (as the automatic plan sees it)
	for _, f := range tallyListeners() {
		if toInt(f["port"]) == port && f["mine"] == false {
			who := str(f["user"])
			if who == "" {
				who = fmt.Sprint("Windows session ", f["session"])
			}
			return fail(useOtherUser, fmt.Sprintf("Port %d is the TallyPrime of %s, another Windows user on this computer. FinCom Bridge uses only your own TallyPrime (%s): open TallyPrime in your own login and use its port.", port, who, me))
		}
	}
	// anything there at all (a connection opened and closed: Tally is asked nothing)
	host := "127.0.0.1"
	if c, err := net.DialTimeout("tcp", fmt.Sprintf("%s:%d", host, port), 500*time.Millisecond); err != nil {
		return fail(useNothing, fmt.Sprintf("Nothing is listening on port %d on this computer. Check that TallyPrime is open and the port in TallyPrime: F1 Help > Settings > Connectivity (TallyPrime acts as Both).", port))
	} else {
		c.Close()
	}
	// whose program, by Windows (the process listening there and its user, as the bridge's own-user check)
	sid, checked, err := listenerUserOf(port)
	if checked {
		if err != nil && sid == "" && strings.Contains(err.Error(), "no program listens") {
			return fail(useNothing, fmt.Sprintf("Nothing is listening on port %d on this computer. Check that TallyPrime is open and the port in TallyPrime: F1 Help > Settings > Connectivity (TallyPrime acts as Both).", port))
		}
		if err != nil {
			return fail(useUnknown, fmt.Sprintf("Windows did not say which program listens on port %d, so FinCom Bridge cannot tell whether it is your own TallyPrime; nothing was asked there. Try again in a moment.", port))
		}
		if ok, _ := ownUserDecision(true, sid, nil, ownSIDsOf()); !ok {
			return fail(useOtherUser, fmt.Sprintf("Port %d belongs to a program of another Windows user on this computer (another user's TallyPrime). FinCom Bridge uses only your own TallyPrime (%s): open TallyPrime in your own login and use its port.", port, me))
		}
	}
	// the light company list, once, under the 2-second stop and the one-request-in-flight rule
	raw, err := invokeTally(usePortTC(), port, companiesRequest(), 3)
	switch {
	case err == nil && isTallyAnswer(raw):
	case err == nil:
		return fail(useNotTally, fmt.Sprintf("Port %d answers, but not as TallyPrime (another program uses it). Type the port shown in TallyPrime: F1 Help > Settings > Connectivity.", port))
	case errors.Is(err, errPreempted) || errors.Is(err, errBackoff) || errors.Is(err, errRetryWait) || postingGoing():
		return fail(useBusy, "FinCom Bridge is posting to Tally (or waiting for Tally to finish a request) right now. Try again in a moment.")
	case errors.Is(err, errRecorderStop) || errors.Is(err, errTimeout) || isBusyErr(err):
		return fail(useTimeout, fmt.Sprintf("Port %d did not answer within 2 seconds. If it is your TallyPrime, it may be busy (a message box or a long report open): close it in TallyPrime and try again.", port))
	case re(`refused|No connection`).MatchString(err.Error()):
		return fail(useNothing, fmt.Sprintf("Nothing is listening on port %d on this computer. Check that TallyPrime is open and the port in TallyPrime: F1 Help > Settings > Connectivity (TallyPrime acts as Both).", port))
	default:
		return fail(useNotTally, fmt.Sprintf("Port %d did not answer as TallyPrime (%s).", port, cutRunes(err.Error(), 120)))
	}
	cos := []any{}
	for _, c := range xmlDoc(raw).All("COMPANY") {
		if n := nameOf(c); n != "" {
			cos = append(cos, n)
		}
	}
	return M{"ok": true, "port": port, "companies": cos, "user": me}, nil
}

// POST /ports/use {"port": n}: tried, and kept only when it is this user's Tally; {"port": 0}: automatic again
func usePort(port int) (M, error) {
	if port == 0 {
		setCfg("TallyPorts", "auto")
		saveConfig()
		forgetPlanCache()
		writeLog("Tally's port: automatic again (FinCom's Use this port: 0)")
		return M{"ok": true, "port": 0, "auto": true}, nil
	}
	r, err := tryTypedPort(port)
	if err != nil || r["ok"] != true {
		if r != nil {
			writeLog(fmt.Sprintf("Tally's port %d typed in FinCom: not kept (%s)", port, str(r["reason"])))
		}
		return r, err
	}
	setCfg("TallyPorts", []any{float64(port)})
	saveConfig()
	clearNotTally(port)
	forgetPlanCache()
	writeLog(fmt.Sprintf("Tally's port %d typed in FinCom: your TallyPrime answered there; kept (TallyPorts [%d]; any other Tally of yours found is still tried after it)", port, port))
	return r, nil
}

// the company lists held from before name the old ports: asked afresh at the next look
func forgetPlanCache() {
	coMu.Lock()
	coCache = nil
	coMu.Unlock()
	_ = os.Remove(filepath.Join(syncDir(), "open-companies.json"))
	forgetTallyOpen()
}
