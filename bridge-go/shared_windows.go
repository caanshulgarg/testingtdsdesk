//go:build windows

// Round 19: the platform side of readShared (shared.go) and of the recorder folders (folders.go), on Windows.
package main

import (
	"errors"
	"os"
	"strings"
	"time"

	"golang.org/x/sys/windows"
)

// opened for reading only, sharing read, write AND delete with everyone (Go's os.Open does not give FILE_SHARE_DELETE),
// and a reparse point is opened as itself, never followed: Tally's add-on can always append, rename or delete the file
// while the bridge reads it
func openShared(path string) (*os.File, error) {
	p, err := windows.UTF16PtrFromString(path)
	if err != nil {
		return nil, err
	}
	h, err := windows.CreateFile(p, windows.GENERIC_READ, windows.FILE_SHARE_READ|windows.FILE_SHARE_WRITE|windows.FILE_SHARE_DELETE, nil,
		windows.OPEN_EXISTING, windows.FILE_ATTRIBUTE_NORMAL|windows.FILE_FLAG_OPEN_REPARSE_POINT, 0)
	if err != nil {
		return nil, &os.PathError{Op: "open", Path: path, Err: err}
	}
	return os.NewFile(uintptr(h), path), nil
}

// opened to append (created when missing), sharing read and write; a reparse point at the path is opened as itself,
// never followed (appendNoFollow then refuses it)
func openAppendNoFollow(path string) (*os.File, error) {
	p, err := windows.UTF16PtrFromString(path)
	if err != nil {
		return nil, err
	}
	h, err := windows.CreateFile(p, windows.FILE_APPEND_DATA|windows.FILE_READ_ATTRIBUTES|windows.SYNCHRONIZE, windows.FILE_SHARE_READ|windows.FILE_SHARE_WRITE, nil,
		windows.OPEN_ALWAYS, windows.FILE_ATTRIBUTE_NORMAL|windows.FILE_FLAG_OPEN_REPARSE_POINT, 0)
	if err != nil {
		return nil, &os.PathError{Op: "open", Path: path, Err: err}
	}
	return os.NewFile(uintptr(h), path), nil
}

// the final path of a folder (opened with FILE_FLAG_BACKUP_SEMANTICS, every junction and link followed), as
// GetFinalPathNameByHandle gives it, without the \\?\ prefix; a function so the tests can give another
var finalPathFn = func(path string) (string, error) {
	p, err := windows.UTF16PtrFromString(path)
	if err != nil {
		return "", err
	}
	h, err := windows.CreateFile(p, windows.FILE_READ_ATTRIBUTES, windows.FILE_SHARE_READ|windows.FILE_SHARE_WRITE|windows.FILE_SHARE_DELETE, nil,
		windows.OPEN_EXISTING, windows.FILE_FLAG_BACKUP_SEMANTICS, 0)
	if err != nil {
		return "", err
	}
	defer windows.CloseHandle(h)
	buf := make([]uint16, 512)
	for {
		n, err := windows.GetFinalPathNameByHandle(h, &buf[0], uint32(len(buf)), 0) // FILE_NAME_NORMALIZED | VOLUME_NAME_DOS (both 0)
		if err != nil {
			return "", err
		}
		if int(n) < len(buf) {
			s := windows.UTF16ToString(buf[:n])
			switch {
			case strings.HasPrefix(s, `\\?\UNC\`):
				s = `\\` + s[len(`\\?\UNC\`):]
			case strings.HasPrefix(s, `\\?\`):
				s = s[len(`\\?\`):]
			}
			return s, nil
		}
		buf = make([]uint16, n+1)
	}
}

// running as the Windows service (started by Windows as LocalSystem)
func runningAsService() bool { return asService }

func linkCount(f *os.File) int {
	var fi windows.ByHandleFileInformation
	if err := windows.GetFileInformationByHandle(windows.Handle(f.Fd()), &fi); err != nil {
		return 0
	}
	return int(fi.NumberOfLinks)
}

func isSharingViolation(err error) bool {
	return errors.Is(err, windows.ERROR_SHARING_VIOLATION) || errors.Is(err, windows.ERROR_LOCK_VIOLATION)
}

// a symbolic link, a junction (mount point) or any other reparse point, by the file's own attributes
func isReparse(path string, fi os.FileInfo) bool {
	if fi.Mode()&(os.ModeSymlink|os.ModeIrregular) != 0 {
		return true
	}
	p, err := windows.UTF16PtrFromString(path)
	if err != nil {
		return true
	}
	a, err := windows.GetFileAttributes(p)
	if err != nil {
		return true
	}
	return a&windows.FILE_ATTRIBUTE_REPARSE_POINT != 0
}

// the folder's owner is SYSTEM or the Administrators group; else false and the owner's SID
var ownerIsAdmin = func(path string) (bool, string) {
	sd, err := windows.GetNamedSecurityInfo(path, windows.SE_FILE_OBJECT, windows.OWNER_SECURITY_INFORMATION)
	if err != nil {
		return false, "(owner not read: " + err.Error() + ")"
	}
	o, _, err := sd.Owner()
	if err != nil || o == nil {
		return false, "(no owner)"
	}
	if o.IsWellKnown(windows.WinLocalSystemSid) || o.IsWellKnown(windows.WinBuiltinAdministratorsSid) {
		return true, o.String()
	}
	return false, o.String()
}

// the recorder trial's lock: the file opened with share mode 0 (no one else may open it) for d, then closed; started is
// called once it is held
func lockExclusive(path string, d time.Duration, started func()) error {
	p, err := windows.UTF16PtrFromString(path)
	if err != nil {
		return err
	}
	fi, err := os.Lstat(path)
	if err != nil {
		return err
	}
	h, err := windows.CreateFile(p, windows.GENERIC_READ, 0, nil, windows.OPEN_EXISTING, windows.FILE_ATTRIBUTE_NORMAL|windows.FILE_FLAG_OPEN_REPARSE_POINT, 0)
	if err != nil {
		return err
	}
	// round 20 (the re-review's Low 4): the handle's file is the one looked at, with one name (os.File closes h)
	f := os.NewFile(uintptr(h), path)
	defer f.Close()
	if err := lockCheck(path, fi, f); err != nil {
		return err
	}
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
