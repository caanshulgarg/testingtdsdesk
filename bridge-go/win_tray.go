//go:build windows

// The tray icon, in the signed-in owner's session (the service starts it; installed just for one user, its supervisor
// does): green when the bridge reaches Tally and FinCom, red when not; its tooltip says the mode first ("Test mode: reading
// only, not posting" or "Main bridge: reading and posting"). Its menu: Open FinCom, Test connection, Show log, Switch to
// main bridge (test mode), Status, Connect FinCom, Pause, Restart, Check for updates, Send install log, Quit; and Windows
// notifications for "Bridge offline" and "Tally not open". On Windows 11 it keeps itself shown next to the clock. It
// also tells the service how long the keyboard and mouse have been idle and whether Tally is in front (a service cannot
// see that), and hands over bridge 1.15.0's computer key, which only this Windows user can open.
package main

import (
	_ "embed"
	"encoding/binary"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"runtime"
	"strings"
	"sync"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
	"golang.org/x/sys/windows/registry"
)

//go:embed icons/green.ico
var icoGreen []byte

//go:embed icons/red.ico
var icoRed []byte

var (
	shell32                 = windows.NewLazySystemDLL("shell32.dll")
	pShellNotifyIcon        = shell32.NewProc("Shell_NotifyIconW")
	pShellExecute           = shell32.NewProc("ShellExecuteW")
	pRegisterClassEx        = user32.NewProc("RegisterClassExW")
	pCreateWindowEx         = user32.NewProc("CreateWindowExW")
	pDefWindowProc          = user32.NewProc("DefWindowProcW")
	pGetMessage             = user32.NewProc("GetMessageW")
	pTranslateMessage       = user32.NewProc("TranslateMessage")
	pDispatchMessage        = user32.NewProc("DispatchMessageW")
	pPostQuitMessage        = user32.NewProc("PostQuitMessage")
	pCreatePopupMenu        = user32.NewProc("CreatePopupMenu")
	pAppendMenu             = user32.NewProc("AppendMenuW")
	pTrackPopupMenu         = user32.NewProc("TrackPopupMenu")
	pSetForegroundWindow    = user32.NewProc("SetForegroundWindow")
	pDestroyMenu            = user32.NewProc("DestroyMenu")
	pRegisterWindowMessage  = user32.NewProc("RegisterWindowMessageW")
	pCreateIconFromResource = user32.NewProc("CreateIconFromResourceEx")
	pMessageBox             = user32.NewProc("MessageBoxW")
	pPostMessage            = user32.NewProc("PostMessageW")
	pFindWindow             = user32.NewProc("FindWindowW")
	pGetCursorPos           = user32.NewProc("GetCursorPos")
	pGetSystemMetrics       = user32.NewProc("GetSystemMetrics")
)

const (
	wmCommand     = 0x0111
	wmDestroy     = 0x0002
	wmNull        = 0x0000
	wmApp         = 0x8000
	wmTray        = wmApp + 1
	wmShowStatus  = wmApp + 3
	wmRButtonUp   = 0x0205
	wmLButtonDbl  = 0x0203
	nimAdd        = 0
	nimModify     = 1
	nimDelete     = 2
	nifMessage    = 1
	nifIcon       = 2
	nifTip        = 4
	nifInfo       = 0x10
	mfString      = 0
	mfGrayed      = 1
	mfSeparator   = 0x800
	mfChecked     = 8
	tpmRightBtn   = 2
	tpmReturnCmd  = 0x100
	trayClass     = "FinComBridgeTray"
	mbIconInfo    = 0x40
	mbIconWarning = 0x30
)

type notifyIconData struct {
	CbSize           uint32
	HWnd             uintptr
	UID              uint32
	UFlags           uint32
	UCallbackMessage uint32
	HIcon            uintptr
	SzTip            [128]uint16
	DwState          uint32
	DwStateMask      uint32
	SzInfo           [256]uint16
	UVersion         uint32
	SzInfoTitle      [64]uint16
	DwInfoFlags      uint32
	GuidItem         windows.GUID
	HBalloonIcon     uintptr
}
type wndClassEx struct {
	cbSize        uint32
	style         uint32
	lpfnWndProc   uintptr
	cbClsExtra    int32
	cbWndExtra    int32
	hInstance     uintptr
	hIcon         uintptr
	hCursor       uintptr
	hbrBackground uintptr
	lpszMenuName  *uint16
	lpszClassName *uint16
	hIconSm       uintptr
}
type msgT struct {
	hwnd    uintptr
	message uint32
	wParam  uintptr
	lParam  uintptr
	time    uint32
	pt      struct{ x, y int32 }
	private uint32
}

