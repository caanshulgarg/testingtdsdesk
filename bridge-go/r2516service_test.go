package main

// FinCom Bridge 2.5.16, item 2: the Windows service's settings. The service keeps its own folder (made and given its
// permissions by the elevated steps: servicestate_windows.go) and keeps fixed, whatever the settings file says: only its
// owner's own Tally, its owner as the install recorded it, Tally on this computer, no development origins, and its log,
// copy and postings folders inside its own folder. The earlier folder's plain files are copied over once. Nothing here
// asks anything of Tally. Made-up names only.
import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

func r2516AsService(t *testing.T) {
	was, wo, wh := runMode, serviceOwnerFn, serviceOldHomeFn
	t.Cleanup(func() { runMode, serviceOwnerFn, serviceOldHomeFn = was, wo, wh })
	runMode = "service"
	serviceOwnerFn = func() (string, string) { return `PC-MADEUP\owner`, "S-1-5-21-100-200-300-1001" }
	serviceOldHomeFn = func(sid string) string { return "/profiles/owner/AppData/Local/TDS Desk Bridge" }
}

// the service's fixed settings, whatever the file says, at the start and when the file changes while it runs
func TestR2516ServiceSettingsFixed(t *testing.T) {
	dir := t.TempDir()
	r2516AsService(t)
	oldC, oldH := ConfigPath, Home
	t.Cleanup(func() { durableWaitAll(); ConfigPath, Home = oldC, oldH; runMode = "window"; loadConfigRO() })
	ConfigPath, Home = filepath.Join(dir, "tds-bridge.config.json"), dir
	file := `{"OnlyMySession": false, "OwnerSid": "S-1-5-21-9-9-9-500", "Owner": "PC-MADEUP\\someone", "TallyHost": "192.0.2.7",
	 "DevOrigins": true, "LogFile": "/var/elsewhere/x.log", "SyncDir": "/var/elsewhere/sync", "JobsDir": "..", "PsHome": "/var/elsewhere"}`
	_ = os.WriteFile(ConfigPath, []byte(file), 0o644)
	loadConfig()
	check := func(when string) {
		t.Helper()
		if !onlyMySession() || cfgB("OnlyMySession") != true || cfgS("OwnerSid") != "S-1-5-21-100-200-300-1001" || cfgS("Owner") != `PC-MADEUP\owner` ||
			cfgS("TallyHost") != "127.0.0.1" || cfgB("DevOrigins") {
			t.Fatalf("%s: OnlyMySession %v OwnerSid %q Owner %q TallyHost %q DevOrigins %v", when, cfg("OnlyMySession"), cfgS("OwnerSid"), cfgS("Owner"), cfgS("TallyHost"), cfg("DevOrigins"))
		}
		if logFile() != filepath.Join(dir, "x.log") || syncDir() != filepath.Join(dir, "sync") || jobsDir() != filepath.Join(dir, "jobs") || psHome() != "/profiles/owner/AppData/Local/TDS Desk Bridge" {
			t.Fatalf("%s: log %q sync %q jobs %q psHome %q", when, logFile(), syncDir(), jobsDir(), psHome())
		}
	}
	check("at the start")
	_ = os.WriteFile(ConfigPath, []byte(file), 0o644)
	later := time.Now().Add(5 * time.Second)
	_ = os.Chtimes(ConfigPath, later, later)
	syncConfig()
	check("the file changed while running")
	setCfg("OnlyMySession", false)
	if !onlyMySession() {
		t.Fatal("only my own Tally is not fixed for the service")
	}
}

// a bridge that is not the service: the settings as they are
func TestR2516NotServiceSettingsAsSet(t *testing.T) {
	dir := t.TempDir()
	was := runMode
	runMode = "user"
	oldC, oldH := ConfigPath, Home
	t.Cleanup(func() { durableWaitAll(); runMode = was; ConfigPath, Home = oldC, oldH; loadConfigRO() })
	ConfigPath, Home = filepath.Join(dir, "tds-bridge.config.json"), dir
	_ = os.WriteFile(ConfigPath, []byte(`{"OnlyMySession": false, "LogFile": "`+filepath.ToSlash(filepath.Join(dir, "own.log"))+`"}`), 0o644)
	loadConfig()
	if onlyMySession() || logFile() != filepath.Join(dir, "own.log") {
		t.Fatalf("user mode: %v %q", onlyMySession(), logFile())
	}
}

