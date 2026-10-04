// Round 19 (the security review's S3 and the owner's question of 04-Oct-2026, "can the add-on hang Tally"): every read
// of a file the bridge does not own (the add-on's holding files in C:\ProgramData\FinCom\recorder, Tally's tally.ini,
// tally.imp and tdlerror.log, the bridge's own logs for the support pack) goes through readShared:
//   - a regular file only: os.Lstat first, a link, junction or other reparse point is refused, never followed;
//   - opened for reading only, sharing read, write and delete (on Windows CreateFile with FILE_SHARE_READ |
//     FILE_SHARE_WRITE | FILE_SHARE_DELETE, so Tally's add-on can always append, rename or delete it meanwhile);
//   - the opened file must be the one looked at (os.SameFile) and have one name only (no hard link to another file);
//   - only its last maxBytes are read (a seek, never the whole file), and it is closed at once;
//   - a file another program holds locked is not waited for: an error at once, logged "recorder file busy, read later".
//
// The bridge never opens a holding file for writing, never creates, renames or deletes one (TestNoWriteToRecorderFiles).
package main

import (
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
)

// a hook for the tests: called while readShared holds the file open
var readSharedHold func(path string)

func readShared(path string, maxBytes int64) ([]byte, error) { return readTail(path, maxBytes, true) }

// the last maxBytes of a regular file, read as readShared says; busyLog: a held file is logged
func readTail(path string, maxBytes int64, busyLog bool) ([]byte, error) {
	b, _, err := readSharedAt(path, -1, maxBytes, busyLog)
	return b, err
}

// 2.2.0 (the live recorder): the bytes of a holding file from the offset off (at most maxBytes), and the file's size
// now; the same rules as readShared (a regular file, opened for reading only with every sharing, the one looked at,
// one name, never waited for). Bytes the add-on writes meanwhile are read next time
func readSharedFrom(path string, off, maxBytes int64) ([]byte, int64, error) {
	if off < 0 {
		off = 0
	}
	return readSharedAt(path, off, maxBytes, true)
}

// off < 0: the file's last maxBytes; else from off
func readSharedAt(path string, off, maxBytes int64, busyLog bool) ([]byte, int64, error) {
	fi, err := os.Lstat(path)
	if err != nil {
		return nil, 0, err
	}
	if !fi.Mode().IsRegular() || isReparse(path, fi) {
		return nil, 0, fmt.Errorf("%s is not a plain file (a link, a folder or another kind): not read", path)
	}
	f, err := openShared(path)
	if err != nil {
		if busyLog && isSharingViolation(err) {
			writeLog("Recorder trial: recorder file busy, read later: " + path)
		}
		return nil, 0, err
	}
	defer f.Close()
	st, err := f.Stat()
	if err != nil {
		return nil, 0, err
	}
	if !os.SameFile(fi, st) || !st.Mode().IsRegular() {
		return nil, 0, fmt.Errorf("%s changed while it was opened: not read", path)
	}
	if linkCount(f) > 1 {
		return nil, 0, fmt.Errorf("%s has more than one name (a hard link): not read", path)
	}
	if readSharedHold != nil {
		readSharedHold(path)
	}
	if maxBytes <= 0 {
		return nil, st.Size(), errors.New("nothing to read")
	}
	sz := st.Size()
	switch {
	case off < 0 && sz > maxBytes:
		if _, err := f.Seek(sz-maxBytes, io.SeekStart); err != nil {
			return nil, sz, err
		}
	case off > 0:
		if off >= sz {
			return nil, sz, nil
		}
		if _, err := f.Seek(off, io.SeekStart); err != nil {
			return nil, sz, err
		}
	}
	b, err := io.ReadAll(io.LimitReader(f, maxBytes))
	return b, sz, err
}

// round 20 (the re-review's Low 3): an append that does not follow a link: whatever is at the path must be a regular
// file with one name (no link, junction, reparse point or hard link); opened without following the last element
// (O_NOFOLLOW; on Windows FILE_FLAG_OPEN_REPARSE_POINT), and the opened file must be the one looked at
func appendNoFollow(path, s string) error {
	_ = os.MkdirAll(filepath.Dir(path), 0o755)
	fi, lerr := os.Lstat(path)
	switch {
	case lerr == nil && (!fi.Mode().IsRegular() || isReparse(path, fi)):
		return fmt.Errorf("%s is not a plain file (a link, a folder or another kind): not written", path)
	case lerr != nil && !os.IsNotExist(lerr):
		return lerr
	}
	f, err := openAppendNoFollow(path)
	if err != nil {
		return err
	}
	defer f.Close()
	st, err := f.Stat()
	if err != nil {
		return err
	}
	if !st.Mode().IsRegular() || (lerr == nil && !os.SameFile(fi, st)) {
		return fmt.Errorf("%s changed while it was opened: not written", path)
	}
	if linkCount(f) > 1 {
		return fmt.Errorf("%s has more than one name (a hard link): not written", path)
	}
	_, err = f.WriteString(s)
	return err
}

// round 20 (the re-review's Low 4): the file the trial's lock holds must be the one looked at: a regular file (no link
// or reparse point), the same file once opened, with one name only (a hard link swapped in is not held)
func lockCheck(path string, fi os.FileInfo, f *os.File) error {
	if !fi.Mode().IsRegular() || isReparse(path, fi) {
		return fmt.Errorf("%s is not a plain file: not locked", path)
	}
	st, err := f.Stat()
	if err != nil {
		return err
	}
	if !st.Mode().IsRegular() || !os.SameFile(fi, st) {
		return fmt.Errorf("%s changed while it was opened: not locked", path)
	}
	if linkCount(f) != 1 {
		return fmt.Errorf("%s has more than one name (a hard link): not locked", path)
	}
	return nil
}
