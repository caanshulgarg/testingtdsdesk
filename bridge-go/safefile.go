// 2.5.15 (the owner's approval of 13-Nov-2026, item 3): the files the bridge keeps its state in are written so a power
// cut, a full disk or a program holding the file never leaves the bridge without a whole copy:
//   - every file saveFile writes: a temporary file beside it, then put in place by one rename (the old file is never
//     removed first: round 20), exactly as 2.5.14 did on the caller's path;
//   - the owner's decision of 13-Nov-2026 ("I don't want slower save at all"): the flush to the disk (fsync of the file
//     and its folder) and the copy kept as <name>.bak happen AFTER the save has returned, in the background (the flush
//     below): one at a time per file, coalesced (a file saved again meanwhile is flushed once more, with its newest
//     text), errors logged. The save never waits for them and holds no lock while they run; a file is flushed once its
//     saves have been quiet for 50 ms (1 s at most), so a burst of saves costs one flush, after it;
//   - the files that matter (posted-ids.json, a posting's progress.json and payload.json, the settings, the copy's
//     keep.json / manifest.json / balances.json, the older-entries state, the postings taken from FinCom's queue) keep
//     a .bak: the newest text, written to the disk and flushed, so a main file a power cut left cut short or empty has a
//     whole copy (the text is checked whole before it is kept; a damaged text never replaces a good backup);
//   - posted-ids.json alone is waited for: before the next send to Tally the previous flush of it has finished
//     (postedDurableWait in sendImport), so a power cut never loses an acceptance;
//   - read back, a main file that is missing or cannot be read whole falls back to its .bak, and the log says so once.
//
// Nothing here asks anything of Tally.
package main

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"strconv"
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

// the caller's side, as 2.5.14 wrote every file: the text in a temporary file beside it (no flush), then one rename,
// tried again a few times (a program holding the file for a moment); the folder is made when missing
func writeInPlace(path, text string) error {
	_ = os.MkdirAll(filepath.Dir(path), 0o755)
	tmp := fmt.Sprintf("%s.%d.%d.tmp", path, os.Getpid(), safeTmpN.Add(1))
	if err := os.WriteFile(tmp, []byte(text), 0o644); err != nil {
		_ = os.Remove(tmp)
		return err
	}
	var err error
	for i := 0; i < 4; i++ {
		if err = renameFn(tmp, path); err == nil {
			return nil
		}
		renameRetries.Add(1) // a save never waits for a flush (review of d3582645d): tried again after a pause, as 2.5.14
		time.Sleep(time.Duration(i+1) * 50 * time.Millisecond)
	}
	_ = os.Remove(tmp)
	return err
}

