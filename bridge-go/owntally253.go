// FinCom Bridge 2.5.3: the user's OWN Tally is never ignored on a shared Windows server (the owner: "It should always
// show the user's computer linked... it must not fail any which way").
//
// The cause (NW144, 02-Nov-2026): (a) a TallyPrime whose Windows session the bridge could not read (run as
// administrator: ProcessIdToSessionId denied) was taken as session 0, and session 0 as another user's, so it was
// skipped as "Tally of Windows session 0"; (b) the heartbeat's list of ports was the list of the LAST company-list ask
// (open-companies.json), only re-asked after an event: a Tally opened later on another port (9070) never reached it,
// while the old port (1817) stayed in it, closed, so the beat said "closed" with nothing to make it ask again.
//
// The fix: a Tally is skipped only when Windows POSITIVELY places it in another signed-in user's session; one whose owner
// is unknown is asked the same light company list (TDSDeskCompanies: no new request) unless another FinCom Bridge on this
// computer already uses it (its /ping's tallyPorts); the plan always includes the settings' ports, every tally.ini's port
// and 9000 (ports.go portPlan); the beat's list follows Windows' list now (openCompaniesCached); each port says why
// (reason), and the beat says why for the whole (tallyWhy).
package main

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// the beat's words for a Tally whose owner Windows did not give
const ownerUnknownWords = "owner unknown (Tally may be running as administrator)"

// one entry of the company list for a port of the plan, before Tally is asked: skipped only when positively another
// user's (OnlyMySession)
func planEntry(pp M) M {
	e := M{"port": toInt(pp["port"]), "ok": false, "companies": []any{}, "error": "", "mine": pp["mine"], "session": pp["session"], "program": pp["program"], "user": pp["user"], "skipped": false}
	if pp["mine"] == nil {
		e["owner"] = "unknown"
	}
	if cfgB("OnlyMySession") && pp["mine"] == false {
		e["skipped"], e["reason"] = true, "another user"
		who := str(pp["user"])
		if who == "" {
			if pp["session"] != nil {
				who = fmt.Sprint("Windows session ", pp["session"])
			} else {
				who = "another Windows user"
			}
		}
		e["error"] = "Tally of " + who
	}
	return e
}

// why a port stands as it does: open, busy, closed (nothing listening), not answering, owner unknown, another user,
// another bridge, not Tally
func portReason(e M) string {
	switch {
	case e["skipped"] == true && str(e["reason"]) != "":
		return str(e["reason"])
	case e["notTally"] == true:
		return "not Tally"
	case str(e["tallyState"]) == "closed":
		return "closed"
	case e["busy"] == true:
		return "busy"
	case e["ok"] == true:
		return "open"
	case e["owner"] == "unknown":
		return "owner unknown"
	}
	return "not answering"
}

// the beat's tallyWhy: "" when one of the user's Tallys answers; else the most useful reason for the person: not
// answering, (2.5.4) connection off, owner unknown, another user, no Tally running in this login
func tallyWhy(ports []any) string {
	has := map[string]bool{}
	for _, x := range ports {
		o := obj(x)
		if o == nil {
			continue
		}
		r := str(o["reason"])
		if r == "open" || r == "busy" || (o["ok"] == true && o["skipped"] != true) {
			return ""
		}
		has[r] = true
	}
	if has["not answering"] || has["not Tally"] {
		return "not answering"
	}
	// 2.5.4 (owntally254.go): this login's Tally takes no connection: said above "owner unknown" and "another user"
	if off, words := connOffFn(ports); off {
		noteConnOff(words)
		return whyConnOff
	}
	switch {
	case has["owner unknown"] || has["another bridge"]:
		return "owner unknown"
	case has["another user"]:
		return "another user"
	}
	return "no Tally running in this login"
}

// --- the ports this bridge uses, told on /ping to the other users' bridges of this computer
func claimedPorts() (own, unknown []int) {
	coMu.Lock()
	c := coCache
	coMu.Unlock()
	for _, e := range c {
		if e["skipped"] == true {
			continue
		}
		switch {
		case e["mine"] == true:
			own = append(own, toInt(e["port"]))
		case e["mine"] == nil && e["ok"] == true:
			unknown = append(unknown, toInt(e["port"]))
		}
	}
	sort.Ints(own)
	sort.Ints(unknown)
	return own, unknown
}

// another bridge's claim on a Tally: its bridge port, and whether it too only found the Tally (owner unknown)
type bridgeClaim struct {
	port    int
	unknown bool
	user    string
	rule    string // 2.5.4 review S2: the other bridge's tie rule from its /ping ("user"; "" before 2.5.4: the bridge port)
}

const claimRuleUser = "user"

// the other bridge keeps the Tally: its own Tally always (its owner's session or Windows user, ports.go sessionOwner).
// 2.5.4: this is asked only for a Tally whose owner this bridge could not settle by the Tally's Windows user and session
// (portPlan's mine == nil: a Tally settled as this login's is never given away, one settled as another login's is never
// used). Of two bridges that both only found it, the tie is broken by something that stays the same for each login:
// the Windows user's name (the lower, case aside), and only when the two names are the same or not given, the lower
// bridge port (bridge ports are not stable per user: two users' bridges have held 9102 at different times)
func claimWins(c bridgeClaim, ownPort int, ownUser string) bool {
	if !c.unknown {
		return true
	}
	// review S2: a bridge before 2.5.4 breaks the tie by the bridge port only: so does this one with it, so the two
	// never both give the Tally up nor both take it
	a, b := shortUser(c.user), shortUser(ownUser)
	if c.rule == claimRuleUser && a != "" && b != "" && a != b {
		return a < b
	}
	return c.port < ownPort
}

