// FinCom Bridge 2.5.11: why this login's TallyPrime is open but takes no connection, told plainly and with its details
// (the owner's shared server, 09-Nov-2026: this login's TallyPrime ran with a company open and listened on no port.
// The day before it listened on 9039, typed in F1 > Settings > Connectivity but never saved in any tally.ini; 2.5.10
// said "set but not on yet. Close and reopen Tally once", and reopening loads the same tally.ini again).
//
//  1. The details go in the beat (tallyOff): the folder name of the running tally.exe (never the whole path), which
//     tally.ini it reads (the Program Files folder's name, or this login's own VirtualStore copy), the mode and port in
//     it ("TallyPrime acts as" Both / Server / Client / None), whether that file changed after the Tally started, and
//     whether another program holds its port (another Windows user's Tally, or another program).
//  2. The words, in this order (the independent review, 09-Nov-2026): the mode (acts as Client / None); its port held
//     (another login's Tally: this login's own port instead; a Tally whose owner Windows did not give: "another program
//     or a Tally run as administrator"; another program); "set but not on yet: close and reopen" only when tally.ini
//     changed after this Tally started (and says Both / Server, its port free); the port it used before and did not
//     save (3), compared with the port it should take now; nothing listening on its port. F1 > Settings > Ctrl+A only on
//     a computer one person uses with a tally.ini this login may write (or its own VirtualStore copy); else the
//     administrator's words with this login's own port.
//  3. The last port this login's own Tally answered on is remembered (sync\tally-last-port.json, the port and when);
//     when that port is gone and tally.ini names another one (not saved since), the words say so.
//  4. %LOCALAPPDATA%\VirtualStore\Program Files\TallyPrime*\tally.ini (Windows' per-user copy of a file a program
//     without administrator rights saved under Program Files) is read too, READ ONLY, so a port saved there is tried.
//     It is taken as the file this login's Tally reads only for a 32-bit (WOW64) Tally not run elevated (Windows
//     redirects no other); not known: the Program Files file, and the beat says so (iniUnsure). As a service, the
//     owning user's own profile's VirtualStore, else none.
//  5. The port the tally.ini of this login's running Tally names is in the plan even while nothing listens on it, so
//     a Tally that starts listening there is found at once (a closed port is never sent anything: ports.go byPort).
//
// No new request to Tally; no tally.ini is written by any of it (another user's never).
package main

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

const (
	offReopen  = "reopen"  // tally.ini changed after this Tally started: a restart takes it
	offLost    = "lost"    // the port this Tally used before was never saved
	offMode    = "mode"    // TallyPrime acts as Client / None (or no tally.ini)
	offClash   = "clash"   // its port is another Windows user's Tally's
	offProgram = "program" // its port is another program's
	offClosed  = "closed"  // acts as Both, nothing listens on its port
)

// the words (300 letters at most each: FinCom keeps 300). The F1 > Settings > Ctrl+A words only for a computer one
// person uses whose tally.ini this login may write (or this login's own VirtualStore copy): on a shared computer the
// change would be every login's, and an unwritable file silently keeps nothing (review 2): the administrator's words
const (
	offWordsReopen  = "Your TallyPrime's connection is set but not on yet: close and reopen TallyPrime once."
	offWordsMode    = "Your TallyPrime is open but its connection is off: in TallyPrime press F1 → Settings → Connectivity, set 'TallyPrime acts as' to Both, keep the port, press Ctrl+A to save, then reopen TallyPrime."
	offWordsClash   = "Your TallyPrime's port %d is used by %s: %s in F1 → Settings → Connectivity, press Ctrl+A to save, then reopen TallyPrime."
	offWordsClosed  = "Your TallyPrime is open but not taking connections on port %d: in F1 → Settings → Connectivity check 'TallyPrime acts as' is Both and the port is %d, press Ctrl+A to save, reopen TallyPrime."
	offWordsLost    = "%s your Tally used port %d but TallyPrime did not save it. Set it again in F1 → Settings → Connectivity and press Ctrl+A to save."
	offWhoOtherUser = "another Windows user's Tally"
	offWhoUnknown   = "another program or a Tally run as administrator" // review 6: a Tally whose owner Windows did not give

	// the administrator's words: what is wrong, why the person cannot change it, then the ask (with this login's port)
	offAdminMode   = "Your TallyPrime is open but its connection is off"
	offAdminClash  = "Your TallyPrime's port %d is used by %s"
	offAdminClosed = "Your TallyPrime is open but not taking connections on port %d"
	offAdminLost   = "%s your Tally used port %d but TallyPrime did not save it"
	offWhyShared   = "; every Windows login here shares TallyPrime's settings"
	offWhyNoWrite  = "; this Windows login may not save TallyPrime's settings"
	offAdminAsk    = ": ask the computer's administrator to give each login its own TallyPrime folder and port"
)

