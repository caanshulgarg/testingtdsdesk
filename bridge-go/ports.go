// Which Tally is yours: on a shared server every signed-in user may run TallyPrime, each on its own port (9000, 9001,
// 9002...). The bridge uses only the Tally running in its owner's Windows session, and never reads or writes another
// user's (OnlyMySession). As the PowerShell bridge: Get-TallyListeners, Get-PortPlan, Get-OpenCompanies, Find-CompanyPort.
package main

import (
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
			ps = append(ps, proc{ID: toInt(o["pid"]), Name: str(o["name"]), Session: toInt(o["session"]), Path: str(o["path"])})
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

var reTally = regexp.MustCompile(`(?i)^tally`)

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
		out = append(out, M{"port": c.Port, "pid": c.Pid, "session": p.Session, "mine": isMine(p.Session), "program": p.Name, "user": users[p.Session]})
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
	return info
}

// a plain-language check: is your Tally reachable, and if not, why (Get-Diagnosis)
func diagnosis() M {
	ok, procs, lis := netState()
	users := sessionUsers()
	me := users[mySession()]
	findings := []M{}
	add := func(level, text, fix string) { findings = append(findings, M{"level": level, "text": text, "fix": fix}) }
	tallies := []M{}
	listeners := []M{}
	owner := map[int]M{}
	if ok {
		byID := map[int]proc{}
		for _, p := range procs {
			byID[p.ID] = p
		}
		for _, c := range lis {
			if c.Port < 9000 || c.Port > 9999 || owner[c.Port] != nil {
				continue
			}
			p, has := byID[c.Pid]
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
			tallies = append(tallies, M{"pid": p.ID, "program": p.Name, "session": p.Session, "user": users[p.Session], "mine": isMine(p.Session), "ports": ports, "ini": tallyIni(p.Path)})
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

// the ports to try: from the settings, else your own Tally's (auto), else the usual ones (fallback)
func portPlan() (string, []M) {
	tp := cfg("TallyPorts")
	if _, isStr := tp.(string); tp != nil && !isStr {
		var l []M
		for _, p := range arr(tp) {
			l = append(l, M{"port": toInt(p), "pid": nil, "session": nil, "mine": nil, "program": ""})
		}
		return "config", l
	}
	found := tallyListeners()
	if found == nil {
		var l []M
		for _, p := range arr(cfg("FallbackPorts")) {
			l = append(l, M{"port": toInt(p), "pid": nil, "session": nil, "mine": nil, "program": ""})
		}
		return "fallback", l
	}
	return "auto", found
}

// --- which companies are open: shared through a file and kept 30 s, so status checks cost Tally nothing
var (
	coMu        sync.Mutex
	coCache     []M
	coCacheAt   time.Time
	planMode    string
	coInfo      M
	emptyAskAt  time.Time
)

func coInfoFile() string { return filepath.Join(syncDir(), "company-info.json") }

// a company's GSTIN and PAN: asked once, when it is first seen, and remembered
func getCoInfo(name string, port int) M {
	if coInfo == nil {
		coInfo = readObjFile(coInfoFile())
		if coInfo == nil {
			coInfo = M{}
		}
	}
	if x := obj(coInfo[name]); x != nil {
		at, _ := parseTime(str(x["at"]))
		if str(x["gstin"]) != "" || str(x["pan"]) != "" || time.Since(at) < 6*time.Hour {
			return x
		}
	}
	g, pan := "", ""
	extra := `<FILTERS>TDSDeskThisCo</FILTERS></COLLECTION><SYSTEM TYPE="Formulae" NAME="TDSDeskThisCo">$Name = "` + esc(strings.ReplaceAll(name, `"`, "")) + `"</SYSTEM><COLLECTION NAME="TDSDeskUnused" ISMODIFY="No"><TYPE>Company</TYPE>`
	if raw, err := invokeTally(fin, port, collectionRequest("TDSDeskCompanyInfo", "Company", "NAME,GSTREGISTRATIONNUMBER,INCOMETAXNUMBER,GSTREGISTRATIONDETAILS.LIST", "", extra), 15); err == nil {
		if c := xmlDoc(raw).All("COMPANY"); len(c) > 0 {
			g = nt(c[0], "GSTREGISTRATIONNUMBER")
			if g == "" {
				g = nt(c[0], "GSTREGISTRATIONDETAILS.LIST/GSTIN")
			}
			pan = nt(c[0], "INCOMETAXNUMBER")
		}
	}
	x := M{"gstin": g, "pan": pan, "at": nowS()}
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

// Get-OpenCompanies: asks each of your Tallys which companies are open (fresh: always asks)
func openCompanies(fresh bool) []M {
	cacheSec := toInt(cfg("StatusCacheSec"))
	if cacheSec < 30 {
		cacheSec = 30
	}
	coMu.Lock()
	if !fresh && coCache != nil && time.Since(coCacheAt).Seconds() < float64(cacheSec) {
		c := copySessions(coCache)
		coMu.Unlock()
		return c
	}
	coMu.Unlock()
	shared := filepath.Join(syncDir(), "open-companies.json")
	if !fresh {
		if t, ok := mtime(shared); ok && time.Since(t).Seconds() < float64(cacheSec) {
			if l := sessionsFromFile(shared); l != nil {
				coMu.Lock()
				coCache, coCacheAt = l, t
				coMu.Unlock()
				return copySessions(l)
			}
		}
	}
	mode, plan := portPlan()
	sessions := []M{}
	for _, pp := range plan {
		e := M{"port": toInt(pp["port"]), "ok": false, "companies": []any{}, "error": "", "mine": pp["mine"], "session": pp["session"], "program": pp["program"], "user": pp["user"], "skipped": false}
		if cfgB("OnlyMySession") && pp["mine"] == false {
			e["skipped"] = true
			who := str(pp["user"])
			if who == "" {
				who = fmt.Sprint("Windows session ", pp["session"])
			}
			e["error"] = "Tally of " + who
			sessions = append(sessions, e)
			continue
		}
		raw, err := invokeTally(fin, toInt(pp["port"]), collectionRequest("TDSDeskCompanies", "Company", "NAME,STARTINGFROM,ENDINGAT,GUID", "", ""), 8)
		if err != nil {
			e["error"] = err.Error()
		} else {
			list := []any{}
			for _, c := range xmlDoc(raw).All("COMPANY") {
				name := nameOf(c)
				if name == "" {
					continue
				}
				inf := getCoInfo(name, toInt(pp["port"]))
				list = append(list, M{"name": name, "from": nt(c, "STARTINGFROM"), "to": nt(c, "ENDINGAT"), "guid": nt(c, "GUID"), "gstin": str(inf["gstin"]), "pan": str(inf["pan"])})
			}
			e["ok"] = true
			e["companies"] = list
		}
		sessions = append(sessions, e)
	}
	coMu.Lock()
	planMode = mode
	coCache, coCacheAt = sessions, time.Now()
	coMu.Unlock()
	_ = saveFile(shared, jsonText(sessions))
	return copySessions(sessions)
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

// a connection opened and closed; Tally is asked nothing
func tallyPortOpen(port int) bool {
	host := cfgS("TallyHost")
	if host == "" {
		host = "127.0.0.1"
	}
	c, err := net.DialTimeout("tcp", fmt.Sprintf("%s:%d", host, port), 500*time.Millisecond)
	if err != nil {
		return false
	}
	c.Close()
	return true
}

// Get-OpenCompaniesCached (1.14.0): status checks never ask Tally; they get the companies Tally named the last time it
// was asked, and whether Tally's port takes connections
func openCompaniesCached() []M {
	shared := filepath.Join(syncDir(), "open-companies.json")
	list := sessionsFromFile(shared)
	stale, newPort := false, false
	if list != nil {
		for _, e := range list {
			if e["skipped"] == true {
				continue
			}
			open := tallyPortOpen(toInt(e["port"]))
			if open && (e["ok"] != true || len(sessCompanies(e)) == 0) {
				stale = true // Tally opened since it was last asked
			}
			e["ok"] = open
			if !open {
				e["companies"] = []any{}
			}
		}
		// Tally reopened on another port of this session
		_, plan := portPlan()
		for _, pp := range plan {
			if cfgB("OnlyMySession") && pp["mine"] == false {
				continue
			}
			in := false
			for _, e := range list {
				if toInt(e["port"]) == toInt(pp["port"]) {
					in = true
				}
			}
			if !in && tallyPortOpen(toInt(pp["port"])) {
				stale, newPort = true, true
			}
		}
	}
	coMu.Lock()
	ask := (list == nil || stale) && time.Since(emptyAskAt).Minutes() >= 10
	coMu.Unlock()
	if ask && (newPort || list == nil || !keepUserInTally()) {
		coMu.Lock()
		emptyAskAt = time.Now()
		coMu.Unlock()
		return openCompanies(false)
	}
	if list == nil {
		return []M{}
	}
	return list
}

// the Tally to use for a company: a port chosen in FinCom wins; otherwise the company must be open in exactly one Tally
// (your own session first) - the bridge never guesses between two
func findCompanyPort(company string, preferred int) (int, error) {
	for _, fresh := range []bool{false, true} {
		sessions := openCompanies(fresh)
		var usable []M
		for _, s := range sessions {
			if s["skipped"] != true && s["ok"] == true {
				usable = append(usable, s)
			}
		}
		has := func(s M) bool {
			for _, c := range sessCompanies(s) {
				if str(c["name"]) == company {
					return true
				}
			}
			return false
		}
		if preferred > 0 {
			var s M
			for _, u := range usable {
				if toInt(u["port"]) == preferred {
					s = u
					break
				}
			}
			if s != nil && has(s) {
				return preferred, nil
			}
			if fresh {
				if s == nil {
					return 0, fmt.Errorf("The Tally chosen in FinCom (port %d) is not running in your Windows session. Start it, or choose another Tally in FinCom > Settings > Tally Bridge.", preferred)
				}
				return 0, fmt.Errorf("Company '%s' is not open in the Tally chosen in FinCom (port %d). Open it there.", company, preferred)
			}
			continue
		}
		var with []M
		for _, u := range usable {
			if has(u) {
				with = append(with, u)
			}
		}
		if len(with) == 1 {
			return toInt(with[0]["port"]), nil
		}
		if len(with) > 1 {
			var mine []M
			for _, w := range with {
				if w["mine"] == true {
					mine = append(mine, w)
				}
			}
			if len(mine) == 1 {
				return toInt(mine[0]["port"]), nil
			}
			if fresh {
				var p []string
				for _, w := range with {
					p = append(p, fmt.Sprint(w["port"]))
				}
				return 0, fmt.Errorf("Company '%s' is open in more than one Tally (ports %s). Choose your Tally in FinCom > Settings > Tally Bridge.", company, strings.Join(p, ", "))
			}
		}
	}
	return 0, fmt.Errorf("Company '%s' is not open in Tally. Open it in TallyPrime on this computer and try again.", company)
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