func u16(s string) *uint16 { p, _ := windows.UTF16PtrFromString(s); return p }
func copyU16(dst []uint16, s string) {
	u, _ := windows.UTF16FromString(s)
	if len(u) > len(dst) {
		u = u[:len(dst)-1]
		u = append(u, 0)
	}
	copy(dst, u)
}

// an icon from an .ico file in memory, at the size Windows uses for the tray
func iconFrom(ico []byte) uintptr {
	want := 16
	if s, _, _ := pGetSystemMetrics.Call(49); s > 0 { // SM_CXSMICON
		want = int(s)
	}
	n := int(binary.LittleEndian.Uint16(ico[4:]))
	best, bestSize := -1, 0
	for i := 0; i < n; i++ {
		e := ico[6+16*i:]
		w := int(e[0])
		if w == 0 {
			w = 256
		}
		if best < 0 || (w >= want && (bestSize < want || w < bestSize)) || (bestSize < want && w > bestSize) {
			best, bestSize = i, w
		}
	}
	e := ico[6+16*best:]
	size, off := binary.LittleEndian.Uint32(e[8:]), binary.LittleEndian.Uint32(e[12:])
	h, _, _ := pCreateIconFromResource.Call(uintptr(unsafe.Pointer(&ico[off])), uintptr(size), 1, 0x00030000, uintptr(bestSize), uintptr(bestSize), 0)
	return h
}

type tray struct {
	mu        sync.Mutex
	hwnd      uintptr
	nid       notifyIconData
	green     uintptr
	red       uintptr
	st        M
	reachable bool
	since     map[string]time.Time
	told      map[string]bool
	started   time.Time
	tallySeen bool
}

var tr = &tray{since: map[string]time.Time{}, told: map[string]bool{}, started: time.Now()}
var taskbarCreated uintptr

// --- talking to the service
func trayCall(method, path string, body any) M {
	loadConfigRO()
	var rd io.Reader
	if body != nil {
		rd = strings.NewReader(jsonText(body))
	}
	req, _ := http.NewRequest(method, fmt.Sprintf("http://127.0.0.1:%d%s", toInt(cfg("Port")), path), rd)
	req.Header.Set("X-Bridge-Key", cfgS("Key"))
	req.Header.Set("Content-Type", "application/json")
	c := &http.Client{Timeout: 20 * time.Second, Transport: &http.Transport{Proxy: nil}}
	r, err := c.Do(req)
	if err != nil {
		return nil
	}
	defer r.Body.Close()
	b, _ := io.ReadAll(r.Body)
	return parseObj(string(b))
}

func (t *tray) setIcon(green bool, tip string) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.nid.UFlags = nifIcon | nifTip | nifMessage
	t.nid.HIcon = t.red
	if green {
		t.nid.HIcon = t.green
	}
	t.nid.SzTip = [128]uint16{}
	copyU16(t.nid.SzTip[:], tip)
	pShellNotifyIcon.Call(nimModify, uintptr(unsafe.Pointer(&t.nid)))
}
func (t *tray) balloon(title, text string, warn bool) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.nid.UFlags = nifInfo
	t.nid.SzInfo, t.nid.SzInfoTitle = [256]uint16{}, [64]uint16{}
	copyU16(t.nid.SzInfo[:], text)
	copyU16(t.nid.SzInfoTitle[:], title)
	t.nid.DwInfoFlags = 1
	if warn {
		t.nid.DwInfoFlags = 2
	}
	pShellNotifyIcon.Call(nimModify, uintptr(unsafe.Pointer(&t.nid)))
}
func notify(title, text string) { tr.balloon(title, text, true) }

// once, until the condition clears; and only after it has lasted a while
func (t *tray) warnIf(cond bool, key string, after time.Duration, title, text string) {
	if !cond {
		delete(t.since, key)
		t.told[key] = false
		return
	}
	if _, ok := t.since[key]; !ok {
		t.since[key] = time.Now()
	}
	if !t.told[key] && time.Since(t.since[key]) >= after {
		t.told[key] = true
		t.balloon(title, text, true)
	}
}