// the earlier folder's plain files copied once; links, junctions, files with two names and the logs are not
func TestR2516ServiceStateCopied(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("links made the Unix way")
	}
	base := t.TempDir()
	old, dst, outside := filepath.Join(base, "old"), filepath.Join(base, "new"), filepath.Join(base, "outside")
	for _, d := range []string{filepath.Join(old, "sync", "ZZ HERON CO"), dst, outside} {
		_ = os.MkdirAll(d, 0o755)
	}
	_ = os.WriteFile(filepath.Join(old, "tds-bridge.config.json"), []byte(`{"Port": 9100}`), 0o644)
	_ = os.WriteFile(filepath.Join(old, "sync", "ZZ HERON CO", "manifest.json"), []byte(`{}`), 0o644)
	_ = os.WriteFile(filepath.Join(old, "tds-bridge.log"), []byte("log"), 0o644)
	_ = os.WriteFile(filepath.Join(old, "tds-bridge.log.2026-11-12"), []byte("log"), 0o644)
	_ = os.WriteFile(filepath.Join(outside, "secret.txt"), []byte("not the bridge's"), 0o644)
	_ = os.Symlink(filepath.Join(outside, "secret.txt"), filepath.Join(old, "sync", "link.json"))
	_ = os.Symlink(outside, filepath.Join(old, "jobs"))
	_ = os.Link(filepath.Join(outside, "secret.txt"), filepath.Join(old, "two-names.json"))
	var lines []string
	log := func(s string) { lines = append(lines, s) }
	t.Cleanup(durableWaitAll)
	if err := copyServiceHome(osTree{}, old, dst, log); err != nil {
		t.Fatal(err)
	}
	// the settings file never goes with the folder (serviceSettingsFrom takes its plain choices)
	if exists(filepath.Join(dst, "tds-bridge.config.json")) || !exists(filepath.Join(dst, "sync", "ZZ HERON CO", "manifest.json")) {
		t.Fatalf("plain files not copied: %v", lines)
	}
	for _, n := range []string{"tds-bridge.log", "tds-bridge.log.2026-11-12", filepath.Join("sync", "link.json"), "jobs", "two-names.json"} {
		if _, err := os.Lstat(filepath.Join(dst, n)); err == nil {
			t.Fatalf("%s was copied", n)
		}
	}
	if !strings.Contains(strings.Join(lines, "\n"), "left out") || !exists(filepath.Join(dst, serviceCopiedMarker)) {
		t.Fatalf("lines %v", lines)
	}
	// once: a later change of the old folder is not copied again
	_ = os.WriteFile(filepath.Join(old, "late.json"), []byte(`{}`), 0o644)
	_ = copyServiceHome(osTree{}, old, dst, log)
	if exists(filepath.Join(dst, "late.json")) {
		t.Fatal("copied a second time")
	}
	if underHome("../../x", "jobs") != filepath.Join(Home, "x") || underHome("..", "jobs") != filepath.Join(Home, "jobs") || underHome(`C:\Users\x\AppData\go-sync`, "sync") != filepath.Join(Home, "go-sync") {
		t.Fatal("underHome")
	}
}

// the service's folder: SYSTEM and Administrators change it; its owner may only read it
func TestR2516ServiceStateACL(t *testing.T) {
	got := serviceStateACL("S-1-5-21-100-200-300-1001")
	want := "/reset | /inheritance:r /grant:r *S-1-5-18:(OI)(CI)F *S-1-5-32-544:(OI)(CI)F *S-1-5-21-100-200-300-1001:(OI)(CI)RX | /setowner *S-1-5-32-544"
	var parts []string
	for _, c := range got {
		parts = append(parts, strings.Join(c, " "))
	}
	if strings.Join(parts, " | ") != want {
		t.Fatalf("got %q", strings.Join(parts, " | "))
	}
	for _, c := range append(got, serviceStateACL("")...) {
		for _, a := range c {
			if strings.Contains(a, ":(OI)(CI)M") || strings.Contains(a, ":(OI)(CI)W") || (strings.Contains(a, "S-1-5-32-545") && !strings.HasSuffix(a, "RX")) {
				t.Fatalf("a grant that lets a user change it: %s", a)
			}
		}
	}
}