// the administrator's words' end: this login's own port when known (review 7: never a sentence without it)
func offAsk(own int) string {
	if own > 0 {
		return offAdminAsk + fmt.Sprintf(" (yours: %d).", own)
	}
	return offAdminAsk + "."
}

// hooks for the tests: this login's Windows user (its own port), the Program Files folders, the VirtualStore folder
var (
	offUserFn         = ownerName
	programFilesFn    = func() []string { return []string{os.Getenv("ProgramFiles"), os.Getenv("ProgramFiles(x86)")} }
	virtualStoreDirFn = func() string {
		// (review 5: as a service, the owning user's own profile, else none)
		if l := vsLocalAppData(); l != "" {
			return filepath.Join(l, "VirtualStore")
		}
		return ""
	}
)

func winPath(p string) string {
	return filepath.Clean(strings.ReplaceAll(p, `\`, string(filepath.Separator)))
}

// the VirtualStore copy of a file under a Program Files folder ("" when the file is not under one): Windows keeps it
// at %LOCALAPPDATA%\VirtualStore\<Program Files folder's name>\<the rest>
func virtualStoreOf(path string) string {
	vs := virtualStoreDirFn()
	if vs == "" {
		return ""
	}
	if b, rest := underProgramFiles(path); b != "" {
		return filepath.Join(vs, filepath.Base(b), rest)
	}
	return ""
}

// the Program Files folder a file is under and the rest of its path ("" when it is under none)
func underProgramFiles(path string) (string, string) {
	if path == "" {
		return "", ""
	}
	p := winPath(path)
	for _, base := range programFilesFn() {
		if base == "" {
			continue
		}
		b := strings.TrimRight(winPath(base), string(filepath.Separator))
		// (Windows: the case of the folder's name may differ)
		if len(p) > len(b)+1 && strings.EqualFold(p[:len(b)+1], b+string(filepath.Separator)) {
			return b, p[len(b)+1:]
		}
	}
	return "", ""
}

// every TallyPrime* folder's tally.ini in this login's VirtualStore (read only)
func virtualStoreInis() []string {
	vs := virtualStoreDirFn()
	if vs == "" {
		return nil
	}
	var out []string
	for _, base := range programFilesFn() {
		if base == "" {
			continue
		}
		ms, _ := filepath.Glob(filepath.Join(vs, filepath.Base(winPath(base)), "TallyPrime*", "tally.ini"))
		out = append(out, ms...)
	}
	return out
}

func iniModAt(path string) time.Time {
	if fi, err := os.Stat(path); err == nil && fi.Mode().IsRegular() {
		return fi.ModTime()
	}
	return time.Time{}
}

// whether Windows redirects a program's tally.ini to the user's VirtualStore (review 4): only a 32-bit (WOW64) program
// not run elevated; a 64-bit or an elevated one never; triUnknown when Windows did not say either
func vsRule(p proc) int {
	switch {
	case p.Wow64 == triNo || p.Elevated == triYes:
		return triNo
	case p.Wow64 == triYes && p.Elevated == triNo:
		return triYes
	}
	return triUnknown
}

// the tally.ini this login's Tally (tally.exe at exe) reads: the file next to it, or this login's VirtualStore copy of
// it only when Windows redirects that program's files (vs triYes: a 32-bit Tally not run elevated; never chosen by the
// files' dates). Not known (triUnknown) and a copy there: the Program Files file, and vsUnsure says so. tallyIni's
// fields, and kind ("programFiles" / "virtualStore" / "exeFolder" / "none"), iniFolder (the folder's name only), modAt,
// and the port of the other copy (otherPort) when both are there
func ownIniOf(exe string, vs int) M {
	main := tallyIni(exe)
	main["kind"], main["iniFolder"] = "none", ""
	var at time.Time
	if main["found"] == true {
		at = iniModAt(str(main["path"]))
		main["kind"] = "exeFolder"
		if b, _ := underProgramFiles(str(main["path"])); b != "" {
			main["kind"] = "programFiles"
		}
		main["iniFolder"] = filepath.Base(filepath.Dir(winPath(str(main["path"]))))
	}
	main["modAt"] = at
	if exe == "" {
		return main
	}
	vsIni := virtualStoreOf(filepath.Join(filepath.Dir(winPath(exe)), "tally.ini"))
	if vsIni == "" || !exists(vsIni) {
		return main
	}
	vat := iniModAt(vsIni)
	v := tallyIni(filepath.Join(filepath.Dir(vsIni), "tally.exe"))
	if v["found"] != true || vs != triYes {
		if v["found"] == true {
			main["otherPort"] = v["port"]
			if vs == triUnknown {
				main["vsUnsure"] = true
			}
		}
		return main
	}
	v["kind"], v["iniFolder"], v["modAt"] = "virtualStore", filepath.Base(filepath.Dir(vsIni)), vat
	if main["found"] == true {
		v["otherPort"] = main["port"]
	}
	return v
}

// the ports named by the tally.ini files of this login's running Tallys (the file next to tally.exe and its
// VirtualStore copy), and every VirtualStore TallyPrime*\tally.ini of this login; kept 30 s
var ownIniSt struct {
	mu sync.Mutex
	at time.Time
	l  []int
}

func ownTallyIniPorts() []int {
	ownIniSt.mu.Lock()
	defer ownIniSt.mu.Unlock()
	if !ownIniSt.at.IsZero() && time.Since(ownIniSt.at) < 30*time.Second {
		return append([]int{}, ownIniSt.l...)
	}
	var out []int
	addP := func(p int) {
		if p > 0 && p < 65536 && !containsInt(out, p) {
			out = append(out, p)
		}
	}
	if ok, procs, _ := netState(); ok {
		for _, p := range procs {
			if !reTally.MatchString(p.Name) || sessionOwner(p) != "mine" || p.Path == "" {
				continue
			}
			i := ownIniOf(p.Path, vsRule(p))
			addP(toInt(i["port"]))
			addP(toInt(i["otherPort"]))
		}
	}
	for _, f := range virtualStoreInis() {
		addP(toInt(tallyIni(filepath.Join(filepath.Dir(f), "tally.exe"))["port"]))
	}
	ownIniSt.at, ownIniSt.l = time.Now(), out
	return append([]int{}, out...)
}

func resetOwnIniPorts() {
	ownIniSt.mu.Lock()
	ownIniSt.at, ownIniSt.l = time.Time{}, nil
	ownIniSt.mu.Unlock()
}

// --- 3. the last port this login's own Tally answered on
var lastPortSt struct {
	mu     sync.Mutex
	loaded bool
	port   int
	at     time.Time
}

func lastPortFile() string { return sp("tally-last-port.json") }

func lastPortLoadLocked() {
	if lastPortSt.loaded {
		return
	}
	lastPortSt.loaded = true
	m := readObjFile(lastPortFile())
	if p := toInt(m["port"]); p > 0 && p < 65536 {
		if at, err := time.Parse(time.RFC3339, str(m["at"])); err == nil {
			lastPortSt.port, lastPortSt.at = p, at
		}
	}
}

// a port of this login's own Tally answered (the beat's ports): kept when it is another port, or an hour after the last
func noteTallyPort(ports []any) {
	p := 0
	for _, x := range ports {
		o := obj(x)
		if o != nil && o["ok"] == true && o["mine"] == true && o["skipped"] != true && toInt(o["port"]) > 0 {
			p = toInt(o["port"])
			break
		}
	}
	if p <= 0 || p > 65535 {
		return
	}
	lastPortSt.mu.Lock()
	defer lastPortSt.mu.Unlock()
	lastPortLoadLocked()
	now := nowFn()
	if p == lastPortSt.port && now.Sub(lastPortSt.at) < time.Hour {
		return
	}
	lastPortSt.port, lastPortSt.at = p, now
	_ = saveFile(lastPortFile(), jsonText(M{"port": p, "at": now.Format(time.RFC3339)}))
}

// the last port this login's own Tally answered on, and when (0 when none is known)
func lastTallyPort() (int, time.Time) {
	lastPortSt.mu.Lock()
	defer lastPortSt.mu.Unlock()
	lastPortLoadLocked()
	return lastPortSt.port, lastPortSt.at
}

func resetLastPort() {
	lastPortSt.mu.Lock()
	lastPortSt.loaded, lastPortSt.port, lastPortSt.at = false, 0, time.Time{}
	lastPortSt.mu.Unlock()
}

// "Yesterday" / "Earlier today" / "On 07-Nov"
func sinceDayWords(at time.Time) string {
	now := nowFn().Local()
	a := at.Local()
	y1, m1, d1 := now.Date()
	y0, m0, d0 := a.Date()
	today := time.Date(y1, m1, d1, 0, 0, 0, 0, time.Local)
	day := time.Date(y0, m0, d0, 0, 0, 0, 0, time.Local)
	switch n := int(today.Sub(day).Hours()/24 + 0.5); {
	case n <= 0:
		return "Earlier today"
	case n == 1:
		return "Yesterday"
	}
	return "On " + a.Format("02-Jan")
}

func modeName(m string) string {
	switch strings.ToLower(strings.TrimSpace(m)) {
	case "both":
		return "Both"
	case "server":
		return "Server"
	case "client":
		return "Client"
	case "none":
		return "None"
	}
	return ""
}

func rfc(t time.Time) string {
	if t.IsZero() {
		return ""
	}
	return t.UTC().Format(time.RFC3339)
}

// a short name for a person's Windows user (the part after DOMAIN\, 40 letters at most)
func offShortUser(u string) string {
	u = loginShort(u)
	if r := []rune(u); len(r) > 40 {
		u = string(r[:40])
	}
	return u
}

// 1 and 2: this login's Tally p takes no connection: its details for the beat (tallyOff) and the person's words. procs and
// lis: Windows' lists of programs and listeners
func tallyOffOf(p proc, procs []proc, lis []listener) (M, string) {
	ini := ownIniOf(p.Path, vsRule(p))
	mode := modeName(str(ini["mode"]))
	iniPort := toInt(ini["port"])
	want := iniPort
	if want <= 0 {
		want = tallyDefaultPort
	}
	iniAt, _ := ini["modAt"].(time.Time)
	after := !p.Started.IsZero() && !iniAt.IsZero() && iniAt.After(p.Started)
	folder := ""
	if p.Path != "" {
		folder = filepath.Base(filepath.Dir(winPath(p.Path)))
	}
	d := M{"folder": folder, "iniKind": str(ini["kind"]), "iniFolder": str(ini["iniFolder"]), "mode": mode, "port": iniPort, "want": want,
		"iniAt": rfc(iniAt), "startedAt": rfc(p.Started), "iniAfterStart": after, "heldBy": ""}
	if ini["vsUnsure"] == true {
		d["iniUnsure"] = true // a VirtualStore copy is there, but Windows did not say whether this Tally reads it
	}
	// review 2: whose settings these are. This login's own VirtualStore copy is its own; else the computer shared by
	// several people, or a file this login may not write (Ctrl+A in F1 would keep nothing)
	kind := str(ini["kind"])
	if kind != "virtualStore" {
		if iniSharedFn() {
			d["shared"] = true
		} else if ini["found"] == true && isNoWrite(iniWritableFn(str(ini["path"]))) {
			d["unwritable"] = true
		}
	}
	admin := d["shared"] == true || d["unwritable"] == true
	// whose program holds the port
	byID := map[int]proc{}
	for _, q := range procs {
		byID[q.ID] = q
	}
	used := map[int]bool{}
	holder := 0
	for _, l := range lis {
		used[l.Port] = true
		if l.Port == want && l.Pid != p.ID && holder == 0 {
			holder = l.Pid
		}
	}
	who := ""
	if holder != 0 {
		q, has := byID[holder]
		switch {
		case has && reTally.MatchString(q.Name) && sessionOwner(q) == "other":
			d["heldBy"], who = "otherUser", offWhoOtherUser
			if u := offShortUser(sessionUsers()[q.Session]); u != "" {
				d["heldUser"], who = u, u+"'s Tally"
			}
		case has && reTally.MatchString(q.Name):
			d["heldBy"], who = "tally", offWhoUnknown
		default:
			d["heldBy"] = "program"
		}
	}
	last, lastAt := lastTallyPort()
	if last > 0 {
		d["lastPort"], d["lastAt"] = last, rfc(lastAt)
	}
	// this login's own port (the page's), every port listening now put aside
	own := loginOwnPortFree(offUserFn(), func(n int) bool { return used[n] })
	if own > 0 {
		d["ownPort"] = own
	}
	why := offWhyShared
	if d["shared"] != true {
		why = offWhyNoWrite
	}
	// review 1 and 3: the mode first, then a held port; "close and reopen" only for a tally.ini changed after this Tally
	// started that says Both / Server with its port free; the port used before is the one it should take now (want)
	reason, words := "", ""
	switch {
	case mode != "Both" && mode != "Server":
		reason, words = offMode, offWordsMode
		if admin {
			words = offAdminMode + why + offAsk(own)
		}
	case d["heldBy"] == "otherUser" || d["heldBy"] == "tally":
		reason = offClash
		switch {
		case admin:
			words = fmt.Sprintf(offAdminClash, want, who) + why + offAsk(own)
		case own > 0:
			words = fmt.Sprintf(offWordsClash, want, who, fmt.Sprintf("set your own port %d", own))
		default:
			words = fmt.Sprintf(offWordsClash, want, who, "set a port of your own")
		}
	case d["heldBy"] == "program":
		reason, words = offProgram, fmt.Sprintf(connOffWordsPort, want)
	case after:
		reason, words = offReopen, offWordsReopen
	case last > 0 && last != want && !used[last] && (iniAt.IsZero() || iniAt.Before(lastAt)):
		reason, words = offLost, fmt.Sprintf(offWordsLost, sinceDayWords(lastAt), last)
		if admin {
			words = fmt.Sprintf(offAdminLost, sinceDayWords(lastAt), last) + why + offAsk(own)
		}
	default:
		reason, words = offClosed, fmt.Sprintf(offWordsClosed, want, want)
		if admin {
			words = fmt.Sprintf(offAdminClosed, want) + why + offAsk(own)
		}
	}
	d["reason"] = reason
	return d, words
}

// the beat's tallyOff: the details of the last "connection off" found, while tallyWhy says so (nil otherwise)
func tallyOffBeat(why string) any {
	if why != whyConnOff {
		return nil
	}
	if d := connOffDetail(); d != nil {
		return d
	}
	return nil
}

// /diagnose's tally.ini of a Tally: this login's own reads its VirtualStore copy too (2.5.11); the modAt time left out
func diagIni(p proc) M {
	if sessionOwner(p) != "mine" {
		return tallyIni(p.Path)
	}
	i := ownIniOf(p.Path, vsRule(p))
	delete(i, "modAt")
	return i
}

// review 8: /diagnose's finding for a Tally of this login that takes no connection, naming the one port its words name
func diagOffText(d M) string {
	want := toInt(d["want"])
	switch str(d["reason"]) {
	case offMode:
		m := str(d["mode"])
		if m == "" {
			m = "not set"
		}
		return fmt.Sprintf("Your TallyPrime is not set to accept connections (\"TallyPrime acts as\" is %s), so it takes none on port %d.", m, want)
	case offClash:
		who := offWhoUnknown
		if d["heldBy"] == "otherUser" {
			who = offWhoOtherUser
			if u := str(d["heldUser"]); u != "" {
				who = u + "'s Tally"
			}
		}
		return fmt.Sprintf("Your TallyPrime is running but cannot accept connections: port %d is already taken by %s.", want, who)
	case offProgram:
		return fmt.Sprintf("Your TallyPrime is running but cannot accept connections: port %d is taken by another program.", want)
	case offLost:
		return fmt.Sprintf("Your TallyPrime is running but is not accepting connections: it used port %d before, and that port was never saved.", toInt(d["lastPort"]))
	}
	return fmt.Sprintf("Your TallyPrime is running but is not accepting connections on port %d yet.", want)
}