func (t *tray) poll() {
	keyTried := time.Time{}
	for {
		trayCall("POST", "/tray/idle", M{"idleSec": localIdleSec(), "tallyFront": localFrontIsTally(), "session": ownSession()})
		st := trayCall("GET", "/tray/status", nil)
		t.mu.Lock()
		t.st, t.reachable = st, st != nil
		t.mu.Unlock()
		if st == nil {
			t.setIcon(false, trayTip(nil))
			t.warnIf(time.Since(t.started) > 30*time.Second, "down", 30*time.Second, "FinCom Bridge is not running",
				"The bridge on this computer has stopped. "+restartsBy()+"; if this stays, choose Restart from this icon.")
			// switched to main (or installed again): the install's record names other settings, on another port; the icon
			// starts again from them
			if c := installedConfig(); !trayConfigGiven && c != "" && exists(c) && !strings.EqualFold(c, ConfigPath) {
				restartTray()
			}
		} else {
			t.warnIf(false, "down", 0, "", "")
			if str(st["version"]) != BridgeVersion && !truthy(obj(st["update"])["applying"]) {
				restartTray() // the bridge was updated: the icon starts again from the new program
			}
			tally, online, cloud, pausedNow := truthy(st["tallyOpen"]), truthy(st["online"]), truthy(st["cloudConnected"]), truthy(st["paused"])
			if tally {
				t.tallySeen = true
			}
			t.setIcon(tally && online && !pausedNow, trayTip(st))
			t.warnIf(cloud && !online && !pausedNow, "offline", 2*time.Minute, "Bridge offline",
				"This computer cannot reach FinCom. Changes from Tally wait here and go as soon as FinCom can be reached.")
			t.warnIf(!tally && !pausedNow && time.Since(t.started) > 2*time.Minute && (t.tallySeen || officeHours()), "tally", 3*time.Minute, "Tally not open",
				"Open TallyPrime with your company, so FinCom stays up to date and postings reach Tally.")
			// bridge 1.15.0's computer key, protected for this Windows user: handed to the service, which cannot open it
			if truthy(st["needKey"]) && time.Since(keyTried) > 10*time.Minute {
				keyTried = time.Now()
				handOverKey()
			}
		}
		time.Sleep(5 * time.Second)
	}
}

