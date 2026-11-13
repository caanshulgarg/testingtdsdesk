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
	dayPath := filepath.Join(syncFolder(zz), "days", "20261005.xml") // worked out once: the save alone is timed
	days := []string{day + "0", day + "1"}
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
			return dayPath, saveFile(dayPath, days[i%2])
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
	r2515SetSync(t, func(h *os.File) error { time.Sleep(200 * time.Millisecond); n.Add(1); return h.Sync() })
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

// the flush function swapped for a test (under the worker's lock; every flush finished first and at the end)
func r2515SetSync(t *testing.T, f func(*os.File) error) {
	t.Helper()
	durableWaitAll()
	durMu.Lock()
	old := syncFileFn
	syncFileFn = f
	durMu.Unlock()
	t.Cleanup(func() {
		durableWaitAll()
		durMu.Lock()
		syncFileFn = old
		durMu.Unlock()
	})
}

// posted-ids.json: the save does not wait; a send to Tally does, for every earlier note and for its own "sent, no answer
// yet" note (review H1 of b41667d51): the file as it is when Tally gets the request is the one flushed last
func TestR2515PostedFlushedBeforeNextSend(t *testing.T) {
	f := newStandTally(t)
	standBridge(t, f, "")
	release := make(chan struct{})
	var flushed atomic.Value
	flushed.Store("")
	r2515SetSync(t, func(h *os.File) error {
		if strings.HasPrefix(filepath.Base(h.Name()), "posted-ids.json") {
			<-release
		}
		if filepath.Base(h.Name()) == "posted-ids.json" {
			b, _ := os.ReadFile(h.Name())
			flushed.Store(string(b))
		}
		return h.Sync()
	})
	var atImport atomic.Value
	f.mu.Lock()
	f.slow = func(id, body string) time.Duration {
		if id == "Import" {
			cur := readText(acceptedFile())
			atImport.Store(fmt.Sprintf("%v %v", cur == flushed.Load().(string), strings.Count(cur, `"sent"`)))
		}
		return 0
	}
	f.mu.Unlock()
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
		t.Fatal("sent to Tally before posted-ids.json was on the disk")
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
	// at the Import: the file Tally's request went with is the one flushed, and it holds fs1's note beside Fast0's
	if f.n("Import") != 1 || atImport.Load() != "true 2" {
		t.Fatalf("%d imports; at the import (file flushed, notes): %v", f.n("Import"), atImport.Load())
	}
}

// the cost of that wait, a request to Tally (one flush of posted-ids.json, its copy and its folder), on this disk
func TestR2515PostedFlushCost(t *testing.T) {
	standBridge(t, newStandTally(t), "")
	var d []time.Duration
	for i := 0; i < 50; i++ {
		_ = noteSent(fmt.Sprintf("Cost%d", i), zz, "job-r2515-cost", "", 1, "", "")
		t0 := time.Now()
		postedDurableWait()
		d = append(d, time.Since(t0))
	}
	t.Logf("posted-ids.json flush before a request to Tally: median %s, worst %s", r2515Median(d), d[len(d)-1])
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

// the test sheet's Windows check (Defender on): 200 saves of posted-ids.json back to back, each followed by its flush in
// the background; no rename of a save is tried again (on Windows a handle open for a flush, or a scan after it, would)
func TestR2515RenameRetriesBackToBack(t *testing.T) {
	standBridge(t, newStandTally(t), "")
	t.Cleanup(durableWaitAll)
	before := renameRetries.Load()
	for i := 0; i < 200; i++ {
		if err := noteSent(fmt.Sprintf("Back%d", i), zz, "job-r2515-back", "", 1, "", ""); err != nil {
			t.Fatal(err)
		}
	}
	durableWaitAll()
	if n := renameRetries.Load() - before; n != 0 {
		t.Fatalf("%d renames of posted-ids.json tried again in 200 saves", n)
	}
}

// a burst of saves (review of d3582645d: no slower saves, bursts included): 500 saves of posted-ids.json back to back
// take no longer than 2.5.14's 500 writes of the same text (alternated, 5 rounds, the median round; 1.2 times for the
// noise), and the burst is flushed once or twice, after it, not once a save
func TestR2515BurstAs2514(t *testing.T) {
	dir := t.TempDir()
	r2515LogHere(t, dir)
	var n atomic.Int64
	r2515SetSync(t, func(h *os.File) error {
		if filepath.Base(h.Name()) == "burst.json" {
			n.Add(1)
		}
		return h.Sync()
	})
	text := strings.Repeat(`{"Fast": {"sent": true, "job": "job-made-up"}},`, 400)
	p, ref := filepath.Join(dir, "burst.json"), filepath.Join(dir, "burst-ref.json")
	var now, old []time.Duration
	for round := 0; round < 5; round++ {
		t0 := time.Now()
		for i := 0; i < 500; i++ {
			_ = saveFileMirror(p, text)
		}
		now = append(now, time.Since(t0))
		t1 := time.Now()
		for i := 0; i < 500; i++ {
			_ = r2515Write2514(ref, text)
		}
		old = append(old, time.Since(t1))
	}
	durableWaitAll()
	mn, mo := r2515Median(now), r2515Median(old)
	t.Logf("500 saves back to back: median %s now, %s as 2.5.14; %d flushes of the file in 2,500 saves", mn, mo, n.Load())
	if mn > mo*6/5 {
		t.Errorf("a burst takes %s, 2.5.14's %s", mn, mo)
	}
	if n.Load() > 15 {
		t.Errorf("%d flushes in 5 bursts of 500 saves: not coalesced", n.Load())
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