// a Windows user's name without its domain, lower case
func shortUser(u string) string {
	if i := strings.LastIndex(u, `\`); i >= 0 {
		u = u[i+1:]
	}
	return strings.ToLower(strings.TrimSpace(u))
}

// Tally is on this computer (TallyHost empty, 127.0.0.1 or localhost): only then can another bridge here share it
func tallyHostLocal() bool {
	h := strings.ToLower(cfgS("TallyHost"))
	return h == "" || h == "127.0.0.1" || h == "localhost" || strings.HasPrefix(h, "127.")
}

// the user of another FinCom Bridge on this computer that keeps the Tally on this port, or "" (a hook for the tests)
var otherBridgeClaimFn = otherBridgeClaim

var (
	claimsMu sync.Mutex
	claimsAt time.Time
	claims   map[int]bridgeClaim
)

func otherBridgeClaim(port int) string {
	c, ok := bridgeClaims()[port]
	if !ok || !claimWins(c, toInt(cfg("Port")), ownerName()) {
		return ""
	}
	if c.user == "" {
		return fmt.Sprint("port ", c.port)
	}
	return c.user
}

// the other bridges of this computer (listening on 9100..9199, by Windows' listener table) asked /ping, each at most
// 400 ms; kept 20 s. Nothing is sent to Tally
func bridgeClaims() map[int]bridgeClaim {
	claimsMu.Lock()
	defer claimsMu.Unlock()
	if claims != nil && time.Since(claimsAt) < 20*time.Second {
		return claims
	}
	out := map[int]bridgeClaim{}
	ok, _, lis := netState()
	if ok {
		me := toInt(cfg("Port"))
		seen := map[int]bool{}
		cl := &http.Client{Timeout: 400 * time.Millisecond}
		for _, l := range lis {
			if l.Port < bridgePortFirst || l.Port > bridgePortLast || l.Port == me || seen[l.Port] {
				continue
			}
			seen[l.Port] = true
			r, err := cl.Get(fmt.Sprintf("http://127.0.0.1:%d/ping", l.Port))
			if err != nil {
				continue
			}
			b, _ := io.ReadAll(io.LimitReader(r.Body, 64*1024))
			r.Body.Close()
			var p struct {
				Bridge       string `json:"bridge"`
				Yours        bool   `json:"yours"`
				User         string `json:"windowsUser"`
				Ports        []int  `json:"tallyPorts"`
				UnknownPorts []int  `json:"tallyPortsUnknown"`
				Rule         string `json:"claimRule"`
			}
			if json.Unmarshal(b, &p) != nil || p.Bridge != "FinCom Tally Bridge" || p.Yours {
				continue
			}
			for _, tp := range p.UnknownPorts {
				if _, had := out[tp]; !had {
					out[tp] = bridgeClaim{l.Port, true, p.User, p.Rule}
				}
			}
			for _, tp := range p.Ports {
				out[tp] = bridgeClaim{l.Port, false, p.User, p.Rule}
			}
		}
	}
	claims, claimsAt = out, time.Now()
	return out
}

// --- the company list asked afresh in the background when Windows shows a Tally the list held does not: at most once
// a minute, never two at once; the beat is sent at once after it (a hook for the tests)
var (
	askAfreshFn   = askAfreshBg
	askAfreshAt   atomic.Int64
	askAfreshBusy atomic.Bool
	askBgRunning  atomic.Bool
)

func askAfreshSoon() bool {
	if t := askAfreshAt.Load(); t != 0 && time.Since(time.Unix(0, t)) < time.Minute {
		return false
	}
	if !askAfreshBusy.CompareAndSwap(false, true) {
		return false
	}
	askAfreshAt.Store(time.Now().UnixNano())
	func() {
		defer askAfreshBusy.Store(false)
		askAfreshFn()
	}()
	return true
}

// a person's check now (Connect, the Tally page): the minute's wait is not kept
func askAfreshNow() {
	askAfreshAt.Store(0)
}

func askAfreshBg() {
	// under go test the background ask is the test's own (askAfreshFn): never one left running past a test
	if testing.Testing() || !askBgRunning.CompareAndSwap(false, true) {
		return
	}
	go func() {
		defer askBgRunning.Store(false)
		defer func() {
			if r := recover(); r != nil {
				writeLog(fmt.Sprint("Tally list asked afresh: ", r))
			}
		}()
		openCompaniesAsk(bgCompaniesTC(), true)
		select {
		case beatNow <- struct{}{}:
		default:
		}
	}()
}

// a list held still stands for Windows' list now: the same ports with the same owner, and no port it held closed
// (nothing listening) that takes a connection now (a Tally restarted after its connection was switched on). No request to Tally
func cacheMatches(held, plan []M) bool {
	if len(held) != len(plan) {
		return false
	}
	byPort := map[int]M{}
	for _, e := range held {
		byPort[toInt(e["port"])] = e
	}
	for _, pp := range plan {
		e, ok := byPort[toInt(pp["port"])]
		if !ok || fmt.Sprint(e["mine"]) != fmt.Sprint(pp["mine"]) {
			return false
		}
		if e["skipped"] != true && str(e["tallyState"]) == "closed" && tallyPortOpen(toInt(pp["port"])) {
			return false
		}
	}
	return true
}