// from a settings file the service does not protect, only the plain choices; the link to FinCom, the keys, the FVU,
// the update address and the paired browsers are not taken (their names logged, never their values)
func TestR2516ServiceSettingsAllowList(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "tds-bridge.config.json")
	_ = os.WriteFile(p, []byte(`{"Port": 9104, "InstanceId": "abcdef0123456789", "KeepDailyAt": "21:30", "Key": "keyvalue-not-taken",
	 "CloudUrl": "https://example.invalid", "CloudKey": "fcd_valuenottaken", "UpdateUrl": "https://example.invalid/u", "FvuJar": "C:\\x\\y.jar",
	 "FvuJarSha256": "00", "JavaExe": "C:\\x\\java.exe", "FvuOut": "C:\\x", "PairedBrowsers": [{"id": "a"}], "PostOnly": [], "TallyMaxSec": 99}`), 0o644)
	var lines []string
	c := serviceSettingsFrom(osTree{}, p, func(s string) { lines = append(lines, s) })
	if toInt(c.Get("Port")) != 9104 || str(c.Get("InstanceId")) != "abcdef0123456789" || str(c.Get("KeepDailyAt")) != "21:30" {
		t.Fatalf("plain choices not kept: %v", c.keys)
	}
	for _, k := range []string{"CloudUrl", "CloudKey", "UpdateUrl", "FvuJar", "FvuJarSha256", "JavaExe", "FvuOut", "PostOnly", "TallyMaxSec"} {
		if c.Has(k) {
			t.Errorf("%s taken", k)
		}
	}
	// the browsers' keys go on working; the link to FinCom waits for FinCom (here not FinCom's address: none)
	if str(c.Get("Key")) != "keyvalue-not-taken" || !c.Has("PairedBrowsers") || c.Has("PendingCloudKey") {
		t.Fatalf("keys: %v", c.keys)
	}
	l := strings.Join(lines, "\n")
	if !strings.Contains(l, "UpdateUrl") || strings.Contains(l, "valuenottaken") || strings.Contains(l, "keyvalue") {
		t.Fatalf("log: %s", l)
	}
	if c := serviceSettingsFrom(osTree{}, filepath.Join(dir, "none.json"), func(string) {}); len(c.keys) != 0 {
		t.Fatal("a missing file gave settings")
	}
}

// the copy stops at its limits, and leaves device names and the settings files out
func TestR2516ServiceCopyCapped(t *testing.T) {
	base := t.TempDir()
	old, dst := filepath.Join(base, "old"), filepath.Join(base, "new")
	_ = os.MkdirAll(old, 0o755)
	_ = os.MkdirAll(dst, 0o755)
	for i := 0; i < 10; i++ {
		_ = os.WriteFile(filepath.Join(old, "f"+itoa(i)+".json"), []byte(strings.Repeat("x", 100)), 0o644)
	}
	_ = os.WriteFile(filepath.Join(old, "tds-bridge.config.json.bak"), []byte("{}"), 0o644)
	_ = os.WriteFile(filepath.Join(old, "CON.json"), []byte("x"), 0o644)
	ob, of := serviceCopyMaxBytes, serviceCopyMaxFiles
	t.Cleanup(func() { serviceCopyMaxBytes, serviceCopyMaxFiles = ob, of; durableWaitAll() })
	serviceCopyMaxBytes = 450
	var lines []string
	if err := copyServiceHome(osTree{}, old, dst, func(s string) { lines = append(lines, s) }); err != nil {
		t.Fatal(err)
	}
	m, _ := filepath.Glob(filepath.Join(dst, "f*.json"))
	if len(m) != 4 || exists(filepath.Join(dst, "tds-bridge.config.json.bak")) || exists(filepath.Join(dst, "CON.json")) || !strings.Contains(strings.Join(lines, " "), "the rest") {
		t.Fatalf("copied %d, lines %v", len(m), lines)
	}
	for _, n := range []string{"CON", "nul.txt", "COM1.log", "lpt9", "Con .x"} {
		if !winDeviceName(n) {
			t.Errorf("%s is a device name", n)
		}
	}
	for _, n := range []string{"CONS", "COM10", "console.txt", "sync"} {
		if winDeviceName(n) {
			t.Errorf("%s is not a device name", n)
		}
	}
}