// a kept file written safely: put in place as 2.5.14 did; the flush and the .bak (the same text, when whole) after it,
// in the background
func saveFileBak(path, text string, whole func([]byte) bool) error {
	if err := writeInPlace(path, text); err != nil {
		return err
	}
	durableLater(path, text, false, true, whole)
	return nil
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

// errFileBusy (review M1): the file is there but could not be opened now (another program holding it, a disk error):
// never its backup then (the backup may be older), only the file itself, asked again
var errFileBusy = errors.New("the file is there but could not be opened now (another program holding it)")

// the waits between tries of a file that is there but could not be opened (about 1.5 s in all)
var readRetryWaits = []time.Duration{50 * time.Millisecond, 100 * time.Millisecond, 200 * time.Millisecond, 400 * time.Millisecond, 800 * time.Millisecond}

// the file's bytes, tried again for a moment while it is there but cannot be opened (missing: at once)
func readFileRetry(path string) ([]byte, error) {
	b, err := os.ReadFile(path)
	for _, d := range readRetryWaits {
		if err == nil || os.IsNotExist(err) {
			break
		}
		time.Sleep(d)
		b, err = os.ReadFile(path)
	}
	return b, err
}

// a kept JSON object read back: the file, else its backup when the file is missing or not whole. found: the file or
// its backup was there; err: errFileDamaged when one was there but neither could be read; errFileBusy when the file
// is there but could not be opened (its backup is never read for it: review M1)
func readObjFileBakErr(path string) (m M, found bool, err error) {
	b, e1 := readFileRetry(path)
	if e1 == nil {
		if m = parseObj(string(b)); m != nil {
			return m, true, nil
		}
	} else if !os.IsNotExist(e1) {
		return nil, true, fmt.Errorf("%w (%v)", errFileBusy, e1)
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
// (the list of postings taken from FinCom's queue: a file there but not opened after the tries is read from its backup,
// a list of ids to report, better than none; posted-ids.json and progress.json never are: review M1)
func readTextBak(path string, whole func([]byte) bool) string {
	b, err := readFileRetry(path)
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

// a posting's record written safely as two whole copies: the file, put in place as 2.5.14 did, then (in the background)
// flushed and its .bak written with the very same text. Read back as any kept file
func saveFileMirror(path, text string) error {
	if err := writeInPlace(path, text); err != nil {
		return err
	}
	durableLater(path, text, true, true, nil)
	return nil
}

// --- the background flush (the owner's decision of 13-Nov-2026: no save slower than 2.5.14's) ---------------------------
// One worker, one queue keyed by file (a file saved again while it waits keeps its place and takes the newest text): never
// two flushes of one file at once, and at most durQueueMax files waiting. Only a posting's records are flushed themselves
// (posted-ids.json, progress.json, cloud-posts.txt: saveFileMirror and jobfile.go); the other kept files have their .bak
// written (and flushed: it is the bridge's own new file); a plain saveFile is left as 2.5.14 left it.

type durableJob struct {
	text   string // the newest text saved (the .bak is written from it, never read back from the file)
	flush  bool   // the file itself flushed to the disk
	bak    bool
	whole  func([]byte) bool
	urgent bool      // waited for (a send to Tally): taken at once, before the others
	first  time.Time // the first save not yet flushed
	last   time.Time // the newest save
}

// review of d3582645d (the owner's rule: no slower saves, bursts included): a file is flushed once its saves have been
// quiet for durQuiet, or durMaxWait after the first save not yet flushed, so a burst of saves costs one flush, after it;
// a file waited for (a send to Tally) is flushed at once
var (
	durQuiet   = 50 * time.Millisecond
	durMaxWait = time.Second
)

const durQueueMax = 512

var (
	durMu         sync.Mutex
	durCond       = sync.NewCond(&durMu)
	durQueue      = map[string]*durableJob{} // path -> its flush, waiting
	durOrder      []string                   // the waiting paths, oldest first
	durCur        string                     // the path being flushed now ("" none)
	durRunning    bool                       // the worker runs
	durSaid       sync.Map                   // path -> the last failure logged (said once until it works again)
	durFullSaid   atomic.Bool
	durKick       = make(chan struct{}, 1) // wakes the worker's wait (a file waited for)
	renameRetries atomic.Int64             // renames of a save tried again (the Windows check of the test sheet: 0)
)

// the flush of path (itself when flush, its .bak when bak) after a save, in the background
func durableLater(path, text string, flush, bak bool, whole func([]byte) bool) {
	durMu.Lock()
	defer durMu.Unlock()
	now := time.Now()
	if j := durQueue[path]; j != nil {
		j.text, j.flush, j.bak, j.whole, j.last = text, j.flush || flush, j.bak || bak, whole, now
		return
	}
	if len(durQueue) >= durQueueMax && !flush {
		// the queue is full (a disk far slower than the saves): a kept file's .bak waits for its next save; a posting's
		// record is always taken
		if durFullSaid.CompareAndSwap(false, true) {
			writeLog(fmt.Sprintf("Safe files: %d files wait for their copy to be written; %s's copy waits for its next save", len(durQueue), filepath.Base(path)))
		}
		return
	}
	durQueue[path] = &durableJob{text: text, flush: flush, bak: bak, whole: whole, first: now, last: now}
	durOrder = append(durOrder, path)
	if !durRunning {
		durRunning = true
		go durableWorker()
	}
}

func durableWorker() {
	durMu.Lock()
	for len(durOrder) > 0 {
		// the file waited for first, else the one due soonest (quiet for durQuiet, or durMaxWait after its first save)
		k, now := -1, time.Now()
		var due time.Time
		for i, p := range durOrder {
			j := durQueue[p]
			if j.urgent {
				k = i
				break
			}
			d := j.last.Add(durQuiet)
			if m := j.first.Add(durMaxWait); m.Before(d) {
				d = m
			}
			if k < 0 || d.Before(due) {
				k, due = i, d
			}
		}
		if !durQueue[durOrder[k]].urgent && due.After(now) {
			durMu.Unlock()
			t := time.NewTimer(due.Sub(now))
			select {
			case <-t.C:
			case <-durKick:
			}
			t.Stop()
			durMu.Lock()
			continue
		}
		path := durOrder[k]
		durOrder = append(durOrder[:k:k], durOrder[k+1:]...)
		j := durQueue[path]
		delete(durQueue, path)
		durCur = path
		syncFn := syncFileFn
		durMu.Unlock()
		durableOnce(path, j, syncFn)
		durMu.Lock()
		durCur = ""
		durCond.Broadcast()
	}
	durRunning = false
	durFullSaid.Store(false)
	durCond.Broadcast()
	durMu.Unlock()
}

// a file waited for: flushed at once (the worker woken from its wait for the quiet)
func durUrgent(j *durableJob) {
	j.urgent = true
	select {
	case durKick <- struct{}{}:
	default:
	}
}

// the flush itself: the file (opened with the least access a flush needs, sharing read, write and delete, closed at
// once), its .bak written from the same text and flushed, then the folder. A folder removed meanwhile is never made
// again and is no failure
func durableOnce(path string, j *durableJob, syncFn func(*os.File) error) {
	dir := filepath.Dir(path)
	if fi, err := os.Stat(dir); err != nil || !fi.IsDir() {
		return
	}
	var fails []string
	if j.flush {
		if h, err := openForSync(path); err == nil {
			err = syncFn(h)
			_ = h.Close()
			if err != nil {
				fails = append(fails, "not flushed to the disk ("+err.Error()+")")
			}
		} else if !os.IsNotExist(err) {
			fails = append(fails, "not flushed to the disk ("+err.Error()+")")
		}
	}
	if j.bak && (j.whole == nil || j.whole([]byte(j.text))) {
		if err := writeBakSynced(path, j.text, syncFn); err != nil && !os.IsNotExist(err) {
			// review M1: a backup not written is said (the file itself is whole and is read first)
			fails = append(fails, "its copy "+bakOf(path)+" could not be written ("+err.Error()+")")
		}
	}
	fsyncDir(dir)
	if len(fails) == 0 {
		durSaid.Delete(path)
		return
	}
	w := strings.Join(fails, "; ")
	if prev, _ := durSaid.Load(path); prev != w {
		durSaid.Store(path, w)
		writeLog("Safe files: " + path + ": " + w + "; " + filepath.Base(path) + " itself was written whole")
	}
}

// the .bak: a temporary file beside it (never a folder made), written and flushed, then one rename
func writeBakSynced(path, text string, syncFn func(*os.File) error) error {
	bak := bakOf(path)
	tmp := fmt.Sprintf("%s.%d.%d.tmp", bak, os.Getpid(), safeTmpN.Add(1))
	h, err := os.OpenFile(tmp, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o644)
	if err != nil {
		return err
	}
	if _, err = h.WriteString(text); err == nil {
		err = syncFn(h)
	}
	if cerr := h.Close(); err == nil {
		err = cerr
	}
	if err == nil {
		for i := 0; i < 4; i++ {
			if err = os.Rename(tmp, bak); err == nil || os.IsNotExist(err) {
				break
			}
			time.Sleep(time.Duration(i+1) * 50 * time.Millisecond)
		}
		if err == nil {
			return nil
		}
	}
	_ = os.Remove(tmp)
	return err
}

// waits until path's flush (waiting or running) has finished: the saves made before the call are on the disk. A waiting
// one is taken next
func durableWait(path string) {
	durMu.Lock()
	if j := durQueue[path]; j != nil {
		durUrgent(j)
	}
	for durQueue[path] != nil || durCur == path {
		durCond.Wait()
	}
	durMu.Unlock()
}

// waits until nothing waits or runs (the tests, before their folders go)
func durableWaitAll() {
	durMu.Lock()
	for _, j := range durQueue {
		durUrgent(j)
	}
	for durRunning {
		durCond.Wait()
	}
	durMu.Unlock()
}

// the same, for at most d (the bridge's stop and its restart after an update): true when all is on the disk
func durableWaitFor(d time.Duration) bool {
	done := make(chan struct{})
	go func() { durableWaitAll(); close(done) }()
	select {
	case <-done:
		return true
	case <-time.After(d):
		writeLog("Safe files: the stop did not wait longer for the files still being written to the disk")
		return false
	}
}

// the process ends, the files still being flushed first (2 s at most): every way out of the bridge (review L6 of
// 68308695f)
func exitDrained(code int) {
	durableWaitFor(2 * time.Second)
	os.Exit(code)
}

// before a send to Tally: posted-ids.json on the disk, with this request's own "sent, no answer yet" note and every
// earlier one (a power cut never loses a note, so nothing is sent twice); the saves themselves never wait. Not on the
// disk (a flush failed twice, or not done in durFlushLimit): an error, and nothing is sent (review M1/M2 of 68308695f)
func postedDurableWait() error { return durableFlushNow(acceptedFile()) }

// the time a send to Tally waits at most for a posting's record to reach the disk (within the 2-second rule)
var durFlushLimit = 1500 * time.Millisecond

// a posting's record flushed now, by the caller itself (review M2/M3 of 68308695f: never behind the worker's queue or a
// .bak's rename, and only the one flush: the .bak follows in the background): tried once more when it fails; an error
// when it is still not on the disk, or not within durFlushLimit
func durableFlushNow(path string) error {
	start := time.Now()
	durMu.Lock()
	syncFn := syncFileFn
	durMu.Unlock()
	done := make(chan error, 1)
	go func() {
		err := flushFileOnce(path, syncFn)
		if err != nil {
			err = flushFileOnce(path, syncFn)
		}
		done <- err
	}()
	t := time.NewTimer(durFlushLimit)
	defer t.Stop()
	select {
	case err := <-done:
		if err != nil {
			return err
		}
	case <-t.C:
		return fmt.Errorf("%s not on the disk within %s", filepath.Base(path), durFlushLimit)
	}
	// flushed: a flush still waiting for the same text is not done again (its .bak still is)
	durMu.Lock()
	if j := durQueue[path]; j != nil && j.last.Before(start) {
		j.flush = false
	}
	durMu.Unlock()
	return nil
}

// the file flushed to the disk once, and its folder
func flushFileOnce(path string, syncFn func(*os.File) error) error {
	h, err := openForSync(path)
	if err != nil {
		return err
	}
	err = syncFn(h)
	if cerr := h.Close(); err == nil {
		err = cerr
	}
	if err == nil {
		fsyncDir(filepath.Dir(path))
	}
	return err
}

// a save's temporary file (writeInPlace, jobfile.go, a .bak's): <name>.<process>.<n>.tmp (review L2 of 68308695f)
var reBakTmp = regexp.MustCompile(`\.(\d+)\.\d+\.tmp$`)

// at the start: the temporary files of saves a run before left (stopped part-way) removed, in the copies' and the
// postings' folders and beside the settings; never this run's or another live process's (its number is in the name:
// review L3 of 68308695f)
func sweepBakTmp() {
	me := os.Getpid()
	n := 0
	one := func(p, name string) {
		m := reBakTmp.FindStringSubmatch(name)
		if m == nil {
			return
		}
		pid, err := strconv.Atoi(m[1])
		if err != nil || pid == me || pidAlive(pid) {
			return
		}
		if os.Remove(p) == nil {
			n++
		}
	}
	for _, root := range []string{syncDir(), jobsDir()} {
		_ = filepath.WalkDir(root, func(p string, d os.DirEntry, err error) error {
			if err == nil && !d.IsDir() {
				one(p, d.Name())
			}
			return nil
		})
	}
	if es, err := os.ReadDir(filepath.Dir(ConfigPath)); err == nil {
		for _, e := range es {
			if !e.IsDir() {
				one(filepath.Join(filepath.Dir(ConfigPath), e.Name()), e.Name())
			}
		}
	}
	if n > 0 {
		writeLog(fmt.Sprintf("Safe files: %d temporary copy file(s) left by an earlier run removed", n))
	}
}
