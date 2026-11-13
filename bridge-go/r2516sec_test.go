package main

// FinCom Bridge 2.5.16, the security review's lows: L3 (the FVU's Class-Path read as Java reads it, percent-encoding
// decoded; a jar it loads that names jars of its own refused), L4 (the tray's routes take the tray's own proof only).

import (
	"archive/zip"
	"bytes"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func r2516JarWith(t *testing.T, path, cp string) {
	t.Helper()
	var b bytes.Buffer
	z := zip.NewWriter(&b)
	w, _ := z.Create("META-INF/MANIFEST.MF")
	m := "Manifest-Version: 1.0\r\n"
	if cp != "" {
		m += "Class-Path: " + cp + "\r\n"
	}
	_, _ = w.Write([]byte(m))
	_ = z.Close()
	_ = os.MkdirAll(filepath.Dir(path), 0o755)
	if err := os.WriteFile(path, b.Bytes(), 0o644); err != nil {
		t.Fatal(err)
	}
}

func TestR2516FvuClassPathDecodedAndOneLevel(t *testing.T) {
	dir := t.TempDir()
	jar := filepath.Join(dir, "fvu", "FVU_STANDALONE.jar")
	r2516JarWith(t, filepath.Join(dir, "fvu", "lib", "a.jar"), "")
	for _, bad := range []string{"%2e%2e/x.jar", "lib/%2e%2e/%2e%2e/x.jar", "%2Fabs/x.jar", "file%3A/x.jar", "lib/a%zz.jar", "lib/%252e%252e/x.jar"} {
		r2516JarWith(t, jar, bad)
		if _, err := fvuClassPath(jar); err == nil {
			t.Errorf("Class-Path %s taken", bad)
		}
	}
	r2516JarWith(t, jar, "lib/a%2Ejar")
	if cp, err := fvuClassPath(jar); err != nil || len(cp) != 1 || filepath.ToSlash(cp[0]) != "lib/a.jar" {
		t.Fatalf("a plain encoded name: %v %v", cp, err)
	}
	// a jar the FVU loads that names further jars: refused
	r2516JarWith(t, filepath.Join(dir, "fvu", "lib", "a.jar"), "b.jar")
	r2516JarWith(t, jar, "lib/a.jar")
	if _, err := fvuClassPath(jar); err == nil || !strings.Contains(err.Error(), "names further jars") {
		t.Fatalf("a dependency with its own Class-Path: %v", err)
	}
	if _, err := fvuFingerprint(jar); err == nil {
		t.Fatal("fingerprinted")
	}
}

func TestR2516TrayRoutesNeedTheTrayProof(t *testing.T) {
	f := newStandTally(t)
	standBridge(t, f, `,"Key":"tray-own-key"`)
	browser := addBrowserKey("a browser")
	for _, k := range []string{browser, "tray-own-key"} {
		r := httptest.NewRequest("GET", "http://127.0.0.1:9100/tray/status", nil)
		r.Header.Set("X-Bridge-Key", k)
		w := httptest.NewRecorder()
		handle(w, r)
		if w.Code != 401 {
			t.Fatalf("/tray/status with a key (not the tray's proof): %d", w.Code)
		}
	}
	r := httptest.NewRequest("GET", "http://127.0.0.1:9100/tray/status", nil)
	trayOrKey(r)
	w := httptest.NewRecorder()
	handle(w, r)
	if w.Code != 200 {
		t.Fatalf("/tray/status with the tray's proof: %d %s", w.Code, w.Body.String())
	}
	// a browser's key still works for the page's own routes
	r = httptest.NewRequest("GET", "http://127.0.0.1:9100/status", nil)
	r.Header.Set("X-Bridge-Key", browser)
	w = httptest.NewRecorder()
	handle(w, r)
	if w.Code != 200 {
		t.Fatalf("/status with the browser's key: %d", w.Code)
	}
}

// L5: FinCom confirms the earlier link while the person connects FinCom anew: the newer link is kept
func TestR2516PendingLinkNeverOverwritesANewerOne(t *testing.T) {
	const u = "https://qbocskaiewaxqcvaunzc.supabase.co/functions/v1/tally-ingest"
	key := "fcd_" + strings.Repeat("ab", 24)
	dir := t.TempDir()
	r2515LogHere(t, dir)
	old := pendingCheckFn
	t.Cleanup(func() {
		pendingCheckFn = old
		setCfg("CloudUrl", "")
		setCfg("CloudKey", "")
		setCfg("PendingCloudUrl", "")
		setCfg("PendingCloudKey", "")
	})
	setCfg("CloudUrl", "")
	setCfg("CloudKey", "")
	setCfg("PendingCloudUrl", u)
	setCfg("PendingCloudKey", key)
	pendingMu.Lock()
	pendingAsked = time.Time{}
	pendingMu.Unlock()
	pendingCheckFn = func(string, string, M) (int, M) {
		setCfg("CloudUrl", u) // the person connected FinCom meanwhile: a new key
		setCfg("CloudKey", "new-key-made-meanwhile")
		return 200, M{"ok": true, "known": true}
	}
	if got := checkPendingCloud(); got != "dropped" {
		t.Fatalf("checkPendingCloud: %s", got)
	}
	if cfgS("CloudKey") != "new-key-made-meanwhile" || cfgS("PendingCloudKey") != "" {
		t.Fatalf("the newer link overwritten: %q, pending %q", cfgS("CloudKey"), cfgS("PendingCloudKey"))
	}
}
