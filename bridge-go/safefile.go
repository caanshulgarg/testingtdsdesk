// 2.5.15 (the owner's approval of 13-Nov-2026, item 3): the files the bridge keeps its state in are written so a power
// cut, a full disk or a program holding the file never leaves half a file, and one copy before it is kept:
//   - every file saveFile writes: a temporary file beside it, written and flushed to the disk (fsync), then put in place by
//     one rename (the folder flushed too where the system allows it); the old file is never removed first (round 20);
//   - the files that matter (posted-ids.json, a posting's progress.json and payload.json, the settings, the copy's
//     keep.json / manifest.json / balances.json, the older-entries state, the postings taken from FinCom's queue) keep
//     the file they replace as <name>.bak, but only while that file is itself whole (a damaged file never replaces a good
//     backup);
//   - read back, a main file that is missing or cannot be read whole falls back to its .bak, and the log says so once.
//
// Nothing here asks anything of Tally.
package main

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

func bakOf(path string) string { return path + ".bak" }

var safeTmpN atomic.Int64

// the bytes written to a temporary file beside path and flushed to the disk; the temporary file's name
func writeTempSynced(path string, data []byte) (string, error) {
	_ = os.MkdirAll(filepath.Dir(path), 0o755)
	tmp := fmt.Sprintf("%s.%d.%d.tmp", path, os.Getpid(), safeTmpN.Add(1))
	h, err := os.OpenFile(tmp, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o644)
	if err != nil {
		return "", err
	}
	if _, err = h.Write(data); err == nil {
		err = syncFileFn(h)
	}
	if cerr := h.Close(); err == nil {
		err = cerr
	}
	if err != nil {
		_ = os.Remove(tmp)
		return "", err
	}
	return tmp, nil
}

// the flush to the disk (a function so the tests can count or refuse it)
var syncFileFn = func(h *os.File) error { return h.Sync() }

// the folder's entry flushed after a rename (not on Windows, where a folder cannot be opened so; NTFS keeps its own log)
func fsyncDir(dir string) {
	if runtime.GOOS == "windows" {
		return
	}
	if d, err := os.Open(dir); err == nil {
		_ = d.Sync()
		_ = d.Close()
	}
}

// the rename that puts the temporary file in place, tried again a few times (a program holding the file for a moment)
func renameInPlace(tmp, path string) error {
	var err error
	for i := 0; i < 4; i++ {
		if err = renameFn(tmp, path); err == nil {
			fsyncDir(filepath.Dir(path))
			return nil
		}
		time.Sleep(time.Duration(i+1) * 50 * time.Millisecond)
	}
	_ = os.Remove(tmp)
	return err
}

var bakMu sync.Map // path -> *sync.Mutex: one writer of a kept file and its backup at a time

func bakLock(path string) *sync.Mutex {
	l, _ := bakMu.LoadOrStore(path, &sync.Mutex{})
	return l.(*sync.Mutex)
}

// the file now at path kept as path.bak, but only when it is whole (whole: the reader's own test); a damaged or missing
// file leaves the backup as it is. A hard link when the disk allows it (nothing copied), else a copy written as above
func keepBackup(path string, whole func([]byte) bool) {
	b, err := os.ReadFile(path)
	if err != nil || len(b) == 0 || (whole != nil && !whole(b)) {
		return
	}
	bak := bakOf(path)
	tmp := fmt.Sprintf("%s.%d.%d.tmp", bak, os.Getpid(), safeTmpN.Add(1))
	if os.Link(path, tmp) != nil {
		t, err := writeTempSynced(bak, b)
		if err != nil {
			return
		}
		tmp = t
	}
	if renameFn(tmp, bak) != nil {
		_ = os.Remove(tmp)
	}
}

// a kept file written safely: the file it replaces kept as .bak (when whole), the new one flushed and put in place
func saveFileBak(path, text string, whole func([]byte) bool) error {
	l := bakLock(path)
	l.Lock()
	defer l.Unlock()
	tmp, err := writeTempSynced(path, []byte(text))
	if err != nil {
		return err
	}
	keepBackup(path, whole)
	return renameInPlace(tmp, path)
}

// a JSON file's test of being whole
func wholeJSON(b []byte) bool { _, err := parseJSON(string(b)); return err == nil }

// a kept JSON file written safely
func saveJSONBak(path string, v any) error { return saveFileBak(path, jsonText(v), wholeJSON) }

var bakSaid sync.Map

func saidBak(path, why string) {
	if _, was := bakSaid.LoadOrStore(path, true); !was {
		writeLog("Safe files: " + path + " " + why + "; its backup (" + filepath.Base(bakOf(path)) + ") is read instead")
	}
}

// errFileDamaged: the file is there but cannot be read whole, and its backup cannot either
var errFileDamaged = errors.New("the file is there but cannot be read whole, nor its backup")

// a kept JSON object read back: the file, else its backup when the file is missing or not whole. found: the file or
// its backup was there; err: errFileDamaged when one was there but neither could be read
func readObjFileBakErr(path string) (m M, found bool, err error) {
	b, e1 := os.ReadFile(path)
	if e1 == nil {
		if m = parseObj(string(b)); m != nil {
			return m, true, nil
		}
	}
	bb, e2 := os.ReadFile(bakOf(path))
	if e2 == nil {
		if m = parseObj(string(bb)); m != nil {
			if e1 == nil {
				saidBak(path, "cannot be read whole")
			} else {
				saidBak(path, "is missing")
			}
			return m, true, nil
		}
	}
	if e1 != nil && os.IsNotExist(e1) && (e2 != nil && os.IsNotExist(e2)) {
		return nil, false, nil
	}
	if e1 != nil && !os.IsNotExist(e1) {
		return nil, true, fmt.Errorf("%w (%v)", errFileDamaged, e1)
	}
	return nil, true, errFileDamaged
}

// the same, nil when neither can be read (the callers that take a missing file as none)
func readObjFileBak(path string) M {
	m, _, _ := readObjFileBakErr(path)
	return m
}

// a kept text read back: the file, else its backup when the file is missing or fails whole
func readTextBak(path string, whole func([]byte) bool) string {
	b, err := os.ReadFile(path)
	if err == nil && (whole == nil || whole(b)) {
		return strings.TrimPrefix(string(b), "\ufeff")
	}
	if bb, e2 := os.ReadFile(bakOf(path)); e2 == nil && (whole == nil || whole(bb)) {
		if err == nil {
			saidBak(path, "cannot be read whole")
		} else {
			saidBak(path, "is missing")
		}
		return strings.TrimPrefix(string(bb), "\ufeff")
	}
	if err == nil {
		return strings.TrimPrefix(string(b), "\ufeff")
	}
	return ""
}

// a posting's record written safely as two whole copies: the file, then its .bak with the very same text (so the backup
// is never one posting behind: an entry sent is on both before anything else goes). Read back as any kept file
func saveFileMirror(path, text string) error {
	l := bakLock(path)
	l.Lock()
	defer l.Unlock()
	tmp, err := writeTempSynced(path, []byte(text))
	if err != nil {
		return err
	}
	if err := renameInPlace(tmp, path); err != nil {
		return err
	}
	if tb, err := writeTempSynced(bakOf(path), []byte(text)); err == nil {
		_ = renameInPlace(tb, bakOf(path))
	}
	return nil
}
