package main

// FinCom Bridge 2.5.16, item 5 (the 2.5.15 review's two lows): a posting whose progress.json is there but not read is
// kept in cloud-posts.txt (its turn skipped), said once and in the beat, and after 24 hours moved aside as .bad (kept)
// and let go; one with no record at all is let go, as before. Nothing here asks anything of Tally. Made-up names only.
import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// the service's command line is made whole, whatever its program's folder is called
func TestR2516ServiceCommandLine(t *testing.T) {
	got := serviceCommandLine(`C:\Program Files\My service tools\FinCom Bridge\FinComBridge.exe`, `C:\ProgramData\FinCom Bridge\state\S-1-5-21-1\tds-bridge.config.json`)
	want := `"C:\Program Files\My service tools\FinCom Bridge\FinComBridge.exe" service --config "C:\ProgramData\FinCom Bridge\state\S-1-5-21-1\tds-bridge.config.json"`
	if got != want {
		t.Fatalf("%s", got)
	}
}

func TestR2516HeldProgressKeepsPosting(t *testing.T) {
	dir := t.TempDir()
	r2515LogHere(t, dir)
	cpMu.Lock()
	cloudPosts = map[string]string{"job-r2516-held": ""}
	cpMu.Unlock()
	old := jobViewFn
	t.Cleanup(func() {
		jobViewFn = old
		cpMu.Lock()
		cloudPosts = nil
		cpMu.Unlock()
	})
	jd := filepath.Join(jobsDir(), "job-r2516-held")
	_ = os.MkdirAll(jd, 0o755)
	_ = os.WriteFile(filepath.Join(jd, "progress.json"), []byte(`{"id":"job-r2516-held","status":"running"}`), 0o644)
	jobViewFn = func(string) M { return nil } // held by another program: not read in its tries
	postsDirty.Store(true)
	syncCloudPosts()
	cpMu.Lock()
	_, kept := cloudPosts["job-r2516-held"]
	cpMu.Unlock()
	if !kept {
		t.Fatal("a posting whose progress.json was held was dropped from cloud-posts.txt")
	}
	// said once, in the beat; after 24 hours moved aside as .bad (kept) and let go
	if !strings.Contains(readText(logFile()), "job-r2516-held: its progress.json could not be read") || len(progressUnreadableBeat()) != 1 {
		t.Fatalf("not said: %v", progressUnreadableBeat())
	}
	postsDirty.Store(true)
	syncCloudPosts()
	if strings.Count(readText(logFile()), "job-r2516-held: its progress.json could not be read (") != 1 {
		t.Fatal("said more than once")
	}
	unreadableNow = func() time.Time { return time.Now().Add(25 * time.Hour) }
	t.Cleanup(func() { unreadableNow = time.Now })
	postsDirty.Store(true)
	syncCloudPosts()
	cpMu.Lock()
	_, kept = cloudPosts["job-r2516-held"]
	cpMu.Unlock()
	if kept || exists(filepath.Join(jd, "progress.json")) || readText(filepath.Join(jd, "progress.json.bad")) == "" || len(progressUnreadableBeat()) != 0 {
		t.Fatal("not moved aside after 24 hours")
	}
	unreadableNow = time.Now
	// no record at all (the folder without progress.json or its copy): let go, as before
	cpMu.Lock()
	cloudPosts["job-r2516-held"] = ""
	cpMu.Unlock()
	postsDirty.Store(true)
	syncCloudPosts()
	cpMu.Lock()
	_, kept = cloudPosts["job-r2516-held"]
	cpMu.Unlock()
	if kept {
		t.Fatal("a posting with no record was kept")
	}
}
