// FinCom Bridge 2.5.16 (the owner's decision): one key per browser. Each pairing with FinCom adds a key of its own for
// that browser (named by the browser, "Chrome on this PC"), kept in the settings as its SHA-256 only (PairedBrowsers:
// id, name, hash, at, used), compared in constant time. Any one can be removed alone: from the tray icon ("Disconnect a
// browser..."), or by the paired page itself (POST /forget, FinCom's sign-out). The single key of earlier versions
// (Key) keeps working for FinCom's pages until the first pairing of 2.5.16; then it is replaced by a new one kept for
// the tray icon's own proofs only (pairopen.go), and no page's key is it.
//
// The bridge proves itself to a page (/ping) with HMAC(the key's SHA-256, nonce || id || port) for each paired browser
// (proofs), so it never needs to keep a page's key itself; the earlier single key's proof (proof) goes to pages only
// until it is replaced, and always to the tray.
package main

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"sort"
	"strings"
	"sync"
	"time"
)

const maxBrowserKeys = 20

func keyHash(k string) string {
	h := sha256.Sum256([]byte(k))
	return hex.EncodeToString(h[:])
}

var browserKeyMu sync.Mutex

// the paired browsers as kept (a copy)
func pairedBrowsers() []M {
	var out []M
	for _, x := range arr(cfg("PairedBrowsers")) {
		if o := obj(x); o != nil && len(str(o["hash"])) == 64 && str(o["id"]) != "" {
			c := M{}
			for k, v := range o {
				c[k] = v
			}
			out = append(out, c)
		}
	}
	return out
}

func setPairedBrowsers(l []M) {
	a := make([]any, 0, len(l))
	for _, o := range l {
		a = append(a, map[string]any(o))
	}
	setCfg("PairedBrowsers", a)
}

// the earlier single key still taken from pages (until the first pairing of 2.5.16)
func legacyKeyOpen() bool { return !cfgB("LegacyKeyRetired") && cfgS("Key") != "" }

// which paired browser's key this is ("" when none); every stored hash is compared, in constant time
func browserKeyID(given string) string {
	if given == "" {
		return ""
	}
	h := []byte(keyHash(given))
	id := ""
	for _, o := range pairedBrowsers() {
		if hmac.Equal(h, []byte(str(o["hash"]))) {
			id = str(o["id"])
		}
	}
	return id
}

// a page's key: a paired browser's (its id) or, until the first pairing of 2.5.16, the earlier single key ("legacy")
func webKey(given string) (string, bool) {
	if id := browserKeyID(given); id != "" {
		return id, true
	}
	if legacyKeyOpen() && given != "" && hmac.Equal([]byte(cfgS("Key")), []byte(given)) {
		return "legacy", true
	}
	return "", false
}

// last used: kept in memory, written into the settings at most once an hour per browser
var browserUsed = struct {
	sync.Mutex
	at, saved map[string]time.Time
}{at: map[string]time.Time{}, saved: map[string]time.Time{}}

func noteBrowserUsed(id string) {
	if id == "" || id == "legacy" {
		return
	}
	now := time.Now()
	browserUsed.Lock()
	browserUsed.at[id] = now
	due := now.Sub(browserUsed.saved[id]) > time.Hour
	if due {
		browserUsed.saved[id] = now
	}
	browserUsed.Unlock()
	if !due {
		return
	}
	browserKeyMu.Lock()
	defer browserKeyMu.Unlock()
	l := pairedBrowsers()
	for _, o := range l {
		if str(o["id"]) == id {
			o["used"] = now.Format("2006-01-02T15:04:05")
		}
	}
	setPairedBrowsers(l)
	saveConfig()
}

// the browser's name from its User-Agent
func browserName(ua string) string {
	n := "A browser"
	switch {
	case strings.Contains(ua, "Edg/"):
		n = "Edge"
	case strings.Contains(ua, "OPR/"):
		n = "Opera"
	case strings.Contains(ua, "Firefox/"):
		n = "Firefox"
	case strings.Contains(ua, "Chrome/"):
		n = "Chrome"
	case strings.Contains(ua, "Safari/"):
		n = "Safari"
	}
	return n + " on this PC"
}

