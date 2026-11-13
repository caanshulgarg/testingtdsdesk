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

// the re-review: the setup (elevated, not the owner) could not read the owner's earlier settings and made a new id,
// key and port; the service's first start reads them with the owner's rights: the earlier id, keys, browsers, port
// and link win, nothing is connected again; a note naming another folder is never read
func TestR2516DeferredEarlierSettingsKeepTheLinks(t *testing.T) {
	const u = "https://qbocskaiewaxqcvaunzc.supabase.co/functions/v1/tally-ingest"
	key := "fcd_" + strings.Repeat("cd", 24)
	old := t.TempDir()
	f := filepath.Join(old, "tds-bridge.config.json")
	_ = os.WriteFile(f, []byte(`{"InstanceId": "0123456789abcdef", "Key": "earlier-key", "PairedBrowsers": [{"id": "b1", "sha": "s1"}], "Port": 9104,
	 "KeepDailyAt": "21:30", "CloudUrl": "`+u+`", "CloudKey": "`+key+`", "FinComUrl": "https://example.invalid/"}`), 0o644)
	cur := newOrdered() // as the setup wrote it, the earlier file not read
	cur.Set("InstanceId", "fedcba9876543210")
	cur.Set("Port", 9100)
	cur.Set("Key", "made-by-setup")
	cur.Set("FinComUrl", "https://app.fincom.live/")
	cur.Set("KeepDailyAt", "02:00")
	cur.Set(earlierSettingsKey, f)
	var lines []string
	if !applyEarlierSettings(osTree{}, cur, old, func(s string) { lines = append(lines, s) }) {
		t.Fatal("not applied")
	}
	if str(cur.Get("InstanceId")) != "0123456789abcdef" || str(cur.Get("Key")) != "earlier-key" || toInt(cur.Get("Port")) != 9104 || !cur.Has("PairedBrowsers") {
		t.Fatalf("the bridge's id, key, port or browsers lost: %v", cur.vals)
	}
	if str(cur.Get("PendingCloudUrl")) != u || str(cur.Get("PendingCloudKey")) != key || cur.Has("CloudKey") {
		t.Fatalf("the link to FinCom: %v", cur.vals)
	}
	if str(cur.Get("FinComUrl")) != "https://app.fincom.live/" || str(cur.Get("KeepDailyAt")) != "02:00" || cur.Has(earlierSettingsKey) {
		t.Fatalf("the setup's own choices, or the note: %v", cur.vals)
	}
	// a note naming a file outside the owner's earlier folder: dropped, nothing read
	other := newOrdered()
	other.Set("InstanceId", "fedcba9876543210")
	other.Set(earlierSettingsKey, f)
	if !applyEarlierSettings(osTree{}, other, t.TempDir(), func(string) {}) || str(other.Get("InstanceId")) != "fedcba9876543210" || other.Has(earlierSettingsKey) {
		t.Fatalf("another folder's file read: %v", other.vals)
	}
	if applyEarlierSettings(osTree{}, newOrdered(), old, func(string) {}) {
		t.Fatal("applied with no note")
	}
}
