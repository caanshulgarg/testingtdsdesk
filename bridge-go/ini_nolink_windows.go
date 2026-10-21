//go:build windows

package main

import (
	"errors"
	"os"

	"golang.org/x/sys/windows"
)

// review 245 R4: tally.ini opened without following a link or junction (FILE_FLAG_OPEN_REPARSE_POINT), and refused when
// the handle is a reparse point or not a plain file: the check and the read or write go through the same handle
func openNoLink(path string, write bool) (*os.File, error) {
	p, err := windows.UTF16PtrFromString(path)
	if err != nil {
		return nil, err
	}
	access := uint32(windows.GENERIC_READ)
	if write {
		access |= windows.GENERIC_WRITE
	}
	h, err := windows.CreateFile(p, access, windows.FILE_SHARE_READ|windows.FILE_SHARE_WRITE, nil, windows.OPEN_EXISTING,
		windows.FILE_ATTRIBUTE_NORMAL|windows.FILE_FLAG_OPEN_REPARSE_POINT, 0)
	if err != nil {
		return nil, err
	}
	var bi windows.ByHandleFileInformation
	if err := windows.GetFileInformationByHandle(h, &bi); err != nil {
		windows.CloseHandle(h)
		return nil, err
	}
	if bi.FileAttributes&(windows.FILE_ATTRIBUTE_REPARSE_POINT|windows.FILE_ATTRIBUTE_DIRECTORY) != 0 {
		windows.CloseHandle(h)
		return nil, errors.New("not a plain file (a link, a junction or a folder): not touched")
	}
	return os.NewFile(uintptr(h), path), nil
}
