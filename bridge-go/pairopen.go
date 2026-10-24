package main

// 2.4.6 (the owner's approval of 24-Oct-2026): the bridge opens FinCom with the connect code already filled in.
//
//   - The tray's "Connect FinCom on this computer..." opens a fresh 10-minute connect window (as before) and FinCom's own
//     address with #pair=<code>; FinCom's page takes the code off the address at once, checks the bridge's proof and
//     pairs (src/js/49-tally-cloud.js). The message box says where to type the code if the browser does not open.
//   - The first start after the installer (its install command given --pairopen: a person at the setup, never a silent
//     /S setup) does the same once per install: the install leaves its ask in the install's record in the registry
//     (pairstore_windows.go); the owner's tray in a signed-in session takes it through the bridge (one tray only),
//     after the Finish page had 2 minutes to say (its "Open FinCom to connect", ticked: at once; unticked: dropped),
//     within a day, and never when this computer was connected to FinCom before (an upgrade). FinCom connected with
//     the code typed by hand first (/pair) drops it too.
//
// Only the tray opens the browser: never the bridge itself (it may be the Windows service in session 0), never a tray in
// session 0, never for another Windows user (the tray ends at its start for a user who is not the bridge's owner). Only
// to FinCom's own https sites, with only the 6-digit code in the address's fragment (never sent to a server; no key).
// The code works as before: once, 10 minutes, proved by pairProof before FinCom sends it. Nothing goes to Tally.

import (
	"fmt"
	"net/url"
	"strings"
	"sync"
	"time"
)

// FinCom's own sites: the pages the bridge's web server trusts by itself (allowedOrigin) and the only ones it opens
var fincomSites = []string{"https://app.fincom.live", "https://staging.fincom.live", "https://fincom.live", "https://caanshulgarg.github.io"}

var reSixDigits = re(`^[0-9]{6}$`)

// FinCom's address without a fragment when base is one of FinCom's own https sites (no user, no port); false otherwise
func fincomPlainURL(base string) (string, bool) {
	u, err := url.Parse(strings.TrimSpace(base))
	if err != nil || !strings.EqualFold(u.Scheme, "https") || u.User != nil || u.Opaque != "" || u.Port() != "" {
		return "", false
	}
	host := strings.ToLower(u.Host)
	for _, s := range fincomSites {
		if "https://"+host == s {
			u.Scheme, u.Host, u.Fragment, u.RawFragment, u.RawQuery, u.ForceQuery = "https", host, "", "", "", false
			return u.String(), true
		}
	}
	return "", false
}

// FinCom's address with the connect code in its fragment; false unless base is one of FinCom's own sites and the code
// is 6 digits
func pairOpenURL(base, code string) (string, bool) {
	if !reSixDigits.MatchString(code) {
		return "", false
	}
	u, ok := fincomPlainURL(base)
	if !ok {
		return "", false
	}
	return u + "#pair=" + code, true
}

// where the tray runs: its Windows session, whether it is the service, whether its user is the bridge's owner
type browserFacts struct {
	Session int
	Service bool
	OwnerOK bool
}

// the browser is opened only by the owner's tray in a signed-in session: never the service, session 0 or another user
func mayOpenBrowser(f browserFacts) (bool, string) {
	switch {
	case f.Service:
		return false, "the Windows service opens no browser"
	case f.Session == 0:
		return false, "session 0 (the services' session) has no one signed in"
	case !f.OwnerOK:
		return false, "this Windows user is not the bridge's owner"
	}
	return true, ""
}

// what the tray hands to the shared steps (the tests give stand-ins)
type pairOpenEnv struct {
	call  func(method, path string, body any) M
	open  func(u string)
	show  func(title, text string, warn bool)
	facts browserFacts
}

func untilHM(s string) string {
	if len(s) >= 16 {
		return s[11:16]
	}
	return s
}

// the message box's words: where to type the code if the browser does not open (or was not opened)
func pairOpenText(addr, code, until string, opened bool) string {
	if opened {
		return "FinCom is opening in your browser and connects this computer by itself.\n\nIf it doesn't, open " + addr +
			" on this computer, go to the Tally page and type this code:\n\n        " + code + "\n\n(until " + until + ")"
	}
	return "Open " + addr + " in a browser on this computer, go to the Tally page and type this code:\n\n        " + code +
		"\n\n(until " + until + ")"
}

// opens FinCom with the code when allowed; the message either way
func openWithCode(e pairOpenEnv, fincom, code, until string) {
	opened := false
	if may, _ := mayOpenBrowser(e.facts); may {
		if u, ok := pairOpenURL(fincom, code); ok {
			e.open(u)
			opened = true
		}
	}
	addr := "FinCom" // an address that is not one of FinCom's own sites is never named next to a live code
	if p, ok := fincomPlainURL(fincom); ok {
		addr = p
	}
	e.show("Connect FinCom", pairOpenText(addr, code, untilHM(until), opened), false)
}

