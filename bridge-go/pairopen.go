package main

// 2.4.6 (the owner's approval of 24-Oct-2026): the bridge opens FinCom with the connect code already filled in.
//
//   - The tray's "Connect FinCom on this computer..." opens a fresh 10-minute connect window (as before) and FinCom's own
//     address with #pair=<code>; FinCom's page takes the code off the address at once, checks the bridge's proof and
//     pairs (src/js/49-tally-cloud.js). The message box says where to type the code if the browser does not open.
//   - The first start after the installer (its install command given --pairopen: a person at the setup, never a silent
//     /S setup) does the same once per install: the install leaves pair-open-due.json in the bridge's folder; the
//     owner's tray in a signed-in session takes it (one tray only), after the Finish page had 2 minutes to say (its
//     "Open FinCom to connect", ticked: at once; unticked: dropped), and never when this computer is already connected
//     to FinCom (an upgrade). FinCom typed in by hand first (/pair) drops it too.
//
// Only the tray opens the browser: never the bridge itself (it may be the Windows service in session 0), never a tray in
// session 0, never for another Windows user (the tray ends at its start for a user who is not the bridge's owner). Only
// to FinCom's own https sites, with only the 6-digit code in the address's fragment (never sent to a server; no key).
// The code works as before: once, 10 minutes, proved by pairProof before FinCom sends it. Nothing goes to Tally.

import (
	"fmt"
	"net/url"
	"os"
	"path/filepath"
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
			u.Scheme, u.Host, u.Fragment, u.RawFragment = "https", host, "", ""
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
	addr := fincom
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
		e.show("FinCom Bridge", "This computer is connected to FinCom. Open "+fincom+" in a browser on this computer.", false)
		return true
	}
	if str(r["code"]) != "" {
		openWithCode(e, fincom, str(r["code"]), str(r["until"]))
	}
	return true
}

// --- the bridge's side: the install's ask, kept in its folder

const (
	pairOpenDueName = "pair-open-due.json" // the install (a person at the setup) asks for FinCom to open at the first start
	pairOpenNowName = "pair-open-now.txt"  // the Finish page's "Open FinCom to connect", ticked: at once
)

// the time the Finish page has to say (ticked: at once; unticked: dropped) before the first start opens by itself
var pairOpenGrace = 2 * time.Minute

var pairOpenMu sync.Mutex
var pairOpenRemove = os.Remove // the tests: a file an antivirus holds
var pairOpenStuck bool         // the ask could not be removed: said once, never taken again until the bridge restarts

func pairOpenDueFile() string { return filepath.Join(Home, pairOpenDueName) }
func pairOpenNowFile() string { return filepath.Join(Home, pairOpenNowName) }

// the install's end (installCmd, installUserCmd): an earlier install's ask cleared; asked again only when the setup
// asked (--pairopen, a person at the setup) and the bridge answers (rc 0), timed from then for the Finish page's grace
func notePairOpen(home string, args []string, rc int, logf func(string)) {
	clearPairOpenFiles(home)
	if rc != 0 || !contains(args, "--pairopen") {
		return
	}
	if err := markPairOpenDue(home); err != nil {
		logf("Install: the first-start opening of FinCom could not be noted (" + err.Error() + ")")
	}
}

// the install's start (before the bridge is stopped and started again): an earlier install's ask never outlives it
func clearPairOpenFiles(home string) {
	_ = os.Remove(filepath.Join(home, pairOpenNowName))
	_ = os.Remove(filepath.Join(home, pairOpenDueName))
}

// "atUnix" times the grace (a clock change never moves it); "at" for people
func markPairOpenDue(home string) error {
	now := time.Now()
	return saveFile(filepath.Join(home, pairOpenDueName), jsonText(M{"at": fmtTime(now), "atUnix": now.Unix(), "version": BridgeVersion}))
}

// connected to FinCom before (its cloud address and a computer key, readable or still protected for the Windows user:
// the service of an upgrade before the tray hands the key over); read from the settings only, nothing decrypted
func pairOpenConnected() bool {
	return cfgS("CloudUrl") != "" && (cfgS("CloudKeyGo") != "" || cfgS("CloudKey") != "")
}

// the ask read, nothing changed: ready (for the owner's tray to take) when asked at once (the Finish page), or 2 minutes
// old (the take then opens nothing on a computer connected before, and drops the ask). An ask that could not be removed
// is never ready again until the bridge restarts. Call with pairOpenMu held
func pairOpenStateLocked() (due, now, ready bool) {
	f := pairOpenDueFile()
	if !exists(f) || pairOpenStuck {
		return exists(f), false, false
	}
	if exists(pairOpenNowFile()) {
		return true, true, true
	}
	m := readObjFile(f)
	at := time.Unix(int64(num(m["atUnix"])), 0)
	if num(m["atUnix"]) <= 0 {
		return true, false, true // no readable time: as old
	}
	return true, false, time.Since(at) >= pairOpenGrace || time.Until(at) > time.Hour // a clock set back: as old
}

func pairOpenReady() bool {
	pairOpenMu.Lock()
	defer pairOpenMu.Unlock()
	_, _, ready := pairOpenStateLocked()
	return ready
}

// the ask dropped (FinCom connected with the code typed by hand); the reason logged when there was one
func clearPairOpenDue(why string) {
	pairOpenMu.Lock()
	defer pairOpenMu.Unlock()
	had := exists(pairOpenDueFile())
	_ = os.Remove(pairOpenNowFile())
	if had && os.Remove(pairOpenDueFile()) == nil && why != "" {
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
	if method != "POST" {
		pairOpenMu.Lock()
		due, now, ready := pairOpenStateLocked()
		pairOpenMu.Unlock()
		return M{"ok": true, "due": due, "now": now, "ready": ready}, nil
	}
	if a := str(body["action"]); a != "take" {
		return M{"ok": false, "error": "Unknown action " + a + "."}, nil
	}
	pairOpenMu.Lock()
	_, now, ready := pairOpenStateLocked()
	if !ready {
		pairOpenMu.Unlock()
		return M{"ok": true, "take": false}, nil
	}
	// taken only when the ask is gone: a file that cannot be removed is said once and never taken again
	if err := pairOpenRemove(pairOpenDueFile()); err != nil {
		pairOpenStuck = true
		pairOpenMu.Unlock()
		writeLog("The install's first-start opening of FinCom could not be taken (" + err.Error() + "); FinCom is not opened by itself.")
		return M{"ok": true, "take": false}, nil
	}
	_ = os.Remove(pairOpenNowFile())
	pairOpenMu.Unlock()
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

// --- FinComBridge.exe connect --first | --skip: the setup's Finish page. The files in the bridge's folder are changed
// directly (the setup may run as another administrator, whom the bridge's web server does not answer); the owner's tray
// then opens FinCom (--first) or never does (--skip)
func connectCmd(args []string) int {
	if !exists(pairOpenDueFile()) {
		return 0 // done already, or no install asked: nothing made up
	}
	// the setup's own install.log says which (the bridge's log is the bridge's to write)
	if contains(args, "--skip") {
		_ = os.Remove(pairOpenNowFile())
		_ = os.Remove(pairOpenDueFile())
		return 0
	}
	_ = saveFile(pairOpenNowFile(), fmtTime(time.Now()))
	if !exists(pairOpenDueFile()) {
		_ = os.Remove(pairOpenNowFile()) // the tray took the ask meanwhile: no stray "at once" for a later install
	}
	return 0
}
