package main

// bridge 2.5.15, the owner's decision of 13-Nov-2026 ("I don't want slower save at all"): every save costs what 2.5.14's
// did on the caller's path (a temporary file, then one rename); the flush to the disk and the .bak follow in the
// background (safefile.go). Only posted-ids.json is waited for, before the next send to Tally. Made-up names only.
import (
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

// 2.5.14's write, as it was (util.go saveFile and jobfile.go jobFileWriteOnce at 61f76372f): the reference
func r2515Write2514(path, text string) error {
	_ = os.MkdirAll(filepath.Dir(path), 0o755)
	tmp := fmt.Sprintf("%s.%d.ref.tmp", path, os.Getpid())
	if err := os.WriteFile(tmp, []byte(text), 0o644); err != nil {
		_ = os.Remove(tmp)
		return err
	}
	if err := os.Rename(tmp, path); err != nil {
		_ = os.Remove(tmp)
		return err
	}
	return nil
}

// the hot paths: posted-ids.json, a posting's progress.json, cloud-posts.txt and a day file, each saved as now
func r2515HotPaths(t *testing.T) map[string]func(i int) (string, error) {
	t.Helper()
	day := strings.Repeat(`<VOUCHER><DATE>20261005</DATE><NARRATION>made up</NARRATION></VOUCHER>`, 400)
	posts := strings.Repeat("job-made-up-0001\n", 200)
	jd := filepath.Join(jobsDir(), "job-r2515-fast")
	return map[string]func(i int) (string, error){
		"posted-ids.json": func(i int) (string, error) {
			acceptedMu.Lock()
			defer acceptedMu.Unlock()
			acceptedAll()
			acceptedNotes[fmt.Sprintf("Fast%d", i%50)] = M{"sent": true, "job": "job-r2515-fast"}
			return acceptedFile(), acceptedWrite()
		},
		"progress.json": func(i int) (string, error) {
			p := filepath.Join(jd, "progress.json")
			return p, jobFileWrite(p, jsonText(M{"id": "job-r2515-fast", "status": "running", "n": i}))
		},
		"cloud-posts.txt": func(i int) (string, error) {
			return cloudPostsFile(), saveFileMirror(cloudPostsFile(), posts+fmt.Sprint(i))
		},
		"day file": func(i int) (string, error) {
			p := filepath.Join(syncFolder(zz), "days", "20261005.xml")
			return p, saveFile(p, day+fmt.Sprint(i))
		},
	}
}

func r2515Median(d []time.Duration) time.Duration {
	sort.Slice(d, func(i, j int) bool { return d[i] < d[j] })
	return d[len(d)/2]
}

// a flush that takes 200 ms never reaches the caller: each save returns well before it; the flush and the copies come after
func TestR2515SavesNeverWaitForFlush(t *testing.T) {
	standBridge(t, newStandTally(t), "")
	var n atomic.Int64
	old := syncFileFn
	syncFileFn = func(h *os.File) error { time.Sleep(200 * time.Millisecond); n.Add(1); return h.Sync() }
	t.Cleanup(func() { durableWaitAll(); syncFileFn = old })
	for name, save := range r2515HotPaths(t) {
		t0 := time.Now()
		path, err := save(1)
		if took := time.Since(t0); err != nil || took > 100*time.Millisecond {
			t.Fatalf("%s: saved in %s (%v): the save waited for its flush", name, took, err)
		}
		durableWait(path)
		if name != "day file" && readText(bakOf(path)) != readText(path) {
			t.Fatalf("%s: its .bak is not the text saved", name)
		}
	}
	if n.Load() == 0 {
		t.Fatal("nothing was flushed after the saves")
	}
}

// posted-ids.json: the save does not wait, the next send to Tally does (a power cut never loses an acceptance)
func TestR2515PostedFlushedBeforeNextSend(t *testing.T) {
	f := newStandTally(t)
	standBridge(t, f, "")
	release := make(chan struct{})
	old := syncFileFn
	syncFileFn = func(h *os.File) error {
		if strings.HasPrefix(filepath.Base(h.Name()), "posted-ids.json") {
			<-release
		}
		return h.Sync()
	}
	t.Cleanup(func() { syncFileFn = old })
	t0 := time.Now()
	if err := noteSent("Fast0", zz, "job-r2515-prev", "", 1, "", ""); err != nil || time.Since(t0) > 100*time.Millisecond {
		t.Fatalf("the save of posted-ids.json waited for its flush: %v after %s", err, time.Since(t0))
	}
	done := make(chan error, 1)
	go func() {
		_, err := invokeImport(M{"company": zz, "vouchers": []any{M{"id": "fs1", "xml": finVoucher("fs1", fgParty, "FS-1", today(), "1.00")}}})
		done <- err
	}()
	time.Sleep(150 * time.Millisecond)
	if f.n("Import") != 0 {
		t.Fatal("sent to Tally before the previous posted-ids.json was on the disk")
	}
	close(release)
	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("the posting: %v", err)
		}
	case <-time.After(10 * time.Second):
		t.Fatal("the send never went after the flush")
	}
	if f.n("Import") != 1 {
		t.Fatalf("%d imports after the flush", f.n("Import"))
	}
}

// the save on each hot path costs what 2.5.14's did (median of 200, alternated with 2.5.14's write of the same text to
// a file beside it): at most 1.5 times it and 0.5 ms (the noise of a busy machine)
func TestR2515SaveLatencyAs2514(t *testing.T) {
	standBridge(t, newStandTally(t), "")
	t.Cleanup(durableWaitAll)
	for name, save := range r2515HotPaths(t) {
		var now, ref []time.Duration
		for i := 0; i < 200; i++ {
			t0 := time.Now()
			path, err := save(i)
			now = append(now, time.Since(t0))
			if err != nil {
				t.Fatalf("%s: %v", name, err)
			}
			text := readText(path)
			t1 := time.Now()
			if name == "posted-ids.json" { // 2.5.14's acceptedWrite: the notes made into text under the lock, then written
				acceptedMu.Lock()
				acceptedAll()
				text = jsonText(acceptedNotes)
				err = r2515Write2514(path+".ref", text)
				acceptedMu.Unlock()
			} else {
				err = r2515Write2514(path+".ref", text)
			}
			if err != nil {
				t.Fatal(err)
			}
			ref = append(ref, time.Since(t1))
		}
		mn, mr := r2515Median(now), r2515Median(ref)
		t.Logf("%s: median save %s now, %s as 2.5.14", name, mn, mr)
		if mn > mr*3/2+500*time.Microsecond {
			t.Errorf("%s: a save takes %s, 2.5.14's %s", name, mn, mr)
		}
	}
}

// go test -run XXX -bench R2515Save: each hot path's save now and as 2.5.14 wrote it
func BenchmarkR2515Save(b *testing.B) {
	for _, mode := range []string{"now", "2.5.14"} {
		b.Run(mode, func(b *testing.B) {
			dir := b.TempDir()
			text := strings.Repeat(`{"Fast": {"sent": true, "job": "job-made-up"}},`, 400)
			p := filepath.Join(dir, "posted-ids.json")
			b.ResetTimer()
			for i := 0; i < b.N; i++ {
				if mode == "now" {
					_ = saveFileMirror(p, text)
				} else {
					_ = r2515Write2514(p, text)
				}
			}
			b.StopTimer()
			durableWaitAll()
		})
	}
}
