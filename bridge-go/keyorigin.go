// FinCom Bridge 2.5.16: the bridge key, FinCom's sites by build, and the log of refused requests.
//
//   - The bridge keys: one per paired browser (browserkeys.go).
//   - FinCom's own sites by build (build.sh sets buildSite from FINCOM): the live build trusts and opens the live site
//     only; the staging build (and a build by hand) the staging site too. No other site, and the settings' AllowedOrigins
//     never add one (they name development pages only, with DevOrigins, never in the live build).
//   - A request refused for its web page, its Windows user or a tray address is logged at most once in ten minutes for
//     the same page and kind (with how many were not logged), and the refusal lines of one day stop at refusedLogCap.
package main

import (
	"fmt"
	"strings"
	"sync"
	"time"
)

// set at build time: -X main.buildSite=production (the live site) or staging
var buildSite = ""

// FinCom's own sites this build trusts (pairopen.go fincomSites, without the staging site in the live build)
func trustedSites() []string {
	var out []string
	for _, s := range fincomSites {
		if buildSite == "production" && s == "https://staging.fincom.live" {
			continue
		}
		out = append(out, s)
	}
	return out
}

// POST /tray/newkey (2.5.16, kept): every browser disconnected (browserkeys.go)
func trayNewKeyRoute(method string) (M, error) {
	if method != "POST" {
		return nil, &httpErr{405, M{"ok": false, "error": "Use POST."}}
	}
	removeAllBrowserKeys("the owner's Disconnect FinCom in the tray icon")
	return M{"ok": true}, nil
}

// --- refused requests in the log
const refusedLogCap = 256 << 10 // the refusal lines of one day, in bytes

var refusedNow = time.Now

var refusedLog = struct {
	mu      sync.Mutex
	day     string
	bytes   int
	capped  bool
	seen    map[string]time.Time
	dropped map[string]int
}{seen: map[string]time.Time{}, dropped: map[string]int{}}

func refusedLogReset() {
	refusedLog.mu.Lock()
	refusedLog.day, refusedLog.bytes, refusedLog.capped = "", 0, false
	refusedLog.seen, refusedLog.dropped = map[string]time.Time{}, map[string]int{}
	refusedLog.mu.Unlock()
}

// line logged unless the same kind (key) was logged in the last ten minutes or the day's refusal lines are at the cap
func logRefused(key, line string) {
	now := refusedNow()
	day := now.Format("2006-01-02")
	key = cutRunes(key, 200)
	refusedLog.mu.Lock()
	if refusedLog.day != day {
		refusedLog.day, refusedLog.bytes, refusedLog.capped = day, 0, false
	}
	if t, ok := refusedLog.seen[key]; ok && now.Sub(t) < 10*time.Minute {
		refusedLog.dropped[key]++
		refusedLog.mu.Unlock()
		return
	}
	if len(refusedLog.seen) > 2000 {
		refusedLog.seen, refusedLog.dropped = map[string]time.Time{}, map[string]int{}
	}
	if n := refusedLog.dropped[key]; n > 0 {
		line += fmt.Sprintf(" (and %d more like it not logged)", n)
	}
	size := len(line) + 23 // with the log's time and line end
	if refusedLog.capped || refusedLog.bytes+size > refusedLogCap {
		said := refusedLog.capped
		refusedLog.capped = true
		refusedLog.mu.Unlock()
		if !said {
			writeLog("Many requests were refused today: further refusals are not logged until tomorrow")
		}
		return
	}
	refusedLog.seen[key] = now
	delete(refusedLog.dropped, key)
	refusedLog.bytes += size
	refusedLog.mu.Unlock()
	writeLog(line)
}

// a web page's address as the log names it (cut, one line)
func logOrigin(o string) string {
	return cutRunes(strings.Map(func(r rune) rune {
		if r < 0x20 || r == 0x7f {
			return ' '
		}
		return r
	}, o), 120)
}
