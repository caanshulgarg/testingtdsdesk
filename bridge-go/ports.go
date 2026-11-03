// Which Tally is yours: on a shared server every signed-in user may run TallyPrime, each on its own port (9000, 9001,
// 9002...). The bridge uses only the Tally running in its owner's Windows session, and never reads or writes another
// user's (OnlyMySession). As the PowerShell bridge: Get-TallyListeners, Get-PortPlan, Get-OpenCompanies, Find-CompanyPort.
package main

import (
	"errors"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"
)

type proc struct {
	ID      int
	Name    string // without .exe, as Windows' Get-Process names it
	Session int
	Path    string
	Started time.Time
	// 2.5.3: Windows did not give the program's session (run as administrator, access denied): its owner is unknown,
	// never taken as session 0 (another user's)
	SessionUnknown bool
}
type listener struct{ Port, Pid int }

// --- test mode only: processes, listeners and users come from a file (TDSBRIDGE_FAKE)
func fakeFile() string {
	f := os.Getenv("TDSBRIDGE_FAKE")
	if f != "" && exists(f) {
		return f
	}
	return ""
}
func isFake() bool { return fakeFile() != "" }
func fakeData() M  { return readObjFile(fakeFile()) }

// the Windows sessions of the bridge's owner (the user it works for)
func mySessions() []int {
	if isFake() {
		return []int{toInt(fakeData()["mySession"])}
	}
	return platMySessions()
}
func mySession() int {
	s := mySessions()
	if len(s) == 0 {
		return -1
	}
	return s[0]
}
func isMine(session int) bool {
	for _, s := range mySessions() {
		if s == session {
			return true
		}
	}
	return false
}

func sessionUsers() map[int]string {
	m := map[int]string{}
	if f := fakeData(); f != nil {
		for k, v := range obj(f["users"]) {
			var n int
			fmt.Sscan(k, &n)
			m[n] = str(v)
		}
		return m
	}
	m = platSessionUsers()
	if _, ok := m[mySession()]; !ok {
		m[mySession()] = ownerName()
	}
	return m
}

// running programs and listening ports (real Windows data, or the test file)
func netState() (bool, []proc, []listener) {
	if f := fakeData(); f != nil {
		var ps []proc
		for _, x := range arr(f["processes"]) {
			o := obj(x)
			ps = append(ps, proc{ID: toInt(o["pid"]), Name: str(o["name"]), Session: toInt(o["session"]), Path: str(o["path"]), SessionUnknown: o["sessionUnknown"] == true})
		}
		var ls []listener
		for _, x := range arr(f["listeners"]) {
			o := obj(x)
			ls = append(ls, listener{toInt(o["port"]), toInt(o["pid"])})
		}
		return true, ps, ls
	}
	return platNetState()
}

// review L2 (06-Oct-2026): the Tally program alone (tally, TallyPrime; with or without .exe), never tallyscheduler or another
// helper TallyPrime 7.1 runs from its install folder (as tallyProgram, recorder_probes.go)
var reTally = regexp.MustCompile(`(?i)^tally(prime)?(\.exe)?$`)

// 2.5.3: whose a program is by its Windows session: "mine" (one of the owner's sessions), "other" (positively another
// signed-in user's session) or "unknown" (Windows did not give its session, or session 0, where no user signs in: a
// TallyPrime run as administrator or by a service). Only "other" is ever skipped
func sessionOwner(p proc) string {
	switch {
	case !p.SessionUnknown && isMine(p.Session):
		return "mine"
	case !p.SessionUnknown && p.Session != 0:
		return "other"
	}
	return "unknown"
}

// the plan's "mine": true, false (positively another user's) or nil (not known)
func mineOf(owner string) any {
	switch owner {
	case "mine":
		return true
	case "other":
		return false
	}
	return nil
}

// TallyPrime programs that are listening, with the Windows session they run in; nil when Windows cannot tell
func tallyListeners() []M {
	ok, procs, lis := netState()
	if !ok {
		return nil
	}
	byID := map[int]proc{}
	for _, p := range procs {
		if reTally.MatchString(p.Name) {
			byID[p.ID] = p
		}
	}
	out := []M{}
	if len(byID) == 0 {
		return out
	}
	users := sessionUsers()
	seen := map[int]bool{}
	for _, c := range lis {
		p, ok := byID[c.Pid]
		if !ok || seen[c.Port] {
			continue
		}
		seen[c.Port] = true
		own := sessionOwner(p)
		var sess any = p.Session
		if p.SessionUnknown {
			sess = nil
		}
		out = append(out, M{"port": c.Port, "pid": c.Pid, "session": sess, "mine": mineOf(own), "owner": own, "program": p.Name, "user": users[p.Session]})
	}
	return out
}

