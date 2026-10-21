//go:build !windows

package main

import (
	"errors"
	"os"
	"syscall"
)

// review 245 R4: tally.ini opened without following a link (O_NOFOLLOW), refused when it is not a plain file
func openNoLink(path string, write bool) (*os.File, error) {
	flag := os.O_RDONLY
	if write {
		flag = os.O_RDWR
	}
	f, err := os.OpenFile(path, flag|syscall.O_NOFOLLOW, 0)
	if err != nil {
		return nil, err
	}
	if fi, err := f.Stat(); err != nil || !fi.Mode().IsRegular() {
		f.Close()
		return nil, errors.New("not a plain file (a link or a folder): not touched")
	}
	return f, nil
}
