//go:build windows

// diag acrun DIR [lpac]: runs "diag fetch DIR" inside an AppContainer (lowbox token; with lpac, a Less Privileged
// AppContainer), as Chrome's sandboxed network service would be, so the bridge's own-user check meets such a client
package main

import (
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
)

var (
	modUserenv                 = windows.NewLazySystemDLL("userenv.dll")
	pCreateACProfile           = modUserenv.NewProc("CreateAppContainerProfile")
	pDeriveACSid               = modUserenv.NewProc("DeriveAppContainerSidFromAppContainerName")
	procThreadAttrSecCaps      = 0x00020009
	procThreadAttrAllAppPkgPol = 0x0002000F
)

type securityCapabilities struct {
	AppContainerSid *windows.SID
	Capabilities    *windows.SIDAndAttributes
	CapabilityCount uint32
	Reserved        uint32
}

func acSid(name string) (*windows.SID, error) {
	n, _ := windows.UTF16PtrFromString(name)
	var sid *windows.SID
	caps := []windows.SIDAndAttributes{}
	r, _, _ := pCreateACProfile.Call(uintptr(unsafe.Pointer(n)), uintptr(unsafe.Pointer(n)), uintptr(unsafe.Pointer(n)), 0, 0, uintptr(unsafe.Pointer(&sid)))
	_ = caps
	if r != 0 {
		r2, _, _ := pDeriveACSid.Call(uintptr(unsafe.Pointer(n)), uintptr(unsafe.Pointer(&sid)))
		if r2 != 0 {
			return nil, fmt.Errorf("CreateAppContainerProfile 0x%x, Derive 0x%x", r, r2)
		}
	}
	return sid, nil
}

func acRun(dir string, lpac bool) {
	name := "fincom.diag.ac"
	sid, err := acSid(name)
	if err != nil {
		emit("acrun: " + err.Error())
		return
	}
	emit("acrun: AppContainer SID " + sid.String() + fmt.Sprintf(" lpac=%v", lpac))
	var capSids []windows.SIDAndAttributes
	for _, s := range []string{"S-1-15-3-1", "S-1-15-3-2", "S-1-15-3-3"} { // internetClient, internetClientServer, privateNetworkClientServer
		cs, _ := windows.StringToSid(s)
		capSids = append(capSids, windows.SIDAndAttributes{Sid: cs, Attributes: windows.SE_GROUP_ENABLED})
	}
	sc := securityCapabilities{AppContainerSid: sid, Capabilities: &capSids[0], CapabilityCount: uint32(len(capSids))}
	n := uint32(1)
	if lpac {
		n = 2
	}
	al, err := windows.NewProcThreadAttributeList(n)
	if err != nil {
		emit("acrun: " + err.Error())
		return
	}
	defer al.Delete()
	if err := al.Update(uintptr(procThreadAttrSecCaps), unsafe.Pointer(&sc), unsafe.Sizeof(sc)); err != nil {
		emit("acrun: update caps: " + err.Error())
		return
	}
	optOut := uint32(1) // PROCESS_CREATION_ALL_APPLICATION_PACKAGES_OPT_OUT
	if lpac {
		if err := al.Update(uintptr(procThreadAttrAllAppPkgPol), unsafe.Pointer(&optOut), 4); err != nil {
			emit("acrun: update lpac: " + err.Error())
			return
		}
	}
	exe, _ := os.Executable()
	cmd := fmt.Sprintf(`"%s" fetch "%s"`, exe, dir)
	cmd16, _ := windows.UTF16PtrFromString(cmd)
	si := windows.StartupInfoEx{ProcThreadAttributeList: al.List()}
	si.Cb = uint32(unsafe.Sizeof(si))
	var pi windows.ProcessInformation
	if err := windows.CreateProcess(nil, cmd16, nil, nil, false, windows.EXTENDED_STARTUPINFO_PRESENT|windows.CREATE_NO_WINDOW, nil, nil, &si.StartupInfo, &pi); err != nil {
		emit("acrun: CreateProcess: " + err.Error())
		return
	}
	emit(fmt.Sprintf("acrun: child pid %d; self-inspect: %s", pi.ProcessId, pj(inspect(int(pi.ProcessId), nil, nil))))
	windows.WaitForSingleObject(pi.Process, 60000)
	windows.CloseHandle(pi.Process)
	windows.CloseHandle(pi.Thread)
	b, err := os.ReadFile(filepath.Join(dir, "acfetch.txt"))
	emit("acrun: child wrote:\n" + string(b) + errStr(err))
}

func errStr(err error) string {
	if err == nil {
		return ""
	}
	return " (" + err.Error() + ")"
}

// diag fetch DIR: inside the AppContainer: /ping, the mirror, /status; written to DIR\acfetch.txt
func fetch(dir string) {
	var sb strings.Builder
	sb.WriteString("in child: " + pj(inspect(os.Getpid(), nil, nil)) + "\n")
	c := &http.Client{Timeout: 10 * time.Second}
	for _, u := range []string{"http://127.0.0.1:9100/ping?n=0123456789abcdef0123456789abcdef0123456789abcdef", "http://127.0.0.1:9101/inspect?c=appcontainer", "http://127.0.0.1:9100/status"} {
		req, _ := http.NewRequest("GET", u, nil)
		req.Header.Set("Origin", "http://localhost:8000")
		r, err := c.Do(req)
		if err != nil {
			sb.WriteString("GET " + u + " -> " + err.Error() + "\n")
			if errno, ok := err.(syscall.Errno); ok {
				sb.WriteString(fmt.Sprint(" errno ", uint32(errno), "\n"))
			}
			continue
		}
		b, _ := io.ReadAll(r.Body)
		r.Body.Close()
		sb.WriteString(fmt.Sprintf("GET %s -> %d %s\n", u, r.StatusCode, b))
	}
	_ = os.WriteFile(filepath.Join(dir, "acfetch.txt"), []byte(sb.String()), 0o666)
}