// the link to FinCom from the earlier settings: kept apart, and taken only when FinCom confirms it; refused: dropped
// (connect again); FinCom not reached: asked again later, never used meanwhile
func TestR2516PendingCloudLink(t *testing.T) {
	const u = "https://qbocskaiewaxqcvaunzc.supabase.co/functions/v1/tally-ingest"
	key := "fcd_" + strings.Repeat("ab", 24)
	dir := t.TempDir()
	p := filepath.Join(dir, "old.json")
	_ = os.WriteFile(p, []byte(`{"CloudUrl": "`+u+`", "CloudKey": "`+key+`", "InstanceId": "abcdef0123456789"}`), 0o644)
	c := serviceSettingsFrom(osTree{}, p, func(string) {})
	if str(c.Get("PendingCloudUrl")) != u || str(c.Get("PendingCloudKey")) != key || c.Has("CloudKey") {
		t.Fatalf("not kept apart: %v", c.keys)
	}
	r2515LogHere(t, dir)
	old := pendingCheckFn
	t.Cleanup(func() { pendingCheckFn = old })
	var asked []M
	answer := func(code int, j M) {
		pendingCheckFn = func(gu, gk string, b M) (int, M) {
			if gu != u || gk != key || str(b["kind"]) != "key_check" || obj(b["bridge"])["id"] == nil {
				t.Fatalf("asked %s %s %v", gu, gk, b)
			}
			asked = append(asked, b)
			return code, j
		}
	}
	set := func() {
		setCfg("CloudUrl", "")
		setCfg("CloudKey", "")
		setCfg("PendingCloudUrl", u)
		setCfg("PendingCloudKey", key)
		pendingMu.Lock()
		pendingAsked = time.Time{}
		pendingMu.Unlock()
	}
	// not reached, busy, an older cloud: later; nothing used
	for _, a := range []struct {
		code int
		j    M
	}{{0, nil}, {503, M{"busy": true}}, {400, M{"ok": false, "error": "unknown kind"}}, {409, M{"ok": false, "notReady": true}}} {
		set()
		answer(a.code, a.j)
		if r := checkPendingCloud(); r != "later" || cloudOn() || cfgS("PendingCloudKey") == "" {
			t.Fatalf("%d: %s, cloudOn %v", a.code, r, cloudOn())
		}
	}
	// asked at most every two minutes
	n := len(asked)
	if checkPendingCloud(); len(asked) != n {
		t.Fatal("asked again at once")
	}
	// refused: dropped
	for _, a := range []struct {
		code int
		j    M
	}{{200, M{"ok": true, "known": false}}, {401, M{"ok": false}}, {409, M{"ok": false, "idRefused": true}}} {
		set()
		answer(a.code, a.j)
		if r := checkPendingCloud(); r != "dropped" || cloudOn() || cfgS("PendingCloudKey") != "" {
			t.Fatalf("%d: %s", a.code, r)
		}
	}
	// confirmed: the link, nothing to do
	set()
	answer(200, M{"ok": true, "known": true})
	if r := checkPendingCloud(); r != "taken" || !cloudOn() || cloudKey() != key || cfgS("CloudUrl") != u || cfgS("PendingCloudKey") != "" {
		t.Fatalf("confirmed: %s", r)
	}
}
