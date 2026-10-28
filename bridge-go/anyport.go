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
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

// Tally's own answer (review round 3, R3-5/R3-6: one rule for the plan and the typed port): its envelope first in the
// answer (a byte-order mark, white space or an XML declaration before it allowed), or Tally's own short refusal
// <RESPONSE>...</RESPONSE> (upper case, as Tally writes it, e.g. while a company is loading); never a <Response> inside
// another program's XML
var reTallyEnvelope = regexp.MustCompile(`^\x{FEFF}?\s*(<\?xml[^>]*\?>\s*)?<(?i:ENVELOPE)[\s>]`)
var reTallyAnswer = regexp.MustCompile(`^\x{FEFF}?\s*(<\?xml[^>]*\?>\s*)?(<(?i:ENVELOPE)[\s>]|<RESPONSE>)`)

func isTallyAnswer(raw string) bool { return reTallyAnswer.MatchString(raw) }

// review 2.4.8 (R1-3): an answer that shows the port is NOT Tally's: something came back and it is not Tally's XML. An
// empty answer proves nothing (taken as before)
func notTallyAnswer(raw string) bool { return strings.TrimSpace(raw) != "" && !isTallyAnswer(raw) }

// the typed try found the port's small check due (it did not answer lately): nothing was sent
var errTrialProbe = errors.New("Tally on this port did not answer lately; nothing is sent to it until it answers its small check")

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
const notTallyKeep = 10 * time.Minute

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
	useBusy      = "busy"      // a posting is going on, FinCom asked Tally at the same moment: try again
	useBad       = "bad"       // not a port number, the bridge's own port, Tally set on another computer
	useUnknown   = "unknown"   // Windows could not say whose program it is
	useError     = "error"     // the bridge could not try it (its words)
)

// the typed try's whole wait, the lock included: past it nothing is kept (the page gives up at 15 s)
var usePortWait = 8 * time.Second

func nothingWords(port int) string {
	return fmt.Sprintf("Nothing is listening on port %d on this computer. Check that TallyPrime is open and the port in TallyPrime: F1 Help > Settings > Connectivity (TallyPrime acts as Both).", port)
}

// the typed port's light request: the company list, the 2-second stop, postings first (it gives way to a posting), a
// trial (no small check, no marks); given up (the page answered): nothing is sent once it has the lock
func usePortTC(given *atomic.Bool, unplanned bool) *TC {
	return &TC{copier: true, light: true, trial: true, unplanned: unplanned, limitMs: recorderLimitMs(), yield: func() bool { return postingGoing() || given.Load() }}
}

// the port is in the plan now (a Tally the bridge already asks)
func portPlanned(port int) bool {
	_, plan := portPlan()
	for _, p := range plan {
		if toInt(p["port"]) == port {
			return true
		}
	}
	return false
}

// round 3 (R3-1): the Windows session of the program listening on the port is one of the owner's (Windows' listener
// table and process list, as tallyListeners decides "mine"); known false when Windows does not say
func portSessionMine(port int) (known, mine bool) {
	ok, procs, lis := netState()
	if !ok {
		return false, false
	}
	sess := map[int]int{}
	for _, p := range procs {
		sess[p.ID] = p.Session
	}
	for _, l := range lis {
		if l.Port == port {
			s, has := sess[l.Pid]
			return has, has && isMine(s)
		}
	}
	return false, false
}

// review 2.4.8 (R1-5, R3-1, R3-7): Windows says the program listening on the port is another Windows user's: its token's
// user is not this bridge's; or the program may not be opened (no user, no error) and it does not run in one of the
// owner's sessions (this user's TallyPrime run as administrator does: the session decides, as tallyListeners does).
// False when it is this user's, nothing listens or Windows cannot tell (not Windows). Only a definite answer is kept,
// for 5 seconds (the plan is made often)
var (
	otherUserMu sync.Mutex
	otherUserAt = map[int]time.Time{}
	otherUserIs = map[int]bool{}
)

func portOfOtherUser(port int) bool {
	otherUserMu.Lock()
	if at, ok := otherUserAt[port]; ok && time.Since(at) < 5*time.Second {
		v := otherUserIs[port]
		otherUserMu.Unlock()
		return v
	}
	otherUserMu.Unlock()
	sid, checked, err := listenerUserOf(port)
	if !checked || err != nil {
		return false
	}
	other := false
	if sid != "" {
		ok, _ := ownUserDecision(true, sid, nil, ownSIDsOf())
		other = !ok
	} else {
		// R4-3: the session decides; Windows not saying it decides nothing (not kept)
		known, mine := portSessionMine(port)
		if !known {
			return false
		}
		other = !mine
	}
	otherUserMu.Lock()
	otherUserAt[port], otherUserIs[port] = time.Now(), other
	otherUserMu.Unlock()
	return other
}

