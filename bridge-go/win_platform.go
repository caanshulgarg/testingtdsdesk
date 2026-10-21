//go:build windows

// Windows: which programs listen on which ports in which Windows session, the users signed in, the person at the
// computer, the key kept protected (DPAPI), and the one shared lock with bridge 1.15.0.
package main

import (
	"errors"
	"os"
	"os/exec"
	"os/user"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
	"golang.org/x/sys/windows/registry"
	"golang.org/x/sys/windows/svc"
)

var (
	iphlpapi                = windows.NewLazySystemDLL("iphlpapi.dll")
	procGetExtendedTcpTable = iphlpapi.NewProc("GetExtendedTcpTable")
	wtsapi32                = windows.NewLazySystemDLL("wtsapi32.dll")
	procWTSQuerySessionInfo = wtsapi32.NewProc("WTSQuerySessionInformationW")
	user32                  = windows.NewLazySystemDLL("user32.dll")
	procGetLastInputInfo    = user32.NewProc("GetLastInputInfo")
	kernel32                = windows.NewLazySystemDLL("kernel32.dll")
	procSetThreadExecState  = kernel32.NewProc("SetThreadExecutionState")
	procGetTickCount        = kernel32.NewProc("GetTickCount")
)

const regKey = `SOFTWARE\FinCom\Bridge`

func isWindowsService() bool {
	ok, err := svc.IsWindowsService()
	return err == nil && ok
}

var asService bool // set when started by Windows as a service

// --- sessions and users
func ownSession() int {
	var s uint32
	if windows.ProcessIdToSessionId(windows.GetCurrentProcessId(), &s) != nil {
		return 0
	}
	return int(s)
}

func wtsString(session uint32, class uint32) string {
	var buf *uint16
	var n uint32
	r, _, _ := procWTSQuerySessionInfo.Call(0, uintptr(session), uintptr(class), uintptr(unsafe.Pointer(&buf)), uintptr(unsafe.Pointer(&n)))
	if r == 0 || buf == nil {
		return ""
	}
	defer windows.WTSFreeMemory(uintptr(unsafe.Pointer(buf)))
	return windows.UTF16PtrToString(buf)
}

const (
	wtsUserName   = 5
	wtsDomainName = 7
)

type sessInfo struct {
	id    int
	user  string
	state uint32
}

func sessions() []sessInfo {
	var p *windows.WTS_SESSION_INFO
	var n uint32
	if windows.WTSEnumerateSessions(0, 0, 1, &p, &n) != nil {
		return nil
	}
	defer windows.WTSFreeMemory(uintptr(unsafe.Pointer(p)))
	list := unsafe.Slice(p, n)
	var out []sessInfo
	for _, s := range list {
		out = append(out, sessInfo{int(s.SessionID), wtsString(s.SessionID, wtsUserName), s.State})
	}
	return out
}

func platSessionUsers() map[int]string {
	m := map[int]string{}
	for _, s := range sessions() {
		if s.user != "" {
			m[s.id] = s.user
		}
	}
	return m
}