// a pairing: a new key for this browser (its hash kept), the earlier single key replaced at the first one; the key
func addBrowserKey(name string) string {
	browserKeyMu.Lock()
	defer browserKeyMu.Unlock()
	k := newBridgeKey() + newBridgeKey()[:8]
	l := pairedBrowsers()
	if len(l) >= maxBrowserKeys {
		// the one used longest ago goes
		sort.SliceStable(l, func(i, j int) bool {
			return or(str(l[i]["used"]), str(l[i]["at"])) < or(str(l[j]["used"]), str(l[j]["at"]))
		})
		writeLog("Paired browsers: " + str(l[0]["name"]) + " (" + str(l[0]["id"]) + ") removed: at most 20 are kept")
		l = l[1:]
	}
	id := randHex16()[:8]
	l = append(l, M{"id": id, "name": cutRunes(name, 60), "hash": keyHash(k), "at": nowS(), "used": ""})
	setPairedBrowsers(l)
	if !cfgB("LegacyKeyRetired") {
		setCfg("LegacyKeyRetired", true)
		setCfg("Key", newBridgeKey()) // the tray icon's own from now on; no page holds it
		writeLog("Paired browsers: the single key of earlier versions is no longer accepted from FinCom's pages")
	}
	saveConfig()
	writeLog("Paired browsers: " + name + " (" + id + ") connected with its own key")
	return k
}

// one browser's key removed; false when there is none of that id
func removeBrowserKey(id, why string) bool {
	browserKeyMu.Lock()
	defer browserKeyMu.Unlock()
	if id == "legacy" {
		if !legacyKeyOpen() {
			return false
		}
		setCfg("LegacyKeyRetired", true)
		setCfg("Key", newBridgeKey())
		saveConfig()
		writeLog("Paired browsers: the single key of earlier versions removed (" + why + ")")
		return true
	}
	l := pairedBrowsers()
	var keep []M
	name := ""
	for _, o := range l {
		if str(o["id"]) == id {
			name = str(o["name"])
			continue
		}
		keep = append(keep, o)
	}
	if name == "" {
		return false
	}
	setPairedBrowsers(keep)
	saveConfig()
	writeLog("Paired browsers: " + name + " (" + id + ") disconnected (" + why + ")")
	return true
}

// every browser's key removed (and the earlier single key)
func removeAllBrowserKeys(why string) int {
	n := len(pairedBrowsers())
	if legacyKeyOpen() {
		n++
	}
	browserKeyMu.Lock()
	setPairedBrowsers(nil)
	setCfg("LegacyKeyRetired", true)
	setCfg("Key", newBridgeKey())
	browserKeyMu.Unlock()
	saveConfig()
	writeLog("Paired browsers: every browser disconnected (" + why + ")")
	return n
}

// the proofs for a page: one per paired browser, over its key's SHA-256
func browserProofs(nonce, bound string) []any {
	out := []any{}
	for _, o := range pairedBrowsers() {
		if p := proofFor(str(o["hash"]), nonce, bound); p != "" {
			out = append(out, p)
		}
	}
	return out
}

// GET /tray/browsers: the paired browsers (never a key or hash); POST {remove: id | "all"}
func trayBrowsersRoute(method string, body M) (M, error) {
	if method == "POST" {
		id := str(body["remove"])
		if id == "all" {
			return M{"ok": true, "removed": removeAllBrowserKeys("the owner, in the tray icon")}, nil
		}
		if !removeBrowserKey(id, "the owner, in the tray icon") {
			return M{"ok": false, "error": "That browser is not connected to this bridge."}, nil
		}
		return M{"ok": true, "removed": 1}, nil
	}
	list := []any{}
	browserUsed.Lock()
	for _, o := range pairedBrowsers() {
		used := str(o["used"])
		if t, ok := browserUsed.at[str(o["id"])]; ok {
			used = t.Format("2006-01-02T15:04:05")
		}
		list = append(list, M{"id": o["id"], "name": o["name"], "at": o["at"], "used": used})
	}
	browserUsed.Unlock()
	if legacyKeyOpen() {
		list = append(list, M{"id": "legacy", "name": "FinCom paired before 2.5.16 (one key for every browser)", "at": "", "used": ""})
	}
	return M{"ok": true, "browsers": list}, nil
}
