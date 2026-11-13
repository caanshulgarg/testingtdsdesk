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
	t.Cleanup(func() { durableWaitAll(); ConfigPath, Home = oldC, oldH; loadConfigRO() })
	ConfigPath, Home = filepath.Join(dir, "tds-bridge.config.json"), dir
	_ = os.WriteFile(ConfigPath, []byte(`{"LogFile":"`+filepath.ToSlash(filepath.Join(dir, "b.log"))+`"}`), 0o644)
	loadConfig()
}

// a posting's record flushed to the disk after the save returned (the owner's decision of 13-Nov-2026: no save slower
// than 2.5.14's), the save never waiting for it; a flush that fails is logged, the file written whole stays; a plain
// saveFile is left as 2.5.14 left it (nothing flushed or kept after it: review M3 of b41667d51); nothing temporary left
func TestR2515SaveFileFlushes(t *testing.T) {
	dir := t.TempDir()
	r2515LogHere(t, dir)
	var n atomic.Int64
	release := make(chan struct{})
	r2515SetSync(t, func(h *os.File) error {
		if filepath.Base(h.Name()) != "note.txt" { // only the main file counted (not its .bak)
			return h.Sync()
		}
		<-release
		n.Add(1)
		return h.Sync()
	})
	plain := filepath.Join(dir, "a", "plain.txt")
	if err := saveFile(plain, "one"); err != nil || readText(plain) != "one" {
		t.Fatalf("saveFile: %v %q", err, readText(plain))
	}
	durMu.Lock()
	queued := durQueue[plain] != nil || durCur == plain
	durMu.Unlock()
	if queued || exists(bakOf(plain)) {
		t.Fatal("a plain saveFile was flushed or kept after it")
	}
	f := filepath.Join(dir, "a", "note.txt")
	if err := saveFileMirror(f, "one"); err != nil || readText(f) != "one" || n.Load() != 0 {
		t.Fatalf("saveFileMirror: %v %q, %d flushes before it returned", err, readText(f), n.Load())
	}
	close(release)
	durableWait(f)
	if n.Load() != 1 || readText(bakOf(f)) != "one" {
		t.Fatalf("%d flushes after the save, copy %q", n.Load(), readText(bakOf(f)))
	}
	// a flush that fails: said in the log; the file the save wrote stays
	r2515SetSync(t, func(h *os.File) error { return errors.New("disk full (stand)") })
	if err := saveFileMirror(f, "two"); err != nil || readText(f) != "two" {
		t.Fatalf("a save waited for its flush: %v %q", err, readText(f))
	}
	durableWait(f)
	if logLines("note.txt: not flushed to the disk (disk full (stand))") != 1 {
		t.Fatal("the failed flush is not logged")
	}
	if m, _ := filepath.Glob(filepath.Join(dir, "a", "*.tmp")); len(m) != 0 {
		t.Fatalf("temporary files left: %v", m)
	}
}

// a kept file: its newest whole text kept as .bak (written after the save, in the background); a damaged file is read
// from its .bak, and a damaged text never replaces the good backup
func TestR2515KeptFileBackup(t *testing.T) {
	dir := t.TempDir()
	r2515LogHere(t, dir)
	f := filepath.Join(dir, "keep.json")
	if err := saveJSONBak(f, M{"n": 1}); err != nil {
		t.Fatalf("first write: %v", err)
	}
	durableWait(f)
	if toInt(readObjFile(bakOf(f))["n"]) != 1 {
		t.Fatalf("first write: backup %q", readText(bakOf(f)))
	}
	_ = saveJSONBak(f, M{"n": 2})
	durableWait(f)
	if toInt(readObjFile(bakOf(f))["n"]) != 2 || toInt(readObjFile(f)["n"]) != 2 {
		t.Fatalf("backup %q, file %q", readText(bakOf(f)), readText(f))
	}
	_ = os.WriteFile(f, []byte(`{"n": 3, "cut sh`), 0o644) // damaged (a power cut, another program)
	if m := readObjFileBak(f); toInt(m["n"]) != 2 {
		t.Fatalf("the damaged file was not read from its backup: %v", m)
	}
	_ = saveFileBak(f, `{"n": 4, "cut sh`, wholeJSON) // a damaged text is never kept as the backup
	durableWait(f)
	if toInt(readObjFile(bakOf(f))["n"]) != 2 {
		t.Fatalf("a damaged text replaced the good backup: %q", readText(bakOf(f)))
	}
	_ = os.Remove(f) // missing: the backup
	if toInt(readObjFileBak(f)["n"]) != 2 {
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
	durableWait(acceptedFile())
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
	durableWait(filepath.Join(jd, "progress.json"))
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
	t.Cleanup(func() { durableWaitAll(); ConfigPath, Home = oldC, oldH; loadConfigRO() })
	ConfigPath, Home = filepath.Join(dir, "tds-bridge.config.json"), dir
	_ = os.WriteFile(ConfigPath, []byte(`{"Port":9123,"AllowImport":true,"LogFile":"`+filepath.ToSlash(filepath.Join(dir, "b.log"))+`"}`), 0o644)
	loadConfig()
	key := cfgS("Key")
	setCfg("Port", 9124)
	saveConfig() // the settings kept as .bak too (after the save, in the background)
	durableWait(ConfigPath)
	if !exists(bakOf(ConfigPath)) || key == "" {
		t.Fatal("no backup of the settings")
	}
	_ = os.WriteFile(ConfigPath, []byte(`{"Port":91`), 0o644)
	loadConfig()
	if cfgS("Key") != key || toInt(cfg("Port")) != 9124 {
		t.Fatalf("the settings were not read from the backup: key kept %v, port %v", cfgS("Key") == key, cfg("Port"))
	}
	o := newOrdered()
	if o.UnmarshalText(readText(ConfigPath)) != nil {
		t.Fatal("the settings file was not written whole again")
	}
}
