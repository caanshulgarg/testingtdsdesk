//go:build !windows

package main

// FinCom Bridge 2.5.16, item 4: the bridge key changes at every pairing (the earlier key is no longer accepted), and
// the owner can make a new one from the tray icon; FinCom's own sites only, by build (the live build: the live site;
// the staging build: the staging site too; no other site); a refused web page's request is logged at most once in ten
// minutes and the refusal lines of a day are capped. Nothing here asks anything of Tally. Made-up names only.
import (
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// a pairing's answer carries a new key, the one now kept (never the key before)
func r2516NewKey(r M) bool {
	k := str(r["key"])
	return k != "" && k != "k246" && k == cfgS("Key") && len(k) == 24
}

// the key before pairing is refused after it; the new one works; a second pairing replaces it again
func TestR2516PairingMakesNewKey(t *testing.T) {
	p := newPairStand(t, "")
	if r := p.call("GET", "/status", nil); r["ok"] != true {
		t.Fatalf("the key before pairing: %v", r)
	}
	_, secret, _ := freshPairCode(10)
	c, r := p.pair(secret)
	if c != 200 || !r2516NewKey(r) {
		t.Fatalf("pairing: %d %v", c, r)
	}
	first := str(r["key"])
	if r := p.call("GET", "/status", nil); r["ok"] == true {
		t.Fatal("the key before pairing still works")
	}
	call := func(key string) int {
		q := httptest.NewRequest("GET", "http://127.0.0.1:9100/status", nil)
		q.RemoteAddr = "127.0.0.1:50125"
		q.Header.Set("X-Bridge-Key", key)
		w := httptest.NewRecorder()
		handle(w, q)
		return w.Code
	}
	if call(first) != 200 {
		t.Fatal("the new key does not work")
	}
	_, secret, _ = freshPairCode(10)
	if c, r := p.pair(secret); c != 200 || !r2516NewKey(r) || str(r["key"]) == first {
		t.Fatalf("second pairing: %d %v", c, r)
	}
	if call(first) == 200 {
		t.Fatal("the first pairing's key still works after the second")
	}
	// kept in the settings file (a restart keeps the new key)
	loadConfig()
	if call(cfgS("Key")) != 200 || cfgS("Key") == first {
		t.Fatal("the new key is not kept")
	}
}

// the tray icon's "Disconnect FinCom": a new key, nothing paired with the old one
func TestR2516TrayNewKey(t *testing.T) {
	newPairStand(t, "")
	r, err := trayNewKeyRoute("POST")
	if err != nil || r["ok"] != true || cfgS("Key") == "k246" || len(cfgS("Key")) != 24 || str(r["key"]) != "" {
		t.Fatalf("new key: %v %v (the answer never carries the key)", r, err)
	}
	if _, err := trayNewKeyRoute("GET"); err == nil {
		t.Fatal("GET made a new key")
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
