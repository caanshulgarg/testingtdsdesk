//go:build !windows

package main

// FinCom Bridge 2.5.16, item 4: one key per browser (each pairing adds its own, one removed alone); FinCom's own sites only, by build (the live build: the live site;
// the staging build: the staging site too; no other site); a refused web page's request is logged at most once in ten
// minutes and the refusal lines of a day are capped. Nothing here asks anything of Tally. Made-up names only.
import (
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// a pairing's answer carries this browser's own key (never the single key of earlier versions); only its hash is kept
func r2516NewKey(r M) bool {
	k := str(r["key"])
	return len(k) == 32 && k != "k246" && k != cfgS("Key") && browserKeyID(k) != "" && !strings.Contains(readText(ConfigPath), k)
}

func r2516Req(method, path, key string) *httptest.ResponseRecorder {
	q := httptest.NewRequest(method, "http://127.0.0.1:9100"+path, strings.NewReader("{}"))
	q.RemoteAddr = "127.0.0.1:50128"
	q.Header.Set("X-Bridge-Key", key)
	q.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	handle(w, q)
	return w
}

func r2516Call(path, key, method string) int {
	q := httptest.NewRequest(method, "http://127.0.0.1:9100"+path, strings.NewReader("{}"))
	q.RemoteAddr = "127.0.0.1:50125"
	q.Header.Set("X-Bridge-Key", key)
	q.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	handle(w, q)
	return w.Code
}

// one key per browser: the single key works until the first pairing; each pairing adds its own key; one removed alone
func TestR2516KeyPerBrowser(t *testing.T) {
	newPairStand(t, "")
	if r2516Call("/status", "k246", "GET") != 200 {
		t.Fatal("the single key before any pairing")
	}
	pairAs := func(ua string) string {
		_, secret, _ := freshPairCode(10)
		q := httptest.NewRequest("GET", "http://127.0.0.1:9100/pair?code="+secret, nil)
		q.RemoteAddr = "127.0.0.1:50124"
		q.Header.Set("Origin", "https://staging.fincom.live")
		q.Header.Set("User-Agent", ua)
		w := httptest.NewRecorder()
		handle(w, q)
		r := parseObj(w.Body.String())
		if w.Code != 200 || !r2516NewKey(r) {
			t.Fatalf("pairing: %d %v", w.Code, r)
		}
		return str(r["key"])
	}
	chrome := pairAs("Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/130.0 Safari/537.36")
	if r2516Call("/status", "k246", "GET") == 200 {
		t.Fatal("the single key still works after the first pairing")
	}
	edge := pairAs("Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/130.0 Safari/537.36 Edg/130.0")
	if r2516Call("/status", chrome, "GET") != 200 || r2516Call("/status", edge, "GET") != 200 {
		t.Fatal("both browsers' keys work")
	}
	l, _ := trayBrowsersRoute("GET", nil)
	names := ""
	for _, x := range arr(l["browsers"]) {
		b := obj(x)
		names += str(b["name"]) + "|"
		if b["hash"] != nil || b["key"] != nil || str(b["at"]) == "" {
			t.Fatalf("the list: %v", b)
		}
	}
	if names != "Chrome on this PC|Edge on this PC|" {
		t.Fatalf("names %q", names)
	}
	// the page forgets itself (sign-out): its key only
	if r2516Call("/forget", edge, "POST") != 200 || r2516Call("/status", edge, "GET") == 200 || r2516Call("/status", chrome, "GET") != 200 {
		t.Fatal("forget")
	}
	// the tray removes one by its id
	id := str(obj(arr(l["browsers"])[0])["id"])
	if r, _ := trayBrowsersRoute("POST", M{"remove": id}); r["ok"] != true || r2516Call("/status", chrome, "GET") == 200 {
		t.Fatalf("tray remove: %v", r)
	}
	// kept across a restart
	k := pairAs("Firefox/130.0")
	loadConfig()
	if r2516Call("/status", k, "GET") != 200 || r2516Call("/status", "k246", "GET") == 200 {
		t.Fatal("not kept across a restart")
	}
}

// a page's proof of the bridge: over each paired key's SHA-256; the single key's proof no longer goes to pages
func TestR2516PingProofsPerBrowser(t *testing.T) {
	newPairStand(t, "")
	_, secret, _ := freshPairCode(10)
	q := httptest.NewRequest("GET", "http://127.0.0.1:9100/pair?code="+secret, nil)
	q.RemoteAddr = "127.0.0.1:50124"
	q.Header.Set("Origin", "https://staging.fincom.live")
	w := httptest.NewRecorder()
	handle(w, q)
	key := str(parseObj(w.Body.String())["key"])
	n := "nonce0123456789abcdefXYZ"
	pq := httptest.NewRequest("GET", "http://127.0.0.1:9100/ping?n="+n, nil)
	pq.RemoteAddr = "127.0.0.1:50127"
	pq.Header.Set("Origin", "https://staging.fincom.live")
	pw := httptest.NewRecorder()
	handle(pw, pq)
	p := parseObj(pw.Body.String())
	bound := str(p["bridgeId"]) + itoa(toInt(p["port"]))
	want := proofFor(keyHash(key), n, bound)
	found := false
	for _, x := range arr(p["proofs"]) {
		found = found || str(x) == want
	}
	if !found || p["proof"] != nil {
		t.Fatalf("ping: %v (want %s)", p, want)
	}
}

// the tray icon's Disconnect FinCom (kept): every browser disconnected
func TestR2516TrayNewKey(t *testing.T) {
	newPairStand(t, "")
	r, err := trayNewKeyRoute("POST")
	if err != nil || r["ok"] != true || r2516Call("/status", "k246", "GET") == 200 || len(pairedBrowsers()) != 0 {
		t.Fatalf("new key: %v %v", r, err)
	}
	if _, err := trayNewKeyRoute("GET"); err == nil {
		t.Fatal("GET changed the keys")
	}
}

// FinCom's own sites by build; never a personal github.io site; settings cannot add a site
func TestR2516TrustedSitesByBuild(t *testing.T) {
	newPairStand(t, `,"AllowedOrigins":["https://app.fincom.live","https://staging.fincom.live","https://caanshulgarg.github.io","https://example.com"]`)
	old := buildSite
	t.Cleanup(func() { buildSite = old })
	for _, tc := range []struct {
		site     string
		yes, not []string
	}{
		{"production", []string{"https://app.fincom.live", "https://fincom.live"}, []string{"https://staging.fincom.live", "https://caanshulgarg.github.io", "https://example.com"}},
		{"staging", []string{"https://staging.fincom.live", "https://app.fincom.live"}, []string{"https://caanshulgarg.github.io", "https://example.com"}},
		{"", []string{"https://staging.fincom.live", "https://app.fincom.live"}, []string{"https://caanshulgarg.github.io", "https://example.com"}},
	} {
		buildSite = tc.site
		for _, o := range tc.yes {
			if !allowedOrigin(o) {
				t.Errorf("%q build: %s refused", tc.site, o)
			}
		}
		for _, o := range tc.not {
			if allowedOrigin(o) {
				t.Errorf("%q build: %s allowed", tc.site, o)
			}
			if _, ok := fincomPlainURL(o + "/"); ok {
				t.Errorf("%q build: the tray would open %s", tc.site, o)
			}
		}
	}
	buildSite = "production"
	setCfg("DevOrigins", true)
	setCfg("AllowedOrigins", []any{"http://localhost", "null"})
	if allowedOrigin("http://localhost:5173") || allowedOrigin("null") {
		t.Error("the live build takes development origins")
	}
	setCfg("DevOrigins", false)
	if strings.Contains(readText("config.go")+readText("pairopen.go"), "github.io") {
		t.Error("a github.io site is still named")
	}
}

// a refused web page: logged once in ten minutes per page, and the refusal lines of a day capped
func TestR2516RefusedRequestsLogCapped(t *testing.T) {
	dir := t.TempDir()
	r2515LogHere(t, dir)
	refusedLogReset()
	t.Cleanup(refusedLogReset)
	ask := func(origin string) int {
		q := httptest.NewRequest("GET", "http://127.0.0.1:9100/status", nil)
		q.RemoteAddr = "127.0.0.1:50126"
		q.Header.Set("Origin", origin)
		q.Header.Set("X-Bridge-Key", cfgS("Key"))
		w := httptest.NewRecorder()
		handle(w, q)
		return w.Code
	}
	for i := 0; i < 200; i++ {
		if ask("https://evil.example") != 403 {
			t.Fatal("not refused")
		}
	}
	if n := strings.Count(readText(logFile()), "https://evil.example"); n != 1 {
		t.Fatalf("logged %d times", n)
	}
	// ten minutes later: logged again, with the count of the ones not logged
	refusedNow = func() time.Time { return time.Now().Add(11 * time.Minute) }
	t.Cleanup(func() { refusedNow = time.Now })
	ask("https://evil.example")
	if l := readText(logFile()); strings.Count(l, "https://evil.example") != 2 || !strings.Contains(l, "199 more") {
		t.Fatalf("the log:\n%s", l)
	}
	// many pages: the day's refusal lines stop at the cap, said once
	refusedNow = time.Now
	refusedLogReset()
	before := len(readText(logFile()))
	for i := 0; i < 5000; i++ {
		ask("https://site" + strings.Repeat("x", 80) + itoa(i) + ".example")
	}
	l := readText(logFile())
	if grew := len(l) - before; grew > refusedLogCap+4096 || strings.Count(l, "not logged until tomorrow") != 1 {
		t.Fatalf("the log grew by %d bytes; capped said %d times", grew, strings.Count(l, "not logged until tomorrow"))
	}
	// a very long Origin is cut in the log
	refusedLogReset()
	ask("https://" + strings.Repeat("y", 5000) + ".example")
	if strings.Contains(readText(logFile()), strings.Repeat("y", 300)) {
		t.Fatal("a long Origin went into the log whole")
	}
}
