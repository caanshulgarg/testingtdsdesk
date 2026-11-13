package main

// FinCom Bridge 2.5.16, item 5 (the 2.5.15 review's two lows): a posting whose progress.json another program holds a
// moment is kept in cloud-posts.txt (its turn skipped, reported at the next turn), never dropped from it; one with no
// record at all is let go, as before. Nothing here asks anything of Tally. Made-up names only.
import (
	"os"
	"path/filepath"
	"testing"
)

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
	// no record at all (the folder without progress.json or its copy): let go, as before
	_ = os.Remove(filepath.Join(jd, "progress.json"))
	postsDirty.Store(true)
	syncCloudPosts()
	cpMu.Lock()
	_, kept = cloudPosts["job-r2516-held"]
	cpMu.Unlock()
	if kept {
		t.Fatal("a posting with no record was kept")
	}
}