// the tray's "Connect FinCom on this computer...": a fresh 10-minute code, FinCom opened with it
func trayConnectNow(e pairOpenEnv, fincom string) {
	r := e.call("POST", "/paircode", M{})
	if r == nil || str(r["code"]) == "" {
		e.show("FinCom Bridge", "The bridge is not answering, so no connect code could be made.", true)
		return
	}
	openWithCode(e, fincom, str(r["code"]), str(r["until"]))
}

// the first start after the installer: true when this tray took the install's ask (and opened FinCom when allowed)
func trayFirstOpen(e pairOpenEnv, fincom string) bool {
	if may, _ := mayOpenBrowser(e.facts); !may {
		return false // left for the owner's own tray
	}
	r := e.call("POST", "/tray/pairopen", M{"action": "take", "session": e.facts.Session})
	if r == nil || !truthy(r["take"]) {
		return false
	}
	if truthy(r["plain"]) {
		if may, _ := mayOpenBrowser(e.facts); may {
			if u, ok := fincomPlainURL(fincom); ok {
				e.open(u)
				return true
			}
		}
		e.show("FinCom Bridge", "This computer is connected to FinCom. Open FinCom in a browser on this computer.", false)
		return true
	}
	if str(r["code"]) != "" {
		openWithCode(e, fincom, str(r["code"]), str(r["until"]))
	}
	return true
}

// --- the bridge's side: the install's ask, kept in the install's own record in the registry (pairstore_windows.go):
// HKLM\SOFTWARE\FinCom\Bridge for the service (only an administrator writes it; the service and the users read it), HKCU
// for an install just for one user. Never a file in the bridge's folder, which the owner (a standard user) controls: the
// service (SYSTEM) and an elevated setup would follow a link planted there. Not Windows (the tests): files in Home.

const (
	pairDueVal = "PairOpenDue" // the install (a person at the setup) asks for FinCom to open at the first start
	pairNowVal = "PairOpenNow" // the Finish page's "Open FinCom to connect", ticked: at once
)

// where the ask is kept (bridge, tray and connect: the install this program belongs to)
type pairStore interface {
	get(name string) string
	set(name, v string) error
	del(name string) error // nil when there was none
}

var pairStoreFor = platPairStore

// the time the Finish page has to say (ticked: at once; unticked: dropped) before the first start opens by itself
var pairOpenGrace = 2 * time.Minute

// an ask older than this is dropped, never opened: the first start, not a sign-in days later on a computer where the
// browser may be signed in to another FinCom account
var pairOpenMaxAge = 24 * time.Hour

var pairOpenMu sync.Mutex
var pairOpenStuck bool // the ask could not be removed: said once, never taken again until the bridge restarts

// the install's end (installCmd, installUserCmd): asked only when the setup asked (--pairopen, a person at the setup)
// and the bridge answers (rc 0), timed from then for the Finish page's grace. clearPairOpen ran at the install's start
func notePairOpen(st pairStore, args []string, rc int, logf func(string)) {
	clearPairOpen(st)
	if rc != 0 || !contains(args, "--pairopen") {
		return
	}
	now := time.Now()
	if err := st.set(pairDueVal, jsonText(M{"at": fmtTime(now), "atUnix": now.Unix(), "version": BridgeVersion})); err != nil {
		logf("Install: the first-start opening of FinCom could not be noted (" + err.Error() + ")")
	}
}

// the install's start (before the bridge is stopped and started again): an earlier install's ask never outlives it
func clearPairOpen(st pairStore) {
	_ = st.del(pairNowVal)
	_ = st.del(pairDueVal)
}

// connected to FinCom before (its cloud address and a computer key, readable or still protected for the Windows user:
// the service of an upgrade before the tray hands the key over); read from the settings only, nothing decrypted
func pairOpenConnected() bool {
	return cfgS("CloudUrl") != "" && (cfgS("CloudKeyGo") != "" || cfgS("CloudKey") != "")
}

// the ask read, nothing changed: ready (for the owner's tray to take) when asked at once (the Finish page), or 2 minutes
// old (the take then opens nothing on a computer connected before, or for an ask over a day old, and drops it). An ask
// that could not be removed is never ready again until the bridge restarts. Call with pairOpenMu held
func pairOpenStateLocked(st pairStore) (due, now, ready bool, age time.Duration) {
	v := st.get(pairDueVal)
	if v == "" || pairOpenStuck {
		return v != "", false, false, 0
	}
	at := time.Unix(int64(num(parseObj(v)["atUnix"])), 0)
	if num(parseObj(v)["atUnix"]) <= 0 || time.Until(at) > time.Hour {
		return true, st.get(pairNowVal) != "", true, pairOpenMaxAge + time.Second // unreadable, or a clock set back: as old
	}
	age = time.Since(at)
	if st.get(pairNowVal) != "" {
		return true, true, true, age
	}
	return true, false, age >= pairOpenGrace, age
}

