package main

// bridge 2.5.15, item 3 (the owner's approval of 13-Nov-2026): safe file writes. Every file saveFile writes is flushed to
// the disk before its rename; the files that matter keep one backup (.bak) and are read back from it when the file is
// damaged or missing. Nothing here asks anything of Tally. Made-up names only.
import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
)

// the log in the test's own folder (never the package folder: TestNoLogInPackageFolder)
func r2515LogHere(t *testing.T, dir string) {
	oldC, oldH := ConfigPath, Home
	t.Cleanup(func() { ConfigPath, Home = oldC, oldH; loadConfigRO() })
	ConfigPath, Home = filepath.Join(dir, "tds-bridge.config.json"), dir
	_ = os.WriteFile(ConfigPath, []byte(`{"LogFile":"`+filepath.ToSlash(filepath.Join(dir, "b.log"))+`"}`), 0o644)
	loadConfig()
}

// every write flushed before its rename; nothing temporary left beside the file
func TestR2515SaveFileFlushes(t *testing.T) {
	dir := t.TempDir()
	var n atomic.Int64
	old := syncFileFn
	syncFileFn = func(h *os.File) error { n.Add(1); return h.Sync() }
	t.Cleanup(func() { syncFileFn = old })
	f := filepath.Join(dir, "a", "note.txt")
	if err := saveFile(f, "one"); err != nil || readText(f) != "one" || n.Load() != 1 {
		t.Fatalf("saveFile: %v %q, %d flushes", err, readText(f), n.Load())
	}
	// a flush that fails: the old file stays as it was, nothing temporary left
	syncFileFn = func(h *os.File) error { return errors.New("disk full (stand)") }
	if err := saveFile(f, "two"); err == nil || readText(f) != "one" {
		t.Fatalf("a failed flush replaced the file: %v %q", err, readText(f))
	}
	syncFileFn = old
	if m, _ := filepath.Glob(filepath.Join(dir, "a", "*.tmp")); len(m) != 0 {
		t.Fatalf("temporary files left: %v", m)
	}
}

// a kept file: the one it replaces kept as .bak while whole; a damaged file is read from its .bak and never replaces it
func TestR2515KeptFileBackup(t *testing.T) {
	dir := t.TempDir()
	r2515LogHere(t, dir)
	f := filepath.Join(dir, "keep.json")
	if err := saveJSONBak(f, M{"n": 1}); err != nil || exists(bakOf(f)) {
		t.Fatalf("first write: %v, backup %v", err, exists(bakOf(f)))
	}
	_ = saveJSONBak(f, M{"n": 2})
	if toInt(readObjFile(bakOf(f))["n"]) != 1 || toInt(readObjFile(f)["n"]) != 2 {
		t.Fatalf("backup %q, file %q", readText(bakOf(f)), readText(f))
	}
	_ = os.WriteFile(f, []byte(`{"n": 3, "cut sh`), 0o644) // damaged (a power cut, another program)
	if m := readObjFileBak(f); toInt(m["n"]) != 1 {
		t.Fatalf("the damaged file was not read from its backup: %v", m)
	}
	_ = saveJSONBak(f, M{"n": 4}) // the damaged file is not kept as the backup
	if toInt(readObjFile(bakOf(f))["n"]) != 1 || toInt(readObjFile(f)["n"]) != 4 {
		t.Fatalf("a damaged file replaced the good backup: %q", readText(bakOf(f)))
	}
	_ = os.Remove(f) // missing: the backup
	if toInt(readObjFileBak(f)["n"]) != 1 {
		t.Fatal("a missing file was not read from its backup")
	}
	if m, found, err := readObjFileBakErr(filepath.Join(dir, "none.json")); m != nil || found || err != nil {
		t.Fatalf("neither there: %v %v %v", m, found, err)
	}
	_ = os.WriteFile(f, []byte("{"), 0o644)
	_ = os.WriteFile(bakOf(f), []byte("{"), 0o644)
	if _, found, err := readObjFileBakErr(f); !found || !errors.Is(err, errFileDamaged) {
		t.Fatalf("both damaged: found %v, %v", found, err)
	}
}

// posted-ids.json and a posting's progress.json: two whole copies of the same text; either damaged, the other is read
func TestR2515PostingRecordsMirrored(t *testing.T) {
	f := newStandTally(t)
	standBridge(t, f, "")
	if err := noteSent("Made1", zz, "job-r2515-m", "", 1, "", ""); err != nil {
		t.Fatal(err)
	}
	if readText(acceptedFile()) != readText(bakOf(acceptedFile())) || !strings.Contains(readText(bakOf(acceptedFile())), "Made1") {
		t.Fatalf("posted-ids.json.bak is not the same record: %q", readText(bakOf(acceptedFile())))
	}
	_ = os.WriteFile(acceptedFile(), []byte(`{"Made1": {"sent": tr`), 0o644)
	acceptedReset()
	if a := acceptedInfo("Made1"); a == nil || a["sent"] != true {
		t.Fatalf("the damaged record was not read from its copy: %v", a)
	}
	if logLines("posted-ids.json cannot be read whole") < 1 {
		t.Fatal("the log does not say the copy was read")
	}
	// progress.json
	jd := filepath.Join(jobsDir(), "job-r2515-prog")
	if err := writeProgress(jd, M{"id": "job-r2515-prog", "status": "running", "results": []any{M{"id": "x1", "ok": true}}}); err != nil {
		t.Fatal(err)
	}
	if readText(filepath.Join(jd, "progress.json")) != readText(filepath.Join(jd, "progress.json.bak")) {
		t.Fatal("progress.json.bak is not the same progress")
	}
	_ = os.WriteFile(filepath.Join(jd, "progress.json"), []byte(`{"id": "job-r2515-prog", "stat`), 0o644)
	if p := readProgress(jd); str(p["status"]) != "running" || len(arr(p["results"])) != 1 {
		t.Fatalf("the damaged progress was not read from its copy: %v", p)
	}
	if m, _ := filepath.Glob(filepath.Join(jd, "*.tmp")); len(m) != 0 {
		t.Fatalf("temporary files left: %v", m)
	}
}

// the settings: a damaged file is read from its .bak (the computer's key and choices kept), then written whole again
func TestR2515SettingsFromBackup(t *testing.T) {
	dir := t.TempDir()
	oldC, oldH := ConfigPath, Home
	t.Cleanup(func() { ConfigPath, Home = oldC, oldH; loadConfigRO() })
	ConfigPath, Home = filepath.Join(dir, "tds-bridge.config.json"), dir
	_ = os.WriteFile(ConfigPath, []byte(`{"Port":9123,"AllowImport":true,"LogFile":"`+filepath.ToSlash(filepath.Join(dir, "b.log"))+`"}`), 0o644)
	loadConfig()
	key := cfgS("Key")
	setCfg("Port", 9124)
	saveConfig() // the settings before kept as .bak
	if !exists(bakOf(ConfigPath)) || key == "" {
		t.Fatal("no backup of the settings")
	}
	_ = os.WriteFile(ConfigPath, []byte(`{"Port":91`), 0o644)
	loadConfig()
	if cfgS("Key") != key || toInt(cfg("Port")) != 9123 {
		t.Fatalf("the settings were not read from the backup: key kept %v, port %v", cfgS("Key") == key, cfg("Port"))
	}
	o := newOrdered()
	if o.UnmarshalText(readText(ConfigPath)) != nil {
		t.Fatal("the settings file was not written whole again")
	}
}
