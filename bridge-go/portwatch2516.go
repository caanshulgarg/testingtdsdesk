package main

// FinCom Bridge 2.5.16 (the port study of 13-Nov-2026, items 2 and 4; no owner decision needed). Nothing is sent to
// Tally and no tally.ini is written: only Windows' own lists of programs and listening ports, and the tally.ini files
// the bridge already reads.
//   - Windows' list of listening ports is looked at about every 3 s (portWatchLoop); when this login's own Tally port
//     appears, goes or moves, the beat goes at once (at most one such beat every 10 s), so FinCom's page sees it in
//     seconds instead of at the next beat (30 s).
//   - "Tally port not saved" (tallyPortNotSaved in the beat): this login's Tally listens on a port its own tally.ini does
//     not name (typed in F1 > Settings > Connectivity but not kept): it works until Tally restarts. Said with the fix.

import (
	"fmt"
	"sort"
	"sync"
	"time"
)

var portWatch = struct {
	mu      sync.Mutex
	last    string
	seen    bool
	beatAt  time.Time
	pending bool
}{}

// this login's own Tally ports, as Windows lists them now (sorted); nil when Windows cannot tell
func ownTallyPorts() []int {
	l := tallyListeners()
	if l == nil {
		return nil
	}
	out := []int{}
	for _, x := range l {
		if x["mine"] == true {
			out = append(out, toInt(x["port"]))
		}
	}
	sort.Ints(out)
	return out
}

func portWatchReset() {
	portWatch.mu.Lock()
	portWatch.last, portWatch.seen, portWatch.beatAt, portWatch.pending = "", false, time.Time{}, false
	portWatch.mu.Unlock()
}

// one look: true when it asked for a beat now
func portWatchTick() bool {
	keyNote() // (the last key seen in Tally, for the beat's lastKeyAt)
	ps := ownTallyPorts()
	if ps == nil {
		return false
	}
	sig := fmt.Sprint(ps)
	portWatch.mu.Lock()
	was := portWatch.last
	changed := portWatch.seen && sig != was
	portWatch.last, portWatch.seen = sig, true
	if changed {
		portWatch.pending = true
	}
	due := portWatch.pending && (time.Since(portWatch.beatAt) >= 10*time.Second || time.Since(portWatch.beatAt) < 0)
	if due {
		portWatch.beatAt, portWatch.pending = time.Now(), false
	}
	portWatch.mu.Unlock()
	if changed {
		writeLog("Tally's port on this login: " + or(was, "none") + " -> " + sig + " (Windows' list; nothing asked of Tally); FinCom is told at once")
	}
	if due {
		beatSoon()
	}
	return due
}

func portWatchLoop() {
	for !stopping() {
		func() {
			defer func() {
				if r := recover(); r != nil {
					writeLog(fmt.Sprint("Tally's port watch: ", r))
				}
			}()
			portWatchTick()
		}()
		sleepOrStop(3 * time.Second)
	}
}

// for the beat: {port, iniPort, words} when this login's Tally listens on a port its own tally.ini does not name; nil
// otherwise (or when Windows cannot tell)
func portNotSavedBeat() any {
	ok, procs, lis := netState()
	if !ok {
		return nil
	}
	for _, p := range procs {
		if !reTally.MatchString(p.Name) || sessionOwner(p) != "mine" || p.Path == "" {
			continue
		}
		for _, l := range lis {
			if l.Pid != p.ID || l.Port <= 0 {
				continue
			}
			ini := ownIniOf(p.Path, vsRule(p))
			named, other := toInt(ini["port"]), toInt(ini["otherPort"])
			if l.Port == named || l.Port == other {
				continue
			}
			was := "names no port"
			if named > 0 {
				was = fmt.Sprintf("names port %d", named)
			}
			if ini["found"] != true {
				was = "was not found"
			}
			return M{"port": l.Port, "iniPort": named,
				"words": fmt.Sprintf("Tally port not saved: Tally listens on port %d now, but its tally.ini %s, so the port is lost when Tally restarts. To keep it: in Tally press F1 > Settings > Connectivity, set the port to %d and save (Ctrl+A). On a shared server, ask the administrator to give your login its own TallyPrime settings.", l.Port, was, l.Port)}
		}
	}
	return nil
}