func pairOpenReady() bool {
	pairOpenMu.Lock()
	defer pairOpenMu.Unlock()
	_, _, ready, _ := pairOpenStateLocked(pairStoreFor())
	return ready
}

// the ask dropped (FinCom connected with the code typed by hand); the reason logged when there was one
func clearPairOpenDue(why string) {
	pairOpenMu.Lock()
	defer pairOpenMu.Unlock()
	st := pairStoreFor()
	had := st.get(pairDueVal) != ""
	_ = st.del(pairNowVal)
	if had && st.del(pairDueVal) == nil && why != "" {
		writeLog(why)
	}
}

// a fresh connect window of min minutes: its code and end, as /paircode gives them
func freshPairCode(min int) (code, until string) {
	c, u := openPairWindow(min)
	return c, u.Format("2006-01-02T15:04:05")
}

// POST /tray/pairopen {action: "take", session}: the owner's tray takes the install's ask (one tray only); GET: the state
func pairOpenRoute(method string, body M) (M, error) {
	st := pairStoreFor()
	if method != "POST" {
		pairOpenMu.Lock()
		due, now, ready, _ := pairOpenStateLocked(st)
		pairOpenMu.Unlock()
		return M{"ok": true, "due": due, "now": now, "ready": ready}, nil
	}
	if a := str(body["action"]); a != "take" {
		return M{"ok": false, "error": "Unknown action " + a + "."}, nil
	}
	pairOpenMu.Lock()
	_, now, ready, age := pairOpenStateLocked(st)
	if !ready {
		pairOpenMu.Unlock()
		return M{"ok": true, "take": false}, nil
	}
	// taken only when the ask is gone: one that cannot be removed is said once and never taken again
	if err := st.del(pairDueVal); err != nil {
		pairOpenStuck = true
		pairOpenMu.Unlock()
		writeLog("The install's first-start opening of FinCom could not be taken (" + err.Error() + "); FinCom is not opened by itself.")
		return M{"ok": true, "take": false}, nil
	}
	_ = st.del(pairNowVal)
	pairOpenMu.Unlock()
	if age > pairOpenMaxAge {
		writeLog("The install's first-start opening of FinCom is over a day old: dropped, FinCom not opened (Connect FinCom on this computer... in the tray does it).")
		return M{"ok": true, "take": false}, nil
	}
	if !now && pairOpenConnected() {
		// an upgrade of a computer connected before, the Finish page never answered: nothing to open, the ask dropped
		writeLog("Already connected to FinCom: the install's first-start opening of FinCom is not needed.")
		return M{"ok": true, "take": false}, nil
	}
	how := fmt.Sprintf("the first start after the setup, session %d", toInt(body["session"]))
	if now {
		how += ", the setup's Finish page: Open FinCom to connect ticked"
	}
	if pairOpenConnected() {
		writeLog("FinCom opened in the browser (" + how + "); this computer is connected already, no code.")
		return M{"ok": true, "take": true, "plain": true}, nil
	}
	code, until := freshPairCode(10)
	writeLog("FinCom opened in the browser to connect this computer (" + how + "): a new connect code for 10 minutes.")
	return M{"ok": true, "take": true, "code": code, "until": until}, nil
}

// the tray's own look at the install's record before it acts on the bridge's "ready" (a program squatting on the
// bridge's port cannot write that record: HKLM needs an administrator, HKCU is the owner's own)
func pairOpenAskedHere() bool { return pairStoreFor().get(pairDueVal) != "" }

// --- FinComBridge.exe connect --first | --skip: the setup's Finish page changes the install's record directly (the
// setup may run as another administrator, whom the bridge's web server does not answer); the owner's tray then opens
// FinCom (--first) or never does (--skip). The setup's own install.log says which
func connectCmd(args []string) int {
	st := pairStoreFor()
	if st.get(pairDueVal) == "" {
		return 0 // done already, or no install asked: nothing made up
	}
	if contains(args, "--skip") {
		_ = st.del(pairNowVal)
		_ = st.del(pairDueVal)
		return 0
	}
	_ = st.set(pairNowVal, fmtTime(time.Now()))
	if st.get(pairDueVal) == "" {
		_ = st.del(pairNowVal) // the tray took the ask meanwhile: no stray "at once" for a later install
	}
	return 0
}
