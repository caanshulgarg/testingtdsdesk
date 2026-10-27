//go:build !windows

package main

import (
	"os"
	"syscall"
)

// review M3 (not Windows: the tests): an exclusive, non-blocking flock on the lock file, held while the file is open
func platLockExclusive(p string) (func(), error) {
	f, err := os.OpenFile(p, os.O_RDWR|os.O_CREATE, 0o644)
	if err != nil {
		return nil, err
	}
	if err := syscall.Flock(int(f.Fd()), syscall.LOCK_EX|syscall.LOCK_NB); err != nil {
		f.Close()
		return nil, err
	}
	return func() { _ = syscall.Flock(int(f.Fd()), syscall.LOCK_UN); f.Close() }, nil
}