// TallyPrime's own settings (tally.ini next to tally.exe), read-only
func tallyIni(exe string) M {
	info := M{"found": false, "path": "", "mode": "", "port": 0}
	if exe == "" {
		return info
	}
	ini := filepath.Join(filepath.Dir(strings.ReplaceAll(exe, `\`, string(filepath.Separator))), "tally.ini")
	if !exists(ini) {
		return info
	}
	t := readText(ini)
	info["found"], info["path"] = true, ini
	if m := group(`(?im)^\s*client\s*server\s*=\s*(\w+)`, t, 1); m != "" {
		info["mode"] = m
	}
	if m := group(`(?im)^\s*server\s*port\s*=\s*(\d+)`, t, 1); m != "" {
		info["port"] = toInt(m)
	}
	// 2.3.0: the data folder (Data = ...), for FinCom's Tally page: which Tally, which books
	if m := group(`(?im)^\s*data\s*=\s*(.+?)\s*$`, t, 1); m != "" {
		info["data"] = m
	}
	return info
}

// a plain-language check: is your Tally reachable, and if not, why (Get-Diagnosis)
func diagnosis() M {
	ok, procs, lis := netState()
	users := sessionUsers()
	me := users[mySession()]
	findings := []M{}
	add := func(level, text, fix string) {
		findings = append(findings, M{"level": level, "text": text, "fix": fix})
	}
	tallies := []M{}
	listeners := []M{}
	owner := map[int]M{}
	if ok {
		byID := map[int]proc{}
		for _, p := range procs {
			byID[p.ID] = p
		}
		for _, c := range lis {
			p, has := byID[c.Pid]
			// 2.4.8 (anyport.go): a TallyPrime program's port counts whatever its number (TallyPrime on 4125 is not "not
			// accepting connections"); other programs' ports only in 9000-9999, as before (a port Tally may want)
			isTally := has && reTally.MatchString(p.Name)
			if owner[c.Port] != nil || (!isTally && (c.Port < 9000 || c.Port > 9999)) || (isTally && knownNotTally(c.Port, c.Pid)) {
				continue
			}
			o := M{"port": c.Port, "pid": c.Pid, "program": "", "session": -1, "user": ""}
			if has {
				o["program"], o["session"], o["user"] = p.Name, p.Session, users[p.Session]
			}
			owner[c.Port] = o
			listeners = append(listeners, o)
		}
		for _, p := range procs {
			if !reTally.MatchString(p.Name) {
				continue
			}
			ports := []int{}
			for _, l := range listeners {
				if toInt(l["pid"]) == p.ID {
					ports = append(ports, toInt(l["port"]))
				}
			}
			// 2.5.3: a Tally whose owner is unknown counts as possibly yours (it is asked), never as another user's
			tallies = append(tallies, M{"pid": p.ID, "program": p.Name, "session": p.Session, "user": users[p.Session], "mine": sessionOwner(p) != "other", "owner": sessionOwner(p), "ports": ports, "ini": tallyIni(p.Path)})
		}
	}
	free := 0
	for p := 9001; p <= 9099; p++ {
		if owner[p] == nil {
			free = p
			break
		}
	}
	var mine, others []M
	for _, t := range tallies {
		if t["mine"] == true {
			mine = append(mine, t)
		} else {
			others = append(others, t)
		}
	}
	portList := func(a []int) string {
		s := make([]string, len(a))
		for i, p := range a {
			s[i] = fmt.Sprint(p)
		}
		return strings.Join(s, ", ")
	}
	if !ok {
		add("warn", "Windows did not let the bridge see which programs are running, so it cannot tell which Tally is yours.", "In FinCom > Settings > Tally Bridge, press \"Use this Tally\" on your own Tally (the port shown in TallyPrime: F1 > Settings > Connectivity).")
	} else if len(mine) == 0 {
		txt := "TallyPrime is not running in your Windows login (" + me + ")."
		if len(others) > 0 {
			var p []string
			for _, t := range others {
				u := str(t["user"])
				if u == "" {
					u = fmt.Sprint("session ", t["session"])
				}
				if ps := t["ports"].([]int); len(ps) > 0 {
					u += " (port " + portList(ps) + ")"
				}
				p = append(p, u)
			}
			txt += " TallyPrime is running for: " + strings.Join(p, "; ") + "."
		}
		add("bad", txt, "Open TallyPrime in your own login. If that Tally above is yours, install the bridge from that same login - the bridge only uses the Tally of the Windows user it works for ("+me+").")
	} else {
		for _, t := range mine {
			ps := t["ports"].([]int)
			if len(ps) > 0 {
				add("ok", "Your TallyPrime accepts connections on port "+portList(ps)+".", "")
				continue
			}
			ini := t["ini"].(M)
			want := 9000
			if toInt(ini["port"]) > 0 {
				want = toInt(ini["port"])
			}
			if ini["found"] == true && str(ini["mode"]) != "" && !re(`(?i)^(both|server)$`).MatchString(str(ini["mode"])) {
				add("bad", "Your TallyPrime is not set to accept connections (\"TallyPrime acts as\" is "+str(ini["mode"])+").", "In TallyPrime: F1 Help > Settings > Connectivity > set \"TallyPrime acts as\" to Both, keep a port, save and restart TallyPrime.")
				continue
			}
			if h := owner[want]; h != nil && toInt(h["pid"]) != toInt(t["pid"]) {
				who := str(h["user"])
				if who == "" {
					who = fmt.Sprint("Windows session ", h["session"])
				}
				if reTally.MatchString(str(h["program"])) {
					add("bad", fmt.Sprintf("Your TallyPrime is running but cannot accept connections: port %d is already taken by the TallyPrime of %s. Only one program can use a port, so each user needs a different one.", want, who), fmt.Sprintf("In YOUR TallyPrime: F1 Help > Settings > Connectivity > Port = %d (free), save and restart TallyPrime. If that setting changes the port for every user of the server, ask your server provider to give each user a separate Tally port.", free))
				} else {
					add("bad", fmt.Sprintf("Port %d is taken by another program (%s, %s), so your TallyPrime cannot use it.", want, str(h["program"]), who), fmt.Sprintf("In TallyPrime: F1 Help > Settings > Connectivity > Port = %d, save and restart TallyPrime.", free))
				}
			} else {
				add("bad", fmt.Sprintf("Your TallyPrime is running but is not accepting connections on port %d yet.", want), "In TallyPrime: F1 Help > Settings > Connectivity > \"TallyPrime acts as\" = Both, then close and reopen TallyPrime (the setting takes effect after a restart).")
			}
		}
	}
	return M{"ok": true, "version": BridgeVersion, "user": me, "mySession": mySession(), "seeProcesses": ok, "findings": findings, "tallies": tallies, "listeners": listeners, "freePort": free}
}

// the ports to try (2.5.3: a chain that cannot silently end empty): the ports the settings name (TallyPorts), then
//  1. every port a TallyPrime program of this user's Windows session listens on,
//  2. every port a TallyPrime program whose owner is unknown listens on (its session not given, or session 0),
//  3. every tally.ini's Server Port and the default 9000 (and, when Windows does not let the bridge list programs,
//     FallbackPorts), whether or not Windows' listener list shows them (a port named by hand or by tally.ini is never
//     only remembered: it is checked for a listener first, nothing is sent to a closed one),
//  4. the ports of TallyPrime programs positively of another signed-in user, listed (skipped) so the beat can say so.
//
// A port of a Tally program known to answer not as Tally is left out (2.4.8). Mode: "config" with TallyPorts set,
// "fallback" when Windows did not list programs, else "auto"
func portPlan() (string, []M) {
	lis := tallyListeners()
	found := map[int]M{}
	for _, f := range lis {
		if _, had := found[toInt(f["port"])]; !had {
			found[toInt(f["port"])] = f
		}
	}
	var l []M
	seen := map[int]bool{}
	add := func(m M) {
		p := toInt(m["port"])
		if p <= 0 || p > 65535 || seen[p] || (cfgS("Port") != "" && p == toInt(cfg("Port"))) {
			return
		}
		seen[p] = true
		l = append(l, m)
	}
	byPort := func(p int, via string) {
		if f, ok := found[p]; ok {
			add(f)
			return
		}
		// no Tally program Windows lists there: whose the listener is, by Windows (false: another user's), else not known
		add(M{"port": p, "pid": nil, "session": nil, "mine": mineByWindows(p), "program": "", "via": via})
	}
	mode := "auto"
	if ports, auto := cleanPorts(cfg("TallyPorts")); !auto {
		// 2.3.0: a port set by hand that Windows shows as another user's Tally (another session) is that user's: marked so,
		// and skipped with OnlyMySession like any other user's Tally
		mode = "config"
		for _, p := range ports {
			byPort(p, "settings")
		}
	}
	listed := tallyHTTPListeners(lis)
	for _, f := range listed {
		if f["mine"] == true {
			add(f)
		}
	}
	for _, f := range listed {
		if f["mine"] == nil {
			add(f)
		}
	}
	more := mergePorts(tallyIniPorts(), []int{9000})
	if lis == nil {
		if mode == "auto" {
			mode = "fallback"
		}
		fb, _ := cleanPorts(cfg("FallbackPorts"))
		more = mergePorts(more, fb)
	}
	for _, p := range more {
		byPort(p, "tally.ini")
	}
	for _, f := range listed {
		if f["mine"] == false {
			add(f)
		}
	}
	if l == nil {
		l = []M{}
	}
	return mode, l
}

// --- which companies are open: shared through a file and kept 30 s, so status checks cost Tally nothing
var (
	coMu      sync.Mutex
	coCache   []M
	coCacheAt time.Time
	planMode  string
	coInfo    M
)

func coInfoFile() string { return filepath.Join(syncDir(), "company-info.json") }

// round 22 (the 2.1.10 reviews' Medium 4 / S4): coInfo (and its file) only under coInfoMu: the company list is asked
// from /status, Test connection, the keeper, note change numbers and the light check's own goroutine at once, and a
// map read and written together ends the process. The lock is never held while Tally is asked (look up, let go, ask,
// take it again, store); a stored entry is never changed afterwards, so callers may read it without the lock
var coInfoMu sync.Mutex

// for the tests: forget what is held in memory
func resetCoInfo() {
	coInfoMu.Lock()
	coInfo = nil
	coInfoMu.Unlock()
}

// a company's GSTIN and PAN: asked once, when it is first seen, and remembered
func getCoInfo(tc *TC, name string, port int) M {
	coInfoMu.Lock()
	if coInfo == nil {
		coInfo = readObjFile(coInfoFile())
		if coInfo == nil {
			coInfo = M{}
		}
	}
	if x := obj(coInfo[name]); x != nil {
		at, _ := parseTime(str(x["at"]))
		if str(x["gstin"]) != "" || str(x["pan"]) != "" || time.Since(at) < 6*time.Hour {
			coInfoMu.Unlock()
			return x
		}
	}
	coInfoMu.Unlock()
	g, pan := "", ""
	if raw, err := invokeTally(tc, port, coInfoRequest(name), 15); err == nil {
		if c := xmlDoc(raw).All("COMPANY"); len(c) > 0 {
			g = nt(c[0], "GSTREGISTRATIONNUMBER")
			if g == "" {
				g = nt(c[0], "GSTREGISTRATIONDETAILS.LIST/GSTIN")
			}
			pan = nt(c[0], "INCOMETAXNUMBER")
		}
	}
	x := M{"gstin": g, "pan": pan, "at": nowS()}
	coInfoMu.Lock()
	defer coInfoMu.Unlock()
	if coInfo == nil { // forgotten meanwhile (a test)
		coInfo = M{}
	}
	coInfo[name] = x
	_ = saveFile(coInfoFile(), jsonText(coInfo))
	return x
}

func copySessions(l []M) []M {
	o := make([]M, len(l))
	for i, e := range l {
		c := M{}
		for k, v := range e {
			c[k] = v
		}
		o[i] = c
	}
	return o
}

// Get-OpenCompanies: asks each of your Tallys which companies are open (fresh: always asks). Only after an event (a
// posting, Update now, a client opened in FinCom, the nightly catch-up) or a person's request: never on a timer
func openCompanies(fresh bool) []M { return openCompaniesWith(fin, fresh) }

func openCompaniesWith(tc *TC, fresh bool) []M {
	l, _ := openCompaniesAsk(tc, fresh)
	return l
}

// round 22 (the 2.1.10 code review's Low 7): also whether Tally was asked and every Tally that is open and not skipped
// gave its list afresh (false: a list held from before stands for one, or one did not answer, or nothing was asked)
func openCompaniesAsk(tc *TC, fresh bool) ([]M, bool) {
	cacheSec := toInt(cfg("StatusCacheSec"))
	if cacheSec < 30 {
		cacheSec = 30
	}
	// 2.5.3: a list held counts only while it still matches Windows' list now (cacheMatches): a Tally opened, moved or
	// restarted since (Connect, the Tally page) is asked at once
	mode, plan := portPlan()
	coMu.Lock()
	if !fresh && coCache != nil && time.Since(coCacheAt).Seconds() < float64(cacheSec) && cacheMatches(coCache, plan) {
		c := copySessions(coCache)
		coMu.Unlock()
		return c, false
	}
	coMu.Unlock()
	shared := filepath.Join(syncDir(), "open-companies.json")
	if !fresh {
		if t, ok := mtime(shared); ok && time.Since(t).Seconds() < float64(cacheSec) {
			if l := sessionsFromFile(shared); l != nil && cacheMatches(l, plan) {
				coMu.Lock()
				coCache, coCacheAt = l, t
				coMu.Unlock()
				return copySessions(l), false
			}
		}
	}
	sessions := []M{}
	allFresh := true
	// fix 3: what the bridge's OWN Tallys list now (never a Tally Windows shows as another user's), for the recorder's rule
	// that a line is taken only for a company open in the own Tally (recorder_owntally.go); ownAll: each answered or is closed
	ownOpen, ownAll := map[string]string{}, true
	for _, pp := range plan {
		e := planEntry(pp)
		if e["skipped"] == true {
			sessions = append(sessions, e)
			continue
		}
		if !tallyRunning() || !tallyPortOpen(toInt(pp["port"])) {
			// closed: nothing is sent to it
			e["error"], e["tallyState"], e["reason"] = "Tally is not open (nothing listens on this port)", "closed", "closed"
			sessions = append(sessions, e)
			continue
		}
		// 2.5.3: a Tally whose owner is unknown: left to another FinCom Bridge of this computer that already uses it
		if pp["mine"] == nil && tallyHostLocal() {
			if who := otherBridgeClaimFn(toInt(pp["port"])); who != "" {
				e["skipped"], e["reason"] = true, "another bridge"
				e["error"] = "owner unknown; the FinCom Bridge of " + who + " on this computer uses this Tally"
				sessions = append(sessions, e)
				continue
			}
		}
		// 2.3.1: asked in the background (tc.bg), it follows the shared retry schedule (retry.go)
		raw, err := invokeTally(tc, toInt(pp["port"]), companiesRequest(), 8)
		if err != nil {
			allFresh = false
			if pp["mine"] != false {
				ownAll = false
			}
		}
		if err != nil && (errors.Is(err, errPreempted) || errors.Is(err, errBackoff) || errors.Is(err, errRecorderStop) || errors.Is(err, errRetryWait)) && prevCompanies(toInt(pp["port"])) != nil {
			// a background read stopped or held back (2.3.1: or stopped at its 2 s hard stop): the companies named last time
			// stand, nothing new is known
			e["ok"], e["companies"], e["tallyState"] = true, prevCompanies(toInt(pp["port"])), "open"
		} else if err != nil && isBusyErr(err) && tallyPortOpen(toInt(pp["port"])) && prevCompanies(toInt(pp["port"])) != nil {
			// a busy Tally is still open: the companies it named last time stay, marked busy
			e["ok"], e["companies"], e["busy"], e["tallyState"] = true, prevCompanies(toInt(pp["port"])), true, "busy"
		} else if err != nil {
			e["error"] = err.Error()
			if pp["mine"] == nil {
				e["error"] = ownerUnknownWords + ": " + err.Error()
			}
		} else if notTallyAnswer(raw) {
			// 2.4.8 (anyport.go): the port answers, but not as Tally (another listener of a Tally program, or another
			// program on a port set by hand): not a Tally; a program's port is left out of the plan while it holds it
			e["error"], e["notTally"] = "this port answers, but not as TallyPrime", true
			if pid := toInt(pp["pid"]); pid != 0 {
				noteNotTally(toInt(pp["port"]), pid)
			}
		} else {
			if isTallyAnswer(raw) {
				clearNotTally(toInt(pp["port"])) // review 2.4.8 (R1-3, R2-8): Tally's own answer ends an earlier mark
			}
			list := []any{}
			for _, c := range xmlDoc(raw).All("COMPANY") {
				name := nameOf(c)
				if name == "" {
					continue
				}
				inf := getCoInfo(tc, name, toInt(pp["port"]))
				noteCompanyGUID(name, nt(c, "GUID")) // the first GUID seen is held; another one is noted, never taken
				if pp["mine"] != false {
					noteBooksFrom(name, nt(c, "BOOKSFROM")) // 2.5.0: the ledger reads' period, from this user's own Tally only (booksfrom.go)
					ownOpen[liveOwnKey(nt(c, "GUID"), name)], ownOpen[liveOwnKey("", name)] = name, name
				}
				list = append(list, M{"name": name, "from": nt(c, "STARTINGFROM"), "to": nt(c, "ENDINGAT"), "guid": nt(c, "GUID"), "gstin": str(inf["gstin"]), "pan": str(inf["pan"]),
					"booksFrom": normDate(nt(c, "BOOKSFROM"))})
			}
			e["ok"] = true
			e["companies"] = list
			e["tallyState"] = "open"
		}
		e["reason"] = portReason(e)
		sessions = append(sessions, e)
	}
	coMu.Lock()
	planMode = mode
	coCache, coCacheAt = sessions, time.Now()
	coMu.Unlock()
	_ = saveFile(shared, jsonText(sessions))
	liveNoteOwnTally(ownOpen, ownAll)
	return copySessions(sessions), allFresh
}

// the companies a Tally named the last time it answered
func prevCompanies(port int) []any {
	coMu.Lock()
	c := coCache
	coMu.Unlock()
	if c == nil {
		c = sessionsFromFile(filepath.Join(syncDir(), "open-companies.json"))
	}
	for _, e := range c {
		if toInt(e["port"]) == port && e["ok"] == true && len(sessCompanies(e)) > 0 {
			return arr(e["companies"])
		}
	}
	return nil
}

func sessionsFromFile(f string) []M {
	var out []M
	for _, x := range arr(readJSONFile(f)) {
		if o := obj(x); o != nil {
			var cs []any
			for _, c := range arr(o["companies"]) {
				if obj(c) != nil {
					cs = append(cs, c)
				}
			}
			if cs == nil {
				cs = []any{}
			}
			o["companies"] = cs
			out = append(out, o)
		}
	}
	if out == nil && exists(f) {
		return []M{}
	}
	return out
}

func sessCompanies(s M) []M {
	var o []M
	for _, c := range arr(s["companies"]) {
		if m := obj(c); m != nil {
			o = append(o, m)
		}
	}
	return o
}

// --- "Is Tally open?" (2.1.3), answered without sending Tally a request: the Tally program is running (Windows: its
// process, tally.exe, in the list of programs) and its port takes a connection, which is closed at once. Kept a few
// seconds, so the tray and the heartbeat asking often cost nothing
var (
	openMu    sync.Mutex
	portSeen  = map[int][2]any{} // port -> {time, open}
	runSeen   time.Time
	runCached bool
)

// the tests: Tally's program "closed"
var tallyStandInClosed bool

func tallyRunning() bool {
	openMu.Lock()
	defer openMu.Unlock()
	if time.Since(runSeen) < 5*time.Second {
		return runCached
	}
	runCached, runSeen = platTallyRunning() && !tallyStandInClosed, time.Now()
	return runCached
}

// a connection opened and closed; Tally is asked nothing
func tallyPortOpen(port int) bool {
	openMu.Lock()
	if v, ok := portSeen[port]; ok && time.Since(v[0].(time.Time)) < 5*time.Second {
		openMu.Unlock()
		return v[1].(bool)
	}
	openMu.Unlock()
	host := cfgS("TallyHost")
	if host == "" {
		host = "127.0.0.1"
	}
	open := false
	if c, err := net.DialTimeout("tcp", fmt.Sprintf("%s:%d", host, port), 500*time.Millisecond); err == nil {
		c.Close()
		open = true
	}
	openMu.Lock()
	portSeen[port] = [2]any{time.Now(), open}
	openMu.Unlock()
	return open
}
func forgetTallyOpen() {
	openMu.Lock()
	portSeen, runSeen = map[int][2]any{}, time.Time{}
	openMu.Unlock()
}

// Tally open on any of your ports (the program running, the port taking a connection): the port, or 0
func tallyOpenNow() int {
	if !tallyRunning() {
		return 0
	}
	_, plan := portPlan()
	for _, pp := range plan {
		if cfgB("OnlyMySession") && pp["mine"] == false {
			continue
		}
		if tallyPortOpen(toInt(pp["port"])) {
			return toInt(pp["port"])
		}
	}
	return 0
}

// Get-OpenCompaniesCached (1.14.0; 2.1.3 never asks Tally at all): the companies Tally named the last time it was asked
// after an event, and whether Tally is open now (the program running and its port taking a connection)
//
// 2.5.3 (the Durgesh beat: the list of an earlier ask named an old port, 1817, closed since, and never the own Tally
// opened later on 9070, so the beat said "closed" for ever: nothing was open, so no event asked again): the list held is
// matched with Windows' list now (portPlan, no request to Tally). A port no longer in the plan goes; a port new in the
// plan, or whose owner changed, is added as it stands, and the company list is asked afresh in the background (once a
// minute at most, the same light request under the 2-second stop, one in flight, postings first: askAfreshFn)
func openCompaniesCached() []M { return openCompaniesCachedOnce(true) }

func openCompaniesCachedOnce(mayAsk bool) []M {
	shared := filepath.Join(syncDir(), "open-companies.json")
	before, _ := mtime(shared)
	held := sessionsFromFile(shared)
	_, plan := portPlan()
	byPort := map[int]M{}
	for _, e := range held {
		if _, had := byPort[toInt(e["port"])]; !had {
			byPort[toInt(e["port"])] = e
		}
	}
	list := []M{}
	changed := len(held) != len(plan)
	for _, pp := range plan {
		now := planEntry(pp)
		e, had := byPort[toInt(pp["port"])]
		if !had || (e["skipped"] == true) != (now["skipped"] == true) || fmt.Sprint(e["mine"]) != fmt.Sprint(now["mine"]) {
			e = now
			changed = true
		}
		list = append(list, e)
	}
	ask := false
	for _, e := range list {
		if e["skipped"] == true {
			continue
		}
		st := tallyState(toInt(e["port"]))
		open := st != "closed"
		e["ok"] = open
		e["tallyState"], e["busy"] = st, st == "busy"
		if !open {
			e["companies"] = []any{}
			e["reason"] = "closed"
			continue
		}
		if r := str(e["reason"]); r == "" || r == "closed" {
			e["reason"] = portReason(e)
		}
		// a Tally Windows shows now that the list held does not (or not as it is), or one held without its companies
		ask = ask || changed
	}
	if ask && mayAsk && askAfreshSoon() {
		if after, ok := mtime(shared); ok && after.After(before) {
			return openCompaniesCachedOnce(false) // asked at once (a person's check now): its answer
		}
	}
	return list
}

// findCompany: the Tally (port) where the company is open, and its name as Tally writes it, found now: the cached list
// first, then Tally asked afresh. The company is the exact one asked for (spaces, line breaks and capitals aside), never
// another that happens to be open. preferred (the Tally chosen in FinCom, or where it was found last) is only a hint:
// Tally may have been started again on another port. The error says why it cannot be posted to now (*tallyWait).
func findCompany(company string, preferred int) (int, string, error) {
	return findCompanyIn(company, preferred, []bool{false, true})
}

// review M1 (06-Oct-2026): the same for a BACKGROUND read (the ledger changes, the recorder's body fetch, its resolve of
// held lines, its GUID ask): the company list asked under the 2-second hard stop (bgCompaniesTC) and never while the
// shared retry schedule waits (retryHeld, retry.go): then the companies named last time stand. A person's request and a posting use findCompany /
// findCompanyNow, unchanged
func findCompanyPortBg(company string, preferred int) (int, error) {
	p, _, err := findCompanyWith(company, preferred, []bool{false, true}, func(fresh bool) []M {
		if retryHeld() {
			return openCompaniesCached()
		}
		l, _ := openCompaniesAsk(bgCompaniesTC(), fresh)
		return l
	})
	return p, err
}

// for a posting: Tally asked now, every time (a list even 30 seconds old may name a company closed since)
func findCompanyNow(company string, preferred int) (int, string, error) {
	return findCompanyIn(company, preferred, []bool{true})
}

func findCompanyIn(company string, preferred int, passes []bool) (int, string, error) {
	return findCompanyWith(company, preferred, passes, openCompanies)
}

func findCompanyWith(company string, preferred int, passes []bool, list func(fresh bool) []M) (int, string, error) {
	var last error
	for _, fresh := range passes {
		last = nil
		var usable []M
		answered, busy := false, false
		for _, s := range list(fresh) {
			if s["skipped"] == true {
				continue
			}
			if s["ok"] == true {
				usable = append(usable, s)
				answered = true
				if s["busy"] == true {
					busy = true
				}
			} else if re(`(?i)timed out|timeout|busy`).MatchString(str(s["error"])) {
				busy = true
			}
		}
		type hit struct {
			port int
			name string
			mine bool
		}
		var hits []hit
		for _, u := range usable {
			var names []string
			for _, c := range sessCompanies(u) {
				names = append(names, str(c["name"]))
			}
			name, n := matchCompany(company, names)
			if n > 1 {
				last = &tallyWait{"many", fmt.Sprintf("Tally on port %d has more than one company named like '%s'; it is not known which one is meant.", toInt(u["port"]), company)}
				continue
			}
			if n == 1 {
				hits = append(hits, hit{toInt(u["port"]), name, u["mine"] == true})
			}
		}
		if preferred > 0 {
			for _, h := range hits {
				if h.port == preferred {
					return h.port, h.name, nil
				}
			}
		}
		if len(hits) == 1 {
			return hits[0].port, hits[0].name, nil
		}
		if len(hits) > 1 {
			var mine []hit
			for _, h := range hits {
				if h.mine {
					mine = append(mine, h)
				}
			}
			if len(mine) == 1 {
				return mine[0].port, mine[0].name, nil
			}
			var p []string
			for _, h := range hits {
				p = append(p, fmt.Sprint(h.port))
			}
			last = &tallyWait{"many", fmt.Sprintf("Company '%s' is open in more than one Tally (ports %s). Choose your Tally in FinCom > Settings > Tally Bridge.", company, strings.Join(p, ", "))}
			continue
		}
		switch {
		case last != nil:
		case busy && !answered:
			last = &tallyWait{"busy", "Tally is busy and did not answer in time."}
		case !answered:
			last = &tallyWait{"closed", "TallyPrime is not running in your Windows login, or does not accept connections (F1 Help > Settings > Connectivity: TallyPrime acts as Both)."}
		default:
			last = &tallyWait{"notopen", fmt.Sprintf("Company '%s' is not open in Tally. Open it in TallyPrime on this computer and try again.", company)}
		}
	}
	return 0, "", last
}

// the port only (the readers): see findCompany
func findCompanyPort(company string, preferred int) (int, error) {
	p, _, err := findCompany(company, preferred)
	return p, err
}

// --- the person at the computer (Tally comes first: the copier does not read while someone works in Tally)
func idleSec() float64 {
	if isFake() {
		if v := cfg("KeepFakeIdleSec"); v != nil {
			return num(v)
		}
		return 99999
	}
	return platIdleSec()
}
func keepUserInTally() bool {
	if isFake() {
		return cfgB("KeepFakeUserBusy")
	}
	if idleSec() >= float64(keepNum("KeepUserIdleSec", 15)) {
		return false
	}
	return platFrontIsTally()
}

// review 2.4.8 (R1-5): a port the plan names without a Tally program Windows lists there (set by hand, or tally.ini's
// in the fallback): false when Windows says the program listening there is another Windows user's (then skipped with
// OnlyMySession like any other user's Tally), else nil (not known), as before
func mineByWindows(port int) any {
	if portOfOtherUser(port) {
		return false
	}
	return nil
}

// a first, then b's ports not in a
func mergePorts(a, b []int) []int {
	out := append([]int{}, a...)
	for _, p := range b {
		if !containsInt(out, p) {
			out = append(out, p)
		}
	}
	return out
}

func containsInt(a []int, x int) bool {
	for _, v := range a {
		if v == x {
			return true
		}
	}
	return false
}

// the list of companies loaded in Tally (name, books' period, GUID)
func companiesRequest() string {
	// 2.5.0 (the owner's decision of 30-Oct-2026): BOOKSFROM too, the books' beginning the ledger reads take as their period
	return collectionRequest("TDSDeskCompanies", "Company", "NAME,STARTINGFROM,ENDINGAT,GUID,BOOKSFROM", "", "")
}

// one company's GSTIN and PAN (the company's own master fields)
func coInfoRequest(name string) string {
	extra := `<FILTERS>TDSDeskThisCo</FILTERS></COLLECTION><SYSTEM TYPE="Formulae" NAME="TDSDeskThisCo">$Name = "` + esc(strings.ReplaceAll(name, `"`, "")) + `"</SYSTEM><COLLECTION NAME="TDSDeskUnused" ISMODIFY="No"><TYPE>Company</TYPE>`
	return collectionRequest("TDSDeskCompanyInfo", "Company", "NAME,GSTREGISTRATIONNUMBER,INCOMETAXNUMBER,GSTREGISTRATIONDETAILS.LIST,GUID", name, extra)
}

// 2.3.0: the Tally this bridge works with, for the heartbeat: the port of the first of the owner's Tallys that answered
// (from the sessions the beat is made of), and the data folder its tally.ini names (when Windows says which program it is)
func myTallyFor(ports []any) (int, string) {
	port := 0
	for _, x := range ports {
		if o := obj(x); o != nil && o["ok"] == true && o["skipped"] != true {
			port = toInt(o["port"])
			break
		}
	}
	myTallyMu.Lock()
	defer myTallyMu.Unlock()
	if !isFake() && myTallyPort == port && port != 0 && time.Since(myTallyAt) < 5*time.Minute {
		return port, myTallyData // Windows' process list is read at most every 5 minutes for this
	}
	data := ""
	ok, procs, lis := netState()
	if ok {
		byID := map[int]proc{}
		for _, p := range procs {
			if reTally.MatchString(p.Name) && isMine(p.Session) {
				byID[p.ID] = p
			}
		}
		for _, l := range lis {
			if p, hit := byID[l.Pid]; hit && (port == 0 || l.Port == port) {
				if port == 0 {
					port = l.Port
				}
				data = str(tallyIni(p.Path)["data"])
				break
			}
		}
	}
	myTallyAt, myTallyPort, myTallyData = time.Now(), port, data
	return port, data
}

var (
	myTallyMu   sync.Mutex
	myTallyAt   time.Time
	myTallyPort int
	myTallyData string
)