func handOverKey() {
	for _, f := range []string{"tds-bridge.config.json", "go-bridge.config.json"} {
		c := newOrdered()
		if c.UnmarshalText(readText(Home+`\`+f)) != nil {
			continue
		}
		for _, k := range []string{"CloudKey", "CloudKeyGo"} {
			if v := str(c.Get(k)); strings.HasPrefix(v, "dpapi:") {
				if key := unprotectKey(v); key != "" {
					trayCall("POST", "/tray/cloudkey", M{"key": key})
					return
				}
			}
		}
	}
}

func restartTray() {
	exe, _ := os.Executable()
	if trayMutex != 0 {
		windows.CloseHandle(trayMutex) // free for the new icon, which would otherwise find this one and end
		trayMutex = 0
	}
	c := exec.Command(exe, "tray")
	_ = c.Start()
	tr.mu.Lock()
	pShellNotifyIcon.Call(nimDelete, uintptr(unsafe.Pointer(&tr.nid)))
	tr.mu.Unlock()
	os.Exit(0)
}

func shellOpen(file, params string) {
	var p *uint16
	if params != "" {
		p = u16(params)
	}
	pShellExecute.Call(0, uintptr(unsafe.Pointer(u16("open"))), uintptr(unsafe.Pointer(u16(file))), uintptr(unsafe.Pointer(p)), 0, 1)
}
func msgBox(title, text string, icon uintptr) {
	pMessageBox.Call(0, uintptr(unsafe.Pointer(u16(text))), uintptr(unsafe.Pointer(u16(title))), icon|0x00040000) // MB_TOPMOST
}

// a Yes/No question; true for Yes
func yesNo(title, text string) bool {
	r, _, _ := pMessageBox.Call(0, uintptr(unsafe.Pointer(u16(text))), uintptr(unsafe.Pointer(u16(title))), 0x4|0x20|0x100|0x00040000) // MB_YESNO, MB_ICONQUESTION, MB_DEFBUTTON2, MB_TOPMOST
	return r == 6                                                                                                                      // IDYES
}

// for commands run outside the tray (sendlog): a message box, a web page, the folder with a file selected
func showMessage(title, text string, warn bool) {
	icon := uintptr(mbIconInfo)
	if warn {
		icon = mbIconWarning
	}
	msgBox(title, text, icon)
}
func openURL(u string)      { shellOpen(u, "") }
func showInFolder(f string) { shellOpen("explorer.exe", `/select,"`+f+`"`) }

func (t *tray) statusText() string {
	t.mu.Lock()
	st := t.st
	t.mu.Unlock()
	if st == nil {
		if perUserInstall() {
			return "FinCom Bridge (installed just for you) is not answering on this computer.\n\n" + restartsBy() + ". If this stays, choose Restart, or see the log."
		}
		return "The FinCom Bridge service is not answering on this computer.\n\nWindows starts it again by itself. If this stays, choose Restart, or see the log."
	}
	var b strings.Builder
	fmt.Fprintf(&b, "FinCom Bridge %s, working for %s\n", str(st["version"]), str(st["owner"]))
	b.WriteString(modeWords(st) + "; FinCom knows this bridge as " + str(st["bridgeId"]) + ".\n")
	switch str(st["runMode"]) {
	case "user":
		b.WriteString("Runs just for you (installed without an administrator): starts when you sign in, runs while you are signed in.\n")
	case "service":
		b.WriteString("Runs as a Windows service for all users: starts with Windows.\n")
	}
	if truthy(st["testMode"]) {
		b.WriteString("TEST MODE beside bridge 1.15.0: reads Tally and sends to FinCom as a shadow; never posts.\n")
	} else if r := str(st["readOnly"]); r != "" {
		b.WriteString(r + "\n")
	}
	b.WriteString("\n")
	if rs := obj(st["readStopped"]); rs != nil {
		who := "by the bridge itself"
		if str(rs["by"]) == "fincom" {
			who = "from FinCom"
		}
		again := "Choose Resume reading when Tally is free again."
		if str(rs["by"]) == "fincom" {
			again = "It is resumed from FinCom (Resume reading for this computer), not from here."
		}
		b.WriteString("READING STOPPED " + strings.ToUpper(who[:1]) + who[1:] + " at " + strings.Replace(str(rs["at"]), "T", " ", 1) + ": " + str(rs["reason"]) + ". Nothing is read from Tally (no background reading, no Update now, no ledger lists); postings still work. " + again + "\n")
	}
	if truthy(st["paused"]) {
		b.WriteString("Background reading paused: opening a client in FinCom, the ledger chooser's refresh, the ledger list after a posting and the nightly catch-up do not read Tally. Postings and Update now (with the ledger list) still work.\n")
	}
	fmt.Fprintf(&b, "Reads Tally only when needed: a client opened in FinCom, Update now, a posting, the ledger list (a new ledger posted, or FinCom's ledger chooser), and the nightly catch-up at %s (only when Tally is open and nobody has used FinCom for 15 minutes; KeepDailyAt in the settings).\n", str(st["nightlyAt"]))
	if l := str(st["lastRead"]); l != "" {
		fmt.Fprintf(&b, "Last read from Tally: %s\n", strings.Replace(l, "T", " ", 1))
	}
	fmt.Fprintf(&b, "Requests sent to Tally since the bridge started: %d", toInt(st["tallyRequests"]))
	if l := str(st["tallyLastRequest"]); l != "" {
		fmt.Fprintf(&b, " (the last at %s)", strings.Replace(l, "T", " ", 1))
	}
	b.WriteString("\n")
	if na := str(st["notAnsweringSince"]); na != "" {
		fmt.Fprintf(&b, "Tally: not answering since %s (open; nothing more is asked of it until a posting, Update now or another event)\n", strings.Replace(na, "T", " ", 1))
	} else if str(st["tallyState"]) == "busy" {
		fmt.Fprintf(&b, "Tally: busy since %s (open, answers slowly; asked again quietly) (%s)\n", str(st["busySince"]), strings.Join(strs(st["companies"]), ", "))
	} else if truthy(st["tallyOpen"]) {
		fmt.Fprintf(&b, "Tally: open (%s)\n", strings.Join(strs(st["companies"]), ", "))
	} else {
		b.WriteString("Tally: not open in your Windows session\n")
	}
	switch {
	case !truthy(st["cloudConnected"]):
		b.WriteString("FinCom: this computer is not connected yet (FinCom > Settings > Tally Bridge)\n")
	case truthy(st["online"]):
		fmt.Fprintf(&b, "FinCom: online (last heartbeat %s)\n", str(st["lastBeat"]))
	default:
		fmt.Fprintf(&b, "FinCom: OFFLINE since %s; changes wait on this computer\n", str(st["beatFailed"]))
	}
	w := obj(st["wake"])
	fmt.Fprintf(&b, "Wake-up channel: %s\n", map[bool]string{true: "connected", false: "not connected (the heartbeat carries on)"}[truthy(w["joined"])])
	if l := str(st["posting"]); l != "" {
		b.WriteString("Posting: " + l + "\n")
	}
	if truthy(st["updating"]) {
		b.WriteString("Update from Tally: running now\n")
	}
	if sh := obj(st["shadow"]); truthy(st["testMode"]) && sh != nil {
		fmt.Fprintf(&b, "Shadow check: %d day(s) the same as bridge 1.15.0's, %d different\n", toInt(sh["same"]), toInt(sh["differ"]))
	}
	if u := obj(st["update"]); u != nil && str(u["message"]) != "" {
		b.WriteString("Updates: " + str(u["message"]) + "\n")
	}
	fmt.Fprintf(&b, "\nAddress for FinCom: http://127.0.0.1:%d\nLog: %s", toInt(st["port"]), str(st["log"]))
	return b.String()
}

func (t *tray) menu() {
	t.mu.Lock()
	st := t.st
	t.mu.Unlock()
	m, _, _ := pCreatePopupMenu.Call()
	add := func(id int, text string, flags uintptr) {
		pAppendMenu.Call(m, flags, uintptr(id), uintptr(unsafe.Pointer(u16(text))))
	}
	add(1, trayTip(st), mfGrayed)
	pAppendMenu.Call(m, mfSeparator, 0, 0)
	add(2, "Open FinCom", mfString)
	add(11, "Test connection", mfString)
	add(16, "Measure Tally (for FinCom support)", mfString)
	add(5, "Show log", mfString)
	switch {
	case st != nil && truthy(st["testMode"]) && truthy(st["switching"]):
		add(13, "Switching to the main bridge...", mfGrayed)
	case st != nil && truthy(st["testMode"]):
		add(12, "Switch to main bridge...", mfString)
	case st != nil:
		add(13, "Main bridge: reading and posting", mfGrayed)
	}
	pAppendMenu.Call(m, mfSeparator, 0, 0)
	add(10, "Status...", mfString)
	add(7, "Connect FinCom on this computer...", mfString)
	if rs := obj(st["readStopped"]); st != nil && rs != nil {
		if str(rs["by"]) == "fincom" {
			// a stop made from FinCom is lifted in FinCom only (the bridge refuses the tray's resume for it)
			add(17, "Reading stopped from FinCom (resume it in FinCom)", mfGrayed)
		} else {
			add(17, "Resume reading (stopped: "+cutRunes(str(rs["reason"]), 60)+")", mfString)
		}
	}
	if st != nil && truthy(st["paused"]) {
		add(3, "Resume background reading", mfString)
	} else {
		add(3, "Pause background reading", mfString)
	}
	if st != nil {
		add(15, "Nightly catch-up at "+str(st["nightlyAt"]), mfGrayed)
	}
	add(4, "Restart", mfString)
	add(6, "Check for updates", mfString)
	if st != nil && truthy(st["testMode"]) {
		add(8, "Compare with bridge 1.15.0", mfString)
	}
	add(14, "Send install log to FinCom", mfString)
	pAppendMenu.Call(m, mfSeparator, 0, 0)
	add(9, "Quit (hide this icon)", mfString)
	var pt struct{ x, y int32 }
	pGetCursorPos.Call(uintptr(unsafe.Pointer(&pt)))
	pSetForegroundWindow.Call(t.hwnd)
	id, _, _ := pTrackPopupMenu.Call(m, tpmRightBtn|tpmReturnCmd, uintptr(pt.x), uintptr(pt.y), 0, t.hwnd, 0)
	pPostMessage.Call(t.hwnd, wmNull, 0, 0)
	pDestroyMenu.Call(m)
	go t.command(int(id), st)
}

func (t *tray) command(id int, st M) {
	switch id {
	case 2:
		u := "https://staging.fincom.live/review/"
		if st != nil && str(st["fincomUrl"]) != "" {
			u = str(st["fincomUrl"])
		}
		shellOpen(u, "")
	case 10:
		msgBox("FinCom Bridge", t.statusText(), mbIconInfo)
	case 7:
		r := trayCall("POST", "/paircode", M{})
		if r == nil || str(r["code"]) == "" {
			msgBox("FinCom Bridge", "The bridge is not answering, so no connect code could be made.", mbIconWarning)
			return
		}
		u := "https://staging.fincom.live/review/"
		if st != nil && str(st["fincomUrl"]) != "" {
			u = str(st["fincomUrl"])
		}
		shellOpen(u, "")
		until := str(r["until"])
		if len(until) >= 16 {
			until = until[11:16]
		}
		msgBox("Connect FinCom", "In FinCom on this computer: Settings > Tally Bridge > Connect, and type this code:\n\n        "+str(r["code"])+"\n\n(until "+until+")", mbIconInfo)
	case 3:
		on := !(st != nil && truthy(st["paused"]))
		trayCall("POST", "/tray/pause", M{"on": on})
		if on {
			t.balloon("Background reading paused", "Opening a client in FinCom and the nightly catch-up do not read Tally until you choose Resume. Postings and Update now still work.", false)
		} else {
			t.balloon("FinCom Bridge", "Background reading resumed.", false)
		}
	case 17:
		r := trayCall("POST", "/tray/resume-reading", M{})
		if r == nil {
			msgBox("FinCom Bridge", "The bridge is not answering, so reading could not be resumed.", mbIconWarning)
			return
		}
		if truthy(r["byFinCom"]) {
			msgBox("FinCom Bridge", "Reading was stopped from FinCom: resume it in FinCom (Resume reading for this computer).", mbIconInfo)
			return
		}
		t.balloon("FinCom Bridge", "Reading from Tally resumed.", false)
	case 4:
		if trayCall("POST", "/tray/restart", M{}) == nil {
			if perUserInstall() {
				// the supervisor gone too (ended in the Task Manager): started again here, as at sign-in
				exe, _ := os.Executable()
				_ = exec.Command(exe, "user").Start()
				t.balloon("FinCom Bridge", "Starting the bridge; it is back in a few seconds.", false)
				return
			}
			msgBox("FinCom Bridge", "The bridge is not answering. Windows starts it again by itself within a minute; if not, restart the computer.", mbIconWarning)
			return
		}
		t.balloon("FinCom Bridge", "Starting again; it is back in a few seconds.", false)
	case 5:
		f := ""
		if st != nil {
			f = str(st["log"])
		}
		if f == "" {
			loadConfigRO()
			f = logFile()
		}
		shellOpen("notepad.exe", `"`+f+`"`)
	case 6:
		t.balloon("FinCom Bridge", "Checking for updates...", false)
		r := trayCall("POST", "/tray/update", M{})
		if r == nil {
			t.balloon("FinCom Bridge", "The bridge is not answering.", true)
			return
		}
		t.balloon("FinCom Bridge updates", str(r["message"]), false)
	case 8:
		exe, _ := os.Executable()
		shellOpen("cmd.exe", `/k ""`+exe+`" compare"`)
	case 11:
		t.balloon("FinCom Bridge", "Testing the connection: the bridge, Tally and FinCom (up to half a minute)...", false)
		loadConfigRO()
		port := toInt(cfg("Port"))
		ping := pingLocal(port, 10*time.Second)
		var chk M
		if ping != nil {
			chk = trayCall("POST", "/tray/check", M{})
		}
		rep := connectionReport(port, ping, chk)
		icon := uintptr(mbIconInfo)
		if strings.Contains(rep, "NOT ") || strings.Contains(rep, "not checked") || strings.Contains(rep, "refused") || strings.Contains(rep, "not connected") {
			icon = mbIconWarning
		}
		msgBox("FinCom Bridge - Test connection", rep, icon)
	case 16:
		// one request at a time through the bridge's queue; the report opens when it is done
		r := trayCall("POST", "/tray/measure", M{})
		if r == nil || r["ok"] == false {
			why := "The bridge is not answering."
			if r != nil {
				why = str(r["error"])
			}
			msgBox("FinCom Bridge - Measure Tally", why, mbIconWarning)
			return
		}
		t.balloon("FinCom Bridge", "Measuring "+str(r["company"])+" for FinCom support: one request at a time, a few minutes. The report opens when it is done.", false)
		for i := 0; i < 900; i++ {
			time.Sleep(2 * time.Second)
			s := trayCall("GET", "/tray/measure", nil)
			if s == nil {
				continue
			}
			if str(s["state"]) == "done" {
				openFile(str(s["file"]))
				return
			}
			if str(s["state"]) == "failed" {
				msgBox("FinCom Bridge - Measure Tally", "Not measured: "+str(s["error"]), mbIconWarning)
				return
			}
		}
	case 12:
		if !yesNo("FinCom Bridge", "Make FinCom Bridge "+BridgeVersion+" the main bridge on this computer? Bridge 1.15.0 is stopped and no longer starts; FinCom Bridge then reads and posts. Its pairing, settings and copy are kept.") {
			return
		}
		r := trayCall("POST", "/tray/makemain", M{})
		switch {
		case r == nil:
			msgBox("FinCom Bridge", "The bridge is not answering, so it could not be made the main bridge. Choose Restart, then try again.", mbIconWarning)
		case r["ok"] != true:
			msgBox("FinCom Bridge", str(r["error"]), mbIconWarning)
		default:
			t.balloon("FinCom Bridge", "Becoming the main bridge: bridge 1.15.0 is stopped and FinCom Bridge starts again on its own. The icon is back in about a minute.", false)
		}
	case 14:
		// sendlog shows its own message (sent, with the reference; or what to do)
		exe, _ := os.Executable()
		c := exec.Command(exe, "sendlog")
		hideWindow(c)
		if err := c.Start(); err != nil {
			msgBox("FinCom Bridge", "The install log could not be sent: "+err.Error(), mbIconWarning)
		}
	case 9:
		trayCall("POST", "/tray/quit", M{"session": ownSession()})
		if trayQuitEv != 0 {
			_ = windows.SetEvent(trayQuitEv) // the supervisor does not bring the icon back until the next start
		}
		t.mu.Lock()
		pShellNotifyIcon.Call(nimDelete, uintptr(unsafe.Pointer(&t.nid)))
		t.mu.Unlock()
		pPostQuitMessage.Call(0)
		os.Exit(0)
	}
}

func wndProc(hwnd, msg, wp, lp uintptr) uintptr {
	switch {
	case msg == wmTray:
		switch lp & 0xffff {
		case wmRButtonUp:
			tr.menu()
		case wmLButtonDbl:
			go msgBox("FinCom Bridge", tr.statusText(), mbIconInfo)
		}
		return 0
	case msg == wmShowStatus:
		go msgBox("FinCom Bridge", tr.statusText(), mbIconInfo)
		return 0
	case taskbarCreated != 0 && msg == taskbarCreated:
		tr.mu.Lock()
		tr.nid.UFlags = nifIcon | nifTip | nifMessage
		pShellNotifyIcon.Call(nimAdd, uintptr(unsafe.Pointer(&tr.nid)))
		tr.mu.Unlock()
		return 0
	case msg == wmDestroy:
		pPostQuitMessage.Call(0)
		return 0
	}
	r, _, _ := pDefWindowProc.Call(hwnd, msg, wp, lp)
	return r
}

var (
	trayMutex       windows.Handle
	trayQuitEv      windows.Handle // installed just for one user: Quit tells the supervisor so
	trayConfigGiven bool           // started with --config (by the per-user supervisor): it names the settings
)

// Always visible next to the clock: Windows 11 hides new tray icons behind the ^ arrow. Its setting for each icon is
// HKCU\Control Panel\NotifyIconSettings\<id> (ExecutablePath, IsPromoted); the key appears once the icon was added, so
// it is looked for a few times. Best effort, said once in the log. Windows 10 keeps it in one binary value (TrayNotify)
// that cannot be changed safely: left alone there; the setup's last page says where the icon is.
func keepPromoted() {
	exe, _ := os.Executable()
	for _, wait := range []time.Duration{3 * time.Second, 15 * time.Second, time.Minute, 5 * time.Minute} {
		time.Sleep(wait)
		k, err := registry.OpenKey(registry.CURRENT_USER, `Control Panel\NotifyIconSettings`, registry.ENUMERATE_SUB_KEYS)
		if err != nil {
			return // not Windows 11
		}
		names, _ := k.ReadSubKeyNames(0)
		k.Close()
		for _, n := range names {
			sk, err := registry.OpenKey(registry.CURRENT_USER, `Control Panel\NotifyIconSettings\`+n, registry.QUERY_VALUE|registry.SET_VALUE)
			if err != nil {
				continue
			}
			p, _, _ := sk.GetStringValue("ExecutablePath")
			if sameProgramPath(p, exe, os.Getenv) {
				v, _, err := sk.GetIntegerValue("IsPromoted")
				if err != nil || v != 1 {
					if err := sk.SetDWordValue("IsPromoted", 1); err == nil {
						writeLog("Tray icon: set to show next to the clock always (Windows 11)")
					} else {
						writeLog("Tray icon: Windows 11 did not let it show always next to the clock: " + err.Error())
					}
				}
				sk.Close()
				return
			}
			sk.Close()
		}
	}
}

func runTray(args []string) int {
	runtime.LockOSThread()
	trayConfigGiven = flagValue(args, "config") != ""
	setPaths(flagValue(args, "config"), flagValue(args, "home"))
	loadConfigRO()
	if o := cfgS("Owner"); o != "" && !sameUser(o, currentUser()) {
		return 0 // the bridge works for another Windows user of this computer
	}
	// one icon per session: a second start (the Start menu, the desktop) shows the status of the first; the
	// supervisor's own checks (--quiet) show nothing
	var err error
	if trayMutex, err = windows.CreateMutex(nil, false, u16(`Local\FinComBridgeTray`)); err == windows.ERROR_ALREADY_EXISTS {
		if contains(args, "--quiet") {
			return 0
		}
		if h, _, _ := pFindWindow.Call(uintptr(unsafe.Pointer(u16(trayClass))), 0); h != 0 {
			pPostMessage.Call(h, wmShowStatus, 0, 0)
		}
		return 0
	}
	if perUserInstall() {
		trayQuitEv = userEvent("TrayQuit")
		_ = windows.ResetEvent(trayQuitEv) // started (again) by hand: the icon is wanted
		// the setup or the uninstaller stops this user's bridge: the icon goes too, so the program can be replaced
		go func() {
			<-whenSet(userEvent("Stop"))
			tr.mu.Lock()
			pShellNotifyIcon.Call(nimDelete, uintptr(unsafe.Pointer(&tr.nid)))
			tr.mu.Unlock()
			os.Exit(0)
		}()
	}
	hinst, _, _ := windows.NewLazySystemDLL("kernel32.dll").NewProc("GetModuleHandleW").Call(0)
	wc := wndClassEx{cbSize: uint32(unsafe.Sizeof(wndClassEx{})), lpfnWndProc: windows.NewCallback(wndProc), hInstance: hinst, lpszClassName: u16(trayClass)}
	pRegisterClassEx.Call(uintptr(unsafe.Pointer(&wc)))
	hwnd, _, _ := pCreateWindowEx.Call(0, uintptr(unsafe.Pointer(u16(trayClass))), uintptr(unsafe.Pointer(u16("FinCom Bridge"))), 0, 0, 0, 0, 0, 0, 0, hinst, 0)
	taskbarCreated, _, _ = pRegisterWindowMessage.Call(uintptr(unsafe.Pointer(u16("TaskbarCreated"))))
	tr.hwnd, tr.green, tr.red = hwnd, iconFrom(icoGreen), iconFrom(icoRed)
	tr.nid = notifyIconData{HWnd: hwnd, UID: 1, UFlags: nifIcon | nifTip | nifMessage, UCallbackMessage: wmTray, HIcon: tr.red}
	tr.nid.CbSize = uint32(unsafe.Sizeof(tr.nid))
	copyU16(tr.nid.SzTip[:], "FinCom Bridge: starting")
	pShellNotifyIcon.Call(nimAdd, uintptr(unsafe.Pointer(&tr.nid)))
	go tr.poll()
	go keepPromoted()
	var m msgT
	for {
		r, _, _ := pGetMessage.Call(uintptr(unsafe.Pointer(&m)), 0, 0, 0)
		if int32(r) <= 0 {
			break
		}
		pTranslateMessage.Call(uintptr(unsafe.Pointer(&m)))
		pDispatchMessage.Call(uintptr(unsafe.Pointer(&m)))
	}
	pShellNotifyIcon.Call(nimDelete, uintptr(unsafe.Pointer(&tr.nid)))
	return 0
}

// who starts the bridge again when it stops, for the icon's messages
func restartsBy() string {
	if perUserInstall() {
		return "FinCom Bridge starts it again by itself while you are signed in"
	}
	return "Windows starts it again by itself"
}

func currentUser() string {
	return wtsString(uint32(ownSession()), wtsUserName)
}
