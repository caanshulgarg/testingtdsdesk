// FinCom Bridge 2.4.5 (ROUND 102): the job file jobs\<id>\progress.json, hardened on both sides. On Windows a program
// holding the file open (another reader, an antivirus, a backup) can make the writer's replace fail, and a read in that
// moment came back as "no such job" (the old PowerShell bridge's flaky share-6 test traced it: its Move-Item -Force
// deleted the old file first). Here:
//   - the writer puts the new file in place by one atomic replace (a temporary file beside it, then MoveFileEx with
//     REPLACE_EXISTING: os.Rename), never deleting the old one first, and tries again with growing pauses for about 4 s;
//     the newest update is also kept in memory until it is on disk, and written by itself as soon as the file is free,
//     so no update is ever lost and an older one never overwrites it. A write that did not reach the disk in its tries
//     still says so to its caller (a posting's record must be on disk before Tally is asked: jobs.go);
//   - the reader shares read, write and delete (on Windows CreateFile with FILE_SHARE_DELETE, so it never blocks the
//     writer's replace), takes the newest update kept in memory first, and tries again for up to 2 s on a file locked or
//     not whole, and for 0.4 s on a file missing while its job folder exists (a job never made is "no job" at once).
package main

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

var jobFiles = struct {
	mu       sync.Mutex
	pending  map[string]string // path -> the newest text not yet on disk
	flushing map[string]bool
}{pending: map[string]string{}, flushing: map[string]bool{}}

var jobTmpN atomic.Int64

// one try at the whole file: a temporary file of its own beside it, then the one replace
func jobFileWriteOnce(path, text string) error {
	_ = os.MkdirAll(filepath.Dir(path), 0o755)
	tmp := fmt.Sprintf("%s.%d.%d.tmp", path, os.Getpid(), jobTmpN.Add(1))
	if err := os.WriteFile(tmp, []byte(text), 0o644); err != nil {
		_ = os.Remove(tmp)
		return err
	}
	if err := renameFn(tmp, path); err != nil {
		_ = os.Remove(tmp)
		return err
	}
	return nil
}

// the replace tried again with growing pauses (10 ms up to 250 ms; about 4 s in all)
func jobFileWrite(path, text string) error {
	var err error
	d := 10 * time.Millisecond
	for i := 0; i < 24; i++ {
		if err = jobFileWriteOnce(path, text); err == nil {
			return nil
		}
		time.Sleep(d)
		if d < 250*time.Millisecond {
			d *= 2
		}
	}
	return err
}

// the newest text for path is on disk: no longer kept (unless a newer one came meanwhile)
func jobFileDone(path, text string) {
	jobFiles.mu.Lock()
	if jobFiles.pending[path] == text {
		delete(jobFiles.pending, path)
	}
	jobFiles.mu.Unlock()
}

// the writer's side: kept in memory first, then written; not on disk after the tries: written by itself later
func jobFileSave(path, text string) error {
	jobFiles.mu.Lock()
	jobFiles.pending[path] = text
	jobFiles.mu.Unlock()
	if err := jobFileWrite(path, text); err != nil {
		jobFileFlushLater(path)
		return err
	}
	jobFileDone(path, text)
	return nil
}

func jobFileFlushLater(path string) {
	jobFiles.mu.Lock()
	if jobFiles.flushing[path] {
		jobFiles.mu.Unlock()
		return
	}
	jobFiles.flushing[path] = true
	jobFiles.mu.Unlock()
	go func() {
		defer func() {
			jobFiles.mu.Lock()
			delete(jobFiles.flushing, path)
			jobFiles.mu.Unlock()
		}()
		for i := 0; i < 2400 && !stopping(); i++ { // 10 minutes at most; the next write tries again anyway
			jobFiles.mu.Lock()
			text, ok := jobFiles.pending[path]
			jobFiles.mu.Unlock()
			if !ok {
				return
			}
			if jobFileWriteOnce(path, text) == nil {
				jobFileDone(path, text)
				writeLog("Job file " + path + ": written (it was held by another program for a while; no update was lost)")
				return
			}
			time.Sleep(250 * time.Millisecond)
		}
	}()
}

// the reader's side: the newest update (kept in memory, else the file), nil when there is no such job
func jobFileRead(path string) M {
	jobFiles.mu.Lock()
	text, ok := jobFiles.pending[path]
	jobFiles.mu.Unlock()
	if ok {
		if m := parseObj(text); m != nil {
			return m
		}
	}
	for i := 0; i < 40; i++ {
		b, err := readTail(path, 256<<20, false)
		if err == nil {
			if m := parseObj(strings.TrimPrefix(string(b), "\ufeff")); m != nil {
				return m
			}
		} else if os.IsNotExist(err) {
			if fi, derr := os.Stat(filepath.Dir(path)); derr != nil || !fi.IsDir() || i >= 8 {
				return nil
			}
		}
		time.Sleep(50 * time.Millisecond)
	}
	return nil
}
