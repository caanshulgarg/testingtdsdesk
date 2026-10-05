//go:build windows

package main

import (
	"golang.org/x/sys/windows"
)

// review M3 (Windows): the lock file opened with NO sharing (share mode 0): while this process holds it open, any other
// open of it fails (ERROR_SHARING_VIOLATION); Windows lets go of it when the process ends, however it ends
func platLockExclusive(p string) (func(), error) {
	name, err := windows.UTF16PtrFromString(p)
	if err != nil {
		return nil, err
	}
	h, err := windows.CreateFile(name, windows.GENERIC_READ|windows.GENERIC_WRITE, 0, nil, windows.OPEN_ALWAYS, windows.FILE_ATTRIBUTE_NORMAL, 0)
	if err != nil {
		return nil, err
	}
	return func() { _ = windows.CloseHandle(h) }, nil
}
