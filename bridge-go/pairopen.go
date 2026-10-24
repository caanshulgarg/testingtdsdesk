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

// FinCom's address with the connect code in its fragment; false unless base is one of FinCom's own https sites (no
// user, no port) and the code is 6 digits
func pairOpenURL(base, code string) (string, bool) {
	if !reSixDigits.MatchString(code) {
		return "", false
	}
	u, err := url.Parse(strings.TrimSpace(base))
	if err != nil || !strings.EqualFold(u.Scheme, "https") || u.User != nil || u.Opaque != "" || u.Port() != "" {
		return "", false
	}
	host := strings.ToLower(u.Host)
	ok := false
	for _, s := range fincomSites {
		if "https://"+host == s {
			ok = true
		}
	}
	if !ok {
		return "", false
	}
	u.Scheme, u.Host, u.Fragment, u.RawFragment = "https", host, "", ""
	return u.String() + "#pair=" + code, true
}

// FinCom's address as it is shown (and opened plain): one of FinCom's sites, without a fragment; false otherwise
func fincomPlainURL(base string) (string, bool) {
	s, ok := pairOpenURL(base, "000000")
	if !ok {
		return "", false
	}
	return strings.TrimSuffix(s, "#pair=000000"), true
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
			" on this computer and type this code:\n\n        " + code + "\n\n(until " + until + ")"
	}
	return "Open " + addr + " in a browser on this computer and type this code:\n\n        " + code + "\n\n(until " + until + ")"
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
		if u, ok := fincomPlainURL(fincom); ok {
			e.open(u)
		}
		return true
	}
	if str(r["code"]) != "" {
		openWithCode(e, fincom, str(r["code"]), str(r["until"]))
	}
	return true
}

// --- the bridge's side: the install's ask, kept in its folder

const pairOpenDueName = "pair-open-due.json"

// the time the Finish page has to say (ticked: at once; unticked: dropped) before the first start opens by itself
var pairOpenGrace = 2 * time.Minute

var pairOpenMu sync.Mutex

func pairOpenDueFile() string { return filepath.Join(Home, pairOpenDueName) }

// the install (FinComBridge.exe install ... --pairopen): FinCom opens to connect at the first start
func markPairOpenDue(home string) error {
	b := jsonText(M{"at": fmtTime(time.Now()), "version": BridgeVersion, "now": false})
	return saveFile(filepath.Join(home, pairOpenDueName), b)
}

func clearPairOpenDue(why string) {
	pairOpenMu.Lock()
	defer pairOpenMu.Unlock()
	if exists(pairOpenDueFile()) && os.Remove(pairOpenDueFile()) == nil && why != "" {
		writeLog(why)
	}
}

// the ask read; ready: asked at once (the Finish page), or 2 minutes old and this computer not connected to FinCom.
// Connected (an upgrade of a working computer) and not asked at once: the ask is dropped. Call with pairOpenMu held
func pairOpenStateLocked() (due, ready bool) {
	f := pairOpenDueFile()
	if !exists(f) {
		return false, false
	}
	m := readObjFile(f)
	if truthy(m["now"]) {
		return true, true
	}
	if cloudOn() {
		if os.Remove(f) == nil {
			writeLog("Already connected to FinCom: the install's first-start opening of FinCom is not needed.")
		}
		return false, false
	}
	at, err := time.ParseInLocation("2006-01-02T15:04:05", str(m["at"]), time.Local)
	if err != nil {
		return true, true // unreadable time: as old
	}
	return true, time.Since(at) >= pairOpenGrace
}

func pairOpenReady() bool {
	pairOpenMu.Lock()
	defer pairOpenMu.Unlock()
	_, ready := pairOpenStateLocked()
	return ready
}

// POST /tray/pairopen {action}: "now" (Finish ticked), "skip" (unticked), "take" (the owner's tray: one only); GET: state
func pairOpenRoute(method string, body M) (M, error) {
	if method != "POST" {
		pairOpenMu.Lock()
		due, ready := pairOpenStateLocked()
		pairOpenMu.Unlock()
		return M{"ok": true, "due": due, "ready": ready}, nil
	}
	switch a := str(body["action"]); a {
	case "now":
		pairOpenMu.Lock()
		defer pairOpenMu.Unlock()
		f := pairOpenDueFile()
		if !exists(f) {
			return M{"ok": true, "due": false}, nil // done already, or no install asked: nothing made up
		}
		m := readObjFile(f)
		m["now"] = true
		if err := saveFile(f, jsonText(m)); err != nil {
			return nil, err
		}
		writeLog("The setup's Finish page: Open FinCom to connect (ticked).")
		return M{"ok": true, "due": true}, nil
	case "skip":
		clearPairOpenDue("The setup's Finish page: Open FinCom to connect left unticked; FinCom is not opened by itself.")
		return M{"ok": true, "due": false}, nil
	case "take":
		pairOpenMu.Lock()
		_, ready := pairOpenStateLocked()
		if !ready {
			pairOpenMu.Unlock()
			return M{"ok": true, "take": false}, nil
		}
		_ = os.Remove(pairOpenDueFile())
		pairOpenMu.Unlock()
		if cloudOn() {
			writeLog(fmt.Sprintf("FinCom opened in the browser after the setup (session %d); this computer is connected already, no code.", toInt(body["session"])))
			return M{"ok": true, "take": true, "plain": true}, nil
		}
		openPairWindow(10)
		writeLog(fmt.Sprintf("FinCom opened in the browser to connect this computer (the first start after the setup, session %d): a new connect code for 10 minutes.", toInt(body["session"])))
		pairMu.Lock()
		code, until := pairCode, pairUntil.Format("2006-01-02T15:04:05")
		pairMu.Unlock()
		return M{"ok": true, "take": true, "code": code, "until": until}, nil
	default:
		return M{"ok": false, "error": "Unknown action " + a + "."}, nil
	}
}

// --- FinComBridge.exe connect --first | --skip: the setup's Finish page tells the bridge (the owner's tray opens FinCom)

var connectCall = func(method, path string, body any) M {
	loadConfigRO()
	return bridgeCall(method, path, body, 5*time.Second)
}
var connectWait = time.Sleep

func connectCmd(args []string) int {
	action := "now"
	if contains(args, "--skip") {
		action = "skip"
	}
	// the bridge may still be starting (the service waits for Windows): asked again for 30 s at most; never an error for
	// the setup (the first start opens FinCom by itself after 2 minutes when this did not reach the bridge)
	for i := 0; i < 15; i++ {
		if r := connectCall("POST", "/tray/pairopen", M{"action": action}); r != nil {
			return 0
		}
		connectWait(2 * time.Second)
	}
	return 0
}
