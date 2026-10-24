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
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
)

// FinCom's own sites: the pages the bridge's web server trusts by itself (allowedOrigin) and the only ones it opens
var fincomSites = []string{"https://app.fincom.live", "https://staging.fincom.live", "https://fincom.live", "https://caanshulgarg.github.io"}

var reSixDigits = re(`^[0-9]{6}$`)

// 2.4.7: what the address carries: the 6-digit code and the window's 128-bit secret (#pair=<code>-<secret>)
var rePairValue = re(`^[0-9]{6}-[0-9a-f]{32}$`)

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

// FinCom's address with the connect code and the window's secret in its fragment; false unless base is one of FinCom's
// own sites and pair is <6 digits>-<32 hex>
func pairOpenURL(base, pair string) (string, bool) {
	if !rePairValue.MatchString(pair) {
		return "", false
	}
	u, ok := fincomPlainURL(base)
	if !ok {
		return "", false
	}
	return u + "#pair=" + pair, true
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
	call   func(method, path string, body any) M
	open   func(u string)
	show   func(title, text string, warn bool)
	verify func() bool // the first start: the bridge's port still this install's bridge, right before FinCom opens (nil: yes)
	facts  browserFacts
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
func openWithCode(e pairOpenEnv, fincom, code, secret, until string) {
	opened := false
	if may, _ := mayOpenBrowser(e.facts); may {
		if u, ok := pairOpenURL(fincom, code+"-"+secret); ok {
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
	openWithCode(e, fincom, str(r["code"]), str(r["secret"]), str(r["until"]))
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
	// the port's program checked again before FinCom opens (the tray checked it before the take too); a passing glitch
	// (the service manager or the connection table not answering) is given 3 more seconds
	if e.verify != nil {
		ok := e.verify()
		for i := 0; i < 3 && !ok; i++ {
			pairOpenSleep(time.Second)
			ok = e.verify()
		}
		if !ok {
			// not this install's bridge (any more): no code shown, nothing opened; the way to connect said instead
			e.show("FinCom Bridge", "To connect FinCom on this computer: right-click the FinCom icon near the clock and choose Connect FinCom on this computer...", false)
			return true
		}
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
		openWithCode(e, fincom, str(r["code"]), str(r["secret"]), str(r["until"]))
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
var pairOpenSleep = time.Sleep // the tests: no waiting

const ageUntrusted = time.Duration(-1) // pairOpenStateLocked: the ask's time cannot be trusted
var pairOpenStuck bool                 // the ask could not be removed: said once, never taken again until the bridge restarts

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
// age ageUntrusted: the time cannot be trusted (unreadable, or the clock set back over an hour): ready, and the take drops it
func pairOpenStateLocked(st pairStore) (due, now, ready bool, age time.Duration) {
	v := st.get(pairDueVal)
	if v == "" || pairOpenStuck {
		return v != "", false, false, 0
	}
	now = st.get(pairNowVal) != ""
	sec := num(parseObj(v)["atUnix"])
	at := time.Unix(int64(sec), 0)
	if sec <= 0 || time.Until(at) > time.Hour {
		return true, now, true, ageUntrusted
	}
	age = max(time.Since(at), 0) // a little ahead (a small clock step back): as just written
	return true, now, now || age >= pairOpenGrace, age
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
func freshPairCode(min int) (code, secret, until string) {
	c, s, u := openPairWindow(min)
	return c, s, u.Format("2006-01-02T15:04:05")
}

// 2.4.7: the tray (and the measuring tool) never send the bridge key. Before each request: /ping with a fresh nonce
// proves the program on the port holds the key (else nothing is sent) and hands out a one-use challenge (30 s); the
// request then carries X-Bridge-Auth: <challenge>.<HMAC(key, "fincom-tray-auth|" challenge "|" method "|" path?query)>.
// A program that takes the port in between gets only that proof, good for nothing: the bridge takes each challenge it
// issued once, for that request only, and answers no other Windows user's program.
func bridgeAuthorize(port int, key, method, requestURI string, timeout time.Duration) (string, bool) {
	ch, ok := bridgeChallenge(port, key, timeout)
	if !ok {
		return "", false
	}
	return ch + "." + trayAuthMAC(key, ch, method, requestURI), true
}

func trayAuthMAC(key, ch, method, requestURI string) string {
	m := hmac.New(sha256.New, []byte(key))
	m.Write([]byte("fincom-tray-auth|" + ch + "|" + method + "|" + requestURI))
	return hex.EncodeToString(m.Sum(nil))
}

// the program on 127.0.0.1:port proved it holds the key (HMAC of our nonce, bound to its id and that port); its challenge
func bridgeChallenge(port int, key string, timeout time.Duration) (string, bool) {
	if port <= 0 || key == "" {
		return "", false
	}
	n := randHex16() + randHex16()
	c := &http.Client{Timeout: timeout, Transport: &http.Transport{Proxy: nil}}
	req, _ := http.NewRequest("GET", fmt.Sprintf("http://127.0.0.1:%d/ping?n=%s&challenge=1", port, n), nil)
	req.Header.Set("X-FinCom-Tray", "1")
	r, err := c.Do(req)
	if err != nil {
		return "", false
	}
	b, _ := io.ReadAll(io.LimitReader(r.Body, 1<<16))
	r.Body.Close()
	j := parseObj(string(b))
	if j == nil || toInt(j["port"]) != port || str(j["bridgeId"]) == "" {
		return "", false
	}
	want := proofFor(key, n, str(j["bridgeId"])+fmt.Sprint(port))
	ch := str(j["challenge"])
	if want == "" || !hmac.Equal([]byte(want), []byte(str(j["proof"]))) || !re(`^[0-9a-f]{64}$`).MatchString(ch) {
		return "", false
	}
	return ch, true
}

// the proof alone (the tests)
func bridgeProves(port int, key string, timeout time.Duration) bool {
	_, ok := bridgeChallenge(port, key, timeout)
	return ok
}

// --- the bridge's side of the tray's proof
var (
	trayAuthMu     sync.Mutex
	trayAuthIssued = map[string]time.Time{}
)

func issueTrayChallenge() string {
	trayAuthMu.Lock()
	defer trayAuthMu.Unlock()
	now := time.Now()
	for k, exp := range trayAuthIssued {
		if now.After(exp) {
			delete(trayAuthIssued, k)
		}
	}
	if len(trayAuthIssued) >= 64 { // a program asking without using them: the oldest go
		for k := range trayAuthIssued {
			delete(trayAuthIssued, k)
			if len(trayAuthIssued) < 32 {
				break
			}
		}
	}
	ch := randHex16() + randHex16()
	trayAuthIssued[ch] = now.Add(30 * time.Second)
	return ch
}

// X-Bridge-Auth: a challenge this bridge issued (taken once), with the key's HMAC over it and this request
func trayAuthOK(r *http.Request) bool {
	v := r.Header.Get("X-Bridge-Auth")
	ch, mac, found := strings.Cut(v, ".")
	key := cfgS("Key")
	if !found || key == "" || len(ch) != 64 || len(mac) != 64 {
		return false
	}
	trayAuthMu.Lock()
	exp, ok := trayAuthIssued[ch]
	delete(trayAuthIssued, ch)
	trayAuthMu.Unlock()
	if !ok || time.Now().After(exp) {
		return false
	}
	return hmac.Equal([]byte(trayAuthMAC(key, ch, r.Method, r.URL.RequestURI())), []byte(mac))
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
	if age == ageUntrusted || age > pairOpenMaxAge {
		why := "is over a day old"
		if age == ageUntrusted {
			why = "has a time that cannot be trusted (unreadable, or the clock was set back)"
		}
		writeLog("The install's first-start opening of FinCom " + why + ": dropped, FinCom not opened (Connect FinCom on this computer... in the tray does it).")
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
		writeLog("FinCom handed to the tray to open in the browser (" + how + "); this computer is connected already, no code.")
		return M{"ok": true, "take": true, "plain": true}, nil
	}
	code, secret, until := freshPairCode(10)
	writeLog("FinCom handed to the tray to open in the browser and connect this computer (" + how + "): a new connect code for 10 minutes.")
	return M{"ok": true, "take": true, "code": code, "secret": secret, "until": until}, nil
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