func sameUser(a, b string) bool {
	short := func(s string) string {
		if i := strings.LastIndex(s, `\`); i >= 0 {
			s = s[i+1:]
		}
		return strings.ToLower(s)
	}
	return a != "" && short(a) == short(b)
}

// the owner's sessions: as a service, every session the owner is signed in to (also a disconnected one, where Tally
// may still run on a server); in a window, this window's session
func platMySessions() []int {
	if !asService {
		return []int{ownSession()}
	}
	owner := ownerName()
	var out []int
	for _, s := range sessions() {
		if s.id != 0 && sameUser(s.user, owner) && (s.state == windows.WTSActive || s.state == windows.WTSDisconnected) {
			out = append(out, s.id)
		}
	}
	return out
}

// --- programs and listening ports
type mibTCPRowOwnerPID struct {
	State, LocalAddr, LocalPort, RemoteAddr, RemotePort, OwningPid uint32
}

func listeningPorts() ([]listener, bool) {
	var size uint32
	procGetExtendedTcpTable.Call(0, uintptr(unsafe.Pointer(&size)), 0, windows.AF_INET, 3, 0) // TCP_TABLE_OWNER_PID_LISTENER
	if size == 0 {
		return nil, false
	}
	buf := make([]byte, size+1024)
	size = uint32(len(buf))
	r, _, _ := procGetExtendedTcpTable.Call(uintptr(unsafe.Pointer(&buf[0])), uintptr(unsafe.Pointer(&size)), 0, windows.AF_INET, 3, 0)
	if r != 0 {
		return nil, false
	}
	n := *(*uint32)(unsafe.Pointer(&buf[0]))
	rows := unsafe.Slice((*mibTCPRowOwnerPID)(unsafe.Pointer(&buf[4])), n)
	var out []listener
	for _, row := range rows {
		p := int(row.LocalPort&0xff)<<8 | int(row.LocalPort>>8&0xff)
		out = append(out, listener{p, int(row.OwningPid)})
	}
	return out, true
}

func processes() ([]proc, bool) {
	snap, err := windows.CreateToolhelp32Snapshot(windows.TH32CS_SNAPPROCESS, 0)
	if err != nil {
		return nil, false
	}
	defer windows.CloseHandle(snap)
	var e windows.ProcessEntry32
	e.Size = uint32(unsafe.Sizeof(e))
	var out []proc
	for err = windows.Process32First(snap, &e); err == nil; err = windows.Process32Next(snap, &e) {
		name := windows.UTF16ToString(e.ExeFile[:])
		p := proc{ID: int(e.ProcessID), Name: strings.TrimSuffix(strings.TrimSuffix(name, ".exe"), ".EXE")}
		var s uint32
		if windows.ProcessIdToSessionId(e.ProcessID, &s) == nil {
			p.Session = int(s)
		}
		if reTally.MatchString(p.Name) {
			if h, err := windows.OpenProcess(windows.PROCESS_QUERY_LIMITED_INFORMATION, false, e.ProcessID); err == nil {
				b := make([]uint16, windows.MAX_PATH*2)
				n := uint32(len(b))
				if windows.QueryFullProcessImageName(h, 0, &b[0], &n) == nil {
					p.Path = windows.UTF16ToString(b[:n])
				}
				var c, x, k, u windows.Filetime
				if windows.GetProcessTimes(h, &c, &x, &k, &u) == nil {
					p.Started = time.Unix(0, c.Nanoseconds())
				}
				windows.CloseHandle(h)
			}
		}
		out = append(out, p)
	}
	return out, true
}

func platNetState() (bool, []proc, []listener) {
	ls, ok1 := listeningPorts()
	ps, ok2 := processes()
	return ok1 && ok2, ps, ls
}

// the Tally program (tally.exe) running: in one of the owner's sessions when only the owner's Tally is used; with the
// test file, its list of programs. No request is sent to Tally for this
func platTallyRunning() bool {
	if f := fakeData(); f != nil {
		for _, x := range arr(f["processes"]) {
			if reTally.MatchString(str(obj(x)["name"])) {
				return true
			}
		}
		return false
	}
	ps, ok := processes()
	if !ok {
		return true // Windows did not say: the port decides
	}
	for _, p := range ps {
		if reTally.MatchString(p.Name) && (!cfgB("OnlyMySession") || isMine(p.Session)) {
			return true
		}
	}
	return false
}

// Tally opened a moment ago in one of the owner's sessions: it is still loading the company
func platTallyYoung(min float64) bool {
	ps, _ := processes()
	for _, p := range ps {
		if reTally.MatchString(p.Name) && isMine(p.Session) && !p.Started.IsZero() && time.Since(p.Started).Minutes() < min {
			return true
		}
	}
	return false
}

// --- the person at the computer
type lastInputInfo struct {
	cbSize uint32
	dwTime uint32
}

func localIdleSec() float64 {
	li := lastInputInfo{cbSize: uint32(unsafe.Sizeof(lastInputInfo{}))}
	r, _, _ := procGetLastInputInfo.Call(uintptr(unsafe.Pointer(&li)))
	if r == 0 {
		return 99999
	}
	t, _, _ := procGetTickCount.Call()
	return float64(uint32(t)-li.dwTime) / 1000
}
func localFrontIsTally() bool {
	h := windows.GetForegroundWindow()
	if h == 0 {
		return false
	}
	var pid uint32
	windows.GetWindowThreadProcessId(h, &pid)
	ps, _ := processes()
	for _, p := range ps {
		if p.ID == int(pid) {
			return reTally.MatchString(p.Name)
		}
	}
	return false
}
func platIdleSec() float64 {
	if !asService {
		return localIdleSec()
	}
	if idle, _, fresh := trayIdleFresh(); fresh {
		return idle
	}
	return 99999
}
func platFrontIsTally() bool {
	if !asService {
		return localFrontIsTally()
	}
	_, front, fresh := trayIdleFresh()
	return fresh && front
}

// --- bridge 1.15.0's lock on each Tally (Local\FinComTally<port>), shared when both run in the same Windows session
func lockSharedMutex(port int) func() {
	if asService || !testMode() {
		return func() {}
	}
	runtime.LockOSThread()
	name, _ := windows.UTF16PtrFromString("Local\\FinComTally" + strconv.Itoa(port))
	h, err := windows.CreateMutex(nil, false, name)
	if err != nil && h == 0 {
		runtime.UnlockOSThread()
		return func() {}
	}
	ev, _ := windows.WaitForSingleObject(h, 120000)
	if ev != windows.WAIT_OBJECT_0 && ev != windows.WAIT_ABANDONED {
		windows.CloseHandle(h)
		runtime.UnlockOSThread()
		return func() {}
	}
	return func() {
		windows.ReleaseMutex(h)
		windows.CloseHandle(h)
		runtime.UnlockOSThread()
	}
}

// --- keeping the computer awake while posting
var (
	awakeMu sync.Mutex
	awakeN  int
	awakeGo bool
)

func keepAwake(on bool) {
	awakeMu.Lock()
	defer awakeMu.Unlock()
	if on {
		awakeN++
	} else if awakeN > 0 {
		awakeN--
	}
	if awakeN > 0 && !awakeGo {
		awakeGo = true
		go func() {
			for {
				awakeMu.Lock()
				n := awakeN
				if n == 0 {
					awakeGo = false
					awakeMu.Unlock()
					return
				}
				awakeMu.Unlock()
				procSetThreadExecState.Call(0x00000001) // ES_SYSTEM_REQUIRED: the idle timer starts again
				time.Sleep(30 * time.Second)
			}
		}()
	}
}

func hideWindow(c *exec.Cmd) {
	c.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: 0x08000000}
}

// --- the computer key, protected for this Windows user (dpapi:, as bridge 1.15.0 kept it) or, for the service, for this
// computer (dpapim:)
var dpapiEntropy = []byte("FinCom Bridge")

func protectKey(k string) (string, error) {
	in := windows.DataBlob{Size: uint32(len(k)), Data: &[]byte(k)[0]}
	var out windows.DataBlob
	flags := uint32(windows.CRYPTPROTECT_UI_FORBIDDEN)
	prefix := "dpapi:"
	var ent *windows.DataBlob
	if asService {
		flags |= windows.CRYPTPROTECT_LOCAL_MACHINE
		prefix = "dpapim:"
		ent = &windows.DataBlob{Size: uint32(len(dpapiEntropy)), Data: &dpapiEntropy[0]}
	}
	if err := windows.CryptProtectData(&in, nil, ent, 0, nil, flags, &out); err != nil {
		return "", errors.New("Windows could not protect the key, so it was not kept.")
	}
	defer windows.LocalFree(windows.Handle(unsafe.Pointer(out.Data)))
	b := unsafe.Slice(out.Data, out.Size)
	return prefix + b64(b), nil
}
func unprotectKey(v string) string {
	var data []byte
	var ent *windows.DataBlob
	switch {
	case strings.HasPrefix(v, "dpapim:"):
		data = unb64(v[7:])
		ent = &windows.DataBlob{Size: uint32(len(dpapiEntropy)), Data: &dpapiEntropy[0]}
	case strings.HasPrefix(v, "dpapi:"):
		data = unb64(v[6:])
	case strings.HasPrefix(v, "plain:"):
		return v[6:]
	default:
		return v
	}
	if len(data) == 0 {
		return ""
	}
	in := windows.DataBlob{Size: uint32(len(data)), Data: &data[0]}
	var out windows.DataBlob
	if windows.CryptUnprotectData(&in, nil, ent, 0, nil, windows.CRYPTPROTECT_UI_FORBIDDEN, &out) != nil {
		return ""
	}
	defer windows.LocalFree(windows.Handle(unsafe.Pointer(out.Data)))
	return string(unsafe.Slice(out.Data, out.Size))
}

// --- the owner: the Windows user the bridge works for (recorded when it was installed)
func ownerName() string {
	if o := cfgS("Owner"); o != "" {
		return o
	}
	if u, err := user.Current(); err == nil {
		return u.Username
	}
	return os.Getenv("USERNAME")
}
func profileOf(sid string) string {
	k, err := registry.OpenKey(registry.LOCAL_MACHINE, `SOFTWARE\Microsoft\Windows NT\CurrentVersion\ProfileList\`+sid, registry.QUERY_VALUE)
	if err != nil {
		return ""
	}
	defer k.Close()
	p, _, _ := k.GetStringValue("ProfileImagePath")
	return p
}
func ownerProfile() string {
	if sid := cfgS("OwnerSid"); sid != "" {
		if p := profileOf(sid); p != "" {
			return p
		}
	}
	h, _ := os.UserHomeDir()
	return h
}

// the install's record: HKLM for the service; HKCU for an install just for this user (its program runs from there)
func regString(name string) string {
	root := registry.LOCAL_MACHINE
	if perUserInstall() {
		root = registry.CURRENT_USER
	}
	k, err := registry.OpenKey(root, regKey, registry.QUERY_VALUE|registry.WOW64_64KEY)
	if err != nil {
		return ""
	}
	defer k.Close()
	v, _, _ := k.GetStringValue(name)
	return v
}

// this Windows user's %LOCALAPPDATA%, from the process's own user (Windows' known folder): a program started for another
// user (runas, Start-Process -Credential) may carry the caller's environment, so the variable comes last
func localAppData() string {
	if p, err := windows.KnownFolderPath(windows.FOLDERID_LocalAppData, 0); err == nil && p != "" {
		return p
	}
	return os.Getenv("LOCALAPPDATA")
}

// the installed bridge's settings file (written by install)
func installedConfig() string { return regString("Config") }

// Windows' name and build, for the install log and support: "Windows 10 Pro 22H2 (build 19045)". Windows 11 still calls
// itself "Windows 10" in ProductName: from build 22000 it is Windows 11
func windowsVersion() string {
	k, err := registry.OpenKey(registry.LOCAL_MACHINE, `SOFTWARE\Microsoft\Windows NT\CurrentVersion`, registry.QUERY_VALUE|registry.WOW64_64KEY)
	if err != nil {
		return runtime.GOOS
	}
	defer k.Close()
	name, _, _ := k.GetStringValue("ProductName")
	build, _, _ := k.GetStringValue("CurrentBuild")
	disp, _, _ := k.GetStringValue("DisplayVersion")
	if b, _ := strconv.Atoi(build); b >= 22000 {
		name = strings.Replace(name, "Windows 10", "Windows 11", 1)
	}
	if disp != "" {
		name += " " + disp
	}
	return name + " (build " + build + ")"
}

// the installed bridge's folder (written by the installer), else bridge 1.15.0's folder of this user
func defaultHome() string {
	if h := regString("Home"); h != "" {
		return h
	}
	if la := localAppData(); la != "" {
		return filepath.Join(la, "TDS Desk Bridge")
	}
	return ""
}

// bridge 1.15.0 still on the computer for the owner: its program, or its start-at-sign-in file
func oldBridgePresent() bool {
	if isFake() {
		return false
	}
	prof := ownerProfile()
	for _, f := range []string{
		filepath.Join(psHome(), "TDSBridge.ps1"),
		filepath.Join(prof, `AppData\Roaming\Microsoft\Windows\Start Menu\Programs\Startup\TDS Desk Tally Bridge.vbs`),
	} {
		if exists(f) {
			return true
		}
	}
	return false
}

// a downloaded update: Windows' own check of its code signature
func checkCodeSignature(b []byte) error {
	f, err := os.CreateTemp("", "fincom-update-*.exe")
	if err != nil {
		return err
	}
	name := f.Name()
	_, _ = f.Write(b)
	f.Close()
	defer os.Remove(name)
	p, _ := windows.UTF16PtrFromString(name)
	fi := &windows.WinTrustFileInfo{Size: uint32(unsafe.Sizeof(windows.WinTrustFileInfo{})), FilePath: p}
	d := &windows.WinTrustData{Size: uint32(unsafe.Sizeof(windows.WinTrustData{})), UIChoice: windows.WTD_UI_NONE, RevocationChecks: windows.WTD_REVOKE_NONE,
		UnionChoice: windows.WTD_CHOICE_FILE, StateAction: windows.WTD_STATEACTION_VERIFY, FileOrCatalogOrBlobOrSgnrOrCert: unsafe.Pointer(fi)}
	err = windows.WinVerifyTrustEx(windows.InvalidHWND, &windows.WINTRUST_ACTION_GENERIC_VERIFY_V2, d)
	d.StateAction = windows.WTD_STATEACTION_CLOSE
	windows.WinVerifyTrustEx(windows.InvalidHWND, &windows.WINTRUST_ACTION_GENERIC_VERIFY_V2, d)
	if err != nil {
		return errors.New("no valid code signature")
	}
	return nil
}

// the running program is renamed (Windows allows that), the new one put in its place; the service then starts again
func applyUpdate(exe string, b []byte) error {
	dir := filepath.Dir(exe)
	nw := filepath.Join(dir, "FinComBridge.new.exe")
	old := filepath.Join(dir, "FinComBridge.old.exe")
	if err := os.WriteFile(nw, b, 0o755); err != nil {
		return err
	}
	_ = os.Remove(old)
	if err := os.Rename(exe, old); err != nil {
		return err
	}
	if err := os.Rename(nw, exe); err != nil {
		_ = os.Rename(old, exe)
		return err
	}
	// review H2 (2.2.0): the SHA-256 of the program replaced, recorded while it is the running one, for the rollback
	_ = saveFile(filepath.Join(dir, "update-pending.json"), jsonText(M{"from": BridgeVersion, "at": nowS(), "starts": 0, "sha256": fileSHA256(old)}))
	return nil
}

func openFile(f string) {
	c := exec.Command("notepad.exe", f)
	_ = c.Start()
}

var procAttachConsole = kernel32.NewProc("AttachConsole")

func attachConsole() {
	if r, _, _ := procAttachConsole.Call(uintptr(^uint32(0))); r != 0 { // ATTACH_PARENT_PROCESS
		if h, err := windows.GetStdHandle(windows.STD_OUTPUT_HANDLE); err == nil && h != 0 && h != windows.InvalidHandle {
			os.Stdout = os.NewFile(uintptr(h), "stdout")
		} else if f, err := os.OpenFile("CONOUT$", os.O_WRONLY, 0); err == nil {
			os.Stdout = f
		}
		os.Stderr = os.Stdout
	}
}

// the installer stops the service (or, installed just for this user, the user's bridge) before it replaces the program
func stopCmd(args []string) int {
	if contains(args, "--per-user") || perUserInstall() {
		stopUser()
		return 0
	}
	stopService()
	return 0
}

// 2.4.5 (plan section 3.2, condition 1): Tally's window answers. Each visible top-level window of a tally.exe of this
// Windows user's sessions is asked by Windows (IsHungAppWindow: Windows' own test, the window has not taken its messages
// for 5 s); nothing is sent to Tally. A window Windows calls hung: false. No window seen (the service, another session):
// true (the port and the answers decide, as before)
var (
	procEnumWindows        = user32.NewProc("EnumWindows")
	procIsHungAppWindow    = user32.NewProc("IsHungAppWindow")
	procIsWindowVisible    = user32.NewProc("IsWindowVisible")
	procGetWindowThreadPid = user32.NewProc("GetWindowThreadProcessId")
)

// windows.NewCallback makes a callback that is never freed (Go keeps at most about 2,000): one, made once, with its
// state under a lock
var (
	respMu   sync.Mutex
	respPids map[uint32]bool
	respHung bool
	respCB   = windows.NewCallback(func(h uintptr, _ uintptr) uintptr {
		var pid uint32
		_, _, _ = procGetWindowThreadPid.Call(h, uintptr(unsafe.Pointer(&pid)))
		if !respPids[pid] {
			return 1
		}
		if v, _, _ := procIsWindowVisible.Call(h); v == 0 {
			return 1
		}
		if r, _, _ := procIsHungAppWindow.Call(h); r != 0 {
			respHung = true
			return 0
		}
		return 1
	})
)

func platTallyResponds() bool {
	if tallyNotResponding.Load() {
		return false
	}
	ps, ok := processes()
	if !ok {
		return true
	}
	pids := map[uint32]bool{}
	for _, p := range ps {
		if reTally.MatchString(p.Name) && isMine(p.Session) {
			pids[uint32(p.ID)] = true
		}
	}
	if len(pids) == 0 {
		return true
	}
	respMu.Lock()
	defer respMu.Unlock()
	respPids, respHung = pids, false
	_, _, _ = procEnumWindows.Call(respCB, 0)
	return !respHung
}

// ROUND 103 (1b): the window probe while a request is at Tally (windowHoldFn, daypull.go)
var (
	procSendMessageTimeoutW = user32.NewProc("SendMessageTimeoutW")
	holdMu                  sync.Mutex
	holdPids                map[uint32]bool
	holdWins                []uintptr
	holdCB                  = windows.NewCallback(func(h uintptr, _ uintptr) uintptr {
		var pid uint32
		_, _, _ = procGetWindowThreadPid.Call(h, uintptr(unsafe.Pointer(&pid)))
		if holdPids[pid] {
			if v, _, _ := procIsWindowVisible.Call(h); v != 0 && len(holdWins) < 32 {
				holdWins = append(holdWins, h)
			}
		}
		return 1
	})
)

func tallyWindows() []uintptr {
	ps, ok := processes()
	if !ok {
		return nil
	}
	pids := map[uint32]bool{}
	for _, p := range ps {
		if reTally.MatchString(p.Name) && isMine(p.Session) {
			pids[uint32(p.ID)] = true
		}
	}
	if len(pids) == 0 {
		return nil
	}
	holdMu.Lock()
	defer holdMu.Unlock()
	holdPids, holdWins = pids, nil
	_, _, _ = procEnumWindows.Call(holdCB, 0)
	return append([]uintptr{}, holdWins...)
}

func platWindowHold() func() int {
	wins := tallyWindows()
	if len(wins) == 0 {
		return func() int { return 0 }
	}
	done := make(chan struct{})
	res := make(chan int, 1)
	go func() {
		const smtoAbortIfHung = 0x0002
		var since time.Time
		worst := 0
		for {
			select {
			case <-done:
				if !since.IsZero() {
					if ms := int(time.Since(since).Milliseconds()); ms > worst {
						worst = ms
					}
				}
				res <- worst
				return
			default:
			}
			answered := true
			for _, h := range wins {
				var out uintptr
				r, _, _ := procSendMessageTimeoutW.Call(h, 0, 0, 0, smtoAbortIfHung, 250, uintptr(unsafe.Pointer(&out)))
				if r == 0 {
					answered = false
					break
				}
			}
			if answered {
				if !since.IsZero() {
					if ms := int(time.Since(since).Milliseconds()); ms > worst {
						worst = ms
					}
				}
				since = time.Time{}
			} else if since.IsZero() {
				since = time.Now()
			}
			select {
			case <-done:
			case <-time.After(200 * time.Millisecond):
			}
		}
	}()
	return func() int {
		close(done)
		return <-res
	}
}