func resetOtherUser() {
	otherUserMu.Lock()
	otherUserAt, otherUserIs = map[int]time.Time{}, map[int]bool{}
	otherUserMu.Unlock()
}

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
	// review 2.4.8 (R1-4): whose program it is can be told only for this computer's ports
	if h := strings.ToLower(cfgS("TallyHost")); h != "" && h != "127.0.0.1" && h != "localhost" {
		return fail(useBad, "This FinCom Bridge is set to reach Tally on another computer (TallyHost), so it cannot tell whose TallyPrime a port is; Use this port works for this computer's TallyPrime only.")
	}
	// whose Tally: another Windows user's TallyPrime by its session (as the automatic plan sees it)
	lis := tallyListeners()
	for _, f := range lis {
		if toInt(f["port"]) == port && f["mine"] == false {
			who := str(f["user"])
			if who == "" {
				who = fmt.Sprint("Windows session ", f["session"])
			}
			return fail(useOtherUser, fmt.Sprintf("Port %d is the TallyPrime of %s, another Windows user on this computer. FinCom Bridge uses only your own TallyPrime (%s): open TallyPrime in your own login and use its port.", port, who, me))
		}
	}
	// anything there at all (a connection opened and closed: Tally is asked nothing; asked afresh, not the 5 s memory)
	openMu.Lock()
	delete(portSeen, port)
	openMu.Unlock()
	if !tallyPortOpen(port) {
		return fail(useNothing, nothingWords(port))
	}
	// whose program, by Windows (the process listening there and its user, as the bridge's own-user check)
	sid, checked, err := listenerUserOf(port)
	if checked {
		if err != nil && sid == "" && strings.Contains(err.Error(), "no program listens") {
			return fail(useNothing, nothingWords(port))
		}
		if err != nil {
			return fail(useUnknown, fmt.Sprintf("Windows did not say which program listens on port %d, so FinCom Bridge cannot tell whether it is your own TallyPrime; nothing was asked there. Try again in a moment.", port))
		}
		// R2-6, R4-5: a program this bridge may not open ("" with no error) is this user's only when Windows says it runs
		// in one of the owner's sessions (TallyPrime as administrator), the plan's own rule (portSessionMine); else another
		// user's (also when Windows does not say: the typed port is kept only when it is known to be this user's)
		_, mineBySession := portSessionMine(port)
		if ok, _ := ownUserDecision(true, sid, nil, ownSIDsOf()); !ok && !(sid == "" && mineBySession) {
			return fail(useOtherUser, fmt.Sprintf("Port %d belongs to a program of another Windows user on this computer (another user's TallyPrime). FinCom Bridge uses only your own TallyPrime (%s): open TallyPrime in your own login and use its port.", port, me))
		}
	}
	// review 2.4.8 (R1-1): postings first, and nothing waits unbounded: a posting going on, or FinCom waiting for Tally,
	// is said at once and nothing is sent
	busyWords := "FinCom Bridge is busy with Tally right now (a posting, or FinCom's own request). Try again in a moment."
	if postingGoing() || userWaiting(port) {
		return fail(useBusy, busyWords)
	}
	type res struct {
		raw string
		err error
	}
	got := make(chan res, 1)
	given := &atomic.Bool{}
	unplanned := !portPlanned(port)
	go func() {
		r, e := invokeTally(usePortTC(given, unplanned), port, companiesRequest(), 3)
		got <- res{r, e}
	}()
	var raw string
	select {
	case r := <-got:
		raw, err = r.raw, r.err
	case <-time.After(usePortWait):
		// review 2.4.8 (R1-1, R2-4): the try waited too long (for Tally's lock): it ends keeping nothing, and once it gets
		// the lock it sends nothing (its yield)
		given.Store(true)
		return fail(useBusy, busyWords)
	}
	lately := fmt.Sprintf("Port %d did not answer lately; FinCom Bridge asks it again by itself within a minute. If it is your TallyPrime, close any message box or long report in it, then try again.", port)
	switch {
	case err == nil && reTallyEnvelope.MatchString(raw):
	case err == nil && isTallyAnswer(raw):
		// R4-4: Tally's own short refusal, not its company list: not kept
		return fail(useTimeout, fmt.Sprintf("TallyPrime on port %d answered but did not give its list of companies (it may still be loading a company). Open a company in TallyPrime, then try again.", port))
	case err == nil:
		return fail(useNotTally, fmt.Sprintf("Port %d answers, but not as TallyPrime (another program uses it). Type the port shown in TallyPrime: F1 Help > Settings > Connectivity.", port))
	case errors.Is(err, errTrialProbe) || errors.Is(err, errProbeHold):
		return fail(useTimeout, lately) // R2-2: the bridge's own hold (a small check due or pending), nothing sent
	case errors.Is(err, errPreempted) || errors.Is(err, errBackoff) || errors.Is(err, errRetryWait):
		return fail(useBusy, busyWords)
	case errors.Is(err, errRecorderStop) || errors.Is(err, errTimeout) || re(`timed out`).MatchString(err.Error()):
		return fail(useTimeout, fmt.Sprintf("Port %d did not answer within 2 seconds. If it is your TallyPrime, it may be busy (a message box or a long report open): close it in TallyPrime and try again.", port))
	case re(`refused|No connection`).MatchString(err.Error()):
		return fail(useNothing, nothingWords(port))
	case errors.Is(err, errClosed) || re(`was closed|forcibly closed`).MatchString(err.Error()):
		return fail(useNotTally, fmt.Sprintf("Port %d closed the connection without answering. If it is your TallyPrime, try again in a moment; otherwise type the port shown in TallyPrime: F1 Help > Settings > Connectivity.", port))
	default:
		return fail(useError, fmt.Sprintf("FinCom Bridge could not try port %d: %s", port, cutRunes(err.Error(), 160)))
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
	resetOtherUser()
}
