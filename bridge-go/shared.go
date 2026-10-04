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
)

// a hook for the tests: called while readShared holds the file open
var readSharedHold func(path string)

func readShared(path string, maxBytes int64) ([]byte, error) { return readTail(path, maxBytes, true) }

// the last maxBytes of a regular file, read as readShared says; busyLog: a held file is logged
func readTail(path string, maxBytes int64, busyLog bool) ([]byte, error) {
	fi, err := os.Lstat(path)
	if err != nil {
		return nil, err
	}
	if !fi.Mode().IsRegular() || isReparse(path, fi) {
		return nil, fmt.Errorf("%s is not a plain file (a link, a folder or another kind): not read", path)
	}
	f, err := openShared(path)
	if err != nil {
		if busyLog && isSharingViolation(err) {
			writeLog("Recorder trial: recorder file busy, read later: " + path)
		}
		return nil, err
	}
	defer f.Close()
	st, err := f.Stat()
	if err != nil {
		return nil, err
	}
	if !os.SameFile(fi, st) || !st.Mode().IsRegular() {
		return nil, fmt.Errorf("%s changed while it was opened: not read", path)
	}
	if linkCount(f) > 1 {
		return nil, fmt.Errorf("%s has more than one name (a hard link): not read", path)
	}
	if readSharedHold != nil {
		readSharedHold(path)
	}
	if maxBytes <= 0 {
		return nil, errors.New("nothing to read")
	}
	if sz := st.Size(); sz > maxBytes {
		if _, err := f.Seek(sz-maxBytes, io.SeekStart); err != nil {
			return nil, err
		}
	}
	return io.ReadAll(io.LimitReader(f, maxBytes))
}
