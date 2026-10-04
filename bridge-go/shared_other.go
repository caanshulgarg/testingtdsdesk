//go:build !windows

// Round 19 (not Windows: the tests): the platform side of readShared (shared.go) and of the recorder folders (folders.go).
package main

import (
	"errors"
	"os"
	"syscall"
	"time"
)

// opened read-only; a link at the last element is not followed
func openShared(path string) (*os.File, error) {
	return os.OpenFile(path, os.O_RDONLY|syscall.O_NOFOLLOW|syscall.O_NONBLOCK, 0)
}

// how many names the open file has (a hard link planted to another file has more than one)
func linkCount(f *os.File) int {
	fi, err := f.Stat()
	if err != nil {
		return 0
	}
	if st, ok := fi.Sys().(*syscall.Stat_t); ok {
		return int(st.Nlink)
	}
	return 1
}

// another program holds the file so that it cannot be opened now (Windows only)
func isSharingViolation(err error) bool { return false }

// a symbolic link, a junction or another reparse point
func isReparse(path string, fi os.FileInfo) bool {
	return fi.Mode()&(os.ModeSymlink|os.ModeIrregular) != 0
}

// the owner of a folder is SYSTEM or the Administrators group (not Windows: the test's own user)
var ownerIsAdmin = func(path string) (bool, string) { return true, "" }

// the recorder trial's lock: on Windows share mode 0; here (the tests) an exclusive flock for d
func lockExclusive(path string, d time.Duration, started func()) error {
	f, err := openShared(path)
	if err != nil {
		return err
	}
	defer f.Close()
	if err := syscall.Flock(int(f.Fd()), syscall.LOCK_EX|syscall.LOCK_NB); err != nil {
		return errors.New("the file is held by another program: " + err.Error())
	}
	defer syscall.Flock(int(f.Fd()), syscall.LOCK_UN)
	if started != nil {
		started()
	}
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-t.C:
	case <-stopCh:
	}
	return nil
}
