//go:build windows

// 2.3.0: the Windows user of the program at the other end of a connection to the bridge (ownuser.go): the TCP table
// (GetExtendedTcpTable, TCP_TABLE_OWNER_PID_ALL) gives the process holding the client's end, and that process's token its
// user. A process the bridge may not open (another user's, as a non-administrator) is not this user's.
package main

import (
	"errors"
	"fmt"
	"unsafe"

	"golang.org/x/sys/windows"
)

var (
	modIphlpapi          = windows.NewLazySystemDLL("iphlpapi.dll")
	pGetExtendedTcpTable = modIphlpapi.NewProc("GetExtendedTcpTable")
)

const tcpTableOwnerPidAll = 5

// the IPv4 TCP table with each connection's process
func tcpTable() ([]tcpRow, error) {
	size := uint32(16 * 1024)
	for i := 0; i < 5; i++ {
		buf := make([]byte, size)
		r, _, _ := pGetExtendedTcpTable.Call(uintptr(unsafe.Pointer(&buf[0])), uintptr(unsafe.Pointer(&size)), 0, windows.AF_INET, tcpTableOwnerPidAll, 0)
		if r == uintptr(windows.ERROR_INSUFFICIENT_BUFFER) {
			size += 4096
			continue
		}
		if r != 0 {
			return nil, fmt.Errorf("GetExtendedTcpTable: %w", windows.Errno(r))
		}
		n := *(*uint32)(unsafe.Pointer(&buf[0]))
		const rowSize = uint32(unsafe.Sizeof(tcpRow{}))
		if 4+n*rowSize > uint32(len(buf)) {
			return nil, errors.New("GetExtendedTcpTable: short table")
		}
		rows := make([]tcpRow, n)
		for k := uint32(0); k < n; k++ {
			rows[k] = *(*tcpRow)(unsafe.Pointer(&buf[4+k*rowSize]))
		}
		return rows, nil
	}
	return nil, errors.New("GetExtendedTcpTable: the table kept growing")
}

// the SID of a process's user
func processSID(pid int) (string, error) {
	h, err := windows.OpenProcess(windows.PROCESS_QUERY_LIMITED_INFORMATION, false, uint32(pid))
	if err != nil {
		return "", err
	}
	defer windows.CloseHandle(h)
	var tok windows.Token
	if err := windows.OpenProcessToken(h, windows.TOKEN_QUERY, &tok); err != nil {
		return "", err
	}
	defer tok.Close()
	u, err := tok.GetTokenUser()
	if err != nil {
		return "", err
	}
	return u.User.Sid.String(), nil
}

func platPeerUser(local, remote int) (string, bool, error) {
	rows, err := tcpTable()
	if err != nil {
		return "", true, err
	}
	pid := peerPidFrom(rows, local, remote)
	if pid == 0 {
		return "", true, fmt.Errorf("no program holds 127.0.0.1:%d", remote)
	}
	sid, err := processSID(pid)
	if errors.Is(err, windows.ERROR_ACCESS_DENIED) {
		return "", true, nil // a process this bridge may not open is another user's
	}
	return sid, true, err
}

// the user this bridge runs as, and (as the service, which runs as SYSTEM) the owner it works for
func platOwnSIDs() []string {
	own := []string{}
	if u, err := windows.GetCurrentProcessToken().GetTokenUser(); err == nil {
		own = append(own, u.User.Sid.String())
	}
	if s := cfgS("OwnerSid"); s != "" {
		own = append(own, s)
	}
	return own
}
