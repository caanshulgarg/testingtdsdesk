package main

// FinCom Bridge 2.4.5 (ROUND 102): the job file jobs\<id>\progress.json, hardened (jobfile.go). Tests written before the
// code. "Shared" in the names: the Windows CI job runs them on real Windows (go test -run 'Windows|Shared'), where a
// reader holding the file open could make the writer's replace fail and a read in that moment came back empty.

import (
	"errors"
	"os"
	"path/filepath"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// a writer and two readers at once, and a third program holding the file open now and then: every read gives a whole
// progress (never "no such job"), its seq never goes back, every write lands, the last one is on disk
func TestJobFileSharedStress(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "jobs", "job-stress-1")
	_ = os.MkdirAll(dir, 0o755)
	p := M{"id": "job-stress-1", "status": "running", "done": 0, "total": 2000}
	if err := writeProgress(dir, p); err != nil {
		t.Fatal(err)
	}
	const n = 1500
	var stop atomic.Bool
	var bad atomic.Value
	var reads atomic.Int64
	var wg sync.WaitGroup
	for r := 0; r < 2; r++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			last := 0
			for !stop.Load() {
				m := readProgress(dir)
				if m == nil {
					bad.Store("a read found no job")
					return
				}
				if s := toInt(m["seq"]); s < last {
					bad.Store("seq went back")
					return
				} else {
					last = s
				}
				reads.Add(1)
			}
		}()
	}
	wg.Add(1)
	go func() { // another program (an antivirus, a backup) holding the file open for a moment, again and again
		defer wg.Done()
		for !stop.Load() {
			if f, err := os.Open(filepath.Join(dir, "progress.json")); err == nil {
				time.Sleep(2 * time.Millisecond)
				f.Close()
			}
			time.Sleep(3 * time.Millisecond)
		}
	}()
	for i := 1; i <= n; i++ {
		p["done"] = i
		if err := writeProgress(dir, p); err != nil {
			stop.Store(true)
			wg.Wait()
			t.Fatalf("write %d: %v", i, err)
		}
	}
	stop.Store(true)
	wg.Wait()
	if b := bad.Load(); b != nil {
		t.Fatal(b)
	}
	m := readObjFile(filepath.Join(dir, "progress.json"))
	if toInt(m["done"]) != n || toInt(m["seq"]) != n+1 {
		t.Fatalf("the file: done %v seq %v", m["done"], m["seq"])
	}
	left, _ := filepath.Glob(filepath.Join(dir, "*.tmp"))
	if len(left) != 0 || reads.Load() == 0 {
		t.Fatalf("temporary files left %v, %d reads", left, reads.Load())
	}
}

// the replace refused for longer than the writer's tries (a program holding the file): the update is kept, a read gives
// it, and it is written as soon as the file is free; nothing is lost and nothing older overwrites it
func TestJobFileSharedReplaceRefusedNeverLost(t *testing.T) {
	standBridge(t, newStandTally(t), "") // the bridge's own log, in the test's folder
	dir := filepath.Join(t.TempDir(), "job-held-1")
	_ = os.MkdirAll(dir, 0o755)
	p := M{"id": "job-held-1", "status": "running", "done": 1}
	if err := writeProgress(dir, p); err != nil {
		t.Fatal(err)
	}
	var refuse atomic.Bool
	old := renameFn
	renameFn = func(a, b string) error {
		if refuse.Load() && filepath.Base(b) == "progress.json" {
			return errors.New("The process cannot access the file because it is being used by another process.")
		}
		return old(a, b)
	}
	t.Cleanup(func() { renameFn = old })
	refuse.Store(true)
	p["done"] = 2
	err := writeProgress(dir, p)
	if err == nil {
		t.Fatal("a write that did not reach the disk said it did")
	}
	if m := readProgress(dir); m == nil || toInt(m["done"]) != 2 {
		t.Fatalf("a read gives %v, want the update kept (done 2)", m)
	}
	if m := readObjFile(filepath.Join(dir, "progress.json")); toInt(m["done"]) != 1 {
		t.Fatalf("on disk meanwhile: %v", m)
	}
	refuse.Store(false)
	for i := 0; i < 100; i++ {
		if m := readObjFile(filepath.Join(dir, "progress.json")); toInt(m["done"]) == 2 {
			break
		}
		time.Sleep(20 * time.Millisecond)
	}
	if m := readObjFile(filepath.Join(dir, "progress.json")); toInt(m["done"]) != 2 {
		t.Fatalf("the update never reached the disk: %v", m)
	}
	if m := readProgress(dir); toInt(m["done"]) != 2 {
		t.Fatalf("a read after: %v", m)
	}
	// a later write goes as usual
	p["done"] = 3
	if err := writeProgress(dir, p); err != nil || toInt(readObjFile(filepath.Join(dir, "progress.json"))["done"]) != 3 {
		t.Fatalf("the next write: %v", err)
	}
}

// a read while the file is missing for a moment in an existing job folder waits for it; a job never made is "no job" at
// once
func TestJobFileSharedReadWaitsForMissing(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "job-late-1")
	_ = os.MkdirAll(dir, 0o755)
	go func() {
		time.Sleep(150 * time.Millisecond)
		_ = writeProgress(dir, M{"id": "job-late-1", "status": "queued"})
	}()
	if m := readProgress(dir); m == nil || str(m["status"]) != "queued" {
		t.Fatalf("the read did not wait: %v", m)
	}
	t0 := time.Now()
	if m := readProgress(filepath.Join(t.TempDir(), "never")); m != nil || time.Since(t0) > 100*time.Millisecond {
		t.Fatalf("no job: %v after %s", m, time.Since(t0))
	}
}
