package main

import (
	"archive/zip"
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// the tooltip: the mode first, one line, at most 127 characters
func TestTrayTip(t *testing.T) {
	v := BridgeVersion
	good := M{"version": v, "tallyOpen": true, "cloudConnected": true, "online": true}
	cases := []struct {
		st   M
		want string
	}{
		{nil, "FinCom Bridge " + v + " - not running"},
		{M{"version": v, "testMode": true, "tallyOpen": true, "cloudConnected": true, "online": true}, "FinCom Bridge " + v + " - Test mode: reading only, not posting"},
		{good, "FinCom Bridge " + v + " - Main bridge: reading and posting"},
		{M{"version": v, "testMode": true, "paused": true}, "FinCom Bridge " + v + " - Test mode: reading only, not posting - Paused"},
		{M{"version": v, "cloudConnected": true, "online": true}, "FinCom Bridge " + v + " - Main bridge: reading and posting - Tally not open"},
		{M{"version": v, "tallyOpen": true}, "FinCom Bridge " + v + " - Main bridge: reading and posting - not connected to FinCom"},
		{M{"version": v, "readOnly": "Bridge 1.15.0 is still here", "tallyOpen": true, "cloudConnected": true, "online": true}, "FinCom Bridge " + v + " - Main bridge: reading only, not posting (see Status)"},
	}
	for _, c := range cases {
		if got := trayTip(c.st); got != c.want {
			t.Errorf("tooltip %v:\n got  %q\n want %q", c.st, got, c.want)
		}
	}
	long := M{"version": strings.Repeat("9", 200), "testMode": true}
	if got := trayTip(long); len([]rune(got)) > 127 || strings.Contains(got, "\n") {
		t.Fatalf("tooltip too long or not one line: %d", len([]rune(got)))
	}
}

// this install's id: made once, kept in the settings, the same at the next start; carried into the settings of sole mode
func TestInstanceIdKept(t *testing.T) {
	dir := t.TempDir()
	oldC, oldH := ConfigPath, Home
	defer func() { ConfigPath, Home = oldC, oldH; loadConfigRO() }()
	ConfigPath, Home = filepath.Join(dir, "go-bridge.config.json"), dir
	_ = os.WriteFile(ConfigPath, []byte(`{"Mode":"test","Port":9101}`), 0o644)
	loadConfig()
	id := cfgS("InstanceId")
	if !validInstanceID(id) {
		t.Fatalf("no id made: %q", id)
	}
	if !strings.Contains(readText(ConfigPath), id) {
		t.Fatal("the id was not written to the settings")
	}
	loadConfig()
	if cfgS("InstanceId") != id || instanceID() != id {
		t.Fatal("the id changed at the next start")
	}
	b := bridgeIdentity()
	if b["id"] != "go-"+id || b["mode"] != "test" || b["version"] != BridgeVersion || b["runMode"] == "" {
		t.Fatalf("identity %v", b)
	}
	// switched to main: bridge 1.15.0's settings take the test install's id
	sole := newOrdered()
	sole.Set("Key", "k")
	carryInstanceID(sole, filepath.Join(dir, "missing.json"), ConfigPath)
	if str(sole.Get("InstanceId")) != id {
		t.Fatalf("not carried: %v", sole.Get("InstanceId"))
	}
	// one already there stays
	keep := newOrdered()
	keep.Set("InstanceId", "0123456789ab")
	carryInstanceID(keep, ConfigPath)
	if str(keep.Get("InstanceId")) != "0123456789ab" {
		t.Fatal("an id already there was replaced")
	}
	fresh := newOrdered()
	carryInstanceID(fresh)
	if !validInstanceID(str(fresh.Get("InstanceId"))) || str(fresh.Get("InstanceId")) == id {
		t.Fatal("a new install got no id of its own")
	}
}

// sendlog: the settings go without any key's value
func TestSettingsWithoutKeys(t *testing.T) {
	in := `{"Port":9100,"Key":"AbCdEfGh12345678","CloudUrl":"https://x.supabase.co/functions/v1/tally-ingest","CloudKey":"dpapi:SECRETVALUE1","CloudKeyGo":"dpapim:SECRETVALUE2","KeepInStep":true,"Owner":"PC\\anshul"}`
	out := settingsWithoutKeys(in)
	for _, s := range []string{"AbCdEfGh12345678", "SECRETVALUE1", "SECRETVALUE2"} {
		if strings.Contains(out, s) {
			t.Fatalf("a key went out: %s", out)
		}
	}
	for _, s := range []string{`"Port": 9100`, `"CloudUrl"`, `"KeepInStep": true`, `"Key": "(removed)"`, `"Owner"`} {
		if !strings.Contains(out, s) {
			t.Fatalf("missing %s in %s", s, out)
		}
	}
	if lastLines("a\nb\nc\nd", 2) != "c\r\nd" {
		t.Fatal("last lines")
	}
}

// the support pack: the install log, the bridge log's end, the settings without keys
func TestSupportZip(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("LOCALAPPDATA", dir)
	t.Setenv("ProgramData", "")
	_ = os.MkdirAll(filepath.Join(dir, "FinCom Bridge"), 0o755)
	_ = os.WriteFile(filepath.Join(dir, "FinCom Bridge", "install.log"), []byte("2026-10-02 10:00:00  Install: started\r\n"), 0o644)
	cfgF := filepath.Join(dir, "go-bridge.config.json")
	_ = os.WriteFile(cfgF, []byte(`{"Key":"TOPSECRETKEY123","CloudKey":"plain:fcd_x"}`), 0o644)
	logF := filepath.Join(dir, "go-bridge.log")
	var lines []string
	for i := 0; i < 400; i++ {
		lines = append(lines, "line")
	}
	_ = os.WriteFile(logF, []byte(strings.Join(lines, "\r\n")), 0o644)
	b, err := supportZip([]string{cfgF}, logF)
	if err != nil {
		t.Fatal(err)
	}
	zr, _ := zip.NewReader(bytes.NewReader(b), int64(len(b)))
	got := map[string]string{}
	for _, f := range zr.File {
		r, _ := f.Open()
		var buf bytes.Buffer
		_, _ = buf.ReadFrom(r)
		got[f.Name] = buf.String()
	}
	if !strings.Contains(got["install.log"], "Install: started") || strings.Count(got["bridge-log-last-300-lines.txt"], "line") != 300 {
		t.Fatalf("pack: %v", len(got))
	}
	if s := got["settings-go-bridge.config.json"]; s == "" || strings.Contains(s, "TOPSECRETKEY123") || strings.Contains(s, "fcd_x") {
		t.Fatalf("settings in the pack: %q", s)
	}
	if got["about.txt"] == "" {
		t.Fatal("no about.txt")
	}
}

// install-result.txt: "ok", or what went wrong and what to do, one line each
func TestInstallResultText(t *testing.T) {
	if installResultText("", "") != "ok\r\n" {
		t.Fatal("ok")
	}
	got := installResultText("The service did not start\n(error 5).", "Restart the computer.")
	if got != "The service did not start (error 5).\r\nRestart the computer.\r\n" {
		t.Fatalf("%q", got)
	}
	if l := strings.Split(installResultText("x", ""), "\r\n"); len(l) != 3 || l[1] == "" {
		t.Fatalf("no advice: %q", l)
	}
	dir := t.TempDir()
	t.Setenv("LOCALAPPDATA", dir)
	writeInstallResult("", "")
	if readText(filepath.Join(dir, "FinCom Bridge", "install-result.txt")) != "ok\r\n" {
		t.Fatal("not written")
	}
}

// uninstall: only the bridge's own files go; the pairing stays when asked; bridge 1.15.0's files never go
func TestRemoveOwnFiles(t *testing.T) {
	mk := func(dir string, files ...string) {
		for _, f := range files {
			_ = os.MkdirAll(filepath.Dir(filepath.Join(dir, f)), 0o755)
			_ = os.WriteFile(filepath.Join(dir, f), []byte(`{"Key":"k1","CloudUrl":"u","CloudKey":"dpapi:a","CloudKeyGo":"dpapim:b","Port":9101}`), 0o644)
		}
	}
	// test mode beside bridge 1.15.0, pairing kept
	d := t.TempDir()
	mk(d, "TDSBridge.ps1", "tds-bridge.config.json", "tds-bridge.log", "sync/Co/keep.json", "sync/Co/shadow-recheck.json",
		"go-sync/Co/keep.json", "go-jobs/j/x.json", "go-bridge.log", "go-bridge.log.1", "go-bridge.config.json", "compare-report.txt")
	gone := removeOwnFiles(d, "test", true)
	for _, f := range []string{"go-sync", "go-jobs", "go-bridge.log", "go-bridge.log.1", "compare-report.txt", "sync/Co/shadow-recheck.json"} {
		if exists(filepath.Join(d, f)) {
			t.Errorf("%s not removed", f)
		}
	}
	for _, f := range []string{"TDSBridge.ps1", "tds-bridge.config.json", "tds-bridge.log", "sync/Co/keep.json", "go-bridge.config.json"} {
		if !exists(filepath.Join(d, f)) {
			t.Errorf("%s removed", f)
		}
	}
	kept := newOrdered()
	_ = kept.UnmarshalText(readText(filepath.Join(d, "go-bridge.config.json")))
	if strings.Join(kept.keys, ",") != "Key,CloudUrl,CloudKey" || str(kept.Get("CloudKey")) != "dpapim:b" {
		t.Fatalf("pairing kept as %v", kept.vals)
	}
	if len(gone) == 0 {
		t.Fatal("nothing said removed")
	}
	// not kept: the settings go
	removeOwnFiles(d, "test", false)
	if exists(filepath.Join(d, "go-bridge.config.json")) {
		t.Fatal("settings kept")
	}
	// sole mode in bridge 1.15.0's folder: its settings (1.15.0's file) stay
	d2 := t.TempDir()
	mk(d2, "TDSBridge.ps1.replaced-by-go", "tds-bridge.config.json")
	removeOwnFiles(d2, "sole", false)
	if !exists(filepath.Join(d2, "tds-bridge.config.json")) {
		t.Fatal("bridge 1.15.0's settings removed")
	}
	// sole mode where bridge 1.15.0 never was: the settings are this bridge's own
	d3 := t.TempDir()
	mk(d3, "tds-bridge.config.json", "sync/Co/keep.json")
	removeOwnFiles(d3, "sole", false)
	if exists(filepath.Join(d3, "tds-bridge.config.json")) || !exists(filepath.Join(d3, "sync/Co/keep.json")) {
		t.Fatal("sole mode without bridge 1.15.0")
	}
}

// Windows 11's tray settings name the program with known folders as ids
func TestSameProgramPath(t *testing.T) {
	env := func(k string) string {
		return map[string]string{"ProgramW6432": `C:\Program Files`, "LOCALAPPDATA": `C:\Users\a\AppData\Local`}[k]
	}
	if !sameProgramPath(`{6D809377-6AF0-444B-8957-A3773F02200E}\FinCom Bridge\FinComBridge.exe`, `C:\Program Files\FinCom Bridge\FinComBridge.exe`, env) {
		t.Fatal("Program Files")
	}
	if !sameProgramPath(`{f1b32785-6fba-4fcf-9d55-7b8e7f157091}\FinCom Bridge\FinComBridge.exe`, `c:\users\A\appdata\local\FinCom Bridge\FinComBridge.exe`, env) {
		t.Fatal("LocalAppData")
	}
	if sameProgramPath(`{6D809377-6AF0-444B-8957-A3773F02200E}\Other\FinComBridge.exe`, `C:\Program Files\FinCom Bridge\FinComBridge.exe`, env) || sameProgramPath("", `x`, env) {
		t.Fatal("another program taken")
	}
}

// Test connection: one line each, in order
func TestConnectionReport(t *testing.T) {
	down := connectionReport(9101, nil, nil)
	if !strings.Contains(down, "NOT ANSWERING on 127.0.0.1:9101") || !strings.Contains(down, "not checked") {
		t.Fatal(down)
	}
	ok := connectionReport(9100, M{"version": "2.1.0"}, M{"tally": M{"ok": true, "ports": []any{"9000"}, "companies": []any{"A Ltd"}}, "cloud": M{"url": true, "key": true, "code": 200, "firm": "Garg & Co"}})
	l := strings.Split(ok, "\n\n")
	if len(l) != 4 || !strings.HasPrefix(l[0], "The bridge on this computer: OK") || !strings.Contains(l[1], "A Ltd") || !strings.Contains(l[2], "Garg & Co") || !strings.HasPrefix(l[3], "Pairing: OK") {
		t.Fatal(ok)
	}
	unpaired := connectionReport(9100, M{"version": "2.1.0"}, M{"tally": M{"ok": false, "error": "port 9000: refused"}, "cloud": M{"url": false}})
	if !strings.Contains(unpaired, "Tally: NOT ANSWERING (port 9000: refused)") || !strings.Contains(unpaired, "Pairing: this computer is not connected") {
		t.Fatal(unpaired)
	}
}
