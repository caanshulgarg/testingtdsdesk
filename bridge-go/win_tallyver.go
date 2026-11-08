//go:build windows

// next-fast-measure: TallyPrime's version for the fast-read measurement: the file version of this user's own tally.exe
// (the running one), read from the file itself; nothing is asked of Tally
package main

import (
	"fmt"
	"unsafe"

	"golang.org/x/sys/windows"
)

func platTallyVersion() string {
	ps, ok := processes()
	if !ok {
		return ""
	}
	for _, p := range ps {
		if !reTally.MatchString(p.Name) || p.Path == "" || sessionOwner(p) == "other" {
			continue
		}
		if v := fileVersion(p.Path); v != "" {
			return v
		}
	}
	return ""
}

func fileVersion(path string) string {
	var zero windows.Handle
	n, err := windows.GetFileVersionInfoSize(path, &zero)
	if err != nil || n == 0 || n > 1<<20 {
		return ""
	}
	buf := make([]byte, n)
	if windows.GetFileVersionInfo(path, 0, n, unsafe.Pointer(&buf[0])) != nil {
		return ""
	}
	var fi *windows.VS_FIXEDFILEINFO
	var l uint32
	if windows.VerQueryValue(unsafe.Pointer(&buf[0]), `\`, unsafe.Pointer(&fi), &l) != nil || fi == nil || l == 0 {
		return ""
	}
	return fmt.Sprintf("%d.%d.%d.%d", fi.FileVersionMS>>16, fi.FileVersionMS&0xffff, fi.FileVersionLS>>16, fi.FileVersionLS&0xffff)
}
